const express = require('express');
const db = require('./database');
const { authMiddleware, adminMiddleware } = require('./auth-middleware');
const { CONSENT_TYPES, POLICY_VERSION, listPolicies, getPolicy } = require('./legal-content');

const router = express.Router();

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  }));

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

function cleanText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function boolValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

async function recordConsent(userId, consentType, accepted, sourceContext = 'account_settings', policyVersion = POLICY_VERSION) {
  await dbRun(
    `INSERT INTO user_consents (user_id, consent_type, accepted, policy_version, source_context, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [userId, consentType, accepted ? 1 : 0, policyVersion, sourceContext]
  );
}

async function latestConsentMap(userId) {
  const rows = await dbAll(
    `SELECT * FROM user_consents WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  const map = {};
  for (const row of rows) {
    if (!map[row.consent_type]) map[row.consent_type] = row;
  }
  return map;
}

function publicUserFields(row) {
  return {
    recruiterProfileVisible: row?.recruiter_profile_visible === 1,
    aiMatchingEnabled: row?.ai_matching_enabled !== 0,
    cvProcessingConsent: row?.cv_processing_consent === 1,
    termsPolicyVersion: row?.terms_policy_version || null,
    privacyPolicyVersion: row?.privacy_policy_version || null,
    termsAcceptedAt: row?.terms_accepted_at || null,
    privacyAcknowledgedAt: row?.privacy_acknowledged_at || null,
  };
}

router.get('/policies', (_req, res) => {
  res.json({ policies: listPolicies() });
});

router.get('/policies/:slug', (req, res) => {
  const policy = getPolicy(req.params.slug);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });
  res.json({ policy });
});

