const express = require('express');
const db = require('./database');
const { authMiddleware, adminMiddleware, recruiterMiddleware } = require('./auth-middleware');
const ai = require('./services/aiMatchService');

const router = express.Router();

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  }));

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

function parseEmbedding(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function formatOpportunity(row) {
  return {
    ...row,
    company: row.company_external || row.company_name || row.recruiter_name || 'HireKe partner',
    requirements: parseJsonList(row.requirements),
    salary: row.salary_min && row.salary_max
      ? `KES ${Number(row.salary_min).toLocaleString()} - ${Number(row.salary_max).toLocaleString()}`
      : 'Not specified',
  };
}

async function ensureCandidateEmbedding(userId) {
  const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) throw new Error('User not found');
  if (user.ai_matching_enabled === 0) throw new Error('AI-assisted matching is disabled for this account.');
  const cvText = user.cv_url ? await ai.parseCvFromUrl(user.cv_url) : '';
  const text = ai.buildCandidateProfileText({ ...user, cv_text: cvText });
  if (!text) throw new Error('Add profile details or upload a readable CV before matching.');
  const hash = ai.textHash(text);
  const existing = parseEmbedding(user.ai_embedding);
  if (existing && user.ai_profile_hash === hash) return { user, embedding: existing, text };
  const embedding = await ai.getEmbedding(text);
  await dbRun(
    `UPDATE users
     SET ai_embedding = ?, ai_profile_hash = ?, ai_profile_text = ?, ai_embedding_updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(embedding), hash, text, userId]
  );
  return { user: { ...user, ai_embedding: JSON.stringify(embedding), ai_profile_hash: hash, ai_profile_text: text }, embedding, text };
}

async function ensureOpportunityEmbedding(jobId) {
  const job = await dbGet(
    `SELECT j.*, COALESCE(j.company_external, u.company_name, u.name) as company_name
     FROM jobs j
     JOIN users u ON u.id = j.recruiter_id
     WHERE j.id = ?`,
    [jobId]
  );
  if (!job) throw new Error('Opportunity not found');
  const formatted = formatOpportunity(job);
  const text = ai.buildOpportunityText(formatted);
  if (!text) throw new Error('Opportunity has no readable text to match.');
  const hash = ai.textHash(text);
  const existing = parseEmbedding(job.ai_embedding);
  if (existing && job.ai_opportunity_hash === hash) return { job: formatted, embedding: existing, text };
  const embedding = await ai.getEmbedding(text);
  await dbRun(
    `UPDATE jobs
     SET ai_embedding = ?, ai_opportunity_hash = ?, ai_opportunity_text = ?, ai_embedding_updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(embedding), hash, text, jobId]
  );
  return { job: { ...formatted, ai_embedding: JSON.stringify(embedding), ai_opportunity_hash: hash, ai_opportunity_text: text }, embedding, text };
}

async function saveCandidateMatch(candidate, opportunity, score, actorId) {
  await dbRun(
    `INSERT INTO candidate_opportunity_matches
       (candidate_user_id, opportunity_id, match_score, score_breakdown, match_reasons, missing_skills, strong_matches, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(candidate_user_id, opportunity_id) DO UPDATE SET
       match_score = excluded.match_score,
       score_breakdown = excluded.score_breakdown,
       match_reasons = excluded.match_reasons,
       missing_skills = excluded.missing_skills,
       strong_matches = excluded.strong_matches,
       updated_at = CURRENT_TIMESTAMP`,
    [
      candidate.id,
      opportunity.id,
      score.score,
      JSON.stringify(score.breakdown),
      JSON.stringify(ai.explainMatch(candidate, opportunity, score)),
      JSON.stringify(score.missingSkills),
      JSON.stringify(score.matchedSkills),
    ]
  );
  await dbRun(
    `INSERT INTO ai_match_logs (actor_user_id, candidate_user_id, opportunity_id, action, score, score_breakdown)
     VALUES (?, ?, ?, 'candidate_match', ?, ?)`,
    [actorId || candidate.id, candidate.id, opportunity.id, score.score, JSON.stringify(score.breakdown)]
  );
}

async function saveRecruiterMatch(recruiterId, candidate, opportunity, score) {
  await dbRun(
    `INSERT INTO recruiter_candidate_matches
       (recruiter_id, candidate_user_id, opportunity_id, match_score, score_breakdown, match_reasons, missing_requirements, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(recruiter_id, candidate_user_id, opportunity_id) DO UPDATE SET
       match_score = excluded.match_score,
       score_breakdown = excluded.score_breakdown,
       match_reasons = excluded.match_reasons,
       missing_requirements = excluded.missing_requirements,
       updated_at = CURRENT_TIMESTAMP`,
    [
      recruiterId,
      candidate.id,
      opportunity.id,
      score.score,
      JSON.stringify(score.breakdown),
      JSON.stringify(ai.explainMatch(candidate, opportunity, score)),
      JSON.stringify(score.missingSkills),
    ]
  );
  await dbRun(
    `INSERT INTO ai_match_logs (actor_user_id, candidate_user_id, opportunity_id, action, score, score_breakdown)
     VALUES (?, ?, ?, 'recruiter_match', ?, ?)`,
    [recruiterId, candidate.id, opportunity.id, score.score, JSON.stringify(score.breakdown)]
  );
}

