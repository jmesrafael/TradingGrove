// TradingGrove local admin server.
// SECURITY MODEL: this folder is never deployed (build.js copies only src/).
// The Supabase service-role key lives in admin/.env (gitignored) and this
// server binds to 127.0.0.1 only. The username/password gate is a local
// convenience on top of that, not the primary defense.
//
// Run: node admin/server.js   (or: npm run admin  from the repo root)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── .env ─────────────────────────────────────────────────────
const ENV = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) ENV[m[1]] = m[2];
  }
} catch (e) {
  console.warn('[admin] No admin/.env found. Copy admin/.env.example to admin/.env and fill it in.');
}
// process.env overrides the file, so `MOCK=1 node admin/server.js` works
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_USER', 'ADMIN_PASS', 'PORT', 'MOCK', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
  if (process.env[k] !== undefined) ENV[k] = process.env[k];
}
const cfg = {
  url: ENV.SUPABASE_URL || '',
  key: ENV.SUPABASE_SERVICE_ROLE_KEY || '',
  user: ENV.ADMIN_USER || 'Rafael',
  pass: ENV.ADMIN_PASS || 'admin123',
  port: Number(ENV.PORT) || 5600,
  mock: ENV.MOCK === '1',
  r2: {
    accountId: ENV.R2_ACCOUNT_ID || '',
    accessKeyId: ENV.R2_ACCESS_KEY_ID || '',
    secretAccessKey: ENV.R2_SECRET_ACCESS_KEY || '',
    bucket: ENV.R2_BUCKET_NAME || 'trade-images',
  },
};
const r2Configured = !!(cfg.r2.accountId && cfg.r2.accessKeyId && cfg.r2.secretAccessKey);

if (!cfg.mock && (!cfg.url || !cfg.key)) {
  console.warn('[admin] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing. API calls will fail. Set MOCK=1 in admin/.env to demo with fixture data.');
}

// ── Sessions (in-memory) ─────────────────────────────────────
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiresAt

function newSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}
function validSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/tg_admin=([a-f0-9]{64})/);
  if (!m) return false;
  const exp = sessions.get(m[1]);
  if (!exp || exp < Date.now()) { sessions.delete(m[1]); return false; }
  return true;
}

// ── Supabase helpers (service role) ──────────────────────────
function sbHeaders(extra = {}) {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest(pathQ, opts = {}) {
  const res = await fetch(`${cfg.url}/rest/v1/${pathQ}`, { ...opts, headers: sbHeaders(opts.headers) });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body?.message || body?.msg || text || res.statusText;
    const err = new Error(`PostgREST ${res.status}: ${msg}`);
    err.status = res.status;
    err.code = body?.code;
    throw err;
  }
  return body;
}

