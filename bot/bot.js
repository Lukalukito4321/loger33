import 'dotenv/config';
import fetch from 'node-fetch';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  AuditLogEvent,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = (process.env.DISCORD_TOKEN || '').trim();
if (!TOKEN) throw new Error('DISCORD_TOKEN missing in env');

const DEFAULT_LOG_CHANNEL_ID = (process.env.LOG_CHANNEL_ID || '').trim(); // optional fallback
const GUILD_ID = (process.env.GUILD_ID || '').trim();
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:5000/';

// ===== Settings source (sqlite by default; HTTP recommended on Railway with 2 services) =====
const USE_HTTP_SETTINGS = process.env.USE_HTTP_SETTINGS === '1';
const SETTINGS_API_BASE = (process.env.SETTINGS_API_BASE || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const BOT_API_KEY = (process.env.BOT_API_KEY || '').trim();

const SETTINGS_CACHE_MS = Number(process.env.SETTINGS_CACHE_MS || 5000);
const settingsCache = new Map(); // guildId -> {ts, data}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'web', 'settings.db');

function openDb() {
  return new sqlite3.Database(DB_PATH);
}

function ensureGuildRow(guildId) {
  return new Promise((resolve) => {
    const db = openDb();
    db.serialize(() => {
      db.run(`INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)`, [String(guildId)], () => {
        db.get(`SELECT * FROM guild_settings WHERE guild_id=?`, [String(guildId)], (err, row) => {
          db.close();
          if (err || !row) return resolve(null);
          resolve(row);
        });
      });
    });
  });
}

async function getSettings(guildId) {
  const gid = String(guildId);

  // cache
  const cached = settingsCache.get(gid);
  if (cached && (Date.now() - cached.ts) < SETTINGS_CACHE_MS) return cached.data;

  let data = null;

  if (USE_HTTP_SETTINGS) {
    if (!BOT_API_KEY) return null;
    const r = await fetch(`${SETTINGS_API_BASE}/api/settings/${encodeURIComponent(gid)}`, {
      headers: { 'X-API-KEY': BOT_API_KEY }
    }).catch(() => null);
    if (!r || r.status !== 200) return null;
    data = await r.json().catch(() => null);
  } else {
    data = await ensureGuildRow(gid);
  }

  if (data) settingsCache.set(gid, { ts: Date.now(), data });
  return data;
}

// ===== helpers =====
function isEnabled(v, def = 1) {
  if (v === undefined || v === null || v === '') return def === 1;
  return Number(v) === 1;
}

function cleanId(v) {
  const s = String(v ?? '').trim();
  return /^\d{17,20}$/.test(s) ? s : '';
}

async function resolveLogChannel(guild, settings) {
  const fromSettings = cleanId(settings?.log_channel_id);
  const fallback = cleanId(DEFAULT_LOG_CHANNEL_ID);
  const id = fromSettings || fallback;
  if (!id) return null;

  // cache first, then fetch
  return (
    guild.channels.cache.get(id) ||
    (await guild.channels.fetch(id).catch(() => null))
  );
}

async function sendLog(guild, settings, title, description) {
  const ch = await resolveLogChannel(guild, settings);
  if (!ch || !ch.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x5865F2)
    .setTimestamp(new Date());

  await ch.send({ embeds: [embed] }).catch(() => {});
}

async function findAuditActor(guild, auditEvent, targetId, secondsWindow = 25) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditEvent, limit: 10 });
    const now = Date.now();
    for (const entry of logs.entries.values()) {
      const tid = entry?.target?.id;
      if (String(tid) !== String(targetId)) continue;
      const created = entry.createdTimestamp || 0;
      if ((now - created) / 1000 <= secondsWindow) return entry;
    }
  } catch {}
  return null;
}

// Invite cache: Map<guildId, Map<code, uses>>
const inviteCache = new Map();
async function refreshInvitesForGuild(guild) {
  try {
    const invites = await guild.invites.fetch();
    inviteCache.set(guild.id, new Map(invites.map(i => [i.code, i.uses ?? 0])));
  } catch {
    inviteCache.set(guild.id, new Map());
  }
}

