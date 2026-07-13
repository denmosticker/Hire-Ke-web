const express = require('express');
const router = express.Router();
const db = require('./database');
const { authMiddleware, recruiterMiddleware } = require('./auth-middleware');
const aiRoutes = require('./ai-routes');
const aiMatchService = require('./services/aiMatchService');

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

function safeParseJSONArray(value) {
  try {
    if (value == null || value === '') return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

const APPLICATION_METHODS = ['easy_apply', 'external_website', 'email', 'whatsapp'];

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function validateApplicationMethod(body) {
  const application_method = body.application_method || 'easy_apply';
  if (!APPLICATION_METHODS.includes(application_method)) {
    return { error: 'Invalid application method' };
  }
  if (application_method === 'external_website' && !body.application_url) {
    return { error: 'Official application URL is required' };
  }
  if (application_method === 'email' && !body.application_email) {
    return { error: 'Application email address is required' };
  }
  if (application_method === 'whatsapp' && !body.application_whatsapp) {
    return { error: 'Application WhatsApp number is required' };
  }
  return {
    application_method,
    application_url: application_method === 'external_website' ? body.application_url : null,
    application_email: application_method === 'email' ? body.application_email : null,
    application_whatsapp: application_method === 'whatsapp' ? normalizePhone(body.application_whatsapp) : null,
  };
}

// Post a new job (recruiter only)
router.post('/', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const { title, location, salary_min, salary_max, description, requirements, job_type, deadline } = req.body;
    const recruiter_id = req.user.id;
    const applyConfig = validateApplicationMethod(req.body);

    if (!title || !location || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (applyConfig.error) {
      return res.status(400).json({ error: applyConfig.error });
    }

    const subscription = await dbGet(`SELECT * FROM subscriptions WHERE recruiter_id = ? AND active = 1`, [recruiter_id]);
    const jobLimit = Number(subscription?.job_limit || 0);
    if (jobLimit > 0) {
      const currentJobs = await dbGet(
        `SELECT COUNT(*) as count FROM jobs WHERE recruiter_id = ? AND status IN ('pending', 'approved') AND archived_at IS NULL AND deleted_at IS NULL`,
        [recruiter_id]
      );
      if (Number(currentJobs?.count || 0) >= jobLimit) {
        return res.status(403).json({ error: `Your current plan allows ${jobLimit} active job posts. Upgrade to post more.` });
      }
    }

    // Check recruiter status for auto-approval
    const recruiter = await dbGet(`SELECT status FROM users WHERE id = ?`, [recruiter_id]);
    const jobStatus = recruiter?.status === 'approved' ? 'approved' : 'pending';
    const previousJobs = await dbGet(`SELECT COUNT(*) as count FROM jobs WHERE recruiter_id = ?`, [recruiter_id]);
    const isFirstRecruiterJob = Number(previousJobs?.count || 0) === 0;
    const freeFeaturedGrant = isFirstRecruiterJob ? 1 : 0;

    const result = await dbRun(
      `INSERT INTO jobs (
         recruiter_id, title, location, salary_min, salary_max, description, requirements,
         job_type, deadline, status, featured, free_featured_grant,
         application_method, application_url, application_email, application_whatsapp
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recruiter_id,
        title,
        location,
        salary_min || null,
        salary_max || null,
        description,
        JSON.stringify(requirements || []),
        job_type || 'Full-time',
        deadline || null,
        jobStatus,
        freeFeaturedGrant,
        freeFeaturedGrant,
        applyConfig.application_method,
        applyConfig.application_url,
        applyConfig.application_email,
        applyConfig.application_whatsapp,
      ]
    );

    try {
      await aiRoutes.ensureOpportunityEmbedding(result.lastID);
    } catch (error) {
      console.error('AI opportunity embedding refresh failed:', error.message);
    }

    const featureMessage = freeFeaturedGrant ? ' Your first job has been featured for free.' : '';
    const message = `${jobStatus === 'approved' ? 'Job posted and approved.' : 'Job posted. Awaiting admin approval.'}${featureMessage}`;
    res.json({ id: result.lastID, status: jobStatus, featured: freeFeaturedGrant, freeFeaturedGrant: Boolean(freeFeaturedGrant), message });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Record a job application
router.post('/:id/apply', authMiddleware, async (req, res) => {
  try {
    const job_id = req.params.id;
    const { email, id } = req.user;
    const { cv_score, cv_url, documents, application_answers } = req.body;

    const job = await dbGet(
      `SELECT * FROM jobs
       WHERE id = ? AND status = 'approved' AND archived_at IS NULL AND deleted_at IS NULL`,
      [job_id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if ((job.application_method || 'easy_apply') !== 'easy_apply') {
      return res.status(400).json({ error: 'This opportunity uses an external application method' });
    }

    // Get applicant name from database
    const user = await dbGet(`SELECT name, cv_url FROM users WHERE id = ?`, [id]);
    const name = user?.name || email.split('@')[0];

    // Check for duplicate application
    const existing = await dbGet(
      `SELECT id FROM applications WHERE job_id = ? AND applicant_email = ?`,
      [job_id, email]
    );

    if (existing) {
      return res.status(400).json({ error: 'Already applied' });
    }

    let aiScore = null;
    let aiReasons = null;
    try {
      const match = await aiRoutes.calculateCandidateOpportunityMatch(id, job_id, id);
      aiScore = match.score.score;
      aiReasons = aiMatchService.explainMatch(match.candidate, match.opportunity, match.score);
    } catch (error) {
      console.error('AI application match failed:', error.message);
    }

    await dbRun(
      `INSERT INTO applications (job_id, user_id, applicant_email, applicant_name, cv_score, status, application_method, cv_url, documents, application_answers)
       VALUES (?, ?, ?, ?, ?, 'Submitted', 'easy_apply', ?, ?, ?)`,
      [
        job_id,
        id,
        email,
        name,
        cv_score || 0,
        cv_url || user?.cv_url || null,
        JSON.stringify(documents || []),
        JSON.stringify(application_answers || []),
      ]
    );
    if (aiScore !== null) {
      await dbRun(
        `UPDATE applications
         SET ai_match_score = ?, ai_match_reasons = ?
         WHERE job_id = ? AND user_id = ?`,
        [aiScore, JSON.stringify(aiReasons || []), job_id, id]
      );
    }
    await dbRun(
      `INSERT INTO application_events (job_id, user_id, applicant_email, application_method, event_type)
       VALUES (?, ?, ?, 'easy_apply', 'submitted')`,
      [job_id, id, email]
    );

    res.json({ success: true, message: 'Application recorded' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Track starts for external, email, and WhatsApp application methods.
router.post('/:id/application-start', authMiddleware, async (req, res) => {
  try {
    const job_id = req.params.id;
    const { email, id } = req.user;
    const job = await dbGet(
      `SELECT id, title, application_method FROM jobs
       WHERE id = ? AND status = 'approved' AND archived_at IS NULL AND deleted_at IS NULL`,
      [job_id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const method = job.application_method || 'easy_apply';
    const user = await dbGet(`SELECT name FROM users WHERE id = ?`, [id]);
    const name = user?.name || email.split('@')[0];

    await dbRun(
      `INSERT INTO application_events (job_id, user_id, applicant_email, application_method, event_type)
       VALUES (?, ?, ?, ?, 'started')`,
      [job_id, id, email, method]
    );

    const existing = await dbGet(
      `SELECT id FROM applications WHERE job_id = ? AND applicant_email = ?`,
      [job_id, email]
    );
    if (!existing) {
      await dbRun(
        `INSERT INTO applications (job_id, user_id, applicant_email, applicant_name, status, application_method, started_at)
         VALUES (?, ?, ?, ?, 'Started', ?, CURRENT_TIMESTAMP)`,
        [job_id, id, email, name, method]
      );
    }

    res.json({ success: true, method });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/mark-applied', authMiddleware, async (req, res) => {
  try {
    const job_id = req.params.id;
    const { email, id } = req.user;
    const job = await dbGet(
      `SELECT application_method FROM jobs
       WHERE id = ? AND status = 'approved' AND archived_at IS NULL AND deleted_at IS NULL`,
      [job_id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });

    await dbRun(
      `UPDATE applications
       SET marked_applied = 1, status = CASE WHEN status = 'Started' THEN 'Applied' ELSE status END
       WHERE job_id = ? AND applicant_email = ?`,
      [job_id, email]
    );
    await dbRun(
      `INSERT INTO application_events (job_id, user_id, applicant_email, application_method, event_type)
       VALUES (?, ?, ?, ?, 'marked_applied')`,
      [job_id, id, email, job.application_method || 'easy_apply']
    );

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get current user's applications with status and notes
router.get('/my-applications', authMiddleware, async (req, res) => {
  try {
    const apps = await dbAll(
      `SELECT a.*, j.title, u.company_name as company
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       JOIN users u ON j.recruiter_id = u.id
       WHERE a.applicant_email = ?
       ORDER BY a.applied_at DESC`,
      [req.user.email]
    );

    res.json(apps);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get current user's notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const notifications = await dbAll(
      `SELECT * FROM notifications WHERE user_email = ? ORDER BY created_at DESC LIMIT 20`,
      [req.user.email]
    );
    res.json(notifications);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Mark notifications as read
router.post('/notifications/mark-read', authMiddleware, async (req, res) => {
  try {
    await dbRun(
      `UPDATE notifications SET is_read = 1 WHERE user_email = ?`,
      [req.user.email]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Clear all notifications for current user
router.delete('/notifications/clear', authMiddleware, async (req, res) => {
  try {
    await dbRun(
      `DELETE FROM notifications WHERE user_email = ?`,
      [req.user.email]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all approved companies (recruiters)
router.get('/companies', async (req, res) => {
  try {
    const companies = await dbAll(
      `SELECT id, company_name, company_url, company_logo, email FROM users 
       WHERE role = 'recruiter' AND status = 'approved' AND company_name IS NOT NULL`,
      []
    );
    res.json(companies);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/saved', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT j.*, so.created_at as saved_at,
              COALESCE(j.company_external, u.company_name, u.name) as company_name,
              u.company_logo as recruiter_logo,
              u.email as recruiter_email,
              uv.level as recruiter_verification_level,
              uv.badge_label as recruiter_verification_badge
       FROM saved_opportunities so
       JOIN jobs j ON j.id = so.job_id
       JOIN users u ON j.recruiter_id = u.id
       LEFT JOIN user_verifications uv ON uv.user_id = u.id AND uv.status = 'approved'
       WHERE so.user_id = ?
         AND j.status = 'approved'
         AND j.archived_at IS NULL
         AND j.deleted_at IS NULL
       ORDER BY so.created_at DESC`,
      [req.user.id]
    );

    res.json(rows.map((job) => ({
      ...job,
      company: job.company_name,
      requirements: safeParseJSONArray(job.requirements),
      salary: job.salary_min && job.salary_max
        ? `KES ${Number(job.salary_min).toLocaleString()} - ${Number(job.salary_max).toLocaleString()}`
        : 'Not specified',
    })));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/save', authMiddleware, async (req, res) => {
  try {
    const job = await dbGet(
      `SELECT id FROM jobs WHERE id = ? AND status = 'approved' AND archived_at IS NULL AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Opportunity not found' });

    await dbRun(
      `INSERT OR IGNORE INTO saved_opportunities (user_id, job_id) VALUES (?, ?)`,
      [req.user.id, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id/save', authMiddleware, async (req, res) => {
  try {
    await dbRun(
      `DELETE FROM saved_opportunities WHERE user_id = ? AND job_id = ?`,
      [req.user.id, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all approved jobs (public + featured first)
router.get('/', async (req, res) => {
  try {
    const jobs = await dbAll(
      `SELECT j.*, COALESCE(j.company_external, u.company_name, u.name) as company_name, u.company_logo as recruiter_logo, u.email as recruiter_email,
               s.plan_type, s.active as sub_active,
               uv.level as recruiter_verification_level, uv.badge_label as recruiter_verification_badge
        FROM jobs j
        JOIN users u ON j.recruiter_id = u.id
        LEFT JOIN subscriptions s ON j.recruiter_id = s.recruiter_id
        LEFT JOIN user_verifications uv ON uv.user_id = u.id AND uv.status = 'approved'
        WHERE j.status = 'approved' AND j.archived_at IS NULL AND j.deleted_at IS NULL
        ORDER BY COALESCE(uv.priority_rank, 0) DESC, j.featured DESC, j.created_at DESC`,
      []
    );

const formattedJobs = jobs.map(job => ({
      ...job,
      requirements: safeParseJSONArray(job.requirements),
      salary: job.salary_min && job.salary_max
        ? `KES ${job.salary_min.toLocaleString()} - ${job.salary_max.toLocaleString()}`
        : 'Not specified',
  }));

    res.json(formattedJobs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get recruiter's jobs
router.get('/recruiter/jobs', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const jobs = await dbAll(
      `SELECT * FROM jobs WHERE recruiter_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      [req.user.id]
    );

    const formattedJobs = jobs.map(job => ({
      ...job,
      requirements: safeParseJSONArray(job.requirements),
    }));

    res.json(formattedJobs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get single job
router.get('/:id', async (req, res) => {
  try {
    const job = await dbGet(
      `SELECT j.*, COALESCE(j.company_external, u.company_name, u.name) as company_name, u.email as recruiter_email,
              uv.level as recruiter_verification_level, uv.badge_label as recruiter_verification_badge
       FROM jobs j
       JOIN users u ON j.recruiter_id = u.id
       LEFT JOIN user_verifications uv ON uv.user_id = u.id AND uv.status = 'approved'
       WHERE j.id = ? AND j.status = 'approved' AND j.archived_at IS NULL AND j.deleted_at IS NULL`,
      [req.params.id]
    );

if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

job.requirements = safeParseJSONArray(job.requirements);
    res.json(job);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update job
router.put('/:id', authMiddleware, recruiterMiddleware, async (req, res) => {
  // Only allow updating pending jobs (business rule: admin approves jobs)
  try {
    const { title, description, location, salary_min, salary_max } = req.body;
    const applyConfig = validateApplicationMethod(req.body);
    if (applyConfig.error) {
      return res.status(400).json({ error: applyConfig.error });
    }
const job = await dbGet(
      `SELECT * FROM jobs WHERE id = ? AND recruiter_id = ? AND status = 'pending'`,
      [req.params.id, req.user.id]
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await dbRun(
      `UPDATE jobs
       SET title = ?, description = ?, location = ?, salary_min = ?, salary_max = ?,
           application_method = ?, application_url = ?, application_email = ?, application_whatsapp = ?
       WHERE id = ? AND recruiter_id = ?`,
      [
        title,
        description,
        location,
        salary_min,
        salary_max,
        applyConfig.application_method,
        applyConfig.application_url,
        applyConfig.application_email,
        applyConfig.application_whatsapp,
        req.params.id,
        req.user.id,
      ]
    );

    try {
      await aiRoutes.ensureOpportunityEmbedding(req.params.id);
    } catch (error) {
      console.error('AI opportunity embedding refresh failed:', error.message);
    }

    res.json({ message: 'Job updated' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete job owned by the recruiter, including published/approved jobs.
router.delete('/:id', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const job = await dbGet(
      `SELECT id, status FROM jobs WHERE id = ? AND recruiter_id = ? AND deleted_at IS NULL`,
      [req.params.id, req.user.id]
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const applicationCount = await dbGet(`SELECT COUNT(*) as count FROM applications WHERE job_id = ?`, [job.id]);
    if (Number(applicationCount?.count || 0) > 0 || job.status === 'approved') {
      await dbRun(`UPDATE jobs SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND recruiter_id = ?`, [job.id, req.user.id]);
      return res.json({ message: 'Job archived and removed from public listings', archived: true });
    }

    await dbRun(`DELETE FROM application_events WHERE job_id = ?`, [job.id]);
    await dbRun(`DELETE FROM jobs WHERE id = ? AND recruiter_id = ?`, [job.id, req.user.id]);
    res.json({ message: 'Job deleted', deleted: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
