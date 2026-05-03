window.addEventListener('message',e=>{
  if(e.data?.type==='tz_settings_updated')reloadSettings();
  if(e.data?.type==='tz_plan'&&e.data.isPro!==undefined)userIsPro=e.data.isPro;
  if(e.data?.type==='tz_flush_request')flushAll();
  if(e.data?.type==='tz_analytics_toggle'){analyticsOn=!!e.data.on;localStorage.setItem('tl_analytics_on',analyticsOn);applyAnalyticsState();updateAnalytics();}
  if(e.data?.type==='tz_presession_summary'){sessionStorage.setItem('tz_ps_summary',JSON.stringify(e.data));checkPresessionNudge();}
});
function getActiveIntent(){return null;} // legacy hook — pre-session intents removed in checklist refactor
// One-time-per-reset-cycle nudge: shows when the user lands on Logs after the
// active checklist set has reset and they haven't been prompted yet for that
// cycle. Detection is based on last_reset_at vs last_prompted_at supplied by
// the presession iframe; persistent flag is written back to Supabase so the
// prompt doesn't reappear on the same cycle in another tab.
function _psCycleStart(resetTimeStr){
  const [h,m]=String(resetTimeStr||'00:00').split(':').map(n=>parseInt(n,10)||0);
  const now=new Date();
  const c=new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m,0,0);
  if(c.getTime()>now.getTime())c.setDate(c.getDate()-1);
  return c.getTime();
}
function checkPresessionNudge(){
  const bar=document.getElementById('psNudgeBar');const msg=document.getElementById('psNudgeMsg');if(!bar||!msg)return;
  let s={};try{s=JSON.parse(sessionStorage.getItem('tz_ps_summary')||'{}');}catch(e){bar.style.display='none';return;}
  if(!s||!s.set_id){bar.style.display='none';return;}
  const cycleStart=s.reset_enabled?_psCycleStart(s.reset_time):0;
  const lastPrompted=s.last_prompted_at?new Date(s.last_prompted_at).getTime():0;
  const dismissedKey='tz_ps_dismiss_'+s.set_id;
  const localDismissed=parseInt(sessionStorage.getItem(dismissedKey)||'0',10);
  const alreadyPromptedThisCycle=lastPrompted>=cycleStart||localDismissed>=cycleStart;
  if(alreadyPromptedThisCycle){bar.style.display='none';return;}
  // Only nudge if the checklist actually still has unchecked items.
  if(!s.total||s.checked>=s.total){bar.style.display='none';return;}
  const remaining=s.total-s.checked;
  bar.style.display='flex';
  msg.textContent=`Pre-session reset — review your "${s.set_name||'checklist'}" before trading (${remaining} item${remaining===1?'':'s'} unchecked).`;
  // Persist the prompt so it doesn't fire again this cycle.
  sessionStorage.setItem(dismissedKey,Date.now().toString());
  try{
    if(typeof currentUser!=='undefined'&&currentUser?.id&&typeof upsertPresessionSetState==='function'){
      upsertPresessionSetState(currentUser.id,s.set_id,{last_prompted_at:new Date().toISOString()}).catch(()=>{});
    }
  }catch(e){}
}
function dismissPresessionNudge(){
  const bar=document.getElementById('psNudgeBar');if(bar)bar.style.display='none';
  try{const s=JSON.parse(sessionStorage.getItem('tz_ps_summary')||'{}');if(s?.set_id)sessionStorage.setItem('tz_ps_dismiss_'+s.set_id,Date.now().toString());}catch(e){}
}
function openPresessionFromNudge(){
  dismissPresessionNudge();
  try{parent.postMessage({type:'tz_open_tab',tab:'presession'},'*');}catch(e){}
}

const jid=sessionStorage.getItem('tz_current_journal')||localStorage.getItem('tz_current_journal')||(()=>{try{return parent?.sessionStorage?.getItem('tz_current_journal')||parent?.localStorage?.getItem('tz_current_journal');}catch(e){return null;}})();

let currentUser=null,currentProfile=null,trades=[],settings=null,userIsPro=false;
let analyticsOn=localStorage.getItem('tl_analytics_on')!=='false';
let pendingDelId=null,activeNotesId=null,imgBuffer=[],activePill=null;
// Set true when a realtime delta arrives during a user edit. Once edits
// settle, refreshTrades() reconciles by doing one full re-fetch.
let _staleFromRealtime=false;
let _ppCurrentId=null,_ppCurrentField=null;
const _saveTimers={};
const _valInputTimers={};
const _pending=new Set();
const _newDraftIds=new Set();
let sortDir='desc';
let searchQuery='';
let PAGE_SIZE=localStorage.getItem('logsPageSize')?parseInt(localStorage.getItem('logsPageSize')):10;
let currentPage=1;
let selectMode=false;
let selectedIds=new Set();
const G='#19c37d',R='#ff5f6d';
let _isEditing=false;
let _tempIdCounter=0;
let pageItems=[];
let _isSaving=false;
const _savingIndicators=new Map();
let _notesOriginalText='';
let _notesDirty=false;

// ─── DRAFT LOCK SYSTEM ────────────────────────────────────────────────────────
// Prevents any action (notes, new trade, etc.) while a draft has unsaved inputs
let _draftLockActive=false;

function isDraftLocked(){
  if(_newDraftIds.size===0)return false;
  return true;
}

// Rewrite every `id` and on* attribute inside a row from oldId → newId.
// Without this, inline handlers like oninput="onPairInput(this,'temp_xxx')"
// keep referencing the dead temp id after createTrade resolves, and any
// keystroke during/after the swap is silently dropped.
const _ON_ATTRS=['onclick','oninput','onchange','onblur','onfocus','onkeydown','onkeyup','onkeypress','onmousedown','onmouseup','onmouseover','onmouseout'];
function rebindRowId(tr,oldId,newId){
  if(!tr||oldId===newId)return;
  tr.querySelectorAll('[id]').forEach(el=>{
    if(el.id.includes(oldId))el.id=el.id.split(oldId).join(newId);
  });
  tr.querySelectorAll('*').forEach(el=>{
    for(const attr of _ON_ATTRS){
      const v=el.getAttribute(attr);
      if(v&&v.includes(oldId))el.setAttribute(attr,v.split(oldId).join(newId));
    }
  });
}

function flashDraftRow(id){
  const tr=document.querySelector(`tr[data-id="${id}"]`);
  if(!tr)return;
  tr.classList.remove('draft-flash');
  void tr.offsetWidth; // reflow
  tr.classList.add('draft-flash');
  setTimeout(()=>tr.classList.remove('draft-flash'),1200);
  tr.scrollIntoView({behavior:'smooth',block:'center'});
}

function showDraftBlockToast(){
  const draftId=[..._newDraftIds][0];
  showToast('Save or fill the current trade first.','fa-solid fa-triangle-exclamation','red');
  flashDraftRow(draftId);
  highlightEmpty(draftId);
}

// ─── LOCAL CACHE ──────────────────────────────────────────────────────────────
function getLocalCacheKey(id){return`tz_draft_${jid}_${id}`;}
function saveToLocalCache(id){
  const t=trades.find(x=>x.id===id);if(!t)return;
  try{
    const cache={pair:t.pair||'',position:t.position||'Long',pnl:t.pnl||'',r:t.r||'',confidence:t.confidence||0,date:t.date||'',time:t.time||'',strategy:t.strategy||[],timeframe:t.timeframe||[],mood:t.mood||[]};
    localStorage.setItem(getLocalCacheKey(id),JSON.stringify(cache));
  }catch(e){console.warn('Failed to save to local cache:',e);}
}
function restoreFromLocalCache(id){try{const cached=localStorage.getItem(getLocalCacheKey(id));if(!cached)return null;return JSON.parse(cached);}catch(e){console.warn('Failed to restore from local cache:',e);return null;}}
function clearLocalCache(id){try{localStorage.removeItem(getLocalCacheKey(id));}catch(e){console.warn('Failed to clear local cache:',e);}}

// One-time sweep for cache poisoned by the pre-fix captureActiveInputs bug —
// any tz_draft_* entry whose pnl or r is a formatted string (like "+$100.00")
// is wiped, otherwise it would re-overwrite the trade's real value on every
// reload. Safe to run repeatedly: only deletes entries that contain values
// parseFloat can't read.
function sweepMalformedCache(){
  try{
    const toDelete=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(!key||!key.startsWith('tz_draft_'))continue;
      try{
        const data=JSON.parse(localStorage.getItem(key)||'{}');
        const bad=v=>v!==''&&v!=null&&isNaN(parseFloat(v));
        if(bad(data.pnl)||bad(data.r))toDelete.push(key);
      }catch(_){toDelete.push(key);}
    }
    toDelete.forEach(k=>{try{localStorage.removeItem(k);}catch(_){}});
    if(toDelete.length)console.info(`[logs] cleaned ${toDelete.length} malformed cache entr${toDelete.length===1?'y':'ies'}`);
  }catch(e){console.warn('[logs] sweepMalformedCache failed:',e);}
}

// On init, walk every trade we just fetched and overlay any localStorage cache
// for that id. The cache only exists for trades the user typed into recently
// — usually because they refreshed during the autosave debounce window. We
// then re-schedule a save so the server gets the missed update.
//
// Defensive sanitisation: cache entries written by older builds may contain
// formatted display strings (`+$100.00`) for pnl/r — we strip those back to
// raw numbers before applying, otherwise we'd re-poison t.pnl with a NaN-
// producing value and the field would render gray + drop out of analytics.
function mergeLocalCacheIntoTrades(){
  trades.forEach(t=>{
    const cached=restoreFromLocalCache(t.id);
    if(!cached)return;
    let differs=false;
    const numericKeys={pnl:1,r:1};
    const keys=['pair','position','pnl','r','date','time','confidence'];
    for(const k of keys){
      let cv=cached[k];
      if(cv==null||cv==='')continue;
      if(numericKeys[k]){
        cv=_stripNumeric(cv);
        if(cv===''||isNaN(parseFloat(cv)))continue;
      }
      if(t[k]!==cv){t[k]=cv;differs=true;}
    }
    for(const k of ['strategy','timeframe','mood']){
      const cv=cached[k];
      if(!Array.isArray(cv)||!cv.length)continue;
      const sv=Array.isArray(t[k])?t[k]:[];
      if(JSON.stringify(sv)!==JSON.stringify(cv)){t[k]=cv;differs=true;}
    }
    if(differs){_pending.add(t.id);scheduleSave(t.id,true);}
  });
}

function showLoadingIndicator(el,show=true){if(!el)return;if(show){el.disabled=true;el.innerHTML=`<i class="fa-solid fa-spinner" style="animation:spin 1s linear infinite;margin-right:6px"></i>${el.dataset.originalText||'Loading...'}`;}else{el.disabled=false;el.innerHTML=el.dataset.originalText||el.innerHTML;}}

async function preSaveRow(id){if(id.startsWith('temp_'))return true;if(!_pending.has(id))return true;const row=document.querySelector(`tr[data-id="${id}"]`);if(!row)return true;_isSaving=true;try{await commitSave(id);return true;}catch(e){console.error('Pre-save failed:',e);showToast('Failed to save inputs. Please try again.','fa-solid fa-circle-exclamation','red');_isSaving=false;return false;}}

// Aggressive autosave: 400ms debounce after the last keystroke. The localStorage
// cache is written synchronously on every keystroke (saveToLocalCache), so even
// if the page is refreshed before the network save fires, no data is lost — the
// init path merges the cache back into the trades array.
const SAVE_DEBOUNCE_MS=400;
function scheduleSave(id,immediate=false){
  _pending.add(id);
  clearTimeout(_saveTimers[id]);
  clearTimeout(_saveTimers[id+'_c']);
  if(immediate){commitSave(id);return;}
  _saveTimers[id]=setTimeout(()=>commitSave(id),SAVE_DEBOUNCE_MS);
}

async function commitSave(id){
  if(!_pending.has(id))return;
  if(id.startsWith('temp_'))return;
  const t=trades.find(x=>x.id===id);
  if(!t){_pending.delete(id);_maybeReconcileStale();return;}
  clearTimeout(_saveTimers[id]);
  delete _saveTimers[id];
  const tr=document.querySelector(`tr[data-id="${id}"]`);
  if(tr){tr.classList.add('saving');}
  try{
    await updateTrade(id,t);
    _pending.delete(id);
    clearLocalCache(id);
    _isSaving=false;
    if(tr)tr.classList.remove('saving');
    // Tell parent (journal.html) — which then broadcasts to calendar / analytics
    // / notes iframes so they re-render with the latest pnl/r/etc. immediately.
    try{parent.postMessage({type:'tz_trades_changed',journalId:jid,tradeId:id},'*');}catch(_){}
    _maybeReconcileStale();
  }catch(e){
    _isSaving=false;
    if(tr)tr.classList.remove('saving');
    showToast('Save error: '+e.message,'fa-solid fa-circle-exclamation','red');
  }
}

// If realtime deltas were dropped during a user edit, re-fetch once when
// the edit settles so the table converges with the server.
function _maybeReconcileStale(){
  if(!_staleFromRealtime)return;
  if(_pending.size>0||_newDraftIds.size>0||_isUserEditingTable())return;
  _staleFromRealtime=false;
  refreshTrades();
}
// Safety net — checks every 5s in case all the per-edit hooks miss it
// (e.g. the user idled with focus in a cell but typed nothing).
setInterval(_maybeReconcileStale,5000);

async function flushAll(){const ids=[..._pending];if(!ids.length){try{parent.postMessage({type:'tz_flushed'},'*');}catch(e){}return;}try{await Promise.all(ids.map(id=>commitSave(id)));}finally{try{parent.postMessage({type:'tz_flushed'},'*');}catch(e){}}}

