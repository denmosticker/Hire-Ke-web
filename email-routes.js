const express = require('express');
const router = express.Router();

function emailJsConfig() {
  return {
    serviceId: process.env.EMAILJS_SERVICE_ID || process.env.VITE_EMAILJS_SERVICE_ID,
    templateId: process.env.EMAILJS_TEMPLATE_ID || process.env.VITE_EMAILJS_TEMPLATE_ID,
    publicKey: process.env.EMAILJS_PUBLIC_KEY || process.env.VITE_EMAILJS_PUBLIC_KEY,
    privateKey: process.env.EMAILJS_PRIVATE_KEY,
  };
}

router.get('/config', (_req, res) => {
  const { serviceId, templateId, publicKey } = emailJsConfig();

  if (!serviceId || !templateId || !publicKey) {
    return res.status(500).json({
      error: 'EmailJS is not configured',
      note: {
        EMAILJS_SERVICE_ID: !!serviceId,
        EMAILJS_TEMPLATE_ID: !!templateId,
        EMAILJS_PUBLIC_KEY: !!publicKey,
      },
    });
  }

  return res.json({ serviceId, templateId, publicKey });
});

router.post('/send-email', async (req, res) => {
  try {
    const { title, subject, name, email, message, time, templateVars = {} } = req.body;

    const { serviceId, templateId, publicKey, privateKey } = emailJsConfig();

    if (!serviceId || !templateId || !publicKey) {
      return res.status(500).json({
        error: 'EmailJS is not configured',
        note: {
          EMAILJS_SERVICE_ID: !!serviceId,
          EMAILJS_TEMPLATE_ID: !!templateId,
          EMAILJS_PUBLIC_KEY: !!publicKey,
        },
      });
    }

    const emailjs = require('@emailjs/nodejs');

    const safeTitle = String(title || subject || templateVars.title || '').trim().slice(0, 500);
    const safeName = String(name || templateVars.name || '').trim().slice(0, 200);
    const safeEmail = String(email || templateVars.email || '').trim().slice(0, 320);
    const safeMessage = typeof message === 'string' ? message.slice(0, 10000) : '';
    const safeTime = String(time || templateVars.time || new Date().toLocaleString()).slice(0, 100);

    if (!safeName || !safeEmail || !safeTitle || !safeMessage) {
      return res.status(400).json({ error: 'Name, email, subject, and message are required.' });
    }

    const templateParams = {
      title: safeTitle,
      name: safeName,
      email: safeEmail,
      message: safeMessage,
      time: safeTime,
    };

    await emailjs.send(serviceId, templateId, templateParams, {
      publicKey,
      ...(privateKey ? { privateKey } : {}),
    });

    return res.status(200).json({
      success: true,
      note: {
        subject: safeTitle,
      },
    });
  } catch (err) {
    console.error('EmailJS send failed:', err?.status || '', err?.text || err?.message || err);
    return res.status(err?.status || 500).json({ error: err?.text || err?.message || 'Server error' });
  }
});

module.exports = router;