async function detectUsedInviteOrVanity(guild) {
  const before = inviteCache.get(guild.id) || new Map();
  try {
    const invites = await guild.invites.fetch();
    const after = new Map(invites.map(i => [i.code, i.uses ?? 0]));

    let usedInvite = null;
    for (const [code, usesAfter] of after.entries()) {
      const usesBefore = before.get(code) ?? 0;
      if (usesAfter > usesBefore) {
        usedInvite = invites.find(i => i.code === code) || null;
        break;
      }
    }

    inviteCache.set(guild.id, after);

    if (usedInvite) {
      const inviter = usedInvite.inviter ? `${usedInvite.inviter.tag} (\`${usedInvite.inviter.id}\`)` : 'Unknown inviter';
      return `**Invite:** \`${usedInvite.code}\`\n**Inviter:** ${inviter}\n**Uses:** ${usedInvite.uses ?? 0}`;
    }

    // Try vanity
    try {
      const vanity = await guild.fetchVanityData();
      if (vanity?.code) return `**Vanity:** \`${vanity.code}\``;
    } catch {}

    return '**Invite:** Unknown';
  } catch {
    return '**Invite:** Unknown (missing permissions to read invites)';
  }
}

// ===== Discord client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// ===== Slash command: /dashboard (optional) =====
async function syncSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const cmd = new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Open dashboard');

  const body = [cmd.toJSON()];

  if (GUILD_ID && /^\d+$/.test(GUILD_ID)) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body });
    console.log(`✅ Synced slash commands to guild ${GUILD_ID}`);
  } else {
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log('✅ Synced global slash commands');
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'dashboard') return;
  await interaction.reply({ content: DASHBOARD_URL, ephemeral: true }).catch(() => {});
});

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag} (id: ${client.user.id})`);

  // cache invites for all guilds
  for (const g of client.guilds.cache.values()) await refreshInvitesForGuild(g);

  await syncSlashCommands().catch((e) => console.log('Slash sync error:', e?.message || e));
});

client.on('guildCreate', async (guild) => {
  await refreshInvitesForGuild(guild);
  await ensureGuildRow(guild.id);
});

client.on('inviteCreate', async (invite) => {
  if (invite.guild) await refreshInvitesForGuild(invite.guild);
});
client.on('inviteDelete', async (invite) => {
  if (invite.guild) await refreshInvitesForGuild(invite.guild);
});

// ===== Events =====
client.on('guildMemberAdd', async (member) => {
  const settings = await getSettings(member.guild.id);
  if (!settings) return;
  if (!isEnabled(settings.log_join, 1)) return;

  let inviteInfo = '';
  if (isEnabled(settings.log_invites, 1)) inviteInfo = await detectUsedInviteOrVanity(member.guild);

  const createdAt = member.user.createdAt ? `<t:${Math.floor(member.user.createdAt.getTime() / 1000)}:F>` : 'Unknown';
  await sendLog(
    member.guild,
    settings,
    '✅ Member Joined',
    `**User:** ${member.user.tag} (\`${member.id}\`)\n**Account created:** ${createdAt}\n\n${inviteInfo}`
  );
});

client.on('guildMemberRemove', async (member) => {
  const settings = await getSettings(member.guild.id);
  if (!settings) return;

  // Kick (audit log)
  if (isEnabled(settings.log_kick, 1)) {
    const entry = await findAuditActor(member.guild, AuditLogEvent.MemberKick, member.id, 20);
    if (entry) {
      const mod = entry.executor ? `${entry.executor.tag} (\`${entry.executor.id}\`)` : 'Unknown';
      const reason = entry.reason || 'No reason';
      return sendLog(
        member.guild,
        settings,
        '👢 Member Kicked',
        `**User:** ${member.user.tag} (\`${member.id}\`)\n**By:** ${mod}\n**Reason:** ${reason}`
      );
    }
  }

  if (!isEnabled(settings.log_join, 1)) return;

  await sendLog(
    member.guild,
    settings,
    '❌ Member Left',
    `**User:** ${member.user.tag} (\`${member.id}\`)`
  );
});

client.on('guildBanAdd', async (ban) => {
  const guild = ban.guild;
  const user = ban.user;

  const settings = await getSettings(guild.id);
  if (!settings) return;
  if (!isEnabled(settings.log_ban, 1)) return;

  const entry = await findAuditActor(guild, AuditLogEvent.MemberBanAdd, user.id, 25);
  const mod = entry?.executor ? `${entry.executor.tag} (\`${entry.executor.id}\`)` : 'Unknown';
  const reason = entry?.reason || 'No reason';

  await sendLog(
    guild,
    settings,
    '⛔ Member Banned',
    `**User:** ${user.tag} (\`${user.id}\`)\n**By:** ${mod}\n**Reason:** ${reason}`
  );
});

