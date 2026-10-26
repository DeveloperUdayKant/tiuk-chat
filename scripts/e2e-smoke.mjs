/**
 * End-to-end smoke test against a running API (default http://localhost:4000).
 * Uses the real client crypto module, so it verifies the full E2E flow:
 *   register → direct chat → realtime delivery → decrypt → group → encrypted file → access control.
 *
 *   node scripts/e2e-smoke.mjs
 */
import { webcrypto } from 'node:crypto';
import { io } from 'socket.io-client';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const E2E = await import('../client/src/lib/crypto.js');

const BASE = process.env.API || 'http://localhost:4000';
const ITER = 600000;
const run = Date.now().toString(36);
let failures = 0;

const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};

async function call(user, method, path, body, raw) {
  const headers = { 'X-Tiuk-Client': '1' };
  if (user?.cookie) headers.Cookie = user.cookie;
  let payload;
  if (body instanceof Uint8Array) { headers['Content-Type'] = 'application/octet-stream'; payload = body; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + '/api' + path, { method, headers, body: payload });
  const setCookie = res.headers.get('set-cookie');
  if (user && setCookie) user.cookie = setCookie.split(';')[0];
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

async function register(name) {
  const u = { username: `${name}_${run}`, displayName: name[0].toUpperCase() + name.slice(1), password: `pw-${name}-correct horse` };
  const kdfSalt = E2E.newKdfSalt();
  const { authKey, vaultKey } = await E2E.deriveKeys(u.password, kdfSalt, ITER);
  const id = await E2E.createIdentity(vaultKey);
  const r = await call(u, 'POST', '/auth/register', {
    username: u.username, displayName: u.displayName, authKey, kdfSalt, kdfIterations: ITER,
    publicKey: id.publicKey, encryptedPrivateKey: id.encryptedPrivateKey, privateKeyIv: id.privateKeyIv,
  });
  if (r.status !== 201) throw new Error(`register ${name}: ${JSON.stringify(r)}`);
  Object.assign(u, r.user, { privateKey: id.privateKey });
  return u;
}

function connect(u) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], extraHeaders: { Cookie: u.cookie } });
    s.inbox = [];
    s.on('message:new', ({ message }) => s.inbox.push(message));
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const waitFor = async (fn, ms = 3000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

async function send(from, conv, payload, fileIds = []) {
  const messageId = E2E.uuid();
  const recipients = conv.members.map((m) => ({ id: m.id, publicKey: m.publicKey }));
  const env = await E2E.encryptMessage({ conversationId: conv.id, messageId, senderId: from.id, privateKey: from.privateKey, recipients, payload });
  return call(from, 'POST', `/conversations/${conv.id}/messages`, { id: messageId, ...env, fileIds });
}

const open = (me, msg, sender) => E2E.decryptMessage({ message: msg, myId: me.id, privateKey: me.privateKey, senderPublicKey: sender.publicKey });

console.log('Registering users…');
const [alice, bob, carol] = await Promise.all(['alice', 'bob', 'carol'].map(register));
ok(alice.id && bob.id && carol.id, 'three accounts created with client-generated keys');

console.log('Login with password-derived auth key…');
{
  const pre = await call(null, 'POST', '/auth/prelogin', { username: alice.username });
  const { authKey, vaultKey } = await E2E.deriveKeys(alice.password, pre.kdfSalt, pre.kdfIterations);
  const fresh = {};
  const r = await call(fresh, 'POST', '/auth/login', { username: alice.username, authKey });
  ok(r.status === 200, 'login accepted');
  const pk = await E2E.openVault(r.vault, vaultKey);
  ok(!!pk, 'vault decrypts with password');
  const bad = await E2E.deriveKeys('wrong password', pre.kdfSalt, pre.kdfIterations);
  const r2 = await call({}, 'POST', '/auth/login', { username: alice.username, authKey: bad.authKey });
  ok(r2.status === 401, 'wrong password rejected');
  const ghost = await call(null, 'POST', '/auth/prelogin', { username: `nobody_${run}` });
  ok(typeof ghost.kdfSalt === 'string', 'prelogin returns decoy salt for unknown users');
  const noHeader = await fetch(BASE + '/api/auth/logout', { method: 'POST' });
  ok(noHeader.status === 403, 'state-changing request without client header is rejected (CSRF guard)');
}

const [sa, sb, sc] = await Promise.all([alice, bob, carol].map(connect));
ok(true, 'websockets connected for all three users');

console.log('Direct chat…');
const search = await call(alice, 'GET', `/users/search?q=bob_${run}`);
ok(search.users?.[0]?.id === bob.id, 'alice finds bob by username');
const { conversation: dm } = await call(alice, 'POST', '/conversations/direct', { userId: bob.id });
ok(dm?.members?.length === 2, 'direct conversation created');
const again = await call(bob, 'POST', '/conversations/direct', { userId: alice.id });
ok(again.conversation.id === dm.id, 'direct conversation is deduplicated');

const sent = await send(alice, dm, { v: 1, text: 'Hello Bob 👋 this is secret', files: [] });
ok(sent.status === 201, 'alice sends encrypted message');
const got = await waitFor(() => sb.inbox.find((m) => m.id === sent.message.id));
ok(!!got, 'bob receives it in real time');
ok(!JSON.stringify(got).includes('secret'), 'server payload contains no plaintext');
const pt = await open(bob, got, alice);
ok(pt.text === 'Hello Bob 👋 this is secret', 'bob decrypts the message');
ok(await open(carol, got, alice).then(() => false, () => true), 'carol (outsider) cannot decrypt it');

const peek = await call(carol, 'GET', `/conversations/${dm.id}/messages`);
ok(peek.status === 404, 'outsider cannot list messages of the conversation');

const tampered = { ...got, conversationId: E2E.uuid() };
ok(await open(bob, tampered, alice).then(() => false, () => true), 'moving ciphertext to another conversation fails AAD check');

const missingKey = await call(alice, 'POST', `/conversations/${dm.id}/messages`, {
  id: E2E.uuid(), ciphertext: 'AAAA', iv: 'AAAAAAAAAAAAAAAA', keys: [], fileIds: [],
});
ok(missingKey.status === 409, 'server rejects messages not keyed for every member');

console.log('Read receipts & unread…');
let list = await call(bob, 'GET', '/conversations');
ok(list.conversations.find((c) => c.id === dm.id)?.unread === 1, 'bob has 1 unread');
await call(bob, 'POST', `/conversations/${dm.id}/read`, { seq: got.seq });
list = await call(bob, 'GET', '/conversations');
ok(list.conversations.find((c) => c.id === dm.id)?.unread === 0, 'unread cleared after read');

console.log('Group chat + encrypted file…');
const { conversation: group, status: gs } = await call(alice, 'POST', '/conversations/group', { name: 'Launch crew', memberIds: [bob.id, carol.id] });
ok(gs === 201 && group.members.length === 3, 'group with 3 members created');

const fileBytes = new TextEncoder().encode('%PDF-1.4 top secret roadmap '.repeat(200));
const encFile = await E2E.encryptFile(fileBytes);
const up = await call(alice, 'POST', `/files?conversationId=${group.id}`, encFile.blob);
ok(up.status === 201, 'encrypted blob uploaded');
const g1 = await send(alice, group, {
  v: 1, text: 'Roadmap attached',
  files: [{ id: up.id, name: 'roadmap.pdf', type: 'application/pdf', size: fileBytes.length, key: encFile.key, iv: encFile.iv }],
}, [up.id]);
ok(g1.status === 201, 'group message with attachment sent');
const gc = await waitFor(() => sc.inbox.find((m) => m.id === g1.message.id));
const gpt = await open(carol, gc, alice);
ok(gpt.files?.[0]?.name === 'roadmap.pdf', 'carol decrypts group message + file metadata');
const blobRes = await call(carol, 'GET', `/files/${up.id}`, undefined, true);
const blob = new Uint8Array(await blobRes.arrayBuffer());
ok(!new TextDecoder().decode(blob).includes('roadmap'), 'stored file is ciphertext');
const plain = await E2E.decryptFile(blob, gpt.files[0].key, gpt.files[0].iv);
ok(new TextDecoder().decode(plain) === new TextDecoder().decode(fileBytes), 'carol decrypts the downloaded file');

console.log('Membership changes…');
const rm = await call(bob, 'DELETE', `/conversations/${group.id}/members/${carol.id}`);
ok(rm.status === 403, 'non-admin cannot remove members');
const rm2 = await call(alice, 'DELETE', `/conversations/${group.id}/members/${carol.id}`);
ok(rm2.status === 200, 'admin removes carol');
const stale = await send(alice, group, { v: 1, text: 'stale member list', files: [] });
ok(stale.status === 409, 'sending with stale member list is rejected');
const { conversation: g2 } = await call(alice, 'GET', `/conversations/${group.id}`);
const g3 = await send(alice, g2, { v: 1, text: 'after carol left', files: [] });
ok(g3.status === 201, 'resend with refreshed members succeeds');
const carolFile = await call(carol, 'GET', `/files/${up.id}`);
ok(carolFile.status === 404, 'removed member loses file access');
const bobLeaves = await call(bob, 'DELETE', `/conversations/${group.id}/members/${bob.id}`);
ok(bobLeaves.status === 200, 'bob leaves the group');

console.log('Safety numbers…');
const sn1 = await E2E.safetyNumber(alice, bob);
const sn2 = await E2E.safetyNumber(bob, alice);
ok(sn1.join('') === sn2.join('') && sn1.length === 12, 'both sides compute the same 60-digit safety number');

[sa, sb, sc].forEach((s) => s.disconnect());
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
