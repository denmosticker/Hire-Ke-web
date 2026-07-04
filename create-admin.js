require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

const args = process.argv.slice(2);
const parseArg = (name) => {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const index = args.findIndex((a) => a === `--${name}`);
  if (index !== -1) return args[index + 1];
  return undefined;
};

const email = parseArg('email') || process.env.ADMIN_EMAIL;
const password = parseArg('password') || process.env.ADMIN_PASSWORD;
const name = parseArg('name') || process.env.ADMIN_NAME || 'Admin';

if (!email || !password) {
  console.error('Usage: node create-admin.js --email admin@example.com --password YourPassword');
  console.error('Or set ADMIN_EMAIL and ADMIN_PASSWORD in a .env file.');
  process.exit(1);
}

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

(async () => {
  try {
    const existing = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    const hashedPassword = await bcrypt.hash(password, 10);

    if (existing) {
      console.log(`User ${email} already exists. Repairing and updating to verified Admin...`);
      await dbRun(
        `UPDATE users SET password = ?, name = ?, role = 'admin', status = 'approved', email_verified = 1 WHERE email = ?`,
        [hashedPassword, name, email]
      );
    } else {
      console.log(`Creating new verified admin account: ${email}`);
      await dbRun(
        `INSERT INTO users (email, password, name, role, status, email_verified) VALUES (?, ?, ?, 'admin', 'approved', 1)`,
        [email, hashedPassword, name]
      );
    }

    console.log(`✓ Admin account is ready.`);
    console.log(`Email: ${email}`);
    console.log('You can now log in at http://localhost:3000/admin-login.html');
  } catch (error) {
    console.error('Failed to create admin:', error.message || error);
    process.exit(1);
  } finally {
    db.close((err) => {
      if (err) console.error('Error closing database:', err.message || err);
      process.exit(0);
    });
  }
})();
