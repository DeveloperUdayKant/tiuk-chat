/**
 * TIUK Chat end-to-end encryption (WebCrypto only, no third-party crypto).
 *
 * Identity       Each account has an ECDH P-256 key pair generated in the browser.
 *                The private key is encrypted with a "vault key" derived from the
 *                password (PBKDF2-SHA256 → HKDF), so the server only stores ciphertext.
 * Login          The same PBKDF2 output yields a separate "auth key" via HKDF. Only the
 *                auth key is sent to the server; the password and vault key never leave.
 * Messages       Each message gets a fresh random AES-256-GCM content key. The content
 *                key is wrapped once per recipient (including the sender) with a key
 *                derived from static ECDH(sender, recipient) + HKDF. AAD binds every
 *                ciphertext to its conversation, message id, sender and recipient.
 * Files          Each file is encrypted with its own AES-256-GCM key; that key travels
 *                inside the encrypted message, never in the clear.
 */

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();
const ZERO_SALT = new Uint8Array(32);
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };

// ── encoding helpers ─────────────────────────────────────────────────────

export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const uuid = () => globalThis.crypto.randomUUID();

async function aesEncrypt(key, data, aad) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, data);
  return { iv, ct: new Uint8Array(ct) };
}

async function aesDecrypt(key, iv, ct, aad) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, ct));
}

const importAes = (raw, usages = ['encrypt', 'decrypt']) =>
  subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);

// ── password → auth key + vault key ──────────────────────────────────────

export async function deriveKeys(password, saltB64, iterations) {
  const base = await subtle.importKey('raw', te.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const master = await subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' }, base, 256
  );
  const hkdf = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const authBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: ZERO_SALT, info: te.encode('tiuk-chat/auth/v1') }, hkdf, 256
  );
  const vaultKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ZERO_SALT, info: te.encode('tiuk-chat/vault/v1') },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  return { authKey: toB64(authBits), vaultKey };
}

export const newKdfSalt = () => toB64(randomBytes(16));

// ── identity keys ────────────────────────────────────────────────────────

/** Creates a new identity and returns what the server stores + the usable private key. */
export async function createIdentity(vaultKey) {
  const pair = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const spki = await subtle.exportKey('spki', pair.publicKey);
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const { iv, ct } = await aesEncrypt(vaultKey, pkcs8, 'tiuk-chat/identity/v1');
  const privateKey = await subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']);
  pkcs8.fill(0);
  return {
    publicKey: toB64(spki),
    encryptedPrivateKey: toB64(ct),
    privateKeyIv: toB64(iv),
    privateKey,
  };
}

/** Decrypts the vault into a non-extractable private key. Throws if the password is wrong. */
export async function openVault(vault, vaultKey) {
  const pkcs8 = await aesDecrypt(vaultKey, fromB64(vault.privateKeyIv), fromB64(vault.encryptedPrivateKey), 'tiuk-chat/identity/v1');
  const key = await subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']);
  pkcs8.fill(0);
  return key;
}

// ── pairwise wrapping keys ───────────────────────────────────────────────

const pairCache = new Map();
let cacheOwner = null;

export function resetCryptoCache() {
  pairCache.clear();
  cacheOwner = null;
}

async function pairKey(myPrivateKey, theirPublicKeyB64) {
  if (cacheOwner !== myPrivateKey) {
    pairCache.clear();
    cacheOwner = myPrivateKey;
  }
  let p = pairCache.get(theirPublicKeyB64);
  if (!p) {
    p = (async () => {
      const pub = await subtle.importKey('spki', fromB64(theirPublicKeyB64), CURVE, false, []);
      const shared = await subtle.deriveBits({ name: 'ECDH', public: pub }, myPrivateKey, 256);
      const hkdf = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
      return subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: ZERO_SALT, info: te.encode('tiuk-chat/wrap/v1') },
        hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      );
    })();
    pairCache.set(theirPublicKeyB64, p);
    p.catch(() => pairCache.delete(theirPublicKeyB64));
  }
  return p;
}

