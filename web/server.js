import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureGuildRow, getGuildSettings, updateGuildSettings } from './settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const SESSION_SECRET = process.env.FLASK_SECRET_KEY || 'dev';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || ''; // MUST be full URL to /callback in this version
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const BOT_API_KEY = process.env.BOT_API_KEY || '';

const DISCORD_API = 'https://discord.com/api';
const OAUTH_SCOPE = 'identify guilds';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));

function page(title, body, loggedIn=false) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>

  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">

  <style>
    :root{
      --bg0:#070A12;
      --bg1:#0b1220;
      --stroke: rgba(255,255,255,.10);
      --text:#e9eefc;
      --muted: rgba(233,238,252,.70);
      --brand:#5B8CFF;
      --brand2:#2b6cff;
      --shadow: 0 20px 60px rgba(0,0,0,.45);
    }

    body{
      min-height:100vh;
      color: var(--text);
      background:
        radial-gradient(1000px 700px at 15% 10%, rgba(91,140,255,.28), transparent 60%),
        radial-gradient(900px 600px at 85% 0%, rgba(34,197,94,.18), transparent 55%),
        radial-gradient(800px 600px at 50% 95%, rgba(245,158,11,.12), transparent 55%),
        linear-gradient(180deg, var(--bg0), var(--bg1));
    }

    .app-shell{
      max-width: 1100px;
      margin: 0 auto;
      padding: 28px 14px 48px;
    }

    .topbar{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap: 12px;
      margin-bottom: 18px;
    }

    .brand{
      display:flex;
      align-items:center;
      gap: 12px;
    }
    .brand .logo{
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(91,140,255,.95), rgba(34,197,94,.65));
      box-shadow: 0 10px 30px rgba(91,140,255,.25);
      display:flex;
      align-items:center;
      justify-content:center;
      border: 1px solid rgba(255,255,255,.12);
    }
    .brand .logo i{ font-size: 20px; color: rgba(255,255,255,.95); }

    .brand h1{
      font-size: 18px;
      margin: 0;
      letter-spacing: .2px;
      font-weight: 700;
      line-height: 1.1;
    }
    .brand .subtitle{
      font-size: 13px;
      color: var(--muted);
      margin-top: 2px;
    }

    .pill{
      display:inline-flex;
      align-items:center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,.06);
      border: 1px solid var(--stroke);
      backdrop-filter: blur(10px);
    }

    .card{
      background: rgba(16,27,51,.72);
      border: 1px solid var(--stroke);
      border-radius: 18px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }

    .card-header-soft{
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.03);
      border-top-left-radius: 18px;
      border-top-right-radius: 18px;
    }

    .muted{ color: var(--muted); }

    a{ color: #9bbcff; text-decoration: none; }
    a:hover{ text-decoration: underline; }

    .btn-primary{
      background: linear-gradient(135deg, var(--brand), var(--brand2));
      border: none;
      box-shadow: 0 10px 24px rgba(91,140,255,.22);
    }
    .btn-primary:hover{ filter: brightness(1.05); }

    .btn-outline-light{
      border-color: rgba(255,255,255,.18);
      color: rgba(255,255,255,.92);
    }
    .btn-outline-light:hover{
      background: rgba(255,255,255,.08);
      border-color: rgba(255,255,255,.28);
    }

    .list-group-item{
      background: transparent;
      color: var(--text);
      border-color: rgba(255,255,255,.10);
      padding: 14px 14px;
      border-radius: 14px !important;
      margin-bottom: 10px;
      transition: transform .08s ease, background .12s ease, border-color .12s ease;
    }
    .list-group-item:hover{
      background: rgba(255,255,255,.04);
      border-color: rgba(91,140,255,.28);
      transform: translateY(-1px);
      text-decoration: none;
    }

    .badge-soft{
      background: rgba(91,140,255,.14);
      color: #bcd0ff;
      border: 1px solid rgba(91,140,255,.28);
      border-radius: 999px;
      padding: 6px 10px;
      font-weight: 600;
      letter-spacing: .2px;
    }

    input.form-control, select.form-select{
      background: rgba(15,26,51,.90);
      border: 1px solid rgba(255,255,255,.14);
      color: var(--text);
      border-radius: 14px;
    }
    input.form-control:focus, select.form-select:focus{
      box-shadow: 0 0 0 .2rem rgba(91,140,255,.18);
      border-color: rgba(91,140,255,.55);
    }

    .form-check-input{
      background-color: rgba(15,26,51,.90);
      border-color: rgba(255,255,255,.22);
    }
    .form-switch .form-check-input{
      width: 44px;
      height: 22px;
      border-radius: 999px;
    }
    .form-switch .form-check-input:checked{
      background-color: rgba(91,140,255,.85);
      border-color: rgba(91,140,255,.85);
    }

    .divider{
      height:1px;
      background: rgba(255,255,255,.10);
      margin: 14px 0;
    }

    .hint{
      font-size: 12px;
      color: rgba(233,238,252,.65);
    }

    .kbd{
      padding: 2px 7px;
      border-radius: 8px;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.12);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      color: rgba(233,238,252,.85);
    }

    .toastish{
      display:none;
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 9999;
      min-width: 220px;
      max-width: 320px;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(16,27,51,.92);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 18px 50px rgba(0,0,0,.55);
      backdrop-filter: blur(12px);
    }
    .toastish.show{ display:block; }
  </style>
