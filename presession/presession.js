// presession.js — checklist sets with scheduled resets
//
// Architecture:
// - Main view is execution-focused: subtle inline Instructions, Bias, Mood,
//   and the active Checklist as the primary surface.
// - All configuration (Instructions text, Mood defaults, Checklist items,
//   Reset Time, set name, deletion) lives in a per-set Session Settings
//   drawer.
// - Each set keeps fully isolated state. Switching sets goes through
//   `switchToSet`, which:
//     1) increments a monotonic loadToken,
//     2) tears down the old realtime sub & pending refresh synchronously,
//     3) clears in-memory state immediately,
//     4) fetches the new set's data,
//     5) refuses to apply the result if the loadToken changed mid-flight.
//   This guarantees that a slow load for set A can never paint over a
//   newer selection of set B.

window.addEventListener('message', e => {
  if (e.data?.type === 'tz_plan' && e.data.isPro !== undefined) userIsPro = e.data.isPro;
});

const jid = sessionStorage.getItem('tz_current_journal')
  || localStorage.getItem('tz_current_journal')
  || (()=>{ try { return parent?.sessionStorage?.getItem('tz_current_journal') || parent?.localStorage?.getItem('tz_current_journal'); } catch(e){return null;} })();

// ─── Globals ────────────────────────────────────────────────────────────────
let currentUser = null, userIsPro = false;
let sets = [];               // [{id, name, description, reset_enabled, reset_time, mood_options, position, ...}]
let activeSetId = null;
let items = [];              // items for active set
let itemState = new Map();   // item_id -> { is_checked, last_reset_at }
let setState = null;         // { session_mood, market_bias, last_reset_at, last_prompted_at }
let setSubs = null, journalSub = null;
let nextResetTimer = null;

// Token-guarded async loads. Every set switch / reload bumps loadToken; any
// in-flight fetch checks it before committing state to globals or DOM.
let loadToken = 0;

// Settings drawer state (the per-set form values being edited).
let settingsOpen = false;
let settingsDirty = false;
let settingsSetId = null;          // id of set the drawer is bound to
let settingsMoodDraft = [];        // mutable copy of mood_options being edited

const DEFAULT_MOODS = ['😊 Calm', '🎯 Focused', '😤 Frustrated', '😰 Anxious', '🤑 Greedy', '😴 Tired', '💪 Confident'];

// ─── Utils ──────────────────────────────────────────────────────────────────
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function fmtTime(t) {
  if (!t) return '00:00';
  const [h, m] = String(t).split(':');
  return `${(h||'00').padStart(2,'0')}:${(m||'00').padStart(2,'0')}`;
}
function nextCycleStart(resetTimeStr) {
  const start = presessionCycleStart(resetTimeStr);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}
function humanCountdown(toDate) {
  const ms = toDate.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 1) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}
function moodsFor(set) {
  const mo = Array.isArray(set?.mood_options) ? set.mood_options : null;
  return (mo && mo.length) ? mo : DEFAULT_MOODS;
}

// ─── Init ───────────────────────────────────────────────────────────────────
(async () => {
  if (!jid) {
    document.body.style.visibility = 'visible';
    showToast('No journal selected.', 'fa-solid fa-triangle-exclamation', 'r');
    return;
  }
  try { userIsPro = parent?._userIsPro || false; } catch(e) {}

  const { data: { user } } = await db.auth.getUser();
  currentUser = user;
  if (user) { const p = await getProfile(user.id); if (p) userIsPro = p.plan === 'pro'; }

  await loadSets();
  document.body.style.visibility = 'visible';

  // Subscribe to set additions/removals at the journal level.
  journalSub = subscribePresessionJournal(jid, async () => {
    const prev = activeSetId;
    sets = await getPresessionSets(jid);
    if (prev && !sets.find(s => s.id === prev)) {
      // Active set was deleted elsewhere → fall back to first set
      const next = sets[0]?.id || null;
      if (next) await switchToSet(next);
      else {
        activeSetId = null;
        renderSetTabs();
        renderEmptyState();
      }
    } else {
      renderSetTabs();
    }
  });
})();

