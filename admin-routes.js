const express = require('express');
const router = express.Router();
const db = require('./database');
const axios = require('axios');
const cheerio = require('cheerio');
const { authMiddleware, adminMiddleware } = require('./auth-middleware');
const authRoutes = require('./auth-routes');
const { activatePurchase, logPaymentEvent } = require('./payment-service');

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
 
const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

async function deleteUserCascade(userId) {
  const user = await dbGet(`SELECT email FROM users WHERE id = ?`, [userId]);
  const email = user?.email || null;

  await dbRun(`DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?`, [userId, userId]);
  await dbRun(`DELETE FROM conversations WHERE participant_one_id = ? OR participant_two_id = ?`, [userId, userId]);
  await dbRun(`DELETE FROM recruiter_notes WHERE recruiter_id = ? OR application_id IN (SELECT id FROM applications WHERE user_id = ? OR applicant_email = ? OR job_id IN (SELECT id FROM jobs WHERE recruiter_id = ?))`, [userId, userId, email, userId]);
  await dbRun(`DELETE FROM application_events WHERE user_id = ? OR job_id IN (SELECT id FROM jobs WHERE recruiter_id = ?)`, [userId, userId]);
  await dbRun(`DELETE FROM applications WHERE user_id = ? OR applicant_email = ? OR job_id IN (SELECT id FROM jobs WHERE recruiter_id = ?)`, [userId, email, userId]);
  await dbRun(`DELETE FROM jobs WHERE recruiter_id = ?`, [userId]);

  await dbRun(`DELETE FROM payment_events WHERE payment_id IN (SELECT id FROM payments WHERE user_id = ? OR recruiter_id = ?)`, [userId, userId]);
  await dbRun(`DELETE FROM payment_transactions WHERE user_id = ? OR payment_id IN (SELECT id FROM payments WHERE user_id = ? OR recruiter_id = ?)`, [userId, userId, userId]);
  await dbRun(`DELETE FROM invoices WHERE user_id = ? OR payment_id IN (SELECT id FROM payments WHERE user_id = ? OR recruiter_id = ?)`, [userId, userId, userId]);
  await dbRun(`DELETE FROM payments WHERE user_id = ? OR recruiter_id = ?`, [userId, userId]);
  await dbRun(`DELETE FROM subscriptions WHERE recruiter_id = ?`, [userId]);

  await dbRun(`DELETE FROM verification_documents WHERE user_id = ? OR request_id IN (SELECT id FROM verification_requests WHERE user_id = ?)`, [userId, userId]);
  await dbRun(`DELETE FROM user_verifications WHERE user_id = ?`, [userId]);
  await dbRun(`DELETE FROM verification_requests WHERE user_id = ? OR reviewed_by = ?`, [userId, userId]);

  await dbRun(`DELETE FROM visits WHERE user_id = ?`, [userId]);
  await dbRun(`DELETE FROM clicks WHERE user_id = ?`, [userId]);
  await dbRun(`DELETE FROM cv_scores WHERE user_id = ?`, [userId]);
  await dbRun(`DELETE FROM profile_analytics WHERE user_id = ?`, [userId]);
  await dbRun(`DELETE FROM profile_checklist WHERE user_id = ?`, [userId]);
  if (email) await dbRun(`DELETE FROM notifications WHERE user_email = ?`, [email]);

  await dbRun(`DELETE FROM users WHERE id = ?`, [userId]);
}

function validatePassword(password) {
  return /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{6,}$/.test(String(password || ''));
}

const IMPORT_CATEGORIES = new Set([
  'Jobs',
  'Internships',
  'Scholarships',
  'Grants',
  'Tenders',
  'Fellowships',
  'Competitions',
  'Training Programs',
]);
const IMPORT_STATUSES = new Set(['pending_review', 'approved', 'rejected']);

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function parseRequirements(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || '')
    .split(/\r?\n|;/)
    .map(cleanText)
    .filter(Boolean);
}

function normalizeOpportunityStatus(value) {
  if (value === 'pending') return 'pending_review';
  return IMPORT_STATUSES.has(value) ? value : 'pending_review';
}

function dbStatus(status) {
  return normalizeOpportunityStatus(status) === 'pending_review' ? 'pending' : normalizeOpportunityStatus(status);
}

function apiStatus(row) {
  if (row?.duplicate_of_id) return 'duplicate';
  if (row?.imported_from_url && row.status === 'pending') return 'pending_review';
  return row?.status || 'pending';
}

function applicationFields(body) {
  const method = body.application_method || 'external_website';
  const target = body.application_target || body.application_url || body.application_email || body.application_whatsapp || '';
  return {
    application_method: method,
    application_url: method === 'external_website' ? (body.application_url || target || null) : null,
    application_email: method === 'email' ? (body.application_email || target || null) : null,
    application_whatsapp: method === 'whatsapp' ? String(body.application_whatsapp || target || '').replace(/[^\d+]/g, '') || null : null,
  };
}

