const crypto = require('crypto');
const { db } = require('./db');

const SESSION_MS = 1000 * 60 * 60 * 24 * 14;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [s, h] = stored.split(':');
  const hash = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(h, 'hex'));
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, Date.now() + SESSION_MS);
  return token;
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookieHeader(token, maxAgeMs) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}
function loadUser(req, _res, next) {
  const token = parseCookies(req).sid;
  req.user = null;
  if (token) {
    const row = db.prepare(`SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
                            WHERE s.token=? AND s.expires_at>?`).get(token, Date.now());
    if (row) { req.user = row; req.token = token; }
  }
  next();
}
const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please log in' });
const requireAdmin = (req, res, next) =>
  req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

// Ensure an admin exists. Password comes from ADMIN_PASSWORD, else a random one is generated and printed once.
function ensureAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if (existing) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare("INSERT INTO users(username,password_hash,name,role) VALUES(?,?,?, 'admin')")
    .run(username, hashPassword(password), 'Administrator');
  console.log('\n========== ADMIN ACCOUNT CREATED ==========');
  console.log(` username: ${username}`);
  console.log(generated ? ` password: ${password}   (generated - shown only once, change it after login)` : ' password: (from ADMIN_PASSWORD)');
  console.log('===========================================\n');
}

module.exports = { hashPassword, verifyPassword, createSession, cookieHeader, loadUser, requireAuth, requireAdmin, ensureAdmin, SESSION_MS };
