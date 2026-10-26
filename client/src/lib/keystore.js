/**
 * Keeps the decrypted identity key on this device between page loads.
 * The CryptoKey is stored non-extractable: scripts can use it but can
 * never read the raw key bytes back out of IndexedDB.
 */
const DB = 'tiuk-chat';
const STORE = 'keys';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function saveIdentity(userId, privateKey) {
  await run('readwrite', (s) => s.put({ userId, privateKey }, 'identity'));
}

export async function loadIdentity(userId) {
  try {
    const rec = await run('readonly', (s) => s.get('identity'));
    return rec && rec.userId === userId ? rec.privateKey : null;
  } catch {
    return null;
  }
}

export async function clearIdentity() {
  try {
    await run('readwrite', (s) => s.delete('identity'));
  } catch {
    /* nothing stored */
  }
}

// ── trust-on-first-use key pinning + manual verification ─────────────────

const read = (k) => {
  try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
};

/** Returns 'new' | 'same' | 'changed' and pins the key on first sight. */
export function checkPinnedKey(myId, user) {
  const k = `tiuk:pins:${myId}`;
  const pins = read(k);
  const pinned = pins[user.id];
  if (!pinned) {
    pins[user.id] = user.publicKey;
    write(k, pins);
    return 'new';
  }
  return pinned === user.publicKey ? 'same' : 'changed';
}

export function acceptKey(myId, user) {
  const k = `tiuk:pins:${myId}`;
  write(k, { ...read(k), [user.id]: user.publicKey });
}

export function isVerified(myId, user) {
  return read(`tiuk:verified:${myId}`)[user.id] === user.publicKey;
}

export function setVerified(myId, user, verified) {
  const k = `tiuk:verified:${myId}`;
  const v = read(k);
  if (verified) v[user.id] = user.publicKey;
  else delete v[user.id];
  write(k, v);
}