window.addEventListener('beforeunload', () => {
  try { setSubs && db.removeChannel(setSubs); } catch(e) {}
  try { journalSub && db.removeChannel(journalSub); } catch(e) {}
  if (nextResetTimer) clearTimeout(nextResetTimer);
});

// ─── Sets ───────────────────────────────────────────────────────────────────
async function loadSets() {
  sets = await getPresessionSets(jid);
  const initial = sets[0]?.id || null;
  renderSetTabs();
  if (initial) {
    await switchToSet(initial);
  } else {
    activeSetId = null;
    renderEmptyState();
  }
}

function renderEmptyState() {
  document.getElementById('psEmpty').style.display = 'flex';
  document.getElementById('psActive').style.display = 'none';
  document.getElementById('btnResetNow').style.display = 'none';
  document.getElementById('btnSettings').style.display = 'none';
  updateBanner();
  postSummary();
}

function renderSetTabs() {
  const wrap = document.getElementById('setTabs');
  if (!sets.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = sets.map(s => `
    <button class="set-tab${s.id === activeSetId ? ' active' : ''}" onclick="selectSet('${s.id}')">
      <i class="fa-solid fa-list-check"></i> ${esc(s.name)}
    </button>
  `).join('');
}

function selectSet(id) {
  if (id === activeSetId) return;
  // Fire-and-forget; the function itself handles teardown + token-guarded load.
  switchToSet(id);
}

// Single, deterministic entry point for changing the active set.
// Synchronous portion: invalidate prior load, tear down realtime, clear
// in-memory state, mark new id active, render skeleton. Asynchronous portion
// fetches data and only commits if the load token is still current.
async function switchToSet(id) {
  // Synchronous teardown — runs before any await so concurrent switches
  // can't observe the partial state of the previous load.
  try { setSubs && db.removeChannel(setSubs); } catch(e) {}
  setSubs = null;
  if (_refreshT) { clearTimeout(_refreshT); _refreshT = null; }
  if (nextResetTimer) { clearTimeout(nextResetTimer); nextResetTimer = null; }

  // Discard any in-flight loads
  const myToken = ++loadToken;
  activeSetId = id;

  // Wipe stale data so renderers can't paint old set content.
  items = [];
  itemState = new Map();
  setState = null;

  // If the settings drawer was open for a different set, close it (or rebind).
  if (settingsOpen && settingsSetId !== id) {
    closeSettings(/*silent*/true);
  }

  renderSetTabs();
  renderActiveSetSkeleton();

  await loadActiveSet(myToken);
}

// Renders the active container in a "loading" state immediately on switch,
// so the user never sees the previous set's content while the new one loads.
function renderActiveSetSkeleton() {
  const set = sets.find(s => s.id === activeSetId);
  if (!set) { renderEmptyState(); return; }

  document.getElementById('psEmpty').style.display = 'none';
  document.getElementById('psActive').style.display = 'flex';
  document.getElementById('btnResetNow').style.display = '';
  document.getElementById('btnSettings').style.display = '';

  document.getElementById('setNameLabel').textContent = set.name;
  renderInstructions(set.description);

  // Bias / mood: render the configured options but with no active selection
  // (state is unknown until the fetch completes).
  document.querySelectorAll('.bias-btn').forEach(b => b.classList.remove('active'));
  renderMoodChoices(set, /*active*/'');

  // Items: blank with a subtle loading hint.
  document.getElementById('clItems').innerHTML =
    '<div class="ps-empty-inline">Loading…</div>';
  document.getElementById('clProgressFill').style.width = '0%';
  document.getElementById('clProgressLabel').textContent = '— / —';

  updateBanner();
  postSummary();
}

async function loadActiveSet(token) {
  const myToken = token ?? ++loadToken;
  const myId = activeSetId;
  if (!myId) return;

  const set = sets.find(s => s.id === myId);
  if (!set) return;

  let itemsRes, stateRes, setStateRes;
  try {
    [itemsRes, stateRes, setStateRes] = await Promise.all([
      getPresessionItems(myId),
      getPresessionState(myId),
      getPresessionSetState(myId),
    ]);
  } catch (e) {
    if (myToken !== loadToken) return;             // stale load — drop silently
    showToast('Load failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r');
    return;
  }

  // Stale-load guard — a newer switch happened while we were awaiting.
  if (myToken !== loadToken || myId !== activeSetId) return;

  items = itemsRes;
  itemState = new Map(stateRes.map(r => [r.item_id, r]));
  setState = setStateRes || { session_mood: null, market_bias: null, last_reset_at: null, last_prompted_at: null };

  // Auto-reset if the local cycle has rolled over since the last reset.
  if (set.reset_enabled) {
    const cycleStart = presessionCycleStart(set.reset_time);
    const setStale = !setState.last_reset_at || new Date(setState.last_reset_at).getTime() < cycleStart.getTime();
    const anyItemStale = [...itemState.values()].some(s => !s.last_reset_at || new Date(s.last_reset_at).getTime() < cycleStart.getTime());
    if (setStale || anyItemStale) {
      try {
        await resetPresessionCycle(currentUser.id, myId, cycleStart.toISOString());
        if (myToken !== loadToken || myId !== activeSetId) return;
        const [s2, ss2] = await Promise.all([getPresessionState(myId), getPresessionSetState(myId)]);
        if (myToken !== loadToken || myId !== activeSetId) return;
        itemState = new Map(s2.map(r => [r.item_id, r]));
        setState = ss2 || setState;
      } catch (e) {
        console.warn('[presession] auto-reset failed', e);
      }
    }
  }

  // Final guard before installing the realtime subscription.
  if (myToken !== loadToken || myId !== activeSetId) return;
  setSubs = subscribePresessionSet(myId, () => {
    // Only honor changes if we're still on the same set (and the same load).
    if (myToken === loadToken && myId === activeSetId) debouncedRefresh(myToken, myId);
  });

  renderActiveSet();
  if (settingsOpen && settingsSetId === myId) hydrateSettingsForm();
  scheduleNextResetTick();
  postSummary();
}

let _refreshT = null;
function debouncedRefresh(originToken, originId) {
  clearTimeout(_refreshT);
  _refreshT = setTimeout(async () => {
    const myToken = originToken ?? loadToken;
    const myId = originId ?? activeSetId;
    if (!myId || myToken !== loadToken || myId !== activeSetId) return;
    let setRow, itemsRes, stateRes, setStateRes;
    try {
      [setRow, itemsRes, stateRes, setStateRes] = await Promise.all([
        db.from('presession_checklist_sets').select('*').eq('id', myId).maybeSingle().then(r => r.data),
        getPresessionItems(myId),
        getPresessionState(myId),
        getPresessionSetState(myId),
      ]);
    } catch (e) { return; }
    if (myToken !== loadToken || myId !== activeSetId) return;
    if (setRow) {
      const idx = sets.findIndex(s => s.id === myId);
      if (idx >= 0) sets[idx] = setRow;
      renderSetTabs();
    }
    items = itemsRes;
    itemState = new Map(stateRes.map(r => [r.item_id, r]));
    setState = setStateRes || setState;
    renderActiveSet();
    if (settingsOpen && settingsSetId === myId && !settingsDirty) hydrateSettingsForm();
    postSummary();
  }, 180);
}

// ─── Render ─────────────────────────────────────────────────────────────────
function renderActiveSet() {
  const set = sets.find(s => s.id === activeSetId);
  if (!set) return;

  document.getElementById('setNameLabel').textContent = set.name;
  renderInstructions(set.description);
  renderBias();
  renderMoodChoices(set, setState?.session_mood || '');
  renderItems();
  if (settingsOpen && settingsSetId === activeSetId) renderManageList();
  updateBanner();
}

function renderInstructions(text) {
  const el = document.getElementById('psInstructions');
  const v = String(text || '').trim();
  if (!v) {
    el.classList.add('is-empty');
    el.textContent = 'Add instructions in Session Settings…';
  } else {
    el.classList.remove('is-empty');
    el.textContent = v;
  }
}

function renderBias() {
  const bias = setState?.market_bias || '';
  document.querySelectorAll('.bias-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.bias === bias);
  });
}

