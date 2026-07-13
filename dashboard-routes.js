const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('./database');

const router = express.Router();

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

function parseRequirements(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function inferCategory(job) {
  if (job.category) return job.category;
  const text = `${job.title || ''} ${job.description || ''} ${job.job_type || ''}`.toLowerCase();
  if (text.includes('intern')) return 'Internships';
  if (text.includes('scholarship')) return 'Scholarships';
  if (text.includes('grant')) return 'Grants';
  if (text.includes('tender') || text.includes('procurement')) return 'Tenders';
  if (text.includes('fellowship')) return 'Fellowships';
  if (text.includes('competition') || text.includes('challenge')) return 'Competitions';
  if (text.includes('training') || text.includes('bootcamp') || text.includes('course')) return 'Training Programs';
  if (text.includes('remote')) return 'Remote Jobs';
  if (text.includes('startup') || text.includes('funding')) return 'Startup Funding';
  return 'Jobs';
}

function formatJob(job) {
  const salary = job.salary_min && job.salary_max
    ? `KES ${Number(job.salary_min).toLocaleString()} - ${Number(job.salary_max).toLocaleString()}`
    : 'Not specified';

  return {
    id: job.id,
    title: job.title,
    company: job.company_external || job.company_name || job.recruiter_email || 'HireKe partner',
    location: job.location || 'Kenya',
    salary,
    description: job.description || '',
    requirements: parseRequirements(job.requirements),
    job_type: job.job_type || 'Full-time',
    category: inferCategory(job),
    deadline: job.deadline,
    featured: Number(job.featured || 0),
    created_at: job.created_at,
    recruiter_email: job.recruiter_email,
    company_logo: job.recruiter_logo,
    recruiter_verification_level: job.recruiter_verification_level,
    recruiter_verification_badge: job.recruiter_verification_badge,
    application_method: job.application_method || 'easy_apply',
    application_url: job.application_url,
    application_email: job.application_email,
    application_whatsapp: job.application_whatsapp,
    source_url: job.source_url,
    source_name: job.source_name,
    is_verified: Number(job.is_verified || 0) === 1,
  };
}

async function getApprovedJobs() {
  const rows = await dbAll(
    `SELECT j.id, j.title, j.location, j.salary_min, j.salary_max, j.description,
            j.requirements, j.job_type, j.deadline, j.featured, j.created_at,
            j.category, j.source_url, j.source_name, j.is_verified, j.company_external,
            j.application_method, j.application_url, j.application_email, j.application_whatsapp,
            COALESCE(u.company_name, u.name) AS company_name,
            u.company_logo AS recruiter_logo,
            u.email AS recruiter_email,
            uv.level AS recruiter_verification_level,
            uv.badge_label AS recruiter_verification_badge
     FROM jobs j
     JOIN users u ON j.recruiter_id = u.id
     LEFT JOIN user_verifications uv ON uv.user_id = u.id AND uv.status = 'approved'
     WHERE j.status = 'approved' AND j.archived_at IS NULL AND j.deleted_at IS NULL
     ORDER BY COALESCE(uv.priority_rank, 0) DESC, j.featured DESC, j.created_at DESC`,
    []
  );

  return rows.map(formatJob);
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const deadline = new Date(dateValue);
  if (Number.isNaN(deadline.getTime())) return null;
  return Math.ceil((deadline.getTime() - Date.now()) / 86400000);
}

function buildCategoryStats(jobs) {
  const categories = [
    'Jobs',
    'Internships',
    'Scholarships',
    'Grants',
    'Tenders',
    'Fellowships',
    'Competitions',
    'Training Programs',
    'Remote Jobs',
    'Startup Funding',
  ];

  return categories.map((name) => ({
    name,
    count: jobs.filter((job) => job.category === name).length,
  }));
}

function publicPayload(jobs) {
  const newOpportunities = [...jobs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const trending = [...jobs].sort((a, b) => Number(b.featured || 0) - Number(a.featured || 0));
  const expiringSoon = jobs
    .map((job) => ({ ...job, days_until_deadline: daysUntil(job.deadline) }))
    .filter((job) => job.days_until_deadline !== null && job.days_until_deadline >= 0)
    .sort((a, b) => a.days_until_deadline - b.days_until_deadline);

  return {
    opportunities: jobs,
    recommended: jobs.slice(0, 6),
    newOpportunities: newOpportunities.slice(0, 8),
    trending: trending.slice(0, 8),
    expiringSoon: expiringSoon.slice(0, 8),
    categories: buildCategoryStats(jobs),
    recentAlerts: expiringSoon.slice(0, 5).map((job) => ({
      id: `deadline-${job.id}`,
      message: `${job.title} closes ${job.days_until_deadline === 0 ? 'today' : `in ${job.days_until_deadline} day${job.days_until_deadline === 1 ? '' : 's'}`}`,
      created_at: job.deadline,
      type: 'deadline',
    })),
  };
}

async function optionalUser(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return await dbGet(
      `SELECT id, email, name, role, avatar_url, profile_completion, email_verified FROM users WHERE id = ?`,
      [decoded.id]
    );
  } catch (_) {
    return null;
  }
}

router.get('/public', async (req, res) => {
  try {
    const jobs = await getApprovedJobs();
    res.json(publicPayload(jobs));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/me', async (req, res) => {
  try {
    const user = await optionalUser(req);
    if (!user) return res.status(401).json({ error: 'No token provided' });
    if (user.email_verified !== 1) {
      return res.status(403).json({
        error: 'Email verification required',
        unverified: true,
        email: user.email,
      });
    }

    const applications = await dbAll(
      `SELECT a.*, j.title, COALESCE(u.company_name, u.name) AS company,
              uv.level as verification_level, uv.badge_label as verification_badge
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       JOIN users u ON j.recruiter_id = u.id
       LEFT JOIN user_verifications uv ON uv.user_id = a.user_id AND uv.status = 'approved'
       WHERE a.applicant_email = ?
       ORDER BY a.applied_at DESC`,
      [user.email]
    );

    const notifications = await dbAll(
      `SELECT id, message, is_read, created_at FROM notifications
       WHERE user_email = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [user.email]
    );

    const analytics = await dbGet(
      `SELECT applications, interviews, offers FROM profile_analytics WHERE user_id = ?`,
      [user.id]
    );

    const savedRows = await dbAll(
      `SELECT job_id FROM saved_opportunities WHERE user_id = ? ORDER BY created_at DESC`,
      [user.id]
    );

    res.json({
      user,
      profileStrength: Number(user.profile_completion || 0),
      applications,
      notifications,
      savedOpportunityIds: savedRows.map((row) => row.job_id),
      analytics: {
        applications: applications.length || Number(analytics?.applications || 0),
        responses: applications.filter((app) => app.status && app.status !== 'Applied').length,
        interviews: Number(analytics?.interviews || 0),
        offers: Number(analytics?.offers || 0),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/opportunities', async (req, res) => {
  try {
    const jobs = await getApprovedJobs();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const jobs = await getApprovedJobs();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/opportunities/recommended', async (req, res) => {
  try {
    const jobs = await getApprovedJobs();
    res.json(jobs.slice(0, 8));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/recommended', async (req, res) => {
  try {
    const jobs = await getApprovedJobs();
    res.json(jobs.slice(0, 8));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/opportunities/trending', async (req, res) => {
  try {
    const jobs = await getApprovedJobs();
    res.json([...jobs].sort((a, b) => Number(b.featured || 0) - Number(a.featured || 0)).slice(0, 8));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/trending', async (req, res) => {
  try {
    const jobs = await getApprovedJobs();
    res.json([...jobs].sort((a, b) => Number(b.featured || 0) - Number(a.featured || 0)).slice(0, 8));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/opportunities/expiring-soon', async (req, res) => {
  try {
    const jobs = publicPayload(await getApprovedJobs()).expiringSoon;
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/expiring-soon', async (req, res) => {
  try {
    const jobs = publicPayload(await getApprovedJobs()).expiringSoon;
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/categories/stats', async (req, res) => {
  try {
    res.json(buildCategoryStats(await getApprovedJobs()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    res.json(buildCategoryStats(await getApprovedJobs()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
