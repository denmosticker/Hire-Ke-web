const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./database');
const { authMiddleware } = require('./auth-middleware');
const { saveObject } = require('./storage-service');
const {
  RECRUITER_PLANS,
  ADD_ONS,
  VERIFICATION_PLANS,
  getItem,
  createPaymentIntent,
  processPalplusCallback,
  getPaymentHistory,
} = require('./payment-service');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']);
    const allowedMimeTypes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    if (!allowedExtensions.has(ext) || !allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error('Unsupported verification document type'));
    }
    cb(null, true);
  },
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
});

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
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

function publicCatalog() {
  const sanitize = (entries) => Object.entries(entries).map(([code, item]) => ({
    code,
    name: item.name,
    amount: item.amount,
    itemType: item.itemType,
    plan: item.plan,
    billingCycle: item.billingCycle,
    jobLimit: item.jobLimit,
    seatLimit: item.seatLimit,
    aiEnabled: Boolean(item.aiEnabled),
    apiEnabled: Boolean(item.apiEnabled),
    cvParsingEnabled: Boolean(item.cvParsingEnabled),
    level: item.level,
    durationDays: item.durationDays,
    customPricing: Boolean(item.customPricing),
  }));

  return {
    recruiterPlans: sanitize(RECRUITER_PLANS),
    addons: sanitize(ADD_ONS),
    verificationPlans: sanitize(VERIFICATION_PLANS),
    offers: [
      { code: 'FIRST3MONTHS50', label: '50% off first 3 months' },
      { code: 'NGO30', label: 'NGO Discount: 30%' },
      { code: 'REFERRAL_MONTH', label: 'Referral: 1 free month per 2 recruiters' },
    ],
  };
}

