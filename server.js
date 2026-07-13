require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const db = require('./database');
const { createRateLimiter } = require('./rate-limit');
const { seedAdminAccount } = require('./startup-admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function configuredOrigins() {
  const values = [
    process.env.CORS_ORIGINS,
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    process.env.PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(values)];
}

function validateEnvironment() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me') {
    const message = 'JWT_SECRET must be set to a strong unique value.';
    if (isProduction) {
      throw new Error(message);
    }
    console.warn(`Security warning: ${message}`);
  }

  if (isProduction && configuredOrigins().length === 0) {
    throw new Error('Set CORS_ORIGINS, FRONTEND_URL, APP_URL, or PUBLIC_URL before starting in production.');
  }
}

validateEnvironment();
seedAdminAccount().catch((error) => {
  console.error('Failed to seed admin account:', error.message || error);
});

// Simple in-memory log buffer for the admin dashboard
const serverLogs = [];
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  serverLogs.push({ type: 'info', timestamp: new Date().toISOString(), message: args.join(' ') });
  if (serverLogs.length > 100) serverLogs.shift();
  originalLog(...args);
};
console.error = (...args) => {
  serverLogs.push({ type: 'error', timestamp: new Date().toISOString(), message: args.join(' ') });
  if (serverLogs.length > 100) serverLogs.shift();
  originalError(...args);
};

// Middleware
const allowedOrigins = configuredOrigins();

// Make CORS explicit to avoid preflight failures.
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!isProduction && allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.static(path.join(__dirname)));


// Helpful request logging to debug “failed to fetch”/wrong routes
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});


// Import routes
const authRoutes = require('./auth-routes');
const jobsRoutes = require('./jobs-routes');
const recruiterRoutes = require('./recruiter-routes');
const adminRoutes = require('./admin-routes');
const paymentsRoutes = require('./payments-routes');
const emailRoutes = require('./email-routes');
const profileRoutes = require('./profile-routes');
const dashboardRoutes = require('./dashboard-routes');
const networkRoutes = require('./network-routes');
const messagesRoutes = require('./messages-routes');
const aiRoutes = require('./ai-routes');
const { authMiddleware, adminMiddleware } = require('./auth-middleware');
const { importExternalJobs } = require('./job-scraper');

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: 'Too many authentication attempts. Please try again later.',
  key: (req) => String(req.body?.email || '').toLowerCase(),
});
const adminRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many admin requests. Please slow down.',
});
const paymentRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 50,
  message: 'Too many payment requests. Please try again later.',
});
const emailRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many contact requests. Please try again later.',
  key: (req) => String(req.body?.email || '').toLowerCase(),
});



// Use routes
app.use('/api/auth', authRateLimiter);
app.use('/api/admin', adminRateLimiter);
app.use('/api/payments', paymentRateLimiter);
app.use('/api/email', emailRateLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/recruiter', recruiterRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/opportunities', dashboardRoutes);
app.use('/api/categories', dashboardRoutes);

app.get('/admin/opportunities/import', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

app.get(['/contact', '/contact-me'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/profile/me/:section?', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/profile/me/settings/:section', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/profile/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// Health check
app.get('/api/health', (req, res) => {
  const storageProvider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();
  const storageConfigured = storageProvider === 'local'
    || (storageProvider === 'r2'
      && Boolean((process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT) && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET && process.env.R2_PUBLIC_URL))
    || (storageProvider === 's3'
      && Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY && process.env.S3_BUCKET && process.env.S3_PUBLIC_URL))
    || (storageProvider === 'supabase'
      && Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)));
  res.json({
    status: 'Server running',
    database: db.isPostgres ? 'postgres' : 'sqlite',
    storage: {
      provider: storageProvider,
      configured: storageConfigured,
    },
  });
});

// Admin logs endpoint
app.get('/api/admin/system-logs', authMiddleware, adminMiddleware, (req, res) => {
  res.json(serverLogs);
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ error: err.message });
  }
  if (err?.name === 'MulterError' || /file type|File too large/i.test(err?.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled request error:', err?.message || err);
  return res.status(500).json({ error: 'Server error' });
});

// Automated Task: Check for expired subscriptions every hour
cron.schedule('0 * * * *', () => {
  const now = new Date().toISOString();
  
  db.serialize(() => {
    // 1. Deactivate expired subscriptions
    db.run(
      `UPDATE subscriptions SET active = 0, plan_type = 'free', status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE expiry_date < ? AND active = 1`,
      [now],
      function(err) {
        if (err) console.error('Cron Error (Sub):', err.message);
        else if (this.changes > 0) console.log(`⏰ Deactivated ${this.changes} expired subscriptions.`);
      }
    );

    // 2. Unfeature jobs from expired/free recruiters
    db.run(
      `UPDATE jobs SET featured = 0 
       WHERE COALESCE(free_featured_grant, 0) != 1
         AND recruiter_id IN (SELECT recruiter_id FROM subscriptions WHERE active = 0)`,
      function(err) {
        if (err) console.error('Cron Error (Jobs):', err.message);
      }
    );

    db.run(
      `UPDATE user_verifications SET status = 'expired', recruiter_visible = 0
       WHERE expires_at < ? AND status = 'approved'`,
      [now],
      function(err) {
        if (err) console.error('Cron Error (Verification):', err.message);
        else if (this.changes > 0) console.log(`Expired ${this.changes} verification badges.`);
      }
    );
  });
});

// Automated Task: Daily Payment Export (Runs at midnight)
cron.schedule('0 0 * * *', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  console.log(`📊 Generating daily payment report for ${dateStr}...`);

  const query = `
    SELECT p.created_at, u.name as recruiter_name, u.email as recruiter_email, 
           p.package_name, p.amount, p.transaction_id, p.status
    FROM payments p 
    JOIN users u ON p.recruiter_id = u.id 
    WHERE p.created_at >= date('now', '-1 day') AND p.created_at < date('now')
    ORDER BY p.created_at ASC
  `;

  db.all(query, [], async (err, rows) => {
    if (err) {
      console.error('Cron Error (Daily Report Query):', err.message);
      return;
    }

    if (rows.length === 0) {
      console.log(`ℹ️ No payments to report for ${dateStr}.`);
      return;
    }

    // Generate CSV string
    const headers = "Timestamp,Recruiter,Email,Package,Amount,TransactionID,Status";
    const csvRows = rows.map(r => `"${r.created_at}","${r.recruiter_name}","${r.recruiter_email}","${r.package_name}",${r.amount},"${r.transaction_id}","${r.status}"`);
    const csvContent = [headers, ...csvRows].join('\n');

    // Calculate total revenue from successful/completed payments
    const totalRevenue = rows
      .filter(r => r.status === 'success' || r.status === 'completed')
      .reduce((sum, r) => sum + r.amount, 0);

    // Send to your email
    await authRoutes.sendReportEmail('denismose098@gmail.com', csvContent, `HireKe_Daily_Report_${dateStr}.csv`, totalRevenue);
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`HireKe server running on http://localhost:${PORT}`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`✗ Port ${PORT} is already in use. Please kill the existing process or use a different port.`);
    process.exit(1);
  } else {
    console.error('✗ Server error:', e);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error(err);
    console.log('Database closed');
    process.exit(0);
  });
});
