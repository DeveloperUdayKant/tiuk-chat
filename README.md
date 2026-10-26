# TIUK Chat

End-to-end encrypted messaging, a product of [thisisudaykant.com](https://thisisudaykant.com).

- 1:1 and group chats with real-time delivery, typing indicators, presence and read receipts
- Encrypted sharing of multiple files per message (images and video preview inline)
- Safety-number verification and key-change warnings
- Light/dark themes, responsive down to phone width
- Voice and video calls are planned (see the roadmap)

## Stack

| Layer    | Tech |
|----------|------|
| Client   | React 18 + Vite, Zustand, WebCrypto (no third-party crypto) |
| Server   | Node.js 18+, Express, Socket.IO |
| Database | MySQL 8 (schema is created automatically on start) |
| Files    | Encrypted blobs on disk (`storage/uploads`) |

## Run locally (Laragon)

```bash
# Laragon's Node is at C:\laragon\bin\nodejs\node-v18. Use Laragon's terminal or add it to PATH.
npm install
cp .env.example .env          # set APP_SECRET; DB defaults match Laragon (root, no password)
npm run dev                   # API on :4000, web on http://localhost:5173
```

Optional:

```bash
npm run seed:demo             # demo users uday_demo / riya_demo / arjun_demo / neha_demo
                              # password: demo-password-123
npm run test:e2e              # 33-check end-to-end test against the running API
```

## How the encryption works

All cryptography runs in the browser via WebCrypto. The server stores and relays only ciphertext.

1. **Password → keys.** `PBKDF2-SHA256(password, salt, 600k)` → HKDF splits into an **auth key**
   (sent to the server, which stores only `scrypt(authKey)`) and a **vault key** (never leaves the device).
2. **Identity.** Each account has an ECDH P-256 key pair generated on the client. The private key is stored
   on the server encrypted with the vault key, so you can sign in from another device. On each device the
   unlocked key lives in IndexedDB as a **non-extractable** `CryptoKey`.
3. **Messages.** Each message gets a random AES-256-GCM key. That key is wrapped separately for every member
   (including the sender) using `ECDH(sender, recipient) → HKDF → AES-GCM`. Additional authenticated data
   binds each ciphertext to its conversation, message id, sender and recipient, so the server cannot move,
   replay into another chat, or forge messages.
4. **Files.** Each file is encrypted with its own AES-256-GCM key before upload. The file's name, type and key
   travel only inside the encrypted message.
5. **Verification.** Safety numbers (60 digits derived from both public keys) let two people confirm out of
   band that the server hasn't swapped keys. A changed key blocks sending until the user reviews it.

**Current limitations, to address before claiming Signal-level guarantees:**
- No forward secrecy yet (static ECDH identity keys). Next step: X3DH + Double Ratchet, or MLS for groups.
- Group names, member lists and message timing (metadata) are visible to the server.
- Forgetting your password means losing your encrypted history. There is no reset by design.

## Production deployment (e.g. `chat.thisisudaykant.com`)

WebCrypto only works in a secure context, so the app **must be served over HTTPS** (localhost is exempt).

```bash
npm ci && npm run build
# .env → NODE_ENV=production, a long random APP_SECRET, APP_ORIGIN=https://chat.thisisudaykant.com, DB creds
npm start                     # serves the built client + API + websockets on PORT
```

Behind nginx, pass WebSocket upgrades through:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 60m;   # MAX_FILE_MB plus encryption overhead
}
```

Run it under a process manager (pm2, systemd) and back up both MySQL and `storage/uploads`.

## Project layout

```
server/
  index.js              Express + Socket.IO bootstrap, security headers
  auth.js               session cookies, auth-key hashing, CSRF guard
  realtime.js           presence, typing, per-user event fan-out
  routes/               auth, users, conversations (+ messages), files
client/src/
  lib/crypto.js         all E2E cryptography
  lib/keystore.js       IndexedDB key storage, key pinning, verification state
  store.js              app state, decryption, sending, socket events
  components/           UI
  styles/               design tokens + component styles
scripts/                e2e smoke test, demo seed
```

## Roadmap

- **Voice and video calls:** WebRTC with Socket.IO signaling (the per-user event channel already exists),
  DTLS-SRTP media, plus a TURN server for restrictive networks
- Forward secrecy (Double Ratchet / MLS)
- Multi-device key management, push notifications, message edit/delete, replies and reactions
