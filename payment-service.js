const crypto = require('crypto');
const axios = require('axios');
const db = require('./database');

const STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

const RECRUITER_PLANS = {
  starter_monthly: {
    itemType: 'subscription',
    plan: 'starter',
    billingCycle: 'monthly',
    name: 'Starter Monthly',
    amount: 2500,
    jobLimit: 5,
    seatLimit: 1,
    aiEnabled: 0,
    apiEnabled: 0,
    cvParsingEnabled: 0,
  },
  professional_monthly: {
    itemType: 'subscription',
    plan: 'professional',
    billingCycle: 'monthly',
    name: 'Professional Monthly',
    amount: 5500,
    jobLimit: 25,
    seatLimit: 5,
    aiEnabled: 1,
    apiEnabled: 0,
    cvParsingEnabled: 0,
  },
  business_monthly: {
    itemType: 'subscription',
    plan: 'business',
    billingCycle: 'monthly',
    name: 'Business Monthly',
    amount: 12000,
    jobLimit: -1,
    seatLimit: 15,
    aiEnabled: 1,
    apiEnabled: 1,
    cvParsingEnabled: 1,
  },
  enterprise_monthly: {
    itemType: 'subscription',
    plan: 'enterprise',
    billingCycle: 'monthly',
    name: 'Enterprise Monthly',
    amount: 25000,
    jobLimit: -1,
    seatLimit: -1,
    aiEnabled: 1,
    apiEnabled: 1,
    cvParsingEnabled: 1,
  },
  starter_annual: {
    itemType: 'subscription',
    plan: 'starter',
    billingCycle: 'annual',
    name: 'Starter Annual',
    amount: 25000,
    jobLimit: 5,
    seatLimit: 1,
    aiEnabled: 0,
    apiEnabled: 0,
    cvParsingEnabled: 0,
  },
  professional_annual: {
    itemType: 'subscription',
    plan: 'professional',
    billingCycle: 'annual',
    name: 'Professional Annual',
    amount: 55000,
    jobLimit: 25,
    seatLimit: 5,
    aiEnabled: 1,
    apiEnabled: 0,
    cvParsingEnabled: 0,
  },
  business_annual: {
    itemType: 'subscription',
    plan: 'business',
    billingCycle: 'annual',
    name: 'Business Annual',
    amount: 120000,
    jobLimit: -1,
    seatLimit: 15,
    aiEnabled: 1,
    apiEnabled: 1,
    cvParsingEnabled: 1,
  },
  enterprise_annual: {
    itemType: 'subscription',
    plan: 'enterprise',
    billingCycle: 'annual',
    name: 'Enterprise Annual',
    amount: 25000,
    customPricing: true,
    jobLimit: -1,
    seatLimit: -1,
    aiEnabled: 1,
    apiEnabled: 1,
    cvParsingEnabled: 1,
  },
};

const ADD_ONS = {
  featured_job: { itemType: 'addon', name: 'Featured Job', amount: 1000 },
  email_blast: { itemType: 'addon', name: 'Email Blast', amount: 500 },
  cv_database_monthly: { itemType: 'addon', name: 'CV Database Monthly', amount: 1500 },
  ats_setup: { itemType: 'addon', name: 'ATS Setup', amount: 3000 },
};

const VERIFICATION_PLANS = {
  standard: { itemType: 'verification', name: 'Standard Verification', amount: 0, level: 'L1', durationDays: 365, priorityRank: 1 },
  express: { itemType: 'verification', name: 'Express Verification', amount: 500, level: 'L1', durationDays: 365, priorityRank: 2 },
  premium_monthly: { itemType: 'verification', name: 'Premium Verification Monthly', amount: 999, level: 'L3', durationDays: 30, priorityRank: 5 },
  premium_annual: { itemType: 'verification', name: 'Premium Verification Annual', amount: 9999, level: 'L3', durationDays: 365, priorityRank: 5 },
};

const CATALOG = {
  ...RECRUITER_PLANS,
  ...ADD_ONS,
  ...VERIFICATION_PLANS,
};

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

function json(value) {
  return JSON.stringify(value || {});
}