</head>
<body>
  <div class="app-shell">
    <div class="topbar">
      <div class="brand">
        <div class="logo"><i class="bi bi-shield-lock-fill"></i></div>
        <div>
          <h1>Logger Dashboard</h1>
          <div class="subtitle">Pick where logs go and what to log.</div>
        </div>
      </div>

      <div class="d-flex align-items-center gap-2">
        ${loggedIn ? `
          <span class="pill"><i class="bi bi-check-circle-fill" style="color:rgba(34,197,94,.95)"></i><span class="small">Signed in</span></span>
          <a class="btn btn-outline-light btn-sm" href="/logout"><i class="bi bi-box-arrow-right me-1"></i>Logout</a>
        ` : `
          <span class="pill"><i class="bi bi-person-circle"></i><span class="small">Guest</span></span>
        `}
      </div>
    </div>

    ${body}

    <div id="toastish" class="toastish">
      <div class="d-flex align-items-start gap-2">
        <i id="toastIcon" class="bi bi-info-circle"></i>
        <div>
          <div id="toastTitle" style="font-weight:700">Info</div>
          <div id="toastMsg" class="hint">—</div>
        </div>
      </div>
    </div>

    <script>
      window.toast = function(title, msg, kind){
        const el = document.getElementById('toastish');
        const t = document.getElementById('toastTitle');
        const m = document.getElementById('toastMsg');
        const i = document.getElementById('toastIcon');
        if(!el) return;
        t.textContent = title || 'Info';
        m.textContent = msg || '';
        i.className = 'bi ' + (kind === 'ok' ? 'bi-check-circle' : (kind === 'bad' ? 'bi-x-circle' : 'bi-info-circle'));
        el.classList.add('show');
        clearTimeout(window.__toastT);
        window.__toastT = setTimeout(()=>el.classList.remove('show'), 2200);
      };
    </script>
  </div>
