// TradingGrove local admin UI. No framework: fetch + render.

let USERS = [];
let grantTarget = null;
let REF = null; // { edges, rewardDays } once loaded
let sortKey = 'created_at';
let sortDir = 'desc';
let activeChip = 'all';

// ── plumbing ─────────────────────────────────────────────────
// Every request runs through api(), so counting in-flight ones here is enough
// to drive the top progress bar for the whole admin - nothing has to opt in.
let inFlight = 0;
function setBusy(delta) {
  inFlight = Math.max(0, inFlight + delta);
  document.getElementById('topbar').classList.toggle('on', inFlight > 0);
}
async function api(path, opts = {}) {
  setBusy(1);
  try {
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (res.status === 401) { location.href = '/'; throw new Error('session expired'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  } finally { setBusy(-1); }
}

// ── loading placeholders ──
function loadingBlock(text = 'Loading…') {
  return `<div class="loading-block"><span class="spin lg"></span><span>${esc(text)}</span></div>`;
}
function skelTiles(n) { return Array.from({ length: n }, () => '<div class="skel skel-tile"></div>').join(''); }
function skelUserRows(n = 8) {
  return Array.from({ length: n }, () => `
    <tr class="skel-row">
      <td><div class="u-cell"><span class="skel circle"></span>
        <div class="u-info"><div class="skel" style="width:120px"></div><div class="skel" style="width:160px;height:8px;margin-top:6px"></div></div></div></td>
      <td><div class="skel" style="width:70px;height:16px;border-radius:20px"></div><div class="skel" style="width:100px;height:8px;margin-top:5px"></div></td>
      ${'<td class="num"><div class="skel" style="width:26px"></div></td>'.repeat(4)}
      <td class="num"><div class="skel" style="width:60px"></div></td>
      <td class="num"><div class="skel" style="width:54px"></div></td>
      <td class="num"><div class="skel" style="width:54px"></div></td>
      <td style="text-align:right"><div class="skel" style="width:46px;height:22px"></div></td>
    </tr>`).join('');
}
// Swaps a button to a spinner for the duration of fn, so a click that kicks off
// a slow fetch shows its own progress and can't be double-fired.
async function withBtnBusy(btn, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  btn.disabled = true; btn.classList.add('busy');
  btn.innerHTML = `<span class="spin"></span>${btn.textContent.trim()}`;
  try { return await fn(); }
  finally { btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = html; }
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' }) : '—'; }
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
async function logout() { await api('/api/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; }

// tooltip
const tip = document.getElementById('tip');
function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; moveTip(e); }
function moveTip(e) {
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const r = tip.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip() { tip.style.display = 'none'; }
document.addEventListener('mousemove', e => { if (tip.style.display === 'block') moveTip(e); });

// ── nav ──────────────────────────────────────────────────────
function goToView(view) {
  const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'analytics') loadAnalytics();
  if (view === 'reports') loadReports();
  if (view === 'referrals' && !REF) loadReferrals();
  if (view === 'deleted') loadDeleted();
}
document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => goToView(btn.dataset.view)));

// ── users ────────────────────────────────────────────────────
// Single source of truth for "what does this plan status mean" - feeds
// both the table badge and the referral-network node ring color, so the
// two views always agree on what green/gold/red/gray mean.
function statusMeta(status) {
  const l = status?.label || 'free';
  const map = {
    'pro-lifetime': { text: 'Pro · Lifetime', ring: 'net-ring-good', badgeClass: 'pro-lifetime' },
    pro: { text: 'Pro', ring: 'net-ring-good', badgeClass: 'pro' },
    expiring: { text: `Pro · ${status?.daysLeft ?? '?'}d left`, ring: 'net-ring-warn', badgeClass: 'expiring' },
    grace: { text: 'Grace', ring: 'net-ring-warn', badgeClass: 'grace' },
    expired: { text: 'Expired', ring: 'net-ring-bad', badgeClass: 'expired' },
    free: { text: 'Free', ring: 'net-ring-muted', badgeClass: 'free' },
  };
  return map[l] || { text: l, ring: 'net-ring-muted', badgeClass: l };
}
function badgeFor(u) {
  const m = statusMeta(u.status);
  return `<span class="badge ${m.badgeClass}">${esc(m.text)}</span>`;
}
function initials(u) {
  const src = (u.name || u.email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
}
function copyEmail(e, email) {
  navigator.clipboard?.writeText(email).catch(() => {});
  showTip(e, 'Copied');
  setTimeout(hideTip, 900);
}
function subLine(u) {
  const parts = [];
  if (u.plan_type === 'lifetime') {
    parts.push('lifetime · never expires');
  } else {
    if (u.plan_type && u.plan_type !== 'none') parts.push(esc(u.plan_type));
    if (u.subscription_expires_at) {
      const days = u.status?.daysLeft;
      parts.push(`ends ${fmtDate(u.subscription_expires_at)}${days != null ? ` (${days}d)` : ''}`);
    }
  }
  if (u.payment_gateway) parts.push(esc(u.payment_gateway));
  if (u.queued) parts.push('queued');
  return parts.join(' · ');
}

// ── filter chips ──
const CHIPS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'pro', label: 'Pro', test: s => s.label === 'pro' || s.label === 'pro-lifetime' },
  { key: 'expiring', label: 'Expiring', test: s => s.label === 'expiring' },
  { key: 'grace', label: 'Grace', test: s => s.label === 'grace' },
  { key: 'expired', label: 'Expired', test: s => s.label === 'expired' },
  { key: 'free', label: 'Free', test: s => s.label === 'free' },
];
function renderChips() {
  const wrap = document.getElementById('userChips');
  wrap.innerHTML = CHIPS.map(c => {
    const n = USERS.filter(u => c.test(u.status || {})).length;
    return `<button class="chip ${activeChip === c.key ? 'active' : ''}" onclick="setChip('${c.key}')">${c.label} <span class="chip-n">${n}</span></button>`;
  }).join('');
}
function setChip(key) { activeChip = key; renderChips(); renderUsers(); }
function passesFilters(u, q) {
  const chip = CHIPS.find(c => c.key === activeChip) || CHIPS[0];
  if (!chip.test(u.status || {})) return false;
  if (!q) return true;
  return [u.email, u.name, u.plan, u.plan_type, u.status?.label].join(' ').toLowerCase().includes(q);
}

// ── sorting ──
function userSortValue(u, key) {
  switch (key) {
    case 'email': return (u.email || '').toLowerCase();
    case 'expires': return u.plan_type === 'lifetime' ? Infinity : (u.subscription_expires_at ? new Date(u.subscription_expires_at).getTime() : -Infinity);
    case 'journals': return u.journals || 0;
    case 'trades': return u.trades || 0;
    case 'images': return u.images || 0;
    case 'referrals': return u.referral_count || 0;
    case 'created_at': return new Date(u.created_at).getTime();
    case 'last_sign_in_at': return u.last_sign_in_at ? new Date(u.last_sign_in_at).getTime() : -Infinity;
    default: return 0;
  }
}
function toggleSort(key) {
  if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortKey = key; sortDir = key === 'email' ? 'asc' : 'desc'; }
  renderUsers();
}
document.querySelectorAll('#usersTable thead th[data-sort]').forEach(th => th.addEventListener('click', () => toggleSort(th.dataset.sort)));
function updateSortIndicators() {
  document.querySelectorAll('#usersTable thead th[data-sort]').forEach(th => {
    th.querySelector('.sort-ind').textContent = th.dataset.sort === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '';
  });
}