router.get('/consents/me', authMiddleware, async (req, res) => {
  try {
    const user = await dbGet(
      `SELECT recruiter_profile_visible, ai_matching_enabled, cv_processing_consent,
              terms_policy_version, privacy_policy_version, terms_accepted_at, privacy_acknowledged_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    const latest = await latestConsentMap(req.user.id);
    res.json({
      policyVersion: POLICY_VERSION,
      preferences: publicUserFields(user),
      latestConsents: latest,
      consentTypes: CONSENT_TYPES,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/consents/me', authMiddleware, async (req, res) => {
  try {
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'recruiterProfileVisible')) {
      updates.recruiterProfileVisible = boolValue(req.body.recruiterProfileVisible);
      await recordConsent(req.user.id, CONSENT_TYPES.recruiterVisibility, updates.recruiterProfileVisible);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'aiMatchingEnabled')) {
      updates.aiMatchingEnabled = boolValue(req.body.aiMatchingEnabled);
      await recordConsent(req.user.id, CONSENT_TYPES.ai, updates.aiMatchingEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'cvProcessingConsent')) {
      updates.cvProcessingConsent = boolValue(req.body.cvProcessingConsent);
      await recordConsent(req.user.id, CONSENT_TYPES.cv, updates.cvProcessingConsent);
    }

    await dbRun(
      `UPDATE users
       SET recruiter_profile_visible = COALESCE(?, recruiter_profile_visible),
           ai_matching_enabled = COALESCE(?, ai_matching_enabled),
           cv_processing_consent = COALESCE(?, cv_processing_consent)
       WHERE id = ?`,
      [
        Object.prototype.hasOwnProperty.call(updates, 'recruiterProfileVisible') ? (updates.recruiterProfileVisible ? 1 : 0) : null,
        Object.prototype.hasOwnProperty.call(updates, 'aiMatchingEnabled') ? (updates.aiMatchingEnabled ? 1 : 0) : null,
        Object.prototype.hasOwnProperty.call(updates, 'cvProcessingConsent') ? (updates.cvProcessingConsent ? 1 : 0) : null,
        req.user.id,
      ]
    );

    const user = await dbGet(
      `SELECT recruiter_profile_visible, ai_matching_enabled, cv_processing_consent,
              terms_policy_version, privacy_policy_version, terms_accepted_at, privacy_acknowledged_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    res.json({ success: true, preferences: publicUserFields(user) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/data-export/me', authMiddleware, async (req, res) => {
  try {
    const [user, education, experience, applications, files] = await Promise.all([
      dbGet(`SELECT id, email, name, phone_number, role, company_name, headline, location, about, skills, education, experience, certifications, career_goals, cv_url, created_at FROM users WHERE id = ?`, [req.user.id]),
      dbAll(`SELECT * FROM profile_education WHERE user_id = ?`, [req.user.id]),
      dbAll(`SELECT * FROM profile_experience WHERE user_id = ?`, [req.user.id]),
      dbAll(`SELECT id, job_id, applicant_email, applicant_name, status, application_method, applied_at FROM applications WHERE user_id = ? OR applicant_email = ?`, [req.user.id, req.user.email]),
      dbAll(`SELECT file_type, provider, bucket, original_name, mime_type, size, created_at FROM user_files WHERE user_id = ?`, [req.user.id]),
    ]);
    res.json({ generatedAt: new Date().toISOString(), user, education, experience, applications, files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/data-deletion-requests', authMiddleware, async (req, res) => {
  try {
    const details = cleanText(req.body.details, 2000);
    const requestType = cleanText(req.body.requestType || 'account_closure', 80);
    const result = await dbRun(
      `INSERT INTO data_deletion_requests (user_id, request_type, status, details, updated_at)
       VALUES (?, ?, 'submitted', ?, CURRENT_TIMESTAMP)`,
      [req.user.id, requestType, details]
    );
    res.status(201).json({ success: true, requestId: result.lastID, status: 'submitted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/complaints', async (req, res) => {
  try {
    const email = cleanText(req.body.email, 254);
    const subject = cleanText(req.body.subject, 200);
    const message = cleanText(req.body.message, 5000);
    const category = cleanText(req.body.category || 'general', 80);
    if (!email || !subject || message.length < 10) {
      return res.status(400).json({ error: 'Email, subject, and a meaningful message are required.' });
    }
    const result = await dbRun(
      `INSERT INTO complaint_reports (user_id, category, name, email, subject, message, related_url, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', CURRENT_TIMESTAMP)`,
      [
        null,
        category,
        cleanText(req.body.name, 160),
        email,
        subject,
        message,
        cleanText(req.body.relatedUrl, 1000),
      ]
    );
    res.status(201).json({ success: true, complaintId: result.lastID, status: 'submitted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/admin/policy-versions', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    res.json(await dbAll(`SELECT * FROM policy_versions ORDER BY slug, effective_date DESC`));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/admin/complaints', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    res.json(await dbAll(`SELECT id, user_id, category, name, email, subject, status, created_at, updated_at, reviewed_at, resolution_note FROM complaint_reports ORDER BY created_at DESC LIMIT 200`));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/admin/complaints/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const status = cleanText(req.body.status || 'reviewed', 40);
    const note = cleanText(req.body.resolutionNote, 2000);
    await dbRun(
      `UPDATE complaint_reports SET status = ?, resolution_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, note, req.user.id, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/admin/deletion-requests', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    res.json(await dbAll(
      `SELECT d.id, d.user_id, u.email, u.name, d.request_type, d.status, d.details, d.created_at, d.updated_at, d.reviewed_at, d.resolution_note
       FROM data_deletion_requests d
       LEFT JOIN users u ON u.id = d.user_id
       ORDER BY d.created_at DESC LIMIT 200`
    ));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/admin/deletion-requests/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const status = cleanText(req.body.status || 'reviewed', 40);
    const note = cleanText(req.body.resolutionNote, 2000);
    await dbRun(
      `UPDATE data_deletion_requests SET status = ?, resolution_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, note, req.user.id, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/admin/consent-stats', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const rows = await dbAll(
      `SELECT consent_type, accepted, COUNT(*) as count
       FROM user_consents
       GROUP BY consent_type, accepted
       ORDER BY consent_type, accepted DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = {
  router,
  recordConsent,
  boolValue,
};