// Fetch all rows of a query, paging via Range headers.
async function restAll(pathQ, pageSize = 1000, hardLimit = 100000) {
  const out = [];
  for (let from = 0; from < hardLimit; from += pageSize) {
    const rows = await rest(pathQ, { headers: { Range: `${from}-${from + pageSize - 1}` } });
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function authUsersAll() {
  const users = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${cfg.url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`Auth admin API ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const batch = body.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

function countBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// Pro status mirror of src/js/lib/supabase-client.js getSubscriptionStatus (3-day grace)
const GRACE_DAYS = 3;
function computeStatus(profile) {
  const plan = profile?.plan || 'free';
  const planType = profile?.plan_type || 'none';
  const expiresAt = profile?.subscription_expires_at || null;
  if (plan !== 'pro') return { label: 'free', daysLeft: null };
  if (planType === 'lifetime') return { label: 'pro-lifetime', daysLeft: null };
  if (!expiresAt) return { label: 'pro', daysLeft: null };
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86400000);
  if (daysLeft < -GRACE_DAYS) return { label: 'expired', daysLeft };
  if (daysLeft < 0) return { label: 'grace', daysLeft };
  if (daysLeft <= 7) return { label: 'expiring', daysLeft };
  return { label: 'pro', daysLeft };
}

// ── API implementations ──────────────────────────────────────
async function apiUsers() {
  if (cfg.mock) return mockData.users;
  const [authUsers, profiles, journals, trades, images] = await Promise.all([
    authUsersAll(),
    restAll('profiles?select=id,name,plan,plan_type,subscription_expires_at,payment_gateway,referral_code,referral_count,queued_subscription'),
    restAll('journals?select=user_id'),
    restAll('trades?select=user_id'),
    restAll('trade_images?select=user_id'),
  ]);
  const profById = new Map(profiles.map(p => [p.id, p]));
  const jc = countBy(journals, r => r.user_id);
  const tc = countBy(trades, r => r.user_id);
  const ic = countBy(images, r => r.user_id);
  return authUsers.map(u => {
    const p = profById.get(u.id) || {};
    return {
      id: u.id,
      email: u.email,
      name: p.name || u.user_metadata?.name || '',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      plan: p.plan || 'free',
      plan_type: p.plan_type || 'none',
      subscription_expires_at: p.subscription_expires_at || null,
      payment_gateway: p.payment_gateway || null,
      referral_count: p.referral_count || 0,
      queued: !!p.queued_subscription,
      journals: jc.get(u.id) || 0,
      trades: tc.get(u.id) || 0,
      images: ic.get(u.id) || 0,
      status: computeStatus(p),
    };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function apiGrant(userId, body) {
  if (cfg.mock) return { ok: true, mock: true };
  const days = Number(body.days);
  const lifetime = !!body.lifetime;
  if (!lifetime && (!Number.isFinite(days) || days < 1 || days > 3650)) {
    throw Object.assign(new Error('days must be 1-3650'), { status: 400 });
  }
  const [current] = await rest(`profiles?id=eq.${userId}&select=subscription_expires_at,plan,plan_type`);
  if (!current) throw Object.assign(new Error('profile not found'), { status: 404 });

  let patch;
  if (lifetime) {
    patch = { plan: 'pro', plan_type: 'lifetime', subscription_expires_at: null };
  } else {
    // Stack on the current expiry like upgradePlan() in _shared/plan-utils.ts
    const base = current.subscription_expires_at && new Date(current.subscription_expires_at) > new Date()
      ? new Date(current.subscription_expires_at)
      : new Date();
    const expires = new Date(base.getTime() + days * 86400000).toISOString();
    patch = { plan: 'pro', plan_type: 'gifted', subscription_expires_at: expires };
  }

  const doPatch = (p) => rest(`profiles?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(p),
    headers: { Prefer: 'return=representation' },
  });

  try {
    const rows = await doPatch(patch);
    return { ok: true, profile: rows[0], planTypeUsed: patch.plan_type };
  } catch (e) {
    // If 'gifted' violates a check constraint, fall back to 'referral'
    // (the existing granted-days mechanism).
    if (!body.lifetime && (e.code === '23514' || /check constraint/i.test(e.message))) {
      const rows = await doPatch({ ...patch, plan_type: 'referral' });
      return { ok: true, profile: rows[0], planTypeUsed: 'referral', note: "plan_type 'gifted' rejected by a constraint; used 'referral'" };
    }
    throw e;
  }
}

async function apiRevoke(userId) {
  if (cfg.mock) return { ok: true, mock: true };
  const rows = await rest(`profiles?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ plan: 'free', plan_type: 'none', subscription_expires_at: null }),
    headers: { Prefer: 'return=representation' },
  });
  return { ok: true, profile: rows[0] };
}

// ── Storage usage ────────────────────────────────────────────
const storageCache = new Map(); // userId -> { at, data }
const STORAGE_CACHE_MS = 10 * 60 * 1000;

async function listSupabaseBucket(bucket, prefix) {
  // The storage list endpoint lists one level; recurse into folders (id === null).
  let total = 0, count = 0;
  async function walk(pfx) {
    for (let offset = 0; ; offset += 100) {
      const res = await fetch(`${cfg.url}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: sbHeaders(),
        body: JSON.stringify({ prefix: pfx, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!res.ok) return; // bucket may not exist; treat as empty
      const items = await res.json();
      if (!Array.isArray(items) || !items.length) return;
      for (const it of items) {
        if (it.id === null) await walk(`${pfx}/${it.name}`);
        else { total += it.metadata?.size || 0; count++; }
      }
      if (items.length < 100) return;
    }
  }
  await walk(prefix);
  return { bytes: total, objects: count };
}

async function listR2(userId) {
  if (!r2Configured) return { configured: false, bytes: 0, objects: 0 };
  let AwsClient;
  try { ({ AwsClient } = require('aws4fetch')); }
  catch { return { configured: false, bytes: 0, objects: 0, note: 'aws4fetch not installed; run npm install in admin/' }; }
  const aws = new AwsClient({ accessKeyId: cfg.r2.accessKeyId, secretAccessKey: cfg.r2.secretAccessKey, service: 's3', region: 'auto' });
  const endpoint = `https://${cfg.r2.accountId}.r2.cloudflarestorage.com/${cfg.r2.bucket}`;
  let bytes = 0, objects = 0, token = '';
  for (let i = 0; i < 50; i++) {
    const q = new URLSearchParams({ 'list-type': '2', prefix: `trades/${userId}/`, 'max-keys': '1000' });
    if (token) q.set('continuation-token', token);
    const res = await aws.fetch(`${endpoint}?${q}`);
    if (!res.ok) throw new Error(`R2 list failed: ${res.status} ${await res.text()}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) { bytes += Number(m[1]); objects++; }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    if (!next) break;
    token = next[1];
  }
  return { configured: true, bytes, objects };
}

async function apiStorage(userId) {
  if (cfg.mock) return mockData.storage;
  const cached = storageCache.get(userId);
  if (cached && Date.now() - cached.at < STORAGE_CACHE_MS) return cached.data;
  const [sbTrades, sbNotes, r2, inlineRows] = await Promise.all([
    listSupabaseBucket('trade-images', userId),
    listSupabaseBucket('custom-note-images', userId),
    listR2(userId).catch(e => ({ configured: true, error: e.message, bytes: 0, objects: 0 })),
    rest(`trade_images?user_id=eq.${userId}&data=not.is.null&select=id`).catch(() => []),
  ]);
  const data = {
    r2,
    supabase: { bytes: sbTrades.bytes + sbNotes.bytes, objects: sbTrades.objects + sbNotes.objects },
    inlineLegacyImages: inlineRows.length,
    totalBytes: (r2.bytes || 0) + sbTrades.bytes + sbNotes.bytes,
    r2Configured,
  };
  storageCache.set(userId, { at: Date.now(), data });
  return data;
}

// ── Analytics ────────────────────────────────────────────────
async function apiAnalytics(days) {
  if (cfg.mock) return mockData.analytics;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  let events;
  try {
    events = await restAll(`app_events?select=user_id,event,page,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`, 1000, 50000);
  } catch (e) {
    if (e.code === '42P01' || /does not exist/i.test(e.message)) {
      return { missingTable: true, message: 'app_events table missing. Run the migration supabase/migrations/2026-07-14_admin_analytics_support.sql' };
    }
    throw e;
  }
  const dayKey = iso => iso.slice(0, 10);
  const todayKey = new Date().toISOString().slice(0, 10);
  const weekAgo = Date.now() - 7 * 86400000;

  const dauToday = new Set(events.filter(e => dayKey(e.created_at) === todayKey).map(e => e.user_id)).size;
  const wau = new Set(events.filter(e => new Date(e.created_at).getTime() >= weekAgo).map(e => e.user_id)).size;
  const eventsToday = events.filter(e => dayKey(e.created_at) === todayKey).length;

  const visits = events.filter(e => e.event === 'page_visit');
  const visitsByPage = [...countBy(visits, e => e.page || '(unknown)')].map(([page, n]) => ({ page, n })).sort((a, b) => b.n - a.n);
  const byType = [...countBy(events, e => e.event)].map(([event, n]) => ({ event, n })).sort((a, b) => b.n - a.n);

  // daily active users per day (fill gaps)
  const perDay = new Map();
  for (const e of events) {
    const k = dayKey(e.created_at);
    if (!perDay.has(k)) perDay.set(k, new Set());
    perDay.get(k).add(e.user_id);
  }
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    daily.push({ day: k, users: perDay.get(k)?.size || 0 });
  }

  const topUsers = [...countBy(events, e => e.user_id)].map(([user_id, n]) => ({ user_id, n })).sort((a, b) => b.n - a.n).slice(0, 10);

  return { days, totalEvents: events.length, dauToday, wau, eventsToday, visitsByPage, byType, daily, topUsers };
}

// ── Reports ──────────────────────────────────────────────────
async function apiReports() {
  if (cfg.mock) return mockData.reports;
  let msgs;
  try {
    msgs = await restAll('support_messages?select=id,user_id,subject,message,status,created_at&order=created_at.desc', 1000, 5000);
  } catch (e) {
    if (e.code === '42P01' || /does not exist/i.test(e.message)) {
      return { missingTable: true, message: 'support_messages table missing. Run the migration supabase/migrations/2026-07-14_admin_analytics_support.sql' };
    }
    throw e;
  }
  if (!msgs.length) return { messages: [] };
  const ids = [...new Set(msgs.map(m => m.user_id))];
  const [profiles, authUsers] = await Promise.all([
    rest(`profiles?id=in.(${ids.join(',')})&select=id,name,plan,plan_type,subscription_expires_at`),
    authUsersAll(),
  ]);
  const profById = new Map(profiles.map(p => [p.id, p]));
  const emailById = new Map(authUsers.map(u => [u.id, u.email]));
  return {
    messages: msgs.map(m => {
      const p = profById.get(m.user_id) || {};
      return { ...m, sender_name: p.name || '', sender_email: emailById.get(m.user_id) || '', sender_status: computeStatus(p) };
    }),
  };
}

async function apiReportStatus(id, status) {
  if (cfg.mock) {
    const msg = mockData.reports.messages.find(m => m.id === id);
    if (msg) msg.status = status;
    return { ok: true, mock: true };
  }
  if (!['new', 'read', 'resolved'].includes(status)) throw Object.assign(new Error('bad status'), { status: 400 });
  const rows = await rest(`support_messages?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
    headers: { Prefer: 'return=representation' },
  });
  return { ok: true, message: rows[0] };
}

// ── Mock fixtures (MOCK=1) ───────────────────────────────────
const mockData = {
  users: [
    { id: 'u1', email: 'sofia@example.com', name: 'Sofia T.', created_at: '2026-03-02T10:00:00Z', last_sign_in_at: '2026-07-13T21:14:00Z', plan: 'pro', plan_type: 'yearly', subscription_expires_at: '2027-03-02T10:00:00Z', payment_gateway: 'paypal', referral_count: 2, queued: false, journals: 3, trades: 412, images: 260, status: { label: 'pro', daysLeft: 231 } },
    { id: 'u2', email: 'renz@example.com', name: 'Renz C.', created_at: '2026-05-18T08:30:00Z', last_sign_in_at: '2026-07-14T02:40:00Z', plan: 'pro', plan_type: 'monthly', subscription_expires_at: '2026-07-19T08:30:00Z', payment_gateway: 'paypal', referral_count: 0, queued: false, journals: 1, trades: 96, images: 41, status: { label: 'expiring', daysLeft: 5 } },
    { id: 'u3', email: 'kian@example.com', name: 'Kian M.', created_at: '2026-06-25T15:00:00Z', last_sign_in_at: '2026-07-12T11:05:00Z', plan: 'free', plan_type: 'none', subscription_expires_at: null, payment_gateway: null, referral_count: 0, queued: false, journals: 1, trades: 23, images: 6, status: { label: 'free', daysLeft: null } },
  ],
  storage: { r2: { configured: false, bytes: 0, objects: 0 }, supabase: { bytes: 18874368, objects: 41 }, inlineLegacyImages: 2, totalBytes: 18874368, r2Configured: false },
  analytics: {
    days: 30, totalEvents: 1418, dauToday: 2, wau: 3, eventsToday: 37,
    visitsByPage: [{ page: '/journal', n: 320 }, { page: '/logs.html', n: 291 }, { page: '/dashboard', n: 204 }, { page: '/calendar.html', n: 118 }, { page: '/analytics.html', n: 74 }, { page: '/notes.html', n: 41 }],
    byType: [{ event: 'page_visit', n: 1048 }, { event: 'trade_added', n: 273 }, { event: 'image_uploaded', n: 84 }, { event: 'export_used', n: 9 }, { event: 'support_sent', n: 4 }],
    daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10), users: [1, 2, 2, 3, 1, 2, 3][i % 7] })),
    topUsers: [{ user_id: 'u1', n: 611 }, { user_id: 'u2', n: 502 }, { user_id: 'u3', n: 305 }],
  },
  reports: {
    messages: [
      { id: 'm1', user_id: 'u2', subject: 'Calendar day totals look off on mobile', message: 'When I open the calendar on my phone the day cells overlap on small screens. Pixel 6, Chrome.', status: 'new', created_at: '2026-07-13T19:22:00Z', sender_name: 'Renz C.', sender_email: 'renz@example.com', sender_status: { label: 'expiring', daysLeft: 5 } },
      { id: 'm2', user_id: 'u3', subject: 'Feature request: futures fees field', message: 'Would love a fees column so net PNL is accurate for futures.', status: 'read', created_at: '2026-07-11T09:02:00Z', sender_name: 'Kian M.', sender_email: 'kian@example.com', sender_status: { label: 'free', daysLeft: null } },
    ],
  },
};

