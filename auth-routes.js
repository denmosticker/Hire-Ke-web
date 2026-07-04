const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const router = express.Router();
const { sendContactToBrevo } = require('./brevoService'); // Import Brevo service
const db = require('./database');
const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 8000);

// Configure email service
let transporter;

// Initialize email transporter
async function initializeEmailService() {
  try {
    // Check if custom SMTP is configured
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      console.log('✓ Email service initialized with custom SMTP');
      return;
    }

    // For development/testing, use Ethereal (free test email service)
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('✓ Email service initialized (Ethereal test account)');
    console.log('  Emails will be logged as test messages. Check console for preview URLs.');
  } catch (error) {
    console.error('✗ Failed to initialize email service:', error.message);
    console.log('  To fix: Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env file');
    // Don't throw - allow app to start without email for testing
  }
}

// Initialize email on startup
initializeEmailService();

// Helper to run queries with promisification
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

// Helper to generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function exposeTestOtp() {
  return process.env.EXPOSE_TEST_OTPS === 'true' && process.env.NODE_ENV !== 'production';
}

async function createVerificationOTP(userId, email) {
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await dbRun(
    `UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?`,
    [otp, expiresAt.toISOString(), userId]
  );

  await sendOTPEmail(email, otp);
  return otp;
}

function buildAuthPayload(user) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      company_name: user.company_name,
    },
  };
}

