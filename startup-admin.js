const bcrypt = require('bcryptjs');
const db = require('./database');

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

async function seedAdminAccount() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const name = process.env.ADMIN_NAME || 'Admin';

  if (!email || (!password && !passwordHash)) {
    return;
  }

  const hash = passwordHash || await bcrypt.hash(password, 10);
  const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);

  if (existing) {
    await dbRun(
      `UPDATE users
       SET password = ?, name = ?, role = 'admin', status = 'approved', email_verified = 1
       WHERE email = ?`,
      [hash, name, email]
    );
  } else {
    await dbRun(
      `INSERT INTO users (email, password, name, role, status, email_verified)
       VALUES (?, ?, ?, 'admin', 'approved', 1)`,
      [email, hash, name]
    );
  }

  console.log(`Admin account ready: ${email}`);
}

module.exports = { seedAdminAccount };
