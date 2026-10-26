/**
 * Seeds demo accounts and conversations through the running API (development only).
 * Uses the real client crypto, so everything stored is properly end-to-end encrypted.
 *
 *   npm run seed:demo            → users uday_demo, riya_demo, arjun_demo, neha_demo
 *   password for all: demo-password-123
 */
import 'dotenv/config';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const E2E = await import('../client/src/lib/crypto.js');

const BASE = process.env.API || `http://localhost:${process.env.PORT || 4000}`;
const PASSWORD = 'demo-password-123';
const ITER = 600000;

async function call(u, method, path, body) {
  const headers = { 'X-Tiuk-Client': '1' };
  if (u?.cookie) headers.Cookie = u.cookie;
  let payload;
  if (body instanceof Uint8Array) { headers['Content-Type'] = 'application/octet-stream'; payload = body; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: payload });
  const cookie = res.headers.get('set-cookie');
  if (u && cookie) u.cookie = cookie.split(';')[0];
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.message}`);
  return data;
}

async function register(username, displayName, about) {
  const u = { username };
  const kdfSalt = E2E.newKdfSalt();
  const { authKey, vaultKey } = await E2E.deriveKeys(PASSWORD, kdfSalt, ITER);
  const id = await E2E.createIdentity(vaultKey);
  const r = await call(u, 'POST', '/auth/register', {
    username, displayName, authKey, kdfSalt, kdfIterations: ITER,
    publicKey: id.publicKey, encryptedPrivateKey: id.encryptedPrivateKey, privateKeyIv: id.privateKeyIv,
  });
  Object.assign(u, r.user, { privateKey: id.privateKey });
  if (about) await call(u, 'PATCH', '/users/me', { about });
  return u;
}

async function send(from, conv, text, files = []) {
  const uploaded = [];
  for (const f of files) {
    const enc = await E2E.encryptFile(f.bytes);
    const up = await call(from, 'POST', `/files?conversationId=${conv.id}`, enc.blob);
    uploaded.push({ id: up.id, name: f.name, type: f.type, size: f.bytes.length, key: enc.key, iv: enc.iv });
  }
  const id = E2E.uuid();
  const env = await E2E.encryptMessage({
    conversationId: conv.id, messageId: id, senderId: from.id, privateKey: from.privateKey,
    recipients: conv.members.map((m) => ({ id: m.id, publicKey: m.publicKey })),
    payload: { v: 1, text, files: uploaded },
  });
  return (await call(from, 'POST', `/conversations/${conv.id}/messages`, { id, ...env, fileIds: uploaded.map((f) => f.id) })).message;
}

const uday = await register('uday_demo', 'Uday Kant', 'Your digital partner');
const riya = await register('riya_demo', 'Riya Sharma', 'Design lead');
const arjun = await register('arjun_demo', 'Arjun Mehta', 'Backend engineer');
const neha = await register('neha_demo', 'Neha Verma', 'QA');

const dm = (await call(uday, 'POST', '/conversations/direct', { userId: riya.id })).conversation;
await send(riya, dm, 'Hey Uday! Did you get a chance to look at the new TIUK Chat screens?');
await send(uday, dm, 'Yes! The dark rail with the orange accents looks 🔥');
await send(uday, dm, 'Sharing the brand assets so we stay consistent', [
  { name: 'tiuk-mark.png', type: 'image/png', bytes: fs.readFileSync(new URL('../client/public/brand/icon-512.png', import.meta.url)) },
]);
const q = await send(riya, dm, 'Everything here is end-to-end encrypted, right? Even the files?');
await call(uday, 'POST', `/conversations/${dm.id}/read`, { seq: q.seq });
const a = await send(uday, dm, 'Exactly. Keys never leave our devices. You can compare safety numbers in the info panel 🔐');
await call(riya, 'POST', `/conversations/${dm.id}/read`, { seq: a.seq });

const group = (await call(uday, 'POST', '/conversations/group', { name: 'Launch crew', memberIds: [riya.id, arjun.id, neha.id] })).conversation;
await send(arjun, group, 'Backend is ready for the beta. Socket reconnects are solid now.');
await send(neha, group, 'QA passed on Chrome, Edge and Safari ✅');
await send(arjun, group, 'Release notes attached', [
  { name: 'release-notes-v0.1.txt', type: 'text/plain', bytes: new TextEncoder().encode('TIUK Chat v0.1\n- E2E encrypted 1:1 and group chat\n- Encrypted multi-file sharing\n') },
]);

const dm2 = (await call(arjun, 'POST', '/conversations/direct', { userId: uday.id })).conversation;
await send(arjun, dm2, 'Can we sync about voice & video calls tomorrow?');

console.log(`Seeded. Sign in as uday_demo (or riya_demo, arjun_demo, neha_demo) with password: ${PASSWORD}`);
