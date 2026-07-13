const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('./database');
const { authMiddleware, recruiterMiddleware } = require('./auth-middleware');
const authRoutes = require('./auth-routes'); // Import to use email helper

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

function parseJson(value, fallback) {
  try {
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

// Get recruiter dashboard stats
router.get('/dashboard', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const recruiterId = req.user.id;

    // Real Total views from clicks table
    const viewsResult = await dbGet(
      `SELECT COUNT(*) as count FROM clicks c
       JOIN jobs j ON c.element_name = CAST(j.id AS TEXT)
       WHERE j.recruiter_id = ? AND c.element_type = 'job_view'`,
      [recruiterId]
    );
    const totalViews = viewsResult?.count || 0;

    const activeJobsResult = await dbGet(
      `SELECT COUNT(*) as count FROM jobs WHERE recruiter_id = ? AND status = 'approved' AND archived_at IS NULL AND deleted_at IS NULL`,
      [recruiterId]
    );
    const activeJobs = activeJobsResult?.count || 0;

    // Total applicants
    const applicantsResult = await dbAll(
      `SELECT COUNT(*) as count FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE j.recruiter_id = ?`,
      [recruiterId]
    );
    const totalApplicants = applicantsResult[0]?.count || 0;

    const applicationStartsResult = await dbGet(
      `SELECT COUNT(*) as count FROM application_events ae
       JOIN jobs j ON ae.job_id = j.id
       WHERE j.recruiter_id = ? AND ae.event_type IN ('started', 'submitted', 'marked_applied')`,
      [recruiterId]
    );

    // Shortlisted (using manual status)
    const shortlistedResult = await dbAll(
      `SELECT COUNT(*) as count FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE j.recruiter_id = ? AND a.status = 'Shortlisted'`,
      [recruiterId]
    );
    const shortlisted = shortlistedResult[0]?.count || 0;

    // Hired (using manual status)
    const hiredResult = await dbAll(
      `SELECT COUNT(*) as count FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE j.recruiter_id = ? AND a.status IN ('Hired', 'Offered')`,
      [recruiterId]
    );
    const hired = hiredResult[0]?.count || 0;

    const pipelineRows = await dbAll(
      `SELECT a.status, COUNT(*) as count
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE j.recruiter_id = ? AND j.deleted_at IS NULL
       GROUP BY a.status`,
      [recruiterId]
    );

    const methodRows = await dbAll(
      `SELECT COALESCE(a.application_method, j.application_method, 'easy_apply') as method, COUNT(*) as count
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE j.recruiter_id = ?
       GROUP BY method`,
      [recruiterId]
    );

    const recentApplications = await dbAll(
      `SELECT a.id, a.applicant_name, a.applicant_email, a.cv_score, a.status, a.application_method,
              a.applied_at, j.title as job_title,
              uv.level as verification_level, uv.badge_label as verification_badge
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       LEFT JOIN user_verifications uv ON uv.user_id = a.user_id AND uv.status = 'approved'
       WHERE j.recruiter_id = ?
       ORDER BY COALESCE(uv.priority_rank, 0) DESC, a.applied_at DESC
       LIMIT 5`,
      [recruiterId]
    );

    const jobPerformance = await dbAll(
      `SELECT j.id, j.title, j.status, j.featured, j.application_method,
              COUNT(a.id) as applications,
              SUM(CASE WHEN a.status = 'Shortlisted' THEN 1 ELSE 0 END) as shortlisted,
              SUM(CASE WHEN a.status IN ('Hired', 'Offered') THEN 1 ELSE 0 END) as hired
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       WHERE j.recruiter_id = ?
       GROUP BY j.id
       ORDER BY j.created_at DESC
       LIMIT 4`,
      [recruiterId]
    );

    // Get subscription info
    const subscription = await dbGet(
      `SELECT * FROM subscriptions WHERE recruiter_id = ?`,
      [recruiterId]
    );

    res.json({
      stats: {
        activeJobs,
        totalViews: totalViews,
        applicants: totalApplicants,
        applicationStarts: applicationStartsResult?.count || 0,
        shortlisted: shortlisted,
        hired: hired,
        saves: 0,
        interviewInvites: pipelineRows.find((row) => ['Interviewing', 'Interview'].includes(row.status))?.count || 0,
        responseRate: totalApplicants ? Math.round((shortlisted / totalApplicants) * 100) : 0,
      },
      pipeline: pipelineRows,
      applicationsByMethod: methodRows,
      recentApplications,
      jobPerformance,
      subscription: subscription || { plan_type: 'free', featured_jobs: 0 },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get recruiter's jobs with applicant count
router.get('/jobs-list', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const recruiterId = req.user.id;

    const jobs = await dbAll(
      `SELECT j.*, COUNT(a.id) as applicant_count
       FROM jobs j
       LEFT JOIN applications a ON j.id = a.job_id
       WHERE j.recruiter_id = ?
       GROUP BY j.id
       ORDER BY j.created_at DESC`,
      [recruiterId]
    );

    const formattedJobs = jobs.map(job => {
      let requirements = [];
      try {
        requirements = JSON.parse(job.requirements || '[]');
      } catch (_) {}
      return { ...job, requirements };
    });

    res.json(formattedJobs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get applicants for a specific job
router.get('/applicants/:jobId', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const recruiterId = req.user.id;
    const jobId = req.params.jobId;

    // Verify ownership
    const job = await dbGet(
      `SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?`,
      [jobId, recruiterId]
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const applicants = await dbAll(
      `SELECT a.*, uv.level as verification_level, uv.badge_label as verification_badge,
              uv.priority_rank as verification_priority
       FROM applications a
       LEFT JOIN user_verifications uv ON uv.user_id = a.user_id AND uv.status = 'approved'
       WHERE a.job_id = ?
       ORDER BY COALESCE(uv.priority_rank, 0) DESC, a.applied_at DESC`,
      [jobId]
    );

    res.json(applicants);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update applicant status and note
router.post('/applications/:applicationId/status', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const recruiterId = req.user.id;
    const { applicationId } = req.params;
    const { status, note } = req.body;

    const validStatuses = ['Started', 'Applied', 'Submitted', 'Viewed', 'Reviewing', 'Shortlisted', 'Interview', 'Interviewing', 'Offered', 'Rejected', 'Hired'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
    }

    // Verify ownership: application belongs to a job posted by this recruiter
    const application = await dbGet(
      `SELECT a.id, a.applicant_email, j.title FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.id = ? AND j.recruiter_id = ?`,
      [applicationId, recruiterId]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found or unauthorized' });
    }

    await dbRun(
      `UPDATE applications SET status = ?, recruiter_note = ? WHERE id = ?`,
      [status, note || null, applicationId]
    );

    // Create in-app notification
    const notificationMsg = `Your application for "${application.title}" was updated to ${status}.`;
    await dbRun(`INSERT INTO notifications (user_email, message) VALUES (?, ?)`, [application.applicant_email, notificationMsg]);

    // Send email alert
    authRoutes.sendStatusUpdateEmail(application.applicant_email, application.title, status, note);

    res.json({ message: 'Application status updated successfully', status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/applications', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT a.id, a.applicant_name, a.applicant_email, a.cv_score, a.status, a.application_method,
              a.applied_at, j.title as job_title, j.id as job_id,
              uv.level as verification_level, uv.badge_label as verification_badge
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       LEFT JOIN user_verifications uv ON uv.user_id = a.user_id AND uv.status = 'approved'
       WHERE j.recruiter_id = ?
       ORDER BY a.applied_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/settings', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const { name, company_name, company_url, company_logo } = req.body;
    await dbRun(
      `UPDATE users
       SET name = COALESCE(NULLIF(?, ''), name),
           company_name = ?,
           company_url = ?,
           company_logo = ?,
           avatar_url = COALESCE(NULLIF(?, ''), avatar_url)
       WHERE id = ?`,
      [name || '', company_name || null, company_url || null, company_logo || null, company_logo || '', req.user.id]
    );
    const user = await dbGet(
      `SELECT id, email, name, role, company_name, company_url, company_logo, avatar_url FROM users WHERE id = ?`,
      [req.user.id]
    );
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// View-only applicant/application detail for jobs owned by this recruiter.
router.get('/applications/:applicationId', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const recruiterId = req.user.id;
    const applicationId = req.params.applicationId;

    const row = await dbGet(
      `SELECT a.*, j.id as job_id, j.title as job_title, j.recruiter_id,
              u.id as applicant_user_id, u.name, u.email, u.username, u.avatar_url, u.cover_banner_url,
              u.headline, u.location, u.about, u.skills, u.education, u.experience,
              u.certifications, u.career_goals, u.cv_url as profile_cv_url,
              uv.level as verification_level, uv.badge_label as verification_badge
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       LEFT JOIN users u ON u.id = a.user_id OR LOWER(u.email) = LOWER(a.applicant_email)
       LEFT JOIN user_verifications uv ON uv.user_id = u.id AND uv.status = 'approved'
       WHERE a.id = ? AND j.recruiter_id = ?`,
      [applicationId, recruiterId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Application not found or forbidden' });
    }

    const userId = row.applicant_user_id;
    const [educationEntries, experienceEntries, notes] = await Promise.all([
      userId ? dbAll(`SELECT * FROM profile_education WHERE user_id = ? ORDER BY COALESCE(year_to, 9999) DESC`, [userId]) : [],
      userId ? dbAll(`SELECT * FROM profile_experience WHERE user_id = ? ORDER BY currently_working DESC, COALESCE(year_to, 9999) DESC`, [userId]) : [],
      dbAll(
        `SELECT rn.id, rn.note, rn.created_at, u.name as author_name
         FROM recruiter_notes rn
         JOIN users u ON u.id = rn.recruiter_id
         WHERE rn.application_id = ? AND rn.recruiter_id = ?
         ORDER BY rn.created_at DESC`,
        [applicationId, recruiterId]
      ),
    ]);

    const submittedDocuments = parseJson(row.documents, []);
    res.json({
      application: {
        id: row.id,
        job_id: row.job_id,
        job_title: row.job_title,
        applicant_name: row.applicant_name,
        applicant_email: row.applicant_email,
        cv_score: row.cv_score,
        status: row.status,
        application_method: row.application_method,
        applied_at: row.applied_at,
        started_at: row.started_at,
        marked_applied: row.marked_applied,
        answers: parseJson(row.application_answers, []),
      },
      applicant: {
        id: row.applicant_user_id,
        name: row.name || row.applicant_name,
        email: row.email || row.applicant_email,
        username: row.username,
        avatar_url: row.avatar_url,
        cover_banner_url: row.cover_banner_url,
        headline: row.headline,
        location: row.location,
        about: row.about,
        skills: parseJson(row.skills, row.skills || ''),
        education: row.education,
        experience: row.experience,
        certifications: row.certifications,
        career_goals: row.career_goals,
        verification_level: row.verification_level,
        verification_badge: row.verification_badge,
        educationEntries,
        experienceEntries,
      },
      submittedDocuments: {
        cv_url: row.cv_url || row.profile_cv_url || null,
        documents: Array.isArray(submittedDocuments) ? submittedDocuments : [],
      },
      notes,
      permissions: { viewOnly: true, canEditApplicant: false },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/applications/:applicationId/notes', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note is required' });
    if (note.length > 2000) return res.status(400).json({ error: 'Note is too long' });

    const application = await dbGet(
      `SELECT a.id FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.id = ? AND j.recruiter_id = ?`,
      [req.params.applicationId, req.user.id]
    );
    if (!application) return res.status(404).json({ error: 'Application not found or forbidden' });

    const result = await dbRun(
      `INSERT INTO recruiter_notes (application_id, recruiter_id, note) VALUES (?, ?, ?)`,
      [application.id, req.user.id, note]
    );
    const saved = await dbGet(
      `SELECT rn.id, rn.note, rn.created_at, u.name as author_name
       FROM recruiter_notes rn JOIN users u ON u.id = rn.recruiter_id
       WHERE rn.id = ?`,
      [result.lastID]
    );
    res.status(201).json({ success: true, note: saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get subscription status
router.get('/subscription', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const subscription = await dbGet(
      `SELECT * FROM subscriptions WHERE recruiter_id = ?`,
      [req.user.id]
    );

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    res.json(subscription);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Toggle featured for a job (requires premium)
router.post('/feature-job/:jobId', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const recruiterId = req.user.id;

    // Check job ownership
    const job = await dbGet(
      `SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?`,
      [jobId, recruiterId]
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const subscription = await dbGet(
      `SELECT * FROM subscriptions WHERE recruiter_id = ? AND active = 1`,
      [recruiterId]
    );

    let addons = {};
    try {
      addons = subscription?.addons ? JSON.parse(subscription.addons) : {};
    } catch (_) {}
    const hasFeaturedAllowance = Number(subscription?.featured_jobs || 0) > 0 || addons.featured_job?.active;
    const isFreeFeaturedGrant = Number(job.free_featured_grant || 0) === 1;
    const isUnfeaturingFreeGrant = isFreeFeaturedGrant && Number(job.featured || 0) === 1;

    if ((!subscription || !hasFeaturedAllowance) && !isUnfeaturingFreeGrant) {
      return res.status(403).json({ error: 'Featured Job add-on or paid recruiter plan required' });
    }

    // Toggle featured
    const newFeaturedStatus = job.featured ? 0 : 1;
    await dbRun(
      `UPDATE jobs SET featured = ? WHERE id = ?`,
      [newFeaturedStatus, jobId]
    );

    res.json({ message: `Job ${newFeaturedStatus ? 'featured' : 'unfeatured'}`, featured: newFeaturedStatus });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Submit Manual M-Pesa Payment (Till 6303759)
router.post('/submit-payment', authMiddleware, recruiterMiddleware, async (req, res) => {
  const { mpesaCode, packageName, amount } = req.body;
  const recruiterId = req.user.id;

  if (!mpesaCode) return res.status(400).json({ error: 'M-Pesa confirmation code is required' });

  try {
    // Check for duplicate code first
    const existing = await dbGet(`SELECT id FROM payments WHERE transaction_id = ?`, [mpesaCode.toUpperCase()]);
    if (existing) {
      return res.status(400).json({ error: 'This M-Pesa transaction code has already been submitted.' });
    }

    // Record the manual payment as 'pending' for admin review
    await dbRun(
      `INSERT INTO payments (recruiter_id, amount, transaction_id, package_name, payment_method, status)
       VALUES (?, ?, ?, ?, 'M-Pesa Till', 'pending')`,
      [recruiterId, amount, mpesaCode.toUpperCase(), packageName]
    );

    res.json({ success: true, message: 'Payment details submitted. Admin will verify shortly.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
