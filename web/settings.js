import 'dotenv/config';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'settings.db');

function openDb() {
  const db = new sqlite3.Database(DB_PATH);
  return db;
}

export function ensureGuildRow(guildId) {
  return new Promise((resolve, reject) => {
    const db = openDb();
    db.serialize(() => {
      db.run(
        `INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)`,
        [String(guildId)],
        (err) => {
          if (err) { db.close(); return reject(err); }
          db.get(
            `SELECT * FROM guild_settings WHERE guild_id=?`,
            [String(guildId)],
            (err2, row) => {
              db.close();
              if (err2) return reject(err2);
              resolve(row);
            }
          );
        }
      );
    });
  });
}

export function getGuildSettings(guildId) {
  return ensureGuildRow(guildId);
}

export function updateGuildSettings(guildId, payload) {
  return new Promise((resolve, reject) => {
    const db = openDb();
    const sql = `
      UPDATE guild_settings SET
        log_channel_id=?,
        log_join=?, log_invites=?, log_nickname=?, log_roles=?,
        log_message_edit=?, log_message_delete=?,
        log_ban=?, log_kick=?, log_timeout=?
      WHERE guild_id=?
    `;
    const vals = [
      payload.log_channel_id ?? '',
      payload.log_join ? 1 : 0,
      payload.log_invites ? 1 : 0,
      payload.log_nickname ? 1 : 0,
      payload.log_roles ? 1 : 0,
      payload.log_message_edit ? 1 : 0,
      payload.log_message_delete ? 1 : 0,
      payload.log_ban ? 1 : 0,
      payload.log_kick ? 1 : 0,
      payload.log_timeout ? 1 : 0,
      String(guildId),
    ];
    db.run(sql, vals, (err) => {
      if (err) { db.close(); return reject(err); }
      db.get(`SELECT * FROM guild_settings WHERE guild_id=?`, [String(guildId)], (err2, row) => {
        db.close();
        if (err2) return reject(err2);
        resolve(row);
      });
    });
  });
}
