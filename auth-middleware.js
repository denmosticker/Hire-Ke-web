const jwt = require('jsonwebtoken');
const db = require('./database');

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    db.get(
      `SELECT id, email, role, email_verified FROM users WHERE id = ?`,
      [decoded.id],
      (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Invalid token' });
        if (user.email_verified !== 1) {
          return res.status(403).json({
            error: 'Email verification required',
            unverified: true,
            email: user.email,
          });
        }
        req.user = { ...decoded, email: user.email, role: user.role };
        next();
      }
    );
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const recruiterMiddleware = (req, res, next) => {
  if (req.user?.role !== 'recruiter') {
    return res.status(403).json({ error: 'Recruiter access required' });
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware, recruiterMiddleware };
