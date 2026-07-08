// journal.js - journal page (largest)
// Loaded by /src/pages/journal.html. Depends on globals from supabase-client.js.
// ─── Mobile slide-in sidebar ─────────────────────────────────────────────────
let _mobSidebarOpen = false;

function openMobSidebar() {
  if (_mobSidebarOpen) return;
  _mobSidebarOpen = true;
  const panel = document.getElementById('mobSidebarPanel');
  const backdrop = document.getElementById('mobSidebarBackdrop');
  const btn = document.getElementById('mobHdrMenuBtn');
  const icon = document.getElementById('mobHdrMenuIcon');
  backdrop.classList.add('visible');
  panel.classList.remove('closing');
  panel.classList.add('open');
  btn.classList.add('open');
  icon.className = 'fa-solid fa-xmark';
}

function closeMobSidebar() {
  if (!_mobSidebarOpen) return;
  _mobSidebarOpen = false;
  const panel = document.getElementById('mobSidebarPanel');
  const backdrop = document.getElementById('mobSidebarBackdrop');
  const btn = document.getElementById('mobHdrMenuBtn');
  const icon = document.getElementById('mobHdrMenuIcon');
  backdrop.classList.remove('visible');
  btn.classList.remove('open');
  icon.className = 'fa-solid fa-bars';
  panel.classList.remove('open');
  panel.classList.add('closing');
  setTimeout(() => panel.classList.remove('closing'), 200);
}

function mobSwitchTab(name) {
  closeMobSidebar();
  switchTab(name);
  // Sync active state on mobile sidebar items
  document.querySelectorAll('.mob-sidebar-item[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
}

// Close mobile sidebar on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _mobSidebarOpen) closeMobSidebar();
});

// ─── Sync mobile sidebar active state when tab changes ───────────────────────
function _syncMobMenu(tab) {
  document.querySelectorAll('.mob-sidebar-item[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

// ─── Sidebar state ──────────────────────────────────────────────────────────
const SIDEBAR_KEY = 'tz_sidebar_collapsed';
let _sidebarCollapsed = localStorage.getItem(SIDEBAR_KEY) === 'true';

function _applySidebarState(animate) {
  const sidebar = document.getElementById('sidebar');
  if (!animate) sidebar.style.transition = 'none';
  sidebar.classList.toggle('collapsed', _sidebarCollapsed);
  if (!animate) requestAnimationFrame(() => { sidebar.style.transition = ''; });
}

function toggleSidebar() {
  _sidebarCollapsed = !_sidebarCollapsed;
  localStorage.setItem(SIDEBAR_KEY, _sidebarCollapsed);
  _applySidebarState(true);
}

_applySidebarState(false);

// ─── Tabs ───────────────────────────────────────────────────────────────────
const TABS=['logs','presession','calendar','notes','analytics','settings'];
let activeTab='logs', journalId = sessionStorage.getItem('tz_current_journal')
             || localStorage.getItem('tz_current_journal');
let journalObj=null, settings=null, currentUser=null, userIsPro=false, isDirty=false, _settingsReady=false, journalLocked=false, currentProfile=null;
let exportScope='full', importMode='replace', importPayload=null;
let _lastRemovedTag=null, _lastRemovedKey=null, _undoTimer=null;

// ─── Binance CSV Import state ────────────────────────────────────────────────
let _bnbParsedRows = [];
let _bnbReadyRows = [];
let _bnbDupCount = 0;
let _bnbLastCsvText = '';

(async()=>{
  currentUser=await requireAuth();if(!currentUser)return;
  if(!journalId){location.href='/dashboard';return;}
  const [profile, journals, settingsData] = await Promise.all([
    getProfile(currentUser.id),
    getJournals(currentUser.id),
    getJournalSettings(journalId)
  ]);
  currentProfile = profile;
  const _sub = getSubscriptionStatus(profile);
  userIsPro = _sub.isPro;
  window._userIsPro = userIsPro;
  document.getElementById('hUserName').textContent = profile?.name || currentUser.email;
  const _badge = document.getElementById('hPlanBadge');
  if (userIsPro) {
    if (_sub.inGrace) {
      _badge.textContent = 'Grace period';
      _badge.className = 'plan-badge badge-expiring';
    } else if (_sub.expiring) {
      _badge.textContent = `Expires in ${_sub.daysLeft}d`;
      _badge.className = 'plan-badge badge-expiring';
    } else {
      _badge.textContent = 'Pro';
      _badge.className = 'plan-badge badge-pro';
    }
  } else if (_sub.downgraded) {
    _badge.textContent = 'Pro Expired';
    _badge.className = 'plan-badge badge-free';
  }
  journalObj = journals.find(j => j.id === journalId);
  if (!journalObj) { location.href = '/dashboard'; return; }
  settings = settingsData;
  journalLocked = isJournalLocked(journalObj, profile);
  renderSubBanner(_sub);
  renderJournalLockBanner();
  window._journalLocked = journalLocked;
  bcast({type:'tz_plan',isPro:userIsPro,locked:journalLocked});
  if(userIsPro&&profile?.pro_expires_at){
    document.getElementById('proDurationRow').style.display='block';
    document.getElementById('proDurationText').textContent='Active — renews '+fmtDate(profile.pro_expires_at);
  } else if(userIsPro){
    document.getElementById('proDurationRow').style.display='block';
    document.getElementById('proDurationText').textContent='Active';
  }
  if(journalObj.name) {
    document.getElementById('jnameHdr').textContent = journalObj.name;
    document.title = 'TradingGrove | ' + journalObj.name;
  }
  document.getElementById('pageLoader').classList.add('gone');
  setTimeout(()=>{const pl=document.getElementById('pageLoader');if(pl)pl.style.display='none';},400);
  const lf=document.getElementById('logsFrame');
  if(lf?.contentDocument?.readyState==='complete')frameReady('logs');
  _preloadTabs();
  cLoadDefaults();
  // Check today's trades against configured limits after everything is ready
  dllLoadSettings();
  _dllCheckFromDB();
})();

function renderSubBanner(s){
  const banner=document.getElementById('subBanner'),text=document.getElementById('subBannerText');
  if(!banner||!text)return;
  if(s.downgraded){banner.className='sub-banner';return;} // journal-lock banner covers the downgraded case
  if(s.inGrace){text.innerHTML=`<i class="fa-solid fa-triangle-exclamation" style="margin-right:8px"></i><strong>Your subscription expired.</strong> ${s.graceDaysLeft} day${s.graceDaysLeft===1?'':'s'} left before Free limits apply. Renew now.`;banner.className='sub-banner show expiring';}
  else if(s.expiring){text.innerHTML=`<i class="fa-solid fa-clock" style="margin-right:8px"></i><strong>${s.label}</strong> — Renew now to avoid losing Pro features.`;banner.className='sub-banner show expiring';}
  else{banner.className='sub-banner';}
}
function renderJournalLockBanner(){
  const el=document.getElementById('journalLockBanner');
  if(!el)return;
  el.style.display=journalLocked?'':'none';
}
// Guard for write operations on a locked (read-only) journal. Shows an explanatory
// toast and returns false when blocked; callers should bail out immediately.
function requireUnlocked(){
  if(!journalLocked)return true;
  showToast('This journal is read-only — your subscription expired. Renew Pro to edit it.','fa-solid fa-lock','red');
  return false;
}

function _preloadTabs(){
  [{id:'presessionFrame',src:'/presession'},
   {id:'calFrame',src:'/calendar.html'},
   {id:'notesFrame',src:'/notes.html'},
   {id:'analyticsFrame',src:'/analytics.html'}]
    .forEach(({id,src})=>{const f=document.getElementById(id);if(f&&!f.src)f.src=src+'?preload=1';});
}

let _flushTarget=null,_flushTimer=null;
function navigateSafely(dest){
  const lf=document.getElementById('logsFrame');
  if(!lf?.contentWindow){location.href=dest;return;}
  _flushTarget=dest;clearTimeout(_flushTimer);
  _flushTimer=setTimeout(()=>{_flushTarget=null;location.href=dest;},2000);
  try{lf.contentWindow.postMessage({type:'tz_flush_request'},'*');}catch(e){location.href=dest;}
}
window.addEventListener('message',e=>{
  if(e.data?.type==='tz_flushed'&&_flushTarget){clearTimeout(_flushTimer);const d=_flushTarget;_flushTarget=null;location.href=d;}
  if(e.data?.type==='tz_analytics_state'){const sw=document.getElementById('analyticsToggleSwitch');if(sw)sw.classList.toggle('on',!!e.data.on);}
  if(e.data?.type==='tz_trades_changed'){bcast(e.data);_dllCheckFromDB();}
  if(e.data?.type==='tz_presession_summary'){
    const dot=document.getElementById('psTabDot');
    const mobDot=document.getElementById('mobPsDot');
    if(!e.data.set_id||!e.data.total){
      if(dot)dot.style.display='none';
      if(mobDot)mobDot.style.display='none';
    }else{
      const score=e.data.score||0;
      const col=score>=85?'#22c55e':score>=70?'#f59e0b':score>0?'#ff5f6d':'#555';
      if(dot){dot.style.background=col;dot.style.display='inline-block';}
      if(mobDot){mobDot.style.background=col;mobDot.style.display='inline-block';}
    }
    ['logsFrame'].forEach(fid=>{try{const f=document.getElementById(fid);if(f?.contentWindow)f.contentWindow.postMessage(e.data,'*');}catch(ex){}});
  }
  if(e.data?.type==='tz_open_tab'&&e.data.tab){try{switchTab(e.data.tab);_syncMobMenu(e.data.tab);}catch(ex){}}
  if(e.data?.type==='TRADE_LOGGED'&&typeof e.data.pnl==='number'&&e.data.pnl<0){
    if(_dllSettings.enabled){
      const log=_dllGetTodayLog();
      log.push({amount:Math.abs(e.data.pnl),timestamp:Date.now()});
      localStorage.setItem(_dllTodayKey(),JSON.stringify(log));
      dllRenderToday();
      _dllCheckAndPersist();
    }
  }
});

function goBack(){if(activeTab==='settings'&&isDirty){showToast('Save or discard settings first.','fa-solid fa-triangle-exclamation','red');return;}navigateSafely('/dashboard');}

function switchTab(name){
  if(activeTab==='settings'&&isDirty&&name!=='settings'){showToast('Save or discard changes first.','fa-solid fa-triangle-exclamation','red');return;}
  TABS.forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active',t===name);
    // Sync desktop sidebar buttons
    const btn = document.querySelector(`.sidebar [data-tab="${t}"]`);
    if(btn) btn.classList.toggle('active', t===name);
  });
  activeTab=name;
  _syncMobMenu(name);
  const fm={
    presession:{id:'presessionFrame',src:'/presession'},
    calendar:{id:'calFrame',src:'/calendar.html'},
    notes:{id:'notesFrame',src:'/notes.html'},
    analytics:{id:'analyticsFrame',src:'/analytics.html'}
  };
  if(fm[name]){const{id,src}=fm[name];const f=document.getElementById(id);if(f){if(!f.src||f.src==='about:blank'){showTabLoader(name);f.classList.remove('ready');f.src=src+'?t='+Date.now();}else if(!f.classList.contains('ready'))showTabLoader(name);}}
  if(name==='settings')populateSettings();
  document.getElementById('unsavedBar').classList.remove('show');
  bcast({type:'tz_tab_changed',tab:name});
}

