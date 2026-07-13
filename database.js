const path = require('path');

function replaceQuestionParams(sql, params = []) {
  let index = 0;
  let quote = null;
  let output = '';
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (quote) {
      output += char;
      if (char === quote) {
        if (next === quote) {
          output += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      continue;
    }
    if (char === '?') {
      index += 1;
      output += `$${index}`;
      continue;
    }
    output += char;
  }
  return { sql: output, params };
}

function removeDatetimeWrappers(sql) {
  let output = '';
  for (let i = 0; i < sql.length; i += 1) {
    if (sql.slice(i, i + 9).toLowerCase() !== 'datetime(') {
      output += sql[i];
      continue;
    }
    let depth = 1;
    let j = i + 9;
    let quote = null;
    let inner = '';
    for (; j < sql.length; j += 1) {
      const char = sql[j];
      const next = sql[j + 1];
      if (quote) {
        inner += char;
        if (char === quote) {
          if (next === quote) {
            inner += next;
            j += 1;
          } else {
            quote = null;
          }
        }
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        inner += char;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      inner += char;
    }
    const normalized = inner.trim().toLowerCase();
    if (normalized === "'now'") {
      output += 'NOW()';
    } else if (/^'now'\s*,\s*'\+\d+\s+days'$/.test(normalized)) {
      const days = normalized.match(/\+(\d+)\s+days/)[1];
      output += `(NOW() + INTERVAL '${days} days')`;
    } else {
      output += inner;
    }
    i = j;
  }
  return output;
}

function transformPostgresSql(inputSql) {
  let sql = String(inputSql || '').trim().replace(/;+\s*$/, '');
  const wasInsertOrIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql);
  sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  sql = sql.replace(/\bDATETIME\b/gi, 'TIMESTAMP');
  sql = sql.replace(/\bREAL\b/gi, 'DOUBLE PRECISION');
  sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  sql = removeDatetimeWrappers(sql);
  if (/^INSERT\s+INTO\s+/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
    if (wasInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(sql)) {
      sql += ' ON CONFLICT DO NOTHING';
    }
    sql += ' RETURNING *';
  }
  return sql;
}

class PostgresCompatDatabase {
  constructor(connectionString) {
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    });
    this.isPostgres = true;
    this.ready = Promise.resolve();
  }

  serialize(callback) {
    callback();
  }

  run(sql, params = [], callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const isSchemaStatement = /^\s*(CREATE|ALTER)\s+/i.test(String(sql || ''));
    const task = async () => {
      const query = replaceQuestionParams(transformPostgresSql(sql), params);
      const result = await this.pool.query(query.sql, query.params);
      const first = result.rows?.[0] || {};
      return {
        lastID: first.id || first.user_id || null,
        changes: result.rowCount || 0,
      };
    };
    const operation = this.ready.then(task, task).catch((error) => {
      if (error.code === '42701') error.message = 'duplicate column name';
      if (isSchemaStatement) {
        console.error('Postgres schema statement skipped:', error.message);
        return { lastID: null, changes: 0 };
      }
      throw error;
    });
    this.ready = operation.catch(() => undefined);
    operation
      .then((context) => callback?.call(context, null))
      .catch((error) => {
        callback?.(error);
      });
    return this;
  }

  get(sql, params = [], callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const task = async () => {
      const query = replaceQuestionParams(transformPostgresSql(sql), params);
      const result = await this.pool.query(query.sql, query.params);
      return result.rows[0];
    };
    this.ready
      .then(task)
      .then((row) => callback?.(null, row))
      .catch((error) => callback?.(error));
    return this;
  }

  all(sql, params = [], callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const task = async () => {
      const query = replaceQuestionParams(transformPostgresSql(sql), params);
      const result = await this.pool.query(query.sql, query.params);
      return result.rows;
    };
    this.ready
      .then(task)
      .then((rows) => callback?.(null, rows))
      .catch((error) => callback?.(error));
    return this;
  }
}