// Exposed diagnostic helpers. Reachable from this iframe's console as
// `tzDebug.*` and from the parent (journal.html) console as
// `logsFrame.contentWindow.tzDebug.*` — works regardless of where DevTools
// is attached. `missing()` lists trades whose pnl/r are empty/null in the DB
// (often because of the pre-fix corruption); `clearCache()` nukes the local
// draft cache for this journal.
window.tzDebug={
  missing(){
    const rows=trades.filter(t=>t.pnl===''||t.pnl==null||isNaN(parseFloat(t.pnl)))
      .map(t=>({id:t.id,date:t.date,pair:t.pair,pnl:t.pnl,r:t.r}));
    console.table(rows);
    return rows;
  },
  missingR(){
    const rows=trades.filter(t=>t.r===''||t.r==null||isNaN(parseFloat(t.r)))
      .map(t=>({id:t.id,date:t.date,pair:t.pair,pnl:t.pnl,r:t.r}));
    console.table(rows);
    return rows;
  },
  clearCache(){
    let n=0;
    for(let i=localStorage.length-1;i>=0;i--){
      const k=localStorage.key(i);
      if(k&&k.startsWith('tz_draft_')){localStorage.removeItem(k);n++;}
    }
    console.info(`Cleared ${n} draft cache entr${n===1?'y':'ies'}.`);
    return n;
  },
  trades(){return trades;},
};

