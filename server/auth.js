import crypto from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import * as cookie from 'cookie';
import { config } from './config.js';
import { one } from './db.js';
import { HttpError } from './lib/http.js';

const scrypt = promisify(crypto.scrypt);

/**
 * The browser never sends the password. It sends `authKey`, an HKDF output of
 * PBKDF2(password). We still hash it server-side (scrypt) so a database leak
 * cannot be replayed as a login credential.
 */
export async function hashAuthKey(authKey, saltHex = crypto.randomBytes(16).toString('hex')) {
  const hash = await scrypt(authKey, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return { hash: hash.toString('hex'), salt: saltHex };
}

export async function verifyAuthKey(authKey, hashHex, saltHex) {
  const { hash } = await hashAuthKey(authKey, saltHex);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashHex, 'hex'));
}

/** Deterministic decoy salt so /prelogin does not reveal which usernames exist. */
export function decoySalt(username) {
  return crypto.createHmac('sha256', config.secret).update(`kdf-salt:${username}`).digest().subarray(0, 16).toString('base64');
}

export function issueSession(res, userId) {
  const token = jwt.sign({ sub: userId }, config.secret, { expiresIn: `${config.sessionDays}d`, algorithm: 'HS256' });
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionDays * 86400 * 1000,
    path: config.basePath || '/',
  });
}

export function clearSession(res) {
  res.clearCookie(config.sessionCookie, { path: config.basePath || '/' });
}

function userIdFromToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, config.secret, { algorithms: ['HS256'] }).sub;
  } catch {
    return null;
  }
}

export async function loadUser(id) {
  return one(
    `SELECT id, username, display_name, about, public_key, created_at FROM users WHERE id = ?`,
    [id]
  );
}

export const requireAuth = async (req, _res, next) => {
  try {
    const userId = userIdFromToken(req.cookies?.[config.sessionCookie]);
    const user = userId && (await loadUser(userId));
    if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Requests that change state must carry a custom header. Browsers cannot attach
 * custom headers cross-origin without a CORS preflight, which we never allow,
 * so this (together with SameSite cookies) shuts out CSRF.
 */
export const csrfGuard = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-tiuk-client') !== '1') {
    return res.status(403).json({ error: 'forbidden', message: 'Missing client header.' });
  }
  next();
};

export async function socketAuth(socket, next) {
  const cookies = cookie.parse(socket.handshake.headers.cookie || '');
  const userId = userIdFromToken(cookies[config.sessionCookie]);
  const user = userId && (await loadUser(userId).catch(() => null));
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user;
  next();
}

export function publicUser(u, extra = {}) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    about: u.about || '',
    publicKey: u.public_key,
    ...extra,
  };
}
