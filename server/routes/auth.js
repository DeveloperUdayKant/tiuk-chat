import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { asyncRoute, assert, is, HttpError } from '../lib/http.js';
import {
  hashAuthKey, verifyAuthKey, decoySalt, issueSession, clearSession, requireAuth, publicUser,
} from '../auth.js';

const router = Router();

// Behind Cloudflare (e.g. GoDaddy Node.js Hosting) every request arrives from a CDN address,
// so key the limits on the visitor IP Cloudflare forwards.
const clientKey = (req) => (config.isProd && req.get('cf-connecting-ip')) || req.ip;

const limiter = (windowMin, limit, extra = {}) => rateLimit({
  windowMs: windowMin * 60 * 1000,
  limit: config.isProd ? limit : limit * 50, // relaxed locally so tests/seeding don't trip it
  keyGenerator: clientKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many attempts. Please wait a few minutes.' },
  ...extra,
});

// Only failed attempts count, so people sharing an IP don't lock each other out.
const loginLimiter = limiter(15, 20, { skipSuccessfulRequests: true });
const preloginLimiter = limiter(15, 200);
const registerLimiter = limiter(60, 10);

const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;
const normalizeUsername = (u) => (typeof u === 'string' ? u.trim().toLowerCase() : '');

function vaultFor(user) {
  return {
    publicKey: user.public_key,
    encryptedPrivateKey: user.enc_private_key,
    privateKeyIv: user.private_key_iv,
  };
}

/** Step 1 of login: the client needs its KDF salt before it can derive the auth key. */
router.post('/prelogin', preloginLimiter, asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  assert(USERNAME_RE.test(username), 'invalid_username', 'Enter a valid username.');
  const user = await one(`SELECT kdf_salt, kdf_iterations FROM users WHERE username = ?`, [username]);
  res.json({
    kdfSalt: user?.kdf_salt || decoySalt(username),
    kdfIterations: user?.kdf_iterations || config.kdfIterations,
  });
}));

router.post('/register', registerLimiter, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const username = normalizeUsername(b.username);
  assert(USERNAME_RE.test(username), 'invalid_username',
    'Username must be 3–32 characters: lowercase letters, numbers, dot or underscore.');
  assert(is.str(b.displayName, 1, 64), 'invalid_name', 'Enter your name (max 64 characters).');
  assert(is.b64(b.authKey, 64), 'invalid_request');
  assert(is.b64(b.kdfSalt, 64), 'invalid_request');
  assert(is.b64(b.publicKey, 256), 'invalid_request');
  assert(is.b64(b.encryptedPrivateKey, 512), 'invalid_request');
  assert(is.b64(b.privateKeyIv, 32), 'invalid_request');
  assert(Number.isInteger(b.kdfIterations) && b.kdfIterations >= config.kdfIterations && b.kdfIterations <= 10_000_000,
    'invalid_request', 'Unsupported key-derivation settings.');

  const exists = await one(`SELECT id FROM users WHERE username = ?`, [username]);
  if (exists) throw new HttpError(409, 'username_taken', 'That username is already taken.');

  const id = crypto.randomUUID();
  const { hash, salt } = await hashAuthKey(b.authKey);
  await query(
    `INSERT INTO users (id, username, display_name, auth_hash, auth_salt, kdf_salt, kdf_iterations,
                        public_key, enc_private_key, private_key_iv)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, username, b.displayName.trim(), hash, salt, b.kdfSalt, b.kdfIterations,
      b.publicKey, b.encryptedPrivateKey, b.privateKeyIv]
  );
  const user = await one(`SELECT * FROM users WHERE id = ?`, [id]);
  issueSession(res, id);
  res.status(201).json({ user: publicUser(user), vault: vaultFor(user) });
}));

router.post('/login', loginLimiter, asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const authKey = req.body?.authKey;
  assert(USERNAME_RE.test(username) && is.b64(authKey, 64), 'invalid_credentials', 'Incorrect username or password.', 401);

  const user = await one(`SELECT * FROM users WHERE username = ?`, [username]);
  const ok = user ? await verifyAuthKey(authKey, user.auth_hash, user.auth_salt) : (await hashAuthKey(authKey), false);
  if (!ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect username or password.');

  issueSession(res, user.id);
  res.json({ user: publicUser(user), vault: vaultFor(user) });
}));

/** Re-fetch the encrypted vault for an existing session (e.g. unlocking on a fresh tab). */
router.get('/vault', requireAuth, asyncRoute(async (req, res) => {
  const user = await one(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
  res.json({ vault: vaultFor(user), kdfSalt: user.kdf_salt, kdfIterations: user.kdf_iterations });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

export default router;