function renderUsers() {
  const q = document.getElementById('userSearch').value.trim().toLowerCase();
  let rows = USERS.filter(u => passesFilters(u, q));
  rows = rows.slice().sort((a, b) => {
    const av = userSortValue(a, sortKey), bv = userSortValue(b, sortKey);
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : (av < bv ? -1 : av > bv ? 1 : 0);
    return sortDir === 'asc' ? cmp : -cmp;
  });
  const body = document.getElementById('usersBody');
  if (!rows.length) { body.innerHTML = '<tr><td colspan="10" class="empty">No users match.</td></tr>'; updateSortIndicators(); return; }
  body.innerHTML = rows.map(u => `
    <tr data-id="${u.id}">
      <td>
        <div class="u-cell">
          <div class="u-avatar">${esc(initials(u))}</div>
          <div class="u-info">
            <div class="u-name">${esc(u.name || '(no name)')}</div>
            <div class="u-email" onclick="copyEmail(event,'${esc(u.email)}')" title="Click to copy">${esc(u.email)}</div>
          </div>
        </div>
      </td>
      <td>
        <div>${badgeFor(u)}</div>
        <div class="sub-line">${subLine(u) || '&nbsp;'}</div>
      </td>
      <td class="num">${u.journals}</td>
      <td class="num">${u.trades}</td>
      <td class="num">${u.images}</td>
      <td class="num">${u.referral_count ? `<a href="javascript:void(0)" onclick="goToReferralsAndFocus('${u.id}')">${u.referral_count}</a>` : '<span class="muted-plain">0</span>'}</td>
      <td class="num storage-cell" id="st-${u.id}"><button class="btn btn-sm" onclick="loadStorage('${u.id}')">Compute</button></td>
      <td class="num date">${fmtDate(u.created_at)}</td>
      <td class="num date">${fmtDate(u.last_sign_in_at)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" onclick="openMessage('${u.id}')">Message</button>
        <button class="btn btn-sm" onclick="openGrant('${u.id}')">Grant</button>
        ${u.plan === 'pro' ? `<button class="btn btn-sm danger" onclick="revoke('${u.id}',this)">Revoke</button>` : ''}
      </td>
    </tr>`).join('');
  updateSortIndicators();
}

