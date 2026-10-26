import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { query, one, tx } from '../db.js';
import { asyncRoute, assert, is, HttpError } from '../lib/http.js';
import { publicUser } from '../auth.js';
import { emitToUsers, isOnline } from '../realtime.js';

const router = Router();

const MAX_CIPHERTEXT = 1_000_000; // base64 chars
const MAX_GROUP_SIZE = 256;

// ── helpers ──────────────────────────────────────────────────────────────

async function requireMember(conversationId, userId) {
  assert(is.uuid(conversationId), 'invalid_request');
  const row = await one(
    `SELECT c.*, m.role, m.last_read_seq, m.joined_at
       FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
      WHERE c.id = ?`,
    [userId, conversationId]
  );
  if (!row) throw new HttpError(404, 'not_found', 'Conversation not found.');
  return row;
}

async function memberIds(conversationId) {
  const rows = await query(`SELECT user_id FROM conversation_members WHERE conversation_id = ?`, [conversationId]);
  return rows.map((r) => r.user_id);
}

export function serializeMessage(m) {
  return {
    id: m.id,
    seq: Number(m.seq),
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    kind: m.kind,
    ciphertext: m.ciphertext,
    iv: m.iv,
    meta: typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta,
    createdAt: m.created_at,
    key: m.wrapped_key ? { wrappedKey: m.wrapped_key, iv: m.key_iv } : null,
  };
}

/**
 * Builds the per-user view of conversations (members, last message, unread count).
 * The full list hides empty direct chats someone else opened with you; a single
 * explicitly requested conversation is always returned.
 */