function todayLocal(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function nowTimeLocal(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function fmt12(timeStr){if(!timeStr)return'';const[h,m]=timeStr.split(':').map(Number);const ampm=h>=12?'PM':'AM';const h12=h%12||12;return h12+':'+(String(m).padStart(2,'0'))+ampm;}

(async()=>{
  const{data:{user}}=await db.auth.getUser();
  currentUser=user;
  if(!currentUser||!jid){showToast('Session expired.','fa-solid fa-circle-exclamation','red');return;}
  try{userIsPro=parent?._userIsPro||false;}catch(e){}
  const _p=await getProfile(currentUser.id);if(_p){currentProfile=_p;userIsPro=_p.plan==='pro';}
  settings=await getJournalSettings(jid);
  const[raw,imgCounts]=await Promise.all([getTrades(jid),getImageCountsForJournal(currentUser.id)]);
  trades=raw.map(t=>{const dt=dbToTrade(t);return{...dt,images:Array(imgCounts[dt.id]||0).fill({})};});
  // First wipe any cache entries poisoned by the old captureActiveInputs bug,
  // then merge what's left. Without this, a stale "+$100.00" string in cache
  // would re-overwrite the trade's correct value and turn the cell gray again.
  sweepMalformedCache();
  // Recovery from immediate refresh: if the user typed something within the
  // 400ms autosave window and reloaded before the network update fired, the
  // server doesn't have it but localStorage does. Merge those values back into
  // trades[] AND re-schedule the save so the server eventually catches up.
  mergeLocalCacheIntoTrades();
  document.getElementById('skelTable').style.display='none';
  document.getElementById('tableWrap').style.display='block';
  applyAnalyticsState();
  updateAnalytics();
  render();
  document.body.style.visibility='visible';
  if(!userIsPro){document.getElementById('logsUpgradeNudge').style.display='flex';}
  // Realtime: apply inline deltas instead of refetching the entire trade list
  // on every event. If the user is mid-edit we drop the delta and mark the
  // view stale; the next idle tick reconciles via a single full refresh.
  subscribeTrades(jid,(payload)=>{
    if(_pending.size>0||_newDraftIds.size>0||_isUserEditingTable()){
      _staleFromRealtime=true;
      return;
    }
    if(!payload||!payload.eventType){
      // No payload (defensive) → fall back to full refresh.
      refreshTrades();
      return;
    }
    // Skip if this delta describes a row that's locally pending — our own
    // optimistic update is the source of truth until the save settles.
    const id=payload.new?.id||payload.old?.id;
    if(id&&_pending.has(id))return;
    trades=applyTradeDelta(trades,payload,(existing,incoming)=>({
      ...existing,...incoming,
      // Preserve image-count placeholders attached at load time; image
      // additions/removals come through their own realtime path.
      images:existing.images,
    }));
    updateAnalytics();render();
  });
  try{parent.postMessage({type:'tz_analytics_state',on:analyticsOn},'*');}catch(e){}
  checkPresessionNudge();
})();

async function reloadSettings(){settings=await getJournalSettings(jid);render();}
function _isUserEditingTable(){
  const ae=document.activeElement;
  return !!(ae&&ae!==document.body&&ae.closest&&ae.closest('#mainTable'));
}
async function refreshTrades(){
  // Don't refresh if there are unsaved drafts — would lose inputs
  if(_newDraftIds.size>0)return;
  // Don't refresh while user is mid-input or has pending unsaved keystrokes
  if(_pending.size>0)return;
  if(_isUserEditingTable())return;
  const r=await getTrades(jid);
  // Merge: keep existing image counts and any locally-mutated fields for trades
  // that are still _pending (defense in depth — _pending should be empty here).
  const existing=new Map(trades.map(t=>[t.id,t]));
  trades=r.map(row=>{
    const dt=dbToTrade(row);
    const ex=existing.get(dt.id);
    return{...dt,images:Array(ex?.images?.length||0).fill({})};
  });
  // Re-apply any localStorage cache that survived: if a save was in flight
  // when refresh started, the freshly-fetched server data may be missing the
  // last few keystrokes. Cache wins, then save catches up.
  mergeLocalCacheIntoTrades();
  updateAnalytics();render();
}

function moodStyle(m){const c=(settings?.mood_colors||{})[m];if(!c)return'';const[r,g,b]=[c.slice(1,3),c.slice(3,5),c.slice(5,7)].map(x=>parseInt(x,16));return`background:rgba(${r},${g},${b},.15);color:${c};border-color:rgba(${r},${g},${b},.35)`;}
function getTags(field){const k={strategy:'strategies',timeframe:'timeframes',mood:'moods',pair:'pairs'}[field];return settings?.[k]||[];}
function getPairSuggestions(){return[...new Set([...(settings?.pairs||[]),...trades.map(t=>(t.pair||'').toUpperCase()).filter(Boolean)])].sort();}
function fmtVal(v,type){const n=parseFloat(v);if(isNaN(n)||v==null||v==='')return'';return type==='pnl'?(n>=0?'+':'-')+'$'+Math.abs(n).toFixed(2):(n>=0?'+':'')+n.toFixed(2)+'R';}
// Color rules:
//   empty / not-a-number → muted gray (placeholder state)
//   positive             → green
//   negative             → red
//   zero (breakeven)     → normal text color (NOT muted — a real value was entered)
function pnlCol(v){
  if(v===''||v==null)return'var(--muted)';
  const n=parseFloat(v);
  if(isNaN(n))return'var(--muted)';
  return n>0?G:n<0?R:'var(--text)';
}
function esc(s){const d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML;}

// ─── FILTER MODAL ─────────────────────────────────────────────────────────────
let _fmOpen=false,_fmConfSel=0,_fmDragging=false,_fmDragOffX=0,_fmDragOffY=0,_fmPosX=null,_fmPosY=null;
let fmCalYear=new Date().getFullYear(),fmCalMonth=new Date().getMonth();
let fmRangeStart='',fmRangeEnd='',fmPickingEnd=false;
const MONTHS_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fState={date:{from:'',to:''},pair:[],position:[],strategy:[],timeframe:[],mood:[],confidence:0};

function toggleFilterModal(btn){
  if(_fmOpen){closeFilterModal();return;}
  _fmOpen=true;
  const modal=document.getElementById('filterModal'),backdrop=document.getElementById('filterBackdrop');
  btn.classList.add('open');backdrop.classList.add('open');modal.classList.remove('closing');modal.classList.add('open');
  if(window.innerWidth>520){
    const isMobile=window.innerWidth<=768;
    if(!isMobile&&_fmPosX!==null){modal.style.left=_fmPosX+'px';modal.style.top=_fmPosY+'px';}
    else{
      modal.style.left='';modal.style.top='';modal.style.right='';modal.style.bottom='';
      const rect=btn.getBoundingClientRect(),mw=Math.min(480,window.innerWidth*.96);
      let left=rect.left+window.scrollX;
      if(left+mw>window.innerWidth-8)left=window.innerWidth-mw-8;
      const top=rect.bottom+window.scrollY+6;
      modal.style.left=Math.max(4,left)+'px';modal.style.top=top+'px';
      _fmPosX=Math.max(4,left);_fmPosY=top;
    }
  }else{modal.style.left='';modal.style.top='';_fmPosX=null;_fmPosY=null;}
  fmPopulateAll();
  fmRangeStart=fState.date.from||'';fmRangeEnd=fState.date.to||'';fmPickingEnd=false;
  if(fmRangeStart){const p=fmRangeStart.split('-');fmCalYear=parseInt(p[0]);fmCalMonth=parseInt(p[1])-1;}
  else{fmCalYear=new Date().getFullYear();fmCalMonth=new Date().getMonth();}
  fmRenderCal();fmUpdateDisplay();fmUpdateResultCount();
  document.getElementById('fmTitlebar').addEventListener('mousedown',fmDragStart);
  document.getElementById('fmTitlebar').addEventListener('touchstart',fmTouchStart,{passive:false});
  document.addEventListener('keydown',fmKeyHandler);
}

function closeFilterModal(){
  if(!_fmOpen)return;_fmOpen=false;
  const modal=document.getElementById('filterModal'),backdrop=document.getElementById('filterBackdrop');
  document.getElementById('btnFilter').classList.remove('open');
  modal.classList.add('closing');backdrop.classList.remove('open');
  setTimeout(()=>{modal.classList.remove('open','closing');},160);
  document.getElementById('fmTitlebar').removeEventListener('mousedown',fmDragStart);
  document.getElementById('fmTitlebar').removeEventListener('touchstart',fmTouchStart);
  document.removeEventListener('keydown',fmKeyHandler);
}
function fmKeyHandler(e){if(e.key==='Escape')closeFilterModal();}

function fmDragStart(e){if(e.target.closest('.fm-close'))return;if(window.innerWidth<=520)return;e.preventDefault();const modal=document.getElementById('filterModal'),rect=modal.getBoundingClientRect();_fmDragging=true;_fmDragOffX=e.clientX-rect.left;_fmDragOffY=e.clientY-rect.top;modal.style.transition='none';document.addEventListener('mousemove',fmDragMove);document.addEventListener('mouseup',fmDragEnd);}
function fmDragMove(e){if(!_fmDragging)return;const modal=document.getElementById('filterModal');let x=e.clientX-_fmDragOffX,y=e.clientY-_fmDragOffY;x=Math.max(0,Math.min(window.innerWidth-modal.offsetWidth,x));y=Math.max(0,Math.min(window.innerHeight-60,y));modal.style.left=x+'px';modal.style.top=y+'px';_fmPosX=x;_fmPosY=y;}
function fmDragEnd(){_fmDragging=false;document.getElementById('filterModal').style.transition='';document.removeEventListener('mousemove',fmDragMove);document.removeEventListener('mouseup',fmDragEnd);}
function fmTouchStart(e){if(e.target.closest('.fm-close'))return;if(window.innerWidth<=520)return;const touch=e.touches[0],modal=document.getElementById('filterModal'),rect=modal.getBoundingClientRect();_fmDragging=true;_fmDragOffX=touch.clientX-rect.left;_fmDragOffY=touch.clientY-rect.top;modal.style.transition='none';document.addEventListener('touchmove',fmTouchMove,{passive:false});document.addEventListener('touchend',fmTouchEnd);}
function fmTouchMove(e){if(!_fmDragging)return;e.preventDefault();const touch=e.touches[0],modal=document.getElementById('filterModal');let x=touch.clientX-_fmDragOffX,y=touch.clientY-_fmDragOffY;x=Math.max(0,Math.min(window.innerWidth-modal.offsetWidth,x));y=Math.max(0,Math.min(window.innerHeight-60,y));modal.style.left=x+'px';modal.style.top=y+'px';_fmPosX=x;_fmPosY=y;}
function fmTouchEnd(){_fmDragging=false;document.getElementById('filterModal').style.transition='';document.removeEventListener('touchmove',fmTouchMove);document.removeEventListener('touchend',fmTouchEnd);}

function fmPopulateAll(){
  fmPopulateChips('pair',getPairSuggestions(),false);
  fmPopulateChips('strategy',settings?.strategies||[],false);
  fmPopulateChips('timeframe',settings?.timeframes||[],false);
  fmPopulateMoodChips();
  document.getElementById('fm-sort-desc').classList.toggle('sel',sortDir==='desc');
  document.getElementById('fm-sort-asc').classList.toggle('sel',sortDir==='asc');
  document.querySelectorAll('.fm-chip[data-field="position"]').forEach(chip=>{chip.classList.toggle('sel',fState.position.includes(chip.dataset.value));});
  _fmConfSel=fState.confidence;
  document.querySelectorAll('.fm-star-chip').forEach(s=>{s.classList.toggle('sel',parseInt(s.dataset.v)===_fmConfSel);});
}
function fmPopulateChips(field,items){
  const el=document.getElementById('fm-'+field+'-chips');if(!el)return;
  const sel=fState[field]||[];
  if(!items.length){el.innerHTML='<span style="font-size:11px;color:var(--muted)">No tags yet</span>';return;}
  el.innerHTML='';
  items.forEach(item=>{const chip=document.createElement('div');chip.className='fm-chip'+(sel.includes(item)?' sel':'');chip.dataset.field=field;chip.dataset.value=item;chip.textContent=item;chip.addEventListener('click',()=>fmToggleChip(chip));el.appendChild(chip);});
}
function fmPopulateMoodChips(){
  const el=document.getElementById('fm-mood-chips');if(!el)return;
  const moods=settings?.moods||[],colors=settings?.mood_colors||{},sel=fState.mood||[];
  if(!moods.length){el.innerHTML='<span style="font-size:11px;color:var(--muted)">No moods yet</span>';return;}
  el.innerHTML='';
  moods.forEach(m=>{
    const chip=document.createElement('div');chip.className='fm-chip'+(sel.includes(m)?' sel':'');chip.dataset.field='mood';chip.dataset.value=m;
    const c=colors[m];
    if(c){const dot=document.createElement('span');dot.style.cssText=`display:inline-block;width:7px;height:7px;border-radius:50%;background:${c};margin-right:4px;flex-shrink:0`;chip.appendChild(dot);if(sel.includes(m)){const[r,g,b]=[c.slice(1,3),c.slice(3,5),c.slice(5,7)].map(x=>parseInt(x,16));chip.style.cssText=`background:rgba(${r},${g},${b},.15);color:${c};border-color:rgba(${r},${g},${b},.45)`;}}
    chip.appendChild(document.createTextNode(m));chip.addEventListener('click',()=>fmToggleChip(chip));el.appendChild(chip);
  });
}
function fmToggleChip(chip){
  const field=chip.dataset.field,value=chip.dataset.value;if(!field||!value)return;
  chip.classList.toggle('sel');const isSel=chip.classList.contains('sel');
  if(field==='position'){if(isSel&&!fState.position.includes(value))fState.position.push(value);else fState.position=fState.position.filter(v=>v!==value);}
  else{if(isSel&&!fState[field].includes(value))fState[field].push(value);else fState[field]=fState[field].filter(v=>v!==value);}
  if(field==='mood'){const colors=settings?.mood_colors||{},c=colors[value];if(c){const[r,g,b]=[c.slice(1,3),c.slice(3,5),c.slice(5,7)].map(x=>parseInt(x,16));chip.style.cssText=isSel?`background:rgba(${r},${g},${b},.15);color:${c};border-color:rgba(${r},${g},${b},.45)`:'';}};
  fmApply();
}
function fmSetSort(dir){sortDir=dir;document.getElementById('fm-sort-desc').classList.toggle('sel',dir==='desc');document.getElementById('fm-sort-asc').classList.toggle('sel',dir==='asc');fmApply();}
function fmStarClick(v){_fmConfSel=_fmConfSel===v?0:v;fState.confidence=_fmConfSel;document.querySelectorAll('.fm-star-chip').forEach(s=>{s.classList.toggle('sel',parseInt(s.dataset.v)===_fmConfSel);});fmApply();}
function fmApply(){currentPage=1;updateFilterCountBadge();updateAnalytics();render();fmUpdateDisplay();fmUpdateResultCount();}

function fmUpdateDisplay(){
  const display=document.getElementById('fmDisplay'),emptyEl=document.getElementById('fmDisplayEmpty'),countEl=document.getElementById('fmDisplayCount');
  const tags=[];
  if(fState.date.from||fState.date.to){const from=fState.date.from||'…',to=fState.date.to||'…';tags.push({label:from===to?from:`${from} → ${to}`,field:'date',value:''});}
  fState.position.forEach(v=>tags.push({label:v,field:'position',value:v}));
  fState.pair.forEach(v=>tags.push({label:v,field:'pair',value:v}));
  fState.strategy.forEach(v=>tags.push({label:v,field:'strategy',value:v}));
  fState.timeframe.forEach(v=>tags.push({label:v,field:'timeframe',value:v}));
  fState.mood.forEach(v=>tags.push({label:v,field:'mood',value:v}));
  if(fState.confidence>0)tags.push({label:'★'.repeat(fState.confidence)+'+',field:'confidence',value:fState.confidence});
  if(searchQuery.trim())tags.push({label:`"${searchQuery}"`,field:'search',value:''});
  [...display.children].forEach(el=>{if(!el.classList.contains('fm-display-empty')&&!el.classList.contains('fm-display-count'))el.remove();});
  if(tags.length===0){emptyEl.style.display='';countEl.textContent='';}
  else{
    emptyEl.style.display='none';
    tags.forEach(tag=>{const span=document.createElement('span');span.className='fm-active-tag';span.innerHTML=esc(tag.label);const xBtn=document.createElement('button');xBtn.className='fm-tag-x';xBtn.innerHTML='<i class="fa-solid fa-xmark"></i>';xBtn.onclick=(e)=>{e.stopPropagation();fmRemoveTag(tag);};span.appendChild(xBtn);display.insertBefore(span,countEl);});
    countEl.textContent=tags.length+' filter'+(tags.length!==1?'s':'');
  }
}
function fmRemoveTag(tag){
  if(tag.field==='date'){fState.date={from:'',to:''};fmRangeStart='';fmRangeEnd='';fmPickingEnd=false;fmRenderCal();}
  else if(tag.field==='confidence'){fState.confidence=0;_fmConfSel=0;document.querySelectorAll('.fm-star-chip').forEach(s=>s.classList.remove('sel'));}
  else if(tag.field==='search'){clearSearch();return;}
  else if(tag.field==='position'){fState.position=fState.position.filter(v=>v!==tag.value);document.querySelectorAll(`.fm-chip[data-field="position"][data-value="${tag.value}"]`).forEach(c=>c.classList.remove('sel'));}
  else{fState[tag.field]=fState[tag.field].filter(v=>v!==tag.value);document.querySelectorAll(`.fm-chip[data-field="${tag.field}"][data-value="${CSS.escape(tag.value)}"]`).forEach(c=>c.classList.remove('sel'));}
  fmApply();
}
function fmUpdateResultCount(){document.getElementById('fmResultNum').textContent=getFilteredTrades().length;}

function fmCalNav(dir){fmCalMonth+=dir;if(fmCalMonth>11){fmCalMonth=0;fmCalYear++;}if(fmCalMonth<0){fmCalMonth=11;fmCalYear--;}fmRenderCal();}
function fmRenderCal(){
  document.getElementById('fm-cal-month-lbl').textContent=MONTHS_SHORT[fmCalMonth]+' '+fmCalYear;
  const grid=document.getElementById('fm-cal-grid');grid.innerHTML='';
  const firstDay=new Date(fmCalYear,fmCalMonth,1);let startDow=firstDay.getDay()-1;if(startDow<0)startDow=6;
  const daysInMonth=new Date(fmCalYear,fmCalMonth+1,0).getDate(),todayStr=todayLocal();
  for(let i=0;i<startDow;i++){const el=document.createElement('div');el.className='fm-cal-day empty-day';grid.appendChild(el);}
  for(let d=1;d<=daysInMonth;d++){
    const ds=fmCalYear+'-'+String(fmCalMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const el=document.createElement('div');el.className='fm-cal-day';el.textContent=d;
    if(ds===todayStr)el.classList.add('today');
    if(fmRangeStart&&fmRangeEnd){const lo=fmRangeStart<=fmRangeEnd?fmRangeStart:fmRangeEnd,hi=fmRangeStart<=fmRangeEnd?fmRangeEnd:fmRangeStart;if(ds>lo&&ds<hi)el.classList.add('in-range');if(ds===lo)el.classList.add('range-start');if(ds===hi)el.classList.add('range-end');}
    else if(fmRangeStart&&ds===fmRangeStart)el.classList.add('range-start');
    el.addEventListener('click',()=>fmCalDayClick(ds));grid.appendChild(el);
  }
  document.getElementById('fm-range-from-lbl').textContent=fmRangeStart||'—';
  document.getElementById('fm-range-to-lbl').textContent=fmRangeEnd||'—';
}
function fmCalDayClick(ds){
  if(!fmPickingEnd){fmRangeStart=ds;fmRangeEnd='';fmPickingEnd=true;}
  else{if(ds===fmRangeStart){fmRangeEnd=ds;}else if(ds<fmRangeStart){fmRangeEnd=fmRangeStart;fmRangeStart=ds;}else{fmRangeEnd=ds;}fmPickingEnd=false;const lo=fmRangeStart<=fmRangeEnd?fmRangeStart:fmRangeEnd,hi=fmRangeStart<=fmRangeEnd?fmRangeEnd:fmRangeStart;fState.date.from=lo;fState.date.to=hi;fmApply();}
  fmRenderCal();
}

function resetAllFilters(){
  fState.date={from:'',to:''};fState.pair=[];fState.position=[];fState.strategy=[];fState.timeframe=[];fState.mood=[];fState.confidence=0;
  fmRangeStart='';fmRangeEnd='';fmPickingEnd=false;fmCalYear=new Date().getFullYear();fmCalMonth=new Date().getMonth();
  sortDir='desc';_fmConfSel=0;fmPopulateAll();fmRenderCal();currentPage=1;updateFilterCountBadge();updateAnalytics();render();fmUpdateDisplay();fmUpdateResultCount();
}
function updateFilterCountBadge(){
  const checks=[!!(fState.date.from||fState.date.to),fState.pair.length>0,fState.position.length>0,fState.strategy.length>0,fState.timeframe.length>0,fState.mood.length>0,fState.confidence>0];
  const count=checks.filter(Boolean).length;
  const badge=document.getElementById('filterCountBadge'),clearBtn=document.getElementById('btnFilterClear'),btn=document.getElementById('btnFilter');
  badge.textContent=count;badge.classList.toggle('show',count>0);clearBtn.classList.toggle('show',count>0||searchQuery.trim()!=='');btn.classList.toggle('active',count>0);
  const totalFiltered=getFilteredTrades().length,hasFilter=count>0||searchQuery.trim()!=='';
  document.getElementById('fbCount').textContent=hasFilter?`${totalFiltered} of ${trades.length} trade${trades.length!==1?'s':''}`:'';}
function clearAllFilters(){
  fState.date={from:'',to:''};fState.pair=[];fState.position=[];fState.strategy=[];fState.timeframe=[];fState.mood=[];fState.confidence=0;
  fmRangeStart='';fmRangeEnd='';fmPickingEnd=false;sortDir='desc';_fmConfSel=0;
  clearSearch();currentPage=1;updateFilterCountBadge();updateAnalytics();render();
  if(_fmOpen){fmPopulateAll();fmRenderCal();fmUpdateDisplay();fmUpdateResultCount();}
}

function onSearchInput(val){searchQuery=val;document.getElementById('searchClear').classList.toggle('show',val.trim()!=='');currentPage=1;updateFilterCountBadge();updateAnalytics();render();if(_fmOpen){fmUpdateDisplay();fmUpdateResultCount();}}
function clearSearch(){searchQuery='';document.getElementById('globalSearch').value='';document.getElementById('searchClear').classList.remove('show');currentPage=1;updateFilterCountBadge();updateAnalytics();render();if(_fmOpen){fmUpdateDisplay();fmUpdateResultCount();}}
function tradeMatchesSearch(t,q){if(!q.trim())return true;const lq=q.toLowerCase();const fields=[t.pair||'',t.date||'',t.time||'',t.position||'',...(t.strategy||[]),...(t.timeframe||[]),...(t.mood||[]),t.pnl!=null?String(t.pnl):'',t.r!=null?String(t.r):'',t.notes||''];return fields.some(f=>f.toLowerCase().includes(lq));}

function getFilteredTrades(){
  let items=[...trades];const f=fState;
  if(f.date.from)items=items.filter(t=>t.date&&t.date>=f.date.from);
  if(f.date.to)items=items.filter(t=>t.date&&t.date<=f.date.to);
  if(f.pair.length)items=items.filter(t=>f.pair.includes((t.pair||'').toUpperCase()));
  if(f.position.length)items=items.filter(t=>f.position.includes(t.position));
  if(f.strategy.length)items=items.filter(t=>(t.strategy||[]).some(s=>f.strategy.includes(s)));
  if(f.timeframe.length)items=items.filter(t=>(t.timeframe||[]).some(s=>f.timeframe.includes(s)));
  if(f.mood.length)items=items.filter(t=>(t.mood||[]).some(s=>f.mood.includes(s)));
  if(f.confidence>0)items=items.filter(t=>(t.confidence||0)>=f.confidence);
  if(searchQuery.trim())items=items.filter(t=>tradeMatchesSearch(t,searchQuery));
  items.sort((a,b)=>{const da=a.date||'',db=b.date||'';return sortDir==='asc'?da.localeCompare(db):db.localeCompare(da);});
  return items;
}

// After every render we re-overlay any localStorage cache on top of the just-
// rendered DOM. This handles the case where a render happened while a save was
// still in flight and the in-memory trade had stale values.
//
// The previous implementation only set `.value` on the inputs — it did NOT
// update the inline color, so a freshly-rendered "muted" PnL/R input kept its
// gray color even after the cached value was restored. It also didn't write
// the cached values back into trades[], so the next render again saw t.pnl=''
// and re-painted the field gray, requiring the user to click into the cell.
function restoreCachedValues(){
  pageItems.forEach(t=>{
    const cached=restoreFromLocalCache(t.id);
    if(!cached)return;
    const tr=document.querySelector(`tr[data-id="${t.id}"]`);
    if(!tr)return;
    const pnlEl=document.getElementById('pnl_'+t.id),
          rEl=document.getElementById('r_'+t.id),
          posEl=document.getElementById('pos_'+t.id),
          dateEl=document.getElementById('dinp_'+t.id),
          timeEl=document.getElementById('tinp_'+t.id);
    const pairEl=tr.querySelector('.pw-cell input');
    if(pairEl&&cached.pair){pairEl.value=cached.pair.toUpperCase();t.pair=cached.pair.toUpperCase();}
    if(pnlEl&&cached.pnl!==undefined&&cached.pnl!==''){
      const cleanPnl=_stripNumeric(cached.pnl);
      if(cleanPnl!==''&&!isNaN(parseFloat(cleanPnl))){
        pnlEl.value=fmtVal(cleanPnl,'pnl');
        pnlEl.style.color=pnlCol(cleanPnl);
        t.pnl=cleanPnl;
      }
    }
    if(rEl&&cached.r!==undefined&&cached.r!==''){
      const cleanR=_stripNumeric(cached.r);
      if(cleanR!==''&&!isNaN(parseFloat(cleanR))){
        rEl.value=fmtVal(cleanR,'r');
        rEl.style.color=pnlCol(cleanR);
        t.r=cleanR;
      }
    }
    if(posEl&&cached.position){posEl.value=cached.position;t.position=cached.position;}
    if(dateEl&&cached.date){dateEl.value=cached.date;t.date=cached.date;}
    if(timeEl&&cached.time){timeEl.value=cached.time;t.time=cached.time;}
  });
}

let _renderQueued=false;
function render(){
  if(_isEditing||_isUserEditingTable()){_renderQueued=true;return;}
  _renderQueued=false;
  captureActiveInputs();
  const tb=document.getElementById('tbody'),filtered=getFilteredTrades();
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  if(currentPage>totalPages)currentPage=totalPages;
  if(!filtered.length){const msg=trades.length?'No trades match your filters.':'No trades yet. Click "+ Add Trade" to begin.';const icon=trades.length?'fa-solid fa-filter':'fa-solid fa-inbox';tb.innerHTML=`<tr class="er"><td colspan="12"><i class="${icon}" style="font-size:28px;display:block;margin-bottom:12px;opacity:.3"></i>${msg}</td></tr>`;renderPagination(0,1,1);return;}
  const startIdx=(currentPage-1)*PAGE_SIZE;pageItems=filtered.slice(startIdx,startIdx+PAGE_SIZE);
  tb.innerHTML='';pageItems.forEach((t,i)=>tb.appendChild(buildRow(t,startIdx+i+1)));
  document.getElementById('mainTable').classList.toggle('select-mode',selectMode);
  pageItems.forEach(t=>{if(selectedIds.has(t.id)){const cb=document.getElementById('cb_'+t.id);if(cb)cb.checked=true;const tr=document.querySelector(`tr[data-id="${t.id}"]`);if(tr)tr.classList.add('selected-row');}});
  restoreCachedValues();
  renderPagination(filtered.length,currentPage,totalPages);
  setTimeout(()=>{const tw=document.getElementById('tableWrap');if(tw)tw.scrollTop=0;},0);
}
function renderPagination(total,page,totalPages){
  const bar=document.getElementById('paginationBar');
  if(totalPages<=1){bar.innerHTML='';return;}
  let html=`<button class="pg-btn" onclick="goPage(${page-1})" ${page<=1?'disabled':''}><i class="fa-solid fa-chevron-left" style="font-size:10px"></i></button>`;
  const pageNums=getPageNums(page,totalPages);let prevEllipsis=false;
  for(const p of pageNums){if(p===null){if(!prevEllipsis)html+=`<span class="pg-ellipsis">…</span>`;prevEllipsis=true;}else{prevEllipsis=false;html+=`<button class="pg-btn${p===page?' active':''}" onclick="goPage(${p})">${p}</button>`;}}
  html+=`<button class="pg-btn" onclick="goPage(${page+1})" ${page>=totalPages?'disabled':''}><i class="fa-solid fa-chevron-right" style="font-size:10px"></i></button>`;
  html+=`<span class="pg-info">${page} / ${totalPages}</span>`;
  bar.innerHTML=html;
}
function getPageNums(cur,total){if(total<=7)return Array.from({length:total},(_,i)=>i+1);const nums=[1];if(cur>3)nums.push(null);for(let p=Math.max(2,cur-1);p<=Math.min(total-1,cur+1);p++)nums.push(p);if(cur<total-2)nums.push(null);nums.push(total);return nums;}
function goPage(p){const filtered=getFilteredTrades(),totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));currentPage=Math.max(1,Math.min(totalPages,p));render();document.getElementById('tableWrap').scrollIntoView({behavior:'smooth',block:'nearest'});}
function changePageSize(newSize){PAGE_SIZE=newSize;localStorage.setItem('logsPageSize',newSize);currentPage=1;document.getElementById('pageSizeSelect').value=newSize;render();}

function toggleSelectMode(){
  if(isDraftLocked()){showDraftBlockToast();return;}
  selectMode=!selectMode;const btn=document.getElementById('btnSelectMode'),inlineEl=document.getElementById('selectInline');
  if(selectMode){selectedIds.clear();btn.classList.add('active');btn.textContent='Cancel';inlineEl.classList.add('show');updateSelectUI();render();}
  else{exitSelectMode();}
}
function exitSelectMode(){selectMode=false;selectedIds.clear();const btn=document.getElementById('btnSelectMode');btn.classList.remove('active');btn.textContent='Select';document.getElementById('selectInline').classList.remove('show');document.getElementById('mainTable').classList.remove('select-mode');render();}
function toggleRowSelect(id){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);const cb=document.getElementById('cb_'+id);if(cb)cb.checked=selectedIds.has(id);const tr=document.querySelector(`tr[data-id="${id}"]`);if(tr)tr.classList.toggle('selected-row',selectedIds.has(id));updateSelectUI();}
function selectAllPage(){const filtered=getFilteredTrades(),startIdx=(currentPage-1)*PAGE_SIZE,pageItems=filtered.slice(startIdx,startIdx+PAGE_SIZE),allSel=pageItems.every(t=>selectedIds.has(t.id));if(allSel){pageItems.forEach(t=>selectedIds.delete(t.id));}else{pageItems.forEach(t=>selectedIds.add(t.id));}pageItems.forEach(t=>{const cb=document.getElementById('cb_'+t.id);if(cb)cb.checked=selectedIds.has(t.id);const tr=document.querySelector(`tr[data-id="${t.id}"]`);if(tr)tr.classList.toggle('selected-row',selectedIds.has(t.id));});updateSelectUI();}
function updateSelectUI(){const n=selectedIds.size;document.getElementById('selCountLbl').textContent=n===0?'0 selected':`${n} selected`;const delBtn=document.getElementById('btnDelSelected');delBtn.disabled=n===0;delBtn.innerHTML=`<i class="fa-solid fa-trash"></i> Delete${n>0?' ('+n+')':''}`;;}
function askDelSelected(){if(selectedIds.size===0)return;document.getElementById('mDelCount').textContent=selectedIds.size;document.getElementById('mDelOverlay').classList.add('open');}
function closeMDel(){document.getElementById('mDelOverlay').classList.remove('open');}
async function confirmMultiDelete(){
  const ids=[...selectedIds];
  const progressEl=document.getElementById('mDelProgress');
  const msgEl=document.getElementById('mDelMsg');
  const cancelBtn=document.getElementById('mDelCancel');
  const confirmBtn=document.getElementById('mDelConfirm');

  if(msgEl)msgEl.style.display='none';
  if(progressEl){progressEl.style.display='block';document.getElementById('mDelStatus').textContent='0 / '+ids.length;}
  if(cancelBtn)cancelBtn.disabled=true;
  if(confirmBtn)confirmBtn.disabled=true;

  let deleted=0;
  try{
    for(const id of ids){
      try{await deleteTrade(id);}catch(e){console.error('Failed to delete trade:',id,e);}
      _pending.delete(id);
      deleted++;
      const barEl=document.getElementById('mDelBar');
      const statusEl=document.getElementById('mDelStatus');
      if(barEl){barEl.style.width=(deleted/ids.length*100)+'%';}
      if(statusEl){statusEl.textContent=deleted+' / '+ids.length;}
    }
    trades=trades.filter(t=>!ids.includes(t.id));
    selectedIds.clear();
    closeMDel();
    exitSelectMode();
    updateAnalytics();
    showToast(`${ids.length} trade${ids.length!==1?'s':''} deleted.`,'fa-solid fa-circle-check','green');
  }catch(e){
    showToast('Delete error: '+e.message,'fa-solid fa-circle-exclamation','red');
    if(msgEl)msgEl.style.display='block';
    if(progressEl)progressEl.style.display='none';
    if(cancelBtn)cancelBtn.disabled=false;
    if(confirmBtn)confirmBtn.disabled=false;
  }
}