function exportUsersCsv() {
  const q = document.getElementById('userSearch').value.trim().toLowerCase();
  const rows = USERS.filter(u => passesFilters(u, q));
  const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ['Email', 'Name', 'Plan', 'Type', 'Expires', 'Gateway', 'Journals', 'Trades', 'Images', 'Referrals', 'Joined', 'Last Seen'];
  const lines = [header.map(csvCell).join(',')];
  for (const u of rows) {
    lines.push([u.email, u.name || '', u.plan, u.plan_type, u.plan_type === 'lifetime' ? 'never' : (u.subscription_expires_at || ''), u.payment_gateway || '', u.journals, u.trades, u.images, u.referral_count || 0, u.created_at || '', u.last_sign_in_at || ''].map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tradinggrove-users.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}

function renderUserTiles() {
  const pro = USERS.filter(u => ['pro', 'pro-lifetime', 'expiring', 'grace'].includes(u.status?.label)).length;
  const expiring = USERS.filter(u => u.status?.label === 'expiring').length;
  const weekAgo = Date.now() - 7 * 86400000;
  const newWeek = USERS.filter(u => new Date(u.created_at).getTime() > weekAgo).length;
  document.getElementById('userTiles').innerHTML = `
    <div class="tile"><div class="tile-lbl">Total users</div><div class="tile-val">${USERS.length}</div></div>
    <div class="tile"><div class="tile-lbl">Pro (active)</div><div class="tile-val pos">${pro}</div></div>
    <div class="tile"><div class="tile-lbl">Expiring ≤ 7d</div><div class="tile-val ${expiring ? 'warn' : ''}">${expiring}</div></div>
    <div class="tile"><div class="tile-lbl">New this week</div><div class="tile-val">${newWeek}</div></div>`;
}

async function loadUsers(refresh, btn) {
  const sub = document.getElementById('usersSub');
  sub.innerHTML = '<span class="spin"></span> Loading users…';
  // Only skeleton the table on a cold load - on refresh the existing rows stay
  // readable and the top bar carries the "working on it" signal instead.
  if (!USERS.length) {
    document.getElementById('usersBody').innerHTML = skelUserRows();
    document.getElementById('userTiles').innerHTML = skelTiles(4);
  }
  try {
    const { users } = await (btn ? withBtnBusy(btn, () => api('/api/users' + (refresh ? '?refresh=1' : ''))) : api('/api/users' + (refresh ? '?refresh=1' : '')));
    USERS = users;
    renderUserTiles();
    renderChips();
    renderUsers();
    sub.textContent = `${users.length} signed-up user${users.length === 1 ? '' : 's'}`;
  } catch (e) {
    sub.textContent = '';
    if (!USERS.length) document.getElementById('userTiles').innerHTML = '';
    document.getElementById('usersBody').innerHTML = `<tr><td colspan="10"><div class="err-box">Could not load users: ${esc(e.message)}<br>Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in admin/.env, or run with MOCK=1.</div></td></tr>`;
  }
}
document.getElementById('userSearch').addEventListener('input', renderUsers);

async function loadStorage(id) {
  const cell = document.getElementById('st-' + id);
  cell.innerHTML = '<span class="spin"></span>';
  try {
    const s = await api(`/api/users/${id}/storage`);
    const parts = [`<strong style="color:var(--text)">${fmtBytes(s.totalBytes)}</strong>`];
    if (s.r2?.configured) parts.push(`R2 ${fmtBytes(s.r2.bytes)} (${s.r2.objects})`);
    else parts.push('<span title="Add R2 credentials to admin/.env for R2 bytes">R2 n/a</span>');
    parts.push(`SB ${fmtBytes(s.supabase.bytes)}`);
    if (s.inlineLegacyImages) parts.push(`${s.inlineLegacyImages} inline`);
    cell.innerHTML = parts.join(' · ');
  } catch (e) {
    cell.innerHTML = `<span style="color:var(--red)" title="${esc(e.message)}">failed</span>`;
  }
}

// grant / revoke
function openGrant(id) {
  grantTarget = USERS.find(u => u.id === id);
  if (!grantTarget) return;
  document.getElementById('grantWho').textContent = `${grantTarget.email} · currently ${grantTarget.plan} (${grantTarget.plan_type})`;
  document.getElementById('grantMsg').textContent = '';
  document.getElementById('grantLifetime').checked = false;
  document.getElementById('grantModal').classList.add('open');
}
function closeGrant() { document.getElementById('grantModal').classList.remove('open'); grantTarget = null; }
function setDays(n) { document.getElementById('grantDays').value = n; document.getElementById('grantLifetime').checked = false; }

async function doGrant() {
  if (!grantTarget) return;
  const lifetime = document.getElementById('grantLifetime').checked;
  const days = Number(document.getElementById('grantDays').value);
  const msg = document.getElementById('grantMsg');
  const go = document.getElementById('grantGo');
  if (!lifetime && (!Number.isFinite(days) || days < 1)) { msg.className = 'm-msg err'; msg.textContent = 'Enter a valid number of days.'; return; }
  go.disabled = true;
  msg.className = 'm-msg'; msg.innerHTML = '<span class="spin"></span> Granting…';
  try {
    const r = await api(`/api/users/${grantTarget.id}/grant`, { method: 'POST', body: JSON.stringify({ days, lifetime }) });
    msg.className = 'm-msg ok';
    msg.textContent = lifetime ? 'Lifetime Pro granted.' : `Granted. ${r.note ? r.note : `plan_type: ${r.planTypeUsed || 'gifted'}`}`;
    await loadUsers(true);
    setTimeout(closeGrant, 900);
  } catch (e) {
    msg.className = 'm-msg err'; msg.textContent = e.message;
  } finally { go.disabled = false; }
}

async function revoke(id, btn) {
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Revoke Pro from ${u.email}? They drop to the Free plan immediately (data is kept).`)) return;
  try {
    // The button is inside a row that loadUsers() re-renders, so keep the busy
    // state around the revoke call only and let the re-render clear it.
    await withBtnBusy(btn, () => api(`/api/users/${id}/revoke`, { method: 'POST' }));
    await loadUsers(true);
  } catch (e) { alert('Revoke failed: ' + e.message); }
}

// ── message user (admin -> user notification) ────────────────
let msgTarget = null;
function openMessage(id) {
  msgTarget = USERS.find(u => u.id === id);
  if (!msgTarget) return;
  document.getElementById('msgWho').textContent = `To ${msgTarget.email} — shows up in the bell on their dashboard.`;
  document.getElementById('msgTitle').value = '';
  document.getElementById('msgBody').value = '';
  document.getElementById('msgMsg').textContent = '';
  document.getElementById('msgModal').classList.add('open');
  document.getElementById('msgTitle').focus();
}
function closeMessage() { document.getElementById('msgModal').classList.remove('open'); msgTarget = null; }

async function doMessage() {
  if (!msgTarget) return;
  const title = document.getElementById('msgTitle').value.trim();
  const body = document.getElementById('msgBody').value.trim();
  const msg = document.getElementById('msgMsg');
  const go = document.getElementById('msgGo');
  if (!title) { msg.className = 'm-msg err'; msg.textContent = 'Enter a title.'; return; }
  if (!body) { msg.className = 'm-msg err'; msg.textContent = 'Enter a message.'; return; }
  go.disabled = true;
  msg.className = 'm-msg'; msg.innerHTML = '<span class="spin"></span> Sending…';
  try {
    const r = await api(`/api/users/${msgTarget.id}/message`, { method: 'POST', body: JSON.stringify({ title, body }) });
    if (r.missingTable) { msg.className = 'm-msg err'; msg.textContent = r.message; return; }
    msg.className = 'm-msg ok';
    msg.textContent = 'Sent.';
    setTimeout(closeMessage, 900);
  } catch (e) {
    msg.className = 'm-msg err'; msg.textContent = e.message;
  } finally { go.disabled = false; }
}

// ── referrals ────────────────────────────────────────────────
// Reward = 30 days of Pro per rewarded referral (server confirms via
// REF.rewardDays, mirroring supabase/functions/_shared/referral-utils.ts).
let REF_GRAPH = null;   // { nodes: Map(id -> {id,parentId,edge,children:[]}), roots: [id,...] }
let REF_COORDS = null;  // Map(id -> {x,y,level,rootId})

function userLookup(id) {
  return USERS.find(u => u.id === id) || { id, email: '(deleted user)', name: '', status: { label: 'free' }, created_at: null };
}
function ringClass(status) { return statusMeta(status).ring; }

function buildReferralGraph(edges) {
  const nodes = new Map();
  const ensure = id => { if (!nodes.has(id)) nodes.set(id, { id, parentId: null, edge: null, children: [] }); return nodes.get(id); };
  for (const e of edges) {
    const child = ensure(e.referred_user_id);
    ensure(e.referrer_id);
    child.parentId = e.referrer_id;
    child.edge = e;
    nodes.get(e.referrer_id).children.push(child.id);
  }
  // Connected components (undirected: a referral link ties two users together
  // regardless of direction). Normally every component has exactly one true
  // root (parentId === null). A referral cycle - two users who each
  // "referred" the other - leaves that component with NO true root; pick one
  // representative per such component rather than letting every member
  // become its own cluster center (which splinters one connected group
  // across the canvas, joined only by long edges crossing empty space).
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const n of nodes.values()) {
    if (n.parentId && nodes.has(n.parentId)) { link(n.id, n.parentId); link(n.parentId, n.id); }
  }
  const seen = new Set();
  const roots = [];
  for (const id of nodes.keys()) {
    if (seen.has(id)) continue;
    const comp = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const cur = queue.shift();
      comp.push(cur);
      for (const nb of adj.get(cur) || []) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
    const naturalRoots = comp.filter(cid => nodes.get(cid).parentId === null);
    if (naturalRoots.length) roots.push(...naturalRoots);
    else roots.push(comp.reduce((best, cid) => nodes.get(cid).children.length > nodes.get(best).children.length ? cid : best, comp[0]));
  }
  return { nodes, roots };
}

// Layered (Sugiyama-style) layout: level = distance from the root referrer.
// Same-cluster nodes stay contiguous within a level since DFS visits a
// root's whole subtree before moving to the next root.
function layoutGraph(graph) {
  const levels = [];
  const visited = new Set();
  function place(id, level, rootId) {
    if (visited.has(id)) return;
    visited.add(id);
    (levels[level] ||= []).push({ id, rootId });
    for (const childId of graph.nodes.get(id).children) place(childId, level + 1, rootId);
  }
  graph.roots.forEach(rootId => place(rootId, 0, rootId));
  return levels;
}

async function loadReferrals(btn) {
  const netWrap = document.getElementById('refNetworkWrap');
  const listWrap = document.getElementById('refListWrap');
  netWrap.innerHTML = loadingBlock('Building referral network…');
  listWrap.innerHTML = loadingBlock();
  if (!REF) document.getElementById('refTiles').innerHTML = skelTiles(6);
  try { REF = await (btn ? withBtnBusy(btn, () => api('/api/referrals')) : api('/api/referrals')); }
  catch (e) {
    netWrap.innerHTML = `<div class="err-box">${esc(e.message)}</div>`;
    listWrap.innerHTML = '';
    document.getElementById('refTiles').innerHTML = '';
    return;
  }
  if (REF.missingTable) {
    netWrap.innerHTML = `<div class="empty">${esc(REF.message)}</div>`;
    listWrap.innerHTML = '';
    document.getElementById('refTiles').innerHTML = '';
    return;
  }
  if (!USERS.length) await loadUsers();
  renderReferralTiles();
  renderReferralNetwork();
  renderReferrerList();
}

function renderReferralTiles() {
  const edges = REF.edges;
  const rewarded = edges.filter(e => e.reward_granted).length;
  const pending = edges.length - rewarded;
  const referrers = new Set(edges.map(e => e.referrer_id)).size;
  const signups = new Set(edges.map(e => e.referred_user_id)).size;
  const daysGranted = rewarded * (REF.rewardDays || 30);
  document.getElementById('refTiles').innerHTML = `
    <div class="tile"><div class="tile-lbl">Total referrals</div><div class="tile-val">${edges.length}</div></div>
    <div class="tile"><div class="tile-lbl">Rewarded</div><div class="tile-val pos">${rewarded}</div></div>
    <div class="tile"><div class="tile-lbl">Pending</div><div class="tile-val warn">${pending}</div></div>
    <div class="tile"><div class="tile-lbl">Referrers</div><div class="tile-val">${referrers}</div></div>
    <div class="tile"><div class="tile-lbl">Referred signups</div><div class="tile-val">${signups}</div></div>
    <div class="tile"><div class="tile-lbl">Pro days granted</div><div class="tile-val pos">+${daysGranted}d</div></div>`;
}

// ── network renderer ─────────────────────────────────────────
// Radial "network intelligence" view. Hand-rolled SVG, zero libraries:
//  - radial layout with subtree-weighted angular spans (no overlaps)
//  - curved gradient edges + SMIL particles flowing along rewarded paths
//  - glass nodes with tier sizing, pulse halos, focal ring, collapse/expand
//  - zoom (wheel) + pan (drag) on a viewport group, FLIP relayout animation
const NET = {
  collapsed: new Set(), // node ids whose subtree is hidden
  focalId: null,        // node id given the persistent "selected" treatment
  selectedSet: null,    // Set of ids in the selected node's upstream+downstream chain
  view: { tx: 0, ty: 0, k: 1 },
  baseView: { tx: 0, ty: 0, k: 1 }, // the auto-fit view for the current layout; "Fit" resets to this
  size: { w: 0, h: 0 },
  ring: 108,       // adaptive radial spacing, set per-layout from visible node count
  nodeScale: 1,    // adaptive node-radius scale, set per-layout from visible node count
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
};

function countVisibleNodes() {
  let n = 0;
  for (const id of REF_GRAPH.nodes.keys()) if (netVisible(id)) n++;
  return n;
}

function netVisible(id) {
  // hidden if any ancestor is collapsed
  let cur = REF_GRAPH.nodes.get(id);
  const seen = new Set([id]);
  while (cur?.parentId && !seen.has(cur.parentId)) {
    if (NET.collapsed.has(cur.parentId)) return false;
    seen.add(cur.parentId);
    cur = REF_GRAPH.nodes.get(cur.parentId);
  }
  return true;
}
function subtreeLeafCount(id, seen = new Set()) {
  if (seen.has(id)) return 0;
  seen.add(id);
  const n = REF_GRAPH.nodes.get(id);
  const kids = (n?.children || []).filter(c => !NET.collapsed.has(id) && netVisible(c));
  if (!kids.length || NET.collapsed.has(id)) return 1;
  return Math.max(1, kids.reduce((s, c) => s + subtreeLeafCount(c, seen), 0));
}
function hiddenDescendants(id, seen = new Set()) {
  if (seen.has(id)) return 0;
  seen.add(id);
  const n = REF_GRAPH.nodes.get(id);
  return (n?.children || []).reduce((s, c) => s + 1 + hiddenDescendants(c, seen), 0);
}

// Radial layout: each root is a cluster center; children fan out in rings,
// each child's angular span proportional to its (visible) subtree leaf count.
// Both ring spacing and node size adapt to the visible node count, so a
// 3-node tree sits close together and a 300-node tree gets breathing room
// instead of the same fixed spacing either way.
function layoutRadial() {
  REF_COORDS = new Map();
  const n = countVisibleNodes();
  // sqrt-scaled: circumference (~ring) grows with sqrt(count) so a ring's
  // siblings get roughly constant arc-spacing as the tree gets bushier.
  const RING = NET.ring = Math.round(Math.min(260, Math.max(64, 58 + Math.sqrt(n) * 11)));
  const PAD = Math.round(RING * 0.6);
  NET.nodeScale = n <= 20 ? 1 : n <= 80 ? 0.88 : n <= 250 ? 0.76 : 0.62;
  const clusters = [];
  for (const rootId of REF_GRAPH.roots) {
    if (REF_COORDS.has(rootId)) continue; // cycle fallback can list linked roots
    let maxDepth = 0;
    const placed = [];
    function place(id, level, angle0, angle1, seen) {
      if (seen.has(id) || REF_COORDS.has(id)) return;
      seen.add(id);
      maxDepth = Math.max(maxDepth, level);
      const mid = (angle0 + angle1) / 2;
      const r = level * RING;
      placed.push({ id, level, angle: mid, r });
      REF_COORDS.set(id, { level, rootId, angle: mid, radius: r, x: 0, y: 0 });
      if (NET.collapsed.has(id)) return;
      const kids = REF_GRAPH.nodes.get(id).children.filter(c => !seen.has(c) && !REF_COORDS.has(c));
      if (!kids.length) return;
      const weights = kids.map(c => subtreeLeafCount(c, new Set(seen)));
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      // level-1 children of a root get the full circle; deeper levels stay in
      // the parent's wedge so branches never cross
      const span = level === 0 ? Math.PI * 2 : (angle1 - angle0);
      const start = level === 0 ? -Math.PI / 2 : angle0;
      let acc = 0;
      kids.forEach((c, i) => {
        const a0 = start + (acc / total) * span;
        acc += weights[i];
        const a1 = start + (acc / total) * span;
        place(c, level + 1, a0, a1, seen);
      });
    }
    place(rootId, 0, 0, Math.PI * 2, new Set());
    const radius = Math.max(1, maxDepth) * RING + PAD;
    clusters.push({ rootId, radius, ids: placed.map(p => p.id) });
  }
  // pack cluster centers left-to-right, wrap into rows to keep balance
  let cx = 0, cy = 0, rowH = 0, maxW = 1200, xCursor = 0;
  const centers = new Map();
  for (const cl of clusters) {
    const d = cl.radius * 2;
    if (xCursor > 0 && xCursor + d > maxW) { cy += rowH + 40; xCursor = 0; rowH = 0; }
    centers.set(cl.rootId, { x: xCursor + cl.radius, y: cy + cl.radius });
    xCursor += d + 60;
    rowH = Math.max(rowH, d);
  }
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const [id, c] of REF_COORDS) {
    // c.rootId was set once by the closure-captured rootId at the top of
    // this node's place() traversal - use it directly. A parentId re-walk
    // (the previous approach) breaks down on a referral cycle: two different
    // members of the very same connected component could resolve to two
    // different (and sometimes non-existent) center keys, scattering one
    // cohesive cluster across the canvas.
    const ctr = centers.get(c.rootId) || { x: 0, y: 0 };
    c.x = ctr.x + Math.cos(c.angle) * c.radius;
    c.y = ctr.y + Math.sin(c.angle) * c.radius;
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }
  const M = 84;
  for (const c of REF_COORDS.values()) { c.x += M - minX; c.y += M - minY; }
  NET.size = { w: (maxX - minX) + M * 2, h: (maxY - minY) + M * 2 };
}

function edgePath(p, c) {
  // gentle organic bow perpendicular to the segment
  const dx = c.x - p.x, dy = c.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const bow = Math.min(26, len * 0.16);
  const mx = (p.x + c.x) / 2 + nx * bow, my = (p.y + c.y) / 2 + ny * bow;
  return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
}

function nodeTier(node, level) {
  const s = NET.nodeScale;
  if (level === 0 && node.children.length) return { r: Math.round(26 * s), cls: 'tier-root' };
  if (node.children.length) return { r: Math.round(21 * s), cls: 'tier-mid' };
  return { r: Math.round(16 * s), cls: 'tier-leaf' };
}
function nodeEarned(node) {
  const rewardedOut = node.children.filter(cid => REF_GRAPH.nodes.get(cid)?.edge?.reward_granted).length;
  return rewardedOut * (REF.rewardDays || 30);
}
function chainToRoot(id) {
  const ids = [id];
  let cur = REF_GRAPH.nodes.get(id);
  const seen = new Set([id]);
  while (cur?.parentId && !seen.has(cur.parentId)) {
    ids.push(cur.parentId);
    seen.add(cur.parentId);
    cur = REF_GRAPH.nodes.get(cur.parentId);
  }
  return ids;
}

function netTipHtml(id) {
  const node = REF_GRAPH.nodes.get(id);
  const u = userLookup(id);
  const meta = statusMeta(u.status);
  const earned = nodeEarned(node);
  const c = REF_COORDS.get(id);
  const rows = [
    ['Plan', meta.text],
    ['Joined', fmtDate(u.created_at)],
    ['Referrals', String(node.children.length)],
    ['Level', c ? (c.level === 0 ? 'Root referrer' : `Depth ${c.level}`) : ''],
  ];
  if (earned) rows.push(['Earned', `+${earned}d Pro`]);
  if (node.edge) rows.push(['Referral', node.edge.reward_granted ? 'Rewarded' : 'Pending']);
  return `<div class="tip-title">${esc(u.name || u.email)}</div><div class="tip-sub">${esc(u.email)}</div>` +
    rows.map(([k, v]) => `<div class="tip-row"><span>${k}</span><strong>${esc(v)}</strong></div>`).join('');
}

function renderReferralNetwork(animate = false) {
  const wrap = document.getElementById('refNetworkWrap');
  if (!REF.edges.length) { wrap.innerHTML = '<div class="empty">No referrals yet. They will appear here once users start referring each other.</div>'; return; }

  REF_GRAPH = buildReferralGraph(REF.edges);
  const oldPos = animate && REF_COORDS ? new Map([...REF_COORDS].map(([id, c]) => [id, { x: c.x, y: c.y }])) : null;
  layoutRadial();

  let edgesSvg = '', particlesSvg = '', nodesSvg = '';
  let pi = 0;
  for (const [id, node] of REF_GRAPH.nodes) {
    if (!netVisible(id)) continue;
    const c = REF_COORDS.get(id);
    if (!c || !node.parentId || !netVisible(node.parentId)) continue;
    const p = REF_COORDS.get(node.parentId);
    if (!p) continue;
    const granted = !!node.edge?.reward_granted;
    const d = edgePath(p, c);
    const depthOp = Math.max(0.45, 0.95 - c.level * 0.16);
    edgesSvg += `<path id="refp-${id}" class="net-edge ${granted ? 'granted' : 'pending'}" data-child="${id}" data-root="${c.rootId}"
      d="${d}" style="opacity:${depthOp}"
      onmouseenter="netEdgeTip(event,'${id}')" onmouseleave="hideTip()"></path>`;
    if (granted && !NET.reduced) {
      const dur = (2.4 + (pi % 4) * 0.5).toFixed(1);
      particlesSvg += `<circle class="net-particle" data-root="${c.rootId}" data-child="${id}" r="2.4">
        <animateMotion dur="${dur}s" begin="${(pi * 0.55).toFixed(2)}s" repeatCount="indefinite"><mpath href="#refp-${id}"/></animateMotion>
      </circle>`;
      pi++;
    }
  }
  let ni = 0;
  for (const [id, node] of REF_GRAPH.nodes) {
    if (!netVisible(id)) continue;
    const c = REF_COORDS.get(id);
    if (!c) continue;
    const u = userLookup(id);
    const meta = statusMeta(u.status);
    const tier = nodeTier(node, c.level);
    const earned = nodeEarned(node);
    const collapsed = NET.collapsed.has(id);
    const hidden = collapsed ? hiddenDescendants(id) : 0;
    const label = (u.name || u.email || '').split(' ')[0] || u.email;
    const pendingIn = node.edge && !node.edge.reward_granted;
    nodesSvg += `<g class="net-node ${tier.cls} ${meta.ring} ${id === NET.focalId ? 'focal' : ''}" data-id="${id}" data-root="${c.rootId}"
        transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)})" style="--float-delay:${(ni % 7) * -1.3}s"
        onclick="onNetworkNodeClick(event,'${id}')"
        onmouseenter="netNodeHover(event,'${id}',true)" onmouseleave="netNodeHover(event,'${id}',false)">
      <g class="net-float">
        <circle class="net-halo" r="${tier.r + 8}"></circle>
        <circle class="net-focal-ring" r="${tier.r + 6}"></circle>
        <circle class="net-body" r="${tier.r}" fill="url(#netGlass)"></circle>
        <text class="net-init" style="font-size:${Math.max(8, Math.round(tier.r * 0.42))}px" y="${Math.max(3, Math.round(tier.r * 0.16))}" text-anchor="middle">${esc(initials(u))}</text>
        ${pendingIn ? `<circle class="net-dot-pending" cx="${tier.r * 0.72}" cy="${tier.r * 0.72}" r="3.2"></circle>` : ''}
        ${earned ? `<g transform="translate(${tier.r - 2},${-tier.r - 6})"><rect class="net-pill" x="-17" y="-8" width="34" height="15" rx="7.5"></rect><text class="net-pill-txt" y="3" text-anchor="middle">+${earned}d</text></g>` : ''}
        ${collapsed ? `<g transform="translate(0,${tier.r + 10})"><rect class="net-more" x="-14" y="-7" width="28" height="14" rx="7"></rect><text class="net-more-txt" y="3" text-anchor="middle">+${hidden}</text></g>` : ''}
        <text class="net-lbl" y="${tier.r + (collapsed ? 26 : 16)}" text-anchor="middle">${esc(label)}</text>
      </g>
      <circle class="net-hit" r="${tier.r + 10}"></circle>
    </g>`;
    ni++;
  }

  wrap.innerHTML = `
  <div class="net-stage" id="netStage">
    <svg class="net-svg" id="netSvg" viewBox="0 0 ${NET.size.w} ${NET.size.h}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="netGlass" cx="38%" cy="34%" r="75%">
          <stop offset="0%" stop-color="#1c2b23"/>
          <stop offset="100%" stop-color="#101a15"/>
        </radialGradient>
        <linearGradient id="netEdgeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="rgba(0,255,136,.12)"/>
          <stop offset="55%" stop-color="rgba(25,195,125,.5)"/>
          <stop offset="100%" stop-color="rgba(0,255,136,.75)"/>
        </linearGradient>
        <marker id="netArrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 Z" fill="rgba(120,150,135,.65)"></path>
        </marker>
      </defs>
      <g id="netViewport">${edgesSvg}${particlesSvg}${nodesSvg}</g>
    </svg>
    <div class="net-ctrl">
      <button class="net-ctrl-btn" onclick="netZoom(1.25)" title="Zoom in"><i class="fa-solid fa-plus"></i></button>
      <button class="net-ctrl-btn" onclick="netZoom(0.8)" title="Zoom out"><i class="fa-solid fa-minus"></i></button>
      <button class="net-ctrl-btn" onclick="netResetView()" title="Fit"><i class="fa-solid fa-expand"></i></button>
    </div>
  </div>
  <div class="net-legend">
    <span><i class="net-ring-good"></i>Pro (active)</span>
    <span><i class="net-ring-warn"></i>Expiring / grace</span>
    <span><i class="net-ring-bad"></i>Expired</span>
    <span><i class="net-ring-muted"></i>Free</span>
    <span class="net-legend-sep"></span>
    <span><i class="net-edge-swatch granted"></i>Rewarded flow</span>
    <span><i class="net-edge-swatch pending"></i>Pending</span>
    <span class="net-legend-sep"></span>
    <span class="hint">scroll to zoom · drag to pan · click a referrer to collapse</span>
  </div>`;

  netFitStage();
  netBindViewport();
  netApplyView();
  netRestoreSelectionStyles();

  // FLIP: glide nodes from their previous coordinates to the new layout
  if (oldPos && !NET.reduced) {
    document.querySelectorAll('#netViewport .net-node').forEach(el => {
      const prev = oldPos.get(el.dataset.id);
      const now = REF_COORDS.get(el.dataset.id);
      if (!prev || !now) return;
      const ddx = prev.x - now.x, ddy = prev.y - now.y;
      if (Math.abs(ddx) < 1 && Math.abs(ddy) < 1) return;
      el.animate(
        [{ transform: `translate(${now.x + ddx}px,${now.y + ddy}px)` }, { transform: `translate(${now.x}px,${now.y}px)` }],
        { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)' });
    });
    document.querySelectorAll('#netViewport .net-edge').forEach(el =>
      el.animate([{ opacity: 0 }, { opacity: el.style.opacity || 1 }], { duration: 420, easing: 'ease-out' }));
  }
}

// Shape the stage's own aspect ratio to match the content's bounding box
// (computed in layoutRadial), so preserveAspectRatio="meet" has nothing to
// letterbox - a 3-node tree gets a short stage, a sprawling one gets a tall
// one, both filled edge-to-edge. Then nudge the initial zoom a touch by tree
// size: small trees read better slightly zoomed in, huge ones need room to
// breathe beyond the tight fit.
function netFitStage() {
  const svg = document.getElementById('netSvg');
  const stage = document.getElementById('netStage');
  if (!svg || !stage) return;
  // Size the SVG from its own content bounding box (not from the card's
  // width) so a compact tree renders as a compact, centered box instead of
  // stretching to fill a full-width card. Large trees grow toward the
  // card's available width/height caps; tiny ones upscale a bit so they
  // don't render as a speck.
  const availW = Math.max(280, stage.clientWidth - 28);
  const MIN_DIM = 200, MAX_H = 560, MAX_SCALE = 1.6;
  const w0 = Math.max(1, NET.size.w), h0 = Math.max(1, NET.size.h);
  // Cap how far we'll upscale sparse content: a 1-2 node graph has a small,
  // mostly-empty bounding box (the margin dominates it), so chasing the
  // height cap would blow a single circle up to fill 560px of empty box -
  // the opposite of "compact." MAX_SCALE keeps a lone/small cluster modest;
  // MIN_DIM only pushes past it if the content is so tiny that legibility
  // would otherwise suffer.
  let scale = Math.min(availW / w0, MAX_H / h0, MAX_SCALE);
  if (Math.max(w0, h0) * scale < MIN_DIM) scale = Math.min(MIN_DIM / Math.max(w0, h0), availW / w0, MAX_H / h0);
  svg.style.width = Math.round(w0 * scale) + 'px';
  svg.style.height = Math.round(h0 * scale) + 'px';
  const n = countVisibleNodes();
  const tierK = n <= 10 ? 1.12 : n <= 50 ? 1 : n <= 200 ? 0.9 : 0.78;
  // Scale about the viewBox center (not the origin) so a non-1 tier zoom
  // doesn't drag the content toward the top-left corner.
  NET.baseView = { tx: NET.size.w / 2 * (1 - tierK), ty: NET.size.h / 2 * (1 - tierK), k: tierK };
  NET.view = { ...NET.baseView };
}

// ── selection: a clicked/hovered user's full upstream + downstream chain ──
// (replaces an earlier "dim everything outside this root cluster" scheme -
// that made large branches hard to read; this highlights the exact
// relationship path instead and only lightly fades the rest.)
function descendantsOf(id, seen = new Set()) {
  const node = REF_GRAPH.nodes.get(id);
  if (!node || seen.has(id)) return [];
  seen.add(id);
  let out = [];
  for (const c of node.children) { out.push(c); out = out.concat(descendantsOf(c, seen)); }
  return out;
}
function relatedSetOf(id) {
  return new Set([...chainToRoot(id), ...descendantsOf(id)]);
}
function netApplySelectionStyles(transientSet) {
  const svg = document.getElementById('netSvg');
  if (!svg) return;
  const set = transientSet || NET.selectedSet;
  const active = !!set;
  svg.classList.toggle('selecting', active);
  svg.querySelectorAll('.net-node').forEach(el => {
    el.classList.toggle('focal', !transientSet && el.dataset.id === NET.focalId);
    el.classList.toggle('hl', active && set.has(el.dataset.id));
  });
  svg.querySelectorAll('.net-edge, .net-particle').forEach(el => el.classList.toggle('hl', active && set.has(el.dataset.child)));
}
// Re-applies whatever the persistent selection is (or clears to neutral) -
// used both after a fresh render and to restore state once a hover ends.
function netRestoreSelectionStyles() { netApplySelectionStyles(); }
function netSelect(id) {
  NET.focalId = id;
  NET.selectedSet = relatedSetOf(id);
  netRestoreSelectionStyles();
  netCenterOn(id);
}
function netClearSelection() {
  NET.focalId = null;
  NET.selectedSet = null;
  netRestoreSelectionStyles();
}

// ── hover: transient preview of a node's chain; reverts to the sticky
// selection (or neutral) on mouseleave rather than always clearing ──
function netNodeHover(e, id, on) {
  const svg = document.getElementById('netSvg');
  if (!svg) return;
  if (on) {
    showTip(e, netTipHtml(id));
    netApplySelectionStyles(relatedSetOf(id));
  } else {
    hideTip();
    netRestoreSelectionStyles();
  }
}
function netEdgeTip(e, childId) {
  const node = REF_GRAPH.nodes.get(childId);
  const granted = !!node?.edge?.reward_granted;
  showTip(e, `<div class="tip-row"><span>${esc(fmtDate(node?.edge?.created_at))}</span><strong>${granted ? 'Rewarded · +' + (REF.rewardDays || 30) + 'd' : 'Pending'}</strong></div>`);
}

// ── interactions ──
function onNetworkNodeClick(e, id) {
  e.stopPropagation();
  hideTip();
  const node = REF_GRAPH.nodes.get(id);
  netSelect(id);
  if (node.children.length) {
    if (NET.collapsed.has(id)) NET.collapsed.delete(id); else NET.collapsed.add(id);
    renderReferralNetwork(true);
  }
}
async function goToReferralsAndFocus(userId) {
  goToView('referrals');
  if (!REF) await loadReferrals();
  netSelect(userId);
}

// ── zoom / pan (transform on the viewport group) ──
function netApplyView() {
  const vp = document.getElementById('netViewport');
  if (vp) vp.setAttribute('transform', `translate(${NET.view.tx} ${NET.view.ty}) scale(${NET.view.k})`);
}
function netZoom(factor, cx, cy) {
  const svg = document.getElementById('netSvg');
  if (!svg) return;
  const k = Math.min(4, Math.max(0.35, NET.view.k * factor));
  // zoom toward (cx,cy) in svg user units; default = center of current view
  if (cx == null) {
    const vb = svg.viewBox.baseVal;
    cx = vb.width / 2; cy = vb.height / 2;
  }
  const scale = k / NET.view.k;
  NET.view.tx = cx - (cx - NET.view.tx) * scale;
  NET.view.ty = cy - (cy - NET.view.ty) * scale;
  NET.view.k = k;
  netApplyView();
}
function netResetView() { NET.view = { ...NET.baseView }; netApplyView(); }
function netCenterOn(id) {
  const c = REF_COORDS?.get(id);
  const svg = document.getElementById('netSvg');
  if (!c || !svg) return;
  const vb = svg.viewBox.baseVal;
  const k = Math.max(NET.view.k, 1);
  NET.view = { k, tx: vb.width / 2 - c.x * k, ty: vb.height / 2 - c.y * k };
  netApplyView();
}
function netSvgPoint(svg, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  // preserveAspectRatio=meet: uniform scale, content centered
  const s = Math.min(rect.width / vb.width, rect.height / vb.height);
  const ox = (rect.width - vb.width * s) / 2, oy = (rect.height - vb.height * s) / 2;
  return { x: (clientX - rect.left - ox) / s, y: (clientY - rect.top - oy) / s };
}
function netBindViewport() {
  const svg = document.getElementById('netSvg');
  const stage = document.getElementById('netStage');
  if (!svg) return;
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const pt = netSvgPoint(svg, e.clientX, e.clientY);
    netZoom(e.deltaY < 0 ? 1.18 : 0.85, pt.x, pt.y);
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    // A press that starts on a node is a click (focus/collapse), not a pan -
    // capturing the pointer here would steal the node's click event.
    if (e.target.closest?.('.net-node')) return;
    drag = { x: e.clientX, y: e.clientY, tx: NET.view.tx, ty: NET.view.ty, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const s = Math.min(rect.width / vb.width, rect.height / vb.height);
    const dx = (e.clientX - drag.x) / s, dy = (e.clientY - drag.y) / s;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    NET.view.tx = drag.tx + dx; NET.view.ty = drag.ty + dy;
    netApplyView();
    if (drag.moved) stage.classList.add('grabbing');
  });
  const end = e => {
    if (drag && !drag.moved && (e.target === svg || e.target.id === 'netViewport')) netClearSelection();
    drag = null;
    stage.classList.remove('grabbing');
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', () => { drag = null; stage.classList.remove('grabbing'); });
}

function renderReferrerList() {
  const wrap = document.getElementById('refListWrap');
  const byReferrer = new Map();
  for (const e of REF.edges) {
    if (!byReferrer.has(e.referrer_id)) byReferrer.set(e.referrer_id, []);
    byReferrer.get(e.referrer_id).push(e);
  }
  const rows = [...byReferrer.entries()].map(([id, edges]) => {
    const u = userLookup(id);
    const rewarded = edges.filter(e => e.reward_granted).length;
    return { id, u, count: edges.length, rewarded, pending: edges.length - rewarded, earned: rewarded * (REF.rewardDays || 30) };
  }).sort((a, b) => b.earned - a.earned || b.count - a.count);
  if (!rows.length) { wrap.innerHTML = '<div class="empty">No referrers yet.</div>'; return; }
  wrap.innerHTML = `<table><thead><tr><th>Referrer</th><th>Plan</th><th class="num">Referred</th><th class="num">Rewarded</th><th class="num">Pending</th><th class="num">Days earned</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="ref-row" onclick="netSelect('${r.id}')">
      <td><div class="u-name">${esc(r.u.name || r.u.email)}</div><div class="u-email">${esc(r.u.email)}</div></td>
      <td>${badgeFor(r.u)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${r.rewarded}</td>
      <td class="num">${r.pending}</td>
      <td class="num pos">+${r.earned}d</td>
    </tr>`).join('')}
  </tbody></table>`;
}

