import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Load .env from the app root regardless of the working directory (Passenger/cPanel may differ).
dotenv.config({ path: path.join(root, '.env') });
const env = process.env;

const isProd = env.NODE_ENV === 'production';
// Sub-path the app is hosted under, e.g. "/chat" for https://thisisudaykant.com/chat ('' = domain root)
const basePath = (env.BASE_PATH || '').trim().replace(/\/+$/, '').replace(/^(?=[^/])/, '/');

if (isProd && (!env.APP_SECRET || env.APP_SECRET.length < 32 || env.APP_SECRET.startsWith('change-me'))) {
  throw new Error('APP_SECRET must be set to a long random value in production.');
}

export const config = {
  root,
  isProd,
  basePath,
  port: Number(env.PORT || 4000),
  origin: env.APP_ORIGIN || 'http://localhost:5173',
  secret: env.APP_SECRET || 'dev-only-insecure-secret-change-me-please-0000',
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'tiuk_chat',
  },
  uploadDir: path.resolve(root, env.UPLOAD_DIR || 'storage/uploads'),
  maxFileBytes: Number(env.MAX_FILE_MB || 50) * 1024 * 1024,
  maxFilesPerMessage: Number(env.MAX_FILES_PER_MESSAGE || 10),
  // Client-side PBKDF2 work factor for deriving the auth + vault keys from the password
  kdfIterations: 600_000,
  sessionCookie: 'tiuk_session',
  sessionDays: 30,
};