async function conversationsFor(userId, onlyId = null) {
  const convs = await query(
    `SELECT c.*, m.role, m.last_read_seq, m.joined_at
       FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
      WHERE ${onlyId ? 'c.id = ?' : `(c.type = 'group' OR c.last_message_at IS NOT NULL OR c.created_by = ?)`}
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    [userId, onlyId || userId]
  );
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);

  const [members, lastMessages, unread] = await Promise.all([
    query(
      `SELECT m.conversation_id, m.role, m.last_read_seq, m.joined_at,
              u.id, u.username, u.display_name, u.about, u.public_key, u.last_seen_at
         FROM conversation_members m JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id IN (?)
        ORDER BY m.joined_at`,
      [ids]
    ),
    query(
      `SELECT msg.*, k.wrapped_key, k.iv AS key_iv
         FROM messages msg
         JOIN (SELECT conversation_id, MAX(seq) AS seq FROM messages WHERE conversation_id IN (?) GROUP BY conversation_id) t
           ON t.seq = msg.seq
         LEFT JOIN message_keys k ON k.message_id = msg.id AND k.recipient_id = ?`,
      [ids, userId]
    ),
    query(
      `SELECT msg.conversation_id, COUNT(*) AS n
         FROM messages msg
         JOIN conversation_members m ON m.conversation_id = msg.conversation_id AND m.user_id = ?
        WHERE msg.conversation_id IN (?) AND msg.seq > m.last_read_seq
          AND msg.kind = 'encrypted' AND msg.sender_id <> ? AND msg.created_at >= m.joined_at
        GROUP BY msg.conversation_id`,
      [userId, ids, userId]
    ),
  ]);

  return convs.map((c) => {
    const last = lastMessages.find((m) => m.conversation_id === c.id);
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      createdBy: c.created_by,
      createdAt: c.created_at,
      lastMessageAt: c.last_message_at,
      role: c.role,
      lastReadSeq: Number(c.last_read_seq),
      unread: Number(unread.find((u) => u.conversation_id === c.id)?.n || 0),
      members: members
        .filter((m) => m.conversation_id === c.id)
        .map((m) =>
          publicUser(m, {
            role: m.role,
            lastReadSeq: Number(m.last_read_seq),
            online: isOnline(m.id),
            lastSeenAt: m.last_seen_at,
          })
        ),
      lastMessage: last && last.created_at >= c.joined_at ? serializeMessage(last) : null,
    };
  });
}

async function systemMessage(q, conversationId, actorId, meta) {
  const id = crypto.randomUUID();
  await q(
    `INSERT INTO messages (id, conversation_id, sender_id, kind, meta) VALUES (?, ?, ?, 'system', ?)`,
    [id, conversationId, actorId, JSON.stringify(meta)]
  );
  await q(`UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP(3) WHERE id = ?`, [conversationId]);
  return id;
}

async function broadcastSystem(messageId, recipients) {
  const row = await one(`SELECT * FROM messages WHERE id = ?`, [messageId]);
  emitToUsers(recipients, 'message:new', { message: serializeMessage(row) });
}

async function validUserIds(ids) {
  assert(Array.isArray(ids) && ids.every(is.uuid), 'invalid_members', 'Invalid member list.');
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await query(`SELECT id FROM users WHERE id IN (?)`, [unique]);
  assert(rows.length === unique.length, 'invalid_members', 'Some selected people no longer exist.');
  return unique;
}

// ── conversations ────────────────────────────────────────────────────────

router.get('/', asyncRoute(async (req, res) => {
  res.json({ conversations: await conversationsFor(req.user.id) });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  await requireMember(req.params.id, req.user.id);
  const [conversation] = await conversationsFor(req.user.id, req.params.id);
  if (!conversation) throw new HttpError(404, 'not_found', 'Conversation not found.');
  res.json({ conversation });
}));

router.post('/direct', asyncRoute(async (req, res) => {
  const otherId = req.body?.userId;
  assert(is.uuid(otherId) && otherId !== req.user.id, 'invalid_request', 'Pick someone to chat with.');
  await validUserIds([otherId]);
  const directKey = [req.user.id, otherId].sort().join(':');

  let conv = await one(`SELECT id FROM conversations WHERE direct_key = ?`, [directKey]);
  if (!conv) {
    const id = crypto.randomUUID();
    await tx(async (q) => {
      await q(`INSERT INTO conversations (id, type, direct_key, created_by) VALUES (?, 'direct', ?, ?)`,
        [id, directKey, req.user.id]);
      await q(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'member'), (?, ?, 'member')`,
        [id, req.user.id, id, otherId]);
    }).catch(async (err) => {
      if (err.code !== 'ER_DUP_ENTRY') throw err; // created concurrently by the other person
    });
    conv = await one(`SELECT id FROM conversations WHERE direct_key = ?`, [directKey]);
  }
  const [conversation] = await conversationsFor(req.user.id, conv.id);
  res.json({ conversation });
}));

