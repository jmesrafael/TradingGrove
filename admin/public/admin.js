// TradingGrove local admin UI. No framework: fetch + render.

let USERS = [];
let grantTarget = null;

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
document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + btn.dataset.view));
  if (btn.dataset.view === 'analytics') loadAnalytics();
  if (btn.dataset.view === 'reports') loadReports();
}));

// ── users ────────────────────────────────────────────────────
function badgeFor(u) {
  const l = u.status?.label || (u.plan === 'pro' ? 'pro' : 'free');
  const txt = { 'pro-lifetime': 'Pro · Lifetime', pro: 'Pro', expiring: `Pro · ${u.status.daysLeft}d left`, grace: 'Grace', expired: 'Expired', free: 'Free' }[l] || l;
  return `<span class="badge ${l}">${esc(txt)}</span>`;
}

function renderUsers() {
  const q = document.getElementById('userSearch').value.trim().toLowerCase();
  const rows = USERS.filter(u => !q || [u.email, u.name, u.plan, u.plan_type, u.status?.label].join(' ').toLowerCase().includes(q));
  const body = document.getElementById('usersBody');
  if (!rows.length) { body.innerHTML = '<tr><td colspan="13" class="empty">No users match.</td></tr>'; return; }
  body.innerHTML = rows.map(u => `
    <tr data-id="${u.id}">
      <td class="email">${esc(u.email)}</td>
      <td>${esc(u.name || '—')}</td>
      <td>${badgeFor(u)}</td>
      <td>${esc(u.plan_type)}${u.queued ? ' · queued' : ''}</td>
      <td>${u.plan_type === 'lifetime' ? 'never' : fmtDate(u.subscription_expires_at)}</td>
      <td>${esc(u.payment_gateway || '—')}</td>
      <td class="num">${u.journals}</td>
      <td class="num">${u.trades}</td>
      <td class="num">${u.images}</td>
      <td class="storage-cell" id="st-${u.id}"><button class="btn" onclick="loadStorage('${u.id}')">Compute</button></td>
      <td>${fmtDate(u.created_at)}</td>
      <td>${fmtDate(u.last_sign_in_at)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn" onclick="openGrant('${u.id}')">Grant Pro</button>
        ${u.plan === 'pro' ? `<button class="btn danger" onclick="revoke('${u.id}')">Revoke</button>` : ''}
      </td>
    </tr>`).join('');
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
    renderUsers();
    sub.textContent = `${users.length} signed-up user${users.length === 1 ? '' : 's'}`;
  } catch (e) {
    sub.textContent = '';
    document.getElementById('usersBody').innerHTML = `<tr><td colspan="13"><div class="err-box">Could not load users: ${esc(e.message)}<br>Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in admin/.env, or run with MOCK=1.</div></td></tr>`;
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