function buildNotesBtnHTML(t){const hasNotes=t.notes&&t.notes.trim(),imgCount=t.images&&t.images.length>0?t.images.length:0,hasContent=hasNotes||imgCount>0,badgeHTML=imgCount>0?`<span class="notes-img-badge">${imgCount}</span>`:'',iconHTML=hasContent?`<i class="fa-solid fa-note-sticky"></i>`:`<i class="fa-solid fa-note-sticky" style="opacity:.4"></i>`;return{cls:`notes-btn${hasContent?' hc':''}`,html:`${iconHTML}${badgeHTML}`};}
function buildRow(t,num){
  const tr=document.createElement('tr');tr.dataset.id=t.id;
  const nb=buildNotesBtnHTML(t),isLong=t.position!=='Short';
  tr.innerHTML=`<td class="row-cb-cell"><input type="checkbox" class="row-cb" id="cb_${t.id}" onchange="toggleRowSelect('${t.id}')"></td><td><div class="dt-cell" id="dcel_${t.id}"><div style="display:flex;flex-direction:column;align-items:center;gap:2px"><div style="display:flex;align-items:center;gap:3px"><span class="dt-val${t.date?'':' empty'}" id="dval_${t.id}" onclick="toggleDtEdit('${t.id}','date')" style="cursor:pointer">${t.date||'—'}</span><input class="dt-input" type="date" id="dinp_${t.id}" value="${t.date||''}" autocomplete="off" onblur="commitDtEdit('${t.id}','date')" onkeydown="dtKey(event,'${t.id}','date')"></div><div style="display:flex;align-items:center;gap:3px"><span class="dt-val${t.time?'':' empty'}" id="tval_${t.id}" onclick="toggleDtEdit('${t.id}','time')" style="font-size:10px;color:var(--muted);cursor:pointer">${t.time?fmt12(t.time):'—'}</span><input class="dt-input" type="time" id="tinp_${t.id}" value="${t.time||''}" autocomplete="off" onblur="commitDtEdit('${t.id}','time')" onkeydown="dtKey(event,'${t.id}','time')"></div></div></div></td><td class="pw-cell"><input class="ci" value="${esc(t.pair||'')}" placeholder="EURUSD" oninput="onPairInput(this,'${t.id}')" onfocus="showSugOnFocus(this,'${t.id}')" autocomplete="off" onblur="confirmPair('${t.id}',this);hideSug()" style="min-width:80px"><div class="sugs" id="sug_${t.id}" style="display:none"></div></td><td><select class="csel ${isLong?'long':'short'}" id="pos_${t.id}" onchange="updPos(this,'${t.id}')"><option ${isLong?'selected':''}>Long</option><option ${!isLong?'selected':''}>Short</option></select></td><td><div class="tc" id="st_${t.id}" onclick="openPP(event,'${t.id}','strategy')">${buildPills(t.strategy)}</div></td><td><div class="tc" id="tf_${t.id}" onclick="openPP(event,'${t.id}','timeframe')">${buildPills(t.timeframe)}</div></td><td><input class="ci" id="pnl_${t.id}" type="text" inputmode="decimal" autocomplete="off" value="${fmtVal(t.pnl,'pnl')}" placeholder="0.00" onfocus="vFocus(this)" oninput="onValInput('${t.id}','pnl',this.value)" onkeydown="numericOnly(event)" onblur="vBlur(this,'${t.id}','pnl')" style="min-width:58px;font-weight:600;font-family:var(--font-mono,'Space Grotesk',sans-serif);color:${pnlCol(t.pnl)}"></td><td><input class="ci" id="r_${t.id}" type="text" inputmode="decimal" autocomplete="off" value="${fmtVal(t.r,'r')}" placeholder="+2R" onfocus="vFocus(this)" oninput="onValInput('${t.id}','r',this.value)" onkeydown="numericOnly(event)" onblur="vBlur(this,'${t.id}','r')" style="min-width:40px;font-weight:600;font-family:var(--font-mono,'Space Grotesk',sans-serif);color:${pnlCol(t.r)}"></td><td><div class="stars" id="s_${t.id}">${[1,2,3,4,5].map(n=>`<span class="star${(t.confidence||0)>=n?' on':''}" onclick="setConf('${t.id}',${n})">★</span>`).join('')}</div></td><td><div class="tc" id="md_${t.id}" onclick="openPP(event,'${t.id}','mood')">${buildMoodPills(t.mood)}</div></td><td><button class="${nb.cls}" onclick="openNotesGuarded('${t.id}')">${nb.html}</button></td><td><button class="del-btn" onclick="askDel('${t.id}')"><i class="fa-solid fa-xmark"></i></button></td>`;
  return tr;
}
function buildPills(arr){const a=arr||[];if(!a.length)return'<span class="pill ep"><i class="fa-solid fa-plus" style="font-size:9px"></i></span>';return a.map(s=>`<span class="pill">${esc(s)}</span>`).join('');}
function buildMoodPills(arr){const a=arr||[];if(!a.length)return'<span class="pill ep"><i class="fa-solid fa-plus" style="font-size:9px"></i></span>';return a.map(m=>`<span class="pill" style="${moodStyle(m)}">${esc(m)}</span>`).join('');}

function numericOnly(e){const allowed=['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Enter','Home','End'];if(allowed.includes(e.key))return;if(e.ctrlKey||e.metaKey)return;if(e.key==='-'){const el=e.target,pos=el.selectionStart;if(pos===0&&!el.value.includes('-'))return;e.preventDefault();return;}if(e.key==='.'){if(!e.target.value.includes('.'))return;e.preventDefault();return;}if(e.key>='0'&&e.key<='9')return;e.preventDefault();}