client.on('guildMemberUpdate', async (before, after) => {
  const settings = await getSettings(after.guild.id);
  if (!settings) return;

  // Roles
  if (isEnabled(settings.log_roles, 1)) {
    const beforeRoles = new Set(before.roles.cache.keys());
    const afterRoles = new Set(after.roles.cache.keys());

    const addedIds = [...afterRoles].filter(id => !beforeRoles.has(id));
    const removedIds = [...beforeRoles].filter(id => !afterRoles.has(id));

    const added = addedIds
      .map(id => after.roles.cache.get(id))
      .filter(r => r && r.name !== '@everyone');
    const removed = removedIds
      .map(id => before.roles.cache.get(id))
      .filter(r => r && r.name !== '@everyone');

    if (added.length || removed.length) {
      const entry = await findAuditActor(after.guild, AuditLogEvent.MemberRoleUpdate, after.id, 25);
      const mod = entry?.executor ? `${entry.executor.tag} (\`${entry.executor.id}\`)` : 'Unknown';

      const addedTxt = added.length ? added.map(r => r.toString()).join(', ') : 'None';
      const removedTxt = removed.length ? removed.map(r => r.toString()).join(', ') : 'None';

      await sendLog(
        after.guild,
        settings,
        '🎭 Roles Updated',
        `**User:** ${after.user.tag} (\`${after.id}\`)\n**By:** ${mod}\n**Added:** ${addedTxt}\n**Removed:** ${removedTxt}`
      );
    }
  }

  // Nickname
  if (isEnabled(settings.log_nickname, 1) && before.nickname !== after.nickname) {
    const entry = await findAuditActor(after.guild, AuditLogEvent.MemberUpdate, after.id, 25);
    const mod = entry?.executor ? `${entry.executor.tag} (\`${entry.executor.id}\`)` : 'Unknown';

    const oldNick = before.nickname ?? before.user.username;
    const newNick = after.nickname ?? after.user.username;

    await sendLog(
      after.guild,
      settings,
      '📝 Nickname Changed',
      `**User:** ${after.user.tag} (\`${after.id}\`)\n**By:** ${mod}\n**Before:** ${oldNick}\n**After:** ${newNick}`
    );
  }

  // Timeout
  if (isEnabled(settings.log_timeout, 1) && before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp) {
    const entry = await findAuditActor(after.guild, AuditLogEvent.MemberUpdate, after.id, 25);
    const mod = entry?.executor ? `${entry.executor.tag} (\`${entry.executor.id}\`)` : 'Unknown';

    if (after.communicationDisabledUntilTimestamp) {
      const until = `<t:${Math.floor(after.communicationDisabledUntilTimestamp / 1000)}:F>`;
      await sendLog(
        after.guild,
        settings,
        '⏳ Timeout Applied/Updated',
        `**User:** ${after.user.tag} (\`${after.id}\`)\n**By:** ${mod}\n**Until:** ${until}`
      );
    } else {
      await sendLog(
        after.guild,
        settings,
        '✅ Timeout Removed',
        `**User:** ${after.user.tag} (\`${after.id}\`)\n**By:** ${mod}`
      );
    }
  }
});

client.on('messageDelete', async (message) => {
  if (!message.guild) return;
  if (message.author?.bot) return;

  const settings = await getSettings(message.guild.id);
  if (!settings) return;
  if (!isEnabled(settings.log_message_delete, 1)) return;

  const author = message.author ? `${message.author.tag} (\`${message.author.id}\`)` : 'Unknown';
  const channel = message.channel ? `${message.channel.toString()}` : 'Unknown';
  const content = String(message.content || '*no text*').slice(0, 1500);

  await sendLog(
    message.guild,
    settings,
    '🗑️ Message Deleted',
    `**Author:** ${author}\n**Channel:** ${channel}\n**Content:**\n${content}`
  );
});

client.on('messageUpdate', async (before, after) => {
  if (!after.guild) return;
  if (after.author?.bot) return;
  if (before.content === after.content) return;

  const settings = await getSettings(after.guild.id);
  if (!settings) return;
  if (!isEnabled(settings.log_message_edit, 1)) return;

  const beforeTxt = String(before.content || '*no text*').slice(0, 900);
  const afterTxt = String(after.content || '*no text*').slice(0, 900);

  await sendLog(
    after.guild,
    settings,
    '✏️ Message Edited',
    `**Author:** ${after.author.tag} (\`${after.author.id}\`)\n**Channel:** ${after.channel.toString()}\n\n**Before:**\n${beforeTxt}\n\n**After:**\n${afterTxt}`
  );
});

client.login(TOKEN);