router.post('/group', asyncRoute(async (req, res) => {
  const { name } = req.body || {};
  assert(is.str(name, 1, 80), 'invalid_name', 'Give the group a name (max 80 characters).');
  const others = (await validUserIds(req.body?.memberIds || [])).filter((id) => id !== req.user.id);
  assert(others.length >= 1, 'invalid_members', 'Add at least one person to the group.');
  assert(others.length < MAX_GROUP_SIZE, 'invalid_members', `Groups are limited to ${MAX_GROUP_SIZE} people.`);

  const id = crypto.randomUUID();
  const sysId = await tx(async (q) => {
    await q(`INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'group', ?, ?)`, [id, name.trim(), req.user.id]);
    const rows = [[id, req.user.id, 'admin'], ...others.map((u) => [id, u, 'member'])];
    await q(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ?`, [rows]);
    return systemMessage(q, id, req.user.id, { event: 'group_created', name: name.trim() });
  });

  const all = [req.user.id, ...others];
  await broadcastSystem(sysId, all);
  emitToUsers(others, 'conversation:changed', { conversationId: id });
  const [conversation] = await conversationsFor(req.user.id, id);
  res.status(201).json({ conversation });
}));

router.patch('/:id', asyncRoute(async (req, res) => {
  const conv = await requireMember(req.params.id, req.user.id);
  assert(conv.type === 'group', 'invalid_request', 'Only groups can be renamed.');
  assert(conv.role === 'admin', 'forbidden', 'Only group admins can do that.', 403);
  const name = req.body?.name;
  assert(is.str(name, 1, 80), 'invalid_name', 'Give the group a name (max 80 characters).');

  const sysId = await tx(async (q) => {
    await q(`UPDATE conversations SET name = ? WHERE id = ?`, [name.trim(), conv.id]);
    return systemMessage(q, conv.id, req.user.id, { event: 'renamed', name: name.trim() });
  });
  const ids = await memberIds(conv.id);
  await broadcastSystem(sysId, ids);
  emitToUsers(ids, 'conversation:changed', { conversationId: conv.id });
  res.json({ ok: true });
}));

router.post('/:id/members', asyncRoute(async (req, res) => {
  const conv = await requireMember(req.params.id, req.user.id);
  assert(conv.type === 'group', 'invalid_request', 'You can only add people to groups.');
  assert(conv.role === 'admin', 'forbidden', 'Only group admins can add people.', 403);
  const current = await memberIds(conv.id);
  const add = (await validUserIds(req.body?.userIds || [])).filter((id) => !current.includes(id));
  assert(add.length, 'invalid_members', 'Everyone you picked is already in the group.');
  assert(current.length + add.length <= MAX_GROUP_SIZE, 'invalid_members', `Groups are limited to ${MAX_GROUP_SIZE} people.`);

  const sysId = await tx(async (q) => {
    await q(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ?`, [add.map((u) => [conv.id, u, 'member'])]);
    return systemMessage(q, conv.id, req.user.id, { event: 'members_added', userIds: add });
  });
  const all = [...current, ...add];
  await broadcastSystem(sysId, all);
  emitToUsers(all, 'conversation:changed', { conversationId: conv.id });
  res.json({ ok: true });
}));

router.delete('/:id/members/:userId', asyncRoute(async (req, res) => {
  const conv = await requireMember(req.params.id, req.user.id);
  const target = req.params.userId;
  assert(conv.type === 'group', 'invalid_request', 'You can only leave groups.');
  assert(is.uuid(target), 'invalid_request');
  const leaving = target === req.user.id;
  assert(leaving || conv.role === 'admin', 'forbidden', 'Only group admins can remove people.', 403);

  const current = await memberIds(conv.id);
  assert(current.includes(target), 'not_found', 'That person is not in this group.', 404);

  const sysId = await tx(async (q) => {
    await q(`DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?`, [conv.id, target]);
    // Never leave a group without an admin: promote the longest-standing member.
    const [admins] = await q(`SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ? AND role = 'admin'`, [conv.id]);
    if (Number(admins.n) === 0) {
      await q(
        `UPDATE conversation_members SET role = 'admin' WHERE conversation_id = ? ORDER BY joined_at LIMIT 1`,
        [conv.id]
      );
    }
    return systemMessage(q, conv.id, req.user.id, leaving
      ? { event: 'member_left' }
      : { event: 'member_removed', userIds: [target] });
  });
  const remaining = current.filter((id) => id !== target);
  await broadcastSystem(sysId, remaining);
  emitToUsers(remaining, 'conversation:changed', { conversationId: conv.id });
  emitToUsers([target], 'conversation:removed', { conversationId: conv.id });
  res.json({ ok: true });
}));

// ── messages ─────────────────────────────────────────────────────────────

router.get('/:id/messages', asyncRoute(async (req, res) => {
  const conv = await requireMember(req.params.id, req.user.id);
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;

  const rows = await query(
    `SELECT m.*, k.wrapped_key, k.iv AS key_iv
       FROM messages m
       LEFT JOIN message_keys k ON k.message_id = m.id AND k.recipient_id = ?
      WHERE m.conversation_id = ? AND m.seq < ? AND m.created_at >= ?
      ORDER BY m.seq DESC
      LIMIT ?`,
    [req.user.id, conv.id, before, conv.joined_at, limit + 1]
  );
  const hasMore = rows.length > limit;
  res.json({ messages: rows.slice(0, limit).reverse().map(serializeMessage), hasMore });
}));