// ── analytics ────────────────────────────────────────────────
async function loadAnalytics() {
  const wrap = document.getElementById('analyticsWrap');
  wrap.innerHTML = `<div class="tiles">${skelTiles(4)}</div><div class="card">${loadingBlock('Crunching events…')}</div>`;
  let a;
  try { a = await api('/api/analytics?days=' + document.getElementById('daysSel').value); }
  catch (e) { wrap.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
  if (a.missingTable) { wrap.innerHTML = `<div class="err-box">${esc(a.message)}</div>`; return; }

  const maxDaily = Math.max(1, ...a.daily.map(d => d.users));
  const cols = a.daily.map(d => {
    const h = Math.round((d.users / maxDaily) * 100);
    return `<div class="col ${d.users ? '' : 'zero'}" style="height:${Math.max(h, d.users ? 4 : 0)}%"
      onmouseenter="showTip(event,'<span class=t-lbl>${d.day}</span><strong>${d.users}</strong> active user${d.users === 1 ? '' : 's'}')"
      onmouseleave="hideTip()"></div>`;
  }).join('');
  const n = a.daily.length;
  const xlabels = a.daily.map((d, i) =>
    `<span>${(i === 0 || i === n - 1 || i === Math.floor(n / 2)) ? d.day.slice(5) : ''}</span>`).join('');

  const maxVisits = Math.max(1, ...a.visitsByPage.map(v => v.n));
  const hbars = a.visitsByPage.length ? a.visitsByPage.map(v => `
    <div class="hbar-row"
      onmouseenter="showTip(event,'<span class=t-lbl>${esc(v.page)}</span><strong>${v.n}</strong> visits')" onmouseleave="hideTip()">
      <div class="hbar-lbl">${esc(v.page)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, Math.round(v.n / maxVisits * 100))}%"></div></div>
      <div class="hbar-val">${v.n}</div>
    </div>`).join('') : '<div class="empty">No page visits recorded yet.</div>';

  const eventRows = a.byType.map(t => `<tr><td>${esc(t.event)}</td><td class="num">${t.n}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No events yet</td></tr>';
  const userMap = new Map(USERS.map(u => [u.id, u.email]));
  const topRows = a.topUsers.map(t => `<tr><td class="email">${esc(userMap.get(t.user_id) || t.user_id)}</td><td class="num">${t.n}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No activity yet</td></tr>';

  wrap.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="tile-lbl">Active today</div><div class="tile-val pos">${a.dauToday}</div><div class="tile-sub">distinct users</div></div>
      <div class="tile"><div class="tile-lbl">Active this week</div><div class="tile-val">${a.wau}</div><div class="tile-sub">distinct users, 7 days</div></div>
      <div class="tile"><div class="tile-lbl">Events today</div><div class="tile-val">${a.eventsToday}</div></div>
      <div class="tile"><div class="tile-lbl">Events (${a.days || document.getElementById('daysSel').value}d)</div><div class="tile-val">${a.totalEvents}</div></div>
    </div>
    <div class="card">
      <div class="card-hdr"><h3>Daily active users</h3><span class="hint">distinct users with any event per day</span></div>
      <div class="card-body"><div class="cols">${cols}</div><div class="cols-x">${xlabels}</div></div>
    </div>
    <div class="chart-grid">
      <div class="card">
        <div class="card-hdr"><h3>Visits by page</h3><span class="hint">page_visit events</span></div>
        <div class="card-body"><div class="hbars">${hbars}</div></div>
      </div>
      <div class="card">
        <div class="card-hdr"><h3>Events by type</h3></div>
        <div class="tw"><table style="min-width:0"><thead><tr><th>Event</th><th class="num">Count</th></tr></thead><tbody>${eventRows}</tbody></table></div>
      </div>
    </div>
    <div class="card">
      <div class="card-hdr"><h3>Most active users</h3></div>
      <div class="tw"><table style="min-width:0"><thead><tr><th>User</th><th class="num">Events</th></tr></thead><tbody>${topRows}</tbody></table></div>
    </div>`;
}

// ── reports ──────────────────────────────────────────────────
async function loadReports(btn) {
  const wrap = document.getElementById('reportsWrap');
  // Reports also loads at boot to fill the nav counter, while the Users view is
  // on screen - only paint the spinner when its own view is actually visible.
  if (document.getElementById('view-reports').classList.contains('active')) {
    wrap.innerHTML = `<div class="card">${loadingBlock('Loading messages…')}</div>`;
  }
  let r;
  try { r = await (btn ? withBtnBusy(btn, () => api('/api/reports')) : api('/api/reports')); }
  catch (e) { wrap.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
  if (r.missingTable) { wrap.innerHTML = `<div class="err-box">${esc(r.message)}</div>`; return; }

  const newCount = r.messages.filter(m => m.status === 'new').length;
  const cnt = document.getElementById('newCnt');
  cnt.style.display = newCount ? '' : 'none';
  cnt.textContent = newCount;

  if (!r.messages.length) { wrap.innerHTML = '<div class="card"><div class="empty">No support messages yet. They will appear here when users send feedback from /support in the app.</div></div>'; return; }

  wrap.innerHTML = `<div class="card">` + r.messages.map(m => `
    <div class="report" id="rep-${m.id}">
      <div class="report-row" onclick="document.getElementById('rep-${m.id}').classList.toggle('open')">
        <span class="badge ${m.status}">${m.status}</span>
        <div style="min-width:0;flex:1">
          <div class="report-subj">${esc(m.subject)}</div>
          <div class="report-snip">${esc(m.message)}</div>
        </div>
        <div class="report-meta">
          <span class="badge ${m.sender_status?.label === 'free' ? 'free' : 'pro'}">${m.sender_status?.label === 'free' ? 'Free' : 'Pro'}</span>
          <span>${esc(m.sender_name || m.sender_email || m.user_id)}</span>
          <span>${fmtDateTime(m.created_at)}</span>
        </div>
      </div>
      <div class="report-body">
        <div class="report-full">${esc(m.message)}</div>
        <div style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--muted)">
          <span>${esc(m.sender_email || '')}</span>
          <span style="flex:1"></span>
          Status:
          <select class="btn" onchange="setStatus('${m.id}', this.value, this)">
            ${['new', 'read', 'resolved'].map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>`).join('') + `</div>`;
}

async function setStatus(id, status, sel) {
  if (sel) sel.disabled = true;
  try { await api(`/api/reports/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); loadReports(); }
  catch (e) { if (sel) sel.disabled = false; alert('Update failed: ' + e.message); }
}