function renderMoodChoices(set, activeMood) {
  const row = document.getElementById('moodRow');
  const moods = moodsFor(set);
  if (!moods.length) {
    row.innerHTML = '<div class="ps-empty-inline">No mood options. Add some in Settings.</div>';
    return;
  }
  row.innerHTML = moods.map(m => `
    <button class="mood-btn${m === activeMood ? ' active' : ''}" onclick="setMood('${m.replace(/'/g, "\\'")}')">${esc(m)}</button>
  `).join('');
}

function renderItems() {
  const c = document.getElementById('clItems');
  if (!items.length) {
    c.innerHTML = '<div class="ps-empty-inline">No items yet. Add some in <span class="ps-link" onclick="openSettings(\'items\')">Settings</span>.</div>';
    updateProgress();
    return;
  }
  c.innerHTML = items.map(it => {
    const checked = itemState.get(it.id)?.is_checked === true;
    return `
      <div class="cl-item-row${checked ? ' cl-checked' : ''}" onclick="toggleItem('${it.id}')">
        <div class="cl-item-cb">${checked ? '✓' : ''}</div>
        <span class="cl-item-text">${esc(it.label)}</span>
      </div>
    `;
  }).join('');
  updateProgress();
}

function renderManageList() {
  const list = document.getElementById('clManageList');
  if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="ps-empty-inline">No items yet.</div>'; return; }
  list.innerHTML = items.map(it => `
    <div class="cl-manage-item">
      <input type="text" class="cl-manage-edit" value="${esc(it.label)}" onchange="renameItem('${it.id}', this.value)" maxlength="160">
      <button class="cl-manage-del" onclick="deleteItem('${it.id}')" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `).join('');
}