</body>
</html>`;
}


async function discordGet(token, path) {
  const r = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  let data;
  try { data = await r.json(); } catch { data = { error: 'bad_json' }; }
  return { data, status: r.status };
}

function manageableGuilds(guilds) {
  const manageable = [];
  const others = [];
  for (const g of guilds) {
    const perms = Number(g?.permissions ?? 0);
    if (perms & 0x20) manageable.push(g); // Manage Server
    else others.push(g);
  }
  return { manageable, others };
}

app.get('/', (req, res) => {
  const body = `
  <div class="card overflow-hidden">
    <div class="card-header-soft p-4">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div>
          <h4 class="mb-1">Welcome 👋</h4>
          <div class="muted">Connect Discord to manage where your server logs go.</div>
        </div>
        <span class="pill"><i class="bi bi-stars"></i><span class="small">Fast setup</span></span>
      </div>
    </div>
    <div class="p-4">
      <div class="row g-3 align-items-center">
        <div class="col-lg-8">
          <div class="muted mb-2">You’ll be able to:</div>
          <ul class="muted mb-0">
            <li>Choose a log channel per server</li>
            <li>Toggle what events you want logged</li>
            <li>Load channels from your server to avoid copy/paste</li>
          </ul>
          <div class="divider"></div>
          <div class="hint">Tip: If OAuth fails, double-check <span class="kbd"></div>
        </div>
        <div class="col-lg-4 text-lg-end">
          <a class="btn btn-primary w-100" href="/login"><i class="bi bi-discord me-1"></i>Login with Discord</a>
        </div>
      </div>
    </div>
  </div>`;
  res.send(page('Logger Dashboard', body, Boolean(req.session.access_token)));
});

app.get('/login', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return res.send(page('Config error', `<div class='alert alert-danger'>Missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI</div>`));
  }
  const url = `${DISCORD_API}/oauth2/authorize`
    + `?client_id=${encodeURIComponent(CLIENT_ID)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&response_type=code`
    + `&scope=${encodeURIComponent(OAUTH_SCOPE)}`;
  res.redirect(url);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send(page('OAuth error', `<div class='alert alert-danger'>No code returned from Discord.</div>`));

  const tokenResp = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: REDIRECT_URI,
      scope: OAUTH_SCOPE
    })
  });

  const token = await tokenResp.json().catch(() => ({}));
  if (!token?.access_token) {
    return res.send(page('OAuth failed', `<div class='alert alert-danger'>OAuth failed: <pre>${escapeHtml(JSON.stringify(token, null, 2))}</pre></div>`));
  }

  req.session.access_token = token.access_token;
  res.redirect('/guilds');
});

app.get('/guilds', async (req, res) => {
  if (!req.session.access_token) return res.redirect('/login');

  const { data, status } = await discordGet(req.session.access_token, '/users/@me/guilds');
  if (status !== 200 || !Array.isArray(data)) {
    return res.status(500).send(`<h3>Failed to load guilds</h3><pre>Discord API error ${status}: ${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
  }

  const { manageable, others } = manageableGuilds(data);

  const clientId = process.env.BOT_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
  if (!clientId) return res.status(500).send('<h3>Missing BOT_CLIENT_ID (Application ID) in .env</h3>');

  const perms = process.env.BOT_PERMISSIONS || '8';
  const addBotUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot%20applications.commands&permissions=${encodeURIComponent(perms)}`;

  let manageableHtml = '';
  for (const g of manageable) {


const gid = String(g.id);
    const name = escapeHtml(g.name || 'Unknown');
    manageableHtml += `
      <a class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
         href="/dashboard/${gid}">
        <span>${name}</span>
        <span class="badge badge-soft">Configure</span>
      </a>`;
  }
  if (!manageableHtml) {
    manageableHtml = `<div class="text-muted">No manageable servers found. You need <b>Manage Server</b> permission.</div>`;
  }

  let othersHtml = '';
  for (const g of others) othersHtml += `<li>${escapeHtml(g.name || 'Unknown')}</li>`;
  if (!othersHtml) othersHtml = '<li>None</li>';

  const body = `
  <div class="row g-3">
    <div class="col-lg-8">
      <div class="card p-4">
        <div class="d-flex align-items-center justify-content-between">
          <h5 class="mb-0"><i class="bi bi-gear-fill me-2"></i>Servers you can manage</h5>
          <a class="btn btn-sm btn-primary" href="${addBotUrl}" target="_blank"><i class="bi bi-plus-circle me-1"></i>Add bot</a>
        </div>
        <div class="muted mt-1">Only servers where you have <span class="badge badge-soft">Manage Server</span> can be configured.</div>
        <hr class="border-secondary"/>
        <div class="list-group list-group-flush">${manageableHtml}</div>
      </div>
    </div>
    <div class="col-lg-4">
      <div class="card p-4">
        <h6 class="mb-2">Other servers</h6>
        <div class="muted mb-2">You're in these servers, but you can't configure them.</div>
        <ul class="mb-0 muted">${othersHtml}</ul>
      </div>
    </div>
  </div>`;
  res.send(page('Guilds', body, true));
});

app.get('/dashboard/:guildId/channels', async (req, res) => {
  if (!req.session.access_token) return res.sendStatus(401);

  // Verify user can manage this guild
  const { data, status } = await discordGet(req.session.access_token, '/users/@me/guilds');
  if (status !== 200 || !Array.isArray(data)) return res.json([]);

  const { manageable } = manageableGuilds(data);
  const allowed = new Set(manageable.map(g => String(g.id)));
  if (!allowed.has(String(req.params.guildId))) return res.sendStatus(403);

  if (!DISCORD_BOT_TOKEN) return res.json([]);

  const r = await fetch(`${DISCORD_API}/guilds/${encodeURIComponent(req.params.guildId)}/channels`, {
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
  });
  if (r.status !== 200) return res.json([]);

  const chans = await r.json().catch(() => []);
  const text = Array.isArray(chans) ? chans
    .filter(c => c?.type === 0)
    .map(c => ({ id: String(c.id), name: String(c.name) }))
    .sort((a,b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    : [];
  res.json(text);
});

app.all('/dashboard/:guildId', async (req, res) => {
  if (!req.session.access_token) return res.redirect('/login');
  const guildId = String(req.params.guildId);

  // ensure row exists
  const row = await ensureGuildRow(guildId);

  if (req.method === 'POST') {
    const b = (name) => (req.body?.[name] === 'on');
    const updated = await updateGuildSettings(guildId, {
      log_channel_id: req.body?.log_channel_id || '',
      log_join: b('log_join'),
      log_invites: b('log_invites'),
      log_nickname: b('log_nickname'),
      log_roles: b('log_roles'),
      log_message_edit: b('log_message_edit'),
      log_message_delete: b('log_message_delete'),
      log_ban: b('log_ban'),
      log_kick: b('log_kick'),
      log_timeout: b('log_timeout'),
    });

    return res.redirect(`/dashboard/${encodeURIComponent(guildId)}?saved=1`);
  }

  const current = await getGuildSettings(guildId);

  const body = `
  <div class="card p-4">
    <div class="d-flex align-items-center justify-content-between">
      <h5 class="mb-0">Logger settings</h5>
      <a class="btn btn-sm btn-outline-light" href="/guilds">← Back</a>
    </div>
    <div class="muted mt-1">Tip: paste channel ID or pick from dropdown.</div>
    <hr class="border-secondary"/>

    <form method="post">
      <div class="mb-3">
        <label class="form-label">Log channel ID</label>
        <input class="form-control" name="log_channel_id" value="${escapeHtml(current.log_channel_id || '')}" />
        <div class="muted mt-2">
          <button type="button" class="btn btn-sm btn-outline-light" id="loadCh">Load channels</button>
          <select class="form-select form-select-sm mt-2" id="chSelect">
            <option value="">--  --</option>
          </select>
        </div>
      </div>

      ${check('log_join', 'Member Join / Leave', current.log_join)}
      ${check('log_invites', 'Invite / Vanity info (join)', current.log_invites)}
      ${check('log_nickname', 'Nickname changes', current.log_nickname)}
      ${check('log_roles', 'Role changes', current.log_roles)}
      ${check('log_message_delete', 'Message delete', current.log_message_delete)}
      ${check('log_message_edit', 'Message edit', current.log_message_edit)}
      ${check('log_ban', 'Ban', current.log_ban)}
      ${check('log_kick', 'Kick', current.log_kick)}
      ${check('log_timeout', 'Timeout', current.log_timeout)}

      <div class="mt-3">
        <button class="btn btn-primary">Save settings</button>
      </div>
    </form>
  </div>

<script>
const gid = ${JSON.stringify(guildId)};
const loadBtn = document.getElementById('loadCh');
const sel = document.getElementById('chSelect');
const input = document.querySelector('input[name="log_channel_id"]');

loadBtn?.addEventListener('click', async () => {
  loadBtn.disabled = true;
  loadBtn.textContent = 'Loading...';
  try {
    const r = await fetch('/dashboard/' + encodeURIComponent(gid) + '/channels');
    const chans = await r.json();
    sel.innerHTML = '<option value="">-- pick a text channel --</option>';
    for (const c of chans) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = '#' + c.name + ' (' + c.id + ')';
      sel.appendChild(opt);
    }
  } catch (e) {}
  loadBtn.disabled = false;
  loadBtn.textContent = 'Load channels';
});

sel?.addEventListener('change', () => {
  if (sel.value) input.value = sel.value;
});
</script>
  `;

  res.send(page('Dashboard', body, true));
});

// API endpoint for bot (same shape as Python /api/settings/<guild_id>)
app.get('/api/settings/:guildId', async (req, res) => {
  if (req.get('X-API-KEY') !== BOT_API_KEY) return res.sendStatus(401);

  try {
    const row = await getGuildSettings(String(req.params.guildId));
    if (!row) return res.status(404).json({ guild_id: String(req.params.guildId) });
    res.json(row);
  } catch {
    res.status(500).json({ error: 'db_error' });
  }
});

function check(name, label, checked) {
  return `
  <div class="form-check form-switch my-2">
    <input class="form-check-input" type="checkbox" role="switch" name="${name}" id="${name}" ${checked ? 'checked' : ''}>
    <label class="form-check-label" for="${name}">${label}</label>
  </div>`;
}


function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

const port = Number(process.env.PORT || 5000);
app.listen(port, '0.0.0.0', () => console.log('✅ Dashboard running on', port));