// ── deleted accounts ─────────────────────────────────────────
let DELETED = [];
async function loadDeleted(btn) {
  const body = document.getElementById('deletedBody');
  const sub = document.getElementById('deletedSub');
  try {
    const { users } = await (btn ? withBtnBusy(btn, () => api('/api/deleted-users')) : api('/api/deleted-users'));
    DELETED = users;
    sub.textContent = users.length
      ? `${users.length} deleted account${users.length === 1 ? '' : 's'}. Login is blocked; data is kept until you purge it.`
      : 'Accounts users deleted themselves. Login is blocked; data is kept until you purge it.';
    renderDeleted();
  } catch (e) {
    body.innerHTML = `<tr><td colspan="9"><div class="err-box">Could not load deleted accounts: ${esc(e.message)}</div></td></tr>`;
  }
}
function renderDeleted() {
  const body = document.getElementById('deletedBody');
  if (!DELETED.length) { body.innerHTML = '<tr><td colspan="9" class="empty">No deleted accounts.</td></tr>'; return; }
  body.innerHTML = DELETED.map(u => `
    <tr data-id="${u.id}">
      <td>
        <div class="u-cell">
          <div class="u-avatar">${esc(initials(u))}</div>
          <div class="u-info">
            <div class="u-name">${esc(u.name || '(no name)')}</div>
            <div class="u-email" onclick="copyEmail(event,'${esc(u.email)}')" title="Click to copy">${esc(u.email)}</div>
          </div>
        </div>
      </td>
      <td><span class="badge ${u.plan === 'pro' ? 'pro' : 'free'}">${u.plan === 'pro' ? 'Pro' : 'Free'}</span></td>
      <td class="num">${u.journals}</td>
      <td class="num">${u.trades}</td>
      <td class="num">${u.images}</td>
      <td class="num date">${fmtDate(u.created_at)}</td>
      <td class="num date">${fmtDate(u.last_sign_in_at)}</td>
      <td class="num date">${fmtDate(u.deleted_at)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm danger" onclick="purgeUser('${u.id}', this)">Delete permanently</button>
      </td>
    </tr>`).join('');
}
async function purgeUser(id, btn) {
  const u = DELETED.find(x => x.id === id);
  if (!u) return;
  const typed = prompt(`This permanently erases ALL data for this account — journals, trades, images, referrals — and cannot be undone.\n\nType the user's email to confirm:\n${u.email}`);
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== (u.email || '').toLowerCase()) { alert('Email did not match. Nothing was deleted.'); return; }
  try {
    await withBtnBusy(btn, () => api(`/api/users/${id}/purge`, { method: 'POST' }));
    await loadDeleted();
  } catch (e) { alert('Purge failed: ' + e.message); }
}

// ── boot ─────────────────────────────────────────────────────
(() => {
  // Fire all three in parallel: /api/me only decides the MOCK badge, so making
  // the user list wait on it just delays the first paint. A 401 in any of them
  // redirects to login anyway.
  api('/api/me')
    .then(me => { if (me.mock) document.getElementById('mockBadge').style.display = ''; })
    .catch(() => { /* redirected to login */ });
  loadUsers();
  loadReports(); // populate the new-message counter
})();
