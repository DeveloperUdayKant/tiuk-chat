import mysql from 'mysql2/promise';
import { config } from './config.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id               CHAR(36)     NOT NULL PRIMARY KEY,
    username         VARCHAR(32)  NOT NULL,
    display_name     VARCHAR(64)  NOT NULL,
    about            VARCHAR(140) NULL,
    auth_hash        CHAR(128)    NOT NULL,
    auth_salt        CHAR(32)     NOT NULL,
    kdf_salt         VARCHAR(64)  NOT NULL,
    kdf_iterations   INT UNSIGNED NOT NULL,
    public_key       TEXT         NOT NULL,
    enc_private_key  TEXT         NOT NULL,
    private_key_iv   VARCHAR(32)  NOT NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at     DATETIME(3)  NULL,
    UNIQUE KEY uq_users_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS conversations (
    id               CHAR(36)     NOT NULL PRIMARY KEY,
    type             ENUM('direct','group') NOT NULL,
    name             VARCHAR(80)  NULL,
    direct_key       VARCHAR(80)  NULL,
    created_by       CHAR(36)     NOT NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_message_at  DATETIME(3)  NULL,
    UNIQUE KEY uq_conversations_direct (direct_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id  CHAR(36)     NOT NULL,
    user_id          CHAR(36)     NOT NULL,
    role             ENUM('admin','member') NOT NULL DEFAULT 'member',
    joined_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_read_seq    BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id),
    KEY idx_members_user (user_id),
    CONSTRAINT fk_members_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS messages (
    id               CHAR(36)     NOT NULL PRIMARY KEY,
    seq              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    conversation_id  CHAR(36)     NOT NULL,
    sender_id        CHAR(36)     NULL,
    kind             ENUM('encrypted','system') NOT NULL DEFAULT 'encrypted',
    ciphertext       MEDIUMTEXT   NULL,
    iv               VARCHAR(32)  NULL,
    meta             JSON         NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_messages_seq (seq),
    KEY idx_messages_conversation_seq (conversation_id, seq),
    CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS message_keys (
    message_id       CHAR(36)     NOT NULL,
    recipient_id     CHAR(36)     NOT NULL,
    wrapped_key      VARCHAR(128) NOT NULL,
    iv               VARCHAR(32)  NOT NULL,
    PRIMARY KEY (message_id, recipient_id),
    CONSTRAINT fk_keys_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS files (
    id               CHAR(36)     NOT NULL PRIMARY KEY,
    conversation_id  CHAR(36)     NOT NULL,
    uploader_id      CHAR(36)     NOT NULL,
    message_id       CHAR(36)     NULL,
    size             BIGINT UNSIGNED NOT NULL,
    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_files_message (message_id),
    KEY idx_files_orphans (message_id, created_at),
    CONSTRAINT fk_files_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

let pool;

export async function initDb() {
  const { database, ...conn } = config.db;
  const bootstrap = await mysql.createConnection(conn);
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (err) {
    // Shared hosting (cPanel) users usually can't create databases; the DB must already exist there.
    if (!['ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR'].includes(err.code)) throw err;
  } finally {
    await bootstrap.end();
  }

  pool = mysql.createPool({
    ...config.db,
    connectionLimit: 10,
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  for (const stmt of SCHEMA) await pool.query(stmt);
  return pool;
}

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const q = async (sql, params = []) => (await conn.query(sql, params))[0];
    const result = await fn(q);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