function showTabLoader(n){const l=document.getElementById('loader-'+n);if(l){l.style.display='';l.classList.remove('hidden');}}
function frameReady(n){
  const map={logs:'logsFrame',presession:'presessionFrame',calendar:'calFrame',notes:'notesFrame',analytics:'analyticsFrame'};
  const f=document.getElementById(map[n]);
  const t=localStorage.getItem('tl_theme')||'dark',ft=localStorage.getItem('tl_font')||'default';
  try{if(f?.contentWindow){f.contentWindow.postMessage({type:'tz_theme',theme:t},'*');f.contentWindow.postMessage({type:'tz_font',font:ft},'*');}}catch(e){}
  try{if(f?.contentWindow)f.contentWindow.postMessage({type:'tz_plan',isPro:userIsPro},'*');}catch(e){}
  try{if(f?.contentWindow)f.contentWindow.postMessage({type:'tz_tab_changed',tab:activeTab},'*');}catch(e){}
  if(f){f.classList.add('ready');const l=document.getElementById('loader-'+n);if(l){l.classList.add('hidden');setTimeout(()=>{if(l.classList.contains('hidden'))l.style.display='none';},350);}}
  _dllSendToFrame(n);
  if(n==='logs')_dllCheckFromDB(); // re-check whenever the logs iframe (re)loads
}
function bcast(msg){['logsFrame','presessionFrame','calFrame','notesFrame','analyticsFrame'].forEach(id=>{const f=document.getElementById(id);try{if(f?.contentWindow)f.contentWindow.postMessage(msg,'*');}catch(e){}});}

function markDirty(){if(!_settingsReady)return;isDirty=true;document.getElementById('unsavedBar').classList.add('show');}
function clearDirty(){isDirty=false;document.getElementById('unsavedBar').classList.remove('show');}
function discardChanges(){isDirty=false;document.getElementById('unsavedBar').classList.remove('show');populateSettings();}
function populateSettings(){
  if(!journalObj||!settings)return;
  _settingsReady=false;
  document.getElementById('js-name').value=journalObj.name||'';
  document.getElementById('js-capital').value=journalObj.capital||'';
  document.getElementById('showPnlToggle').classList.toggle('on',journalObj.show_pnl!==false);
  document.getElementById('showCapToggle').classList.toggle('on',journalObj.show_capital!==false);
  document.getElementById('showEqToggle').classList.toggle('on',journalObj.show_equity!==false);
  const aOn=localStorage.getItem('tl_analytics_on')!=='false';
  const sw=document.getElementById('analyticsToggleSwitch');if(sw)sw.classList.toggle('on',aOn);
  renderPinSection();renderTagLists();renderMoodGrid();renderExportImport();dllPopulateSettings();clearDirty();
  _settingsReady=true;
}
function renderPinSection(){
  const hasPin=!!(journalObj?.pin_hash);
  const badge=document.getElementById('pinBadge'),acts=document.getElementById('pinActionsRow'),form=document.getElementById('pinForm');
  document.getElementById('pinProNote').textContent=userIsPro?'':'(Pro plan only)';
  document.getElementById('pinNew').value='';document.getElementById('pinConfirm').value='';
  document.getElementById('pinMismatch').style.display='none';form.classList.remove('show');
  if(!userIsPro){badge.className='pin-badge pro-only';badge.innerHTML='<i class="fa-solid fa-lock"></i> Pro only';acts.innerHTML=`<button class="btn-pin" onclick="location.href='/subscription'" style="font-size:11px"><i class="fa-solid fa-arrow-up"></i> Upgrade</button>`;return;}
  if(hasPin){badge.className='pin-badge active';badge.innerHTML='<i class="fa-solid fa-lock"></i> PIN Active';acts.innerHTML=`<button class="btn-pin" onclick="showPinForm()"><i class="fa-solid fa-pen"></i> Change</button><button class="btn-pin btn-pin-danger" onclick="removePin()"><i class="fa-solid fa-lock-open"></i> Remove</button>`;}
  else{badge.className='pin-badge none';badge.innerHTML='<i class="fa-solid fa-lock-open"></i> No PIN';acts.innerHTML=`<button class="btn-pin" onclick="showPinForm()"><i class="fa-solid fa-plus"></i> Add PIN</button>`;}
}
function showPinForm(){document.getElementById('pinForm').classList.add('show');document.getElementById('pinNew').focus();markDirty();}
function onPinInput(){markDirty();const p=document.getElementById('pinNew').value,c=document.getElementById('pinConfirm').value;document.getElementById('pinMismatch').style.display=(c.length>0&&p!==c)?'block':'none';}
async function removePin(){if(!requireUnlocked())return;if(!confirm('Remove the PIN?'))return;try{await updateJournal(journalId,{pin_hash:null});journalObj.pin_hash=null;renderPinSection();showToast('PIN removed.','fa-solid fa-lock-open','green');}catch(e){showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red');}}
async function saveJournalSettings(){
  if(!requireUnlocked())return;
  const name=document.getElementById('js-name').value.trim();
  const capital=document.getElementById('js-capital').value.trim();
  const pinNew=document.getElementById('pinNew').value.trim();
  const pinConf=document.getElementById('pinConfirm').value.trim();
  const upd={};if(name)upd.name=name;if(capital!=='')upd.capital=parseFloat(capital)||null;
  if(userIsPro&&document.getElementById('pinForm').classList.contains('show')&&pinNew){
    if(pinNew.length<4){showToast('PIN must be at least 4 digits.','fa-solid fa-circle-exclamation','red');return;}
    if(pinNew!==pinConf){document.getElementById('pinMismatch').style.display='block';return;}
    upd.pin_hash=await hashPin(pinNew);document.getElementById('pinMismatch').style.display='none';
  }
  try{
    await updateJournal(journalId,upd);Object.assign(journalObj,upd);
    if(name){document.getElementById('jnameHdr').textContent=name;document.title='TradingGrove | '+name;}
    renderPinSection();clearDirty();showToast('Settings saved!','fa-solid fa-circle-check','green');
  }
  catch(e){showToast('Save failed: '+e.message,'fa-solid fa-circle-exclamation','red');}
}
async function toggleFlag(field){if(!requireUnlocked())return;const cur=journalObj[field]!==false;journalObj[field]=!cur;const toggleId={show_pnl:'showPnlToggle',show_capital:'showCapToggle',show_equity:'showEqToggle'}[field];document.getElementById(toggleId).classList.toggle('on',!cur);await updateJournal(journalId,{[field]:!cur});showToast('Display setting updated.','fa-solid fa-circle-check','green');}
function renderTagLists(){renderTagList('strategies','stratList');renderTagList('timeframes','tfList');renderTagList('pairs','pairList');}
function renderTagList(key,listId){const list=settings?.[key]||[];document.getElementById(listId).innerHTML=list.map(t=>`<span class="stag"><span class="stag-lbl" ondblclick="startRenameTag('${key}','${esc(t)}',this)">${esc(t)}</span><button class="ren" title="Rename" onclick="startRenameTag('${key}','${esc(t)}',this.previousElementSibling)"><i class="fa-solid fa-pen" style="font-size:8px"></i></button><button class="rm" onclick="removeTag('${key}','${esc(t)}')"><i class="fa-solid fa-xmark" style="font-size:9px"></i></button></span>`).join('');}
function startRenameTag(key,oldVal,labelEl){
  if(!requireUnlocked())return;
  const span=labelEl.closest('.stag');if(!span)return;
  let done=false;
  const input=document.createElement('input');
  input.className='tag-edit-input';input.value=oldVal;input.autocomplete='off';input.spellcheck=false;
  span.replaceChild(input,labelEl);
  input.focus();input.select();
  const finish=(commit)=>{
    if(done)return;done=true;
    if(commit){
      const v=input.value.trim();
      if(v&&v!==oldVal){renameTag(key,oldVal,v);return;}
    }
    renderTagLists();
  };
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();finish(true);}
    else if(e.key==='Escape'){e.preventDefault();finish(false);}
  });
  input.addEventListener('blur',()=>finish(true));
}
async function renameTag(key,oldVal,newVal){
  if(!requireUnlocked())return;
  if(key==='pairs')newVal=newVal.toUpperCase();
  const list=settings[key]||[];
  if(newVal!==oldVal&&list.find(x=>x.toLowerCase()===newVal.toLowerCase())){
    showToast(`Tag "${newVal}" already exists.`,'fa-solid fa-triangle-exclamation','red');
    renderTagLists();
    return;
  }
  const category={strategies:'strategy',timeframes:'timeframe',pairs:'pair'}[key];
  settings[key]=list.map(x=>x===oldVal?newVal:x);
  try{
    await updateJournalSettings(journalId,{[key]:settings[key]});
    await renameTagInTrades(journalId,category,oldVal,newVal);
    renderTagLists();
    bcast({type:'tz_settings_updated'});
    bcast({type:'tz_trades_changed',journalId});
    showToast(`Tag renamed to "${newVal}".`,'fa-solid fa-circle-check','green');
  }catch(e){
    settings[key]=list;
    renderTagLists();
    showToast('Rename failed: '+e.message,'fa-solid fa-circle-exclamation','red');
  }
}
async function addTag(key,inputId){if(!requireUnlocked())return;const inp=document.getElementById(inputId);let val=inp.value.trim();if(!val)return;if(key==='pairs')val=val.toUpperCase();const list=settings[key]||[];if(!list.find(x=>x.toLowerCase()===val.toLowerCase())){settings[key]=[...list,val];await updateJournalSettings(journalId,{[key]:settings[key]});renderTagLists();bcast({type:'tz_settings_updated'});showToast(`Tag "${val}" added.`,'fa-solid fa-circle-check','green');}inp.value='';}
async function removeTag(key,val){
  if(!requireUnlocked())return;
  _lastRemovedTag=val;_lastRemovedKey=key;settings[key]=(settings[key]||[]).filter(t=>t!==val);await updateJournalSettings(journalId,{[key]:settings[key]});renderTagLists();clearTimeout(_undoTimer);
  const t=document.getElementById('toast');document.getElementById('toastIcon').className='fa-solid fa-trash';document.getElementById('toastMsg').innerHTML=`Tag "<strong>${esc(val)}</strong>" removed. <button onclick="undoTagRemove()" style="background:var(--accent2);color:#0b0f0c;border:none;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer;margin-left:8px">Undo</button>`;t.className='show toast-red';
  _undoTimer=setTimeout(()=>{t.classList.remove('show','toast-red');_lastRemovedTag=null;_lastRemovedKey=null;},3500);
}
async function undoTagRemove(){if(!_lastRemovedTag||!_lastRemovedKey)return;const key=_lastRemovedKey,val=_lastRemovedTag;const list=settings[key]||[];if(!list.includes(val)){settings[key]=[...list,val];await updateJournalSettings(journalId,{[key]:settings[key]});renderTagLists();bcast({type:'tz_settings_updated'});}const t=document.getElementById('toast');t.classList.remove('show','toast-red');clearTimeout(_undoTimer);_lastRemovedTag=null;_lastRemovedKey=null;showToast(`Tag "${val}" restored.`,'fa-solid fa-rotate-left','green');}
function renderMoodGrid(){
  const moods=settings?.moods||[],colors=settings?.mood_colors||{};
  document.getElementById('moodGrid').innerHTML=moods.length?moods.map(m=>{const col=colors[m]||'#8fa39a';const[r,g,b]=[col.slice(1,3),col.slice(3,5),col.slice(5,7)].map(x=>parseInt(x,16));const colorEl=userIsPro?`<input type="color" class="mtag-color" value="${col}" style="background:${col}" oninput="updateMoodColor('${esc(m)}',this.value)" title="Change color">`:`<span class="mtag-dot" style="background:${col}"></span>`;return`<div class="mtag" style="background:rgba(${r},${g},${b},.15);color:${col};border-color:rgba(${r},${g},${b},.35)">${colorEl}<span class="mtag-lbl" ondblclick="startRenameMood('${esc(m)}',this)">${esc(m)}</span><button class="mtag-ren" title="Rename" onclick="startRenameMood('${esc(m)}',this.previousElementSibling)"><i class="fa-solid fa-pen" style="font-size:8px"></i></button><button class="mtag-rm" onclick="removeMoodTag('${esc(m)}')"><i class="fa-solid fa-xmark" style="font-size:9px"></i></button></div>`;}).join(''):'<span style="font-size:12px;color:var(--muted)">No moods yet.</span>';
}
function startRenameMood(oldVal,labelEl){
  if(!requireUnlocked())return;
  const wrap=labelEl.closest('.mtag');if(!wrap)return;
  let done=false;
  const input=document.createElement('input');
  input.className='tag-edit-input';input.value=oldVal;input.autocomplete='off';input.spellcheck=false;
  wrap.replaceChild(input,labelEl);
  input.focus();input.select();
  const finish=(commit)=>{
    if(done)return;done=true;
    if(commit){
      const v=input.value.trim();
      if(v&&v!==oldVal){renameMoodTag(oldVal,v);return;}
    }
    renderMoodGrid();
  };
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();finish(true);}
    else if(e.key==='Escape'){e.preventDefault();finish(false);}
  });
  input.addEventListener('blur',()=>finish(true));
}
async function renameMoodTag(oldVal,newVal){
  if(!requireUnlocked())return;
  const moods=settings.moods||[];
  if(moods.find(x=>x.toLowerCase()===newVal.toLowerCase())){
    showToast(`Mood "${newVal}" already exists.`,'fa-solid fa-triangle-exclamation','red');
    renderMoodGrid();
    return;
  }
  const prevMoods=moods,prevColors=settings.mood_colors;
  const newColors={...settings.mood_colors};
  newColors[newVal]=newColors[oldVal];
  delete newColors[oldVal];
  settings.moods=moods.map(x=>x===oldVal?newVal:x);
  settings.mood_colors=newColors;
  try{
    await updateJournalSettings(journalId,{moods:settings.moods,mood_colors:settings.mood_colors});
    await renameTagInTrades(journalId,'mood',oldVal,newVal);
    renderMoodGrid();
    bcast({type:'tz_settings_updated'});
    bcast({type:'tz_trades_changed',journalId});
    showToast(`Mood renamed to "${newVal}".`,'fa-solid fa-circle-check','green');
  }catch(e){
    settings.moods=prevMoods;settings.mood_colors=prevColors;
    renderMoodGrid();
    showToast('Rename failed: '+e.message,'fa-solid fa-circle-exclamation','red');
  }
}
async function addMoodTag(){if(!requireUnlocked())return;const inp=document.getElementById('moodInput'),col=document.getElementById('moodColor').value,val=inp.value.trim();if(!val)return;const moods=settings.moods||[];if(!moods.find(m=>m.toLowerCase()===val.toLowerCase())){settings.moods=[...moods,val];settings.mood_colors={...settings.mood_colors,[val]:col};await updateJournalSettings(journalId,{moods:settings.moods,mood_colors:settings.mood_colors});renderMoodGrid();bcast({type:'tz_settings_updated'});showToast(`Mood "${val}" added.`,'fa-solid fa-circle-check','green');}inp.value='';document.getElementById('moodColor').value='#8fa39a';}
async function removeMoodTag(val){
  if(!requireUnlocked())return;
  _lastRemovedTag=val;_lastRemovedKey='moods';settings.moods=settings.moods.filter(m=>m!==val);const c={...settings.mood_colors};delete c[val];settings.mood_colors=c;await updateJournalSettings(journalId,{moods:settings.moods,mood_colors:settings.mood_colors});renderMoodGrid();bcast({type:'tz_settings_updated'});clearTimeout(_undoTimer);
  const t=document.getElementById('toast');document.getElementById('toastIcon').className='fa-solid fa-trash';document.getElementById('toastMsg').innerHTML=`Mood "<strong>${esc(val)}</strong>" removed. <button onclick="undoTagRemove()" style="background:var(--accent2);color:#0b0f0c;border:none;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer;margin-left:8px">Undo</button>`;t.className='show toast-red';
  _undoTimer=setTimeout(()=>{t.classList.remove('show','toast-red');_lastRemovedTag=null;_lastRemovedKey=null;},3500);
}
async function updateMoodColor(mood,color){if(!requireUnlocked())return;settings.mood_colors={...settings.mood_colors,[mood]:color};await updateJournalSettings(journalId,{mood_colors:settings.mood_colors});renderMoodGrid();bcast({type:'tz_settings_updated'});}
function renderExportImport(){
  const el=document.getElementById('exportImportContent');
  if(!userIsPro){el.innerHTML=`<div class="pro-lock-box"><i class="fa-solid fa-lock lock-icon"></i><h4>Pro Feature</h4><p>Back up as <strong>.json</strong> (with images) or export as <strong>.csv</strong> for Excel.</p><button class="btn-upgrade" onclick="location.href='/subscription'"><i class="fa-solid fa-arrow-up"></i> Upgrade to Pro</button></div>`;return;}
  el.innerHTML=`<div class="io-grid"><button class="io-btn hi" onclick="openExport()"><div class="io-icon"><i class="fa-solid fa-file-arrow-down"></i></div><div class="io-label">JSON Backup</div><div class="io-desc">Full backup + images</div></button><button class="io-btn hi" onclick="exportCSV()"><div class="io-icon"><i class="fa-solid fa-file-csv"></i></div><div class="io-label">CSV Export</div><div class="io-desc">For Excel / Sheets</div></button><button class="io-btn" onclick="openImport()"><div class="io-icon"><i class="fa-solid fa-file-arrow-up"></i></div><div class="io-label">Import</div><div class="io-desc">Restore from .json</div></button></div><div class="io-note"><i class="fa-solid fa-circle-info"></i><span>JSON backup includes all images as embedded base64 data. CSV exports all trade fields for spreadsheet analysis.</span></div>`;
}