// ── HTTP plumbing ────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // ── auth endpoints ──
    if (p === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.username === cfg.user && body.password === cfg.pass) {
        const token = newSession();
        res.writeHead(200, {
          'Set-Cookie': `tg_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ ok: true }));
      } else {
        sendJson(res, 401, { error: 'Invalid credentials' });
      }
      return;
    }
    if (p === '/api/logout' && req.method === 'POST') {
      res.writeHead(200, { 'Set-Cookie': 'tg_admin=; Path=/; Max-Age=0', 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    // ── protected API ──
    if (p.startsWith('/api/')) {
      if (!validSession(req)) { sendJson(res, 401, { error: 'Not logged in' }); return; }

      if (p === '/api/me') return sendJson(res, 200, { user: cfg.user, mock: cfg.mock, r2Configured });
      if (p === '/api/users' && req.method === 'GET') return sendJson(res, 200, { users: await apiUsers() });

      let m;
      if ((m = p.match(/^\/api\/users\/([\w-]+)\/grant$/)) && req.method === 'POST') {
        return sendJson(res, 200, await apiGrant(m[1], await readBody(req)));
      }
      if ((m = p.match(/^\/api\/users\/([\w-]+)\/revoke$/)) && req.method === 'POST') {
        return sendJson(res, 200, await apiRevoke(m[1]));
      }
      if ((m = p.match(/^\/api\/users\/([\w-]+)\/storage$/)) && req.method === 'GET') {
        return sendJson(res, 200, await apiStorage(m[1]));
      }
      if (p === '/api/analytics' && req.method === 'GET') {
        const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
        return sendJson(res, 200, await apiAnalytics(days));
      }
      if (p === '/api/reports' && req.method === 'GET') return sendJson(res, 200, await apiReports());
      if ((m = p.match(/^\/api\/reports\/([\w-]+)\/status$/)) && req.method === 'POST') {
        const body = await readBody(req);
        return sendJson(res, 200, await apiReportStatus(m[1], body.status));
      }
      return sendJson(res, 404, { error: 'Unknown API route' });
    }

    // ── static UI ──
    let file = p === '/' ? '/index.html' : p;
    if (file === '/index.html' && !validSession(req)) file = '/login.html';
    const full = path.join(__dirname, 'public', path.normalize(file).replace(/^([.][.][\\/])+/, ''));
    if (!full.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end(); return; }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    console.error('[admin]', req.method, p, '->', e.message);
    sendJson(res, e.status || 500, { error: e.message });
  }
});

server.listen(cfg.port, '127.0.0.1', () => {
  console.log('');
  console.log('  TradingGrove Admin (LOCAL ONLY)');
  console.log(`  http://127.0.0.1:${cfg.port}`);
  console.log(`  Mode: ${cfg.mock ? 'MOCK fixture data' : 'live Supabase (service role)'} | R2 storage: ${r2Configured ? 'configured' : 'not configured'}`);
  console.log('');
});