function updateProgress() {
  const total = items.length;
  const checked = items.reduce((n, it) => n + (itemState.get(it.id)?.is_checked === true ? 1 : 0), 0);
  document.getElementById('clProgressFill').style.width = total ? (checked / total) * 100 + '%' : '0%';
  document.getElementById('clProgressLabel').textContent = `${checked} / ${total} checked`;
}

function updateBanner() {
  const set = sets.find(s => s.id === activeSetId);
  const bias = setState?.market_bias || '';
  const total = items.length;
  const checked = items.reduce((n, it) => n + (itemState.get(it.id)?.is_checked === true ? 1 : 0), 0);
  document.getElementById('sbBias').textContent = bias || '—';
  document.getElementById('sbDot').className = 'sb-dot ' + ({Bullish:'bull',Bearish:'bear',Neutral:'neut',Wait:'wait'}[bias] || '');
  document.getElementById('sbScoreVal').textContent = total ? `${checked}/${total}` : '—';
  document.getElementById('sbPhase').textContent = set
    ? (set.reset_enabled ? `Resets ${fmtTime(set.reset_time)}` : 'Manual reset')
    : '—';
}

function updateNextResetLabel() {
  const set = sets.find(s => s.id === activeSetId);
  const lbl = document.getElementById('settingsNextReset');
  if (!lbl) return;
  if (!set) { lbl.textContent = ''; return; }
  // Reflect the in-drawer (potentially dirty) values so the preview is live.
  const enabled = document.getElementById('settingsResetEnabled').checked;
  const time = document.getElementById('settingsResetTime').value || '00:00';
  if (!enabled) { lbl.textContent = 'Auto-reset is off — clear checks manually with the Reset button.'; return; }
  const next = nextCycleStart(time);
  lbl.textContent = `Next reset ${humanCountdown(next)} (${next.toLocaleString([], { weekday:'short', hour:'2-digit', minute:'2-digit' })}).`;
}

function scheduleNextResetTick() {
  if (nextResetTimer) clearTimeout(nextResetTimer);
  const set = sets.find(s => s.id === activeSetId);
  if (!set || !set.reset_enabled) return;
  const myToken = loadToken;
  const myId = activeSetId;
  const next = nextCycleStart(set.reset_time).getTime();
  const ms = Math.max(1000, next - Date.now() + 250);
  nextResetTimer = setTimeout(async () => {
    if (myToken !== loadToken || myId !== activeSetId) return;
    try {
      const cycleStart = presessionCycleStart(set.reset_time);
      await resetPresessionCycle(currentUser.id, myId, cycleStart.toISOString());
    } catch (e) { console.warn('[presession] scheduled reset failed', e); }
    if (myToken !== loadToken || myId !== activeSetId) return;
    debouncedRefresh(myToken, myId);
    scheduleNextResetTick();
  }, ms);
}