async function currentUser(userId) {
  const user = await dbGet(
    `SELECT id, email, name, role, company_name FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) throw new Error('User not found');
  return user;
}

router.get('/catalog', (_req, res) => {
  res.json(publicCatalog());
});

router.post('/stk-push', authMiddleware, async (req, res) => {
  try {
    const { itemCode, phone, discountCode, metadata } = req.body;
    const item = getItem(itemCode);
    if (!item) return res.status(400).json({ error: 'Unknown payment item' });
    if (['subscription', 'addon'].includes(item.itemType) && req.user.role !== 'recruiter') {
      return res.status(403).json({ error: 'Recruiter account required for this payment' });
    }

    const user = await currentUser(req.user.id);
    const result = await createPaymentIntent({
      user,
      itemCode,
      phone,
      discountCode,
      metadata: metadata || {},
    });

    res.json({
      success: true,
      message: result.status === 'success' ? 'Payment activated.' : 'STK Push sent. Enter your M-Pesa PIN to complete payment.',
      ...result,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/history', authMiddleware, async (req, res) => {
  try {
    res.json(await getPaymentHistory(req.user.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/status/:reference', authMiddleware, async (req, res) => {
  try {
    const payment = await dbGet(
      `SELECT p.*, i.invoice_number
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE (p.tx_ref = ? OR p.transaction_id = ? OR p.gateway_reference = ?) AND (p.user_id = ? OR p.recruiter_id = ?)`,
      [req.params.reference, req.params.reference, req.params.reference, req.user.id, req.user.id]
    );
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/palplus/callback', async (req, res) => {
  try {
    const result = await processPalplusCallback(req);
    res.json({ received: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.get('/billing', authMiddleware, async (req, res) => {
  try {
    const subscription = await dbGet(`SELECT * FROM subscriptions WHERE recruiter_id = ?`, [req.user.id]);
    const invoices = await dbAll(
      `SELECT * FROM invoices WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
      [req.user.id]
    );
    const payments = await getPaymentHistory(req.user.id);
    res.json({
      subscription: subscription || { plan_type: 'free', active: 1, job_limit: 0, seat_limit: 1 },
      invoices,
      payments,
      catalog: publicCatalog(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/verification', authMiddleware, async (req, res) => {
  try {
    const verification = await dbGet(`SELECT * FROM user_verifications WHERE user_id = ?`, [req.user.id]);
    const requests = await dbAll(
      `SELECT * FROM verification_requests WHERE user_id = ? ORDER BY datetime(submitted_at) DESC`,
      [req.user.id]
    );
    const latestRequest = requests[0];
    const documents = latestRequest
      ? await dbAll(`SELECT * FROM verification_documents WHERE request_id = ? ORDER BY uploaded_at DESC`, [latestRequest.id])
      : [];

    res.json({
      verification: verification || { level: 'none', status: 'none', priority_rank: 0 },
      requests,
      documents,
      plans: publicCatalog().verificationPlans,
      requiredDocuments: ['National ID/Passport', 'Certificates', 'References', 'Work Permit (optional)'],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/verification/submit', authMiddleware, upload.array('documents', 8), async (req, res) => {
  try {
    const planCode = req.body.planCode || 'standard';
    const item = VERIFICATION_PLANS[planCode];
    if (!item) return res.status(400).json({ error: 'Unknown verification plan' });

    const request = await dbRun(
      `INSERT INTO verification_requests (user_id, plan_code, level_requested, status, amount, notes)
       VALUES (?, ?, ?, 'submitted', ?, ?)`,
      [req.user.id, planCode, item.level, item.amount, req.body.notes || null]
    );

    const documentTypes = Array.isArray(req.body.documentTypes)
      ? req.body.documentTypes
      : String(req.body.documentTypes || '').split(',').filter(Boolean);

    for (const [index, file] of (req.files || []).entries()) {
      const stored = await saveObject({ bucket: 'documents', userId: req.user.id, file });
      await dbRun(
        `INSERT INTO verification_documents (request_id, user_id, document_type, file_url, original_name)
         VALUES (?, ?, ?, ?, ?)`,
        [
          request.lastID,
          req.user.id,
          documentTypes[index] || 'supporting_document',
          stored.url,
          file.originalname,
        ]
      );
      await dbRun(
        `INSERT INTO user_files (user_id, file_type, provider, bucket, object_key, file_url, original_name, mime_type, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          'verification_document',
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

    if (item.amount === 0) {
      await dbRun(
        `INSERT INTO user_verifications (user_id, level, badge_label, status, priority_rank, recruiter_visible, last_request_id)
         VALUES (?, 'none', NULL, 'pending', ?, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET status = 'pending', priority_rank = excluded.priority_rank, last_request_id = excluded.last_request_id`,
        [req.user.id, item.priorityRank, request.lastID]
      );
      return res.json({ success: true, requestId: request.lastID, status: 'pending', message: 'Verification submitted for review.' });
    }

    res.json({
      success: true,
      requestId: request.lastID,
      requiresPayment: true,
      paymentItemCode: planCode,
      amount: item.amount,
      message: 'Verification request saved. Pay with M-Pesa to enter the priority queue.',
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/verification/pay', authMiddleware, async (req, res) => {
  try {
    const request = await dbGet(
      `SELECT * FROM verification_requests WHERE id = ? AND user_id = ?`,
      [req.body.requestId, req.user.id]
    );
    if (!request) return res.status(404).json({ error: 'Verification request not found' });
    const itemCode = request.plan_code;
    if (!VERIFICATION_PLANS[itemCode]) return res.status(400).json({ error: 'Verification plan cannot be paid' });

    const user = await currentUser(req.user.id);
    const result = await createPaymentIntent({
      user,
      itemCode,
      phone: req.body.phone,
      discountCode: null,
      metadata: { verificationRequestId: request.id },
    });

    res.json({
      success: true,
      message: result.status === 'success' ? 'Verification payment completed.' : 'STK Push sent. Enter your M-Pesa PIN to complete payment.',
      ...result,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