const msgAad = (conversationId, messageId, senderId) => `tiuk-chat/msg/v1|${conversationId}|${messageId}|${senderId}`;
const keyAad = (messageId, senderId, recipientId) => `tiuk-chat/key/v1|${messageId}|${senderId}|${recipientId}`;

// ── messages ─────────────────────────────────────────────────────────────

/**
 * @param recipients [{ id, publicKey }] — every member, including the sender.
 * @param payload    plain JS object, e.g. { text, files: [...] }
 */
export async function encryptMessage({ conversationId, messageId, senderId, privateKey, recipients, payload }) {
  const contentKeyRaw = randomBytes(32);
  const contentKey = await importAes(contentKeyRaw, ['encrypt']);
  const { iv, ct } = await aesEncrypt(contentKey, te.encode(JSON.stringify(payload)), msgAad(conversationId, messageId, senderId));

  const keys = await Promise.all(recipients.map(async (r) => {
    const wrap = await pairKey(privateKey, r.publicKey);
    const w = await aesEncrypt(wrap, contentKeyRaw, keyAad(messageId, senderId, r.id));
    return { userId: r.id, wrappedKey: toB64(w.ct), iv: toB64(w.iv) };
  }));
  contentKeyRaw.fill(0);
  return { ciphertext: toB64(ct), iv: toB64(iv), keys };
}

export async function decryptMessage({ message, myId, privateKey, senderPublicKey }) {
  if (!message.key) throw new Error('no_key');
  const wrap = await pairKey(privateKey, senderPublicKey);
  const contentKeyRaw = await aesDecrypt(
    wrap, fromB64(message.key.iv), fromB64(message.key.wrappedKey), keyAad(message.id, message.senderId, myId)
  );
  const contentKey = await importAes(contentKeyRaw, ['decrypt']);
  contentKeyRaw.fill(0);
  const pt = await aesDecrypt(
    contentKey, fromB64(message.iv), fromB64(message.ciphertext),
    msgAad(message.conversationId, message.id, message.senderId)
  );
  return JSON.parse(td.decode(pt));
}

// ── files ────────────────────────────────────────────────────────────────

export async function encryptFile(buffer) {
  const raw = randomBytes(32);
  const key = await importAes(raw, ['encrypt']);
  const { iv, ct } = await aesEncrypt(key, buffer, 'tiuk-chat/file/v1');
  return { blob: ct, key: toB64(raw), iv: toB64(iv) };
}

export async function decryptFile(buffer, keyB64, ivB64) {
  const key = await importAes(fromB64(keyB64), ['decrypt']);
  return aesDecrypt(key, fromB64(ivB64), new Uint8Array(buffer), 'tiuk-chat/file/v1');
}

// ── verification ─────────────────────────────────────────────────────────

async function fingerprintDigits(userId, publicKeyB64) {
  let data = new Uint8Array([...te.encode(`tiuk-chat/fp/v1|${userId}|`), ...fromB64(publicKeyB64)]);
  for (let i = 0; i < 1024; i++) data = new Uint8Array(await subtle.digest('SHA-256', data));
  let out = '';
  for (let i = 0; i < 6; i++) {
    const chunk = data.subarray(i * 5, i * 5 + 5);
    const n = chunk.reduce((acc, b) => acc * 256 + b, 0) % 100000;
    out += String(n).padStart(5, '0');
  }
  return out;
}

/**
 * A 60-digit safety number both people can compare out-of-band. It matches on
 * both devices only if neither public key was swapped by the server.
 */
export async function safetyNumber(a, b) {
  const [x, y] = [a, b].sort((p, q) => (p.id < q.id ? -1 : 1));
  const digits = (await fingerprintDigits(x.id, x.publicKey)) + (await fingerprintDigits(y.id, y.publicKey));
  return digits.match(/.{5}/g);
}