async function getImporterRecruiterId() {
  const email = 'imports@hireke.local';
  const existing = await dbGet(`SELECT id FROM users WHERE email = ?`, [email]);
  if (existing) return existing.id;

  const result = await dbRun(
    `INSERT INTO users (email, password, name, role, status, company_name, email_verified)
     VALUES (?, 'system-generated-no-login', 'HireKe Imports', 'recruiter', 'approved', 'HireKe Curated Opportunities', 1)`,
    [email]
  );
  return result.lastID;
}

function revenueSourceCase() {
  return `CASE
    WHEN LOWER(COALESCE(item_type, item_code, package_name, '')) LIKE '%featured%' THEN 'Featured Jobs'
    WHEN LOWER(COALESCE(item_type, item_code, package_name, '')) LIKE '%premium%'
      OR LOWER(COALESCE(item_type, item_code, package_name, '')) LIKE '%starter%'
      OR LOWER(COALESCE(item_type, item_code, package_name, '')) LIKE '%professional%'
      OR LOWER(COALESCE(item_type, item_code, package_name, '')) LIKE '%business%'
      OR LOWER(COALESCE(item_type, item_code, package_name, '')) LIKE '%subscription%' THEN 'Premium Packages'
    WHEN LOWER(COALESCE(item_type, item_code, package_name, '')) LIKE '%job%' THEN 'Job Posting'
    ELSE 'Others'
  END`;
}

async function findOpportunityDuplicates(body, excludeId = null) {
  const params = [];
  const clauses = [];

  if (body.source_url) {
    clauses.push('LOWER(source_url) = LOWER(?)');
    params.push(body.source_url);
  }

  if (body.title && body.organization) {
    clauses.push('(LOWER(title) = LOWER(?) AND LOWER(COALESCE(source_name, company_external, "")) = LOWER(?))');
    params.push(body.title, body.organization);
  }

  if (body.title && body.deadline) {
    clauses.push('(LOWER(title) = LOWER(?) AND date(deadline) = date(?))');
    params.push(body.title, body.deadline);
  }

  if (!clauses.length) return [];
  let sql = `
    SELECT id, title, source_name, company_external, deadline, source_url, status, duplicate_of_id
    FROM jobs
    WHERE (${clauses.join(' OR ')})
  `;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' ORDER BY created_at DESC LIMIT 5';

  return (await dbAll(sql, params)).map((row) => ({ ...row, status: apiStatus(row) }));
}

function isAllowedImportUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (_) {
    return false;
  }
}

function textFromMeta($, names) {
  for (const name of names) {
    const content = $(`meta[property="${name}"], meta[name="${name}"]`).attr('content');
    if (cleanText(content)) return cleanText(content);
  }
  return '';
}

