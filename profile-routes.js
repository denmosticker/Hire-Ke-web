// profile-routes.js
const express = require('express');
const db = require('./database');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { authMiddleware } = require('./auth-middleware');
const { saveObject, deleteObject, assertStorageReady } = require('./storage-service');
const aiRoutes = require('./ai-routes');
const aiMatchService = require('./services/aiMatchService');
const { CONSENT_TYPES, POLICY_VERSION } = require('./legal-content');

const router = express.Router();

const allowedUploads = {
  cv: {
    extensions: new Set(['.pdf', '.doc', '.docx', '.txt']),
    mimeTypes: new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ]),
  },
  avatar: {
    extensions: new Set(['.jpg', '.jpeg', '.png', '.webp']),
    mimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp']),
  },
  banner: {
    extensions: new Set(['.jpg', '.jpeg', '.png', '.webp']),
    mimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp']),
  },
};

function uploadFileFilter(_req, file, cb) {
  const policy = allowedUploads[file.fieldname];
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!policy || !policy.extensions.has(ext) || !policy.mimeTypes.has(file.mimetype)) {
    return cb(new Error('Unsupported file type'));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: uploadFileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

const educationLevels = new Set(['Primary Education', 'Secondary Education', 'TVET', 'College', 'University']);

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeYear(value) {
  if (value === undefined || value === null || value === '') return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  return year;
}

function boolValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function optionalUser(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return null;
  }
}

async function recordConsent(userId, consentType, accepted, sourceContext = 'profile') {
  await dbRun(
    `INSERT INTO user_consents (user_id, consent_type, accepted, policy_version, source_context, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [userId, consentType, accepted ? 1 : 0, POLICY_VERSION, sourceContext]
  );
}

function calculateProfileCompletion(profile) {
  const fields = [
    profile.name,
    profile.headline,
    profile.location,
    profile.about,
    profile.skills,
    profile.education,
    profile.experience,
    profile.certifications,
    profile.career_goals,
    profile.cv_url,
  ];
  const completed = fields.filter((value) => String(value || '').trim().length > 0).length;
  return Math.round((completed / fields.length) * 100);
}

async function recordUserFile(userId, fileType, stored) {
  await dbRun(
    `INSERT INTO user_files (user_id, file_type, provider, bucket, object_key, file_url, original_name, mime_type, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      fileType,
      stored.provider,
      stored.bucket,
      stored.key,
      stored.url,
      stored.originalName,
      stored.mimeType,
      stored.size,
    ]
  );
}

async function getEducation(userId) {
  return dbAll(
    `SELECT id, user_id, education_level, institution_name, course, year_from, year_to, description, created_at, updated_at
     FROM profile_education
     WHERE user_id = ?
     ORDER BY COALESCE(year_to, 9999) DESC, COALESCE(year_from, 0) DESC, id DESC`,
    [userId]
  );
}

async function getExperience(userId) {
  return dbAll(
    `SELECT id, user_id, organization_name, job_title, employment_type, year_from, year_to, currently_working, description, created_at, updated_at
     FROM profile_experience
     WHERE user_id = ?
     ORDER BY currently_working DESC, COALESCE(year_to, 9999) DESC, COALESCE(year_from, 0) DESC, id DESC`,
    [userId]
  );
}

// GET /api/profile/:id – public profile data (basic fields)
router.get('/:id', (req, res) => {
  const userId = req.params.id;
  const viewer = optionalUser(req);
  db.get(
    `SELECT u.id, u.name as fullName, u.username, u.avatar_url as avatarUrl,
            u.cover_banner_url as coverBannerUrl, u.headline, u.location, u.about,
            u.profile_completion as profileCompletion, u.created_at as createdAt,
            u.recruiter_profile_visible,
            uv.level as verificationLevel, uv.badge_label as verificationBadge,
            uv.status as verificationStatus, uv.expires_at as verificationExpiresAt
     FROM users u
     LEFT JOIN user_verifications uv ON uv.user_id = u.id AND uv.status = 'approved'
     WHERE u.id = ?`,
    [userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'User not found' });
      if (row.recruiter_profile_visible !== 1 && Number(viewer?.id) !== Number(userId) && viewer?.role !== 'admin') {
        return res.status(403).json({ error: 'This professional profile is private unless the candidate applies or enables recruiter visibility.' });
      }
      Promise.all([getEducation(userId), getExperience(userId)])
        .then(([education, experience]) => {
          const { recruiter_profile_visible, ...safeRow } = row;
          res.json({ data: { ...safeRow, recruiterProfileVisible: recruiter_profile_visible === 1, educationEntries: education, experienceEntries: experience } });
        })
        .catch((error) => res.status(500).json({ error: error.message }));
    }
  );
});

