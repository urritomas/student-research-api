const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../../../config/db');

const SALT_ROUNDS = 12;

function generateToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function registerWithEmail(email, password, fullName) {
  const { rows } = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (rows.length > 0) {
    return { error: 'Email already registered' };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = crypto.randomUUID();

  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name, auth_provider, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'email', 1, NOW(), NOW())`,
    [id, email, passwordHash, fullName || null]
  );

  console.log('[auth] registered email user', { id, email });

  const user = { id, email, full_name: fullName || null };
  const token = generateToken(user);

  return { user, token };
}

async function loginWithEmail(email, password) {
  const { rows } = await db.query(
    'SELECT id, email, full_name, avatar_url, password_hash, auth_provider FROM users WHERE email = ? LIMIT 1',
    [email]
  );

  if (rows.length === 0) {
    return { error: 'Invalid email or password' };
  }

  const user = rows[0];

  if (user.auth_provider !== 'email' || !user.password_hash) {
    return { error: 'This account uses Google sign-in' };
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return { error: 'Invalid email or password' };
  }

  console.log('[auth] email login success', { id: user.id, email: user.email });

  const token = generateToken(user);

  return {
    user: { id: user.id, email: user.email, full_name: user.full_name, avatar_url: user.avatar_url },
    token,
  };
}

async function findOrCreateGoogleUser(profile) {
  const { rows } = await db.query('SELECT id, email, full_name, avatar_url, auth_provider FROM users WHERE email = ? LIMIT 1', [profile.email]);

  if (rows.length > 0) {
    const user = rows[0];
    if (user.auth_provider !== 'google') {
      await db.query(
        'UPDATE users SET auth_provider = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = NOW() WHERE id = ?',
        ['google', profile.picture || null, user.id]
      );
      console.log('[auth] linked existing user to google', { id: user.id });
    } else {
      console.log('[auth] google user already exists', { id: user.id });
    }
    return { id: user.id, email: user.email, full_name: user.full_name || profile.name, avatar_url: user.avatar_url || profile.picture };
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO users (id, email, full_name, avatar_url, auth_provider, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'google', 1, NOW(), NOW())`,
    [id, profile.email, profile.name || null, profile.picture || null]
  );

  console.log('[auth] created new google user', { id, email: profile.email });

  return { id, email: profile.email, full_name: profile.name || null, avatar_url: profile.picture || null };
}

async function getUserById(userId) {
  const { rows } = await db.query(
    'SELECT id, email, full_name, avatar_url, auth_provider, status FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  generateToken,
  registerWithEmail,
  loginWithEmail,
  findOrCreateGoogleUser,
  getUserById,
};
