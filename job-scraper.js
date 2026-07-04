const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const db = require('./database');

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
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

function hashJob(source, url, title) {
  return crypto
    .createHash('sha256')
    .update(`${source}|${url}|${title}`)
    .digest('hex');
}

async function ensureScraperSchema() {
  const columns = [
    `ALTER TABLE jobs ADD COLUMN external_url TEXT`,
    `ALTER TABLE jobs ADD COLUMN source_name TEXT`,
    `ALTER TABLE jobs ADD COLUMN source_job_id TEXT`,
    `ALTER TABLE jobs ADD COLUMN company_external TEXT`,
    `ALTER TABLE jobs ADD COLUMN scraped_at DATETIME`,
    `ALTER TABLE jobs ADD COLUMN apply_method TEXT DEFAULT 'External Website'`
  ];

  for (const sql of columns) {
    try {
      await dbRun(sql);
    } catch (err) {
      if (!String(err.message).includes('duplicate column')) {
        throw err;
      }
    }
  }

  await dbRun(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_unique
    ON jobs(source_name, source_job_id)
  `);
}

async function getAggregatorRecruiterId() {
  const email = 'aggregator@hireke.local';

  let user = await dbGet(`SELECT id FROM users WHERE email = ?`, [email]);

  if (user) return user.id;

  const result = await dbRun(
    `
    INSERT INTO users (
      email,
      password,
      name,
      role,
      status,
      company_name,
      email_verified,
      marketing_optin
    )
    VALUES (?, ?, ?, 'recruiter', 'approved', ?, 1, 0)
    `,
    [
      email,
      'system-generated-no-login',
      'HireKe Aggregator',
      'HireKe Verified Opportunities'
    ]
  );

  return result.lastID;
}

function cleanText(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeJob(job) {
  const title = cleanText(job.title);
  const company = cleanText(job.company || 'External Employer');
  const location = cleanText(job.location || 'Remote / Not specified');
  const description = cleanText(job.description || 'View full details on the employer website.');
  const externalUrl = job.external_url;

  if (!title || !externalUrl) return null;

  return {
    title,
    company,
    location,
    description,
    requirements: job.requirements || ['Apply through the external website'],
    job_type: ['Full-time', 'Part-time', 'Contract'].includes(job.job_type)
      ? job.job_type
      : 'Full-time',
    deadline: job.deadline || null,
    salary_min: job.salary_min || null,
    salary_max: job.salary_max || null,
    external_url: externalUrl,
    source_name: job.source_name,
    source_job_id: job.source_job_id || hashJob(job.source_name, externalUrl, title),
    apply_method: 'External Website'
  };
}

async function saveJob(job, recruiterId) {
  const normalized = normalizeJob(job);
  if (!normalized) return { skipped: true };

  try {
    await dbRun(
      `
      INSERT INTO jobs (
        recruiter_id,
        title,
        location,
        salary_min,
        salary_max,
        description,
        requirements,
        job_type,
        deadline,
        status,
        featured,
        external_url,
        source_name,
        source_job_id,
        company_external,
        scraped_at,
        apply_method
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 0, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `,
      [
        recruiterId,
        normalized.title,
        normalized.location,
        normalized.salary_min,
        normalized.salary_max,
        normalized.description,
        JSON.stringify(normalized.requirements),
        normalized.job_type,
        normalized.deadline,
        normalized.external_url,
        normalized.source_name,
        normalized.source_job_id,
        normalized.company,
        normalized.apply_method
      ]
    );

    return { imported: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { duplicate: true };
    }
    throw err;
  }
}

/**
 * Source 1: Remotive API
 * Good for remote jobs.
 */
async function fetchRemotiveJobs() {
  const searches = ['developer', 'marketing', 'design', 'customer support', 'data'];

  const jobs = [];

  for (const search of searches) {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(search)}`;
    const response = await axios.get(url, { timeout: 20000 });

    for (const item of response.data.jobs || []) {
      jobs.push({
        title: item.title,
        company: item.company_name,
        location: item.candidate_required_location || 'Remote',
        description: item.description?.replace(/<[^>]*>/g, ' '),
        external_url: item.url,
        source_name: 'Remotive',
        source_job_id: String(item.id),
        job_type: 'Full-time'
      });
    }
  }

  return jobs;
}

/**
 * Source 2: Example HTML scraper
 * Replace selectors per website after checking permission/robots.txt.
 */
async function fetchGenericHtmlJobs() {
  const enabled = process.env.ENABLE_HTML_JOB_SCRAPER === 'true';
  if (!enabled) return [];

  const url = process.env.HTML_JOBS_URL;
  if (!url) return [];

  const response = await axios.get(url, {
    timeout: 20000,
    headers: {
      'User-Agent': 'HireKeBot/1.0 (+https://hireke.com)'
    }
  });

  const $ = cheerio.load(response.data);
  const jobs = [];

  $('.job-card').each((_, el) => {
    const title = cleanText($(el).find('.job-title').text());
    const company = cleanText($(el).find('.company').text());
    const location = cleanText($(el).find('.location').text());
    const href = $(el).find('a').attr('href');

    if (!title || !href) return;

    const externalUrl = new URL(href, url).toString();

    jobs.push({
      title,
      company,
      location,
      description: 'View full job details on the source website.',
      external_url: externalUrl,
      source_name: 'HTML Source',
      source_job_id: hashJob('HTML Source', externalUrl, title),
      job_type: 'Full-time'
    });
  });

  return jobs;
}

async function importExternalJobs() {
  await ensureScraperSchema();

  const recruiterId = await getAggregatorRecruiterId();

  const sources = [fetchRemotiveJobs, fetchGenericHtmlJobs];

  let imported = 0;
  let duplicates = 0;
  let skipped = 0;
  let failed = 0;

  for (const source of sources) {
    try {
      const jobs = await source();

      for (const job of jobs) {
        try {
          const result = await saveJob(job, recruiterId);

          if (result.imported) imported++;
          else if (result.duplicate) duplicates++;
          else skipped++;
        } catch (err) {
          failed++;
          console.error('Job save failed:', err.message);
        }
      }
    } catch (err) {
      failed++;
      console.error('Job source failed:', err.message);
    }
  }

  return {
    imported,
    duplicates,
    skipped,
    failed,
    finished_at: new Date().toISOString()
  };
}

module.exports = {
  importExternalJobs
};