function merchantReference(prefix = 'HK') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function invoiceNumber() {
  return `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

function applyDiscount(item, discountCode) {
  const code = String(discountCode || '').trim().toLowerCase();
  const amount = Number(item.amount || 0);
  if (!code || amount <= 0) return { amount, discountAmount: 0, discountCode: null };
  if (code === 'ngo30') return { amount: Math.round(amount * 0.7), discountAmount: Math.round(amount * 0.3), discountCode: 'NGO30' };
  if (code === 'first3months50' && item.itemType === 'subscription' && item.billingCycle === 'monthly') {
    return { amount: Math.round(amount * 0.5), discountAmount: Math.round(amount * 0.5), discountCode: 'FIRST3MONTHS50' };
  }
  return { amount, discountAmount: 0, discountCode: null };
}

function getItem(itemCode) {
  const normalizedCode = itemCode === 'annual' ? 'premium_annual' : itemCode;
  const item = CATALOG[normalizedCode];
  if (!item) return null;
  return { ...item, itemCode: normalizedCode };
}

async function logPaymentEvent(paymentId, transactionId, eventType, status, message, payload = {}) {
  await dbRun(
    `INSERT INTO payment_events (payment_id, transaction_id, gateway, event_type, status, message, payload)
     VALUES (?, ?, 'palplus', ?, ?, ?, ?)`,
    [paymentId || null, transactionId || null, eventType, status || null, message || null, json(payload)]
  );
}

function palplusHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.PALPLUS_API_KEY) headers.Authorization = `Bearer ${process.env.PALPLUS_API_KEY}`;
  if (process.env.PALPLUS_CLIENT_ID) headers['X-Client-Id'] = process.env.PALPLUS_CLIENT_ID;
  if (process.env.PALPLUS_SECRET_KEY) headers['X-Api-Secret'] = process.env.PALPLUS_SECRET_KEY;
  return headers;
}

function palplusPayload({ user, phoneNumber, amount, reference, description }) {
  return {
    phone_number: phoneNumber,
    amount,
    currency: 'KES',
    reference,
    account_reference: reference,
    description,
    callback_url: process.env.PALPLUS_CALLBACK_URL || `${process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000'}/api/payments/palplus/callback`,
    customer: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  };
}

async function sendPalplusStkPush(payload) {
  const endpoint = process.env.PALPLUS_STK_PUSH_URL;
  if (!endpoint || process.env.PALPLUS_MOCK === 'true') {
    return {
      ok: true,
      mock: true,
      checkoutRequestId: `MOCK-${Date.now()}`,
      gatewayReference: payload.reference,
      raw: { message: 'Mock PalPlus STK push queued', reference: payload.reference },
    };
  }

  const { data } = await axios.post(endpoint, payload, {
    headers: palplusHeaders(),
    timeout: Number(process.env.PALPLUS_TIMEOUT_MS || 20000),
  });

  return {
    ok: true,
    checkoutRequestId: data.checkout_request_id || data.CheckoutRequestID || data.checkoutRequestId || data.request_id || null,
    gatewayReference: data.transaction_id || data.TransactionID || data.reference || data.merchant_request_id || null,
    raw: data,
  };
}

function verifyCallbackSignature(req) {
  const secret = process.env.PALPLUS_CALLBACK_SECRET || process.env.PALPLUS_SECRET_KEY;
  if (!secret) return { verified: false, reason: 'PALPLUS_CALLBACK_SECRET is not configured' };

  const signature = req.headers['x-palplus-signature'] || req.headers['x-signature'] || req.body?.signature;
  if (!signature) return { verified: false, reason: 'Missing PalPlus callback signature' };

  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = String(signature).replace(/^sha256=/, '');

  const verified = expected.length === given.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  return { verified, signature: String(signature), reason: verified ? null : 'Invalid callback signature' };
}