// ─── Item interactions ──────────────────────────────────────────────────────
async function toggleItem(itemId) {
  const cur = itemState.get(itemId)?.is_checked === true;
  const next = !cur;
  itemState.set(itemId, { ...(itemState.get(itemId) || {}), is_checked: next, last_reset_at: itemState.get(itemId)?.last_reset_at || new Date().toISOString() });
  renderItems();
  updateBanner();
  postSummary();
  try {
    await upsertPresessionItemState(currentUser.id, activeSetId, itemId, next);
  } catch (e) {
    showToast('Save failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r');
  }
}

async function addItem() {
  if (!activeSetId) return;
  const inp = document.getElementById('clItemInp');
  const val = inp.value.trim();
  if (!val) return;
  inp.value = '';
  try {
    const order = items.length;
    const created = await createPresessionItem(activeSetId, { label: val, order_index: order });
    items.push(created);
    renderItems();
    renderManageList();
  } catch (e) {
    showToast('Add failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r');
  }
}

async function renameItem(id, label) {
  const trimmed = String(label || '').trim();
  if (!trimmed) return;
  const it = items.find(x => x.id === id);
  if (!it || it.label === trimmed) return;
  it.label = trimmed;
  try { await updatePresessionItem(id, { label: trimmed }); }
  catch (e) { showToast('Rename failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r'); }
}

async function deleteItem(id) {
  items = items.filter(x => x.id !== id);
  itemState.delete(id);
  renderItems();
  renderManageList();
  updateBanner();
  try { await deletePresessionItem(id); }
  catch (e) { showToast('Delete failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r'); }
}

// ─── Bias / Mood ────────────────────────────────────────────────────────────
async function setBias(val) {
  const next = setState?.market_bias === val ? null : val;
  setState = { ...(setState || {}), market_bias: next };
  renderBias();
  updateBanner();
  postSummary();
  try { await upsertPresessionSetState(currentUser.id, activeSetId, { market_bias: next }); }
  catch (e) { showToast('Save failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r'); }
}

async function setMood(val) {
  const set = sets.find(s => s.id === activeSetId);
  const next = setState?.session_mood === val ? null : val;
  setState = { ...(setState || {}), session_mood: next };
  renderMoodChoices(set, next || '');
  postSummary();
  try { await upsertPresessionSetState(currentUser.id, activeSetId, { session_mood: next }); }
  catch (e) { showToast('Save failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r'); }
}

// ─── Manual reset ───────────────────────────────────────────────────────────
async function resetActiveSetNow() {
  if (!activeSetId) return;
  try {
    await resetPresessionCycle(currentUser.id, activeSetId, new Date().toISOString());
    debouncedRefresh();
    showToast('Checklist reset.', 'fa-solid fa-rotate-right', 'g');
  } catch (e) { showToast('Reset failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r'); }
}

// ─── Settings drawer ────────────────────────────────────────────────────────
function openSettings(focusSection) {
  if (!activeSetId) return;
  settingsSetId = activeSetId;
  settingsOpen = true;
  hydrateSettingsForm();
  document.getElementById('settingsBd').classList.add('show');
  const drawer = document.getElementById('settingsDrawer');
  drawer.classList.add('show');
  drawer.setAttribute('aria-hidden', 'false');
  // Optional: scroll a section into view if requested.
  setTimeout(() => {
    const map = { instructions: 'settingsDescription', items: 'clItemInp', moods: 'moodInp', schedule: 'settingsResetTime' };
    const id = map[focusSection];
    if (id) {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus?.();
    }
  }, 80);
}

