// TradingGrove local admin UI. No framework: fetch + render.

let USERS = [];
let grantTarget = null;
let REF = null; // { edges, rewardDays } once loaded
let sortKey = 'created_at';
let sortDir = 'desc';
let activeChip = 'all';
let focusedClusterId = null; // referrer (root) user id currently focused in the network view

// ── plumbing ─────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (res.status === 401) { location.href = '/'; throw new Error('session expired'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
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
        <button class="btn btn-sm" onclick="openGrant('${u.id}')">Grant</button>
        ${u.plan === 'pro' ? `<button class="btn btn-sm danger" onclick="revoke('${u.id}')">Revoke</button>` : ''}
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

async function loadUsers(refresh) {
  const sub = document.getElementById('usersSub');
  sub.textContent = 'Loading…';
  try {
    const { users } = await api('/api/users' + (refresh ? '?refresh=1' : ''));
    USERS = users;
    renderUserTiles();
    renderChips();
    renderUsers();
    sub.textContent = `${users.length} signed-up user${users.length === 1 ? '' : 's'}`;
  } catch (e) {
    sub.textContent = '';
    document.getElementById('usersBody').innerHTML = `<tr><td colspan="10"><div class="err-box">Could not load users: ${esc(e.message)}<br>Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in admin/.env, or run with MOCK=1.</div></td></tr>`;
  }
}
document.getElementById('userSearch').addEventListener('input', renderUsers);

