const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth-middleware');

const router = express.Router();

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

function orderedPair(a, b) {
  const one = Math.min(Number(a), Number(b));
  const two = Math.max(Number(a), Number(b));
  return [one, two];
}

async function getAllowedApplicationContext(user, applicationId, receiverId) {
  if (!applicationId) return null;
  const app = await dbGet(
    `SELECT a.id, a.user_id, a.applicant_email, j.id as opportunity_id, j.recruiter_id
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     WHERE a.id = ?`,
    [applicationId]
  );
  if (!app) {
    const error = new Error('Application not found');
    error.status = 404;
    throw error;
  }

  if (user.role === 'admin') return app;
  if (user.role === 'recruiter' && app.recruiter_id === user.id && Number(receiverId) === Number(app.user_id)) return app;
  if (user.role === 'jobseeker' && (app.user_id === user.id || app.applicant_email === user.email) && Number(receiverId) === Number(app.recruiter_id)) return app;

  const error = new Error('Forbidden for this application');
  error.status = 403;
  throw error;
}

async function findOrCreateConversation(senderId, receiverId, applicationId = null, opportunityId = null) {
  const [one, two] = orderedPair(senderId, receiverId);
  const existing = await dbGet(
    `SELECT * FROM conversations
     WHERE participant_one_id = ? AND participant_two_id = ?
       AND COALESCE(application_id, 0) = COALESCE(?, 0)`,
    [one, two, applicationId]
  );
  if (existing) return existing;

  const result = await dbRun(
    `INSERT INTO conversations (participant_one_id, participant_two_id, application_id, opportunity_id)
     VALUES (?, ?, ?, ?)`,
    [one, two, applicationId || null, opportunityId || null]
  );
  return dbGet(`SELECT * FROM conversations WHERE id = ?`, [result.lastID]);
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT c.*, m.id as last_message_id, m.subject, m.body, m.created_at as last_message_at,
              m.sender_id as last_sender_id, m.read_at as last_read_at,
              other_user.id as other_user_id, other_user.name as other_name, other_user.email as other_email,
              other_user.role as other_role,
              SUM(CASE WHEN unread.id IS NOT NULL THEN 1 ELSE 0 END) as unread_count
       FROM conversations c
       JOIN users other_user ON other_user.id = CASE
         WHEN c.participant_one_id = ? THEN c.participant_two_id
         ELSE c.participant_one_id
       END
       LEFT JOIN messages m ON m.id = (
         SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1
       )
       LEFT JOIN messages unread ON unread.conversation_id = c.id AND unread.receiver_id = ? AND unread.read_at IS NULL
       WHERE c.participant_one_id = ? OR c.participant_two_id = ? OR ? = 'admin'
       GROUP BY c.id
       ORDER BY COALESCE(m.created_at, c.updated_at) DESC`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.role]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const conversation = await dbGet(`SELECT * FROM conversations WHERE id = ?`, [req.params.id]);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (req.user.role !== 'admin' && conversation.participant_one_id !== req.user.id && conversation.participant_two_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await dbRun(`UPDATE messages SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE conversation_id = ? AND receiver_id = ?`, [conversation.id, req.user.id]);
    const messages = await dbAll(
      `SELECT m.*, s.name as sender_name, r.name as receiver_name
       FROM messages m
       JOIN users s ON s.id = m.sender_id
       JOIN users r ON r.id = m.receiver_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC, m.id ASC`,
      [conversation.id]
    );
    res.json({ conversation, messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const receiverId = Number(req.body?.receiver_id);
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();
    const applicationId = req.body?.application_id ? Number(req.body.application_id) : null;
    const requestedOpportunityId = req.body?.opportunity_id ? Number(req.body.opportunity_id) : null;

    if (!receiverId || !body) return res.status(400).json({ error: 'receiver_id and body are required' });
    if (receiverId === req.user.id) return res.status(400).json({ error: 'Cannot message yourself' });

    const receiver = await dbGet(`SELECT id, email FROM users WHERE id = ?`, [receiverId]);
    if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

    const appContext = await getAllowedApplicationContext(req.user, applicationId, receiverId);
    if (!appContext && req.user.role !== 'admin') {
      const existingConversation = await dbGet(
        `SELECT id FROM conversations
         WHERE ((participant_one_id = ? AND participant_two_id = ?) OR (participant_one_id = ? AND participant_two_id = ?))`,
        [req.user.id, receiverId, receiverId, req.user.id]
      );
      if (!existingConversation) return res.status(403).json({ error: 'Messages must be tied to an application' });
    }

    const opportunityId = appContext?.opportunity_id || requestedOpportunityId || null;
    const conversation = await findOrCreateConversation(req.user.id, receiverId, applicationId, opportunityId);
    const result = await dbRun(
      `INSERT INTO messages (conversation_id, sender_id, receiver_id, application_id, opportunity_id, subject, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [conversation.id, req.user.id, receiverId, applicationId, opportunityId, subject || null, body]
    );
    await dbRun(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [conversation.id]);
    await dbRun(`INSERT INTO notifications (user_email, message) VALUES (?, ?)`, [receiver.email, subject || 'You have a new message on HireKe.']);

    res.status(201).json({ success: true, conversation_id: conversation.id, message_id: result.lastID });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

module.exports = router;