const socialProviders = {
  google: {
    label: 'Google',
    clientId: () => process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  github: {
    label: 'GitHub',
    clientId: () => process.env.GITHUB_CLIENT_ID || process.env.GITHUB_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET || process.env.GITHUB_OAUTH_CLIENT_SECRET,
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
  facebook: {
    label: 'Facebook',
    clientId: () => process.env.FACEBOOK_CLIENT_ID || process.env.FACEBOOK_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.FACEBOOK_CLIENT_SECRET || process.env.FACEBOOK_OAUTH_CLIENT_SECRET,
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scope: 'email public_profile',
  },
};

function getBaseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function encodeState(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function decodeState(state) {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch (_) {
    return {};
  }
}

function providerRedirectUri(req, provider) {
  return `${getBaseUrl(req)}/api/auth/social/${provider}/callback`;
}

async function exchangeCodeForToken(provider, code, redirectUri) {
  const config = socialProviders[provider];
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId(),
      client_secret: config.clientSecret(),
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Could not finish ${config.label} login.`);
  }
  return data.access_token;
}

async function getSocialProfile(provider, accessToken) {
  if (provider === 'google') {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    return { email: data.email, name: data.name || data.email?.split('@')[0] };
  }

  if (provider === 'github') {
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    const user = await userResponse.json();
    let email = user.email;
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
      });
      const emails = await emailsResponse.json();
      email = Array.isArray(emails) ? emails.find((item) => item.primary)?.email || emails.find((item) => item.verified)?.email : null;
    }
    return { email, name: user.name || user.login || email?.split('@')[0] };
  }

  if (provider === 'facebook') {
    const response = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`);
    const data = await response.json();
    return { email: data.email, name: data.name || data.email?.split('@')[0] };
  }

  throw new Error('Unsupported social login provider.');
}

async function findOrCreateSocialUser(profile, role) {
  if (!profile.email) {
    throw new Error('This provider did not return an email address. Please use email and password instead.');
  }

  const existing = await dbGet(`SELECT * FROM users WHERE email = ?`, [profile.email]);
  if (existing) {
    if (existing.email_verified !== 1) {
      await dbRun(`UPDATE users SET email_verified = 1, status = CASE WHEN status = 'pending' AND role != 'recruiter' THEN 'approved' ELSE status END WHERE id = ?`, [existing.id]);
      existing.email_verified = 1;
    }
    return existing;
  }

  const safeRole = role === 'recruiter' ? 'recruiter' : 'jobseeker';
  const hashedPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  const result = await dbRun(
    `INSERT INTO users (email, password, name, role, status, email_verified) VALUES (?, ?, ?, ?, ?, 1)`,
    [profile.email, hashedPassword, profile.name || profile.email.split('@')[0], safeRole, safeRole === 'recruiter' ? 'pending' : 'approved']
  );

  if (safeRole === 'recruiter') {
    await dbRun(`INSERT INTO subscriptions (recruiter_id, plan_type) VALUES (?, ?)`, [result.lastID, 'free']);
  }

  return dbGet(`SELECT * FROM users WHERE id = ?`, [result.lastID]);
}

function sendSocialSuccess(res, payload) {
  const destination = payload.user.role === 'recruiter' ? '/recruiter-dashboard.html' : '/';
  res.send(`<!doctype html><html><body><script>
    localStorage.setItem('token', ${JSON.stringify(payload.token)});
    localStorage.setItem('userRole', ${JSON.stringify(payload.user.role)});
    window.location.replace(${JSON.stringify(destination)});
  </script></body></html>`);
}

// Helper to send OTP email
async function sendOTPEmail(email, otp) {
  if (!transporter) {
    const errorMsg = 'Email service not initialized. Check server logs for configuration errors.';
    console.error('✗ ' + errorMsg);
    throw new Error(errorMsg);
  }

  if (exposeTestOtp()) {
    console.log('DEV OTP for', email, ':', otp);
  }

  const mailOptions = {
    from: '"HireKe" <noreply@hireke.com>',
    to: email,
    subject: 'HireKe Verification Code', // Ensure this is a string, not a variable named subjectline
    html: `
      <h2>Your OTP</h2>
      <p>Your One-Time Password (OTP) is below.</p>
      <h1 style="color: #007bff; letter-spacing: 5px;">${otp}</h1>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
      <hr>
      <p style="color: #666; font-size: 12px;">HireKe - Job Platform</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✓ OTP email sent successfully to:', email);
    
    // Log preview URL for testing with Ethereal
    if (process.env.NODE_ENV !== 'production') {
      try {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          console.log('  Preview URL:', previewUrl);
        }
      } catch (e) {
        // Ethereal preview not available, that's fine
      }
    }
    
    return info;
  } catch (error) {
    console.error('✗ Failed to send OTP email to', email, ':', error.message);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

// Helper to send Status Update email
async function sendStatusUpdateEmail(email, jobTitle, status, note) {
  if (!transporter) return;

  const mailOptions = {
    from: '"HireKe" <noreply@hireke.com>',
    to: email,
    subject: `Application Update: ${jobTitle}`,
    html: `
      <h2>Good news!</h2>
      <p>Your application for <strong>${jobTitle}</strong> has been updated to: <span style="color: #007bff; font-weight: bold;">${status}</span></p>
      ${note ? `<p><strong>Recruiter Note:</strong> ${note}</p>` : ''}
      <p>Log in to your dashboard to see more details.</p>
      <hr>
      <p style="color: #666; font-size: 12px;">HireKe - Job Platform</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✓ Status update email sent to: ${email}`);
  } catch (error) {
    console.error('✗ Failed to send status update email:', error.message);
  }
}

// Helper to send Expiry Warning email
async function sendExpiryWarningEmail(email, daysLeft) {
  if (!transporter) return;
  const mailOptions = {
    from: '"HireKe" <noreply@hireke.com>',
    to: email,
    subject: `Urgent: Your HireKe Subscription expires in ${daysLeft} days`,
    html: `
      <h2>Subscription Expiring Soon</h2>
      <p>Your premium recruitment features will expire in <strong>${daysLeft} days</strong>.</p>
      <p>To avoid losing your featured job listings and premium badge, please renew your subscription via the dashboard.</p>
      <hr>
      <p style="color: #666; font-size: 12px;">HireKe - Job Platform</p>
    `,
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log(`✓ Expiry warning sent to: ${email}`);
  } catch (error) {
    console.error('✗ Failed to send expiry warning:', error.message);
  }
}

// Helper to send Payment Rejection email
async function sendPaymentRejectionEmail(email, mpesaCode, packageName) {
  if (!transporter) return;
  const mailOptions = {
    from: '"HireKe" <noreply@hireke.com>',
    to: email,
    subject: `Payment Verification Failed - HireKe`,
    html: `
      <h2>Payment Verification Failed</h2>
      <p>We could not verify your payment for the <strong>${packageName}</strong> package.</p>
      <p><strong>Transaction Code:</strong> ${mpesaCode}</p>
      <p>Reason: The provided transaction code could not be found on our M-Pesa statement.</p>
      <p>Please double-check the code and try again in the billing section of your dashboard, or contact support if you believe this is an error.</p>
      <hr>
      <p style="color: #666; font-size: 12px;">HireKe - Job Platform</p>
    `,
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log(`✓ Rejection email sent to: ${email}`);
  } catch (error) {
    console.error('✗ Failed to send rejection email:', error.message);
  }
}

// Helper to send Suspension email
async function sendSuspensionEmail(email) {
  if (!transporter) return;
  const mailOptions = {
    from: '"HireKe" <noreply@hireke.com>',
    to: email,
    subject: `Account Status Update - HireKe`,
    html: `
      <h2>Notice of Account Suspension</h2>
      <p>We are writing to inform you that your HireKe account has been suspended.</p>
      <p>During this time, you will not be able to log in, post jobs, or apply for positions.</p>
      <p>If you believe this is a mistake or would like to appeal this decision, please contact our support team at <strong>hello@hireke.co.ke</strong>.</p>
      <hr>
      <p style="color: #666; font-size: 12px;">HireKe - Job Platform</p>
    `,
  };
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('✗ Failed to send suspension email:', error.message);
  }
}

// Helper to send the Daily Report with attachment
async function sendReportEmail(to, csvContent, filename, totalRevenue) {
  if (!transporter) return;

  const mailOptions = {
    from: '"HireKe System" <noreply@hireke.com>',
    to: to,
    subject: `Daily Payment Report - ${new Date().toLocaleDateString()}`,
    text: `Please find attached the daily payment statement for ${new Date().toLocaleDateString()}.\n\nTotal Successful Revenue for this period: KES ${totalRevenue.toLocaleString()}`,
    attachments: [
      {
        filename: filename,
        content: csvContent,
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✓ Daily report emailed to: ${to}`);
  } catch (error) {
    console.error('✗ Failed to send daily report email:', error.message);
  }
}