function extractOpportunity(html, sourceUrl) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const title = cleanText(textFromMeta($, ['og:title', 'twitter:title']) || $('h1').first().text() || $('title').text());
  const description = cleanText(
    textFromMeta($, ['og:description', 'description']) ||
    $('article').first().text() ||
    $('main').first().text() ||
    $('body').text()
  ).slice(0, 3500);
  const bodyText = cleanText($('body').text());
  const deadlineMatch = bodyText.match(/(?:deadline|closing date|apply by|submission date)[:\s-]{0,12}([A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  const locationMatch = bodyText.match(/(?:location|based in)[:\s-]{0,12}([A-Za-z ,/-]{3,80})/i);
  const applicationHref = $('a[href*="apply" i], a:contains("Apply"), a:contains("Application")').first().attr('href');
  const applicationUrl = applicationHref ? new URL(applicationHref, sourceUrl).toString() : sourceUrl;
  const host = new URL(sourceUrl).hostname.replace(/^www\./, '');

  return {
    title: title.slice(0, 180),
    organization: cleanText(textFromMeta($, ['og:site_name', 'application-name']) || host),
    location: locationMatch ? cleanText(locationMatch[1]) : '',
    deadline: deadlineMatch ? cleanText(deadlineMatch[1]) : '',
    description,
    application_method: 'external_website',
    application_url: applicationUrl,
    source_url: sourceUrl,
    source_name: cleanText(textFromMeta($, ['og:site_name', 'application-name']) || host),
  };
}

async function logImport({ sourceUrl, status, extracted, error, userId }) {
  await dbRun(
    `INSERT INTO opportunity_import_logs (source_url, status, extracted_fields_json, error_message, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [sourceUrl, status, extracted ? JSON.stringify(extracted) : null, error || null, userId || null]
  );
}

// Check database health
router.get('/health', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await dbGet('SELECT 1');
    res.json({ status: 'connected', database: 'SQLite' });
  } catch (error) {
    res.status(500).json({ status: 'disconnected', error: error.message });
  }
});

// Attempt to re-initialize/verify DB connection
router.post('/reconnect-db', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await dbGet('SELECT 1');
    res.json({ success: true, message: 'Database connection verified' });
  } catch (error) {
    res.status(500).json({ error: 'Database remains inaccessible: ' + error.message });
  }
});

// Trigger manual test of the daily report email
router.post('/test-daily-report', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const rows = await dbAll(`
      SELECT p.created_at, u.name as recruiter_name, u.email as recruiter_email, 
             p.package_name, p.amount, p.transaction_id, p.status
      FROM payments p 
      JOIN users u ON p.recruiter_id = u.id 
      WHERE p.created_at >= date('now', '-1 day') AND p.created_at < date('now')
      ORDER BY p.created_at ASC
    `);

    const headers = "Timestamp,Recruiter,Email,Package,Amount,TransactionID,Status";
    const csvRows = rows.map(r => `"${r.created_at}","${r.recruiter_name}","${r.recruiter_email}","${r.package_name}",${r.amount},"${r.transaction_id}","${r.status}"`);
    const csvContent = [headers, ...csvRows].join('\n');

    const totalRevenue = rows
      .filter(r => r.status === 'success' || r.status === 'completed')
      .reduce((sum, r) => sum + r.amount, 0);

    await authRoutes.sendReportEmail('denismose098@gmail.com', csvContent, `HireKe_Test_Report_${dateStr}.csv`, totalRevenue);

    res.json({ success: true, message: `Test report for ${rows.length} transactions sent to denismose098@gmail.com` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new admin (admin only)
router.post('/create-admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long, contain one uppercase letter, one number, and one symbol.' });
    }

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    await dbRun(
      `INSERT INTO users (email, password, name, role, status, email_verified)
       VALUES (?, ?, ?, 'admin', 'approved', 1)`,
      [email, hashedPassword, name]
    );

    res.json({ success: true, message: 'Admin account created successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all users (job seekers + recruiters)
router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await dbAll(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.company_name, u.company_url, u.cv_url, u.created_at,
              u.email_verified, u.verified_at, uv.level as trust_level, uv.badge_label,
              uv.status as verification_status, uv.expires_at as verification_expires_at
       FROM users u
       LEFT JOIN user_verifications uv ON uv.user_id = u.id
       ORDER BY u.created_at DESC`,
      []
    );

    res.json(users);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reset password for a specific user (admin)
router.post('/users/reset-password', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ error: 'userId and newPassword are required' });
    }
    if (!validatePassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long, contain one uppercase letter, one number, and one symbol.' });
    }

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await dbRun(`UPDATE users SET password = ?, otp_code = NULL, otp_expires_at = NULL WHERE id = ?`, [hashedPassword, userId]);

    res.json({ success: true, message: 'Password reset for user' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Change email for an admin (admin)
router.put('/users/:userId/email', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { email } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ error: 'userId and email are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const targetUser = await dbGet(`SELECT id, role FROM users WHERE id = ?`, [userId]);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (targetUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin users can have their email changed from this route' });
    }

    const existing = await dbGet(`SELECT id FROM users WHERE email = ? AND id != ?`, [email, userId]);
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Update email and mark as unverified to be safe
    await dbRun(`UPDATE users SET email = ?, email_verified = 0, verified_at = NULL WHERE id = ?`, [email, userId]);

    res.json({ success: true, message: 'Email updated' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// Update user role (admin)
router.put('/users/:userId/role', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { newRole } = req.body;

    const validRoles = ['jobseeker', 'recruiter', 'admin'];
    if (!newRole || !validRoles.includes(newRole)) {
      return res.status(400).json({ error: 'Invalid role specified' });
    }

    // Prevent admin from changing their own role or demoting the last admin
    if (parseInt(userId) === req.user.id && newRole !== 'admin') {
      const adminCount = await dbGet(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`);
      if (adminCount.count <= 1) {
        return res.status(403).json({ error: 'Cannot demote the last admin account' });
      }
    }

    await dbRun(`UPDATE users SET role = ? WHERE id = ?`, [newRole, userId]);

    // If changing to recruiter, ensure a subscription entry exists
    if (newRole === 'recruiter') {
      const existingSubscription = await dbGet(`SELECT id FROM subscriptions WHERE recruiter_id = ?`, [userId]);
      if (!existingSubscription) {
        await dbRun(`INSERT INTO subscriptions (recruiter_id, plan_type) VALUES (?, ?)`, [userId, 'free']);
      }
    }

    res.json({ success: true, message: `User role updated to ${newRole}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete user (admin)
router.delete('/users/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent admin from deleting their own account
    if (parseInt(userId) === req.user.id) {
      return res.status(403).json({ error: 'Cannot delete your own admin account' });
    }

    await deleteUserCascade(userId);

    res.json({ success: true, message: 'User and all associated data deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Bulk delete users (admin)
router.post('/users/bulk-delete', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) {
      return res.status(400).json({ error: 'No user IDs provided' });
    }

    // Filter out the current admin's ID to prevent self-deletion
    const filteredIds = userIds.filter(id => parseInt(id) !== req.user.id);

    for (const id of filteredIds) {
      await deleteUserCascade(id);
    }
    res.json({ success: true, message: `${filteredIds.length} users deleted.` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get pending recruiters
router.get('/pending-recruiters', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const recruiters = await dbAll(
      `SELECT id, email, name, company_name, company_url, status, created_at
       FROM users WHERE role = 'recruiter' AND status = 'pending' ORDER BY created_at DESC`,
      []
    );

    res.json(recruiters);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Approve recruiter
router.post('/approve-recruiter/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const recruiter = await dbGet(
      `SELECT * FROM users WHERE id = ? AND role = 'recruiter'`,
      [req.params.id]
    );

    if (!recruiter) {
      return res.status(404).json({ error: 'Recruiter not found' });
    }

    await dbRun(
      `UPDATE users SET status = 'approved', verified_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.params.id]
    );

    res.json({ message: 'Recruiter approved' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reject recruiter
router.post('/reject-recruiter/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await dbRun(
      `UPDATE users SET status = 'rejected' WHERE id = ? AND role = 'recruiter'`,
      [req.params.id]
    );

    res.json({ message: 'Recruiter rejected' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get pending jobs
router.get('/pending-jobs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const jobs = await dbAll(
      `SELECT j.*, u.company_name, u.email as recruiter_email, u.name as recruiter_name
       FROM jobs j
       JOIN users u ON j.recruiter_id = u.id
       WHERE j.status = 'pending'
       ORDER BY j.created_at DESC`,
      []
    );

    const formattedJobs = jobs.map(job => ({
      ...job,
      requirements: JSON.parse(job.requirements),
    }));

    res.json(formattedJobs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Approve job
router.post('/approve-job/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const job = await dbGet(
      `SELECT * FROM jobs WHERE id = ? AND status = 'pending'`,
      [req.params.id]
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found or already approved' });
    }

    await dbRun(
      `UPDATE jobs SET status = 'approved' WHERE id = ?`,
      [req.params.id]
    );

    res.json({ message: 'Job approved' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reject job
router.post('/reject-job/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await dbRun(
      `UPDATE jobs SET status = 'rejected' WHERE id = ?`,
      [req.params.id]
    );

    res.json({ message: 'Job rejected' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Save a manually entered or URL-imported opportunity for admin review.
router.post('/opportunities/manual', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.organization || !body.location || !body.description) {
      return res.status(400).json({ error: 'Title, organization, location, and description are required.' });
    }

    const duplicates = await findOpportunityDuplicates(body);
    if (duplicates.length && !body.overrideDuplicate) {
      return res.status(409).json({ error: 'Possible duplicate opportunity found.', duplicates });
    }

    const recruiterId = await getImporterRecruiterId();
    const apply = applicationFields(body);
    const status = dbStatus(body.status);
    const category = IMPORT_CATEGORIES.has(body.category) ? body.category : 'Jobs';

    const result = await dbRun(
      `INSERT INTO jobs (
         recruiter_id, title, location, description, requirements, job_type, deadline, status,
         application_method, application_url, application_email, application_whatsapp,
         category, source_url, source_name, source_type, imported_from_url, is_verified,
         date_discovered, company_external
       )
       VALUES (?, ?, ?, ?, ?, 'Full-time', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [
        recruiterId,
        cleanText(body.title),
        cleanText(body.location),
        cleanText(body.description),
        JSON.stringify(parseRequirements(body.requirements)),
        body.deadline || null,
        status,
        apply.application_method,
        apply.application_url,
        apply.application_email,
        apply.application_whatsapp,
        category,
        body.source_url || null,
        body.source_name || body.organization,
        body.source_type || null,
        1,
        body.is_verified ? 1 : 0,
        cleanText(body.organization),
      ]
    );

    res.json({
      success: true,
      id: result.lastID,
      status: status === 'pending' ? 'pending_review' : status,
      duplicates,
      message: status === 'approved' ? 'Opportunity approved and published.' : 'Opportunity saved for review.',
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/opportunities/import-url', authMiddleware, adminMiddleware, async (req, res) => {
  const sourceUrl = req.body?.source_url || req.body?.url;
  if (!sourceUrl || !isAllowedImportUrl(sourceUrl)) {
    return res.status(400).json({ error: 'A valid http(s) Source URL is required.' });
  }

  try {
    const response = await axios.get(sourceUrl, {
      timeout: 12000,
      maxRedirects: 3,
      maxContentLength: 1200000,
      headers: {
        'User-Agent': 'HireKeAdminImporter/1.0 (+https://hireke.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
      responseType: 'text',
    });

    const extracted = extractOpportunity(response.data, sourceUrl);
    const duplicates = await findOpportunityDuplicates(extracted);
    await logImport({ sourceUrl, status: 'extracted', extracted, userId: req.user.id });
    await dbRun(`UPDATE sources SET last_imported_at = CURRENT_TIMESTAMP WHERE LOWER(url) = LOWER(?)`, [sourceUrl]);

    res.json({
      success: true,
      extracted,
      duplicates,
      message: extracted.title ? 'Opportunity details extracted.' : 'Source opened. Complete the missing fields before saving.',
    });
  } catch (error) {
    const fallback = { source_url: sourceUrl, source_name: new URL(sourceUrl).hostname.replace(/^www\./, ''), application_url: sourceUrl };
    await logImport({ sourceUrl, status: 'failed', extracted: fallback, error: error.message, userId: req.user.id }).catch(() => {});
    res.json({
      success: false,
      extracted: fallback,
      duplicates: [],
      error: 'Could not extract the page automatically. Complete the form manually.',
    });
  }
});

router.get('/opportunities/pending', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const rows = await dbAll(
      `SELECT j.*, COALESCE(j.company_external, j.source_name, u.company_name, u.name) as organization
       FROM jobs j
       JOIN users u ON u.id = j.recruiter_id
       WHERE (j.imported_from_url = 1 OR j.source_url IS NOT NULL)
         AND j.archived_at IS NULL AND j.deleted_at IS NULL
       ORDER BY
         CASE WHEN j.status = 'pending' THEN 0 WHEN j.status = 'approved' THEN 1 ELSE 2 END,
         j.created_at DESC`,
      []
    );
    res.json(rows.map((row) => ({
      ...row,
      status: apiStatus(row),
      requirements: parseRequirements(row.requirements),
    })));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/opportunities/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const existing = await dbGet(`SELECT id FROM jobs WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Opportunity not found.' });

    const duplicates = await findOpportunityDuplicates(body, req.params.id);
    if (duplicates.length && !body.overrideDuplicate) {
      return res.status(409).json({ error: 'Possible duplicate opportunity found.', duplicates });
    }

    const apply = applicationFields(body);
    await dbRun(
      `UPDATE jobs
       SET title = ?, location = ?, description = ?, requirements = ?, deadline = ?, status = ?,
           application_method = ?, application_url = ?, application_email = ?, application_whatsapp = ?,
           category = ?, source_url = ?, source_name = ?, source_type = ?, is_verified = ?,
           company_external = ?
       WHERE id = ?`,
      [
        cleanText(body.title),
        cleanText(body.location),
        cleanText(body.description),
        JSON.stringify(parseRequirements(body.requirements)),
        body.deadline || null,
        dbStatus(body.status),
        apply.application_method,
        apply.application_url,
        apply.application_email,
        apply.application_whatsapp,
        IMPORT_CATEGORIES.has(body.category) ? body.category : 'Jobs',
        body.source_url || null,
        body.source_name || body.organization || null,
        body.source_type || null,
        body.is_verified ? 1 : 0,
        body.organization || body.source_name || null,
        req.params.id,
      ]
    );

    res.json({ success: true, duplicates, message: 'Opportunity updated.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/opportunities/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await dbRun(`UPDATE jobs SET status = 'approved', duplicate_of_id = NULL WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Opportunity approved and published.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/opportunities/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await dbRun(`UPDATE jobs SET status = 'rejected' WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Opportunity rejected.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/opportunities/:id/duplicate', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await dbRun(
      `UPDATE jobs SET status = 'rejected', duplicate_of_id = COALESCE(?, duplicate_of_id, id) WHERE id = ?`,
      [req.body?.duplicate_of_id || null, req.params.id]
    );
    res.json({ success: true, message: 'Opportunity marked as duplicate.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/opportunities/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const job = await dbGet(`SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Opportunity not found.' });

    const applicationCount = await dbGet(`SELECT COUNT(*) as count FROM applications WHERE job_id = ?`, [job.id]);
    if (Number(applicationCount?.count || 0) > 0 || job.status === 'approved') {
      await dbRun(`UPDATE jobs SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [job.id]);
      return res.json({ success: true, archived: true, message: 'Opportunity archived and removed from public listings.' });
    }

    await dbRun(`DELETE FROM application_events WHERE job_id = ?`, [job.id]);
    await dbRun(`DELETE FROM jobs WHERE id = ?`, [job.id]);
    res.json({ success: true, deleted: true, message: 'Opportunity deleted.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/opportunities/:id/archive', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const job = await dbGet(`SELECT id FROM jobs WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Opportunity not found.' });
    await dbRun(`UPDATE jobs SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [job.id]);
    res.json({ success: true, message: 'Opportunity archived and removed from public listings.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/sources', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const sources = await dbAll(`SELECT * FROM sources ORDER BY is_active DESC, created_at DESC`, []);
    res.json(sources);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/sources', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, url, type, category, is_active } = req.body || {};
    if (!name || !url || !isAllowedImportUrl(url)) {
      return res.status(400).json({ error: 'Source name and a valid http(s) URL are required.' });
    }

    const result = await dbRun(
      `INSERT INTO sources (name, url, type, category, is_active) VALUES (?, ?, ?, ?, ?)`,
      [cleanText(name), url, type || null, category || null, is_active === false ? 0 : 1]
    );
    res.json({ success: true, id: result.lastID, message: 'Trusted source saved.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all jobs (for admin overview)
router.get('/jobs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const jobs = await dbAll(
      `SELECT j.*, u.company_name
       FROM jobs j
       JOIN users u ON j.recruiter_id = u.id
       WHERE j.deleted_at IS NULL
       ORDER BY j.created_at DESC`,
      []
    );

    res.json(jobs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all pending M-Pesa payments
router.get('/pending-payments', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const payments = await dbAll(
      `SELECT p.*, u.name as recruiter_name, u.email as recruiter_email 
       FROM payments p 
       JOIN users u ON p.recruiter_id = u.id 
       WHERE p.status = 'pending' 
       ORDER BY p.created_at DESC`,
      []
    );
    res.json(payments);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get payments statement with date range for export
router.get('/payments/statement', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let sql = `
      SELECT p.created_at, u.name as recruiter_name, u.email as recruiter_email, 
             p.package_name, p.amount, p.transaction_id, p.status
      FROM payments p 
      JOIN users u ON p.recruiter_id = u.id 
      WHERE 1=1
    `;
    const params = [];
    if (startDate) {
      sql += ` AND p.created_at >= ?`;
      params.push(startDate + ' 00:00:00');
    }
    if (endDate) {
      sql += ` AND p.created_at <= ?`;
      params.push(endDate + ' 23:59:59');
    }
    sql += ` ORDER BY p.created_at DESC`;
    const payments = await dbAll(sql, params);
    res.json(payments);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all successful payments (History)
router.get('/approved-payments', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const payments = await dbAll(
      `SELECT p.*, u.name as recruiter_name, u.email as recruiter_email 
       FROM payments p 
       JOIN users u ON p.recruiter_id = u.id 
       WHERE p.status = 'success' 
       ORDER BY p.created_at DESC`,
      []
    );
    res.json(payments);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/verification-queue', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT vr.*, u.name, u.email, u.role, u.company_name, p.status as payment_status,
              p.transaction_id, p.gateway_reference
       FROM verification_requests vr
       JOIN users u ON u.id = vr.user_id
       LEFT JOIN payments p ON p.id = vr.payment_id
       WHERE vr.status IN ('submitted', 'pending')
       ORDER BY
         CASE vr.plan_code WHEN 'express' THEN 0 WHEN 'premium_monthly' THEN 1 WHEN 'premium_annual' THEN 2 ELSE 3 END,
         vr.submitted_at ASC`,
      []
    );
    res.json(rows);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/jobs/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const job = await dbGet(`SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    const applicationCount = await dbGet(`SELECT COUNT(*) as count FROM applications WHERE job_id = ?`, [job.id]);
    if (Number(applicationCount?.count || 0) > 0 || job.status === 'approved') {
      await dbRun(`UPDATE jobs SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [job.id]);
      return res.json({ success: true, archived: true, message: 'Job archived and removed from public listings.' });
    }

    await dbRun(`DELETE FROM application_events WHERE job_id = ?`, [job.id]);
    await dbRun(`DELETE FROM jobs WHERE id = ?`, [job.id]);
    res.json({ success: true, deleted: true, message: 'Job deleted.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/verification-levels', authMiddleware, adminMiddleware, async (_req, res) => {
  res.json([
    { level: 'L1', label: 'ID Verified', documents: ['National ID/Passport'], priorityRank: 2 },
    { level: 'L2', label: 'Credentials Verified', documents: ['National ID/Passport', 'Certificates', 'References'], priorityRank: 4 },
    { level: 'L3', label: 'Full Trust Badge', documents: ['National ID/Passport', 'Certificates', 'References', 'Work Permit (optional)'], priorityRank: 6 },
  ]);
});

router.get('/verification-renewals', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const renewalCutoff = new Date(Date.now() + 30 * 86400000).toISOString();
    const rows = await dbAll(
      `SELECT uv.*, u.name, u.email
       FROM user_verifications uv
       JOIN users u ON u.id = uv.user_id
       WHERE uv.status IN ('approved', 'expired')
          AND uv.expires_at <= ?
       ORDER BY uv.expires_at ASC`,
      [renewalCutoff]
    );
    res.json(rows);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/verification-requests/:id/documents', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const docs = await dbAll(
      `SELECT * FROM verification_documents WHERE request_id = ? ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    res.json(docs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/verification-requests/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const request = await dbGet(`SELECT * FROM verification_requests WHERE id = ?`, [req.params.id]);
    if (!request) return res.status(404).json({ error: 'Verification request not found' });

    const level = req.body.level || request.level_requested || 'L1';
    const labels = { L1: 'ID Verified', L2: 'Credentials Verified', L3: 'Full Trust Badge' };
    const ranks = { L1: 2, L2: 4, L3: 6 };
    const now = new Date();
    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + 1);

    await dbRun(
      `UPDATE verification_requests
       SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, expires_at = ?
       WHERE id = ?`,
      [req.user.id, expires.toISOString(), request.id]
    );
    await dbRun(
      `INSERT INTO user_verifications (
         user_id, level, badge_label, status, priority_rank, recruiter_visible,
         verified_at, expires_at, renewal_due_at, last_request_id
       )
       VALUES (?, ?, ?, 'approved', ?, 1, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         level = excluded.level,
         badge_label = excluded.badge_label,
         status = 'approved',
         priority_rank = excluded.priority_rank,
         recruiter_visible = 1,
         verified_at = excluded.verified_at,
         expires_at = excluded.expires_at,
         renewal_due_at = excluded.renewal_due_at,
         last_request_id = excluded.last_request_id`,
      [request.user_id, level, labels[level] || labels.L1, ranks[level] || 2, now.toISOString(), expires.toISOString(), expires.toISOString(), request.id]
    );
    await dbRun(
      `UPDATE users SET verification_level = ?, verification_badge = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [level, labels[level] || labels.L1, request.user_id]
    );

    res.json({ success: true, message: 'Verification approved', level });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/verification-requests/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const request = await dbGet(`SELECT * FROM verification_requests WHERE id = ?`, [req.params.id]);
    if (!request) return res.status(404).json({ error: 'Verification request not found' });

    await dbRun(
      `UPDATE verification_requests
       SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, rejection_reason = ?
       WHERE id = ?`,
      [req.user.id, req.body.reason || 'Rejected by admin', request.id]
    );
    await dbRun(
      `INSERT INTO user_verifications (user_id, level, status, priority_rank, recruiter_visible, last_request_id)
       VALUES (?, 'none', 'rejected', 0, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET status = 'rejected', priority_rank = 0, recruiter_visible = 0, last_request_id = excluded.last_request_id`,
      [request.user_id, request.id]
    );
    await dbRun(`UPDATE users SET verification_level = 'none', verification_badge = NULL WHERE id = ?`, [request.user_id]);

    res.json({ success: true, message: 'Verification rejected' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/transactions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT pt.*, p.package_name, p.item_type, p.item_code, u.name as user_name, u.email as user_email
       FROM payment_transactions pt
       LEFT JOIN payments p ON p.id = pt.payment_id
       LEFT JOIN users u ON u.id = pt.user_id
       ORDER BY pt.created_at DESC
       LIMIT 200`,
      []
    );
    res.json(rows);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/subscriptions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT s.*, u.name as recruiter_name, u.email as recruiter_email, u.company_name
       FROM subscriptions s
       JOIN users u ON u.id = s.recruiter_id
       ORDER BY COALESCE(s.renewal_date, s.expiry_date, s.created_at) DESC`,
      []
    );
    res.json(rows);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/refunds', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT p.*, u.name as user_name, u.email as user_email
       FROM payments p
       LEFT JOIN users u ON u.id = COALESCE(p.user_id, p.recruiter_id)
       WHERE p.status IN ('refunded', 'cancelled', 'failed')
       ORDER BY p.updated_at DESC, p.created_at DESC`,
      []
    );
    res.json(rows);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/payments/:id/refund', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const payment = await dbGet(`SELECT * FROM payments WHERE id = ?`, [req.params.id]);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status !== 'success') return res.status(400).json({ error: 'Only successful payments can be marked refunded' });

    await dbRun(`UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [payment.id]);
    await dbRun(`UPDATE invoices SET status = 'refunded' WHERE payment_id = ?`, [payment.id]);
    await logPaymentEvent(payment.id, null, 'refund_marked', 'refunded', req.body.reason || 'Refund marked by admin', {
      adminId: req.user.id,
      reason: req.body.reason || null,
    });

    res.json({ success: true, message: 'Payment marked as refunded' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Approve a manual payment and activate subscription
router.post('/approve-payment/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const payment = await dbGet(`SELECT * FROM payments WHERE id = ?`, [paymentId]);

    if (!payment) return res.status(404).json({ error: 'Payment record not found' });

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    await dbRun(`UPDATE payments SET status = 'success' WHERE id = ?`, [paymentId]);
    await activatePurchase(paymentId);

    // Upsert subscription
    await dbRun(
      `INSERT INTO subscriptions (recruiter_id, plan_type, expiry_date, active)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(recruiter_id) DO UPDATE SET 
       plan_type = excluded.plan_type, 
       expiry_date = excluded.expiry_date,
       active = 1`,
      [payment.recruiter_id, payment.package_name, expiryDate.toISOString()]
    );

    // Auto-approve the recruiter if they were pending
    await dbRun(`UPDATE users SET status = 'approved' WHERE id = ?`, [payment.recruiter_id]);

    res.json({ success: true, message: 'Payment approved and subscription activated' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reject a manual payment
router.post('/reject-payment/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const paymentId = req.params.id;
    // Get info first for email
    const payment = await dbGet(
      `SELECT p.transaction_id, p.package_name, u.email 
       FROM payments p JOIN users u ON p.recruiter_id = u.id 
       WHERE p.id = ?`, [paymentId]
    );

    await dbRun(`UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [paymentId]);

    if (payment) {
      authRoutes.sendPaymentRejectionEmail(payment.email, payment.transaction_id, payment.package_name);
    }

    res.json({ success: true, message: 'Payment rejected' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get platform analytics for admin
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await dbGet(`SELECT COUNT(*) as count FROM users`);
    const totalSeekers = await dbGet(`SELECT COUNT(*) as count FROM users WHERE role = 'jobseeker'`);
    const totalRecruiters = await dbGet(`SELECT COUNT(*) as count FROM users WHERE role = 'recruiter' AND status = 'approved'`);
    const totalJobs = await dbGet(`SELECT COUNT(*) as count FROM jobs WHERE status = 'approved' AND archived_at IS NULL AND deleted_at IS NULL`);
    const revenue = await dbGet(`SELECT SUM(amount) as total FROM payments WHERE status IN ('success', 'completed')`);

    // Get weekly trends for the chart
    const trends = await dbAll(`
      SELECT date(created_at) as day, COUNT(*) as count 
      FROM jobs 
      WHERE status = 'approved' AND archived_at IS NULL AND deleted_at IS NULL AND created_at >= date('now', '-6 days') 
      GROUP BY day 
      ORDER BY day ASC
    `);

    // Get weekly revenue trends
    const revenueTrends = await dbAll(`
      SELECT date(created_at) as day, SUM(amount) as total 
      FROM payments 
      WHERE status IN ('success', 'completed') AND created_at >= date('now', '-6 days') 
      GROUP BY day 
      ORDER BY day ASC
    `);

    // Get last 10 transactions (Success + Failed)
    const recentPayments = await dbAll(`
      SELECT p.*, u.name as recruiter_name 
      FROM payments p 
      JOIN users u ON p.recruiter_id = u.id 
      ORDER BY p.created_at DESC 
      LIMIT 10
    `);

    const revenueBySourceRows = await dbAll(`
      SELECT ${revenueSourceCase()} as source, SUM(amount) as amount
      FROM payments
      WHERE status IN ('success', 'completed')
      GROUP BY source
    `);

    const revenueTotal = revenueBySourceRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const sourceOrder = ['Job Posting', 'Featured Jobs', 'Premium Packages', 'Others'];
    const revenueBySource = sourceOrder.map((source) => {
      const amount = Number(revenueBySourceRows.find((row) => row.source === source)?.amount || 0);
      return {
        source,
        amount,
        percentage: revenueTotal ? Math.round((amount / revenueTotal) * 100) : 0,
      };
    }).filter((row) => row.amount > 0);

    // Get the recruiter with the most approved jobs
    const mostActiveRecruiter = await dbGet(`
      SELECT u.name, COUNT(j.id) as count 
      FROM users u 
      JOIN jobs j ON u.id = j.recruiter_id 
      WHERE j.status = 'approved' AND j.archived_at IS NULL AND j.deleted_at IS NULL
      GROUP BY u.id 
      ORDER BY count DESC 
      LIMIT 1
    `);

    const topRecruiters = await dbAll(`
      SELECT u.id, COALESCE(u.company_name, u.name) as name, COUNT(j.id) as count
      FROM users u
      JOIN jobs j ON u.id = j.recruiter_id
      WHERE u.role = 'recruiter' AND j.status = 'approved' AND j.archived_at IS NULL AND j.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY count DESC
      LIMIT 5
    `);

    const notificationCount = await dbGet(`SELECT COUNT(*) as count FROM notifications WHERE is_read = 0`);
    const verificationCount = await dbGet(`SELECT COUNT(*) as count FROM verification_requests WHERE status IN ('submitted', 'pending')`);
    const messageCount = await dbGet(`SELECT COUNT(*) as count FROM messages WHERE read_at IS NULL`);

    res.json({
      totalUsers: totalUsers.count,
      totalSeekers: totalSeekers.count,
      totalRecruiters: totalRecruiters.count,
      totalJobs: totalJobs.count,
      revenue: revenue.total || 0,
      trends: trends,
      revenueTrends: revenueTrends,
      recentPayments: recentPayments,
      mostActiveRecruiter: mostActiveRecruiter || { name: 'N/A', count: 0 },
      topRecruiters,
      revenueBySource,
      counts: {
        notifications: notificationCount?.count || 0,
        verificationRequests: verificationCount?.count || 0,
        unreadMessages: messageCount?.count || 0,
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update user status (e.g., Suspend/Approve)
router.put('/users/:userId/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body; // 'approved' | 'rejected'
    
    const user = await dbGet(`SELECT email FROM users WHERE id = ?`, [userId]);
    
    await dbRun(`UPDATE users SET status = ? WHERE id = ?`, [status, userId]);

    if (status === 'rejected' && user) {
      authRoutes.sendSuspensionEmail(user.email);
    }

    res.json({ success: true, message: `User status updated to ${status}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