async function exportCSV(){
  try{
    const trades=await getTrades(journalId),rows=trades.map(dbToTrade);
    const headers=['Date','Time','Pair','Position','Strategy','Timeframe','PnL','R Factor','Confidence','Mood','Notes'];
    const e2=v=>{const s=String(v==null?'':v);return s.includes(',')||s.includes('"')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`:s;};
    const lines=[headers.join(','),...rows.map(t=>[t.date,t.time,t.pair,t.position,(t.strategy||[]).join(';'),(t.timeframe||[]).join(';'),t.pnl,t.r,t.confidence,(t.mood||[]).join(';'),t.notes].map(e2).join(','))];
    const blob=new Blob([lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const fname=`${(journalObj.name||'trades').replace(/[^a-z0-9]/gi,'_')}_${new Date().toISOString().slice(0,10)}.csv`;
    Object.assign(document.createElement('a'),{href:url,download:fname}).click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length} trades as CSV`,'fa-solid fa-circle-check','green');
  }catch(e){showToast('CSV export failed: '+e.message,'fa-solid fa-circle-exclamation','red');}
}

function openExport(){exportScope='full';setScope('full');document.getElementById('exportOverlay').classList.add('open');refreshExpSummary();}
function closeExport(){document.getElementById('exportOverlay').classList.remove('open');}
function setScope(s){
  exportScope=s;
  ['full','trades'].forEach(k=>{
    const o=document.getElementById('scope'+(k==='full'?'Full':'Trades'));
    const a=k===s;o.classList.toggle('active',a);
    o.querySelector('.sco-chk').innerHTML=a?'<i class="fa-solid fa-circle-check"></i>':'<i class="fa-solid fa-circle-dot"></i>';
  });
  refreshExpSummary();
}
async function refreshExpSummary(){
  const el=document.getElementById('exportSummary');
  el.innerHTML='<div class="es-row"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>';
  const trades=await getTrades(journalId);
  const s=settings||{};const f=exportScope==='full';
  let withImgs=0;
  for(const t of trades){const imgs=await getTradeImages(t.id);if(imgs.length>0)withImgs++;}
  el.innerHTML=`
    <div class="es-row ok"><i class="fa-solid fa-check"></i> ${trades.length} trade${trades.length!==1?'s':''}</div>
    <div class="es-row ${f?'ok':''}"><i class="fa-solid fa-${f?'check':'xmark'}"></i> ${(s.strategies||[]).length} strategy tags</div>
    <div class="es-row ${f?'ok':''}"><i class="fa-solid fa-${f?'check':'xmark'}"></i> ${(s.moods||[]).length} mood tags</div>
    <div class="es-row ${f?'ok':''}"><i class="fa-solid fa-${f?'check':'xmark'}"></i> Capital &amp; name</div>
    <div class="es-row ok"><i class="fa-solid fa-images"></i> ${withImgs} trade${withImgs!==1?'s':''} with images (embedded in backup)</div>
  `;
}

async function storagePathToBase64(storagePath){
  try{
    if(storagePath&&(storagePath.startsWith('http://')||storagePath.startsWith('https://'))){
      try{
        const resp=await fetch(storagePath);
        if(resp.ok){
          const blob=await resp.blob();
          return await new Promise(res=>{
            const r=new FileReader();
            r.onload=()=>res(r.result);
            r.onerror=()=>res(null);
            r.readAsDataURL(blob);
          });
        }
      }catch(fetchErr){
        console.warn('[export] direct URL fetch failed, falling back to storage download:',fetchErr);
      }
    }
    const{data,error}=await db.storage.from('trade-images').download(storagePath);
    if(error||!data)return null;
    return await new Promise(res=>{
      const r=new FileReader();
      r.onload=()=>res(r.result);
      r.onerror=()=>res(null);
      r.readAsDataURL(data);
    });
  }catch{return null;}
}

