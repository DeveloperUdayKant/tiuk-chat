import { create } from 'zustand';
import { io } from 'socket.io-client';
import { api, setUnauthorizedHandler } from './lib/api.js';
import { BASE } from './lib/base.js';
import * as E2E from './lib/crypto.js';
import * as KS from './lib/keystore.js';

let socket = null;
const fileUrls = new Map(); // fileId -> Promise<objectURL>
const pendingSends = new Map(); // messageId -> { text, files } for retry
const userFetches = new Map();
const typingTimers = new Map();

const MAX_TEXT = 20000;

// ── helpers ──────────────────────────────────────────────────────────────

const strip = ({ ciphertext, key, iv, ...rest }, extra) => ({ ...rest, pending: false, failed: false, progress: null, ...extra });

/** Peers control decrypted payloads, so shape-check them before rendering. */
function sanitizePayload(p) {
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    text: str(p?.text, MAX_TEXT),
    files: (Array.isArray(p?.files) ? p.files : []).slice(0, 20)
      .filter((f) => f && typeof f.id === 'string' && typeof f.key === 'string' && typeof f.iv === 'string')
      .map((f) => ({
        id: f.id, key: f.key, iv: f.iv,
        name: str(f.name, 255) || 'file',
        type: str(f.type, 120) || 'application/octet-stream',
        size: Number.isFinite(f.size) ? f.size : 0,
      })),
  };
}

