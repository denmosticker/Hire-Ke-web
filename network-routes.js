const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth-middleware');

const router = express.Router();

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
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

function publicUserSelect(alias) {
  return `${alias}.id AS user_id, ${alias}.name, ${alias}.email, ${alias}.headline, ${alias}.avatar_url`;
}

router.post('/connect/:userId', authMiddleware, async (req, res) => {
  try {
    const requesterId = Number(req.user.id);
    const receiverId = Number(req.params.userId);
    if (!receiverId || requesterId === receiverId) {
      return res.status(400).json({ error: 'Choose another user to connect with.' });
    }

    const receiver = await dbGet(`SELECT id FROM users WHERE id = ?`, [receiverId]);
    if (!receiver) return res.status(404).json({ error: 'User not found.' });

    const existing = await dbGet(
      `SELECT * FROM network_connections
       WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)`,
      [requesterId, receiverId, receiverId, requesterId]
    );

    if (existing) {
      if (existing.status === 'blocked') return res.status(403).json({ error: 'This connection is not available.' });
      if (existing.status === 'rejected' && existing.requester_id === requesterId) {
        await dbRun(`UPDATE network_connections SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [existing.id]);
        return res.json({ data: { ...existing, status: 'pending' } });
      }
      return res.json({ data: existing });
    }

    const result = await dbRun(
      `INSERT INTO network_connections (requester_id, receiver_id, status)
       VALUES (?, ?, 'pending')`,
      [requesterId, receiverId]
    );
    res.status(201).json({ data: await dbGet(`SELECT * FROM network_connections WHERE id = ?`, [result.lastID]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/requests', authMiddleware, async (req, res) => {
  try {
    const incoming = await dbAll(
      `SELECT nc.*, ${publicUserSelect('u')}
       FROM network_connections nc
       JOIN users u ON u.id = nc.requester_id
       WHERE nc.receiver_id = ? AND nc.status = 'pending'
       ORDER BY nc.created_at DESC`,
      [req.user.id]
    );
    const outgoing = await dbAll(
      `SELECT nc.*, ${publicUserSelect('u')}
       FROM network_connections nc
       JOIN users u ON u.id = nc.receiver_id
       WHERE nc.requester_id = ? AND nc.status = 'pending'
       ORDER BY nc.created_at DESC`,
      [req.user.id]
    );
    res.json({ data: { incoming, outgoing } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/connections', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT nc.*,
              CASE WHEN nc.requester_id = ? THEN receiver.id ELSE requester.id END AS user_id,
              CASE WHEN nc.requester_id = ? THEN receiver.name ELSE requester.name END AS name,
              CASE WHEN nc.requester_id = ? THEN receiver.email ELSE requester.email END AS email,
              CASE WHEN nc.requester_id = ? THEN receiver.headline ELSE requester.headline END AS headline,
              CASE WHEN nc.requester_id = ? THEN receiver.avatar_url ELSE requester.avatar_url END AS avatar_url
       FROM network_connections nc
       JOIN users requester ON requester.id = nc.requester_id
       JOIN users receiver ON receiver.id = nc.receiver_id
       WHERE (nc.requester_id = ? OR nc.receiver_id = ?) AND nc.status = 'accepted'
       ORDER BY nc.updated_at DESC`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/can-message/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId);
    if (!otherUserId || otherUserId === Number(req.user.id)) {
      return res.json({ data: { canMessage: false, reason: 'Choose another connected user to message.' } });
    }
    const connection = await dbGet(
      `SELECT id FROM network_connections
       WHERE status = 'accepted'
         AND ((requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?))`,
      [req.user.id, otherUserId, otherUserId, req.user.id]
    );
    res.json({
      data: {
        canMessage: Boolean(connection),
        reason: connection ? 'Users are connected.' : 'Messaging is available after a connection is accepted.',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/accept', authMiddleware, async (req, res) => {
  try {
    const request = await dbGet(`SELECT * FROM network_connections WHERE id = ? AND receiver_id = ?`, [req.params.id, req.user.id]);
    if (!request) return res.status(404).json({ error: 'Connection request not found.' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be accepted.' });
    await dbRun(`UPDATE network_connections SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [request.id]);
    res.json({ data: await dbGet(`SELECT * FROM network_connections WHERE id = ?`, [request.id]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/reject', authMiddleware, async (req, res) => {
  try {
    const request = await dbGet(`SELECT * FROM network_connections WHERE id = ? AND receiver_id = ?`, [req.params.id, req.user.id]);
    if (!request) return res.status(404).json({ error: 'Connection request not found.' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be rejected.' });
    await dbRun(`UPDATE network_connections SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [request.id]);
    res.json({ data: await dbGet(`SELECT * FROM network_connections WHERE id = ?`, [request.id]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await dbRun(
      `DELETE FROM network_connections
       WHERE id = ? AND (requester_id = ? OR receiver_id = ?)`,
      [req.params.id, req.user.id, req.user.id]
    );
    if (!result.changes) return res.status(404).json({ error: 'Connection not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
