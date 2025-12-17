import 'dotenv/config';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'settings.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT DEFAULT '',
      log_join INTEGER DEFAULT 1,
      log_invites INTEGER DEFAULT 1,
      log_nickname INTEGER DEFAULT 1,
      log_roles INTEGER DEFAULT 1,
      log_message_edit INTEGER DEFAULT 1,
      log_message_delete INTEGER DEFAULT 1,
      log_ban INTEGER DEFAULT 1,
      log_kick INTEGER DEFAULT 1,
      log_timeout INTEGER DEFAULT 1
    )
  `);
});

db.close(() => {
  console.log('✅ DB ready at:', DB_PATH);
});