var db;
var dbPath;
if (process.env.DATABASE_URL) {
  console.log('Using Postgres database from DATABASE_URL');
  db = new PostgresCompatDatabase(process.env.DATABASE_URL);
} else {
  const sqlite3 = require('sqlite3').verbose();
  dbPath = process.env.DB_PATH || process.env.DATABASE_PATH || path.join(__dirname, 'hireke.db');
  console.log('Using SQLite DB at:', dbPath);
  db = new sqlite3.Database(dbPath);
  db.isPostgres = false;
}

db.serialize(() => {
  // Users table with OTP verification
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT CHECK(role IN ('jobseeker', 'recruiter', 'admin')) DEFAULT 'jobseeker',
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      company_name TEXT,
      company_url TEXT,
      company_logo TEXT,
      phone_number TEXT,
      verified_at DATETIME,
      email_verified INTEGER DEFAULT 0,
      otp_code TEXT,
      otp_expires_at DATETIME,
      phone_otp_code TEXT,
      phone_otp_expires_at DATETIME,
      marketing_optin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Jobs table
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recruiter_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      salary_min INTEGER,
      salary_max INTEGER,
      description TEXT NOT NULL,
      requirements TEXT NOT NULL,
      job_type TEXT CHECK(job_type IN ('Full-time', 'Part-time', 'Contract')) DEFAULT 'Full-time',
      deadline DATETIME,
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      featured INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recruiter_id) REFERENCES users(id)
    )
  `);

  // Applications table
  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      applicant_email TEXT NOT NULL,
      applicant_name TEXT NOT NULL,
      cv_score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Applied',
      recruiter_note TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);

  // Payments table
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recruiter_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      transaction_id TEXT UNIQUE,
      tx_ref TEXT UNIQUE,
      package_name TEXT,
      payment_method TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recruiter_id) REFERENCES users(id)
    )
  `);

  // Subscriptions table
  db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recruiter_id INTEGER NOT NULL UNIQUE,
      plan_type TEXT DEFAULT 'free',
      featured_jobs INTEGER DEFAULT 0,
      expiry_date DATETIME,
      active INTEGER DEFAULT 1,
      FOREIGN KEY (recruiter_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER,
      user_id INTEGER,
      gateway TEXT NOT NULL DEFAULT 'palplus',
      type TEXT NOT NULL DEFAULT 'stk_push',
      merchant_reference TEXT NOT NULL UNIQUE,
      checkout_request_id TEXT UNIQUE,
      gateway_reference TEXT UNIQUE,
      phone_number TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'KES',
      status TEXT DEFAULT 'pending',
      request_payload TEXT,
      response_payload TEXT,
      callback_payload TEXT,
      callback_signature TEXT,
      verified INTEGER DEFAULT 0,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER,
      transaction_id INTEGER,
      gateway TEXT DEFAULT 'palplus',
      event_type TEXT NOT NULL,
      status TEXT,
      message TEXT,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id),
      FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      payment_id INTEGER,
      invoice_number TEXT NOT NULL UNIQUE,
      item_type TEXT NOT NULL,
      item_code TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'KES',
      status TEXT DEFAULT 'pending',
      due_date DATETIME,
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS verification_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_code TEXT NOT NULL DEFAULT 'standard',
      level_requested TEXT DEFAULT 'L1',
      status TEXT DEFAULT 'submitted',
      amount REAL DEFAULT 0,
      payment_id INTEGER,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      expires_at DATETIME,
      rejection_reason TEXT,
      notes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (payment_id) REFERENCES payments(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS verification_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      document_type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      original_name TEXT,
      status TEXT DEFAULT 'pending',
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES verification_requests(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_verifications (
      user_id INTEGER PRIMARY KEY,
      level TEXT DEFAULT 'none',
      badge_label TEXT,
      status TEXT DEFAULT 'none',
      priority_rank INTEGER DEFAULT 0,
      recruiter_visible INTEGER DEFAULT 0,
      verified_at DATETIME,
      expires_at DATETIME,
      renewal_due_at DATETIME,
      last_request_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (last_request_id) REFERENCES verification_requests(id)
    )
  `);

  // Website visits log
  db.run(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      page TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Clicks log (for tracking button clicks and interactions)
  db.run(`
    CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      element_type TEXT NOT NULL,
      element_name TEXT,
      action TEXT,
      page TEXT,
      clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // CV scores tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS cv_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      score INTEGER DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      suggestions TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Notifications table
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indices for better query performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_visits_user_id ON visits(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(visited_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_clicks_user_id ON clicks(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_clicks_created_at ON clicks(clicked_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_recruiter_id ON jobs(recruiter_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payments_recruiter_id ON payments(recruiter_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payment_transactions_gateway_ref ON payment_transactions(gateway_reference)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payment_events_payment_id ON payment_events(payment_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_verification_requests_user_id ON verification_requests(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_verification_requests_status ON verification_requests(status)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS saved_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, job_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_saved_opportunities_user ON saved_opportunities(user_id, created_at)`);

  // --- New columns for dynamic profile data ---
  const addColumn = (table, column, definition) => {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error(`Error adding column ${column} to ${table}:`, err.message);
      }
    });
  };
  // Users table additions
  addColumn('users', 'username', 'TEXT');
  addColumn('users', 'avatar_url', 'TEXT');
  addColumn('users', 'cover_banner_url', 'TEXT');
  addColumn('users', 'phone_number', 'TEXT');
  addColumn('users', 'headline', 'TEXT');
  addColumn('users', 'location', 'TEXT');
  addColumn('users', 'about', 'TEXT');
  addColumn('users', 'skills', 'TEXT');
  addColumn('users', 'education', 'TEXT');
  addColumn('users', 'experience', 'TEXT');
  addColumn('users', 'certifications', 'TEXT');
  addColumn('users', 'career_goals', 'TEXT');
  addColumn('users', 'cv_url', 'TEXT');
  addColumn('users', 'ai_embedding', 'TEXT');
  addColumn('users', 'ai_profile_hash', 'TEXT');
  addColumn('users', 'ai_profile_text', 'TEXT');
  addColumn('users', 'ai_embedding_updated_at', 'DATETIME');
  addColumn('users', 'profile_completion', 'INTEGER DEFAULT 0');
  addColumn('users', 'verification_level', "TEXT DEFAULT 'none'");
  addColumn('users', 'verification_badge', 'TEXT');

  // Application method fields for every opportunity/job.
  addColumn('jobs', 'application_method', "TEXT DEFAULT 'easy_apply'");
  addColumn('jobs', 'application_url', 'TEXT');
  addColumn('jobs', 'application_email', 'TEXT');
  addColumn('jobs', 'application_whatsapp', 'TEXT');
  addColumn('jobs', 'category', "TEXT DEFAULT 'Jobs'");
  addColumn('jobs', 'source_url', 'TEXT');
  addColumn('jobs', 'source_name', 'TEXT');
  addColumn('jobs', 'source_type', 'TEXT');
  addColumn('jobs', 'company_external', 'TEXT');
  addColumn('jobs', 'imported_from_url', 'INTEGER DEFAULT 0');
  addColumn('jobs', 'is_verified', 'INTEGER DEFAULT 0');
  addColumn('jobs', 'date_discovered', 'DATETIME');
  addColumn('jobs', 'duplicate_of_id', 'INTEGER');
  addColumn('jobs', 'archived_at', 'DATETIME');
  addColumn('jobs', 'deleted_at', 'DATETIME');
  addColumn('jobs', 'ai_embedding', 'TEXT');
  addColumn('jobs', 'ai_opportunity_hash', 'TEXT');
  addColumn('jobs', 'ai_opportunity_text', 'TEXT');
  addColumn('jobs', 'ai_embedding_updated_at', 'DATETIME');

  db.run(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT,
      category TEXT,
      is_active INTEGER DEFAULT 1,
      last_imported_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS opportunity_import_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      status TEXT NOT NULL,
      extracted_fields_json TEXT,
      error_message TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_source_url ON jobs(source_url)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_import_status ON jobs(status, imported_from_url)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_active)`);

  // Application and external-start tracking.
  addColumn('applications', 'user_id', 'INTEGER');
  addColumn('applications', 'application_method', "TEXT DEFAULT 'easy_apply'");
  addColumn('applications', 'cv_url', 'TEXT');
  addColumn('applications', 'documents', 'TEXT');
  addColumn('applications', 'application_answers', 'TEXT');
  addColumn('applications', 'marked_applied', 'INTEGER DEFAULT 0');
  addColumn('applications', 'started_at', 'DATETIME');
  addColumn('applications', 'ai_match_score', 'INTEGER');
  addColumn('applications', 'ai_match_reasons', 'TEXT');

  db.run(`
    CREATE TABLE IF NOT EXISTS recruiter_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      recruiter_id INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (application_id) REFERENCES applications(id),
      FOREIGN KEY (recruiter_id) REFERENCES users(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recruiter_notes_application ON recruiter_notes(application_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_one_id INTEGER NOT NULL,
      participant_two_id INTEGER NOT NULL,
      application_id INTEGER,
      opportunity_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (participant_one_id) REFERENCES users(id),
      FOREIGN KEY (participant_two_id) REFERENCES users(id),
      FOREIGN KEY (application_id) REFERENCES applications(id),
      FOREIGN KEY (opportunity_id) REFERENCES jobs(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      application_id INTEGER,
      opportunity_id INTEGER,
      subject TEXT,
      body TEXT NOT NULL,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id),
      FOREIGN KEY (application_id) REFERENCES applications(id),
      FOREIGN KEY (opportunity_id) REFERENCES jobs(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_participants ON conversations(participant_one_id, participant_two_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, read_at)`);

  // Payment/subscription additions keep older installs compatible.
  addColumn('payments', 'user_id', 'INTEGER');
  addColumn('payments', 'invoice_id', 'INTEGER');
  addColumn('payments', 'item_type', 'TEXT');
  addColumn('payments', 'item_code', 'TEXT');
  addColumn('payments', 'gateway', "TEXT DEFAULT 'palplus'");
  addColumn('payments', 'gateway_reference', 'TEXT');
  addColumn('payments', 'checkout_request_id', 'TEXT');
  addColumn('payments', 'phone_number', 'TEXT');
  addColumn('payments', 'currency', "TEXT DEFAULT 'KES'");
  addColumn('payments', 'discount_code', 'TEXT');
  addColumn('payments', 'discount_amount', 'REAL DEFAULT 0');
  addColumn('payments', 'metadata', 'TEXT');
  addColumn('payments', 'updated_at', 'DATETIME');
  addColumn('payments', 'paid_at', 'DATETIME');

  addColumn('subscriptions', 'billing_cycle', "TEXT DEFAULT 'monthly'");
  addColumn('subscriptions', 'status', "TEXT DEFAULT 'active'");
  addColumn('subscriptions', 'job_limit', 'INTEGER DEFAULT 0');
  addColumn('subscriptions', 'seat_limit', 'INTEGER DEFAULT 1');
  addColumn('subscriptions', 'ai_enabled', 'INTEGER DEFAULT 0');
  addColumn('subscriptions', 'api_enabled', 'INTEGER DEFAULT 0');
  addColumn('subscriptions', 'cv_parsing_enabled', 'INTEGER DEFAULT 0');
  addColumn('subscriptions', 'current_period_start', 'DATETIME');
  addColumn('subscriptions', 'current_period_end', 'DATETIME');
  addColumn('subscriptions', 'renewal_date', 'DATETIME');
  addColumn('subscriptions', 'last_payment_id', 'INTEGER');
  addColumn('subscriptions', 'addons', 'TEXT');
  addColumn('subscriptions', 'created_at', 'DATETIME');
  addColumn('subscriptions', 'updated_at', 'DATETIME');

  db.run(`
    CREATE TABLE IF NOT EXISTS application_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      user_id INTEGER,
      applicant_email TEXT,
      application_method TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_application_events_job_id ON application_events(job_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_match_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      candidate_user_id INTEGER,
      opportunity_id INTEGER,
      action TEXT NOT NULL,
      score INTEGER,
      score_breakdown TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id),
      FOREIGN KEY (candidate_user_id) REFERENCES users(id),
      FOREIGN KEY (opportunity_id) REFERENCES jobs(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS candidate_opportunity_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_user_id INTEGER NOT NULL,
      opportunity_id INTEGER NOT NULL,
      match_score INTEGER NOT NULL,
      score_breakdown TEXT,
      match_reasons TEXT,
      missing_skills TEXT,
      strong_matches TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(candidate_user_id, opportunity_id),
      FOREIGN KEY (candidate_user_id) REFERENCES users(id),
      FOREIGN KEY (opportunity_id) REFERENCES jobs(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS recruiter_candidate_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recruiter_id INTEGER NOT NULL,
      candidate_user_id INTEGER NOT NULL,
      opportunity_id INTEGER NOT NULL,
      match_score INTEGER NOT NULL,
      score_breakdown TEXT,
      match_reasons TEXT,
      missing_requirements TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(recruiter_id, candidate_user_id, opportunity_id),
      FOREIGN KEY (recruiter_id) REFERENCES users(id),
      FOREIGN KEY (candidate_user_id) REFERENCES users(id),
      FOREIGN KEY (opportunity_id) REFERENCES jobs(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_candidate_matches_user ON candidate_opportunity_matches(candidate_user_id, match_score)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recruiter_matches_job ON recruiter_candidate_matches(opportunity_id, match_score)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ai_match_logs_actor ON ai_match_logs(actor_user_id, created_at)`);

  // Create profile_analytics table if not exists
  db.run(`
    CREATE TABLE IF NOT EXISTS profile_analytics (
      user_id INTEGER PRIMARY KEY,
      profile_views INTEGER DEFAULT 0,
      search_appearances INTEGER DEFAULT 0,
      recruiter_views INTEGER DEFAULT 0,
      applications INTEGER DEFAULT 0,
      interviews INTEGER DEFAULT 0,
      offers INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Create profile_checklist table if not exists
  db.run(`
    CREATE TABLE IF NOT EXISTS profile_checklist (
      user_id INTEGER PRIMARY KEY,
      profile_photo INTEGER DEFAULT 0,
      headline INTEGER DEFAULT 0,
      about INTEGER DEFAULT 0,
      skills INTEGER DEFAULT 0,
      education INTEGER DEFAULT 0,
      experience INTEGER DEFAULT 0,
      interests INTEGER DEFAULT 0,
      documents INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'local',
      bucket TEXT NOT NULL,
      object_key TEXT NOT NULL,
      file_url TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      size INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_files_user_type ON user_files(user_id, file_type)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS profile_education (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      education_level TEXT NOT NULL,
      institution_name TEXT NOT NULL,
      course TEXT,
      year_from INTEGER,
      year_to INTEGER,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS profile_experience (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      organization_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      employment_type TEXT,
      year_from INTEGER,
      year_to INTEGER,
      currently_working INTEGER DEFAULT 0,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS network_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected', 'blocked')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    )
  `);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_network_pair ON network_connections(requester_id, receiver_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_profile_education_user ON profile_education(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_profile_experience_user ON profile_experience(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_network_requester ON network_connections(requester_id, status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_network_receiver ON network_connections(receiver_id, status)`);
});

module.exports = db;
