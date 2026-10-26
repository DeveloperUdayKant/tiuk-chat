import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Router } from 'express';
import { config } from '../config.js';
import { query, one } from '../db.js';
import { asyncRoute, assert, is, HttpError } from '../lib/http.js';

const router = Router();
// AES-GCM adds a 16-byte tag; leave a little headroom over the plaintext limit.
const MAX_BLOB = config.maxFileBytes + 1024;

const blobPath = (id) => path.join(config.uploadDir, id.slice(0, 2), id);

/**
 * Upload one already-encrypted blob. The body is opaque ciphertext; the file
 * name, type and key live inside the encrypted message, never on the server.
 */
router.post('/', asyncRoute(async (req, res) => {
  const conversationId = req.query.conversationId;
  assert(is.uuid(conversationId), 'invalid_request');
  assert(req.is('application/octet-stream'), 'invalid_request', 'Expected an encrypted blob.');
  const declared = Number(req.get('content-length'));
  if (declared > MAX_BLOB) {
    throw new HttpError(413, 'too_large', `Files are limited to ${Math.round(config.maxFileBytes / 1048576)} MB.`);
  }

  const member = await one(
    `SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`,
    [conversationId, req.user.id]
  );
  if (!member) throw new HttpError(404, 'not_found', 'Conversation not found.');

  const id = crypto.randomUUID();
  const dest = blobPath(id);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });

  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_BLOB) return cb(new HttpError(413, 'too_large', 'File is too large.'));
      cb(null, chunk);
    },
  });

  try {
    await pipeline(req, limiter, fs.createWriteStream(dest, { flags: 'wx' }));
  } catch (err) {
    await fs.promises.rm(dest, { force: true });
    throw err instanceof HttpError ? err : new HttpError(400, 'upload_failed', 'Upload failed.');
  }
  assert(size > 0, 'invalid_request', 'Empty upload.');

  await query(`INSERT INTO files (id, conversation_id, uploader_id, size) VALUES (?, ?, ?, ?)`,
    [id, conversationId, req.user.id, size]);
  res.status(201).json({ id, size });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  assert(is.uuid(req.params.id));
  const file = await one(
    `SELECT f.id, f.size, f.message_id, f.uploader_id
       FROM files f
       JOIN conversation_members m ON m.conversation_id = f.conversation_id AND m.user_id = ?
      WHERE f.id = ?`,
    [req.user.id, req.params.id]
  );
  if (!file || (!file.message_id && file.uploader_id !== req.user.id)) {
    throw new HttpError(404, 'not_found', 'File not found.');
  }
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(file.size),
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(blobPath(file.id))
    .on('error', () => res.destroy())
    .pipe(res);
}));

/** Remove uploads that were never attached to a sent message. */
export async function sweepOrphanFiles() {
  const rows = await query(
    `SELECT id FROM files WHERE message_id IS NULL AND created_at < (CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY) LIMIT 500`
  );
  for (const { id } of rows) {
    await fs.promises.rm(blobPath(id), { force: true });
    await query(`DELETE FROM files WHERE id = ?`, [id]);
  }
}

export default router;
