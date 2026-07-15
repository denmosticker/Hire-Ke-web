const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MODEL_NAME = 'keyword-matcher-v1';
const EMBEDDING_DIMENSIONS = 384;
const KEYWORD_WEIGHT_LIMIT = 140;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'you', 'your', 'our', 'are', 'was', 'were', 'will', 'can',
  'has', 'have', 'had', 'not', 'but', 'all', 'any', 'job', 'role', 'work', 'team', 'company', 'candidate', 'applicant',
  'opportunity', 'responsibilities', 'requirements', 'required', 'preferred', 'experience', 'skills', 'skill',
  'years', 'year', 'month', 'months', 'kenya', 'hireke', 'about', 'using', 'use', 'must', 'able', 'good', 'great',
]);

function cleanText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textHash(text) {
  return crypto.createHash('sha256').update(`${MODEL_NAME}:${cleanText(text)}`).digest('hex');
}

function normalizeKeyword(word) {
  const cleaned = String(word || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]/g, '')
  if (cleaned.length <= 4) return cleaned;
  return cleaned.replace(/(ing|ers|ies|ied|ed|s)$/i, (suffix) => {
    if (suffix === 'ies' || suffix === 'ied') return 'y';
    return '';
  });
}

function keywordHash(keyword) {
  const digest = crypto.createHash('sha256').update(keyword).digest();
  return digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
}

function extractKeywords(text, limit = KEYWORD_WEIGHT_LIMIT) {
  const cleaned = cleanText(text).toLowerCase();
  if (!cleaned) return [];
  const phrases = [];
  const phraseMatches = cleaned.match(/[a-z0-9+#.]+(?:\s+[a-z0-9+#.]+){1,2}/g) || [];
  for (const phrase of phraseMatches) {
    const words = phrase.split(/\s+/).map(normalizeKeyword).filter((word) => word.length > 2 && !STOPWORDS.has(word));
    if (words.length >= 2) phrases.push(words.join(' '));
  }
  const words = cleaned
    .split(/[^a-z0-9+#.]+/i)
    .map(normalizeKeyword)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  for (const phrase of phrases.slice(0, 60)) counts.set(phrase, (counts.get(phrase) || 0) + 1.4);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([keyword, weight]) => ({ keyword, weight }));
}

async function getEmbedding(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0);
  for (const item of extractKeywords(cleaned)) {
    vector[keywordHash(item.keyword)] += Number(item.weight || 1);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (!magnitude) return vector;
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = Number((vector[i] / magnitude).toFixed(6));
  }
  return vector;
}

function cosineSimilarity(vectorA, vectorB) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || vectorA.length !== vectorB.length || vectorA.length === 0) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < vectorA.length; i += 1) {
    const a = Number(vectorA[i] || 0);
    const b = Number(vectorB[i] || 0);
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(cleanText).filter(Boolean);
  } catch (_) {
    // Fall through to comma/newline parsing.
  }
  return String(value)
    .split(/[,;\n]/)
    .map(cleanText)
    .filter(Boolean);
}

async function parsePdfBuffer(buffer) {
  const pdfParseModule = require('pdf-parse');
  const legacyPdfParse =
    typeof pdfParseModule === 'function'
      ? pdfParseModule
      : pdfParseModule.default;

  if (typeof legacyPdfParse === 'function') {
    const parsed = await legacyPdfParse(buffer);
    return parsed?.text;
  }

  if (typeof pdfParseModule.PDFParse === 'function') {
    const parser = new pdfParseModule.PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed?.text;
    } finally {
      await parser.destroy();
    }
  }

  throw new Error('pdf-parse could not be loaded as a function');
}

function buildCandidateProfileText(userProfile = {}) {
  const parts = [
    userProfile.name,
    userProfile.headline,
    userProfile.location,
    userProfile.about,
    `Skills: ${parseList(userProfile.skills).join(', ')}`,
    `Education: ${userProfile.education || ''}`,
    `Experience: ${userProfile.experience || ''}`,
    userProfile.certifications,
    userProfile.career_goals,
    userProfile.cv_text,
  ];
  return cleanText(parts.filter(Boolean).join('\n'));
}

function buildOpportunityText(opportunity = {}) {
  const requirements = parseList(opportunity.requirements);
  const parts = [
    opportunity.title,
    opportunity.company || opportunity.company_name || opportunity.company_external,
    opportunity.category,
    opportunity.job_type,
    opportunity.location,
    opportunity.description,
    `Requirements: ${requirements.join(', ')}`,
    opportunity.salary_min || opportunity.salary_max ? `Compensation: ${opportunity.salary_min || ''} ${opportunity.salary_max || ''}` : '',
    opportunity.deadline ? `Deadline: ${opportunity.deadline}` : '',
  ];
  return cleanText(parts.filter(Boolean).join('\n'));
}

function hasRemoteCompatibility(candidate = {}, opportunity = {}) {
  const text = `${candidate.location || ''} ${candidate.career_goals || ''} ${candidate.about || ''}`.toLowerCase();
  const jobLocation = String(opportunity.location || '').toLowerCase();
  if (/remote|online|anywhere|work from home/.test(jobLocation)) return 1;
  if (!candidate.location || !opportunity.location) return 0.6;
  return jobLocation.includes(String(candidate.location).toLowerCase()) || text.includes(jobLocation) ? 1 : 0.35;
}