async function calculateCandidateOpportunityMatch(candidateUserId, opportunityId, actorId) {
  const [{ user, embedding: candidateEmbedding }, { job, embedding: opportunityEmbedding }] = await Promise.all([
    ensureCandidateEmbedding(candidateUserId),
    ensureOpportunityEmbedding(opportunityId),
  ]);
  const score = ai.scoreMatch(user, job, candidateEmbedding, opportunityEmbedding);
  await saveCandidateMatch(user, job, score, actorId);
  return { candidate: user, opportunity: job, score };
}

router.get('/job-seeker/matches', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'recruiter') return res.status(403).json({ error: 'Job seeker account required' });
    const preference = await dbGet(`SELECT ai_matching_enabled FROM users WHERE id = ?`, [req.user.id]);
    if (preference?.ai_matching_enabled === 0) {
      return res.status(403).json({ error: 'AI-assisted matching is disabled in your Privacy & Data settings.', disabled: true });
    }
    const { user, embedding: candidateEmbedding } = await ensureCandidateEmbedding(req.user.id);
    const jobs = await dbAll(
      `SELECT j.*, COALESCE(j.company_external, u.company_name, u.name) as company_name, u.name as recruiter_name, u.email as recruiter_email
       FROM jobs j
       JOIN users u ON u.id = j.recruiter_id
       WHERE j.status = 'approved' AND j.archived_at IS NULL AND j.deleted_at IS NULL
       ORDER BY j.created_at DESC
       LIMIT 100`
    );
    const matches = [];
    for (const row of jobs) {
      const { job, embedding } = await ensureOpportunityEmbedding(row.id);
      const score = ai.scoreMatch(user, job, candidateEmbedding, embedding);
      await saveCandidateMatch(user, job, score, req.user.id);
      matches.push({
        opportunityId: job.id,
        id: job.id,
        title: job.title,
        company: job.company,
        opportunityType: job.category || job.job_type || 'Opportunity',
        location: job.location,
        matchScore: score.score,
        matchReasons: ai.explainMatch(user, job, score),
        missingSkills: score.missingSkills,
        strongMatches: score.matchedSkills,
        deadline: job.deadline,
        applyUrl: job.application_url || null,
        status: job.application_method || 'easy_apply',
      });
    }
    res.json(matches.sort((a, b) => b.matchScore - a.matchScore).slice(0, 25));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/job-seeker/opportunities/:id/match', authMiddleware, async (req, res) => {
  try {
    const preference = await dbGet(`SELECT ai_matching_enabled FROM users WHERE id = ?`, [req.user.id]);
    if (preference?.ai_matching_enabled === 0) {
      return res.status(403).json({ error: 'AI-assisted matching is disabled in your Privacy & Data settings.', disabled: true });
    }
    const result = await calculateCandidateOpportunityMatch(req.user.id, req.params.id, req.user.id);
    res.json({
      opportunityId: result.opportunity.id,
      matchScore: result.score.score,
      scoreBreakdown: result.score.breakdown,
      matchReasons: ai.explainMatch(result.candidate, result.opportunity, result.score),
      missingSkills: result.score.missingSkills,
      strongMatches: result.score.matchedSkills,
      improvementTips: result.score.missingSkills.length
        ? result.score.missingSkills.slice(0, 4).map((skill) => `Consider adding evidence for ${skill}.`)
        : ['Keep your profile and CV current for sharper recommendations.'],
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/recruiter/opportunities/:id/matching-candidates', authMiddleware, recruiterMiddleware, async (req, res) => {
  try {
    const job = await dbGet(`SELECT id, recruiter_id FROM jobs WHERE id = ? AND recruiter_id = ?`, [req.params.id, req.user.id]);
    if (!job) return res.status(404).json({ error: 'Opportunity not found' });
    const { job: opportunity, embedding: opportunityEmbedding } = await ensureOpportunityEmbedding(req.params.id);
    const candidates = await dbAll(
      `SELECT DISTINCT u.*
       FROM users u
       LEFT JOIN applications a ON a.user_id = u.id OR a.applicant_email = u.email
       WHERE u.role = 'jobseeker'
         AND COALESCE(u.ai_matching_enabled, 1) = 1
         AND (u.status IN ('approved', 'pending') OR u.email_verified = 1)
         AND (COALESCE(u.recruiter_profile_visible, 0) = 1 OR a.job_id = ?)
       ORDER BY CASE WHEN a.job_id = ? THEN 0 ELSE 1 END, u.created_at DESC
       LIMIT 100`,
      [req.params.id, req.params.id]
    );
    const ranked = [];
    for (const candidate of candidates) {
      const { user, embedding } = await ensureCandidateEmbedding(candidate.id);
      const score = ai.scoreMatch(user, opportunity, embedding, opportunityEmbedding);
      await saveRecruiterMatch(req.user.id, user, opportunity, score);
      ranked.push({
        userId: user.id,
        name: user.name,
        headline: user.headline,
        location: user.location,
        matchScore: score.score,
        matchReasons: ai.explainMatch(user, opportunity, score),
        missingRequirements: score.missingSkills,
        skills: ai.parseList(user.skills),
        education: user.education,
        experience: user.experience,
        cvUrl: user.cv_url,
        profileUrl: `/profile/${user.id}`,
      });
    }
    res.json(ranked.sort((a, b) => b.matchScore - a.matchScore).slice(0, 50));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/admin/logs', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const logs = await dbAll(`SELECT * FROM ai_match_logs ORDER BY created_at DESC LIMIT 200`);
    res.json(logs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.calculateCandidateOpportunityMatch = calculateCandidateOpportunityMatch;
router.ensureCandidateEmbedding = ensureCandidateEmbedding;
router.ensureOpportunityEmbedding = ensureOpportunityEmbedding;

module.exports = router;