async function loadStorage(id) {
  const cell = document.getElementById('st-' + id);
  cell.textContent = '…';
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
  msg.className = 'm-msg'; msg.textContent = 'Granting…';
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

async function revoke(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Revoke Pro from ${u.email}? They drop to the Free plan immediately (data is kept).`)) return;
  try { await api(`/api/users/${id}/revoke`, { method: 'POST' }); await loadUsers(true); }
  catch (e) { alert('Revoke failed: ' + e.message); }
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
  let roots = [...nodes.values()].filter(n => n.parentId === null).map(n => n.id);
  if (!roots.length && nodes.size) {
    // Every node has a parent - only possible with a referral cycle (e.g. two
    // users who each "referred" the other). Fall back to "anyone who referred
    // someone" as a root; layoutGraph's visited-set still prevents duplicate
    // placement, it just breaks the cycle at an arbitrary point instead of
    // crashing with zero levels (which produced a negative SVG viewBox).
    roots = [...nodes.values()].filter(n => n.children.length > 0).map(n => n.id);
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

async function loadReferrals() {
  const netWrap = document.getElementById('refNetworkWrap');
  const listWrap = document.getElementById('refListWrap');
  netWrap.innerHTML = '<div class="empty">Loading…</div>';
  listWrap.innerHTML = '<div class="empty">Loading…</div>';
  try { REF = await api('/api/referrals'); }
  catch (e) { netWrap.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; listWrap.innerHTML = ''; return; }
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

function renderReferralNetwork() {
  const wrap = document.getElementById('refNetworkWrap');
  if (!REF.edges.length) { wrap.innerHTML = '<div class="empty">No referrals yet. They will appear here once users start referring each other.</div>'; return; }

  REF_GRAPH = buildReferralGraph(REF.edges);
  const levels = layoutGraph(REF_GRAPH);
  const colW = 190, rowH = 72, marginX = 60, marginY = 46, r = 20;
  REF_COORDS = new Map();
  levels.forEach((levelNodes, li) => levelNodes.forEach((n, i) => {
    REF_COORDS.set(n.id, { x: marginX + li * colW, y: marginY + i * rowH, level: li, rootId: n.rootId });
  }));
  const maxLevel = Math.max(0, levels.length - 1);
  const maxRows = Math.max(1, ...levels.map(l => l.length));
  const width = marginX * 2 + maxLevel * colW + r * 2;
  const height = marginY * 2 + Math.max(0, maxRows - 1) * rowH + r * 2;

  let edgesSvg = '', nodesSvg = '';
  for (const [id, node] of REF_GRAPH.nodes) {
    const c = REF_COORDS.get(id);
    if (!c || !node.parentId || !REF_COORDS.has(node.parentId)) continue;
    const p = REF_COORDS.get(node.parentId);
    const granted = !!node.edge?.reward_granted;
    edgesSvg += `<line class="net-edge ${granted ? 'granted' : 'pending'}" data-root="${p.rootId}"
      x1="${p.x + r}" y1="${p.y}" x2="${c.x - r - 6}" y2="${c.y}"
      onmouseenter="showTip(event,'<span class=t-lbl>${esc(fmtDate(node.edge?.created_at))}</span><strong>${granted ? 'Rewarded' : 'Pending'}</strong>')" onmouseleave="hideTip()"></line>`;
  }
  for (const [id, node] of REF_GRAPH.nodes) {
    const c = REF_COORDS.get(id);
    if (!c) continue;
    const u = userLookup(id);
    const meta = statusMeta(u.status);
    const rewardedOut = node.children.filter(cid => REF_GRAPH.nodes.get(cid)?.edge?.reward_granted).length;
    const earned = rewardedOut * (REF.rewardDays || 30);
    const nodeR = node.children.length ? r + 2 : r - 2;
    const label = (u.name || u.email || '').split(' ')[0] || u.email;
    nodesSvg += `<g class="net-node" data-id="${id}" data-root="${c.rootId}"
        onclick="onNetworkNodeClick(event,'${c.rootId}')"
        onmouseenter="showTip(event,'<span class=t-lbl>${esc(u.email)}</span><strong>${esc(meta.text)}</strong>${earned ? `<br><span class=t-lbl>Earned</span><strong>+${earned}d Pro</strong>` : ''}')"
        onmouseleave="hideTip()">
      <circle class="${meta.ring}" cx="${c.x}" cy="${c.y}" r="${nodeR}"></circle>
      <text class="net-init" x="${c.x}" y="${c.y + 4}" text-anchor="middle">${esc(initials(u))}</text>
      ${earned ? `<g transform="translate(${c.x + nodeR - 2},${c.y - nodeR - 4})"><rect class="net-pill" x="-17" y="-8" width="34" height="15" rx="7.5"></rect><text class="net-pill-txt" x="0" y="3" text-anchor="middle">+${earned}d</text></g>` : ''}
      <text class="net-lbl" x="${c.x}" y="${c.y + nodeR + 15}" text-anchor="middle">${esc(label)}</text>
    </g>`;
  }
  wrap.innerHTML = `<svg class="net-svg" viewBox="0 0 ${width} ${height}" onclick="if(event.target===this) resetFocus()">${edgesSvg}${nodesSvg}</svg>
  <div class="net-legend">
    <span><i class="net-ring-good"></i>Pro (active)</span>
    <span><i class="net-ring-warn"></i>Expiring / grace</span>
    <span><i class="net-ring-bad"></i>Expired</span>
    <span><i class="net-ring-muted"></i>Free</span>
    <span class="net-legend-sep"></span>
    <span><i class="net-edge-swatch granted"></i>Rewarded</span>
    <span><i class="net-edge-swatch pending"></i>Pending</span>
  </div>`;
  if (focusedClusterId) applyFocusStyles();
}

function onNetworkNodeClick(e, rootId) { e.stopPropagation(); focusCluster(rootId); }
function focusCluster(rootId) { focusedClusterId = rootId; applyFocusStyles(); }
function resetFocus() { focusedClusterId = null; applyFocusStyles(); }
function applyFocusStyles() {
  const svg = document.querySelector('.net-svg');
  if (!svg) return;
  svg.querySelectorAll('.net-node, .net-edge').forEach(el => {
    el.classList.toggle('dim', !!focusedClusterId && el.dataset.root !== focusedClusterId);
  });
}
function findClusterRoot(userId) {
  if (!REF_GRAPH) return userId;
  let cur = REF_GRAPH.nodes.get(userId);
  if (!cur) return userId;
  while (cur.parentId && REF_GRAPH.nodes.has(cur.parentId)) cur = REF_GRAPH.nodes.get(cur.parentId);
  return cur.id;
}
async function goToReferralsAndFocus(userId) {
  goToView('referrals');
  if (!REF) await loadReferrals();
  focusCluster(findClusterRoot(userId));
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
    ${rows.map(r => `<tr class="ref-row" onclick="focusCluster('${r.id}')">
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
  wrap.innerHTML = '<div class="empty">Loading…</div>';
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
async function loadReports() {
  const wrap = document.getElementById('reportsWrap');
  wrap.innerHTML = '<div class="empty">Loading…</div>';
  let r;
  try { r = await api('/api/reports'); }
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
          <select class="btn" onchange="setStatus('${m.id}', this.value)">
            ${['new', 'read', 'resolved'].map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>`).join('') + `</div>`;
}

async function setStatus(id, status) {
  try { await api(`/api/reports/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); loadReports(); }
  catch (e) { alert('Update failed: ' + e.message); }
}

// ── boot ─────────────────────────────────────────────────────
(async () => {
  try {
    const me = await api('/api/me');
    if (me.mock) document.getElementById('mockBadge').style.display = '';
  } catch { /* redirected to login */ }
  loadUsers();
  loadReports(); // populate the new-message counter
})();