function skillsOverlap(candidate = {}, opportunity = {}) {
  const candidateSkills = parseList(candidate.skills).map(normalizeKeyword).filter(Boolean);
  const requirementText = parseList(opportunity.requirements).join(' ').toLowerCase();
  const opportunityText = `${opportunity.title || ''} ${opportunity.description || ''} ${requirementText}`.toLowerCase();
  const opportunityKeywords = extractKeywords(opportunityText, 80).map((item) => item.keyword);
  const candidateKeywords = extractKeywords(buildCandidateProfileText(candidate), 100).map((item) => item.keyword);
  if (!candidateSkills.length && !candidateKeywords.length) return { score: 0.35, matched: [], missing: parseList(opportunity.requirements).slice(0, 5) };
  const candidateSet = new Set([...candidateSkills, ...candidateKeywords]);
  const matched = [...candidateSet].filter((skill) => opportunityText.includes(skill) || opportunityKeywords.some((keyword) => keyword.includes(skill) || skill.includes(keyword)));
  const requirementWords = [...new Set([...requirementText.split(/[^a-z0-9+#.]+/), ...opportunityKeywords].map(normalizeKeyword).filter((word) => word.length > 2 && !STOPWORDS.has(word)))];
  const missing = requirementWords
    .filter((word) => ![...candidateSet].some((skill) => skill.includes(word) || word.includes(skill)))
    .slice(0, 6);
  return {
    score: Math.min(1, matched.length / Math.max(4, Math.min(12, requirementWords.length || candidateSet.size))),
    matched,
    missing,
  };
}

function experienceEducationFit(candidate = {}, opportunity = {}) {
  const text = `${candidate.education || ''} ${candidate.experience || ''} ${candidate.headline || ''}`.toLowerCase();
  const job = `${opportunity.title || ''} ${opportunity.description || ''} ${parseList(opportunity.requirements).join(' ')}`.toLowerCase();
  if (!job.trim()) return 0.5;
  if (/intern|graduate|trainee|entry|junior/.test(job)) return /student|graduate|junior|intern|entry|university|college|tvet/.test(text) ? 1 : 0.7;
  if (/senior|lead|manager|director|5\+|6 years|7 years|8 years/.test(job)) return /senior|lead|manager|director|5 years|6 years|7 years|8 years|10 years/.test(text) ? 1 : 0.45;
  return text ? 0.75 : 0.45;
}

function availabilityDeadlineFit(_candidate = {}, opportunity = {}) {
  if (!opportunity.deadline) return 0.8;
  const time = new Date(opportunity.deadline).getTime();
  if (Number.isNaN(time)) return 0.7;
  return time >= Date.now() ? 1 : 0;
}

function scoreMatch(candidate, opportunity, candidateEmbedding, opportunityEmbedding) {
  const keywordRaw = cosineSimilarity(candidateEmbedding, opportunityEmbedding);
  const keyword = Math.max(0, Math.min(1, keywordRaw));
  const skills = skillsOverlap(candidate, opportunity);
  const location = hasRemoteCompatibility(candidate, opportunity);
  const fit = experienceEducationFit(candidate, opportunity);
  const availability = availabilityDeadlineFit(candidate, opportunity);
  const score = Math.round((keyword * 45) + (skills.score * 30) + (location * 10) + (fit * 10) + (availability * 5));
  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: {
      semantic: Math.round(keyword * 100),
      keywords: Math.round(keyword * 100),
      skills: Math.round(skills.score * 100),
      location: Math.round(location * 100),
      experienceEducation: Math.round(fit * 100),
      availabilityDeadline: Math.round(availability * 100),
    },
    matchedSkills: skills.matched,
    missingSkills: skills.missing,
  };
}

function explainMatch(candidate, opportunity, scoreBreakdown = {}) {
  const reasons = [];
  if (scoreBreakdown.breakdown?.keywords >= 55 || scoreBreakdown.breakdown?.semantic >= 55) reasons.push('Important keywords in your profile overlap with this opportunity.');
  if (scoreBreakdown.matchedSkills?.length) reasons.push(`Skill match: ${scoreBreakdown.matchedSkills.slice(0, 4).join(', ')}.`);
  if (hasRemoteCompatibility(candidate, opportunity) >= 0.9) reasons.push('The location or remote setup looks compatible.');
  if (experienceEducationFit(candidate, opportunity) >= 0.75) reasons.push('Your education or experience level appears aligned.');
  if (availabilityDeadlineFit(candidate, opportunity) > 0) reasons.push('The opportunity is still open or has no deadline listed.');
  return reasons.length ? reasons : ['This match is based on your profile text, skills, and opportunity requirements.'];
}

async function parseCvBuffer(file) {
  if (!file?.buffer) return '';
  const ext = path.extname(file.originalname || '').toLowerCase();
  try {
    if (ext === '.pdf') {
      return cleanText(await parsePdfBuffer(file.buffer));
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const parsed = await mammoth.extractRawText({ buffer: file.buffer });
      return cleanText(parsed.value);
    }
    if (ext === '.txt') return cleanText(file.buffer.toString('utf8'));
    return '';
  } catch (error) {
    if (ext === '.pdf') {
      throw new Error('Could not read CV: PDF text could not be extracted. Please upload a readable, unprotected PDF.');
    }
    throw new Error(`Could not read CV: ${error.message}`);
  }
}

async function parseCvFromUrl(fileUrl) {
  if (!fileUrl) return '';
  const relative = String(fileUrl).replace(/^\/+/, '');
  const filePath = path.join(__dirname, '..', relative);
  try {
    const buffer = await fs.readFile(filePath);
    return parseCvBuffer({ buffer, originalname: filePath });
  } catch (_) {
    return '';
  }
}

module.exports = {
  MODEL_NAME,
  EMBEDDING_DIMENSIONS,
  cleanText,
  textHash,
  getEmbedding,
  cosineSimilarity,
  extractKeywords,
  parseList,
  buildCandidateProfileText,
  buildOpportunityText,
  explainMatch,
  scoreMatch,
  parsePdfBuffer,
  parseCvBuffer,
  parseCvFromUrl,
};