// GET /api/profile/me - current user's editable profile
router.get('/me/edit', authMiddleware, async (req, res) => {
  try {
    const row = await dbGet(
      `SELECT id, email, name, username, avatar_url, cover_banner_url, headline, location, about,
              skills, education, experience, certifications, career_goals, cv_url, profile_completion,
              recruiter_profile_visible, ai_matching_enabled, cv_processing_consent
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ data: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/profile/me - save job seeker profile details and CV URL
router.patch('/me', authMiddleware, upload.single('cv'), async (req, res) => {
  try {
    const existing = await dbGet(`SELECT cv_url, cv_processing_consent FROM users WHERE id = ?`, [req.user.id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    let cvUrl = existing.cv_url;
    let cvText = '';
    if (req.file) {
      assertStorageReady();
      const consentAccepted = existing.cv_processing_consent === 1 || boolValue(req.body.cv_processing_consent);
      if (!consentAccepted) {
        return res.status(400).json({ error: 'Please consent to CV processing before uploading a CV.' });
      }
      if (boolValue(req.body.cv_processing_consent) && existing.cv_processing_consent !== 1) {
        await dbRun(`UPDATE users SET cv_processing_consent = 1 WHERE id = ?`, [req.user.id]);
        await recordConsent(req.user.id, CONSENT_TYPES.cv, true, 'cv_upload');
      }
      cvText = await aiMatchService.parseCvBuffer(req.file);
      if (!cvText) return res.status(400).json({ error: 'Could not read text from that CV. Please upload a readable PDF, DOCX, or TXT file.' });
      const stored = await saveObject({ bucket: 'documents', userId: req.user.id, file: req.file });
      await recordUserFile(req.user.id, 'cv', stored);
      cvUrl = stored.url;
    }

    const profile = {
      name: req.body.name || req.body.fullName || '',
      headline: req.body.headline || '',
      location: req.body.location || '',
      about: req.body.about || '',
      skills: req.body.skills || '',
      education: req.body.education || '',
      experience: req.body.experience || '',
      certifications: req.body.certifications || '',
      career_goals: req.body.career_goals || req.body.careerGoals || '',
      cv_url: cvUrl,
    };
    profile.profile_completion = calculateProfileCompletion(profile);

    await dbRun(
      `UPDATE users
       SET name = COALESCE(NULLIF(?, ''), name),
           headline = ?, location = ?, about = ?, skills = ?, education = ?,
           experience = ?, certifications = ?, career_goals = ?, cv_url = ?,
           profile_completion = ?
       WHERE id = ?`,
      [
        profile.name,
        profile.headline,
        profile.location,
        profile.about,
        profile.skills,
        profile.education,
        profile.experience,
        profile.certifications,
        profile.career_goals,
        profile.cv_url,
        profile.profile_completion,
        req.user.id,
      ]
    );

    await dbRun(
      `INSERT INTO profile_analytics (user_id, updated_at)
       VALUES (?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
      [req.user.id]
    );

    try {
      await aiRoutes.ensureCandidateEmbedding(req.user.id);
    } catch (error) {
      console.error('AI profile embedding refresh failed:', error.message);
    }

    res.json({ success: true, data: profile });
  } catch (err) {
    if (String(err.message || '').startsWith('Could not read CV:')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/me/cv', authMiddleware, async (req, res) => {
  try {
    const existing = await dbGet(`SELECT cv_url FROM users WHERE id = ?`, [req.user.id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const latestCvFile = await dbGet(
      `SELECT * FROM user_files WHERE user_id = ? AND file_type = 'cv' ORDER BY created_at DESC, id DESC LIMIT 1`,
      [req.user.id]
    );
    let storageDeleted = false;
    if (latestCvFile) {
      try {
        storageDeleted = await deleteObject(latestCvFile);
      } catch (error) {
        console.error('CV storage delete failed:', error.message);
      }
    }
    await dbRun(`UPDATE users SET cv_url = NULL, ai_embedding = NULL, ai_profile_hash = NULL, ai_profile_text = NULL, ai_embedding_updated_at = NULL WHERE id = ?`, [req.user.id]);
    if (latestCvFile) {
      await dbRun(`UPDATE user_files SET deleted_at = CURRENT_TIMESTAMP, deletion_status = ? WHERE id = ?`, [storageDeleted ? 'deleted' : 'detached', latestCvFile.id]);
    }
    await dbRun(
      `INSERT INTO data_deletion_requests (user_id, request_type, status, details, updated_at)
       VALUES (?, 'cv_deletion', 'completed', ?, CURRENT_TIMESTAMP)`,
      [req.user.id, existing.cv_url ? `Active CV removed from profile. Storage deleted: ${storageDeleted ? 'yes' : 'not confirmed'}.` : 'No active CV was attached.']
    );
    res.json({ success: true, message: 'Your active CV has been removed from your profile.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/profile/:id/banner – returns banner URL (fallback if none)
// PATCH /api/profile/me/photo - upload/change the logged-in user's profile picture
router.get('/me/education', authMiddleware, async (req, res) => {
  try {
    res.json({ data: await getEducation(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/me/education', authMiddleware, async (req, res) => {
  try {
    const educationLevel = cleanText(req.body.education_level || req.body.educationLevel);
    const institutionName = cleanText(req.body.institution_name || req.body.institutionName);
    if (!educationLevels.has(educationLevel)) return res.status(400).json({ error: 'Choose a valid education level.' });
    if (!institutionName) return res.status(400).json({ error: 'School or institution name is required.' });

    const result = await dbRun(
      `INSERT INTO profile_education (user_id, education_level, institution_name, course, year_from, year_to, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        educationLevel,
        institutionName,
        cleanText(req.body.course),
        normalizeYear(req.body.year_from || req.body.yearFrom),
        normalizeYear(req.body.year_to || req.body.yearTo),
        cleanText(req.body.description),
      ]
    );
    await dbRun(
      `INSERT INTO profile_checklist (user_id, education, updated_at)
       VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET education = 1, updated_at = CURRENT_TIMESTAMP`,
      [req.user.id]
    );
    res.status(201).json({ data: await dbGet(`SELECT * FROM profile_education WHERE id = ? AND user_id = ?`, [result.lastID, req.user.id]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/me/education/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await dbGet(`SELECT id FROM profile_education WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Education entry not found.' });
    const educationLevel = cleanText(req.body.education_level || req.body.educationLevel);
    const institutionName = cleanText(req.body.institution_name || req.body.institutionName);
    if (!educationLevels.has(educationLevel)) return res.status(400).json({ error: 'Choose a valid education level.' });
    if (!institutionName) return res.status(400).json({ error: 'School or institution name is required.' });

    await dbRun(
      `UPDATE profile_education
       SET education_level = ?, institution_name = ?, course = ?, year_from = ?, year_to = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        educationLevel,
        institutionName,
        cleanText(req.body.course),
        normalizeYear(req.body.year_from || req.body.yearFrom),
        normalizeYear(req.body.year_to || req.body.yearTo),
        cleanText(req.body.description),
        req.params.id,
        req.user.id,
      ]
    );
    res.json({ data: await dbGet(`SELECT * FROM profile_education WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/me/education/:id', authMiddleware, async (req, res) => {
  try {
    const result = await dbRun(`DELETE FROM profile_education WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!result.changes) return res.status(404).json({ error: 'Education entry not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me/experience', authMiddleware, async (req, res) => {
  try {
    res.json({ data: await getExperience(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/me/experience', authMiddleware, async (req, res) => {
  try {
    const organizationName = cleanText(req.body.organization_name || req.body.organizationName);
    const jobTitle = cleanText(req.body.job_title || req.body.jobTitle);
    if (!organizationName) return res.status(400).json({ error: 'Organization or company name is required.' });
    if (!jobTitle) return res.status(400).json({ error: 'Job title or role is required.' });
    const currentlyWorking = req.body.currently_working || req.body.currentlyWorking ? 1 : 0;

    const result = await dbRun(
      `INSERT INTO profile_experience (user_id, organization_name, job_title, employment_type, year_from, year_to, currently_working, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        organizationName,
        jobTitle,
        cleanText(req.body.employment_type || req.body.employmentType),
        normalizeYear(req.body.year_from || req.body.yearFrom),
        currentlyWorking ? null : normalizeYear(req.body.year_to || req.body.yearTo),
        currentlyWorking,
        cleanText(req.body.description),
      ]
    );
    await dbRun(
      `INSERT INTO profile_checklist (user_id, experience, updated_at)
       VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET experience = 1, updated_at = CURRENT_TIMESTAMP`,
      [req.user.id]
    );
    res.status(201).json({ data: await dbGet(`SELECT * FROM profile_experience WHERE id = ? AND user_id = ?`, [result.lastID, req.user.id]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/me/experience/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await dbGet(`SELECT id FROM profile_experience WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Experience entry not found.' });
    const organizationName = cleanText(req.body.organization_name || req.body.organizationName);
    const jobTitle = cleanText(req.body.job_title || req.body.jobTitle);
    if (!organizationName) return res.status(400).json({ error: 'Organization or company name is required.' });
    if (!jobTitle) return res.status(400).json({ error: 'Job title or role is required.' });
    const currentlyWorking = req.body.currently_working || req.body.currentlyWorking ? 1 : 0;

    await dbRun(
      `UPDATE profile_experience
       SET organization_name = ?, job_title = ?, employment_type = ?, year_from = ?, year_to = ?, currently_working = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        organizationName,
        jobTitle,
        cleanText(req.body.employment_type || req.body.employmentType),
        normalizeYear(req.body.year_from || req.body.yearFrom),
        currentlyWorking ? null : normalizeYear(req.body.year_to || req.body.yearTo),
        currentlyWorking,
        cleanText(req.body.description),
        req.params.id,
        req.user.id,
      ]
    );
    res.json({ data: await dbGet(`SELECT * FROM profile_experience WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/me/experience/:id', authMiddleware, async (req, res) => {
  try {
    const result = await dbRun(`DELETE FROM profile_experience WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!result.changes) return res.status(404).json({ error: 'Experience entry not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/me/photo', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    const existing = await dbGet(`SELECT id FROM users WHERE id = ?`, [req.user.id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    if (!req.file) return res.status(400).json({ error: 'Profile photo is required' });

    assertStorageReady();
    const stored = await saveObject({ bucket: 'profile-pictures', userId: req.user.id, file: req.file });
    await recordUserFile(req.user.id, 'profile_picture', stored);
    await dbRun(`UPDATE users SET avatar_url = ? WHERE id = ?`, [stored.url, req.user.id]);
    await dbRun(
      `INSERT INTO profile_checklist (user_id, profile_photo, updated_at)
       VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET profile_photo = 1, updated_at = CURRENT_TIMESTAMP`,
      [req.user.id]
    );

    res.json({ success: true, data: { avatarUrl: stored.url, path: stored.path } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/banner', (req, res) => {
  const userId = req.params.id;
  db.get(
    `SELECT cover_banner_url FROM users WHERE id = ?`,
    [userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      const url = row && row.cover_banner_url ? row.cover_banner_url : null;
      res.json({ data: { coverBannerUrl: url } });
    }
  );
});

// PATCH /api/profile/:id/banner – upload new banner (protected)
router.patch('/:id/banner', authMiddleware, upload.single('banner'), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Banner file is required' });
    }
    assertStorageReady();
    const stored = await saveObject({ bucket: 'profile-banners', userId, file: req.file });
    await recordUserFile(userId, 'profile_banner', stored);
    await dbRun(`UPDATE users SET cover_banner_url = ? WHERE id = ?`, [stored.url, userId]);
    res.json({ data: { coverBannerUrl: stored.url } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