async function confirmExport(){
  const btn=document.getElementById('exportBtn');
  btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Preparing…';
  try{
    const trades=await getTrades(journalId);
    const isFull=exportScope==='full';
    const tradeRows=trades.map(dbToTrade);
    btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Embedding images…';
    for(let i=0;i<tradeRows.length;i++){
      const t=tradeRows[i];
      const rawImgs=await getTradeImages(t.id);
      if(rawImgs.length>0){
        const b64Imgs=[];
        for(const img of rawImgs){
          let b64=null;
          if(img.data&&img.data.startsWith('data:'))b64=img.data;
          else if(img._previewUrl&&img._previewUrl.startsWith('data:'))b64=img._previewUrl;
          else if(img.storage_url)b64=await storagePathToBase64(img.storage_url);
          if(!b64&&img.url)b64=await storagePathToBase64(img.url);
          if(b64)b64Imgs.push(b64);
        }
        tradeRows[i]={...t,images:b64Imgs};
      }
      btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Embedding images… (${i+1}/${tradeRows.length})`;
    }
    const payload={_meta:{version:'2.1',app:'TradingGrove',journalName:journalObj.name,exportedAt:new Date().toISOString(),exportScope,tradeCount:trades.length,imagesEmbedded:true},trades:tradeRows,...(isFull&&settings?{settings:{strategies:settings.strategies||[],timeframes:settings.timeframes||[],pairs:settings.pairs||[],moods:settings.moods||[],mood_colors:settings.mood_colors||{},capital:journalObj.capital,journalName:journalObj.name}}:{})};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const fname=`${journalObj.name.replace(/[^a-z0-9]/gi,'_')}_${exportScope}_${new Date().toISOString().slice(0,10)}.json`;
    Object.assign(document.createElement('a'),{href:url,download:fname}).click();
    URL.revokeObjectURL(url);closeExport();
    showToast(`Exported ${trades.length} trades with images!`,'fa-solid fa-circle-check','green');
  }catch(e){showToast('Export failed: '+e.message,'fa-solid fa-circle-exclamation','red');}
  finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-download"></i>Download .json';}
}

function openImport(){importPayload=null;clearFile();setImpMode('replace');['previewBox','settingsRestoreRow','importProgress'].forEach(id=>document.getElementById(id).classList.remove('show'));document.getElementById('importConfirmBtn').disabled=true;document.getElementById('importOverlay').classList.add('open');}
function closeImport(){document.getElementById('importOverlay').classList.remove('open');}
function setImpMode(m){importMode=m;document.getElementById('modeReplace').classList.toggle('active',m==='replace');document.getElementById('modeMerge').classList.toggle('active',m==='merge');if(importPayload)refreshImpPreview();}
function dzOver(e){e.preventDefault();document.getElementById('importDZ').classList.add('over');}
function dzLeave(){document.getElementById('importDZ').classList.remove('over');}
function dzDrop(e){e.preventDefault();dzLeave();const f=e.dataTransfer.files[0];if(f)loadImpFile(f);}
function onFileSelect(e){const f=e.target.files[0];if(f)loadImpFile(f);}
function clearFile(){importPayload=null;document.getElementById('fileBadge').classList.remove('show');document.getElementById('fileNameLabel').textContent='—';document.getElementById('previewBox').classList.remove('show');document.getElementById('settingsRestoreRow').classList.remove('show');document.getElementById('importFile').value='';document.getElementById('importConfirmBtn').disabled=true;}
function loadImpFile(file){
  const r=new FileReader();
  r.onload=e=>{try{const p=JSON.parse(e.target.result);importPayload=Array.isArray(p)?{_meta:{journalName:'Unknown',tradeCount:p.length},trades:p}:p.trades&&Array.isArray(p.trades)?p:null;if(!importPayload){showToast('Invalid file.','fa-solid fa-circle-exclamation','red');return;}document.getElementById('fileNameLabel').textContent=file.name;document.getElementById('fileBadge').classList.add('show');refreshImpPreview();document.getElementById('importConfirmBtn').disabled=false;}catch{showToast('Could not parse file.','fa-solid fa-circle-exclamation','red');}};
  r.readAsText(file);
}
async function refreshImpPreview(){
  if(!importPayload)return;
  document.getElementById('previewBox').classList.add('show');
  const inc=importPayload.trades||[];const cur=await getTrades(journalId);const curIds=new Set(cur.map(t=>t.id));const dups=inc.filter(t=>curIds.has(t.id)).length;const hasS=!!(importPayload.settings);
  const withImgs=inc.filter(t=>t.images&&t.images.some(img=>typeof img==='string'&&img.startsWith('data:'))).length;
  document.getElementById('pvTotal').textContent=inc.length;document.getElementById('pvJournal').textContent=importPayload._meta?.journalName||'—';document.getElementById('pvHasSettings').textContent=hasS?'Yes':'No';document.getElementById('pvHasImages').textContent=withImgs>0?`Yes (${withImgs} trades)`:'No';document.getElementById('pvHasImages').className='pv-val '+(withImgs>0?'pv-ok':'pv-info');
  if(importMode==='merge'){document.getElementById('pvNewRow').style.display='';document.getElementById('pvDupRow').style.display=dups>0?'':'none';document.getElementById('pvCurRow').style.display='none';document.getElementById('pvNew').textContent=inc.length-dups;document.getElementById('pvDup').textContent=dups;}
  else{document.getElementById('pvNewRow').style.display='none';document.getElementById('pvDupRow').style.display='none';document.getElementById('pvCurRow').style.display='';document.getElementById('pvCur').textContent=cur.length;}
  document.getElementById('settingsRestoreRow').classList.toggle('show',hasS);
}

async function uploadImagesForTrade(tradeId, tradeData) {
  const imgs = tradeData.images;
  if (!Array.isArray(imgs) || !imgs.length) return;
  for (const img of imgs) {
    let dataUrl = null;
    if (typeof img === 'string') {
      if (img.startsWith('data:')) { dataUrl = img; }
      else if (img.startsWith('http://') || img.startsWith('https://')) {
        try { const resp=await fetch(img);if(resp.ok){const blob=await resp.blob();dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>res(null);r.readAsDataURL(blob);});} } catch(e) { console.warn('[import] string URL fetch failed:',e); }
      }
    } else if (img && typeof img === 'object') {
      const raw = img.data || img._previewUrl || '';
      if (raw && raw.startsWith('data:')) { dataUrl = raw; }
      else {
        const url = img.storage_url || img.url || '';
        if (url) {
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            try { const{data,error}=await db.storage.from('trade-images').download(url);if(!error&&data){dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>res(null);r.readAsDataURL(data);});} } catch(e) { console.warn('[import] storage path download failed:',e); }
          } else {
            try { const resp=await fetch(url);if(resp.ok){const blob=await resp.blob();dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>res(null);r.readAsDataURL(blob);});} } catch(e) { console.warn('[import] object URL fetch failed:',e); }
          }
        }
      }
    }
    if (dataUrl && dataUrl.startsWith('data:')) {
      try { await addTradeImage(currentUser.id, tradeId, dataUrl); } catch(imgErr) { console.warn('[import] image upload failed for trade', tradeId, imgErr); }
    }
  }
}

async function confirmImport(){
  if(!requireUnlocked())return;
  if(!importPayload)return;
  const cb=document.getElementById('importConfirmBtn'),cancel=document.getElementById('importCancelBtn');
  cb.disabled=true;cancel.disabled=true;document.getElementById('importProgress').classList.add('show');
  const sp=(p,l)=>{document.getElementById('impProgBar').style.width=p+'%';document.getElementById('impProgSub').textContent=l;};
  try{
    const inc=importPayload.trades||[];
    const cur=await getTrades(journalId);
    const curIds=new Set(cur.map(t=>t.id));
    let fc=0;
    if(importMode==='replace'){
      document.getElementById('impProgLabel').textContent='Deleting…';
      for(let i=0;i<cur.length;i++){await deleteTrade(cur[i].id);sp(5+Math.round((i+1)/cur.length*25),`Deleting ${i+1}/${cur.length}`);}
      document.getElementById('impProgLabel').textContent='Importing…';
      for(let i=0;i<inc.length;i++){
        const {id:_,images:_imgs,...d}=inc[i];
        const row=await createTrade(currentUser.id,journalId,d);
        if (row?.id) await uploadImagesForTrade(row.id, inc[i]);
        fc++;sp(30+Math.round((i+1)/inc.length*55),`Importing ${i+1}/${inc.length}`);
      }
    } else {
      const nt=inc.filter(t=>!curIds.has(t.id));
      document.getElementById('impProgLabel').textContent='Merging…';
      for(let i=0;i<nt.length;i++){
        const {id:_,images:_imgs,...d}=nt[i];
        const row=await createTrade(currentUser.id,journalId,d);
        if (row?.id) await uploadImagesForTrade(row.id, nt[i]);
        fc++;sp(10+Math.round((i+1)/nt.length*75),`Merging ${i+1}/${nt.length}`);
      }
      fc=cur.length+nt.length;
    }
    const hasS=!!(importPayload.settings),shouldRestore=hasS&&document.getElementById('restoreSettingsChk')?.checked;
    if(shouldRestore){
      sp(90,'Restoring settings…');
      const s=importPayload.settings;const su={};
      if(s.strategies)su.strategies=s.strategies;if(s.timeframes)su.timeframes=s.timeframes;
      if(s.pairs)su.pairs=s.pairs;if(s.moods)su.moods=s.moods;if(s.mood_colors)su.mood_colors=s.mood_colors;
      await updateJournalSettings(journalId,su);settings={...settings,...su};
      const ju={};if(s.capital)ju.capital=s.capital;if(s.journalName)ju.name=s.journalName;
      if(Object.keys(ju).length){await updateJournal(journalId,ju);Object.assign(journalObj,ju);if(s.journalName){document.getElementById('jnameHdr').textContent=s.journalName;document.title='TradingGrove | '+s.journalName;}}
    }
    sp(100,'Done!');await new Promise(r=>setTimeout(r,600));
    closeImport();document.getElementById('logsFrame').src='/logs?t='+Date.now();
    if(activeTab==='settings')populateSettings();
    showToast(`Import complete — ${fc} trade${fc!==1?'s':''}${shouldRestore?' + settings':''}!`,'fa-solid fa-circle-check','green');
  } catch(e){
    showToast('Import failed: '+e.message,'fa-solid fa-circle-exclamation','red');
    document.getElementById('importProgress').classList.remove('show');
    cb.disabled=false;cancel.disabled=false;
  }
}

function openDelJournal(){if(!requireUnlocked())return;document.getElementById('delJournalName').textContent=journalObj?.name||'this journal';document.getElementById('delConfirmInput').value='';checkDel();document.getElementById('delOverlay').classList.add('open');setTimeout(()=>document.getElementById('delConfirmInput').focus(),120);}
function closeDelJournal(){document.getElementById('delOverlay').classList.remove('open');}
function checkDel(){const exp=(journalObj?.name||'').trim().toLowerCase(),typ=document.getElementById('delConfirmInput').value.trim().toLowerCase(),ok=typ===exp&&exp!=='';const btn=document.getElementById('delConfirmBtn');btn.disabled=!ok;btn.style.opacity=ok?'1':'.4';btn.style.cursor=ok?'pointer':'not-allowed';}
async function executeDelete(){try{await deleteJournal(journalId);sessionStorage.removeItem('tz_current_journal');location.href='/dashboard';}catch(e){showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red');}}

['delOverlay','exportOverlay','importOverlay'].forEach(id=>{
  document.getElementById(id).addEventListener('click',function(e){if(e.target===this){if(id==='delOverlay')closeDelJournal();if(id==='exportOverlay')closeExport();if(id==='importOverlay')closeImport();}});
});

let _tt;
function showToast(msg,icon='fa-solid fa-circle-check',type=''){const t=document.getElementById('toast');document.getElementById('toastIcon').className=icon;document.getElementById('toastMsg').innerHTML=msg;t.className='show'+(type==='green'?' toast-green':type==='red'?' toast-red':'');clearTimeout(_tt);_tt=setTimeout(()=>{t.classList.remove('show','toast-green','toast-red');},3500);}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function toggleAnalyticsBar(){const cur=localStorage.getItem('tl_analytics_on')!=='false',next=!cur;localStorage.setItem('tl_analytics_on',next);const sw=document.getElementById('analyticsToggleSwitch');if(sw)sw.classList.toggle('on',next);bcast({type:'tz_analytics_toggle',on:next});}

document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  const a=document.activeElement;
  if(a.id==='stratInput')addTag('strategies','stratInput');
  if(a.id==='tfInput')addTag('timeframes','tfInput');
  if(a.id==='pairInput')addTag('pairs','pairInput');
  if(a.id==='moodInput')addMoodTag();
});
window.addEventListener('beforeunload',e=>{if(activeTab==='settings'&&isDirty){e.preventDefault();e.returnValue='';}});

// ═══════════════════════════════════════════════════════════════════════
//  BINANCE FUTURES CSV IMPORT ENGINE
// ═══════════════════════════════════════════════════════════════════════

function bnbDzOver(e){e.preventDefault();document.getElementById('bnbDropzone').classList.add('over');}
function bnbDzLeave(){document.getElementById('bnbDropzone').classList.remove('over');}
function bnbDzDrop(e){
  e.preventDefault();bnbDzLeave();
  const f=e.dataTransfer.files[0];
  if(!f)return;
  if(!f.name.toLowerCase().endsWith('.csv')){bnbShowError('Only .csv files are accepted. Please upload a Binance Futures Transaction History CSV.');return;}
  bnbLoadFile(f);
}
function bnbOnFileSelect(e){
  const f=e.target.files[0];if(!f)return;
  if(!f.name.toLowerCase().endsWith('.csv')){bnbShowError('Only .csv files are accepted. Please upload a Binance Futures Transaction History CSV.');e.target.value='';return;}
  bnbLoadFile(f);
}

function bnbLoadFile(file){
  bnbHideError();
  document.getElementById('bnbFileName').textContent=file.name;
  document.getElementById('bnbFileBadge').classList.add('show');
  document.getElementById('bnbDropzone').style.display='none';
  document.getElementById('bnbResult').classList.remove('show');
  document.getElementById('bnbProgress').classList.remove('show');
  const r=new FileReader();
  r.onload=async(ev)=>{
    _bnbLastCsvText=ev.target.result;
    await bnbParseAndPreview(_bnbLastCsvText);
  };
  r.readAsText(file,'utf-8');
}

function bnbClearFile(){
  _bnbParsedRows=[];_bnbReadyRows=[];_bnbDupCount=0;_bnbLastCsvText='';
  document.getElementById('bnbFileBadge').classList.remove('show');
  document.getElementById('bnbDropzone').style.display='';
  document.getElementById('bnbFileInput').value='';
  document.getElementById('bnbFileName').textContent='—';
  document.getElementById('bnbPreview').classList.remove('show');
  document.getElementById('bnbActions').style.display='none';
  document.getElementById('bnbProgress').classList.remove('show');
  document.getElementById('bnbResult').classList.remove('show');
  document.getElementById('bnbProgBar').style.width='0';
  bnbHideError();
}

function bnbShowError(msg){
  const el=document.getElementById('bnbError');
  document.getElementById('bnbErrorMsg').textContent=msg;
  el.classList.add('show');
  document.getElementById('bnbPreview').classList.remove('show');
  document.getElementById('bnbActions').style.display='none';
}
function bnbHideError(){document.getElementById('bnbError').classList.remove('show');}

function bnbParseCSV(text){
  const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  if(lines.length<2)return[];
  const header=lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,'').trim());
  const idxTime=header.findIndex(h=>h.toLowerCase()==='time');
  const idxType=header.findIndex(h=>h.toLowerCase()==='type');
  const idxAmount=header.findIndex(h=>h.toLowerCase()==='amount');
  const idxSymbol=header.findIndex(h=>h.toLowerCase()==='symbol');
  if(idxTime===-1||idxType===-1||idxAmount===-1||idxSymbol===-1){return null;}
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const line=lines[i].trim();
    if(!line)continue;
    const cols=line.split(',').map(c=>c.trim().replace(/^"|"$/g,'').trim());
    const type=(cols[idxType]||'').trim();
    if(type!=='REALIZED_PNL')continue;
    const symbol=(cols[idxSymbol]||'').trim();
    if(!symbol)continue;
    const timeRaw=(cols[idxTime]||'').trim();
    const amountRaw=cols[idxAmount]||'';
    const amount=parseFloat(amountRaw);
    if(isNaN(amount))continue;
    const tMatch=timeRaw.match(/^(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::\d{2})?/);
    if(!tMatch)continue;
    const year='20'+tMatch[1];
    const month=tMatch[2];
    const day=tMatch[3];
    const hh=tMatch[4];
    const mm=tMatch[5];
    const date=`${year}-${month}-${day}`;
    const time=`${hh}:${mm}`;
    rows.push({date,time,symbol,amount,_rawTime:timeRaw});
  }
  return{rows,isValidFormat:true};
}

async function bnbParseAndPreview(csvText){
  bnbHideError();
  const mergePartial=document.getElementById('bnbMergePartial').checked;
  const skipDupes=document.getElementById('bnbSkipDupes').checked;

  const result=bnbParseCSV(csvText);
  if(result===null){
    bnbShowError('This does not look like a Binance Futures Transaction History CSV. Please make sure you exported the correct file with columns: Time, Type, Amount, Asset, Symbol, Transaction ID.');
    return;
  }
  const{rows}=result;
  if(!rows||rows.length===0){
    bnbShowError('No Realized PNL rows found. Make sure you exported Transaction History that includes Realized PNL type rows.');
    return;
  }

  let finalRows;
  if(mergePartial){
    const groups=new Map();
    rows.forEach(r=>{
      const key=`${r.symbol}||${r.date}||${r.time}`;
      if(!groups.has(key)){groups.set(key,{...r,_count:1});}
      else{const g=groups.get(key);g.amount+=r.amount;g._count++;}
    });
    finalRows=[...groups.values()];
  }else{
    finalRows=rows.map(r=>({...r,_count:1}));
  }

  let existingTrades=[];
  try{
    const raw=await getTrades(journalId);
    existingTrades=raw.map(dbToTrade);
  }catch(e){console.warn('[bnb] could not load existing trades for dup check',e);}

  _bnbParsedRows=finalRows.map(r=>{
    const trade={
      date:r.date,time:r.time,pair:r.symbol,pnl:r.amount,position:'Long',
      strategy:[],timeframe:[],mood:[],confidence:0,r:'',notes:'Binance Import'
    };
    let isDup=false;
    if(skipDupes){
      isDup=existingTrades.some(t=>
        t.date===trade.date&&t.time===trade.time&&
        (t.pair||'').toUpperCase()===(trade.pair||'').toUpperCase()
      );
    }
    return{trade,isDup};
  });

  _bnbReadyRows=_bnbParsedRows.filter(r=>!r.isDup);
  _bnbDupCount=_bnbParsedRows.length-_bnbReadyRows.length;

  if(_bnbParsedRows.length===0){bnbShowError('No valid trades found in this file.');return;}
  if(_bnbReadyRows.length===0&&_bnbDupCount>0){
    bnbShowError(`All ${_bnbDupCount} trade${_bnbDupCount!==1?'s':''} already exist in your log. Nothing to import.`);
    document.getElementById('bnbActions').style.display='none';
    document.getElementById('bnbPreview').classList.remove('show');
    return;
  }

  bnbRenderPreview();
  document.getElementById('bnbImportBtnLabel').textContent=`Import ${_bnbReadyRows.length} Trade${_bnbReadyRows.length!==1?'s':''}`;
  document.getElementById('bnbImportBtn').disabled=_bnbReadyRows.length===0;
  document.getElementById('bnbActions').style.display='flex';
}

function bnbRenderPreview(){
  const PREVIEW_LIMIT=5;
  const preview=document.getElementById('bnbPreview');
  const tbody=document.getElementById('bnbPreviewBody');
  const moreEl=document.getElementById('bnbPreviewMore');
  const summaryEl=document.getElementById('bnbSummary');
  const cntEl=document.getElementById('bnbPreviewCount');

  cntEl.textContent=`(${_bnbParsedRows.length} total)`;

  const displayRows=_bnbParsedRows.slice(0,PREVIEW_LIMIT);
  tbody.innerHTML=displayRows.map(({trade,isDup})=>{
    const pnl=parseFloat(trade.pnl)||0;
    const pnlCls=pnl>0?'bnb-pnl-pos':pnl<0?'bnb-pnl-neg':'bnb-pnl-zero';
    const pnlStr=(pnl>=0?'+':'')+pnl.toFixed(5);
    const statusCls=isDup?'bnb-status-dup':'bnb-status-ready';
    const statusLabel=isDup?'⚠ Duplicate':'✓ Ready';
    return`<tr>
      <td>${trade.date}</td>
      <td>${trade.time}</td>
      <td style="font-weight:600">${esc(trade.pair)}</td>
      <td class="${pnlCls}">${pnlStr}</td>
      <td class="${statusCls}">${statusLabel}</td>
    </tr>`;
  }).join('');

  const remaining=_bnbParsedRows.length-PREVIEW_LIMIT;
  moreEl.textContent=remaining>0?`…and ${remaining} more row${remaining!==1?'s':''}. Only first 5 shown above.`:'';

  const readyCnt=_bnbReadyRows.length;
  const dupCnt=_bnbDupCount;
  summaryEl.innerHTML=
    `<strong>${readyCnt}</strong> trade${readyCnt!==1?'s':''} ready to import`+
    (dupCnt>0?`, <strong>${dupCnt}</strong> duplicate${dupCnt!==1?'s':''} will be skipped.`:'.');

  preview.classList.add('show');
}

async function bnbRunImport(){
  if(!requireUnlocked())return;
  if(!_bnbReadyRows||_bnbReadyRows.length===0)return;
  const total=_bnbReadyRows.length;
  const btn=document.getElementById('bnbImportBtn');
  btn.disabled=true;
  document.getElementById('bnbActions').style.display='none';

  const progEl=document.getElementById('bnbProgress');
  const progBar=document.getElementById('bnbProgBar');
  const progLabel=document.getElementById('bnbProgLabel');
  const progSub=document.getElementById('bnbProgSub');
  progEl.classList.add('show');
  progBar.style.width='0';
  progLabel.textContent='Importing trades…';
  progSub.textContent='';

  let imported=0,errors=0;
  const lf=document.getElementById('logsFrame');

  for(let i=0;i<total;i++){
    const{trade}=_bnbReadyRows[i];
    progLabel.textContent=`Importing trade ${i+1} of ${total}…`;
    progSub.textContent=`${trade.pair} · ${trade.date} ${trade.time}`;
    progBar.style.width=Math.round(((i)/total)*100)+'%';
    try{
      const row=await createTrade(currentUser.id,journalId,trade);
      if(row){
        imported++;
        try{if(lf?.contentWindow)lf.contentWindow.postMessage({type:'tz_trade_added'},'*');}catch(ex){}
      }
    }catch(e){errors++;console.error('[bnb import] error on row',i,e);}
    await new Promise(res=>setTimeout(res,50));
  }

  progBar.style.width='100%';
  progLabel.textContent='Done!';
  progSub.textContent='';
  await new Promise(res=>setTimeout(res,400));
  progEl.classList.remove('show');

  const resultEl=document.getElementById('bnbResult');
  const resultIcon=document.getElementById('bnbResultIcon');
  const resultTitle=document.getElementById('bnbResultTitle');
  const resultBody=document.getElementById('bnbResultBody');
  const hasErrors=errors>0;
  resultEl.classList.toggle('has-errors',hasErrors);
  resultIcon.className=hasErrors?'fa-solid fa-triangle-exclamation':'fa-solid fa-circle-check';
  resultTitle.textContent=hasErrors?'Import Completed with Errors':'Import Complete';
  let bodyParts=[];
  bodyParts.push(`<strong>${imported}</strong> trade${imported!==1?'s':''} imported`);
  if(_bnbDupCount>0)bodyParts.push(`<strong>${_bnbDupCount}</strong> skipped (duplicates)`);
  if(errors>0)bodyParts.push(`<strong>${errors}</strong> error${errors!==1?'s':''}`);
  resultBody.innerHTML=bodyParts.join(' · ')+'.<br><span style="font-size:11px;color:var(--muted)">Switch to the Logs tab to see your imported trades.</span>';
  resultEl.classList.add('show');

  try{if(lf?.contentWindow){lf.src='/logs?t='+Date.now();}}catch(ex){}
  if(imported>0){
    showToast(`${imported} trade${imported!==1?'s':''} imported from Binance CSV!`,'fa-solid fa-circle-check','green');
  }
}

document.getElementById('bnbMergePartial').addEventListener('change',_bnbRecheckIfNeeded);
document.getElementById('bnbSkipDupes').addEventListener('change',_bnbRecheckIfNeeded);
function _bnbRecheckIfNeeded(){
  if(document.getElementById('bnbFileBadge').classList.contains('show')){
    if(_bnbLastCsvText){bnbParseAndPreview(_bnbLastCsvText);}
    else{_bnbReEvalDupes();}
  }
}

async function _bnbReEvalDupes(){
  if(!_bnbParsedRows||!_bnbParsedRows.length)return;
  const skipDupes=document.getElementById('bnbSkipDupes').checked;
  let existingTrades=[];
  try{const raw=await getTrades(journalId);existingTrades=raw.map(dbToTrade);}catch(e){}
  _bnbParsedRows=_bnbParsedRows.map(({trade})=>{
    let isDup=false;
    if(skipDupes){isDup=existingTrades.some(t=>t.date===trade.date&&t.time===trade.time&&(t.pair||'').toUpperCase()===(trade.pair||'').toUpperCase());}
    return{trade,isDup};
  });
  _bnbReadyRows=_bnbParsedRows.filter(r=>!r.isDup);
  _bnbDupCount=_bnbParsedRows.length-_bnbReadyRows.length;
  if(_bnbReadyRows.length===0&&_bnbDupCount>0){
    bnbShowError(`All ${_bnbDupCount} trade${_bnbDupCount!==1?'s':''} already exist in your log. Nothing to import.`);
    document.getElementById('bnbActions').style.display='none';
    document.getElementById('bnbPreview').classList.remove('show');
    return;
  }
  bnbHideError();
  bnbRenderPreview();
  document.getElementById('bnbImportBtnLabel').textContent=`Import ${_bnbReadyRows.length} Trade${_bnbReadyRows.length!==1?'s':''}`;
  document.getElementById('bnbImportBtn').disabled=_bnbReadyRows.length===0;
  document.getElementById('bnbActions').style.display='flex';
}

// ═══════════════════════════════════════════════════════════════════════
//  CALCULATOR ENGINE
// ═══════════════════════════════════════════════════════════════════════
const CALC_KEY = 'tradeCalcDefaults_v4';
let _calcOpen = false;
let cAsset    = 'crypto';
let cRiskMode = 'pct';
let cSlMode   = 'price';
let cTpMode   = 'price';
let fRiskMode = 'pct';
let fSlMode   = 'pips';
let fTpMode   = 'pips';

const CURRENCY_SYMBOLS = {USD:'$',EUR:'€',GBP:'£',JPY:'¥',CHF:'Fr',AUD:'A$',CAD:'C$',NZD:'NZ$'};
const CONTRACT_SIZE = 100000;
const APPROX_RATES = {USD:1,EUR:1.08,GBP:1.27,JPY:0.0067,CHF:1.12,AUD:0.65,CAD:0.74,NZD:0.60};

function _getPipSize(pair){return pair.includes('JPY')?0.01:0.0001;}
function _getLotLabel(lots){if(lots>=0.9)return 'Standard lot'+(lots>=1.9?'s':'');if(lots>=0.09)return 'Mini lot'+(lots>=0.19?'s':'');return 'Micro lot'+(lots>=0.019?'s':'');}
function _getPipValuePerLot(pair,acctCcy,entryPrice){
  const pipSize=_getPipSize(pair);const pipValueInQuote=pipSize*CONTRACT_SIZE;
  let base,quote;
  const specials={XAUUSD:['XAU','USD'],XAGUSD:['XAG','USD'],US30:['US30','USD'],NAS100:['NAS100','USD']};
  if(specials[pair]){[base,quote]=specials[pair];}else{base=pair.slice(0,3);quote=pair.slice(3,6);}
  if(quote===acctCcy)return pipValueInQuote;
  if(base===acctCcy&&entryPrice>0)return pipValueInQuote/entryPrice;
  const quoteToUSD=APPROX_RATES[quote]||1;const acctToUSD=APPROX_RATES[acctCcy]||1;
  return pipValueInQuote*(quoteToUSD/acctToUSD);
}

function toggleCalc(){
  _calcOpen=!_calcOpen;
  const modal=document.getElementById('calcModal'),fab=document.getElementById('calcFab'),icon=document.getElementById('calcFabIcon');
  if(_calcOpen){
    modal.classList.add('open');fab.classList.add('open');icon.className='fa-solid fa-xmark';
    if(!modal._placed){modal.style.right='16px';modal.style.bottom='82px';modal.style.top='auto';modal.style.left='auto';modal.style.width='min(700px,96vw)';modal._placed=true;}
    cCalc();
  }else{modal.classList.remove('open');fab.classList.remove('open');icon.className='fa-solid fa-calculator';}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&_calcOpen)toggleCalc();});

function cSetAsset(t){
  cAsset=t;
  document.getElementById('cBtnCrypto').classList.toggle('active',t==='crypto');
  document.getElementById('cBtnForex').classList.toggle('active',t==='forex');
  document.getElementById('cryptoInputs').style.display=t==='crypto'?'':'none';
  document.getElementById('forexInputs').style.display=t==='forex'?'':'none';
  document.getElementById('cCryptoResults').style.display=t==='crypto'?'':'none';
  document.getElementById('cForexResults').style.display=t==='forex'?'':'none';
  const acctCcy=document.getElementById('cAcctCurrency')?.value||'USD';
  const pre=document.getElementById('fBalancePre');if(pre)pre.textContent=CURRENCY_SYMBOLS[acctCcy]||'$';
  cCalc();
}
function cSetRiskMode(m){cRiskMode=m;document.getElementById('cRiskPctBtn').classList.toggle('active',m==='pct');document.getElementById('cRiskUsdBtn').classList.toggle('active',m==='usd');document.getElementById('cRiskSuf').textContent=m==='pct'?'%':'$';cCalc();}
function cSetSlMode(m){cSlMode=m;document.getElementById('cSlPriceBtn').classList.toggle('active',m==='price');document.getElementById('cSlPctBtn').classList.toggle('active',m==='pct');document.getElementById('cSlPriceWrap').style.display=m==='price'?'':'none';document.getElementById('cSlPctWrap').style.display=m==='pct'?'':'none';cCalc();}
function cSetTpMode(m){cTpMode=m;document.getElementById('cTpPriceBtn').classList.toggle('active',m==='price');document.getElementById('cTpPctBtn').classList.toggle('active',m==='pct');document.getElementById('cTpPriceWrap').style.display=m==='price'?'':'none';document.getElementById('cTpPctWrap').style.display=m==='pct'?'':'none';cCalc();}
function fSetRiskMode(m){fRiskMode=m;document.getElementById('fRiskPctBtn').classList.toggle('active',m==='pct');document.getElementById('fRiskUsdBtn').classList.toggle('active',m==='usd');document.getElementById('fRiskSuf').textContent=m==='pct'?'%':(CURRENCY_SYMBOLS[document.getElementById('cAcctCurrency')?.value||'USD']||'$');cCalc();}
function fSetSlMode(m){fSlMode=m;document.getElementById('fSlPipsBtn').classList.toggle('active',m==='pips');document.getElementById('fSlPriceBtn2').classList.toggle('active',m==='price');document.getElementById('fSlPipsWrap').style.display=m==='pips'?'':'none';document.getElementById('fSlPriceWrap2').style.display=m==='price'?'':'none';cCalc();}
function fSetTpMode(m){fTpMode=m;document.getElementById('fTpPipsBtn').classList.toggle('active',m==='pips');document.getElementById('fTpPriceBtn2').classList.toggle('active',m==='price');document.getElementById('fTpPipsWrap').style.display=m==='pips'?'':'none';document.getElementById('fTpPriceWrap2').style.display=m==='price'?'':'none';cCalc();}

function cLoadDefaults(){
  try{const d=JSON.parse(localStorage.getItem(CALC_KEY));if(!d)return;
    if(d.capital!==undefined)document.getElementById('cCapital').value=d.capital;
    if(d.riskVal!==undefined)document.getElementById('cRiskVal').value=d.riskVal;
    if(d.riskMode!==undefined)cSetRiskMode(d.riskMode);
    if(d.leverage!==undefined)document.getElementById('cLeverage').value=d.leverage;
    if(d.asset!==undefined)cSetAsset(d.asset);
  }catch(e){}
}
function cSaveDefault(){
  const d={capital:document.getElementById('cCapital').value,riskVal:document.getElementById('cRiskVal').value,riskMode:cRiskMode,leverage:document.getElementById('cLeverage').value,asset:cAsset};
  localStorage.setItem(CALC_KEY,JSON.stringify(d));
  const btn=document.getElementById('cBtnSetDef'),fb=document.getElementById('cSaveFeedback');
  btn.classList.add('saved');fb.classList.add('show');
  setTimeout(()=>{btn.classList.remove('saved');fb.classList.remove('show');},2000);
}

function _fmtMoney(n,ccy='USD',d=2){if(n===null||n===undefined||isNaN(n))return '—';const sym=CURRENCY_SYMBOLS[ccy]||ccy+' ';return sym+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function _fmtUSD(n,d=2){return _fmtMoney(n,'USD',d);}
function _fmt(n,d=2){if(n===null||n===undefined||isNaN(n))return '—';return n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function _sv(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function _rrColor(rr){if(rr>=3)return '#00c896';if(rr>=2)return _lerpHex('#f59e0b','#00c896',rr-2);if(rr>=1)return _lerpHex('#ff4f6a','#f59e0b',rr-1);return '#ff4f6a';}
function _lerpHex(a,b,t){const ah=parseInt(a.slice(1),16),bh=parseInt(b.slice(1),16);const[ar,ag,ab_]=[(ah>>16)&0xff,(ah>>8)&0xff,ah&0xff];const[br,bg,bb]=[(bh>>16)&0xff,(bh>>8)&0xff,bh&0xff];const r=Math.round(ar+(br-ar)*t),g=Math.round(ag+(bg-ag)*t),b2=Math.round(ab_+(bb-ab_)*t);return '#'+[r,g,b2].map(x=>x.toString(16).padStart(2,'0')).join('');}
function _updateRR(rr){
  if(rr===null||isNaN(rr)||rr<=0){document.getElementById('cRrSection').style.display='none';return;}
  document.getElementById('cRrSection').style.display='block';
  const col=_rrColor(rr),rrEl=document.getElementById('cRrVal');
  rrEl.textContent='1 : '+_fmt(rr,2);rrEl.style.color=col;
  const fill=document.getElementById('cRrFill');
  fill.style.width=Math.min((rr/3)*100,100)+'%';
  fill.style.background=rr>=3?'#00c896':`linear-gradient(to right, #ff4f6a, ${_rrColor(rr)})`;
}
function cCalc(){if(cAsset==='crypto')_calcCrypto();else _calcForex();}

function _calcCrypto(){
  const capital=parseFloat(document.getElementById('cCapital').value);
  const riskVal=parseFloat(document.getElementById('cRiskVal').value);
  const entry=parseFloat(document.getElementById('cEntry').value);
  const leverage=Math.max(1,parseFloat(document.getElementById('cLeverage').value)||1);
  _sv('cLevDisplay',leverage+'×');
  let riskAmt=null;
  if(!isNaN(capital)&&capital>0&&!isNaN(riskVal)&&riskVal>0)riskAmt=cRiskMode==='pct'?capital*(riskVal/100):riskVal;
  let slDist=null,slPct=null;
  if(!isNaN(entry)&&entry>0){
    if(cSlMode==='price'){const slP=parseFloat(document.getElementById('cSLPrice').value);if(!isNaN(slP)&&slP>0&&slP!==entry){slDist=Math.abs(entry-slP);slPct=(slDist/entry)*100;}}
    else{const sp=parseFloat(document.getElementById('cSLPct').value);if(!isNaN(sp)&&sp>0){slPct=sp;slDist=entry*(sp/100);}}
  }
  let tpDist=null,tpPct=null;
  if(!isNaN(entry)&&entry>0){
    if(cTpMode==='price'){const tpP=parseFloat(document.getElementById('cTPPrice').value);if(!isNaN(tpP)&&tpP>0&&tpP!==entry){tpDist=Math.abs(tpP-entry);tpPct=(tpDist/entry)*100;}}
    else{const tp=parseFloat(document.getElementById('cTPPct').value);if(!isNaN(tp)&&tp>0){tpPct=tp;tpDist=entry*(tp/100);}}
  }
  if(riskAmt!==null&&slDist!==null&&slDist>0){
    const posSize=riskAmt/slDist,posVal=posSize*entry,margin=posVal/leverage,profit=tpDist!==null?posSize*tpDist:null,rr=profit!==null?profit/riskAmt:null;
    _sv('cOutRisk',_fmtUSD(riskAmt));
    const riskSubParts=[];if(cRiskMode==='pct')riskSubParts.push(riskVal.toFixed(2)+'% of capital');else riskSubParts.push('fixed risk');if(slPct)riskSubParts.push('SL '+slPct.toFixed(3)+'% away');
    _sv('cOutRiskSub',riskSubParts.join(' · '));
    if(profit!==null){document.getElementById('cProfitCard').style.opacity='1';_sv('cOutProfit',_fmtUSD(profit));_sv('cOutProfitSub',tpPct?'TP '+tpPct.toFixed(3)+'% from entry':'if TP hit');}
    else{document.getElementById('cProfitCard').style.opacity='.35';_sv('cOutProfit','—');_sv('cOutProfitSub','set a take profit to calculate');}
    _sv('cOutMargin',_fmtUSD(margin));
    if(leverage>1){_sv('cOutMarginSub',`Position: ${_fmtUSD(posVal)} · ${leverage}× leverage`);document.getElementById('cLevNote').style.display='block';_sv('cLevNoteX',leverage+'×');_sv('cLevNotePos',_fmtUSD(posVal));_sv('cLevNoteMargin',_fmtUSD(margin));}
    else{_sv('cOutMarginSub',`Full position: ${_fmtUSD(posVal)}`);document.getElementById('cLevNote').style.display='none';}
    _updateRR(rr);
  }else{_cryptoClear();}
}
function _cryptoClear(){
  _sv('cOutRisk','—');_sv('cOutRiskSub','if stop loss is hit');_sv('cOutProfit','—');_sv('cOutProfitSub','set a take profit to calculate');_sv('cOutMargin','—');_sv('cOutMarginSub','enter trade details to calculate');
  document.getElementById('cProfitCard').style.opacity='.35';document.getElementById('cLevNote').style.display='none';
  _sv('cLevDisplay',(parseFloat(document.getElementById('cLeverage').value)||1)+'×');_updateRR(null);
}
function _calcForex(){
  const pair=document.getElementById('cPair').value||'EURUSD',acctCcy=document.getElementById('cAcctCurrency').value||'USD';
  const balance=parseFloat(document.getElementById('cFBalance').value),riskInput=parseFloat(document.getElementById('cFRisk').value);
  const entryRaw=parseFloat(document.getElementById('cFEntry').value),entry=!isNaN(entryRaw)&&entryRaw>0?entryRaw:0;
  const pre=document.getElementById('fBalancePre');if(pre)pre.textContent=CURRENCY_SYMBOLS[acctCcy]||'$';
  if(isNaN(balance)||balance<=0||isNaN(riskInput)||riskInput<=0){_forexClear();return;}
  const riskAmt=fRiskMode==='pct'?balance*(riskInput/100):riskInput;
  const pipSize=_getPipSize(pair);
  let slPips=null;
  if(fSlMode==='pips'){const p=parseFloat(document.getElementById('cFSLPips').value);if(!isNaN(p)&&p>0)slPips=p;}
  else{const slPrice=parseFloat(document.getElementById('cFSLPrice').value);if(!isNaN(slPrice)&&slPrice>0&&entry>0&&slPrice!==entry)slPips=Math.abs(entry-slPrice)/pipSize;}
  let tpPips=null;
  if(fTpMode==='pips'){const p=parseFloat(document.getElementById('cFTPPips').value);if(!isNaN(p)&&p>0)tpPips=p;}
  else{const tpPrice=parseFloat(document.getElementById('cFTPPrice').value);if(!isNaN(tpPrice)&&tpPrice>0&&entry>0&&tpPrice!==entry)tpPips=Math.abs(tpPrice-entry)/pipSize;}
  if(slPips===null||slPips<=0){_forexClear();return;}
  const pipValPerLot=_getPipValuePerLot(pair,acctCcy,entry);
  const lots=riskAmt/(slPips*pipValPerLot),units=lots*CONTRACT_SIZE;
  const moneyAtRisk=lots*slPips*pipValPerLot;
  let tpProfit=null,rr=null;
  if(tpPips!==null&&tpPips>0){tpProfit=lots*tpPips*pipValPerLot;rr=tpPips/slPips;}
  const pipValTotal=lots*pipValPerLot;
  const sym=CURRENCY_SYMBOLS[acctCcy]||'$';
  const fmtA=(n,d=2)=>n===null||isNaN(n)?'—':sym+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  _sv('fOutRiskAmt',fmtA(moneyAtRisk));_sv('fOutRiskPct',fRiskMode==='pct'?riskInput.toFixed(2)+'% of balance':'fixed risk');
  const lotsRounded=Math.round(lots*100)/100;
  _sv('fOutLots',_fmt(lotsRounded,lotsRounded<0.01?4:lotsRounded<0.1?3:2));_sv('fOutLotType',_getLotLabel(lotsRounded));
  _sv('fOutUnits',Math.round(units).toLocaleString('en-US'));
  _sv('fOutPipVal',fmtA(pipValPerLot,pipValPerLot<1?3:2));_sv('fOutPipValSub','per pip · 1 std lot');
  const slInfoEl=document.getElementById('fSlInfo');if(slInfoEl)slInfoEl.style.display='';
  _sv('fOutSlPips',_fmt(slPips,slPips%1===0?0:1));_sv('fOutPipSize',pipSize===0.0001?'0.0001':'0.01');_sv('fOutContract',CONTRACT_SIZE.toLocaleString('en-US'));
  if(tpProfit!==null){document.getElementById('fPnlSec').style.display='';_sv('fOutProfit',fmtA(tpProfit));_sv('fOutProfitPips',_fmt(tpPips,tpPips%1===0?0:1)+' pips');_sv('fOutPipValTotal',fmtA(pipValTotal,pipValTotal<1?3:2));}
  else document.getElementById('fPnlSec').style.display='none';
  _updateRR(rr);
}
function _forexClear(){
  ['fOutRiskAmt','fOutRiskPct','fOutLots','fOutLotType','fOutUnits','fOutPipVal','fOutPipValSub','fOutSlPips','fOutPipSize'].forEach(k=>_sv(k,'—'));
  const slInfoEl=document.getElementById('fSlInfo');if(slInfoEl)slInfoEl.style.display='none';
  document.getElementById('fPnlSec').style.display='none';_updateRR(null);
}
document.getElementById('cAcctCurrency')?.addEventListener('change',()=>{
  const acctCcy=document.getElementById('cAcctCurrency').value;
  const pre=document.getElementById('fBalancePre');if(pre)pre.textContent=CURRENCY_SYMBOLS[acctCcy]||'$';
  if(fRiskMode==='usd'){const suf=document.getElementById('fRiskSuf');if(suf)suf.textContent=CURRENCY_SYMBOLS[acctCcy]||'$';}
  cCalc();
});

// ── Drag ──
(function(){
  const modal=document.getElementById('calcModal'),hdr=document.getElementById('calcDragHdr');
  let drag=false,ox=0,oy=0;
  hdr.addEventListener('mousedown',e=>{if(e.button!==0||e.target.closest('.calc-x'))return;drag=true;const r=modal.getBoundingClientRect();ox=e.clientX-r.left;oy=e.clientY-r.top;modal.style.right='auto';modal.style.bottom='auto';modal.style.left=r.left+'px';modal.style.top=r.top+'px';document.body.style.userSelect='none';e.preventDefault();});
  document.addEventListener('mousemove',e=>{if(!drag)return;const nx=Math.max(0,Math.min(e.clientX-ox,window.innerWidth-modal.offsetWidth));const ny=Math.max(0,Math.min(e.clientY-oy,window.innerHeight-modal.offsetHeight));modal.style.left=nx+'px';modal.style.top=ny+'px';});
  document.addEventListener('mouseup',()=>{drag=false;document.body.style.userSelect='';});
  hdr.addEventListener('touchstart',e=>{if(e.target.closest('.calc-x'))return;const r=modal.getBoundingClientRect();ox=e.touches[0].clientX-r.left;oy=e.touches[0].clientY-r.top;modal.style.right='auto';modal.style.bottom='auto';modal.style.left=r.left+'px';modal.style.top=r.top+'px';drag=true;e.preventDefault();},{passive:false});
  document.addEventListener('touchmove',e=>{if(!drag)return;const nx=Math.max(0,Math.min(e.touches[0].clientX-ox,window.innerWidth-modal.offsetWidth));const ny=Math.max(0,Math.min(e.touches[0].clientY-oy,window.innerHeight-modal.offsetHeight));modal.style.left=nx+'px';modal.style.top=ny+'px';e.preventDefault();},{passive:false});
  document.addEventListener('touchend',()=>{drag=false;});
})();

// ═══════════════════════════════════════════════════════════════════════
//  DAILY LOSS LIMIT
// ═══════════════════════════════════════════════════════════════════════
const DLL_SETTINGS_KEY = 'tg_loss_limit';
const DLL_STATE_KEY    = 'tg_loss_limit_state';
const DLL_TIP_KEY      = 'tg_loss_limit_tip_dismissed';
// Both thresholds are always active; whichever is hit first fires the alert.
let _dllSettings = {enabled:false, losses:2, usd:50};

function _dllTodayKey(){
  const d=new Date();
  return `tg_loss_log_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _dllToday(){return new Date().toISOString().slice(0,10);}
function _dllGetTodayLog(){try{return JSON.parse(localStorage.getItem(_dllTodayKey()))||[];}catch{return[];}}
function _dllGetTodayTotal(){
  const log=_dllGetTodayLog();
  return {losses:log.length, usd:log.reduce((s,e)=>s+(parseFloat(e.amount)||0),0)};
}

function dllLoadSettings(){
  try{
    // Supabase settings row takes priority if it has the new dual format
    if(settings?.loss_limit&&(settings.loss_limit.losses!==undefined||settings.loss_limit.usd!==undefined)){
      _dllSettings=Object.assign({enabled:false,losses:2,usd:50},settings.loss_limit);
      localStorage.setItem(DLL_SETTINGS_KEY,JSON.stringify(_dllSettings));return;
    }
    const raw=localStorage.getItem(DLL_SETTINGS_KEY);
    if(raw){
      const parsed=JSON.parse(raw);
      // Migrate old single-type format
      if(parsed.type&&parsed.value!==undefined){
        _dllSettings={enabled:parsed.enabled||false,losses:parsed.type==='losses'?parsed.value:2,usd:parsed.type==='usd'?parsed.value:50};
      }else{
        _dllSettings=Object.assign({enabled:false,losses:2,usd:50},parsed);
      }
    }
  }catch{}
}

async function dllSave(){
  const enabled=document.getElementById('dllEnabledToggle').classList.contains('on');
  const losses=parseInt(document.getElementById('dllLossesVal').value)||2;
  const usd=parseFloat(document.getElementById('dllUsdVal').value)||50;
  _dllSettings={enabled,losses,usd};
  localStorage.setItem(DLL_SETTINGS_KEY,JSON.stringify(_dllSettings));
  try{if(journalId)await updateJournalSettings(journalId,{loss_limit:_dllSettings});}catch(e){}
  dllDismissTip();
  showToast('Loss limit saved!','fa-solid fa-circle-check','green');
  _dllCheckFromDB(); // re-check against today's actual trades with the new limits
}

function dllToggleEnabled(){document.getElementById('dllEnabledToggle').classList.toggle('on');dllMarkDirty();}
function dllMarkDirty(){}

function dllScrollToInput(){
  const inp=document.getElementById('dllLossesVal');
  if(inp){inp.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>inp.focus(),300);}
}

function dllDismissTip(){
  localStorage.setItem(DLL_TIP_KEY,'1');
  const tip=document.getElementById('dllTipCard');
  if(tip)tip.style.display='none';
}

function dllPopulateSettings(){
  dllLoadSettings();
  const s=_dllSettings;
  document.getElementById('dllEnabledToggle')?.classList.toggle('on',!!s.enabled);
  const lv=document.getElementById('dllLossesVal');if(lv)lv.value=s.losses||2;
  const uv=document.getElementById('dllUsdVal');if(uv)uv.value=s.usd||50;
  const tip=document.getElementById('dllTipCard');
  if(tip)tip.style.display=(!s.enabled&&!localStorage.getItem(DLL_TIP_KEY))?'':'none';
  dllRenderToday();
}

function dllRenderToday(totals){
  const todayEl=document.getElementById('dllToday');
  const logRow=document.getElementById('dllLogRow');
  if(!todayEl)return;
  if(!_dllSettings.enabled){todayEl.style.display='none';if(logRow)logRow.style.display='none';return;}
  todayEl.style.display='';
  if(logRow)logRow.style.display='';
  const t=totals||_dllGetTodayTotal();
  const lLimit=_dllSettings.losses||2, uLimit=_dllSettings.usd||50;
  const lv=document.getElementById('dllTodayLossesVal');
  if(lv)lv.textContent=`${t.losses} / ${lLimit} loss${lLimit!==1?'es':''}`;
  const lf=document.getElementById('dllTodayLossesFill');
  if(lf){const p=Math.min((t.losses/lLimit)*100,100);lf.style.width=p+'%';lf.classList.toggle('danger',p>=100);}
  const uv=document.getElementById('dllTodayUsdVal');
  if(uv)uv.textContent=`$${t.usd.toFixed(2)} / $${uLimit.toFixed(2)}`;
  const uf=document.getElementById('dllTodayUsdFill');
  if(uf){const p=Math.min((t.usd/uLimit)*100,100);uf.style.width=p+'%';uf.classList.toggle('danger',p>=100);}
}

function dllLogLoss(){
  if(!_dllSettings.enabled)return;
  const inp=document.getElementById('dllLogUsdInput');
  const amount=parseFloat(inp?.value)||0;
  if(inp)inp.value='';
  // Append to localStorage as a manual entry (separate from actual trades)
  const log=_dllGetTodayLog();
  log.push({amount,timestamp:Date.now()});
  localStorage.setItem(_dllTodayKey(),JSON.stringify(log));
  // Re-check against DB (merges manual + actual trades)
  _dllCheckFromDB();
  showToast('Loss logged.','fa-solid fa-minus-circle','red');
}

function _dllCheckAndPersist(){
  if(!_dllSettings.enabled)return;
  const t=_dllGetTodayTotal();
  const hitLosses=_dllSettings.losses>0&&t.losses>=_dllSettings.losses;
  const hitUsd=_dllSettings.usd>0&&t.usd>=_dllSettings.usd;
  if(hitLosses||hitUsd){
    localStorage.setItem(DLL_STATE_KEY,JSON.stringify({hit:true,date:_dllToday()}));
    _dllFireAlert(t,hitLosses,hitUsd);
  }
}

// Query today's negative-PNL trades directly from Supabase
async function _dllQueryTodayFromDB(){
  try{
    if(!journalId)return null;
    const{data,error}=await db.from('trades').select('pnl')
      .eq('journal_id',journalId)
      .eq('trade_date',_dllToday())
      .lt('pnl',0);
    if(error||!data)return null;
    return{
      losses:data.length,
      usd:data.reduce((s,t)=>s+Math.abs(parseFloat(t.pnl)||0),0)
    };
  }catch{return null;}
}

// Primary check — DB is the single source of truth.
// Fires alert when over limit; clears ALL alert state when under limit.
async function _dllCheckFromDB(){
  if(!_dllSettings.enabled)return;
  const totals=await _dllQueryTodayFromDB();
  // If DB is unreachable don't touch state — avoids false clears on network hiccup
  if(!totals)return;
  dllRenderToday(totals);
  const hitLosses=_dllSettings.losses>0&&totals.losses>=_dllSettings.losses;
  const hitUsd=_dllSettings.usd>0&&totals.usd>=_dllSettings.usd;
  if(hitLosses||hitUsd){
    localStorage.setItem(DLL_STATE_KEY,JSON.stringify({hit:true,date:_dllToday()}));
    if(!document.body.classList.contains('dll-glow'))_dllFireAlert(totals,hitLosses,hitUsd);
    else _dllBroadcast(totals);
  }else{
    // Trades deleted / edited back below limit — clear everything
    const wasHit=!!localStorage.getItem(DLL_STATE_KEY)||document.body.classList.contains('dll-glow');
    localStorage.removeItem(DLL_STATE_KEY);
    localStorage.removeItem(_dllTodayKey()); // clear manual log too so it doesn't inflate future checks
    document.getElementById('dllOverlay')?.classList.remove('open');
    document.body.classList.remove('dll-glow');
    if(wasHit)bcast({type:'TG_LOSS_LIMIT_CLEAR'});
  }
}

function _dllFireAlert(totals,hitLosses,hitUsd){
  const parts=[];
  if(hitLosses)parts.push(`${totals.losses} loss${totals.losses!==1?'es':''} today`);
  if(hitUsd)parts.push(`$${totals.usd.toFixed(2)} lost today`);
  const subEl=document.getElementById('dllModalSub');
  if(subEl)subEl.textContent=parts.join(' · ');
  document.getElementById('dllOverlay')?.classList.add('open');
  _dllBroadcast(totals);
}

function _dllBroadcast(totals){
  const t=totals||_dllGetTodayTotal();
  bcast({type:'TG_LOSS_LIMIT_HIT',limitLosses:_dllSettings.losses,limitUsd:_dllSettings.usd,currentLosses:t.losses,currentUsd:t.usd});
}

function dllDismissOverlay(){
  document.getElementById('dllOverlay')?.classList.remove('open');
  document.body.classList.add('dll-glow');
  _dllBroadcast();
}

function _dllSendToFrame(frameName){
  if(!_dllSettings.enabled)return;
  try{
    const raw=localStorage.getItem(DLL_STATE_KEY);if(!raw)return;
    const state=JSON.parse(raw);
    if(state.hit&&state.date===_dllToday()){
      const map={logs:'logsFrame',presession:'presessionFrame',calendar:'calFrame',notes:'notesFrame',analytics:'analyticsFrame'};
      const f=document.getElementById(map[frameName]);
      const t=_dllGetTodayTotal();
      if(f?.contentWindow)f.contentWindow.postMessage({type:'TG_LOSS_LIMIT_HIT',limitLosses:_dllSettings.losses,limitUsd:_dllSettings.usd,currentLosses:t.losses,currentUsd:t.usd},'*');
    }
  }catch{}
}

function _dllCheckOnLoad(){
  dllLoadSettings();
  if(!_dllSettings.enabled)return;
  try{
    const raw=localStorage.getItem(DLL_STATE_KEY);if(!raw)return;
    const state=JSON.parse(raw);
    if(state.hit&&state.date===_dllToday())document.body.classList.add('dll-glow');
  }catch{}
}

// Midnight reset
(function _dllScheduleReset(){
  const now=new Date();
  const tomorrow=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,5);
  setTimeout(()=>{
    localStorage.removeItem(DLL_STATE_KEY);
    document.body.classList.remove('dll-glow');
    bcast({type:'TG_LOSS_LIMIT_CLEAR'});
    _dllScheduleReset();
  },tomorrow-now);
})();

_dllCheckOnLoad();

// Inline handlers in HTML call these by global name.
Object.assign(window, { addMoodTag, addTag, bnbClearFile, bnbDzDrop, bnbDzOver, bnbOnFileSelect, bnbRunImport, cCalc, checkDel, clearFile, closeDelJournal, closeExport, closeImport, closeMobSidebar, confirmExport, confirmImport, cSaveDefault, cSetAsset, cSetRiskMode, cSetSlMode, cSetTpMode, discardChanges, dllDismissOverlay, dllDismissTip, dllLogLoss, dllMarkDirty, dllSave, dllScrollToInput, dllToggleEnabled, dzDrop, dzOver, executeDelete, exportCSV, frameReady, fSetRiskMode, fSetSlMode, fSetTpMode, goBack, markDirty, mobSwitchTab, onFileSelect, onPinInput, openDelJournal, openExport, openImport, openMobSidebar, removeMoodTag, removePin, removeTag, saveJournalSettings, setImpMode, setScope, showPinForm, switchTab, toggleAnalyticsBar, toggleCalc, toggleFlag, toggleSidebar, undoTagRemove, updateMoodColor });
