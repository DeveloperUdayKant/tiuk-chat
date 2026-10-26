import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Load .env from the app root regardless of the working directory (Passenger/cPanel may differ).
dotenv.config({ path: path.join(root, '.env') });
const env = process.env;

// `npm start` passes --production so hosts that don't set NODE_ENV still run in production mode.
const isProd = env.NODE_ENV === 'production' || process.argv.includes('--production');
// Sub-path the app is hosted under, e.g. "/chat" for https://thisisudaykant.com/chat ('' = domain root)
const basePath = (env.BASE_PATH || '').trim().replace(/\/+$/, '').replace(/^(?=[^/])/, '/');

if (isProd && (!env.APP_SECRET || env.APP_SECRET.length < 32 || env.APP_SECRET.startsWith('change-me'))) {
  throw new Error('APP_SECRET must be set to a long random value in production.');
}

const first = (...names) => names.map((n) => env[n]).find((v) => v !== undefined && v !== '');

/**
 * Database settings. Managed hosts name these differently, so accept a connection URL
 * (DATABASE_URL / MYSQL_URL) or the common DB_* / MYSQL_* / MYSQL* variable families.
 */
function dbConfig() {
  const url = first('DATABASE_URL', 'MYSQL_URL', 'DB_URL');
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    };
  }
  return {
    host: first('DB_HOST', 'MYSQL_HOST', 'MYSQLHOST', 'DATABASE_HOST') || '127.0.0.1',
    port: Number(first('DB_PORT', 'MYSQL_PORT', 'MYSQLPORT', 'DATABASE_PORT') || 3306),
    user: first('DB_USER', 'DB_USERNAME', 'MYSQL_USER', 'MYSQLUSER', 'DATABASE_USER', 'DATABASE_USERNAME') || 'root',
    password: first('DB_PASSWORD', 'DB_PASS', 'MYSQL_PASSWORD', 'MYSQLPASSWORD', 'DATABASE_PASSWORD') || '',
    database: first('DB_NAME', 'DB_DATABASE', 'MYSQL_DATABASE', 'MYSQLDATABASE', 'DATABASE_NAME') || 'tiuk_chat',
  };
}

export const config = {
  root,
  isProd,
  basePath,
  port: Number(env.PORT || 4000),
  origin: env.APP_ORIGIN || 'http://localhost:5173',
  secret: env.APP_SECRET || 'dev-only-insecure-secret-change-me-please-0000',
  db: dbConfig(),
  uploadDir: path.resolve(root, env.UPLOAD_DIR || 'storage/uploads'),
  maxFileBytes: Number(env.MAX_FILE_MB || 50) * 1024 * 1024,
  maxFilesPerMessage: Number(env.MAX_FILES_PER_MESSAGE || 10),
  // Client-side PBKDF2 work factor for deriving the auth + vault keys from the password
  kdfIterations: 600_000,
  sessionCookie: 'tiuk_session',
  sessionDays: 30,
};
