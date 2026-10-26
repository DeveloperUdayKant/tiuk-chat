import { Router } from 'express';
import { query, one } from '../db.js';
import { asyncRoute, assert, is, HttpError } from '../lib/http.js';
import { publicUser, loadUser } from '../auth.js';
import { isOnline, emitToUsers } from '../realtime.js';

const router = Router();

const withPresence = (u) => publicUser(u, { online: isOnline(u.id), lastSeenAt: u.last_seen_at || null });

router.get('/search', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
  if (q.length < 2) return res.json({ users: [] });
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const rows = await query(
    `SELECT id, username, display_name, about, public_key, last_seen_at
       FROM users
      WHERE id <> ? AND (username LIKE ? OR LOWER(display_name) LIKE ?)
      ORDER BY (username = ?) DESC, username
      LIMIT 20`,
    [req.user.id, like, like, q]
  );
  res.json({ users: rows.map(withPresence) });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  assert(is.uuid(req.params.id));
  const u = await one(
    `SELECT id, username, display_name, about, public_key, last_seen_at FROM users WHERE id = ?`,
    [req.params.id]
  );
  if (!u) throw new HttpError(404, 'not_found', 'User not found.');
  res.json({ user: withPresence(u) });
}));

router.patch('/me', asyncRoute(async (req, res) => {
  const { displayName, about } = req.body || {};
  assert(displayName === undefined || is.str(displayName, 1, 64), 'invalid_name', 'Enter a name (max 64 characters).');
  assert(about === undefined || (typeof about === 'string' && about.length <= 140), 'invalid_about', 'About is limited to 140 characters.');
  await query(
    `UPDATE users SET display_name = COALESCE(?, display_name), about = COALESCE(?, about) WHERE id = ?`,
    [displayName?.trim() ?? null, about?.trim() ?? null, req.user.id]
  );
  const user = publicUser(await loadUser(req.user.id));
  const contacts = await query(
    `SELECT DISTINCT m2.user_id AS id FROM conversation_members m1
       JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id
      WHERE m1.user_id = ?`,
    [req.user.id]
  );
  emitToUsers(contacts.map((r) => r.id), 'user:updated', { user });
  res.json({ user });
}));

export default router;