let _dtEditing=null;
function toggleDtEdit(id,field){const px=field==='date'?'d':'t';if(_dtEditing&&_dtEditing.id===id&&_dtEditing.field===field){commitDtEdit(id,field);return;}if(_dtEditing)commitDtEdit(_dtEditing.id,_dtEditing.field);_dtEditing={id,field};document.getElementById(px+'val_'+id).style.display='none';const inp=document.getElementById(px+'inp_'+id);inp.classList.add('active');inp.style.pointerEvents='';setTimeout(()=>{inp.focus();try{inp.showPicker();}catch(e){}},30);}
function commitDtEdit(id,field){const px=field==='date'?'d':'t';const v=document.getElementById(px+'val_'+id),i=document.getElementById(px+'inp_'+id);if(!v||!i)return;const val=i.value;v.textContent=field==='time'?(val?fmt12(val):'—'):(val||'—');v.classList.toggle('empty',!val);v.style.display='';i.classList.remove('active');localUpd(id,field,val,true);saveToLocalCache(id);scheduleSave(id,true);if(_dtEditing&&_dtEditing.id===id&&_dtEditing.field===field)_dtEditing=null;}
function dtKey(e,id,field){if(['Enter','Tab','Escape'].includes(e.key)){e.preventDefault();commitDtEdit(id,field);}}
document.addEventListener('click',function(e){if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA')return;if(!_dtEditing)return;const{id,field}=_dtEditing;const cel=document.getElementById('dcel_'+id);if(cel&&cel.contains(e.target))return;commitDtEdit(id,field);},{capture:true});

function localUpd(id,field,val,skipRender=false){const t=trades.find(x=>x.id===id);if(!t)return;t[field]=val;if(field==='pnl'||field==='r'){const el=document.getElementById((field==='pnl'?'pnl_':'r_')+id);if(el)el.style.color=pnlCol(val);}updateAnalytics();if(!skipRender)render();}
function updPos(sel,id){const isLong=sel.value!=='Short';sel.className='csel '+(isLong?'long':'short');localUpd(id,'position',sel.value,true);saveToLocalCache(id);scheduleSave(id,true);}
function onPairInput(el,id){
  const t=trades.find(x=>x.id===id);if(t)t.pair=el.value.toUpperCase();
  _pending.add(id);
  const v=el.value.trim();if(v.length>0)showSug(el,id);else hideSugImmediate(id);
  saveToLocalCache(id);
  // Same debounce as PnL/R — autosave per keystroke instead of waiting for blur.
  clearTimeout(_valInputTimers[id]);
  _valInputTimers[id]=setTimeout(()=>scheduleSave(id,true),SAVE_DEBOUNCE_MS);
}
function onValInput(id,field,val){
  // Strip any pasted formatting (`+$100.00`, `+2R`) before storing. Without
  // this, a paste would write the display string straight into t.pnl, which
  // parseFloat reads as NaN — the field then renders gray and is dropped from
  // analytics. Paste is now safe.
  const clean=_stripNumeric(val);
  const el=document.getElementById((field==='pnl'?'pnl_':'r_')+id);
  // If the user pasted formatting, reflect the cleaned-up value in the input
  // so what they see matches what's stored.
  if(el&&val!==clean&&document.activeElement===el){
    const cursor=el.selectionStart;
    el.value=clean;
    try{el.setSelectionRange(Math.min(cursor,clean.length),Math.min(cursor,clean.length));}catch(_){}
  }
  localUpd(id,field,clean,true);
  _pending.add(id);
  saveToLocalCache(id);
  clearTimeout(_valInputTimers[id]);
  _valInputTimers[id]=setTimeout(()=>scheduleSave(id,true),SAVE_DEBOUNCE_MS);
  if(el)el.style.color=pnlCol(clean);
}
function vFocus(el){const n=parseFloat(el.value.replace(/[^0-9.\-]/g,''));el.value=isNaN(n)?'':n;el.style.color='var(--text)';el.select();}
function vBlur(el,id,field){
  const raw=el.value.trim(),n=parseFloat(raw);
  if(!isNaN(n)&&raw!==''){
    el.value=fmtVal(n,field);
    el.style.color=pnlCol(n);
  }else{
    el.value='';
    el.style.color='var(--muted)';
  }
  localUpd(id,field,raw,true);

  // Force ratio = -1 whenever PnL is negative — regardless of any existing
  // ratio value. Per request: "no matter what the Ratio is if the pnl is
  // negative automatically make the ratio -1, even if we put a positive value
  // first in the ratio and then in the pnl."
  if(field==='pnl'&&!isNaN(n)&&n<0){
    const ratioEl=document.getElementById('r_'+id);
    if(ratioEl){
      ratioEl.value=fmtVal(-1,'r');
      localUpd(id,'r','-1',true);
      ratioEl.style.color=pnlCol('-1');
    }
  }
  // Symmetric guard: if user enters ratio first, then pnl is already negative,
  // and they try to set a positive ratio — snap it back to -1 immediately.
  if(field==='r'){
    const t=trades.find(x=>x.id===id);
    const pnlNum=t?parseFloat(t.pnl):NaN;
    if(!isNaN(pnlNum)&&pnlNum<0&&raw!==''&&parseFloat(raw)!==-1){
      el.value=fmtVal(-1,'r');
      localUpd(id,'r','-1',true);
      el.style.color=pnlCol('-1');
    }
  }

  saveToLocalCache(id);
  scheduleSave(id,true);
}
function confirmPair(id,el){const v=el.value.trim().toUpperCase();el.value=v;if(v)localUpd(id,'pair',v,true);saveToLocalCache(id);scheduleSave(id,true);}
function setConf(id,n){localUpd(id,'confidence',n,true);document.querySelectorAll(`[data-id="${id}"] .star`).forEach((s,i)=>s.classList.toggle('on',i<n));saveToLocalCache(id);scheduleSave(id,true);}

function highlightEmpty(id){
  const tr=document.querySelector(`tr[data-id="${id}"]`);
  if(!tr)return;
  const t=trades.find(x=>x.id===id);
  if(!t)return;
  const pairInput=tr.querySelector('.pw-cell input');
  const pnlInput=document.getElementById('pnl_'+id);
  if(pairInput)pairInput.classList.toggle('field-required',!t.pair?.trim());
  if(pnlInput)pnlInput.classList.toggle('field-required',!t.pnl&&t.pnl!==0);
}

// ─── CAPTURE ACTIVE INPUT BEFORE NAVIGATING AWAY ──────────────────────────────
// Only the currently-focused input can hold typing that hasn't been committed
// to trades[] yet — every other handler (vBlur, confirmPair, commitDtEdit,
// updPos, setConf, _ppToggle, etc.) writes back to t.* synchronously.
//
// Critically: blurred PnL/Ratio inputs display the FORMATTED value
// (`+$100.00`, `+2R`) — `el.value.trim()` would return that string, and
// blindly assigning it to t.pnl turned `"100"` into `"+$100.00"`. parseFloat
// of which is NaN, which `pnlCol` paints gray and the analytics filter drops.
// That's the "page 1 gray, page 2 normal" bug — captureActiveInputs only ever
// touches the visible page's DOM inputs, so older pages were unaffected.
//
// We now only read from the focused element, and for numeric fields we strip
// currency/sign formatting defensively so even a future caller can't poison
// t.pnl / t.r with display text.
function _stripNumeric(s){
  if(s==null)return'';
  // Keep digits, decimal point, and a single leading minus.
  const cleaned=String(s).replace(/[^0-9.\-]/g,'');
  // Collapse multiple minuses to one, only allow leading.
  const sign=cleaned.startsWith('-')?'-':'';
  return sign+cleaned.replace(/-/g,'');
}
function captureActiveInputs(){
  const ae=document.activeElement;
  if(!ae||ae===document.body)return;
  if(!ae.closest||!ae.closest('#mainTable'))return;
  const tr=ae.closest('tr');if(!tr)return;
  const id=tr.dataset.id;if(!id)return;
  const t=trades.find(x=>x.id===id);if(!t)return;
  const elId=ae.id||'';
  let touched=false;
  if(elId.startsWith('pnl_')){t.pnl=_stripNumeric(ae.value);touched=true;}
  else if(elId.startsWith('r_')){t.r=_stripNumeric(ae.value);touched=true;}
  else if(elId.startsWith('pos_')){t.position=ae.value;touched=true;}
  else if(elId.startsWith('dinp_')){if(ae.value){t.date=ae.value;touched=true;}}
  else if(elId.startsWith('tinp_')){if(ae.value){t.time=ae.value;touched=true;}}
  else if(ae.classList.contains('ci')&&ae.closest('.pw-cell')){
    t.pair=ae.value.trim().toUpperCase();touched=true;
  }
  if(touched){_pending.add(id);saveToLocalCache(id);}
}

// (saveLog removed — autosave handles everything now. Inputs persist on every
// keystroke via saveToLocalCache + scheduleSave. There is no manual confirmation
// step.)

function syncActiveInputs(){document.querySelectorAll('#mainTable input, #mainTable select').forEach(el=>{const tr=el.closest('tr');if(!tr)return;const id=tr.dataset.id;if(!id)return;const match=el.id.match(/^([a-z]+)_/);if(!match)return;const field=match[1];if(field==='pnl'||field==='r'){localUpd(id,field,el.value.trim(),true);}else if(field==='pair'){localUpd(id,'pair',el.value.toUpperCase().trim(),true);}else if(field==='dinp'){localUpd(id,'date',el.value,true);}else if(field==='tinp'){localUpd(id,'time',el.value,true);}else if(field==='pos'){localUpd(id,'position',el.value,true);}});}

// ─── NOTES — guarded open ─────────────────────────────────────────────────────
// Notes button calls openNotesGuarded, which captures inputs first and blocks
// if the draft for a DIFFERENT row hasn't been saved yet.
function openNotesGuarded(id){
  // Always capture current inputs so nothing is lost
  captureActiveInputs();
  // If there's a draft that ISN'T this trade, block
  if(_newDraftIds.size>0&&!_newDraftIds.has(id)){
    showDraftBlockToast();
    return;
  }
  openNotes(id);
}

async function addRow(){
  if(_newDraftIds.size>0){
    showDraftBlockToast();
    return;
  }
  // Flush any pending saves before adding
  captureActiveInputs();

  const btn=document.getElementById('btnAddTrade');
  if(btn){btn.dataset.originalText=btn.innerHTML;showLoadingIndicator(btn,true);}
  const date=todayLocal(),time=nowTimeLocal(),tempId='temp_'+Date.now();
  const intent=getActiveIntent();
  const initPos=intent?.direction||'Long';
  const initStrat=intent?.setup_name?[intent.setup_name]:[];
  const nt={id:tempId,date,time,pair:'',position:initPos,strategy:initStrat,timeframe:[],pnl:'',r:'',confidence:0,mood:[],notes:'',images:[]};
  _newDraftIds.add(tempId); // Guard against subscription refresh during async createTrade
  trades.unshift(nt);if(sortDir==='desc')currentPage=1;updateAnalytics();render();
  setTimeout(()=>{const inp=document.querySelector(`tr[data-id="${tempId}"] .pw-cell input`);if(inp)inp.focus();const tr=document.querySelector(`tr[data-id="${tempId}"]`);if(tr){tr.classList.add('new-row');setTimeout(()=>tr.classList.remove('new-row'),3000);}},30);
  try{
    const row=await createTrade(currentUser.id,jid,{date,time,pair:'',position:initPos,strategy:initStrat,timeframe:[],pnl:'',r:'',confidence:0,mood:[],notes:''});
    const idx=trades.findIndex(t=>t.id===tempId);
    if(idx>-1){
      trades[idx].id=row.id;
      if(activeNotesId===tempId)activeNotesId=row.id;
      _newDraftIds.delete(tempId); // Swap temp guard for real ID guard
      _pending.delete(tempId);
      clearTimeout(_saveTimers[tempId]);
      delete _saveTimers[tempId];
      const cachedData=restoreFromLocalCache(tempId);
      if(cachedData){try{localStorage.setItem(getLocalCacheKey(row.id),JSON.stringify(cachedData));}catch(e){}}
      clearLocalCache(tempId);
      scheduleSave(row.id,true);
      const tr=document.querySelector(`tr[data-id="${tempId}"]`);
      if(tr){
        tr.dataset.id=row.id;
        rebindRowId(tr,tempId,row.id);
        // No more 'Save Log' button — every input auto-saves. The X delete
        // button stays where it was. The brief 'new-row' highlight from
        // addRow is sufficient visual feedback for "just added".
      }
      // Do NOT re-add to _newDraftIds: the trade exists in DB now, so any
      // further input is a regular auto-saved edit, not a draft.
      if(btn)showLoadingIndicator(btn,false);
      if(intent?.id){try{await db.from('trade_intents').update({trade_id:row.id,status:'executed'}).eq('id',intent.id);}catch(e){}}
    }else{
      console.error('Trade not found after creation:',tempId);
      showToast('⚠️ Trade created but not found in list. Refreshing...','fa-solid fa-circle-exclamation','orange');
      await refreshTrades();
    }
  }catch(e){
    const btn=document.getElementById('btnAddTrade');
    if(btn)showLoadingIndicator(btn,false);
    console.error('Error creating trade:',e);
    showToast('❌ Error saving trade: '+e.message,'fa-solid fa-circle-exclamation','red');
    _newDraftIds.delete(tempId);
    trades=trades.filter(t=>t.id!==tempId);
    updateAnalytics();
    render();
  }
}

function askDel(id){pendingDelId=id;document.getElementById('cOverlay').classList.add('open');}
function closeCon(){pendingDelId=null;document.getElementById('cOverlay').classList.remove('open');}
async function confirmDelete(){
  if(!pendingDelId)return;
  const confirmBtn=document.querySelector('#cOverlay .btn-del');
  if(confirmBtn){confirmBtn.dataset.originalText=confirmBtn.innerHTML;showLoadingIndicator(confirmBtn,true);}
  try{
    await deleteTrade(pendingDelId);
    trades=trades.filter(t=>t.id!==pendingDelId);
    _pending.delete(pendingDelId);
    _newDraftIds.delete(pendingDelId);
    clearLocalCache(pendingDelId);
    updateAnalytics();
    render();
    showToast('Trade deleted.','fa-solid fa-circle-check','green');
    closeCon();
  }catch(e){
    if(confirmBtn)showLoadingIndicator(confirmBtn,false);
    showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red');
  }
}

// Only update the suggestion box if the visible list actually changed.
// Re-running innerHTML on every keystroke caused a brief blank frame each time
// (the "appears-and-vanishes-immediately" flicker the user reported).
// `event.preventDefault()` on mousedown keeps focus on the input so the blur
// handler doesn't commit a half-typed pair before pickPair sets the full value.
function _renderSugBox(box,id,matches,limit){
  if(!matches.length){box.style.display='none';box.dataset.lastKey='';return;}
  const slice=matches.slice(0,limit);
  const key=slice.join('|');
  if(box.dataset.lastKey!==key){
    box.dataset.lastKey=key;
    box.innerHTML=slice.map(p=>`<div class="sug" onmousedown="event.preventDefault();pickPair('${id}','${esc(p)}')">${esc(p)}</div>`).join('');
  }
  box.style.display='block';
}
function showSugOnFocus(el,id){
  const box=document.getElementById('sug_'+id);if(!box)return;
  const all=getPairSuggestions();
  const v=el.value.toUpperCase().trim();
  const m=v?all.filter(p=>p.includes(v)&&p!==v):all;
  _renderSugBox(box,id,m,10);
}
function showSug(el,id){
  const box=document.getElementById('sug_'+id);if(!box)return;
  const v=el.value.toUpperCase().trim();
  if(!v){box.style.display='none';box.dataset.lastKey='';return;}
  const all=getPairSuggestions();
  const m=all.filter(p=>p.includes(v)&&p!==v);
  _renderSugBox(box,id,m,12);
}
function hideSug(){setTimeout(()=>document.querySelectorAll('.sugs').forEach(s=>{s.style.display='none';s.dataset.lastKey='';}),180);}
function hideSugImmediate(id){const box=document.getElementById('sug_'+id);if(box){box.style.display='none';box.dataset.lastKey='';}}
function pickPair(id,p){
  const inp=document.querySelector(`tr[data-id="${id}"] .pw-cell input`);
  if(inp)inp.value=p;
  localUpd(id,'pair',p,true);
  const box=document.getElementById('sug_'+id);
  if(box){box.style.display='none';box.dataset.lastKey='';}
  saveToLocalCache(id);
  scheduleSave(id,true);
}

function openPP(e,id,field){
  e.stopPropagation();if(_ppCurrentId===id&&_ppCurrentField===field&&document.getElementById('pp').style.display!=='none'){closePP();return;}
  _ppCurrentId=id;_ppCurrentField=field;activePill={id,field};
  const pop=document.getElementById('pp'),searchEl=document.getElementById('pp-search');
  document.getElementById('pp-field-label').textContent=field.charAt(0).toUpperCase()+field.slice(1);
  pop.style.display='block';
  const rect=e.currentTarget.getBoundingClientRect();let top=rect.bottom+window.scrollY+4,left=rect.left+window.scrollX;
  const pw=Math.max(pop.offsetWidth,220);if(left+pw>window.innerWidth-8)left=window.innerWidth-pw-8;
  pop.style.top=top+'px';pop.style.left=Math.max(4,left)+'px';
  searchEl.value='';_renderPPPills('');_updatePPSelCount();
  searchEl.oninput=function(){_renderPPPills(this.value);};
  searchEl.onkeydown=function(ev){if(ev.key==='Enter'){ev.preventDefault();const v=this.value.trim();if(!v)return;const ex=getTags(field).find(t=>t.toLowerCase()===v.toLowerCase());if(ex)_ppToggle(id,field,ex);else _ppCreate(id,field,v);}if(ev.key==='Escape'){ev.stopPropagation();closePP();}};
  setTimeout(()=>searchEl.focus(),10);
}
function _updatePPSelCount(){const id=_ppCurrentId,field=_ppCurrentField;if(!id)return;const t=trades.find(x=>x.id===id),sel=t?t[field]||[]:[];const el=document.getElementById('pp-sel-count');if(sel.length>0){el.textContent=sel.length+' selected';el.classList.add('show');}else{el.textContent='';el.classList.remove('show');}}
function _renderPPPills(filter){
  const id=_ppCurrentId,field=_ppCurrentField;if(!id)return;
  const t=trades.find(x=>x.id===id),sel=t?t[field]||[]:[];
  const all=getTags(field),fil=filter?all.filter(l=>l.toLowerCase().includes(filter.toLowerCase())):all;
  const pillsEl=document.getElementById('pp-pills');
  if(!fil.length&&!filter){pillsEl.innerHTML='<span style="font-size:12px;color:var(--muted)">No tags yet. Type to create one.</span>';}
  else if(!fil.length){pillsEl.innerHTML='<span style="font-size:12px;color:var(--muted)">No matches.</span>';}
  else{pillsEl.innerHTML='';fil.forEach(tag=>{const span=document.createElement('span');span.className='ppl'+(sel.includes(tag)?' sel':'');if(field==='mood'){const s=moodStyle(tag);if(s)span.style.cssText=s;}span.textContent=tag;span.addEventListener('mousedown',function(ev){ev.preventDefault();ev.stopPropagation();_ppToggle(id,field,tag);});pillsEl.appendChild(span);});}
  const newEl=document.getElementById('pp-new'),newPill=document.getElementById('pp-new-pill');
  if(filter&&!all.find(x=>x.toLowerCase()===filter.toLowerCase())){newEl.style.display='block';newPill.innerHTML='';const span=document.createElement('span');span.className='ppl';span.style.borderStyle='dashed';span.textContent='+ Create "'+filter+'"';span.addEventListener('mousedown',function(ev){ev.preventDefault();ev.stopPropagation();_ppCreate(id,field,filter);});newPill.appendChild(span);}
  else{newEl.style.display='none';}
}
async function _ppToggle(id,field,val){const t=trades.find(x=>x.id===id);if(!t)return;if(!t[field])t[field]=[];const idx=t[field].indexOf(val);if(idx>-1)t[field].splice(idx,1);else t[field].push(val);const pre={strategy:'st_',timeframe:'tf_',mood:'md_'}[field]||'st_';const c=document.getElementById(pre+id);if(c)c.innerHTML=field==='mood'?buildMoodPills(t[field]):buildPills(t[field]);_renderPPPills(document.getElementById('pp-search').value||'');_updatePPSelCount();saveToLocalCache(id);scheduleSave(id,true);}
async function _ppCreate(id,field,val){const v=val.trim();if(!v||!settings)return;const k={strategy:'strategies',timeframe:'timeframes',mood:'moods',pair:'pairs'}[field];if(k&&!settings[k].find(x=>x.toLowerCase()===v.toLowerCase())){settings[k]=[...settings[k],v];await updateJournalSettings(jid,{[k]:settings[k]});}await _ppToggle(id,field,v);const searchEl=document.getElementById('pp-search');searchEl.value='';_renderPPPills('');searchEl.focus();}
function closePP(){if(_ppCurrentId)saveToLocalCache(_ppCurrentId);document.getElementById('pp').style.display='none';activePill=null;_ppCurrentId=null;_ppCurrentField=null;}
document.addEventListener('click',e=>{const pop=document.getElementById('pp');if(pop.style.display!=='none'&&!pop.contains(e.target))closePP();});
document.addEventListener('focusin',e=>{if((e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA')&&e.target.closest('#mainTable'))_isEditing=true;});
document.addEventListener('focusout',e=>{
  if((e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA')&&e.target.closest('#mainTable')){
    _isEditing=false;
    // If a filter/sort/page-size change was deferred while the user was typing,
    // run it now that focus has left the table.
    if(_renderQueued)setTimeout(()=>{if(!_isEditing&&!_isUserEditingTable())render();},50);
  }
});

// ─── IMAGE HELPERS ────────────────────────────────────────────────────────────
const ALLOWED_IMG=['image/png','image/jpeg','image/jpg','image/gif','image/webp'];
const MAX_IMG_MB=5;
const MAX_IMG_DIMENSION=2000;

function validateImg(file){
  if(!ALLOWED_IMG.includes(file.type)){
    showToast(`❌ Format not supported: ${file.type}. Use PNG, JPG, GIF, or WebP.`,'fa-solid fa-triangle-exclamation','red');
    return false;
  }
  const fileSizeMB=file.size/(1024*1024);
  if(fileSizeMB>MAX_IMG_MB){
    showToast(`❌ Image too large: ${fileSizeMB.toFixed(1)}MB (max ${MAX_IMG_MB}MB).`,'fa-solid fa-triangle-exclamation','red');
    return false;
  }
  return true;
}

// Compress a File or data-URL string, always returns a data-URL string
async function compressImageToDataUrl(input, quality=0.82){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      let w=img.width,h=img.height;
      if(w>MAX_IMG_DIMENSION||h>MAX_IMG_DIMENSION){
        const ratio=Math.min(MAX_IMG_DIMENSION/w,MAX_IMG_DIMENSION/h);
        w=Math.round(w*ratio);h=Math.round(h*ratio);
      }
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,w,h);
      // Prefer jpeg for compression unless original is png with transparency
      const outType=(typeof input==='string'&&input.startsWith('data:image/png'))?'image/png':'image/jpeg';
      const dataUrl=canvas.toDataURL(outType,quality);
      resolve(dataUrl);
    };
    img.onerror=()=>reject(new Error('Failed to load image for compression'));
    if(typeof input==='string'){
      // Already a data URL
      img.src=input;
    }else{
      // It's a File/Blob — read it first
      const reader=new FileReader();
      reader.onload=ev=>{ img.src=ev.target.result; };
      reader.onerror=()=>reject(new Error('Failed to read file'));
      reader.readAsDataURL(input);
    }
  });
}

// Convert a data URL to a Blob (needed by addTradeImage if it expects a Blob)
function dataUrlToBlob(dataUrl){
  const [header,data]=dataUrl.split(',');
  const mime=header.match(/:(.*?);/)[1];
  const binary=atob(data);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}

// ─── NOTES MODAL ──────────────────────────────────────────────────────────────
async function openNotes(id){
  const t=trades.find(x=>x.id===id);
  if(!t)return;
  // Reset save button in case it was left in spinner state from a previous save
  const saveBtn=document.querySelector('#nOverlay .nmftr .btn-primary');
  if(saveBtn&&saveBtn.dataset.originalText)showLoadingIndicator(saveBtn,false);
  activeNotesId=id;
  _notesOriginalText=t.notes||'';
  _notesDirty=false;
  document.getElementById('nOverlay').classList.add('open');
  document.getElementById('nmTitle').textContent=`${t.pair||'Trade'} — ${t.date||'—'}`;
  document.getElementById('nmText').value=t.notes||'';
  document.getElementById('nmUploadProgress').style.display='none';
  const loadingEl=document.getElementById('nmLoadingState');
  if(loadingEl)loadingEl.style.display='flex';

  try{
    const rawImgs=await getTradeImages(id);
    imgBuffer=await Promise.all(rawImgs.map(async img=>{const url=await getImageUrl(img);return{...img,_previewUrl:url||img._previewUrl||''};}));
  }catch(e){
    console.error('Error loading images:',e);
  }

  const atLimit=!userIsPro&&imgBuffer.length>=1;
  document.getElementById('uploadRow').style.display=atLimit?'none':'flex';
  document.getElementById('imgProLock').style.display=atLimit?'flex':'none';
  renderImgs();
  if(loadingEl)loadingEl.style.display='none';
  setTimeout(()=>document.getElementById('nmText').focus(),100);
}
function _notesHasChanges(){
  const currentText=document.getElementById('nmText')?.value||'';
  return _notesDirty||currentText!==_notesOriginalText;
}
function closeNotes(force=false){
  if(!force&&_notesHasChanges()){
    if(!confirm('You have unsaved changes. Discard them?'))return;
  }
  const saveBtn=document.querySelector('#nOverlay .nmftr .btn-primary');
  if(saveBtn&&saveBtn.dataset.originalText)showLoadingIndicator(saveBtn,false);
  const ta=document.getElementById('nmText');if(ta)ta.defaultValue=ta.value;
  document.getElementById('nOverlay').classList.remove('open');
  activeNotesId=null;imgBuffer=[];
  _notesOriginalText='';_notesDirty=false;
}

async function saveNotes(){
  if(!activeNotesId)return;
  const t=trades.find(x=>x.id===activeNotesId);
  if(!t)return;
  const newNotes=document.getElementById('nmText').value;
  const saveBtn=document.querySelector('#nOverlay .nmftr .btn-primary');
  if(saveBtn){saveBtn.dataset.originalText=saveBtn.innerHTML;showLoadingIndicator(saveBtn,true);}
  try{
    t.notes=newNotes;
    const keepIds=new Set(imgBuffer.filter(i=>i.id).map(i=>i.id));

    // Delete removed images
    for(const img of(t.images||[])){
      if(img.id&&!keepIds.has(img.id))await deleteTradeImage(img.id);
    }

    const newImages=imgBuffer.filter(i=>!i.id);
    if(newImages.length>0){
      const progressEl=document.getElementById('nmUploadProgress');
      if(progressEl)progressEl.style.display='flex';
    }

    const final=[];
    let uploadIdx=0;
    for(let idx=0;idx<imgBuffer.length;idx++){
      const img=imgBuffer[idx];
      if(img.id){
        final.push(img);
      }else{
        uploadIdx++;
        const progressEl=document.getElementById('nmUploadProgress');
        if(progressEl){
          document.getElementById('nmUploadCount').textContent=`Uploading ${uploadIdx}/${newImages.length}...`;
        }

        // _previewUrl is always a data URL string at this point.
        // addTradeImage may expect a Blob — we convert it.
        const dataUrl=img._previewUrl||img.data||'';
        let uploadPayload;
        try{
          uploadPayload=dataUrlToBlob(dataUrl);
        }catch(convErr){
          console.warn('[saveNotes] Could not convert to Blob, sending raw dataUrl:',convErr);
          uploadPayload=dataUrl;
        }

        const saved=await addTradeImage(currentUser.id,activeNotesId,uploadPayload);
        final.push({id:saved.id,storage_url:saved.storage_url,_previewUrl:dataUrl});
      }
    }

    const progressEl=document.getElementById('nmUploadProgress');
    if(progressEl)progressEl.style.display='none';

    t.images=final;
    await updateTrade(activeNotesId,t);
    const tr=document.querySelector(`tr[data-id="${activeNotesId}"]`);
    if(tr){
      const btn=tr.querySelector('.notes-btn');
      if(btn){
        const nb=buildNotesBtnHTML(t);
        btn.className=nb.cls;
        btn.innerHTML=nb.html;
      }
    }
    clearLocalCache(activeNotesId);
    if(saveBtn)showLoadingIndicator(saveBtn,false);
    closeNotes(true);
    showToast('Notes saved.','fa-solid fa-circle-check','green');
  }catch(e){
    if(saveBtn)showLoadingIndicator(saveBtn,false);
    showToast('Save error: '+e.message,'fa-solid fa-circle-exclamation','red');
  }
}

function renderImgs(){
  const box=document.getElementById('nmImgs'),cnt=document.getElementById('imgCntLbl');
  cnt.textContent=imgBuffer.length?`(${imgBuffer.length})`:'';
  if(!imgBuffer.length){
    box.innerHTML='<div class="no-imgs"><i class="fa-solid fa-image" style="margin-right:5px;opacity:.4"></i>No images attached.</div>';
    return;
  }
  box.innerHTML='';
  imgBuffer.forEach((img,i)=>{
    const src=img._previewUrl||img.data||'';
    const wrapper=document.createElement('div');
    wrapper.className='img-thumb';

    const imgEl=document.createElement('img');
    imgEl.alt='';
    imgEl.loading='lazy';
    imgEl.decoding='async';
    // Only set src if it's a valid data URL or http URL to avoid broken images
    if(src&&(src.startsWith('data:')||src.startsWith('http')||src.startsWith('blob:'))){
      imgEl.src=src;
    }else{
      imgEl.src='';
    }
    imgEl.onclick=()=>openLb(i);

    const delBtn=document.createElement('div');
    delBtn.className='img-actions';
    delBtn.innerHTML=`<button class="img-act-btn img-act-del" title="Delete"><i class="fa-solid fa-trash" style="font-size:8px"></i></button>`;
    delBtn.querySelector('button').onclick=(e)=>{e.stopPropagation();rmImg(i);};

    wrapper.appendChild(imgEl);
    wrapper.appendChild(delBtn);
    box.appendChild(wrapper);
  });
}

function rmImg(i){imgBuffer.splice(i,1);_notesDirty=true;renderImgs();}

// ─── UPLOAD HANDLER (manual file picker) ──────────────────────────────────────
async function handleUpload(e){
  const files=[...e.target.files];
  for(const f of files){
    if(!validateImg(f))continue;
    if(!userIsPro&&imgBuffer.length>=1){
      showToast('📦 Free plan: 1 image per trade. Upgrade to Pro for more.','fa-solid fa-lock','red');
      continue;
    }
    try{
      // Compress the File directly → get back a data URL string
      const dataUrl=await compressImageToDataUrl(f,0.82);
      // Push to buffer with _previewUrl so renderImgs can display it
      imgBuffer.push({_previewUrl:dataUrl});
      _notesDirty=true;
      renderImgs();
    }catch(err){
      console.error('[handleUpload] Error processing file:',err);
      showToast('Error processing image: '+err.message,'fa-solid fa-exclamation','red');
    }
  }
  e.target.value='';
}

// ─── PASTE HANDLER ────────────────────────────────────────────────────────────
document.addEventListener('paste',async e=>{
  if(!document.getElementById('nOverlay').classList.contains('open'))return;
  for(const item of e.clipboardData.items){
    if(!item.type.startsWith('image/'))continue;
    const file=item.getAsFile();
    if(!file)continue;
    if(!validateImg(file))continue;
    if(!userIsPro&&imgBuffer.length>=1){
      showToast('Free plan: 1 image per trade.','fa-solid fa-lock','red');
      continue;
    }
    try{
      const dataUrl=await compressImageToDataUrl(file,0.82);
      imgBuffer.push({_previewUrl:dataUrl});
      _notesDirty=true;
      renderImgs();
    }catch(err){
      console.error('[paste] Error reading file:',err);
      showToast('Error reading image: '+err.message,'fa-solid fa-exclamation','red');
    }
  }
});

// ─── LIGHTBOX ─────────────────────────────────────────────────────────────────
let lbImages=[],lbIndex=0,lbScale=1,lbPanX=0,lbPanY=0,lbDragging=false,lbLastX=0,lbLastY=0;
function openLb(i){lbImages=[...imgBuffer];lbIndex=i;lbScale=1;lbPanX=0;lbPanY=0;_lbRender();document.getElementById('lb').classList.add('open');}
function _lbRender(){const img=document.getElementById('lbImg'),cur=lbImages[lbIndex];if(!cur)return;const src=cur._previewUrl||cur.data||'';img.src=(src&&(src.startsWith('data:')||src.startsWith('http')||src.startsWith('blob:')))?src:'';img.style.transform=`translate(${lbPanX}px,${lbPanY}px) scale(${lbScale})`;document.getElementById('lbPrev').style.display=lbIndex>0?'flex':'none';document.getElementById('lbNext').style.display=lbIndex<lbImages.length-1?'flex':'none';const dots=document.getElementById('lbDots');dots.innerHTML=lbImages.length>1?lbImages.map((_,i)=>`<div class="lb-dot${i===lbIndex?' active':''}"></div>`).join(''):'';}
function lbNav(dir){lbIndex=Math.max(0,Math.min(lbImages.length-1,lbIndex+dir));lbScale=1;lbPanX=0;lbPanY=0;_lbRender();}
function lbZoom(delta){lbScale=Math.max(.5,Math.min(5,lbScale+delta));document.getElementById('lbImg').style.transform=`translate(${lbPanX}px,${lbPanY}px) scale(${lbScale})`;}
function lbResetZoom(){lbScale=1;lbPanX=0;lbPanY=0;document.getElementById('lbImg').style.transform='';}
function lbDeleteCurrent(){_notesDirty=true;imgBuffer.splice(lbIndex,1);if(imgBuffer.length===0){closeLb();renderImgs();return;}lbImages=[...imgBuffer];if(lbIndex>=lbImages.length)lbIndex=lbImages.length-1;lbScale=1;lbPanX=0;lbPanY=0;_lbRender();renderImgs();}
function closeLb(){document.getElementById('lb').classList.remove('open');lbScale=1;lbPanX=0;lbPanY=0;}
const lbWrap=document.getElementById('lbImgWrap');
lbWrap.addEventListener('mousedown',e=>{if(e.button!==0)return;lbDragging=true;lbLastX=e.clientX;lbLastY=e.clientY;lbWrap.classList.add('grabbing');});
document.addEventListener('mousemove',e=>{if(!lbDragging)return;lbPanX+=e.clientX-lbLastX;lbPanY+=e.clientY-lbLastY;lbLastX=e.clientX;lbLastY=e.clientY;document.getElementById('lbImg').style.transform=`translate(${lbPanX}px,${lbPanY}px) scale(${lbScale})`;});
document.addEventListener('mouseup',()=>{lbDragging=false;lbWrap.classList.remove('grabbing');});
lbWrap.addEventListener('wheel',e=>{e.preventDefault();lbZoom(e.deltaY>0?-.15:.15);},{passive:false});
document.getElementById('lb').addEventListener('click',e=>{if(e.target===document.getElementById('lb'))closeLb();});
document.addEventListener('keydown',e=>{if(!document.getElementById('lb').classList.contains('open'))return;if(e.key==='Escape')closeLb();if(e.key==='ArrowLeft')lbNav(-1);if(e.key==='ArrowRight')lbNav(1);});

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
function applyAnalyticsState(){document.getElementById('aBar').classList.toggle('show',analyticsOn);}
function computeAnalytics(src){const vld=src.filter(t=>t.pnl!==''&&!isNaN(parseFloat(t.pnl)));const wins=vld.filter(t=>parseFloat(t.pnl)>0),losses=vld.filter(t=>parseFloat(t.pnl)<0);const total=vld.reduce((s,t)=>s+parseFloat(t.pnl),0);const rv=src.filter(t=>t.r&&!isNaN(parseFloat(t.r))).map(t=>parseFloat(t.r));const avgR=rv.length?rv.reduce((a,b)=>a+b,0)/rv.length:0;const wr=vld.length?wins.length/vld.length*100:0;let mxW=0,mxL=0,cW=0,cL=0;vld.forEach(t=>{const p=parseFloat(t.pnl);if(p>0){cW++;cL=0;if(cW>mxW)mxW=cW;}else if(p<0){cL++;cW=0;if(cL>mxL)mxL=cL;}else{cW=0;cL=0;}});return{count:src.length,vldCount:vld.length,winCount:wins.length,lossCount:losses.length,totalPnl:total,wr,avgR,mxW,mxL,rv};}
function updateAnalytics(){if(!analyticsOn)return;const src=getFilteredTrades();const{count,vldCount,winCount,lossCount,totalPnl,wr,avgR,mxW,mxL}=computeAnalytics(src);document.getElementById('sTrades').textContent=count;const wrEl=document.getElementById('sWR');wrEl.textContent=vldCount?wr.toFixed(1)+'%':'—';wrEl.style.color=vldCount?(wr>=50?G:R):'';document.getElementById('sW').textContent=winCount;document.getElementById('sL').textContent=lossCount;document.getElementById('sWS').textContent=mxW;document.getElementById('sLS').textContent=mxL;const rEl=document.getElementById('sR');rEl.textContent=avgR?(avgR>=0?'+':'')+avgR.toFixed(2)+'R':'—';rEl.style.color=avgR?pnlCol(avgR):'';const pe=document.getElementById('sP');if(vldCount){pe.textContent=(totalPnl>=0?'+':'-')+'$'+Math.abs(totalPnl).toFixed(2);pe.style.color=pnlCol(totalPnl);}else{pe.textContent='—';pe.style.color='';}}

// ─── SHARE MODAL ──────────────────────────────────────────────────────────────
let _shareVisibility={totalPnl:true,winRate:true,totalTrades:true,wins:true,losses:true,avgR:true,winStreak:true,lossStreak:true};
let _shareHighlighted=new Set();
let _shareOrientation='landscape';
let _shareBranding={username:true,referral:true};
const METRIC_DEFS={totalPnl:{label:'Total PNL',format:(d)=>{const n=d.totalPnl;return{val:(n>=0?'+':'-')+'$'+Math.abs(n).toFixed(2),pos:n>0,neg:n<0};}},winRate:{label:'Win Rate',format:(d)=>{return{val:d.vldCount?d.wr.toFixed(1)+'%':'—',pos:d.vldCount&&d.wr>=50,neg:d.vldCount&&d.wr<50};}},totalTrades:{label:'Total Trades',format:(d)=>{return{val:String(d.count),pos:false,neg:false};}},wins:{label:'Wins',format:(d)=>{return{val:String(d.winCount),pos:true,neg:false};}},losses:{label:'Losses',format:(d)=>{return{val:String(d.lossCount),pos:false,neg:true};}},avgR:{label:'Avg R',format:(d)=>{return{val:(d.rv&&d.rv.length)?(d.avgR>=0?'+':'')+d.avgR.toFixed(2)+'R':'—',pos:d.avgR>0,neg:d.avgR<0};}},winStreak:{label:'Win Streak',format:(d)=>{return{val:String(d.mxW),pos:true,neg:false};}},lossStreak:{label:'Loss Streak',format:(d)=>{return{val:String(d.mxL),pos:false,neg:true};}},};
function getThemeVars(){const s=getComputedStyle(document.documentElement);const get=v=>s.getPropertyValue(v).trim();const accent=get('--accent')||'#19c37d';const accent2=get('--accent2')||accent;function hexToRgb(hex){hex=hex.replace('#','');if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');const n=parseInt(hex,16);return{r:(n>>16)&255,g:(n>>8)&255,b:n&255};}const ac=hexToRgb(accent2.startsWith('#')?accent2:'#19c37d');return{bg:get('--bg')||'#0b0f0c',panel:get('--panel')||'#111816',border:get('--border')||'#1c2a25',text:get('--text')||'#e6f2ec',muted:get('--muted')||'#8fa39a',accent,accent2,accentRgb:ac,fontHead:(get('--font-heading')||'Space Grotesk').replace(/['"]/g,'').split(',')[0].trim(),fontBody:(get('--font-body')||'Inter').replace(/['"]/g,'').split(',')[0].trim()};}
const CARD_W_LAND=600,CARD_W_PORT=380,PAD=32;
function _drawCard(ctx,scale,data,visKeys,highlighted,orientation,branding){if(!scale||scale<=0||!isFinite(scale))scale=1;const tv=getThemeVars();const isPort=orientation==='portrait';const CARD_W=isPort?CARD_W_PORT:CARD_W_LAND;const W=Math.ceil(CARD_W*scale);const ac=tv.accentRgb;const accentHex=tv.accent2;const fh=tv.fontHead||'Space Grotesk';const fb=tv.fontBody||'Inter';const LABEL_SZ=(isPort?9:10)*scale;const VALUE_SZ=(isPort?22:26)*scale;const METRIC_PAD=(isPort?14:16)*scale;const METRIC_GAP=(isPort?8:10)*scale;const maxCols=isPort?2:4;const COLS=visKeys.length===0?1:Math.min(maxCols,visKeys.length<=2?visKeys.length:visKeys.length<=4?2:isPort?2:visKeys.length<=6?3:4);const ROWS=Math.ceil(Math.max(1,visKeys.length)/COLS);const CELL_W=(W-PAD*scale*2-METRIC_GAP*(COLS-1))/COLS;const CELL_H=Math.ceil(LABEL_SZ+8*scale+VALUE_SZ+METRIC_PAD*2);const GRID_H=ROWS*CELL_H+(ROWS-1)*METRIC_GAP;const LOGO_SZ=(isPort?15:17)*scale;const SUBTITLE_SZ=(isPort?8:9)*scale;const LOGO_TOP=18*scale;const LOGO_LINE_H=LOGO_SZ*1.3;const SUB_LINE_H=SUBTITLE_SZ*1.6;const HEADER_H=LOGO_TOP+LOGO_LINE_H+4*scale+SUB_LINE_H+14*scale;const DIV_Y=HEADER_H;const GRID_Y=DIV_Y+12*scale;let brandingLines=0;if(_shareBranding.username&&branding?.displayName)brandingLines++;if(_shareBranding.referral&&branding?.referralCode)brandingLines++;const BRANDING_LINE_H=(isPort?14:13)*scale;const FOOTER_INNER_H=brandingLines>0?brandingLines*BRANDING_LINE_H+4*scale:0;const FOOTER_Y=GRID_Y+(visKeys.length>0?GRID_H+20*scale:50*scale);const TOTAL_H=Math.ceil(FOOTER_Y+FOOTER_INNER_H+18*scale);ctx.canvas.width=Math.max(1,W);ctx.canvas.height=Math.max(1,TOTAL_H);ctx.fillStyle=tv.bg;ctx.fillRect(0,0,W,TOTAL_H);const glow=ctx.createRadialGradient(W/2,0,0,W/2,0,W*.65);glow.addColorStop(0,`rgba(${ac.r},${ac.g},${ac.b},0.16)`);glow.addColorStop(1,`rgba(${ac.r},${ac.g},${ac.b},0)`);ctx.fillStyle=glow;ctx.fillRect(0,0,W,TOTAL_H);const g2=ctx.createRadialGradient(W,TOTAL_H,0,W,TOTAL_H,W*.4);g2.addColorStop(0,`rgba(${ac.r},${ac.g},${ac.b},0.07)`);g2.addColorStop(1,`rgba(${ac.r},${ac.g},${ac.b},0)`);ctx.fillStyle=g2;ctx.fillRect(0,0,W,TOTAL_H);const x0=PAD*scale;const LOGO_CY=LOGO_TOP+LOGO_LINE_H/2;ctx.font=`700 ${LOGO_SZ}px '${fh}','Inter',sans-serif`;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillStyle=tv.text;ctx.fillText('Trade',x0,LOGO_CY);const tradeW=ctx.measureText('Trade').width;ctx.fillStyle=accentHex;ctx.fillText('Zona',x0+tradeW,LOGO_CY);const SUB_CY=LOGO_TOP+LOGO_LINE_H+4*scale+SUB_LINE_H/2;ctx.font=`600 ${SUBTITLE_SZ}px '${fh}','Inter',sans-serif`;ctx.fillStyle=`rgba(${ac.r},${ac.g},${ac.b},0.55)`;ctx.textAlign='left';ctx.fillText('PERFORMANCE SUMMARY',x0,SUB_CY);const divGrad=ctx.createLinearGradient(x0,DIV_Y,W-x0,DIV_Y);divGrad.addColorStop(0,`rgba(${ac.r},${ac.g},${ac.b},0.35)`);divGrad.addColorStop(.6,`rgba(${ac.r},${ac.g},${ac.b},0.08)`);divGrad.addColorStop(1,`rgba(${ac.r},${ac.g},${ac.b},0)`);ctx.strokeStyle=divGrad;ctx.lineWidth=1*scale;ctx.beginPath();ctx.moveTo(x0,DIV_Y);ctx.lineTo(W-x0,DIV_Y);ctx.stroke();if(visKeys.length===0){ctx.font=`400 ${13*scale}px '${fh}','Inter',sans-serif`;ctx.fillStyle='rgba(255,255,255,0.2)';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Select metrics to display',W/2,GRID_Y+25*scale);ctx.textAlign='left';}else{visKeys.forEach((k,i)=>{const col=i%COLS,row=Math.floor(i/COLS);const cx=x0+col*(CELL_W+METRIC_GAP),cy=GRID_Y+row*(CELL_H+METRIC_GAP);const hl=highlighted.has(k),def=METRIC_DEFS[k];const{val,pos,neg}=def.format(data);_roundRect(ctx,cx,cy,CELL_W,CELL_H,10*scale);ctx.fillStyle=hl?`rgba(${ac.r},${ac.g},${ac.b},0.1)`:'rgba(255,255,255,0.04)';ctx.fill();_roundRect(ctx,cx+.5,cy+.5,CELL_W-1,CELL_H-1,10*scale);ctx.strokeStyle=hl?`rgba(${ac.r},${ac.g},${ac.b},0.3)`:'rgba(255,255,255,0.08)';ctx.lineWidth=1*scale;ctx.stroke();if(hl){const barGrad=ctx.createLinearGradient(cx,cy,cx+CELL_W,cy);barGrad.addColorStop(0,`rgba(${ac.r},${ac.g},${ac.b},0)`);barGrad.addColorStop(.5,`rgba(${ac.r},${ac.g},${ac.b},0.9)`);barGrad.addColorStop(1,`rgba(${ac.r},${ac.g},${ac.b},0)`);ctx.save();ctx.beginPath();_roundRect(ctx,cx,cy,CELL_W,2.5*scale,10*scale);ctx.clip();ctx.fillStyle=barGrad;ctx.fillRect(cx,cy,CELL_W,2.5*scale);ctx.restore();}ctx.font=`500 ${LABEL_SZ}px '${fh}','Inter',sans-serif`;ctx.fillStyle='rgba(255,255,255,0.38)';ctx.textBaseline='top';ctx.textAlign='left';ctx.fillText(def.label.toUpperCase(),cx+METRIC_PAD,cy+METRIC_PAD);ctx.font=`700 ${VALUE_SZ}px '${fh}','Inter',sans-serif`;ctx.textBaseline='top';if(hl)ctx.fillStyle=accentHex;else if(pos)ctx.fillStyle='#19c37d';else if(neg)ctx.fillStyle='#ff5f6d';else ctx.fillStyle=tv.text;ctx.fillText(val,cx+METRIC_PAD,cy+METRIC_PAD+LABEL_SZ+7*scale);});}const d=new Date();const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const todayFormatted=`${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;ctx.font=`500 ${(isPort?9:10)*scale}px '${fb}','Inter',sans-serif`;ctx.fillStyle='rgba(255,255,255,0.28)';ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(todayFormatted,W-x0,FOOTER_Y+BRANDING_LINE_H/2);ctx.textAlign='left';let brandingY=FOOTER_Y;if(_shareBranding.username&&branding?.displayName){ctx.font=`600 ${(isPort?11:12)*scale}px '${fh}','Inter',sans-serif`;ctx.fillStyle=tv.text;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(branding.displayName,x0,brandingY+BRANDING_LINE_H/2);brandingY+=BRANDING_LINE_H;}if(_shareBranding.referral&&branding?.referralCode){ctx.font=`500 ${(isPort?9:10)*scale}px '${fb}','Inter',sans-serif`;ctx.fillStyle=`rgba(${ac.r},${ac.g},${ac.b},0.65)`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('ref: '+branding.referralCode,x0,brandingY+BRANDING_LINE_H/2);}}
function _roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
let _cachedReferralCount=null;
async function getBrandingData(){
  const displayName=currentProfile?.name||currentUser?.user_metadata?.username||currentUser?.email?.split('@')[0]||'';
  const referralCode=currentProfile?.referral_code||currentUser?.user_metadata?.referral_code||currentUser?.user_metadata?.referralCode||'';
  if(_cachedReferralCount===null){
    try{_cachedReferralCount=await getReferralCount(currentUser.id);}catch(e){console.warn('[logs] Failed to fetch referral count:',e);_cachedReferralCount=0;}
  }
  return{displayName,referralCode,referralCount:_cachedReferralCount};
}
function setOrientation(o){_shareOrientation=o;document.getElementById('orientLand').classList.toggle('active',o==='landscape');document.getElementById('orientPort').classList.toggle('active',o==='portrait');_refreshPreview().catch(e=>console.warn('[logs] Preview update failed:',e));}
function toggleShareBranding(key){_shareBranding[key]=!_shareBranding[key];const togId='tog'+key.charAt(0).toUpperCase()+key.slice(1);const chkId='chk'+key.charAt(0).toUpperCase()+key.slice(1);const tog=document.getElementById(togId);const chk=document.getElementById(chkId);if(tog)tog.classList.toggle('on',_shareBranding[key]);if(chk)chk.textContent=_shareBranding[key]?'✓':'';_refreshPreview().catch(e=>console.warn('[logs] Preview update failed:',e));}
function openShareModal(){document.getElementById('btnShareNative').style.display=navigator.share?'flex':'none';_shareHighlighted=new Set();_shareOrientation='landscape';_shareBranding={username:true,referral:true};Object.keys(_shareVisibility).forEach(k=>_shareVisibility[k]=true);document.querySelectorAll('.share-tog[data-metric]').forEach(el=>{el.classList.add('on');el.querySelector('.share-tog-chk').textContent='✓';});document.querySelectorAll('.share-hl').forEach(el=>el.classList.remove('on'));document.getElementById('orientLand').classList.add('active');document.getElementById('orientPort').classList.remove('active');const tuEl=document.getElementById('togUsername');const cuEl=document.getElementById('chkUsername');if(tuEl)tuEl.classList.add('on');if(cuEl)cuEl.textContent='✓';const trEl=document.getElementById('togReferral');const crEl=document.getElementById('chkReferral');if(trEl)trEl.classList.add('on');if(crEl)crEl.textContent='✓';document.getElementById('shareGenerating').classList.remove('show');document.getElementById('shareOverlay').classList.add('open');setTimeout(()=>_refreshPreview().catch(e=>console.warn('[logs] Preview update failed:',e)),80);}
function closeShareModal(){document.getElementById('shareOverlay').classList.remove('open');}
function toggleShareMetric(el){const m=el.dataset.metric;_shareVisibility[m]=!_shareVisibility[m];el.classList.toggle('on',_shareVisibility[m]);el.querySelector('.share-tog-chk').textContent=_shareVisibility[m]?'✓':'';if(!_shareVisibility[m]){_shareHighlighted.delete(m);const hl=document.querySelector(`.share-hl[data-metric="${m}"]`);if(hl)hl.classList.remove('on');}_refreshPreview().catch(e=>console.warn('[logs] Preview update failed:',e));}
function toggleShareHighlight(el){const m=el.dataset.metric;if(!_shareVisibility[m])return;if(_shareHighlighted.has(m)){_shareHighlighted.delete(m);el.classList.remove('on');}else{_shareHighlighted.add(m);el.classList.add('on');}_refreshPreview().catch(e=>console.warn('[logs] Preview update failed:',e));}
function _getVisibleKeys(){return Object.keys(METRIC_DEFS).filter(k=>_shareVisibility[k]);}
async function _refreshPreview(){const wrap=document.getElementById('sharePreviewWrap'),cv=document.getElementById('sharePreviewCanvas');if(!wrap||!cv)return;const isPort=_shareOrientation==='portrait';const CARD_W_USE=isPort?CARD_W_PORT:CARD_W_LAND;const maxW=Math.max(wrap.clientWidth-32,180);const scale=Math.max(.25,Math.min(1,maxW/CARD_W_USE));const ctx=cv.getContext('2d');const data=computeAnalytics(getFilteredTrades());const visKeys=_getVisibleKeys();const branding=await getBrandingData();_drawCard(ctx,scale,data,visKeys,_shareHighlighted,_shareOrientation,branding);cv.style.width=cv.width+'px';cv.style.height=cv.height+'px';}
async function _buildExportCanvas(){const offscreen=document.createElement('canvas');const ctx=offscreen.getContext('2d');const data=computeAnalytics(getFilteredTrades());const visKeys=_getVisibleKeys();const branding=await getBrandingData();_drawCard(ctx,2,data,visKeys,_shareHighlighted,_shareOrientation,branding);return offscreen;}
function _setExporting(on){document.getElementById('shareGenerating').classList.toggle('show',on);const stack=document.getElementById('shareActionsStack');if(stack)stack.style.opacity=on?'0.4':'';}
async function doShareDownload(){_setExporting(true);await document.fonts.ready;try{const cv=await _buildExportCanvas();const a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download=`tradinggrove-${todayLocal()}.png`;document.body.appendChild(a);a.click();document.body.removeChild(a);showToast('Downloaded!','fa-solid fa-circle-check','green');}catch(e){showToast('Export failed: '+e.message,'fa-solid fa-circle-exclamation','red');}finally{_setExporting(false);}}
async function doShareCopy(){_setExporting(true);await document.fonts.ready;try{const cv=await _buildExportCanvas();cv.toBlob(async blob=>{try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);showToast('Copied!','fa-solid fa-circle-check','green');}catch(clipErr){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`tradinggrove-${todayLocal()}.png`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);showToast('Clipboard unavailable — downloaded instead.','fa-solid fa-triangle-exclamation','');}finally{_setExporting(false);}},'image/png');}catch(e){showToast('Export failed: '+e.message,'fa-solid fa-circle-exclamation','red');_setExporting(false);}}
async function doShareNative(){if(!navigator.share)return;_setExporting(true);await document.fonts.ready;try{const cv=await _buildExportCanvas();cv.toBlob(async blob=>{const file=new File([blob],`tradinggrove-${todayLocal()}.png`,{type:'image/png'});try{await navigator.share({files:[file],title:'My TradingGrove Performance',text:'Check out my trading performance!'});}catch(e){if(e.name!=='AbortError')showToast('Share failed.','fa-solid fa-circle-exclamation','red');}finally{_setExporting(false);}},'image/png');}catch(e){showToast('Export failed: '+e.message,'fa-solid fa-circle-exclamation','red');_setExporting(false);}}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let _tt;
function showToast(msg,icon='fa-solid fa-circle-check',type=''){const t=document.getElementById('toast');document.getElementById('toastIcon').className=icon;document.getElementById('toastMsg').textContent=msg;t.className='show'+(type==='green'?' toast-green':type==='red'?' toast-red':'');clearTimeout(_tt);_tt=setTimeout(()=>{t.classList.remove('show','toast-green','toast-red');},3500);}

// ─── OVERLAY CLOSE HANDLERS ───────────────────────────────────────────────────
document.getElementById('nOverlay').addEventListener('click',function(e){if(e.target===this)closeNotes();});
document.getElementById('cOverlay').addEventListener('click',function(e){if(e.target===this)closeCon();});
document.getElementById('mDelOverlay').addEventListener('click',function(e){if(e.target===this)closeMDel();});

// ─── RESIZE / BEFOREUNLOAD ────────────────────────────────────────────────────
window.addEventListener('resize',()=>{if(document.getElementById('shareOverlay').classList.contains('open'))_refreshPreview();if(window.innerWidth<=520&&_fmOpen){const modal=document.getElementById('filterModal');modal.style.left='';modal.style.top='';_fmPosX=null;_fmPosY=null;}});
// Best-effort flush on tab close / hide. captureActiveInputs() alone only writes
// to the in-memory trades array + localStorage — without firing the network
// updates below, anything typed within the 2s save debounce window stays local
// only. visibilitychange fires before pagehide, giving fetches the best chance
// to complete; pagehide is the last-resort backstop.
function _flushPendingNow(){
  captureActiveInputs();
  if(_pending.size===0)return;
  for(const id of [..._pending]){
    if(id.startsWith('temp_'))continue;
    clearTimeout(_saveTimers[id]);
    clearTimeout(_saveTimers[id+'_c']);
    clearTimeout(_valInputTimers[id]);
    // Fire-and-forget. updateTrade returns a promise; we don't await — the
    // browser will keep the in-flight fetch alive long enough on most platforms.
    try{commitSave(id);}catch(e){}
  }
}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')_flushPendingNow();
});
window.addEventListener('pagehide',_flushPendingNow);
window.addEventListener('beforeunload',e=>{
  _flushPendingNow();
  e.stopImmediatePropagation();
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.getElementById('pageSizeSelect').value=PAGE_SIZE;
// (The previous infinite-scroll-on-tableWrap handler was removed — it fought
// with the pagination buttons, mutated the global currentPage out from under
// render(), and re-built rows with handlers bound to a stale page index. Use
// the explicit pagination controls or page-size selector instead.)

document.addEventListener('input',e=>{const el=e.target;if(el.tagName==='TEXTAREA'||el.tagName==='INPUT'){if('defaultValue' in el)el.defaultValue=el.value;}},true);

// Security — but never block context menu / selection on input fields, or
// right-click paste stops working in PnL / Ratio / Pair / Notes textareas.
document.addEventListener('contextmenu',e=>{
  const tag=e.target.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  e.preventDefault();
});
document.addEventListener('keydown',e=>{const ctrl=e.ctrlKey||e.metaKey,shift=e.shiftKey;if(e.key==='F12'||(ctrl&&e.key.toLowerCase()==='u')||(ctrl&&shift&&['i','j','c'].includes(e.key.toLowerCase()))||(ctrl&&e.key.toLowerCase()==='s')||(ctrl&&e.key.toLowerCase()==='p')){e.preventDefault();e.stopPropagation();return false;}},true);
document.addEventListener('selectstart',e=>{const tag=e.target.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;e.preventDefault();});
document.addEventListener('dragstart',e=>e.preventDefault());

// ─── CSS: draft-flash animation (injected so no CSS file change needed) ────────
(()=>{
  const style=document.createElement('style');
  style.textContent=`
    @keyframes draftFlash {
      0%   { box-shadow: inset 0 0 0 2px #ff5f6d; background: rgba(255,95,109,0.08); }
      50%  { box-shadow: inset 0 0 0 2px #ff5f6d88; background: rgba(255,95,109,0.04); }
      100% { box-shadow: inset 0 0 0 2px #ff5f6d; background: rgba(255,95,109,0.08); }
    }
    tr.draft-flash td { animation: draftFlash 0.4s ease 3; }
  `;
  document.head.appendChild(style);
})();