function closeSettings(silent) {
  if (settingsDirty && !silent) {
    if (!confirm('You have unsaved changes. Discard them?')) return;
  }
  settingsOpen = false;
  settingsDirty = false;
  setSettingsDirtyIndicator(false);
  document.getElementById('settingsBd').classList.remove('show');
  const drawer = document.getElementById('settingsDrawer');
  drawer.classList.remove('show');
  drawer.setAttribute('aria-hidden', 'true');
}

function hydrateSettingsForm() {
  const set = sets.find(s => s.id === settingsSetId);
  if (!set) return;
  document.getElementById('settingsSetLabel').textContent = `· ${set.name}`;
  document.getElementById('settingsSetName').value = set.name || '';
  document.getElementById('settingsDescription').value = set.description || '';
  document.getElementById('settingsResetEnabled').checked = !!set.reset_enabled;
  document.getElementById('settingsResetTime').value = fmtTime(set.reset_time);
  settingsMoodDraft = [...moodsFor(set)];
  renderMoodEditor();
  renderManageList();
  updateNextResetLabel();
  settingsDirty = false;
  setSettingsDirtyIndicator(false);
}

function renderMoodEditor() {
  const wrap = document.getElementById('moodEditor');
  if (!settingsMoodDraft.length) {
    wrap.innerHTML = '<div class="ps-empty-inline">No moods defined. Add at least one below.</div>';
    return;
  }
  wrap.innerHTML = settingsMoodDraft.map((m, i) => `
    <span class="mood-chip">
      <span class="mood-chip-text">${esc(m)}</span>
      <button class="mood-chip-x" onclick="removeMoodOption(${i})" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    </span>
  `).join('');
}

// Returns true if a mood was added (used both by the + button / Enter key
// and as an auto-flush before saving so unsubmitted text isn't lost).
function flushMoodInput(silent) {
  const inp = document.getElementById('moodInp');
  if (!inp) return false;
  const v = inp.value.trim();
  if (!v) return false;
  if (settingsMoodDraft.includes(v)) {
    if (!silent) showToast('Already in list.', 'fa-solid fa-info', '');
    return false;
  }
  settingsMoodDraft.push(v);
  inp.value = '';
  renderMoodEditor();
  markSettingsDirty();
  return true;
}
function addMoodOption() {
  const added = flushMoodInput(false);
  // Keep focus in the input so the user can keep adding without re-clicking.
  const inp = document.getElementById('moodInp');
  if (inp) inp.focus();
  if (added) showToast('Mood added — click Save to keep changes.', 'fa-solid fa-circle-check', 'g');
}
function removeMoodOption(i) {
  settingsMoodDraft.splice(i, 1);
  renderMoodEditor();
  markSettingsDirty();
}

function markSettingsDirty() {
  settingsDirty = true;
  setSettingsDirtyIndicator(true);
  updateNextResetLabel();
}

function setSettingsDirtyIndicator(on) {
  document.getElementById('settingsDirty').innerHTML = on ? '<i class="fa-solid fa-circle-dot" style="font-size:9px"></i> Unsaved changes' : '';
  document.getElementById('settingsSaveBtn').disabled = !on;
}

async function saveSettings() {
  if (!settingsSetId) return;
  // If the user typed a mood but never clicked +, fold it in so it's saved.
  flushMoodInput(/*silent*/true);
  const name = document.getElementById('settingsSetName').value.trim();
  if (!name) { showToast('Set name is required.', 'fa-solid fa-triangle-exclamation', 'r'); return; }
  const description = document.getElementById('settingsDescription').value;
  const reset_enabled = document.getElementById('settingsResetEnabled').checked;
  const reset_time = document.getElementById('settingsResetTime').value || '00:00';
  const mood_options = [...settingsMoodDraft];

  const btn = document.getElementById('settingsSaveBtn');
  btn.disabled = true;
  try {
    await updatePresessionSet(settingsSetId, { name, description, reset_enabled, reset_time, mood_options });
    const s = sets.find(x => x.id === settingsSetId);
    if (s) {
      s.name = name;
      s.description = description;
      s.reset_enabled = reset_enabled;
      s.reset_time = reset_time;
      s.mood_options = mood_options;
    }
    settingsDirty = false;
    setSettingsDirtyIndicator(false);
    document.getElementById('settingsSetLabel').textContent = `· ${name}`;
    if (settingsSetId === activeSetId) {
      renderSetTabs();
      renderActiveSet();
      scheduleNextResetTick();
    }
    showToast('Settings saved.', 'fa-solid fa-circle-check', 'g');
  } catch (e) {
    btn.disabled = false;
    showToast('Save failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r');
  }
}