// Export the email helper
router.sendStatusUpdateEmail = sendStatusUpdateEmail;
router.sendExpiryWarningEmail = sendExpiryWarningEmail;
router.sendPaymentRejectionEmail = sendPaymentRejectionEmail;
router.sendSuspensionEmail = sendSuspensionEmail;
router.sendReportEmail = sendReportEmail;

router.get('/social/:provider/start', (req, res) => {
  const { provider } = req.params;
  const config = socialProviders[provider];
  if (!config) {
    return res.status(404).json({ error: 'Unsupported social login provider.' });
  }

  if (!config.clientId() || !config.clientSecret()) {
    return res.status(501).json({
      error: `${config.label} login is not configured yet. Add ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET to .env.`,
    });
  }

  const role = req.query.role === 'recruiter' ? 'recruiter' : 'jobseeker';
  const params = new URLSearchParams({
    client_id: config.clientId(),
    redirect_uri: providerRedirectUri(req, provider),
    response_type: 'code',
    scope: config.scope,
    state: encodeState({ role }),
  });

  if (provider === 'google') {
    params.set('access_type', 'offline');
    params.set('prompt', 'select_account');
  }

  return res.json({ authUrl: `${config.authUrl}?${params.toString()}` });
});

router.get('/social/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const config = socialProviders[provider];
  if (!config) return res.redirect('/?social=unsupported');
  if (req.query.error) return res.redirect(`/?social=error&provider=${encodeURIComponent(provider)}`);
  if (!req.query.code) return res.redirect(`/?social=missing-code&provider=${encodeURIComponent(provider)}`);

  try {
    const state = decodeState(req.query.state);
    const accessToken = await exchangeCodeForToken(provider, req.query.code, providerRedirectUri(req, provider));
    const profile = await getSocialProfile(provider, accessToken);
    const user = await findOrCreateSocialUser(profile, state.role);
    sendSocialSuccess(res, buildAuthPayload(user));
  } catch (error) {
    console.error(`${config.label} OAuth error:`, error.message);
    res.redirect(`/?social=error&provider=${encodeURIComponent(provider)}&message=${encodeURIComponent(error.message)}`);
  }
});

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name, role, company_name, company_url, marketing_optin, county, industry } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['jobseeker', 'recruiter'].includes(role)) {
      return res.status(400).json({ error: 'Invalid signup role' });
    }

    // Password complexity check: 6+ chars, 1 uppercase, 1 number, 1 symbol
    const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{6,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long, contain at least one uppercase letter, one number, and one symbol.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await dbRun(
      `INSERT INTO users (email, password, name, role, company_name, company_url, status, marketing_optin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        email,
        hashedPassword,
        name,
        role,
        company_name || null,
        company_url || null,
        role === 'recruiter' ? 'pending' : 'approved',
        marketing_optin ? 1 : 0,
      ]
    );
    
    // If user opted into marketing, send to Brevo (fire and forget)
    if (marketing_optin) {
      sendContactToBrevo(email, name, role, county, industry).catch(err => {
        // Log error but don't block signup flow
        console.error('Error sending contact to Brevo:', err.message);
      });
    }


    // Create subscription for recruiters
    if (role === 'recruiter') {
      await dbRun(
        `INSERT INTO subscriptions (recruiter_id, plan_type) VALUES (?, ?)`,
        [result.lastID, 'free']
      );
    }

    const testOTP = await createVerificationOTP(result.lastID, email);

    res.json({
      success: true,
      requiresVerification: true,
      verificationSent: true,
      email,
      message: 'Account created. Verification code sent to your email.',
      testOTP: exposeTestOtp() ? testOTP : undefined,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const user = await dbGet(
      `SELECT * FROM users WHERE email = ?`,
      [email]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Block suspended users from logging in
    if (user.status === 'rejected') {
      return res.status(403).json({
        error: 'Your account has been suspended. Please contact support for assistance.'
      });
    }

    // Block unverified users from logging in
    // (signup-verification uses email_verified)
    if (user.email_verified !== 1) {
      const testOTP = await createVerificationOTP(user.id, user.email);
      return res.status(403).json({
        error: 'Email not verified. We sent a verification code to your email.',
        unverified: true,
        verificationSent: true,
        email: user.email,
        testOTP: exposeTestOtp() ? testOTP : undefined,
      });
    }

    res.json(buildAuthPayload(user));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await dbGet(
      `SELECT id, email, name, role, status, company_name, company_url, company_logo, email_verified FROM users WHERE id = ?`,
      [decoded.id]
    );

    if (!user || user.email_verified !== 1) {
      return res.status(403).json({ error: 'Email verification required', unverified: true, email: user?.email });
    }

    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Forgot Password - Send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await dbGet(
      `SELECT id, email FROM users WHERE email = ?`,
      [email]
    );

    if (!user) {
      // Don't reveal if email exists or not (security best practice)
      return res.json({ message: 'If this email exists, an OTP has been sent' });
    }

    // Generate OTP (6 digits)
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    await dbRun(
      `UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?`,
      [otp, expiresAt.toISOString(), user.id]
    );

    // Send OTP via email
    try {
      await sendOTPEmail(email, otp);
      res.json({ 
        message: 'OTP sent to your email',
        success: true,
        testOTP: exposeTestOtp() ? otp : undefined
      });
    } catch (emailError) {
      console.error('✗ Error in /forgot-password endpoint:', emailError.message);
      res.status(500).json({ 
        error: emailError.message || 'Failed to send OTP. Please check your email configuration and try again.',
        details: process.env.NODE_ENV !== 'production' ? emailError.message : undefined
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify OTP for password reset
router.post('/verify-otp-reset', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const user = await dbGet(
      `SELECT id, otp_code, otp_expires_at FROM users WHERE email = ?`,
      [email]
    );

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.otp_code) {
      return res.status(400).json({ error: 'No OTP request found. Please request a new one.' });
    }

    // Check if OTP matches
    if (user.otp_code !== otp) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    // Check if OTP has expired
    if (new Date(user.otp_expires_at) < new Date()) {
      return res.status(401).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // OTP is valid - generate a temporary reset token
    const resetToken = jwt.sign(
      { id: user.id, email, purpose: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({ 
      message: 'OTP verified successfully',
      resetToken,
      success: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetToken, newPassword, confirmPassword } = req.body;

    if (!email || !resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Verify reset token
    try {
      const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
      
      if (decoded.purpose !== 'password-reset' || decoded.email !== email) {
        return res.status(401).json({ error: 'Invalid reset token' });
      }
    } catch (tokenError) {
      return res.status(401).json({ error: 'Reset token expired or invalid' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear OTP
    await dbRun(
      `UPDATE users SET password = ?, otp_code = NULL, otp_expires_at = NULL WHERE email = ?`,
      [hashedPassword, email]
    );

    res.json({ 
      message: 'Password reset successfully. Please log in with your new password.',
      success: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await dbGet(
      `SELECT id, email FROM users WHERE email = ?`,
      [email]
    );

    if (!user) {
      return res.json({ message: 'If this email exists, an OTP has been sent' });
    }

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update OTP in database
    await dbRun(
      `UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?`,
      [otp, expiresAt.toISOString(), user.id]
    );

    // Send OTP via email
    try {
      await sendOTPEmail(email, otp);
      res.json({ 
        message: 'New OTP sent to your email',
        success: true,
        testOTP: exposeTestOtp() ? otp : undefined
      });
    } catch (emailError) {
      console.error('✗ Error in /resend-otp endpoint:', emailError.message);
      res.status(500).json({ 
        error: emailError.message || 'Failed to send OTP. Please check your email configuration and try again.',
        details: process.env.NODE_ENV !== 'production' ? emailError.message : undefined
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send verification OTP (email verification after signup)
router.post('/send-verification-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await dbGet(`SELECT id, email FROM users WHERE email = ?`, [email]);
    if (!user) {
      // Don’t reveal whether email exists
      return res.json({ message: 'If this email exists, an OTP has been sent', success: true });
    }

    const otp = await createVerificationOTP(user.id, email);

    return res.json({
      message: 'Verification OTP sent to your email',
      success: true,
      testOTP: exposeTestOtp() ? otp : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify email with OTP
router.post('/verify-email', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    const user = await dbGet(`SELECT id, email, name, role, status, company_name, otp_code, otp_expires_at, email_verified FROM users WHERE email = ?`, [email]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    if (user.email_verified === 1) {
      return res.json({ success: true, message: 'Email already verified' });
    }

    if (!user.otp_code) {
      return res.status(400).json({ error: 'No OTP request found. Please request a new one.' });
    }

    if (String(user.otp_code) !== String(otp)) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    if (!user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      return res.status(401).json({ error: 'OTP has expired. Please request a new one.' });
    }

    await dbRun(
      `UPDATE users SET email_verified = 1, otp_code = NULL, otp_expires_at = NULL WHERE id = ?`,
      [user.id]
    );

    return res.json({
      success: true,
      message: 'Email verified successfully',
      ...buildAuthPayload(user),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resend verification OTP
router.post('/resend-verification-otp', async (req, res) => {

  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await dbGet(`SELECT id, email, email_verified FROM users WHERE email = ?`, [email]);
    if (!user) {
      return res.json({ message: 'If this email exists, an OTP has been sent', success: true });
    }

    if (user.email_verified === 1) {
      return res.json({ success: true, message: 'Email already verified' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await dbRun(
      `UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?`,
      [otp, expiresAt.toISOString(), user.id]
    );

    await sendOTPEmail(email, otp);

    return res.json({
      message: 'New verification OTP sent to your email',
      success: true,
      testOTP: exposeTestOtp() ? otp : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send phone OTP (signup / optional phone verification)
router.post('/send-phone-otp', async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email || !phone) {
      return res.status(400).json({ error: 'Email and phone are required' });
    }

    const user = await dbGet(`SELECT id, email FROM users WHERE email = ?`, [email]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await dbRun(
      `UPDATE users SET phone_otp_code = ?, phone_otp_expires_at = ? WHERE id = ?`,
      [otp, expiresAt.toISOString(), user.id]
    );

    // NOTE: Phone OTP delivery is not implemented (SMS provider missing).
    // For now we only generate/store OTP and (optionally) email it for testing.
    // Reuse email channel so you can still test the flow.
    await sendOTPEmail(email, otp);

    return res.json({
      message: 'Phone verification OTP sent',
      success: true,
      testOTP: exposeTestOtp() ? otp : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify phone OTP
router.post('/verify-phone-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const user = await dbGet(
      `SELECT id, phone_otp_code, phone_otp_expires_at FROM users WHERE email = ?`,
      [email]
    );

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.phone_otp_code) {
      return res.status(400).json({ error: 'No OTP request found. Please request a new one.' });
    }

    if (String(user.phone_otp_code) !== String(otp)) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    if (!user.phone_otp_expires_at || new Date(user.phone_otp_expires_at) < new Date()) {
      return res.status(401).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // Clear phone OTP
    await dbRun(
      `UPDATE users SET phone_otp_code = NULL, phone_otp_expires_at = NULL WHERE id = ?`,
      [user.id]
    );

    return res.json({
      success: true,
      message: 'Phone OTP verified successfully',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resend phone OTP
router.post('/resend-phone-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await dbGet(`SELECT id, email FROM users WHERE email = ?`, [email]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await dbRun(
      `UPDATE users SET phone_otp_code = ?, phone_otp_expires_at = ? WHERE id = ?`,
      [otp, expiresAt.toISOString(), user.id]
    );

    await sendOTPEmail(email, otp);

    return res.json({
      message: 'New phone OTP sent',
      success: true,
      testOTP: exposeTestOtp() ? otp : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log interactions (Clicks/Views)
router.post('/log-click', async (req, res) => {
  try {
    const { element_type, element_name, action, page } = req.body;
    const userId = req.headers.authorization ? jwt.decode(req.headers.authorization.split(' ')[1])?.id : null;

    await dbRun(
      `INSERT INTO clicks (user_id, element_type, element_name, action, page) VALUES (?, ?, ?, ?, ?)`,
      [userId, element_type, element_name, action, page]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get Profile Views count for job seeker
router.get('/profile-views', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Count clicks where element_name is the user's ID and type is profile_view
    const result = await dbGet(
      `SELECT COUNT(*) as count FROM clicks WHERE element_type = 'profile_view' AND element_name = ?`,
      [decoded.id.toString()]
    );

    res.json({ count: result?.count || 0 });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