function sortMessages(items) {
  return items.sort((a, b) => {
    if (a.seq && b.seq) return a.seq - b.seq;
    if (a.seq) return -1;
    if (b.seq) return 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

const convTime = (c) => new Date(c.lastMessageAt || c.createdAt).getTime();

function resolveTheme(pref) {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialThemePref() {
  try { return localStorage.getItem('tiuk:theme') || 'system'; } catch { return 'system'; }
}

const emptyState = {
  me: null,
  privateKey: null,
  users: {},
  conversations: {},
  activeId: null,
  messages: {},
  typing: {},
  keyAlerts: {},
  infoOpen: false,
};

// ── store ────────────────────────────────────────────────────────────────

export const useStore = create((set, get) => {
  const toast = (message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  };

  const patchConv = (id, patch) => set((s) => {
    const c = s.conversations[id];
    if (!c) return {};
    return { conversations: { ...s.conversations, [id]: { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } } };
  });

  const upsertMessages = (convId, msgs, extra = {}) => set((s) => {
    const cur = s.messages[convId] || { items: [], hasMore: true, loaded: false };
    const byId = new Map(cur.items.map((m) => [m.id, m]));
    for (const m of msgs) {
      const prev = byId.get(m.id);
      // Keep a payload we already have (e.g. local previews) if the incoming copy failed to decrypt.
      byId.set(m.id, prev && !m.payload && prev.payload ? { ...prev, ...m, payload: prev.payload } : { ...prev, ...m });
    }
    return { messages: { ...s.messages, [convId]: { ...cur, ...extra, items: sortMessages([...byId.values()]) } } };
  });

  const patchMessage = (convId, id, patch) => set((s) => {
    const cur = s.messages[convId];
    if (!cur) return {};
    return {
      messages: {
        ...s.messages,
        [convId]: { ...cur, items: cur.items.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)) },
      },
    };
  });

  const mergeUser = (u) => set((s) => ({ users: { ...s.users, [u.id]: { ...s.users[u.id], ...u } } }));

  async function ensureUser(id) {
    const known = get().users[id];
    if (known?.publicKey) return known;
    if (!userFetches.has(id)) {
      userFetches.set(id, api.get(`/users/${id}`).then(({ user }) => { mergeUser(user); return user; })
        .finally(() => userFetches.delete(id)));
    }
    return userFetches.get(id);
  }

  async function decorate(raw) {
    if (raw.kind === 'system') return strip(raw);
    const { me, privateKey } = get();
    try {
      const sender = await ensureUser(raw.senderId);
      const payload = await E2E.decryptMessage({ message: raw, myId: me.id, privateKey, senderPublicKey: sender.publicKey });
      return strip(raw, { payload: sanitizePayload(payload) });
    } catch {
      return strip(raw, { payload: null, error: raw.key ? 'decrypt_failed' : 'no_key' });
    }
  }

  async function ingestConversation(c) {
    const { me } = get();
    set((s) => {
      const users = { ...s.users };
      for (const m of c.members) {
        users[m.id] = { ...users[m.id], id: m.id, username: m.username, displayName: m.displayName, about: m.about,
          publicKey: m.publicKey, online: m.online, lastSeenAt: m.lastSeenAt };
      }
      return { users };
    });

    const alerts = {};
    for (const m of c.members) {
      if (m.id !== me.id && KS.checkPinnedKey(me.id, m) === 'changed') alerts[m.id] = true;
    }

    const lastMessage = c.lastMessage ? await decorate(c.lastMessage) : null;
    const conv = {
      id: c.id, type: c.type, name: c.name, createdBy: c.createdBy, createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt, role: c.role, lastReadSeq: c.lastReadSeq, unread: c.unread,
      members: c.members.map((m) => ({ id: m.id, role: m.role, lastReadSeq: m.lastReadSeq })),
      lastMessage,
    };
    set((s) => ({
      conversations: { ...s.conversations, [c.id]: { ...s.conversations[c.id], ...conv } },
      keyAlerts: { ...s.keyAlerts, ...alerts },
    }));
    return conv;
  }

  function connectSocket() {
    socket?.disconnect();
    // Default transports: start with long-polling and upgrade to WebSocket when the host allows it
    // (some shared hosts / proxies block WebSockets).
    socket = io({ path: `${BASE}/socket.io`, withCredentials: true });
    let wasConnected = false;

    socket.on('connect', () => {
      set({ online: true });
      if (wasConnected) get().resync();
      wasConnected = true;
    });
    socket.on('disconnect', () => set({ online: false }));
    socket.on('connect_error', (err) => {
      set({ online: false });
      if (err.message === 'unauthorized') get().handleSignedOut();
    });

    socket.on('message:new', async ({ message }) => {
      const s = get();
      if (!s.conversations[message.conversationId]) {
        await get().refreshConversation(message.conversationId);
        return;
      }
      const m = await decorate(message);
      if (get().messages[m.conversationId]?.loaded) upsertMessages(m.conversationId, [m]);
      pendingSends.delete(m.id);
      const mine = m.senderId === get().me.id;
      patchConv(m.conversationId, (c) => ({
        lastMessage: m.seq >= (c.lastMessage?.seq || 0) ? m : c.lastMessage,
        lastMessageAt: m.createdAt,
        unread: mine || m.kind === 'system' ? c.unread : c.unread + 1,
      }));
      if (!mine) {
        clearTyping(m.conversationId, m.senderId);
        get().markRead(m.conversationId);
      }
    });

    socket.on('conversation:changed', ({ conversationId }) => get().refreshConversation(conversationId));

    socket.on('conversation:removed', ({ conversationId }) => {
      const c = get().conversations[conversationId];
      if (c) toast(`You are no longer a member of “${c.name || 'this group'}”.`);
      set((s) => {
        const conversations = { ...s.conversations };
        delete conversations[conversationId];
        return { conversations, activeId: s.activeId === conversationId ? null : s.activeId };
      });
    });

    socket.on('conversation:read', ({ conversationId, userId, seq }) => {
      patchConv(conversationId, (c) => ({
        members: c.members.map((m) => (m.id === userId ? { ...m, lastReadSeq: Math.max(m.lastReadSeq, seq) } : m)),
        ...(userId === get().me.id && seq >= (c.lastMessage?.seq || 0) ? { unread: 0, lastReadSeq: seq } : {}),
      }));
    });

    socket.on('presence', ({ userId, online, lastSeenAt }) => {
      if (get().users[userId]) mergeUser({ id: userId, online, ...(lastSeenAt ? { lastSeenAt } : {}) });
    });

    socket.on('user:updated', ({ user }) => mergeUser(user));

    socket.on('typing', ({ conversationId, userId, typing }) => {
      if (!typing) return clearTyping(conversationId, userId);
      set((s) => ({ typing: { ...s.typing, [conversationId]: { ...s.typing[conversationId], [userId]: true } } }));
      const k = `${conversationId}:${userId}`;
      clearTimeout(typingTimers.get(k));
      typingTimers.set(k, setTimeout(() => clearTyping(conversationId, userId), 6000));
    });
  }

  function clearTyping(conversationId, userId) {
    clearTimeout(typingTimers.get(`${conversationId}:${userId}`));
    set((s) => {
      if (!s.typing[conversationId]?.[userId]) return {};
      const t = { ...s.typing[conversationId] };
      delete t[userId];
      return { typing: { ...s.typing, [conversationId]: t } };
    });
  }

  async function startSession(user, privateKey) {
    await KS.saveIdentity(user.id, privateKey);
    set({ ...emptyState, me: user, privateKey, status: 'ready' });
    connectSocket();
    await get().loadConversations();
  }

  return {
    status: 'loading',
    online: false,
    limits: { maxFileBytes: 50 * 1048576, maxFilesPerMessage: 10, kdfIterations: 600000 },
    toasts: [],
    themePref: initialThemePref(),
    theme: resolveTheme(initialThemePref()),
    ...emptyState,

    toast,

    setTheme(pref) {
      try { localStorage.setItem('tiuk:theme', pref); } catch { /* ignore */ }
      set({ themePref: pref, theme: resolveTheme(pref) });
    },
    syncSystemTheme() {
      set((s) => ({ theme: resolveTheme(s.themePref) }));
    },

    // ── session ──
    async boot() {
      setUnauthorizedHandler(() => get().handleSignedOut());
      api.get('/config').then((limits) => set({ limits })).catch(() => {});
      try {
        const { user } = await api.get('/auth/me');
        const privateKey = await KS.loadIdentity(user.id);
        if (!privateKey) return set({ me: user, status: 'locked' });
        await startSession(user, privateKey);
      } catch {
        set({ status: 'signedOut' });
      }
    },

    async register({ username, displayName, password }) {
      const kdfSalt = E2E.newKdfSalt();
      const kdfIterations = get().limits.kdfIterations;
      const { authKey, vaultKey } = await E2E.deriveKeys(password, kdfSalt, kdfIterations);
      const id = await E2E.createIdentity(vaultKey);
      const { user } = await api.post('/auth/register', {
        username, displayName, authKey, kdfSalt, kdfIterations,
        publicKey: id.publicKey, encryptedPrivateKey: id.encryptedPrivateKey, privateKeyIv: id.privateKeyIv,
      });
      await startSession(user, id.privateKey);
    },

    async login({ username, password }) {
      const { kdfSalt, kdfIterations } = await api.post('/auth/prelogin', { username });
      const { authKey, vaultKey } = await E2E.deriveKeys(password, kdfSalt, kdfIterations);
      const { user, vault } = await api.post('/auth/login', { username, authKey });
      const privateKey = await E2E.openVault(vault, vaultKey);
      await startSession(user, privateKey);
    },

    async unlock(password) {
      const { vault, kdfSalt, kdfIterations } = await api.get('/auth/vault');
      const { vaultKey } = await E2E.deriveKeys(password, kdfSalt, kdfIterations);
      let privateKey;
      try {
        privateKey = await E2E.openVault(vault, vaultKey);
      } catch {
        throw new Error('That password is not correct.');
      }
      await startSession(get().me, privateKey);
    },

    async logout() {
      await api.post('/auth/logout').catch(() => {});
      get().handleSignedOut();
    },

    handleSignedOut() {
      socket?.disconnect();
      socket = null;
      KS.clearIdentity();
      E2E.resetCryptoCache();
      for (const p of fileUrls.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
      fileUrls.clear();
      pendingSends.clear();
      set({ ...emptyState, status: 'signedOut', online: false });
    },

    async updateProfile(patch) {
      const { user } = await api.patch('/users/me', patch);
      set((s) => ({ me: { ...s.me, ...user } }));
      mergeUser(user);
    },

    // ── conversations ──
    async loadConversations() {
      const { conversations } = await api.get('/conversations');
      await Promise.all(conversations.map(ingestConversation));
    },

    async refreshConversation(id) {
      try {
        const { conversation } = await api.get(`/conversations/${id}`);
        return await ingestConversation(conversation);
      } catch (err) {
        if (err.status === 404) {
          set((s) => {
            const conversations = { ...s.conversations };
            delete conversations[id];
            return { conversations, activeId: s.activeId === id ? null : s.activeId };
          });
        }
        return null;
      }
    },

    async resync() {
      await get().loadConversations().catch(() => {});
      const { activeId } = get();
      if (activeId) await get().loadMessages(activeId, { refresh: true }).catch(() => {});
    },

    sortedConversations() {
      return Object.values(get().conversations).sort((a, b) => convTime(b) - convTime(a));
    },

    openConversation(id) {
      set({ activeId: id });
      if (!id) return;
      const state = get().messages[id];
      if (!state?.loaded) get().loadMessages(id);
      else get().markRead(id);
    },

    toggleInfo(open) {
      set((s) => ({ infoOpen: open ?? !s.infoOpen }));
    },

    async startDirect(userId) {
      const { conversation } = await api.post('/conversations/direct', { userId });
      await ingestConversation(conversation);
      get().openConversation(conversation.id);
    },

    async createGroup(name, memberIds) {
      const { conversation } = await api.post('/conversations/group', { name, memberIds });
      await ingestConversation(conversation);
      get().openConversation(conversation.id);
    },

    async renameGroup(id, name) {
      await api.patch(`/conversations/${id}`, { name });
    },

    async addMembers(id, userIds) {
      await api.post(`/conversations/${id}/members`, { userIds });
    },

    async removeMember(id, userId) {
      await api.del(`/conversations/${id}/members/${userId}`);
      if (userId === get().me.id) {
        set((s) => {
          const conversations = { ...s.conversations };
          delete conversations[id];
          return { conversations, activeId: null, infoOpen: false };
        });
      }
    },

    // ── messages ──
    async loadMessages(convId, { older = false, refresh = false } = {}) {
      const cur = get().messages[convId];
      if (cur?.loading) return;
      set((s) => ({ messages: { ...s.messages, [convId]: { items: [], hasMore: true, ...cur, loading: true } } }));
      try {
        const before = older ? cur?.items.find((m) => m.seq)?.seq : undefined;
        const { messages, hasMore } = await api.get(`/conversations/${convId}/messages${before ? `?before=${before}` : ''}`);
        const decorated = await Promise.all(messages.map(decorate));
        upsertMessages(convId, decorated, {
          loaded: true, loading: false,
          hasMore: older || !refresh || !cur?.loaded ? hasMore : cur.hasMore,
        });
        if (!older) get().markRead(convId);
      } catch (err) {
        set((s) => ({ messages: { ...s.messages, [convId]: { ...s.messages[convId], loading: false, loaded: true } } }));
        toast(err.message || 'Could not load messages.', 'error');
      }
    },

    markRead(convId) {
      const s = get();
      if (s.activeId !== convId || document.visibilityState !== 'visible') return;
      const c = s.conversations[convId];
      if (!c) return;
      const items = s.messages[convId]?.items || [];
      const lastSeq = Math.max(c.lastMessage?.seq || 0, ...items.map((m) => m.seq || 0));
      if (lastSeq > c.lastReadSeq || c.unread) {
        patchConv(convId, { lastReadSeq: lastSeq, unread: 0 });
        if (lastSeq > 0) api.post(`/conversations/${convId}/read`, { seq: lastSeq }).catch(() => {});
      }
    },

    sendTyping(conversationId, typing) {
      socket?.emit('typing', { conversationId, typing });
    },

    acceptKeyChange(userId) {
      const { me, users } = get();
      KS.acceptKey(me.id, users[userId]);
      KS.setVerified(me.id, users[userId], false);
      set((s) => {
        const keyAlerts = { ...s.keyAlerts };
        delete keyAlerts[userId];
        return { keyAlerts };
      });
    },

    async sendMessage(convId, { text = '', files = [] }, retryId) {
      const { me, limits } = get();
      text = text.trim().slice(0, MAX_TEXT);
      if (!text && !files.length) return;
      if (files.length > limits.maxFilesPerMessage) {
        return toast(`You can send up to ${limits.maxFilesPerMessage} files at once.`, 'error');
      }
      const tooBig = files.find((f) => f.size > limits.maxFileBytes);
      if (tooBig) return toast(`“${tooBig.name}” is larger than ${Math.round(limits.maxFileBytes / 1048576)} MB.`, 'error');

      const id = retryId || E2E.uuid();
      pendingSends.set(id, { text, files });
      const localFiles = files.map((f) => ({
        name: f.name, type: f.type || 'application/octet-stream', size: f.size, localUrl: URL.createObjectURL(f),
      }));
      const optimistic = {
        id, conversationId: convId, senderId: me.id, kind: 'encrypted', createdAt: new Date().toISOString(),
        pending: true, failed: false, progress: files.length ? 0 : null, payload: { text, files: localFiles },
      };
      upsertMessages(convId, [optimistic]);
      patchConv(convId, { lastMessage: optimistic, lastMessageAt: optimistic.createdAt });

      try {
        const total = files.reduce((n, f) => n + f.size, 0) || 1;
        let done = 0;
        const uploaded = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const enc = await E2E.encryptFile(await f.arrayBuffer());
          const res = await api.post(`/files?conversationId=${convId}`, enc.blob, {
            onProgress: (p) => patchMessage(convId, id, { progress: (done + p * f.size) / total }),
          });
          done += f.size;
          fileUrls.set(res.id, Promise.resolve(localFiles[i].localUrl));
          uploaded.push({ id: res.id, name: f.name, type: localFiles[i].type, size: f.size, key: enc.key, iv: enc.iv });
        }
        const payload = { v: 1, text, files: uploaded };

        const attempt = async () => {
          const s = get();
          const conv = s.conversations[convId];
          const recipients = await Promise.all(conv.members.map(async (m) => {
            const u = await ensureUser(m.id);
            return { id: m.id, publicKey: u.publicKey };
          }));
          const env = await E2E.encryptMessage({
            conversationId: convId, messageId: id, senderId: me.id, privateKey: s.privateKey, recipients, payload,
          });
          return api.post(`/conversations/${convId}/messages`, { id, ...env, fileIds: uploaded.map((f) => f.id) });
        };

        let res;
        try {
          res = await attempt();
        } catch (err) {
          if (err.code !== 'members_changed') throw err;
          await get().refreshConversation(convId);
          res = await attempt();
        }
        pendingSends.delete(id);
        const sent = strip(res.message, { payload: sanitizePayload(payload), pending: false, failed: false, progress: null });
        upsertMessages(convId, [sent]);
        patchConv(convId, (c) => ({
          lastMessage: sent.seq >= (c.lastMessage?.seq || 0) ? sent : c.lastMessage,
          lastMessageAt: sent.createdAt, lastReadSeq: Math.max(c.lastReadSeq, sent.seq), unread: 0,
        }));
      } catch (err) {
        if (err.code === 'duplicate') return;
        patchMessage(convId, id, { pending: false, failed: true, progress: null, errorText: err.message });
        toast(err.message || 'Message could not be sent.', 'error');
      }
    },

    retryMessage(convId, id) {
      const p = pendingSends.get(id);
      if (!p) return;
      get().sendMessage(convId, p, id);
    },

    discardMessage(convId, id) {
      pendingSends.delete(id);
      set((s) => {
        const cur = s.messages[convId];
        return { messages: { ...s.messages, [convId]: { ...cur, items: cur.items.filter((m) => m.id !== id) } } };
      });
    },
  };
});

// ── encrypted file access ────────────────────────────────────────────────

/** Downloads and decrypts an attachment. Returns an object URL for inline display. */
export function getFileUrl(file, previewType) {
  if (file.localUrl) return Promise.resolve(file.localUrl);
  const cacheKey = `${file.id}:${previewType || 'bin'}`;
  if (!fileUrls.has(file.id) && !fileUrls.has(cacheKey)) {
    const p = (async () => {
      const res = await api.get(`/files/${file.id}`, { raw: true });
      const pt = await E2E.decryptFile(await res.arrayBuffer(), file.key, file.iv);
      // Never trust peer-supplied MIME types for anything a browser could execute.
      return URL.createObjectURL(new Blob([pt], { type: previewType || 'application/octet-stream' }));
    })();
    fileUrls.set(cacheKey, p);
    p.catch(() => fileUrls.delete(cacheKey));
  }
  return fileUrls.get(file.id) || fileUrls.get(cacheKey);
}

export async function downloadFile(file) {
  const url = await getFileUrl(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name || 'file';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