router.post('/:id/messages', asyncRoute(async (req, res) => {
  const conv = await requireMember(req.params.id, req.user.id);
  const { id, ciphertext, iv, keys, fileIds = [] } = req.body || {};
  assert(is.uuid(id), 'invalid_request', 'Invalid message id.');
  assert(is.b64(ciphertext, MAX_CIPHERTEXT) && is.b64(iv, 32), 'invalid_request', 'Invalid message payload.');
  assert(Array.isArray(keys) && keys.every((k) => is.uuid(k?.userId) && is.b64(k.wrappedKey, 128) && is.b64(k.iv, 32)),
    'invalid_request', 'Invalid key envelope.');
  assert(Array.isArray(fileIds) && fileIds.length <= config.maxFilesPerMessage && fileIds.every(is.uuid),
    'invalid_files', `You can attach up to ${config.maxFilesPerMessage} files.`);

  // Every current member (including the sender) must receive exactly one wrapped key.
  const members = await memberIds(conv.id);
  const keyed = new Set(keys.map((k) => k.userId));
  if (keyed.size !== keys.length || keyed.size !== members.length || !members.every((m) => keyed.has(m))) {
    throw new HttpError(409, 'members_changed', 'The member list changed. Re-encrypting…');
  }

  if (fileIds.length) {
    const files = await query(
      `SELECT id FROM files WHERE id IN (?) AND uploader_id = ? AND conversation_id = ? AND message_id IS NULL`,
      [fileIds, req.user.id, conv.id]
    );
    assert(files.length === new Set(fileIds).size, 'invalid_files', 'Some attachments are missing. Please re-attach them.');
  }

  await tx(async (q) => {
    await q(
      `INSERT INTO messages (id, conversation_id, sender_id, kind, ciphertext, iv) VALUES (?, ?, ?, 'encrypted', ?, ?)`,
      [id, conv.id, req.user.id, ciphertext, iv]
    );
    await q(`INSERT INTO message_keys (message_id, recipient_id, wrapped_key, iv) VALUES ?`,
      [keys.map((k) => [id, k.userId, k.wrappedKey, k.iv])]);
    if (fileIds.length) await q(`UPDATE files SET message_id = ? WHERE id IN (?)`, [id, fileIds]);
    const [msg] = await q(`SELECT seq, created_at FROM messages WHERE id = ?`, [id]);
    await q(`UPDATE conversations SET last_message_at = ? WHERE id = ?`, [msg.created_at, conv.id]);
    await q(`UPDATE conversation_members SET last_read_seq = ? WHERE conversation_id = ? AND user_id = ?`,
      [msg.seq, conv.id, req.user.id]);
  }).catch((err) => {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'duplicate', 'Message already sent.');
    throw err;
  });

  const row = await one(`SELECT * FROM messages WHERE id = ?`, [id]);
  for (const k of keys) {
    emitToUsers([k.userId], 'message:new', {
      message: serializeMessage({ ...row, wrapped_key: k.wrappedKey, key_iv: k.iv }),
    });
  }
  const mine = keys.find((k) => k.userId === req.user.id);
  res.status(201).json({ message: serializeMessage({ ...row, wrapped_key: mine.wrappedKey, key_iv: mine.iv }) });
}));

router.post('/:id/read', asyncRoute(async (req, res) => {
  const conv = await requireMember(req.params.id, req.user.id);
  const seq = Number(req.body?.seq);
  assert(Number.isSafeInteger(seq) && seq > 0, 'invalid_request');
  if (seq > Number(conv.last_read_seq)) {
    await query(
      `UPDATE conversation_members SET last_read_seq = GREATEST(last_read_seq, ?) WHERE conversation_id = ? AND user_id = ?`,
      [seq, conv.id, req.user.id]
    );
    emitToUsers(await memberIds(conv.id), 'conversation:read', { conversationId: conv.id, userId: req.user.id, seq });
  }
  res.json({ ok: true });
}));

export default router;
