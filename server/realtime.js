import { socketAuth } from './auth.js';
import { query } from './db.js';
import { is } from './lib/http.js';

let io = null;
/** userId -> number of open sockets */
const online = new Map();

export const isOnline = (userId) => online.has(userId);

export function emitToUsers(userIds, event, payload) {
  if (!io) return;
  for (const id of new Set(userIds)) io.to(`user:${id}`).emit(event, payload);
}

async function contactIds(userId) {
  const rows = await query(
    `SELECT DISTINCT m2.user_id AS id
       FROM conversation_members m1
       JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id
      WHERE m1.user_id = ? AND m2.user_id <> ?`,
    [userId, userId]
  );
  return rows.map((r) => r.id);
}

async function memberIdsIfMember(conversationId, userId) {
  const rows = await query(`SELECT user_id FROM conversation_members WHERE conversation_id = ?`, [conversationId]);
  const ids = rows.map((r) => r.user_id);
  return ids.includes(userId) ? ids : null;
}

export function attachRealtime(server) {
  io = server;
  io.use(socketAuth);

  io.on('connection', async (socket) => {
    const me = socket.data.user;
    socket.join(`user:${me.id}`);

    const count = (online.get(me.id) || 0) + 1;
    online.set(me.id, count);
    if (count === 1) {
      emitToUsers(await contactIds(me.id).catch(() => []), 'presence', { userId: me.id, online: true });
    }

    socket.on('typing', async (data) => {
      if (!data || !is.uuid(data.conversationId)) return;
      const ids = await memberIdsIfMember(data.conversationId, me.id).catch(() => null);
      if (!ids) return;
      emitToUsers(
        ids.filter((id) => id !== me.id),
        'typing',
        { conversationId: data.conversationId, userId: me.id, typing: !!data.typing }
      );
    });

    socket.on('disconnect', async () => {
      const left = (online.get(me.id) || 1) - 1;
      if (left > 0) return online.set(me.id, left);
      online.delete(me.id);
      const now = new Date();
      await query(`UPDATE users SET last_seen_at = ? WHERE id = ?`, [now, me.id]).catch(() => {});
      emitToUsers(await contactIds(me.id).catch(() => []), 'presence', {
        userId: me.id,
        online: false,
        lastSeenAt: now.toISOString(),
      });
    });
  });
}
