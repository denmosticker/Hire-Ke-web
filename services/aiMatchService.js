const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSIONS = 384;

let extractorPromise = null;

function cleanText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textHash(text) {
  return crypto.createHash('sha256').update(cleanText(text)).digest('hex');
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import('@xenova/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', MODEL_NAME)
    );
  }
  return extractorPromise;
}

async function getEmbedding(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  const extractor = await getExtractor();
  const output = await extractor(cleaned, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data || []);
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Unexpected embedding size ${vector.length}; expected ${EMBEDDING_DIMENSIONS}`);
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
  const candidateSkills = parseList(candidate.skills).map((item) => item.toLowerCase());
  const requirementText = parseList(opportunity.requirements).join(' ').toLowerCase();
  const opportunityText = `${opportunity.title || ''} ${opportunity.description || ''} ${requirementText}`.toLowerCase();
  if (!candidateSkills.length) return { score: 0.35, matched: [], missing: parseList(opportunity.requirements).slice(0, 5) };
  const matched = candidateSkills.filter((skill) => opportunityText.includes(skill));
  const requirementWords = [...new Set(requirementText.split(/[^a-z0-9+#.]+/).filter((word) => word.length > 2))];
  const missing = requirementWords
    .filter((word) => !candidateSkills.some((skill) => skill.includes(word) || word.includes(skill)))
    .slice(0, 6);
  return {
    score: Math.min(1, matched.length / Math.max(3, candidateSkills.length)),
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
  const semanticRaw = cosineSimilarity(candidateEmbedding, opportunityEmbedding);
  const semantic = Math.max(0, Math.min(1, (semanticRaw + 1) / 2));
  const skills = skillsOverlap(candidate, opportunity);
  const location = hasRemoteCompatibility(candidate, opportunity);
  const fit = experienceEducationFit(candidate, opportunity);
  const availability = availabilityDeadlineFit(candidate, opportunity);
  const score = Math.round((semantic * 55) + (skills.score * 20) + (location * 10) + (fit * 10) + (availability * 5));
  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: {
      semantic: Math.round(semantic * 100),
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
  if (scoreBreakdown.breakdown?.semantic >= 70) reasons.push('Your profile is semantically close to this opportunity.');
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
  parseList,
  buildCandidateProfileText,
  buildOpportunityText,
  explainMatch,
  scoreMatch,
  parsePdfBuffer,
  parseCvBuffer,
  parseCvFromUrl,
};