function parsePalplusCallback(body) {
  const resultCode = body.result_code ?? body.ResultCode ?? body.code ?? body.status_code;
  const statusText = String(body.status || body.Status || body.result || '').toLowerCase();
  const success = resultCode === 0 || resultCode === '0' || ['success', 'successful', 'completed', 'paid'].includes(statusText);
  const cancelled = ['cancelled', 'canceled'].includes(statusText);
  const failed = !success && (cancelled || resultCode !== undefined || statusText);

  return {
    merchantReference: body.reference || body.merchant_reference || body.account_reference || body.external_reference || body.MerchantRequestID,
    checkoutRequestId: body.checkout_request_id || body.CheckoutRequestID || body.request_id,
    gatewayReference: body.transaction_id || body.mpesa_receipt_number || body.MpesaReceiptNumber || body.receipt || body.reference_id,
    phoneNumber: body.phone_number || body.msisdn || body.PhoneNumber,
    amount: Number(body.amount || body.Amount || 0),
    status: success ? STATUS.SUCCESS : cancelled ? STATUS.CANCELLED : failed ? STATUS.FAILED : STATUS.PENDING,
    resultDescription: body.result_description || body.ResultDesc || body.message || statusText || null,
  };
}

async function createPaymentIntent({ user, itemCode, phone, discountCode, metadata = {} }) {
  const item = getItem(itemCode);
  if (!item) throw new Error('Unknown payment item');
  if (item.customPricing && !metadata.customAmount) throw new Error('Enterprise pricing requires a custom amount');

  const pricedItem = { ...item, amount: item.customPricing ? Number(metadata.customAmount) : item.amount };
  const pricing = applyDiscount(pricedItem, discountCode);
  const reference = merchantReference(item.itemType === 'verification' ? 'HKV' : item.itemType === 'addon' ? 'HKA' : 'HKS');
  const normalizedPhone = normalizePhone(phone);
  if (pricing.amount > 0 && !/^254\d{9}$/.test(normalizedPhone)) throw new Error('Use a valid Kenyan phone number for M-Pesa STK Push');

  const invoiceDueDate = new Date(Date.now() + 86400000).toISOString();
  const invoice = await dbRun(
    `INSERT INTO invoices (user_id, invoice_number, item_type, item_code, description, amount, currency, status, due_date)
     VALUES (?, ?, ?, ?, ?, ?, 'KES', ?, ?)`,
    [user.id, invoiceNumber(), item.itemType, itemCode, item.name, pricing.amount, pricing.amount === 0 ? STATUS.SUCCESS : STATUS.PENDING, invoiceDueDate]
  );

  const payment = await dbRun(
    `INSERT INTO payments (
       recruiter_id, user_id, invoice_id, amount, transaction_id, tx_ref, package_name, payment_method, status,
       item_type, item_code, gateway, phone_number, currency, discount_code, discount_amount, metadata, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 'M-Pesa STK Push', ?, ?, ?, 'palplus', ?, 'KES', ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      user.role === 'recruiter' ? user.id : user.id,
      user.id,
      invoice.lastID,
      pricing.amount,
      reference,
      reference,
      item.name,
      pricing.amount === 0 ? STATUS.SUCCESS : STATUS.PENDING,
      item.itemType,
      itemCode,
      normalizedPhone || null,
      pricing.discountCode,
      pricing.discountAmount,
      json(metadata),
    ]
  );

  await dbRun(`UPDATE invoices SET payment_id = ? WHERE id = ?`, [payment.lastID, invoice.lastID]);

  if (pricing.amount === 0) {
    await activatePurchase(payment.lastID);
    await logPaymentEvent(payment.lastID, null, 'free_checkout', STATUS.SUCCESS, 'Zero-value item activated', { itemCode });
    return { paymentId: payment.lastID, invoiceId: invoice.lastID, reference, status: STATUS.SUCCESS, amount: 0 };
  }

  const requestPayload = palplusPayload({
    user,
    phoneNumber: normalizedPhone,
    amount: pricing.amount,
    reference,
    description: item.name,
  });

  const gatewayResponse = await sendPalplusStkPush(requestPayload);
  const transaction = await dbRun(
    `INSERT INTO payment_transactions (
       payment_id, user_id, gateway, type, merchant_reference, checkout_request_id, gateway_reference,
       phone_number, amount, currency, status, request_payload, response_payload, verified
     )
     VALUES (?, ?, 'palplus', 'stk_push', ?, ?, ?, ?, ?, 'KES', ?, ?, ?, 0)`,
    [
      payment.lastID,
      user.id,
      reference,
      gatewayResponse.checkoutRequestId,
      gatewayResponse.gatewayReference,
      normalizedPhone,
      pricing.amount,
      STATUS.PENDING,
      json(requestPayload),
      json(gatewayResponse.raw),
    ]
  );

  await dbRun(
    `UPDATE payments SET checkout_request_id = ?, gateway_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [gatewayResponse.checkoutRequestId, gatewayResponse.gatewayReference, payment.lastID]
  );
  await logPaymentEvent(payment.lastID, transaction.lastID, 'stk_push_requested', STATUS.PENDING, 'PalPlus STK Push requested', gatewayResponse.raw);

  return {
    paymentId: payment.lastID,
    invoiceId: invoice.lastID,
    transactionId: transaction.lastID,
    reference,
    checkoutRequestId: gatewayResponse.checkoutRequestId,
    amount: pricing.amount,
    status: STATUS.PENDING,
    mock: Boolean(gatewayResponse.mock),
  };
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

async function activateSubscription(payment) {
  const item = getItem(payment.item_code);
  if (!item || item.itemType !== 'subscription') return;

  const now = new Date();
  const periodEnd = item.billingCycle === 'annual' ? addDays(now, 365) : addDays(now, 30);

  await dbRun(
    `INSERT INTO subscriptions (
       recruiter_id, plan_type, billing_cycle, featured_jobs, expiry_date, active, status,
       job_limit, seat_limit, ai_enabled, api_enabled, cv_parsing_enabled,
       current_period_start, current_period_end, renewal_date, last_payment_id
     )
     VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(recruiter_id) DO UPDATE SET
       plan_type = excluded.plan_type,
       billing_cycle = excluded.billing_cycle,
       featured_jobs = excluded.featured_jobs,
       expiry_date = excluded.expiry_date,
       active = 1,
       status = 'active',
       job_limit = excluded.job_limit,
       seat_limit = excluded.seat_limit,
       ai_enabled = excluded.ai_enabled,
       api_enabled = excluded.api_enabled,
       cv_parsing_enabled = excluded.cv_parsing_enabled,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       renewal_date = excluded.renewal_date,
       last_payment_id = excluded.last_payment_id`,
    [
      payment.user_id || payment.recruiter_id,
      item.plan,
      item.billingCycle,
      item.plan === 'starter' ? 1 : item.plan === 'professional' ? 5 : 10,
      periodEnd.toISOString(),
      item.jobLimit,
      item.seatLimit,
      item.aiEnabled,
      item.apiEnabled,
      item.cvParsingEnabled,
      now.toISOString(),
      periodEnd.toISOString(),
      periodEnd.toISOString(),
      payment.id,
    ]
  );
  await dbRun(`UPDATE users SET status = 'approved' WHERE id = ? AND role = 'recruiter'`, [payment.user_id || payment.recruiter_id]);
}

async function activateAddon(payment) {
  if (payment.item_code === 'featured_job') {
    const metadata = JSON.parse(payment.metadata || '{}');
    if (metadata.jobId) {
      await dbRun(`UPDATE jobs SET featured = 1 WHERE id = ? AND recruiter_id = ?`, [metadata.jobId, payment.user_id || payment.recruiter_id]);
    }
  }

  const subscription = await dbGet(`SELECT addons FROM subscriptions WHERE recruiter_id = ?`, [payment.user_id || payment.recruiter_id]);
  const addons = subscription?.addons ? JSON.parse(subscription.addons) : {};
  addons[payment.item_code] = {
    active: true,
    activatedAt: new Date().toISOString(),
    paymentId: payment.id,
  };
  await dbRun(
    `INSERT INTO subscriptions (recruiter_id, plan_type, active, addons)
     VALUES (?, 'free', 1, ?)
     ON CONFLICT(recruiter_id) DO UPDATE SET addons = excluded.addons`,
    [payment.user_id || payment.recruiter_id, json(addons)]
  );
}

async function activateVerification(payment) {
  const item = getItem(payment.item_code);
  if (!item || item.itemType !== 'verification') return;
  const metadata = JSON.parse(payment.metadata || '{}');
  const requestId = metadata.verificationRequestId;
  if (!requestId) return;

  await dbRun(
    `UPDATE verification_requests SET status = 'pending', payment_id = ? WHERE id = ? AND user_id = ?`,
    [payment.id, requestId, payment.user_id]
  );
}

async function activatePurchase(paymentId) {
  const payment = await dbGet(`SELECT * FROM payments WHERE id = ?`, [paymentId]);
  if (!payment || payment.status === STATUS.REFUNDED) return null;

  if (payment.item_type === 'subscription') await activateSubscription(payment);
  if (payment.item_type === 'addon') await activateAddon(payment);
  if (payment.item_type === 'verification') await activateVerification(payment);

  await dbRun(`UPDATE invoices SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE payment_id = ?`, [STATUS.SUCCESS, paymentId]);
  return payment;
}

async function processPalplusCallback(req) {
  const signature = verifyCallbackSignature(req);
  if (!signature.verified && process.env.PALPLUS_REQUIRE_SIGNATURE !== 'false') {
    await logPaymentEvent(null, null, 'callback_rejected', STATUS.FAILED, signature.reason, req.body);
    const err = new Error(signature.reason);
    err.statusCode = 401;
    throw err;
  }

  const parsed = parsePalplusCallback(req.body || {});
  const tx = await dbGet(
    `SELECT * FROM payment_transactions
     WHERE merchant_reference = ?
        OR checkout_request_id = ?
        OR gateway_reference = ?
     ORDER BY id DESC LIMIT 1`,
    [parsed.merchantReference, parsed.checkoutRequestId, parsed.gatewayReference]
  );

  if (!tx) {
    await logPaymentEvent(null, null, 'callback_unmatched', parsed.status, 'No matching transaction', req.body);
    const err = new Error('No matching transaction');
    err.statusCode = 404;
    throw err;
  }

  if (tx.status === STATUS.SUCCESS) {
    await logPaymentEvent(tx.payment_id, tx.id, 'callback_duplicate', STATUS.SUCCESS, 'Duplicate PalPlus callback ignored', req.body);
    return { duplicate: true, paymentId: tx.payment_id, status: STATUS.SUCCESS };
  }

  await dbRun(
    `UPDATE payment_transactions
     SET status = ?, gateway_reference = COALESCE(?, gateway_reference), callback_payload = ?,
         callback_signature = ?, verified = ?, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [parsed.status, parsed.gatewayReference, json(req.body), signature.signature || null, signature.verified ? 1 : 0, tx.id]
  );

  await dbRun(
    `UPDATE payments
     SET status = ?, transaction_id = COALESCE(?, transaction_id), gateway_reference = COALESCE(?, gateway_reference),
         paid_at = CASE WHEN ? = 'success' THEN CURRENT_TIMESTAMP ELSE paid_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [parsed.status, parsed.gatewayReference, parsed.gatewayReference, parsed.status, tx.payment_id]
  );

  await logPaymentEvent(tx.payment_id, tx.id, 'callback_received', parsed.status, parsed.resultDescription, req.body);

  if (parsed.status === STATUS.SUCCESS) {
    await activatePurchase(tx.payment_id);
    await logPaymentEvent(tx.payment_id, tx.id, 'purchase_activated', STATUS.SUCCESS, 'Purchase activated after PalPlus callback', { paymentId: tx.payment_id });
  }

  return { paymentId: tx.payment_id, transactionId: tx.id, status: parsed.status };
}

async function getPaymentHistory(userId) {
  return dbAll(
    `SELECT p.*, i.invoice_number
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE p.user_id = ? OR p.recruiter_id = ?
     ORDER BY p.created_at DESC`,
    [userId, userId]
  );
}

module.exports = {
  STATUS,
  RECRUITER_PLANS,
  ADD_ONS,
  VERIFICATION_PLANS,
  CATALOG,
  getItem,
  createPaymentIntent,
  processPalplusCallback,
  activatePurchase,
  logPaymentEvent,
  getPaymentHistory,
  normalizePhone,
};