// ─── Set CRUD (modals) ──────────────────────────────────────────────────────
function openCreateSet() {
  document.getElementById('setModalName').value = '';
  document.getElementById('setModalBd').classList.add('show');
  document.getElementById('setModal').classList.add('show');
  setTimeout(() => document.getElementById('setModalName').focus(), 50);
}
function closeSetModal() {
  document.getElementById('setModalBd').classList.remove('show');
  document.getElementById('setModal').classList.remove('show');
}
async function confirmSetModal() {
  const name = document.getElementById('setModalName').value.trim();
  if (!name) return;
  try {
    const created = await createPresessionSet(currentUser.id, jid, { name, position: sets.length });
    sets.push(created);
    closeSetModal();
    await switchToSet(created.id);
    showToast('Set created.', 'fa-solid fa-circle-check', 'g');
  } catch (e) { showToast('Save failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r'); }
}

function confirmDeleteSet() {
  const id = settingsOpen ? settingsSetId : activeSetId;
  if (!id) return;
  document.getElementById('confirmBd').classList.add('show');
  document.getElementById('confirmModal').classList.add('show');
}
function closeConfirm() {
  document.getElementById('confirmBd').classList.remove('show');
  document.getElementById('confirmModal').classList.remove('show');
}
async function performDeleteSet() {
  const id = settingsOpen ? settingsSetId : activeSetId;
  if (!id) return;
  closeConfirm();
  try {
    if (settingsOpen) closeSettings(/*silent*/true);
    await deletePresessionSet(id);
    sets = sets.filter(s => s.id !== id);
    const next = sets[0]?.id || null;
    if (next) {
      await switchToSet(next);
    } else {
      // Clean teardown like switchToSet, but no target.
      try { setSubs && db.removeChannel(setSubs); } catch(e) {}
      setSubs = null;
      if (_refreshT) { clearTimeout(_refreshT); _refreshT = null; }
      if (nextResetTimer) { clearTimeout(nextResetTimer); nextResetTimer = null; }
      ++loadToken;
      activeSetId = null;
      items = []; itemState = new Map(); setState = null;
      renderSetTabs();
      renderEmptyState();
    }
    showToast('Set deleted.', 'fa-solid fa-circle-check', 'g');
  } catch (e) { showToast('Delete failed: ' + e.message, 'fa-solid fa-triangle-exclamation', 'r'); }
}

// ─── Parent message bridge ──────────────────────────────────────────────────
function postSummary() {
  try {
    const set = sets.find(s => s.id === activeSetId) || null;
    const total = items.length;
    const checked = items.reduce((n, it) => n + (itemState.get(it.id)?.is_checked === true ? 1 : 0), 0);
    const score = total ? Math.round((checked / total) * 100) : 0;
    parent.postMessage({
      type: 'tz_presession_summary',
      set_id: set?.id || null,
      set_name: set?.name || null,
      bias: setState?.market_bias || '',
      mood: setState?.session_mood || '',
      checked, total, score,
      reset_enabled: !!set?.reset_enabled,
      reset_time: set?.reset_time || null,
      last_reset_at: setState?.last_reset_at || null,
      last_prompted_at: setState?.last_prompted_at || null,
    }, '*');
  } catch(e) {}
}

// ─── Toast ──────────────────────────────────────────────────────────────────
let _tt;
function showToast(msg, icon = 'fa-solid fa-circle-check', cls = '') {
  const t = document.getElementById('toast');
  document.getElementById('toastIcon').className = icon;
  document.getElementById('toastMsg').textContent = msg;
  t.className = 'show' + (cls ? ' ' + cls : '');
  clearTimeout(_tt);
  _tt = setTimeout(() => { t.className = ''; }, 3200);
}
