// notes.js - notes / journal-notes page
// Loaded by /src/pages/notes.html. Depends on globals from supabase-client.js,
// theme.js, and external libs (JSZip, html2pdf).
// ─── message bus ───────────────────────────────────────────────────────────
let journalLocked = false;
window.addEventListener('message', e => {
  if (e.data?.type === 'tz_plan' && e.data.isPro !== undefined) userIsPro = e.data.isPro;
  if (e.data?.type === 'tz_plan' && e.data.locked !== undefined) journalLocked = e.data.locked;
});

// Trade + note writes are blocked when this journal is read-only (Pro downgraded
// past grace and this isn't the one kept-active journal).
(function _guardWrites(){
  const _updateTrade=updateTrade,_addTradeImage=addTradeImage,_deleteTradeImage=deleteTradeImage;
  const _insertCustomNote=insertCustomNote,_updateCustomNote=updateCustomNote,_deleteCustomNote=deleteCustomNote,_uploadCustomNoteImage=uploadCustomNoteImage;
  function blocked(){if(typeof showToast==='function')showToast('This journal is read-only — subscription expired. Renew Pro to edit.','fa-solid fa-lock','r');return Promise.reject(new Error('journal_locked'));}
  updateTrade=(...a)=>journalLocked?blocked():_updateTrade(...a);
  addTradeImage=(...a)=>journalLocked?blocked():_addTradeImage(...a);
  deleteTradeImage=(...a)=>journalLocked?blocked():_deleteTradeImage(...a);
  insertCustomNote=(...a)=>journalLocked?blocked():_insertCustomNote(...a);
  updateCustomNote=(...a)=>journalLocked?blocked():_updateCustomNote(...a);
  deleteCustomNote=(...a)=>journalLocked?blocked():_deleteCustomNote(...a);
  uploadCustomNoteImage=(...a)=>journalLocked?blocked():_uploadCustomNoteImage(...a);
})();

// ─── journal id ────────────────────────────────────────────────────────────
const jid = sessionStorage.getItem('tz_current_journal')
  || localStorage.getItem('tz_current_journal')
  || (()=>{ try { return parent?.sessionStorage?.getItem('tz_current_journal') || parent?.localStorage?.getItem('tz_current_journal'); } catch(e){return null;} })();

// ─── globals ───────────────────────────────────────────────────────────────
let allTrades=[], customNotes=[], settings=null, currentUser=null;
let userIsPro=false;
let currentTradeId=null, modalImgBuffer=[], saveTimer=null, _saveIndicatorTimer=null;
let activeTab='logs';
let searchQuery='', sortDir='desc';
let cnEditId=null, cnTags=[], cnColor='', cnImgBuffer=[];
let lbImages=[],lbIndex=0,lbScale=1,lbPanX=0,lbPanY=0,lbDragging=false,lbLastX=0,lbLastY=0;

// filter state
const fState={date:{from:'',to:''},pair:[],position:[],strategy:[],timeframe:[],mood:[],confidence:0,result:[],hasImage:[],tags:[],pinnedOnly:false};
let _fmOpen=false,_fmConfSel=0,_fmDragging=false,_fmDragOffX=0,_fmDragOffY=0,_fmPosX=null,_fmPosY=null;
let fmCalYear=new Date().getFullYear(),fmCalMonth=new Date().getMonth();
let fmRangeStart='',fmRangeEnd='',fmPickingEnd=false;
const MONTHS_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ALLOWED_IMG=['image/png','image/jpeg','image/jpg','image/gif','image/webp'];

function esc(s){const d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML;}
function fmtPnl(v){const n=parseFloat(v);if(isNaN(n)||v==null||v==='')return null;return{str:(n>=0?'+':'-')+'$'+Math.abs(n).toFixed(2),pos:n>0,neg:n<0};}
function fmtR(v){const n=parseFloat(v);if(isNaN(n)||v==null||v==='')return null;return{str:(n>=0?'+':'')+n.toFixed(2)+'R',pos:n>0,neg:n<0};}
function todayLocal(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function validateImg(file){if(!ALLOWED_IMG.includes(file.type)){showToast('Only PNG, JPG, GIF, WebP allowed.','fa-solid fa-triangle-exclamation','r');return false;}if(file.size>5*1024*1024){showToast('Max 5MB per image.','fa-solid fa-triangle-exclamation','r');return false;}return true;}

// ─── init ──────────────────────────────────────────────────────────────────
(async()=>{
  try{
    if(!jid){
      document.getElementById('skelGrid').style.display='none';
      document.getElementById('content-logs').innerHTML='<div class="empty-state"><div class="ei"><i class="fa-solid fa-note-sticky"></i></div><h3>No journal selected</h3><p>Open a journal first.</p></div>';
      document.body.style.visibility='visible';
      _notesHideLoading();
      return;
    }
    try{userIsPro=parent?._userIsPro||false;}catch(e){}
    try{journalLocked=parent?._journalLocked||false;}catch(e){}
    try{
      const {data:{user}}=await db.auth.getUser();
      currentUser=user;
      if(user){const p=await getProfile(user.id);if(p){userIsPro=getSubscriptionStatus(p).isPro;}}
    }catch(e){
      console.error('[notes] Failed to fetch user:',e);
      document.getElementById('skelGrid').style.display='none';
      document.getElementById('content-logs').innerHTML='<div class="empty-state"><div class="ei"><i class="fa-solid fa-triangle-exclamation"></i></div><h3>Failed to load</h3><p>Please refresh the page.</p></div>';
      document.body.style.visibility='visible';
      _notesHideLoading();
      return;
    }
    if(!userIsPro){document.getElementById('notesAdSlot').classList.add('visible');/* TODO: replace ca-pub-XXXXXXXXXXXXXXXX with real AdSense publisher ID to enable ads */}

    try{
      settings=await getJournalSettings(jid);
    }catch(e){
      console.warn('[notes] Failed to fetch journal settings:',e);
    }

    try{
      const [raw, cnRaw]=await Promise.all([getTrades(jid), getCustomNotesFn(jid)]);
      allTrades=await Promise.all(raw.map(dbToTrade).map(loadTradeWithImages));
      customNotes=await Promise.all((cnRaw||[]).map(loadCustomNoteImageUrls));
    }catch(e){
      console.error('[notes] Failed to fetch trades/notes:',e);
      document.getElementById('skelGrid').style.display='none';
      document.getElementById('content-logs').innerHTML='<div class="empty-state"><div class="ei"><i class="fa-solid fa-triangle-exclamation"></i></div><h3>Failed to load notes</h3><p>Please refresh the page.</p></div>';
      document.body.style.visibility='visible';
      _notesHideLoading();
      return;
    }

    document.getElementById('skelGrid').style.display='none';
    render();
    document.body.style.visibility='visible';
    _notesHideLoading();

    // Realtime: apply inline deltas instead of refetching every trade and
    // every trade image on every event. INSERT fetches images for the one
    // new trade; UPDATE preserves the existing images array (image changes
    // arrive on their own table's realtime path); DELETE drops the entry.
    try{
      subscribeTrades(jid,async(payload)=>{
        if(!payload||!payload.eventType){
          // Defensive fallback — no payload means "something changed", do a
          // full refetch.
          const r=await getTrades(jid);
          allTrades=await Promise.all(r.map(dbToTrade).map(loadTradeWithImages));
          render();
          return;
        }
        if(payload.eventType==='INSERT'){
          const inserted=dbToTrade(payload.new);
          const withImgs=await loadTradeWithImages(inserted);
          // Idempotent: replace if it somehow already exists
          const idx=allTrades.findIndex(t=>t.id===withImgs.id);
          if(idx>=0)allTrades=allTrades.map((t,i)=>i===idx?withImgs:t);
          else allTrades=[withImgs,...allTrades];
        }else if(payload.eventType==='UPDATE'){
          allTrades=applyTradeDelta(allTrades,payload,(existing,incoming)=>({
            ...existing,...incoming,
            // Trade-image changes have their own realtime channel; preserve the
            // already-resolved image URLs here so we don't re-sign every visible
            // thumb on every notes/pnl/r-factor edit.
            images:existing.images,
            // Pin state changes might arrive before full record update; ensure
            // incoming.pinned (from UPDATE event) is used, or keep existing
            pinned:incoming.pinned!==undefined?incoming.pinned:existing.pinned,
          }));
        }else if(payload.eventType==='DELETE'){
          const id=payload.old?.id;
          if(id)allTrades=allTrades.filter(t=>t.id!==id);
        }
        render();
        if(currentTradeId&&document.getElementById('overlay').classList.contains('open')){
          const u=allTrades.find(t=>t.id===currentTradeId);if(u)_refreshModalMeta(u);
        }
      });
    }catch(e){
      console.warn('[notes] Failed to subscribe to realtime updates:',e);
    }
  }catch(e){
    console.error('[notes] Initialization failed:',e);
    document.getElementById('skelGrid').style.display='none';
    document.getElementById('content-logs').innerHTML='<div class="empty-state"><div class="ei"><i class="fa-solid fa-triangle-exclamation"></i></div><h3>Error loading notes</h3><p>Please refresh the page.</p></div>';
    document.body.style.visibility='visible';
    _notesHideLoading();
  }
})();

function _notesHideLoading(){
  const overlay=document.getElementById('notesLoadingOverlay');
  if(overlay){overlay.classList.add('hidden');setTimeout(()=>{overlay.style.display='none';},300);}
}

async function loadTradeWithImages(t){
  const rawImgs=await getTradeImages(t.id);
  const imgs=await Promise.all(rawImgs.map(async img=>{const url=await getImageUrl(img);return{...img,_previewUrl:url};}));
  return{...t,images:imgs};
}

async function loadCustomNoteImageUrls(n){
  const arr=Array.isArray(n.images)?n.images:[];
  const urls=await Promise.all(arr.map(async img=>{
    if(!img)return '';
    if(typeof img==='string')return img;
    if(img._previewUrl)return img._previewUrl;
    if(typeof getCustomNoteImageUrl==='function')return await getCustomNoteImageUrl(img);
    return img.storage_url||img.url||'';
  }));
  return {...n,_displayImages:urls};
}

// ─── Custom notes Supabase (inline fallbacks if helpers not in supabase.js) ─
async function getCustomNotesFn(journalId){
  try{
    const{data,error}=await db.from('custom_notes').select('*').eq('journal_id',journalId).order('created_at',{ascending:false});
    if(error)throw error; return data||[];
  }catch(e){return[];}
}
async function insertCustomNoteFn(note){
  const{data,error}=await db.from('custom_notes').insert({user_id:currentUser.id,journal_id:jid,...note}).select().single();
  if(error)throw error; return data;
}
async function updateCustomNoteFn(id,updates){
  const{error}=await db.from('custom_notes').update({...updates,updated_at:new Date().toISOString()}).eq('id',id);
  if(error)throw error;
}
async function deleteCustomNoteFn(id){
  const{error}=await db.from('custom_notes').delete().eq('id',id);
  if(error)throw error;
}

// ─── Tab switching ─────────────────────────────────────────────────────────
function switchTab(tab){
  activeTab=tab;
  document.getElementById('tab-logs').classList.toggle('active',tab==='logs');
  document.getElementById('tab-custom').classList.toggle('active',tab==='custom');
  document.getElementById('content-logs').classList.toggle('active',tab==='logs');
  document.getElementById('content-custom').classList.toggle('active',tab==='custom');
  document.getElementById('btnNewNote').style.display=tab==='custom'?'flex':'none';
  if(_fmOpen){fmPopulateAll();fmUpdateTabSections();fmUpdateDisplay();fmUpdateResultCount();}
  render();
}

function fmUpdateTabSections(){
  const isLogs=activeTab==='logs';
  ['fms-position','fms-pair','fms-strategy','fms-timeframe','fms-mood','fms-confidence','fms-result','fms-hasimage']
    .forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=isLogs?'':'none';});
  ['fms-tags','fms-pinned']
    .forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=isLogs?'none':'';});
  document.getElementById('fmModalTitle').textContent=isLogs?'Filter Log Notes':'Filter Custom Notes';
}

// ─── Search ────────────────────────────────────────────────────────────────
function onSearchInput(val){searchQuery=val;render();updateFilterCountBadge();}

// ─── Filter modal ──────────────────────────────────────────────────────────
function toggleFilterModal(btn){
  if(_fmOpen){closeFilterModal();return;}
  _fmOpen=true;
  const modal=document.getElementById('filterModal'),backdrop=document.getElementById('filterBackdrop');
  btn.classList.add('open');backdrop.classList.add('open');modal.classList.remove('closing');modal.classList.add('open');
  if(window.innerWidth>520){
    if(_fmPosX!==null){modal.style.left=_fmPosX+'px';modal.style.top=_fmPosY+'px';}
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
  fmUpdateTabSections();
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
  if(activeTab==='logs'){
    const pairs=[...new Set(allTrades.map(t=>(t.pair||'').toUpperCase()).filter(Boolean))].sort();
    fmPopulateChips('pair',pairs);
    fmPopulateChips('strategy',settings?.strategies||[]);
    fmPopulateChips('timeframe',settings?.timeframes||[]);
    fmPopulateMoodChips();
    document.querySelectorAll('.fm-chip[data-field="position"]').forEach(chip=>{chip.classList.toggle('sel',fState.position.includes(chip.dataset.value));});
    document.querySelectorAll('.fm-chip[data-field="result"]').forEach(chip=>{chip.classList.toggle('sel',fState.result.includes(chip.dataset.value));});
    document.querySelectorAll('.fm-chip[data-field="hasImage"]').forEach(chip=>{chip.classList.toggle('sel',fState.hasImage.includes(chip.dataset.value));});
    _fmConfSel=fState.confidence;
    document.querySelectorAll('.fm-star-chip').forEach(s=>{s.classList.toggle('sel',parseInt(s.dataset.v)===_fmConfSel);});
  } else {
    // custom tags
    const allTags=[...new Set(customNotes.flatMap(n=>n.tags||[]))].sort();
    const el=document.getElementById('fm-tags-chips');
    if(el){
      if(!allTags.length){el.innerHTML='<span style="font-size:11px;color:var(--muted)">No tags yet</span>';}
      else{el.innerHTML='';allTags.forEach(tag=>{const chip=document.createElement('div');chip.className='fm-chip'+(fState.tags.includes(tag)?' sel':'');chip.dataset.field='tags';chip.dataset.value=tag;chip.textContent=tag;chip.addEventListener('click',()=>fmToggleChip(chip));el.appendChild(chip);});}
    }
    const pinnedChip=document.getElementById('fm-pinned-chip');
    if(pinnedChip)pinnedChip.classList.toggle('sel',fState.pinnedOnly);
  }
  document.getElementById('fm-sort-desc').classList.toggle('sel',sortDir==='desc');
  document.getElementById('fm-sort-asc').classList.toggle('sel',sortDir==='asc');
}
function fmPopulateChips(field,items){
  const el=document.getElementById('fm-'+field+'-chips');if(!el)return;
  const sel=fState[field]||[];
  if(!items.length){el.innerHTML='<span style="font-size:11px;color:var(--muted)">No items yet</span>';return;}
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
    const c=colors[m];if(c){const dot=document.createElement('span');dot.style.cssText=`display:inline-block;width:7px;height:7px;border-radius:50%;background:${c};margin-right:4px;flex-shrink:0`;chip.appendChild(dot);if(sel.includes(m)){const[r,g,b]=[c.slice(1,3),c.slice(3,5),c.slice(5,7)].map(x=>parseInt(x,16));chip.style.cssText=`background:rgba(${r},${g},${b},.15);color:${c};border-color:rgba(${r},${g},${b},.45)`;}}
    chip.appendChild(document.createTextNode(m));chip.addEventListener('click',()=>fmToggleChip(chip));el.appendChild(chip);
  });
}
function fmToggleChip(chip){
  const field=chip.dataset.field,value=chip.dataset.value;if(!field||!value)return;
  chip.classList.toggle('sel');const isSel=chip.classList.contains('sel');
  if(field==='position'){if(isSel&&!fState.position.includes(value))fState.position.push(value);else fState.position=fState.position.filter(v=>v!==value);}
  else if(field==='result'){if(isSel&&!fState.result.includes(value))fState.result.push(value);else fState.result=fState.result.filter(v=>v!==value);}
  else if(field==='hasImage'){if(isSel&&!fState.hasImage.includes(value))fState.hasImage.push(value);else fState.hasImage=fState.hasImage.filter(v=>v!==value);}
  else if(field==='tags'){if(isSel&&!fState.tags.includes(value))fState.tags.push(value);else fState.tags=fState.tags.filter(v=>v!==value);}
  else{if(isSel&&!fState[field].includes(value))fState[field].push(value);else fState[field]=fState[field].filter(v=>v!==value);}
  fmApply();
}
function fmTogglePinnedOnly(){
  fState.pinnedOnly=!fState.pinnedOnly;
  document.getElementById('fm-pinned-chip').classList.toggle('sel',fState.pinnedOnly);
  fmApply();
}
function fmSetSort(dir){sortDir=dir;document.getElementById('fm-sort-desc').classList.toggle('sel',dir==='desc');document.getElementById('fm-sort-asc').classList.toggle('sel',dir==='asc');fmApply();}
function fmStarClick(v){_fmConfSel=_fmConfSel===v?0:v;fState.confidence=_fmConfSel;document.querySelectorAll('.fm-star-chip').forEach(s=>{s.classList.toggle('sel',parseInt(s.dataset.v)===_fmConfSel);});fmApply();}
function fmApply(){updateFilterCountBadge();render();fmUpdateDisplay();fmUpdateResultCount();}

function fmUpdateDisplay(){
  const display=document.getElementById('fmDisplay'),emptyEl=document.getElementById('fmDisplayEmpty'),countEl=document.getElementById('fmDisplayCount');
  const tags=[];
  if(fState.date.from||fState.date.to){const from=fState.date.from||'…',to=fState.date.to||'…';tags.push({label:from===to?from:`${from} → ${to}`,field:'date',value:''});}
  fState.position.forEach(v=>tags.push({label:v,field:'position',value:v}));
  fState.pair.forEach(v=>tags.push({label:v,field:'pair',value:v}));
  fState.strategy.forEach(v=>tags.push({label:v,field:'strategy',value:v}));
  fState.timeframe.forEach(v=>tags.push({label:v,field:'timeframe',value:v}));
  fState.mood.forEach(v=>tags.push({label:v,field:'mood',value:v}));
  fState.result.forEach(v=>tags.push({label:v==='win'?'✅ Win':'❌ Loss',field:'result',value:v}));
  fState.hasImage.forEach(v=>tags.push({label:v==='yes'?'Has Image':'No Image',field:'hasImage',value:v}));
  fState.tags.forEach(v=>tags.push({label:v,field:'tags',value:v}));
  if(fState.confidence>0)tags.push({label:'★'.repeat(fState.confidence)+'+',field:'confidence',value:fState.confidence});
  if(fState.pinnedOnly)tags.push({label:'Pinned Only',field:'pinnedOnly',value:''});
  if(searchQuery.trim())tags.push({label:`"${searchQuery}"`,field:'search',value:''});
  [...display.children].forEach(el=>{if(!el.classList.contains('fm-display-empty')&&!el.classList.contains('fm-display-count'))el.remove();});
  if(!tags.length){emptyEl.style.display='';countEl.textContent='';}
  else{
    emptyEl.style.display='none';
    tags.forEach(tag=>{const span=document.createElement('span');span.className='fm-active-tag';span.innerHTML=esc(tag.label);const xBtn=document.createElement('button');xBtn.className='fm-tag-x';xBtn.innerHTML='<i class="fa-solid fa-xmark"></i>';xBtn.onclick=(e)=>{e.stopPropagation();fmRemoveTag(tag);};span.appendChild(xBtn);display.insertBefore(span,countEl);});
    countEl.textContent=tags.length+' filter'+(tags.length!==1?'s':'');
  }
}
function fmRemoveTag(tag){
  if(tag.field==='date'){fState.date={from:'',to:''};fmRangeStart='';fmRangeEnd='';fmPickingEnd=false;fmRenderCal();}
  else if(tag.field==='confidence'){fState.confidence=0;_fmConfSel=0;document.querySelectorAll('.fm-star-chip').forEach(s=>s.classList.remove('sel'));}
  else if(tag.field==='search'){searchQuery='';document.getElementById('searchInp').value='';return fmApply();}
  else if(tag.field==='pinnedOnly'){fState.pinnedOnly=false;const c=document.getElementById('fm-pinned-chip');if(c)c.classList.remove('sel');}
  else if(tag.field==='position'){fState.position=fState.position.filter(v=>v!==tag.value);document.querySelectorAll(`.fm-chip[data-field="position"][data-value="${tag.value}"]`).forEach(c=>c.classList.remove('sel'));}
  else if(tag.field==='result'){fState.result=fState.result.filter(v=>v!==tag.value);document.querySelectorAll(`.fm-chip[data-field="result"][data-value="${tag.value}"]`).forEach(c=>c.classList.remove('sel'));}
  else if(tag.field==='hasImage'){fState.hasImage=fState.hasImage.filter(v=>v!==tag.value);document.querySelectorAll(`.fm-chip[data-field="hasImage"][data-value="${tag.value}"]`).forEach(c=>c.classList.remove('sel'));}
  else if(tag.field==='tags'){fState.tags=fState.tags.filter(v=>v!==tag.value);document.querySelectorAll(`.fm-chip[data-field="tags"][data-value="${CSS.escape(tag.value)}"]`).forEach(c=>c.classList.remove('sel'));}
  else{fState[tag.field]=fState[tag.field].filter(v=>v!==tag.value);document.querySelectorAll(`.fm-chip[data-field="${tag.field}"][data-value="${CSS.escape(tag.value)}"]`).forEach(c=>c.classList.remove('sel'));}
  fmApply();
}
function fmUpdateResultCount(){
  const n=activeTab==='logs'?getFilteredLogs().length:getFilteredCustom().length;
  document.getElementById('fmResultNum').textContent=n;
}
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
  Object.assign(fState,{date:{from:'',to:''},pair:[],position:[],strategy:[],timeframe:[],mood:[],confidence:0,result:[],hasImage:[],tags:[],pinnedOnly:false});
  fmRangeStart='';fmRangeEnd='';fmPickingEnd=false;fmCalYear=new Date().getFullYear();fmCalMonth=new Date().getMonth();
  sortDir='desc';_fmConfSel=0;fmPopulateAll();fmRenderCal();updateFilterCountBadge();render();fmUpdateDisplay();fmUpdateResultCount();
}
function updateFilterCountBadge(){
  const checks=[!!(fState.date.from||fState.date.to),fState.pair.length>0,fState.position.length>0,fState.strategy.length>0,fState.timeframe.length>0,fState.mood.length>0,fState.confidence>0,fState.result.length>0,fState.hasImage.length>0,fState.tags.length>0,fState.pinnedOnly];
  const count=checks.filter(Boolean).length;
  const badge=document.getElementById('filterCountBadge'),clearBtn=document.getElementById('btnFilterClear'),btn=document.getElementById('btnFilter');
  badge.textContent=count;badge.classList.toggle('show',count>0);clearBtn.classList.toggle('show',count>0||searchQuery.trim()!=='');btn.classList.toggle('active',count>0);
  const total=activeTab==='logs'?allTrades.filter(t=>(t.notes&&t.notes.trim())||(t.images&&t.images.length)).length:customNotes.length;
  const filtered=activeTab==='logs'?getFilteredLogs().length:getFilteredCustom().length;
  const hasFilter=count>0||searchQuery.trim()!=='';
  document.getElementById('fbResultCount').textContent=hasFilter?`${filtered} of ${total}`:'';
}
function clearAllFilters(){
  Object.assign(fState,{date:{from:'',to:''},pair:[],position:[],strategy:[],timeframe:[],mood:[],confidence:0,result:[],hasImage:[],tags:[],pinnedOnly:false});
  fmRangeStart='';fmRangeEnd='';fmPickingEnd=false;sortDir='desc';_fmConfSel=0;searchQuery='';document.getElementById('searchInp').value='';
  updateFilterCountBadge();render();
  if(_fmOpen){fmPopulateAll();fmRenderCal();fmUpdateDisplay();fmUpdateResultCount();}
}

// ─── Filter logic ──────────────────────────────────────────────────────────
function tradeMatchesSearch(t,q){if(!q.trim())return true;const lq=q.toLowerCase();const fields=[t.pair||'',t.date||'',t.position||'',...(t.strategy||[]),...(t.timeframe||[]),...(t.mood||[]),t.pnl!=null?String(t.pnl):'',t.r!=null?String(t.r):'',t.notes||''];return fields.some(f=>f.toLowerCase().includes(lq));}
function cnMatchesSearch(n,q){if(!q.trim())return true;const lq=q.toLowerCase();return (n.title||'').toLowerCase().includes(lq)||(n.body||'').toLowerCase().includes(lq)||(n.tags||[]).join(' ').toLowerCase().includes(lq);}

function getFilteredLogs(){
  let items=allTrades.filter(t=>(t.notes&&t.notes.trim())||(t.images&&t.images.length));
  const f=fState;
  if(f.date.from)items=items.filter(t=>t.date&&t.date>=f.date.from);
  if(f.date.to)items=items.filter(t=>t.date&&t.date<=f.date.to);
  if(f.pair.length)items=items.filter(t=>f.pair.includes((t.pair||'').toUpperCase()));
  if(f.position.length)items=items.filter(t=>f.position.includes(t.position));
  if(f.strategy.length)items=items.filter(t=>(t.strategy||[]).some(s=>f.strategy.includes(s)));
  if(f.timeframe.length)items=items.filter(t=>(t.timeframe||[]).some(s=>f.timeframe.includes(s)));
  if(f.mood.length)items=items.filter(t=>(t.mood||[]).some(s=>f.mood.includes(s)));
  if(f.confidence>0)items=items.filter(t=>(t.confidence||0)>=f.confidence);
  if(f.result.length===1){if(f.result[0]==='win')items=items.filter(t=>parseFloat(t.pnl)>0);if(f.result[0]==='loss')items=items.filter(t=>parseFloat(t.pnl)<0);}
  if(f.hasImage.length===1){if(f.hasImage[0]==='yes')items=items.filter(t=>t.images&&t.images.length>0);if(f.hasImage[0]==='no')items=items.filter(t=>!t.images||t.images.length===0);}
  if(searchQuery.trim())items=items.filter(t=>tradeMatchesSearch(t,searchQuery));
  items.sort((a,b)=>{const da=a.date||'',db=b.date||'';return sortDir==='asc'?da.localeCompare(db):db.localeCompare(da);});
  return items;
}
function getFilteredCustom(){
  let items=[...customNotes];
  const f=fState;
  if(f.date.from)items=items.filter(n=>(n.created_at||'').slice(0,10)>=f.date.from);
  if(f.date.to)items=items.filter(n=>(n.created_at||'').slice(0,10)<=f.date.to);
  if(f.tags.length)items=items.filter(n=>(n.tags||[]).some(t=>f.tags.includes(t)));
  if(f.pinnedOnly)items=items.filter(n=>n.pinned);
  if(searchQuery.trim())items=items.filter(n=>cnMatchesSearch(n,searchQuery));
  items.sort((a,b)=>{const da=a.created_at||'',db=b.created_at||'';return sortDir==='asc'?da.localeCompare(db):db.localeCompare(da);});
  return items;
}

// ─── Export to PDF (preview-first, then download) ──────────────────────────
// Convert any image URL to a data: URL so html2canvas won't be blocked by CORS
async function _urlToDataUrl(url){
  if(!url)return '';
  if(url.startsWith('data:'))return url;
  try{
    const res=await fetch(url,{mode:'cors',credentials:'omit'});
    const blob=await res.blob();
    return await new Promise((res2,rej)=>{
      const r=new FileReader();r.onload=()=>res2(r.result);r.onerror=rej;r.readAsDataURL(blob);
    });
  }catch(e){return '';}
}

let _pdfPrevItemCount=0;

async function exportFilteredToPdf(){
  const items=activeTab==='logs'?getFilteredLogs():getFilteredCustom();
  if(!items.length){showToast('Nothing to export.','fa-solid fa-triangle-exclamation','r');return;}
  // Open the preview shell immediately so the user gets feedback
  const overlay=document.getElementById('pdfPrevOverlay');
  const page=document.getElementById('pdfPrevPage');
  document.getElementById('pdfPrevCount').textContent=`${items.length} note${items.length!==1?'s':''}`;
  page.innerHTML='<div class="pdf-prev-loading"><i class="fa-solid fa-spinner" style="animation:spin 1s linear infinite"></i> Building preview…</div>';
  overlay.classList.add('open');
  document.getElementById('pdfDownloadBtn').disabled=true;
  _pdfPrevItemCount=items.length;
  try{
    // Inline every referenced image as a data: URL up-front. CORS-tainted
    // images otherwise blank the rendered canvas → empty PDF.
    const imgUrlSet=new Set();
    if(activeTab==='logs'){items.forEach(t=>(t.images||[]).forEach(im=>{if(im._previewUrl)imgUrlSet.add(im._previewUrl);}));}
    else{items.forEach(n=>(n._displayImages||[]).forEach(u=>{if(u)imgUrlSet.add(u);}));}
    const urlMap={};
    await Promise.all([...imgUrlSet].map(async u=>{urlMap[u]=await _urlToDataUrl(u);}));
    const _src=u=>urlMap[u]||u;
    const filterSummary=buildFilterSummaryText();
    let bodyHtml='';
    if(activeTab==='logs'){
      for(const t of items){
        const pnl=fmtPnl(t.pnl);const rVal=fmtR(t.r);const tags=[...(t.strategy||[]),...(t.timeframe||[]),...(t.mood||[])];
        const isPinned=t.pinned;const imgs=(t.images||[]).filter(img=>img._previewUrl);
        bodyHtml+=`<div class="pdf-card ${pnl?.pos?'win':pnl?.neg?'loss':''}"><div class="pdf-card-header"><div class="pdf-pair">${esc(t.pair||'—')}<span class="pdf-pos ${t.position==='Short'?'short':'long'}">${t.position||'Long'}</span>${isPinned?'<span class="pdf-pin">📌</span>':''}</div><div class="pdf-meta">${t.date?`<span>📅 ${esc(t.date)}${t.time?` ${esc(t.time)}`:''}</span>`:''}${pnl?`<span class="pdf-pnl ${pnl.pos?'pos':'neg'}">${pnl.str}</span>`:''}${rVal?`<span class="pdf-r ${rVal.pos?'pos':'neg'}">${rVal.str}</span>`:''}${t.confidence?`<span class="pdf-stars">${'★'.repeat(t.confidence)}</span>`:''}</div>${tags.length?`<div class="pdf-tags">${tags.map(tg=>`<span class="pdf-tag">${esc(tg)}</span>`).join('')}</div>`:''}</div>${t.notes&&t.notes.trim()?`<div class="pdf-notes">${esc(t.notes.trim()).replace(/\n/g,'<br>')}</div>`:''}${imgs.length?`<div class="pdf-imgs">${imgs.map(img=>`<img src="${_src(img._previewUrl)}" class="pdf-img" alt="">`).join('')}</div>`:''}</div>`;
      }
    }else{
      for(const n of items){
        const cnImgs=(n._displayImages||[]).filter(u=>!!u);
        bodyHtml+=`<div class="pdf-card"><div class="pdf-card-header"><div class="pdf-pair">${esc(n.title||'Untitled')}${n.color_label?`<span class="pdf-color" style="background:${esc(n.color_label)}"></span>`:''}</div><div class="pdf-meta"><span>📅 ${(n.created_at||'').slice(0,10)}</span></div>${(n.tags||[]).length?`<div class="pdf-tags">${(n.tags||[]).map(t=>`<span class="pdf-tag">${esc(t)}</span>`).join('')}</div>`:''}</div>${n.body?`<div class="pdf-notes">${esc(n.body).replace(/\n/g,'<br>')}</div>`:''}${cnImgs.length?`<div class="pdf-imgs">${cnImgs.map(u=>`<img src="${_src(u)}" class="pdf-img" alt="">`).join('')}</div>`:''}</div>`;
      }
    }
    const filterDiv=filterSummary?`<div class="filter-summary"><strong>Active filters:</strong> ${esc(filterSummary)}</div>`:'';
    page.innerHTML=`<h1>TradingGrove — Notes Export</h1><div class="export-meta">Generated ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} · ${items.length} note${items.length!==1?'s':''} · ${activeTab==='logs'?'Logs Notes':'Custom Notes'}</div>${filterDiv}${bodyHtml}`;
    // Wait for images to settle before enabling download
    const imgs=[...page.querySelectorAll('img')];
    await Promise.all(imgs.map(img=>{
      if(img.complete && img.naturalWidth>0) return Promise.resolve();
      return new Promise(r=>{
        const done=()=>r();
        img.addEventListener('load',done,{once:true});
        img.addEventListener('error',done,{once:true});
        setTimeout(done,4000);
      });
    }));
    document.getElementById('pdfDownloadBtn').disabled=false;
  }catch(e){
    page.innerHTML=`<div class="pdf-prev-empty">Build failed: ${esc(e.message)}</div>`;
  }
}

function pdfPrevOverlayClick(e){if(e.target===document.getElementById('pdfPrevOverlay'))closePdfPreview();}
function closePdfPreview(){
  document.getElementById('pdfPrevOverlay').classList.remove('open');
  document.getElementById('pdfPrevPage').innerHTML='';
}

async function downloadPdfFromPreview(){
  if(typeof html2pdf==='undefined'){showToast('PDF library still loading — try again.','fa-solid fa-triangle-exclamation','r');return;}
  const page=document.getElementById('pdfPrevPage');
  const btn=document.getElementById('pdfDownloadBtn');
  if(!page||!page.innerHTML.trim()||btn.disabled)return;
  const orig=btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML='<i class="fa-solid fa-spinner" style="animation:spin 1s linear infinite"></i> Downloading…';
  try{
    const filename=`tradinggrove-notes-${new Date().toISOString().split('T')[0]}.pdf`;
    // jsPDF.html() with autoPaging:'text' paginates content respecting
    // element boundaries — html2canvas+slice approach was cropping cards.
    const jsPDFCtor=(window.jspdf&&window.jspdf.jsPDF)||(window.jsPDF);
    if(jsPDFCtor){
      const pdf=new jsPDFCtor({unit:'pt',format:'a4',orientation:'portrait',compress:true});
      // A4 in pt: 595.28 × 841.89. Use 24pt margins → 547pt content width.
      // Source page is 794 CSS px wide; scale = contentPt / sourcePx
      const margin=24;
      const pageW=pdf.internal.pageSize.getWidth();
      const contentW=pageW-margin*2;
      const sourcePx=page.scrollWidth||794;
      await new Promise((resolve,reject)=>{
        pdf.html(page,{
          callback:p=>{ try{ p.save(filename); resolve(); }catch(err){reject(err);} },
          margin:[margin,margin,margin,margin],
          autoPaging:'text',
          width:contentW,
          windowWidth:sourcePx,
          html2canvas:{
            scale:contentW/sourcePx,
            useCORS:true,
            allowTaint:true,
            backgroundColor:'#ffffff',
            logging:false
          }
        });
      });
    } else {
      // Fallback path
      await html2pdf().set({
        margin:[10,10,10,10],
        filename,
        image:{type:'jpeg',quality:0.95},
        html2canvas:{scale:2,useCORS:true,allowTaint:true,backgroundColor:'#ffffff',logging:false},
        jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},
        pagebreak:{mode:['css','legacy'],avoid:'.pdf-card'}
      }).from(page).save();
    }
    showToast(`Exported ${_pdfPrevItemCount} note${_pdfPrevItemCount!==1?'s':''} to PDF.`,'fa-solid fa-circle-check','g');
  }catch(e){showToast('Download failed: '+e.message,'fa-solid fa-triangle-exclamation','r');}
  finally{btn.disabled=false;btn.innerHTML=orig;}
}

function printPdfPreview(){
  const page=document.getElementById('pdfPrevPage');
  if(!page||!page.innerHTML.trim())return;
  const w=window.open('','_blank','width=900,height=1000');
  if(!w){showToast('Pop-up blocked.','fa-solid fa-triangle-exclamation','r');return;}
  // Copy the rendered preview into a printable window
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TradingGrove Notes</title><style>
    body{font-family:'Inter',Arial,sans-serif;background:#fff;color:#111;padding:24px;font-size:13px;margin:0}
    *{box-sizing:border-box}
    h1{font-size:22px;font-weight:700;margin:0 0 4px}
    .export-meta{font-size:11px;color:#666;margin:0 0 8px}
    .filter-summary{font-size:11px;color:#444;background:#f5f5f5;border-left:3px solid #19c37d;padding:6px 10px;border-radius:4px;margin:0 0 16px}
    .pdf-card{border:1px solid #e0e0e0;border-radius:10px;padding:14px;margin:0 0 14px;page-break-inside:avoid}
    .pdf-card.win{border-left:4px solid #19c37d}.pdf-card.loss{border-left:4px solid #ff5f6d}
    .pdf-card-header{margin-bottom:10px}
    .pdf-pair{font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
    .pdf-pos{font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px}
    .pdf-pos.long{background:#e6f9f1;color:#19c37d}.pdf-pos.short{background:#fff0f0;color:#ff5f6d}
    .pdf-color{display:inline-block;width:10px;height:10px;border-radius:50%}
    .pdf-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:#555;margin-bottom:6px}
    .pdf-pnl.pos,.pdf-r.pos{color:#19c37d;font-weight:600}.pdf-pnl.neg,.pdf-r.neg{color:#ff5f6d;font-weight:600}
    .pdf-stars{color:#f59e0b;letter-spacing:1px}
    .pdf-tags{display:flex;flex-wrap:wrap;gap:5px}
    .pdf-tag{background:#e8f5ee;color:#19c37d;border:1px solid #b3dfc8;border-radius:20px;padding:1px 8px;font-size:10px}
    .pdf-notes{font-size:13px;line-height:1.7;color:#333;margin-top:10px;white-space:pre-wrap;word-wrap:break-word}
    .pdf-imgs{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    .pdf-img{max-width:100%;max-height:320px;border-radius:6px;border:1px solid #ddd;object-fit:contain}
  </style></head><body>${page.innerHTML}</body></html>`);
  w.document.close();
  w.onload=()=>{w.focus();w.print();};
  setTimeout(()=>{try{w.focus();w.print();}catch(e){}},800);
}
function buildFilterSummaryText(){
  const parts=[];
  if(fState.date.from||fState.date.to)parts.push(`Date: ${fState.date.from||'…'} → ${fState.date.to||'…'}`);
  if(fState.position.length)parts.push(`Position: ${fState.position.join(', ')}`);
  if(fState.pair.length)parts.push(`Pair: ${fState.pair.join(', ')}`);
  if(fState.strategy.length)parts.push(`Strategy: ${fState.strategy.join(', ')}`);
  if(fState.timeframe.length)parts.push(`Timeframe: ${fState.timeframe.join(', ')}`);
  if(fState.mood.length)parts.push(`Mood: ${fState.mood.join(', ')}`);
  if(fState.result.length)parts.push(`Result: ${fState.result.join(', ')}`);
  if(fState.hasImage.length)parts.push(`Images: ${fState.hasImage[0]==='yes'?'Has image':'No image'}`);
  if(fState.confidence>0)parts.push(`Min Confidence: ${'★'.repeat(fState.confidence)}`);
  if(fState.tags.length)parts.push(`Tags: ${fState.tags.join(', ')}`);
  if(fState.pinnedOnly)parts.push('Pinned only');
  if(searchQuery.trim())parts.push(`Search: "${searchQuery}"`);
  return parts.join(' · ');
}

// ─── Export Menu ───────────────────────────────────────────────────────────
function toggleExportMenu(){
  const btn=document.getElementById('btnExportMenu'),dropdown=document.getElementById('exportDropdown');
  const isOpen=dropdown.classList.contains('open');
  if(isOpen){closeExportMenu();}else{
    btn.classList.add('open');dropdown.classList.add('open');
    document.addEventListener('click',closeExportMenuOnClickOutside);
  }
}
function closeExportMenu(){
  const btn=document.getElementById('btnExportMenu'),dropdown=document.getElementById('exportDropdown');
  btn.classList.remove('open');dropdown.classList.remove('open');
  document.removeEventListener('click',closeExportMenuOnClickOutside);
}
function closeExportMenuOnClickOutside(e){
  const menu=document.getElementById('exportDropdown'),btn=document.getElementById('btnExportMenu');
  if(!menu.contains(e.target)&&!btn.contains(e.target)){closeExportMenu();}
}

// ─── Download Images (preview → ZIP) ───────────────────────────────────────
let _imgPrevList=[],_imgPrevTab='logs';

function downloadFilteredImages(){
  const items=activeTab==='logs'?getFilteredLogs():getFilteredCustom();
  const allImages=[];
  if(activeTab==='logs'){
    items.forEach((t,idx)=>{
      const imgs=(t.images||[]).filter(img=>img._previewUrl);
      imgs.forEach((img,imgIdx)=>{
        const pairSafe=(t.pair||'trade').replace(/[\/\\:*?"<>|]/g,'-');
        const date=t.date||'';
        const filename=`logs/${pairSafe}_${date}_${idx+1}_${imgIdx+1}.png`;
        allImages.push({url:img._previewUrl,filename,label:t.pair||'—',sub:date});
      });
    });
  } else {
    items.forEach((n,idx)=>{
      const urls=n._displayImages||[];
      urls.forEach((u,imgIdx)=>{
        if(!u)return;
        const titleSafe=(n.title||'note').replace(/[\/\\:*?"<>|]/g,'-').slice(0,40);
        const date=(n.created_at||'').slice(0,10);
        const filename=`custom/${titleSafe}_${date}_${idx+1}_${imgIdx+1}.png`;
        allImages.push({url:u,filename,label:n.title||'Untitled',sub:date});
      });
    });
  }
  _imgPrevList=allImages;_imgPrevTab=activeTab;
  const overlay=document.getElementById('imgPrevOverlay');
  const wrap=document.getElementById('imgPrevGridWrap');
  document.getElementById('imgPrevCount').textContent=allImages.length+' image'+(allImages.length!==1?'s':'');
  overlay.classList.add('open');
  if(!allImages.length){
    wrap.innerHTML='<div class="img-prev-empty"><i class="fa-solid fa-image"></i><div>No images in current view.<br>Adjust filters or open a different tab.</div></div>';
    document.getElementById('imgZipDownloadBtn').disabled=true;
    return;
  }
  document.getElementById('imgZipDownloadBtn').disabled=false;
  wrap.innerHTML=`<div class="img-prev-grid">${allImages.map(im=>`<div class="img-prev-th"><img src="${im.url}" alt="${esc(im.label)}" loading="lazy" decoding="async"><div class="img-prev-th-meta"><div class="pair">${esc(im.label)}</div>${im.sub?`<div class="date">${esc(im.sub)}</div>`:''}</div></div>`).join('')}</div>`;
}

function imgPrevOverlayClick(e){if(e.target===document.getElementById('imgPrevOverlay'))closeImgPreview();}
function closeImgPreview(){
  document.getElementById('imgPrevOverlay').classList.remove('open');
  document.getElementById('imgPrevGridWrap').innerHTML='';
  _imgPrevList=[];
}

async function downloadZipFromPreview(){
  if(typeof JSZip==='undefined'){showToast('ZIP library loading — try again.','fa-solid fa-triangle-exclamation','r');return;}
  if(!_imgPrevList.length)return;
  const btn=document.getElementById('imgZipDownloadBtn');
  const orig=btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML='<i class="fa-solid fa-spinner" style="animation:spin 1s linear infinite"></i> Creating ZIP…';
  try{
    const zip=new JSZip();
    let successCount=0;
    for(const img of _imgPrevList){
      try{
        const response=await fetch(img.url);
        const blob=await response.blob();
        zip.file(img.filename,blob);
        successCount++;
      }catch(e){console.error('Failed to add '+img.filename,e);}
    }
    if(!successCount){showToast('No images could be packaged.','fa-solid fa-triangle-exclamation','r');return;}
    btn.innerHTML='<i class="fa-solid fa-spinner" style="animation:spin 1s linear infinite"></i> Compressing…';
    const zipBlob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(zipBlob);
    a.download=`tradinggrove-${_imgPrevTab}-images-${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast(`Packaged ${successCount} image${successCount!==1?'s':''} into ZIP.`,'fa-solid fa-circle-check','g');
  }catch(e){showToast('Download failed: '+e.message,'fa-solid fa-triangle-exclamation','r');}
  finally{btn.disabled=false;btn.innerHTML=orig;}
}

// ─── Render ────────────────────────────────────────────────────────────────
function render(){
  if(activeTab==='logs') renderLogsTab();
  else renderCustomTab();
  const total=activeTab==='logs'?allTrades.filter(t=>(t.notes&&t.notes.trim())||(t.images&&t.images.length)).length:customNotes.length;
  document.getElementById('noteCount').textContent=total+' note'+(total!==1?'s':'');
  updateFilterCountBadge();
}

function renderLogsTab(){
  const all=getFilteredLogs();
  const pinned=all.filter(t=>t.pinned);
  const unpinned=all.filter(t=>!t.pinned);
  const pSec=document.getElementById('pinnedLogsSection'),pGrid=document.getElementById('pinnedLogsGrid');
  if(pinned.length){pSec.style.display='';pGrid.innerHTML='';pinned.forEach((t,i)=>{pGrid.appendChild(buildLogCard(t,i,true));});}
  else{pSec.style.display='none';}
  const grid=document.getElementById('logsGrid');
  if(!unpinned.length&&!pinned.length){
    grid.innerHTML=`<div class="empty-state"><div class="ei"><i class="fa-solid fa-note-sticky"></i></div><h3>${allTrades.filter(t=>(t.notes&&t.notes.trim())||(t.images&&t.images.length)).length?'No matches':'No notes yet'}</h3><p>${allTrades.filter(t=>(t.notes&&t.notes.trim())||(t.images&&t.images.length)).length?'Try a different filter.':'Open a trade in Logs, add notes or images, and they\'ll appear here.'}</p></div>`;
    return;
  }
  grid.innerHTML='';unpinned.forEach((t,i)=>{grid.appendChild(buildLogCard(t,i,false));});
}

function renderCustomTab(){
  const all=getFilteredCustom();
  const pinned=all.filter(n=>n.pinned);
  const unpinned=all.filter(n=>!n.pinned);
  const pSec=document.getElementById('pinnedCustomSection'),pGrid=document.getElementById('pinnedCustomGrid');
  if(pinned.length){pSec.style.display='';pGrid.innerHTML='';pinned.forEach((n,i)=>{pGrid.appendChild(buildCustomCard(n,i,true));});}
  else{pSec.style.display='none';}
  const grid=document.getElementById('customGrid');
  if(!unpinned.length&&!pinned.length){
    grid.innerHTML=`<div class="empty-state"><div class="ei"><i class="fa-solid fa-pen-to-square"></i></div><h3>${customNotes.length?'No matches':'No custom notes yet'}</h3><p>${customNotes.length?'Try a different filter.':'Click "+ New Note" to create your first custom note.'}</p></div>`;
    return;
  }
  grid.innerHTML='';unpinned.forEach((n,i)=>{grid.appendChild(buildCustomCard(n,i,false));});
}

function buildLogCard(t,i,isPinned){
  const el=document.createElement('div');el.className='nc'+(isPinned?' pinned':'');el.style.animationDelay=(i*0.03)+'s';
  const imgs=t.images||[],firstImg=imgs.find(img=>img._previewUrl);
  const pnl=fmtPnl(t.pnl),rVal=fmtR(t.r);
  const tags=[...(t.strategy||[]),...(t.timeframe||[])].slice(0,3);
  const isLong=t.position!=='Short';
  el.innerHTML=`
    ${firstImg?`<img class="nc-img" src="${firstImg._previewUrl}" alt="${esc(t.pair)}" loading="lazy" decoding="async">${imgs.length>1?`<div class="nc-img-count"><i class="fa-solid fa-images" style="font-size:9px"></i>${imgs.length}</div>`:''}`:`<div class="nc-no-img"><i class="fa-solid fa-note-sticky"></i></div>`}
    <div class="nc-body" onclick="openModal('${t.id}')">
      <div class="nc-pair">${esc(t.pair||'—')}${t.position?`<span class="nc-pos ${isLong?'long':'short'}">${t.position}</span>`:''}</div>
      ${t.date?`<div class="nc-date"><i class="fa-solid fa-calendar" style="font-size:9px"></i>${esc(t.date)}</div>`:''}
      ${pnl?`<div class="nc-pnl ${pnl.pos?'pos':pnl.neg?'neg':''}">${pnl.str}</div>`:''}
      ${rVal?`<div class="nc-r ${rVal.pos?'pos':rVal.neg?'neg':''}">${rVal.str}</div>`:''}
      ${t.confidence?`<div class="nc-stars">${'★'.repeat(t.confidence)}</div>`:''}
      ${t.notes&&t.notes.trim()?`<div class="nc-preview">${esc(t.notes.trim())}</div>`:''}
      ${tags.length?`<div class="nc-tags">${tags.map(tg=>`<span class="nc-tag">${esc(tg)}</span>`).join('')}</div>`:''}
    </div>
    <div class="nc-footer">
      <span style="font-size:11px;color:var(--muted)">${imgs.length?`<i class="fa-solid fa-image" style="font-size:10px;margin-right:3px"></i>${imgs.length}`:''}</span>
      <button class="pin-btn${isPinned?' pinned':''}" onclick="event.stopPropagation();toggleLogPin('${t.id}')" title="${isPinned?'Unpin':'Pin'}"><i class="fa-solid fa-thumbtack"></i></button>
    </div>`;
  return el;
}

function buildCustomCard(n,i,isPinned){
  const el=document.createElement('div');el.className='nc'+(isPinned?' pinned':'');el.style.animationDelay=(i*0.03)+'s';
  const color=n.color_label||'';
  const imgUrls=(n._displayImages||[]).filter(Boolean);
  const firstImg=imgUrls[0];
  const imgCount=imgUrls.length;
  el.innerHTML=`
    ${color?`<div class="color-bar" style="background:${color}"></div>`:''}
    ${firstImg?`<img class="nc-img" src="${firstImg}" alt="${esc(n.title||'')}" loading="lazy" decoding="async">${imgCount>1?`<div class="nc-img-count"><i class="fa-solid fa-images" style="font-size:9px"></i>${imgCount}</div>`:''}`:''}
    <div class="nc-body" onclick="openCNModal('${n.id}')">
      <div class="custom-card-title">${esc(n.title||'Untitled')}</div>
      ${n.body?`<div class="custom-card-body">${esc(n.body)}</div>`:''}
      ${(n.tags||[]).length?`<div class="nc-tags">${(n.tags||[]).map(t=>`<span class="nc-tag">${esc(t)}</span>`).join('')}</div>`:''}
      <div style="font-size:10px;color:var(--muted);margin-top:4px">${(n.created_at||'').slice(0,10)}</div>
    </div>
    <div class="nc-footer">
      <div style="display:flex;gap:5px;align-items:center" id="del-area-${n.id}">
        ${imgCount?`<span style="font-size:11px;color:var(--muted)"><i class="fa-solid fa-image" style="font-size:10px;margin-right:3px"></i>${imgCount}</span>`:''}
        <button class="nc-del-btn" onclick="event.stopPropagation();askDeleteCN('${n.id}')" title="Delete"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <button class="pin-btn${isPinned?' pinned':''}" onclick="event.stopPropagation();toggleCustomPin('${n.id}',${isPinned})" title="${isPinned?'Unpin':'Pin'}"><i class="fa-solid fa-thumbtack"></i></button>
    </div>`;
  return el;
}

// ─── Pin: Logs ─────────────────────────────────────────────────────────────
async function toggleLogPin(tradeId){
  const id=tradeId||currentTradeId;
  if(!id){console.warn('[pin] No trade ID');return;}
  const trade=allTrades.find(t=>t.id===id);
  if(!trade){console.warn('[pin] Trade not found:',id);return;}

  const newState=!trade.pinned;
  trade.pinned=newState;

  // Update UI optimistically
  const btn=document.getElementById('modalPinBtn');
  if(btn)btn.classList.toggle('pinned',newState);
  render();

  // Save to database
  try{
    const{data,error}=await db.from('trades').update({pinned:newState}).eq('id',id).select('id,pinned');
    if(error){
      console.error('[pin] Update failed:',error);
      // Revert on failure
      trade.pinned=!newState;
      if(btn)btn.classList.toggle('pinned',!newState);
      render();
      showToast(`Failed to ${newState?'pin':'unpin'} note: ${error.message||'Unknown error'}`, 'fa-solid fa-triangle-exclamation', 'r');
      return;
    }
    // Verify the update was applied
    if(data&&data[0]&&data[0].pinned===newState){
      console.log('[pin] Verified in DB:',id,'pinned=',newState);
      showToast(newState?'Note pinned ✓':'Note unpinned ✓','fa-solid fa-thumbtack','g');
    }else{
      console.warn('[pin] Update succeeded but verification failed',{expected:newState,got:data?.[0]?.pinned});
      showToast('Pin updated (but verification failed)','fa-solid fa-info','y');
    }
  }catch(e){
    console.error('[pin] Error:',e);
    // Revert on exception
    trade.pinned=!newState;
    if(btn)btn.classList.toggle('pinned',!newState);
    render();
    showToast(`Error: ${e.message||'Pin failed'}`, 'fa-solid fa-triangle-exclamation', 'r');
  }
}

// ─── Pin: Custom ───────────────────────────────────────────────────────────
async function toggleCustomPin(id,wasPinned){
  const note=customNotes.find(n=>n.id===id);if(!note)return;
  note.pinned=!wasPinned;
  render();
  try{await updateCustomNoteFn(id,{pinned:note.pinned});}
  catch(e){showToast('Pin save failed.','fa-solid fa-triangle-exclamation','r');}
}

// ─── Delete: Custom ────────────────────────────────────────────────────────
function askDeleteCN(id){
  const area=document.getElementById('del-area-'+id);if(!area)return;
  area.innerHTML=`<div class="del-confirm"><span style="font-size:11px;color:var(--muted)">Delete?</span><button class="del-confirm-yes" onclick="event.stopPropagation();confirmDeleteCN('${id}')">Yes</button><button class="del-confirm-no" onclick="event.stopPropagation();render()">No</button></div>`;
  setTimeout(()=>{const a=document.getElementById('del-area-'+id);if(a&&a.querySelector('.del-confirm'))render();},3500);
}
async function confirmDeleteCN(id){
  customNotes=customNotes.filter(n=>n.id!==id);render();
  try{await deleteCustomNoteFn(id);showToast('Note deleted.','fa-solid fa-circle-check','g');}
  catch(e){showToast('Delete failed.','fa-solid fa-triangle-exclamation','r');}
}

// ─── Custom Note Modal ─────────────────────────────────────────────────────
function openCNModal(editId){
  cnEditId=editId||null;cnTags=[];cnColor='';cnImgBuffer=[];
  document.getElementById('cnTitle').value='';
  document.getElementById('cnBody').value='';
  document.getElementById('cnModalTitle').textContent=editId?'Edit Custom Note':'New Custom Note';
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('sel'));
  renderTagPills();
  if(editId){
    const n=customNotes.find(x=>x.id===editId);if(!n)return;
    document.getElementById('cnTitle').value=n.title||'';
    document.getElementById('cnBody').value=n.body||'';
    cnTags=[...(n.tags||[])];cnColor=n.color_label||'';
    // Existing images: keep storage row + cached display URL
    const stored=Array.isArray(n.images)?n.images:[];
    const display=n._displayImages||[];
    cnImgBuffer=stored.map((img,i)=>({
      ...(typeof img==='string'?{storage_url:img}:img),
      _previewUrl:display[i]||(typeof img==='string'?img:(img.url||img.storage_url||''))
    }));
    renderTagPills();
    if(cnColor){const sw=document.querySelector(`.color-swatch[data-color="${cnColor}"]`);if(sw)sw.classList.add('sel');}
  }
  renderCNImgGallery();
  document.getElementById('cnOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('cnTitle').focus(),60);
}
function closeCNModal(){document.getElementById('cnOverlay').classList.remove('open');cnEditId=null;cnTags=[];cnColor='';cnImgBuffer=[];}
function cnOverlayClick(e){if(e.target===document.getElementById('cnOverlay'))closeCNModal();}
async function saveCNModal(){
  const title=document.getElementById('cnTitle').value.trim();
  const body=document.getElementById('cnBody').value.trim();
  if(!title&&!body&&!cnImgBuffer.length){showToast('Add a title, body, or image.','fa-solid fa-triangle-exclamation','r');return;}
  // Save core fields first so we have a row id to scope uploads against
  let noteId=cnEditId,baseRow=null;
  try{
    const corePayload={title,body,tags:cnTags,color_label:cnColor};
    if(cnEditId){
      await updateCustomNoteFn(cnEditId,corePayload);
      const idx=customNotes.findIndex(n=>n.id===cnEditId);
      if(idx>-1){baseRow=customNotes[idx]={...customNotes[idx],...corePayload};}
    }else{
      const saved=await insertCustomNoteFn({...corePayload,images:[]});
      noteId=saved.id;baseRow=saved;customNotes.unshift({...saved,_displayImages:[]});
    }
    // Upload any new images (entries without a stored path)
    const finalImages=[];const displayUrls=[];
    for(const img of cnImgBuffer){
      if(img.storage_url||img.path){
        finalImages.push({storage_url:img.storage_url||img.path});
        displayUrls.push(img._previewUrl||'');
      } else if(img._previewUrl){
        try{
          const stored=await uploadCustomNoteImage(currentUser.id,noteId,img._previewUrl);
          finalImages.push(stored);
          displayUrls.push(await getCustomNoteImageUrl(stored));
        }catch(e){console.error('CN image upload failed',e);}
      }
    }
    // Delete old images that were removed in this edit
    if(cnEditId){
      const orig=Array.isArray(baseRow?.images)?baseRow.images:[];
      const keep=new Set(finalImages.map(i=>i.storage_url));
      for(const o of orig){
        const key=typeof o==='string'?o:(o?.storage_url||o?.path);
        if(key && !keep.has(key)) await deleteCustomNoteImageFile(key);
      }
    }
    await updateCustomNoteFn(noteId,{images:finalImages});
    const idx=customNotes.findIndex(n=>n.id===noteId);
    if(idx>-1)customNotes[idx]={...customNotes[idx],images:finalImages,_displayImages:displayUrls};
    showToast(cnEditId?'Note updated.':'Note saved.','fa-solid fa-circle-check','g');
    closeCNModal();render();
  }catch(e){showToast('Save failed: '+e.message,'fa-solid fa-triangle-exclamation','r');}
}

// ─── Custom Note image handlers ────────────────────────────────────────────
function cnTriggerImgUpload(){document.getElementById('cnFileInp').click();}
function cnHandleImgUpload(e){
  [...e.target.files].forEach(f=>{
    if(!validateImg(f))return;
    if(!userIsPro&&cnImgBuffer.length>=1){showToast('Free plan: 1 image per note.','fa-solid fa-lock','r');return;}
    const r=new FileReader();
    r.onload=ev=>{cnImgBuffer.push({_previewUrl:ev.target.result});renderCNImgGallery();};
    r.readAsDataURL(f);
  });
  e.target.value='';
}
function cnRemoveImg(i){
  cnImgBuffer.splice(i,1);renderCNImgGallery();
}
function renderCNImgGallery(){
  const wrap=document.getElementById('cnImgGallery');
  const cnt=document.getElementById('cnImgCount');
  if(!wrap)return;
  cnt.textContent=cnImgBuffer.length?`(${cnImgBuffer.length})`:'';
  if(!cnImgBuffer.length){wrap.innerHTML='<div class="img-empty"><i class="fa-solid fa-image"></i><span>No images yet — click Add Image or paste from clipboard</span></div>';return;}
  const count=cnImgBuffer.length;let galCls='g-1';
  if(count===2)galCls='g-2';else if(count===3)galCls='g-3';else if(count===4)galCls='g-4';else if(count>4)galCls='g-many';
  wrap.innerHTML=`<div class="img-gallery-grid ${galCls}">${cnImgBuffer.map((img,i)=>`<div class="img-th"><img src="${img._previewUrl||''}" alt="" loading="lazy" decoding="async"><div class="img-th-overlay"><button class="img-th-btn img-th-view" onclick="event.stopPropagation();cnOpenLb(${i})"><i class="fa-solid fa-expand" style="font-size:10px"></i></button><button class="img-th-btn img-th-del" onclick="event.stopPropagation();cnRemoveImg(${i})"><i class="fa-solid fa-trash" style="font-size:10px"></i></button></div></div>`).join('')}</div>`;
}
function cnOpenLb(i){
  lbImages=cnImgBuffer.filter(img=>img._previewUrl).map(img=>({_previewUrl:img._previewUrl}));
  lbIndex=Math.min(i,lbImages.length-1);lbScale=1;lbPanX=0;lbPanY=0;_lbRender();
  document.getElementById('lb').classList.add('open');
}
// Tag input
function tagKeydown(e){
  if(e.key==='Enter'||e.key===','){e.preventDefault();const val=e.target.value.trim().replace(/,$/,'');if(val&&!cnTags.includes(val)){cnTags.push(val);renderTagPills();}e.target.value='';}
  if(e.key==='Backspace'&&!e.target.value&&cnTags.length){cnTags.pop();renderTagPills();}
}
function renderTagPills(){
  const wrap=document.getElementById('tagInpWrap'),inp=document.getElementById('tagBareInp');
  [...wrap.querySelectorAll('.tag-pill-rm')].forEach(p=>p.remove());
  cnTags.forEach((tag,i)=>{const span=document.createElement('span');span.className='tag-pill-rm';span.innerHTML=`${esc(tag)}<button onclick="removeTag(${i})" tabindex="-1"><i class="fa-solid fa-xmark"></i></button>`;wrap.insertBefore(span,inp);});
}
function removeTag(i){cnTags.splice(i,1);renderTagPills();}
function selectColor(el){
  const color=el.dataset.color;
  if(cnColor===color){cnColor='';document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('sel'));}
  else{cnColor=color;document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('sel'));el.classList.add('sel');}
}

// ─── Log Note Detail Modal ─────────────────────────────────────────────────
async function openModal(id){
  const t=allTrades.find(x=>x.id===id);if(!t)return;
  currentTradeId=id;
  const rawImgs=await getTradeImages(id);
  modalImgBuffer=await Promise.all(rawImgs.map(async img=>{const url=img._previewUrl||await getImageUrl(img);return{...img,_previewUrl:url};}));
  _refreshModalMeta(t);
  renderImgGallery();
  document.getElementById('modalNote').value=t.notes||'';
  document.getElementById('saveStatus').textContent='';
  document.getElementById('saveStatus').className='autosave-status';
  // Pin button state
  const pinBtn=document.getElementById('modalPinBtn');
  if(pinBtn)pinBtn.classList.toggle('pinned',t.pinned);
  document.getElementById('overlay').classList.add('open');
}
function _refreshModalMeta(t){
  const pnl=fmtPnl(t.pnl),rVal=fmtR(t.r),isLong=t.position!=='Short';
  document.getElementById('modalPair').innerHTML=esc(t.pair||'Untitled Trade')+(t.position?` <span class="modal-pos-badge ${isLong?'long':'short'}">${t.position}</span>`:'');
  const meta=[];
  if(t.date)meta.push(`<div class="meta-chip"><i class="fa-solid fa-calendar fa-xs"></i>${esc(t.date)}${t.time?` ${esc(t.time)}`:''}</div>`);
  if(pnl)meta.push(`<div class="meta-chip ${pnl.pos?'pnl-pos':pnl.neg?'pnl-neg':''}">${pnl.str}</div>`);
  if(rVal)meta.push(`<div class="meta-chip ${rVal.pos?'r-pos':rVal.neg?'r-neg':''}" style="font-family:var(--font-mono,'Space Grotesk',sans-serif)">${rVal.str}</div>`);
  if(t.confidence)meta.push(`<div class="meta-chip stars-chip">${'★'.repeat(t.confidence)}</div>`);
  document.getElementById('modalMeta').innerHTML=meta.join('');
  const tags=[...(t.strategy||[]),...(t.timeframe||[]),...(t.mood||[])];
  document.getElementById('modalTags').innerHTML=tags.map(tg=>`<span class="mtag">${esc(tg)}</span>`).join('');
}
function closeModal(){if(saveTimer){clearTimeout(saveTimer);_doSave();}document.getElementById('overlay').classList.remove('open');currentTradeId=null;modalImgBuffer=[];}
function overlayClick(e){if(e.target===document.getElementById('overlay'))closeModal();}
function onNoteInput(){setSaveStatus('saving','Saving…');triggerAutoSave();}
function triggerAutoSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>_doSave(),900);}
async function _doSave(){
  if(!currentTradeId)return;const t=allTrades.find(x=>x.id===currentTradeId);if(!t)return;
  t.notes=document.getElementById('modalNote').value;
  try{
    const keepIds=new Set(modalImgBuffer.filter(i=>i.id).map(i=>i.id));
    for(const img of(t.images||[])){if(img.id&&!keepIds.has(img.id)){try{await deleteTradeImage(img.id);}catch(e){}}}
    const final=[];
    for(const img of modalImgBuffer){if(img.id){final.push(img);}else if(img._previewUrl){try{const{data:{user}}=await db.auth.getUser();const saved=await addTradeImage(user.id,currentTradeId,img._previewUrl);final.push({...img,id:saved.id,data:saved.data||img._previewUrl});}catch(e){final.push(img);}}}
    t.images=final;modalImgBuffer=[...final.map(img=>({...img,_previewUrl:img._previewUrl||img.data}))];
    await updateTrade(currentTradeId,t);setSaveStatus('saved','Saved');showSaveIndicator();
  }catch(e){setSaveStatus('err','Save failed');showToast('Auto-save failed: '+e.message,'fa-solid fa-triangle-exclamation','r');}
}
function setSaveStatus(cls,msg){const el=document.getElementById('saveStatus');el.className='autosave-status'+(cls?' '+cls:'');el.innerHTML=cls==='saving'?`<i class="fa-solid fa-circle-notch fa-spin" style="font-size:10px"></i> ${msg}`:cls==='saved'?`<i class="fa-solid fa-check" style="font-size:10px"></i> ${msg}`:cls==='err'?`<i class="fa-solid fa-triangle-exclamation" style="font-size:10px"></i> ${msg}`:msg;}
function showSaveIndicator(){const el=document.getElementById('saveIndicator');el.classList.add('show');clearTimeout(_saveIndicatorTimer);_saveIndicatorTimer=setTimeout(()=>el.classList.remove('show'),2000);}
function triggerImgUpload(){document.getElementById('modalFileInp').click();}
function handleModalUpload(e){[...e.target.files].forEach(f=>{if(!validateImg(f))return;if(!userIsPro&&modalImgBuffer.length>=1){showToast('Free plan: 1 image per trade.','fa-solid fa-lock','r');return;}const r=new FileReader();r.onload=ev=>{modalImgBuffer.push({_previewUrl:ev.target.result});renderImgGallery();triggerAutoSave();};r.readAsDataURL(f);});e.target.value='';}
document.addEventListener('paste',e=>{
  const overlayOpen=document.getElementById('overlay').classList.contains('open');
  const cnOpen=document.getElementById('cnOverlay').classList.contains('open');
  if(!overlayOpen&&!cnOpen)return;
  // Skip if user is typing in a textarea/input
  const ae=document.activeElement;
  const taActive=ae&&(ae.tagName==='TEXTAREA'||(ae.tagName==='INPUT'&&ae.type==='text'));
  if(taActive)return;
  [...e.clipboardData.items].forEach(item=>{
    if(!item.type.startsWith('image/'))return;
    const file=item.getAsFile();if(!file||!validateImg(file))return;
    if(overlayOpen){
      if(!userIsPro&&modalImgBuffer.length>=1){showToast('Free plan: 1 image per trade.','fa-solid fa-lock','r');return;}
      const r=new FileReader();r.onload=ev=>{modalImgBuffer.push({_previewUrl:ev.target.result});renderImgGallery();triggerAutoSave();};r.readAsDataURL(file);
    } else if(cnOpen){
      if(!userIsPro&&cnImgBuffer.length>=1){showToast('Free plan: 1 image per note.','fa-solid fa-lock','r');return;}
      const r=new FileReader();r.onload=ev=>{cnImgBuffer.push({_previewUrl:ev.target.result});renderCNImgGallery();};r.readAsDataURL(file);
    }
  });
});

function renderImgGallery(){
  const container=document.getElementById('imgGallery');
  const imgs=modalImgBuffer.filter(img=>img._previewUrl);
  const cnt=document.getElementById('imgMgrCount');cnt.textContent=imgs.length?`(${imgs.length})`:'';
  if(!imgs.length){container.innerHTML='<div class="img-empty"><i class="fa-solid fa-image"></i><span>No images yet — click Add Image or paste from clipboard</span></div>';return;}
  const count=imgs.length;let galCls='g-1';if(count===2)galCls='g-2';else if(count===3)galCls='g-3';else if(count===4)galCls='g-4';else if(count>4)galCls='g-many';
  container.innerHTML=`<div class="img-gallery-grid ${galCls}">${imgs.map((img,i)=>`<div class="img-th"><img src="${img._previewUrl}" alt="" loading="lazy" decoding="async"><div class="img-th-overlay"><button class="img-th-btn img-th-view" onclick="event.stopPropagation();openLb(${i})"><i class="fa-solid fa-expand" style="font-size:10px"></i></button><button class="img-th-btn img-th-del" onclick="event.stopPropagation();removeModalImg(${i})"><i class="fa-solid fa-trash" style="font-size:10px"></i></button></div></div>`).join('')}</div>`;
}
function removeModalImg(i){modalImgBuffer.splice(i,1);renderImgGallery();triggerAutoSave();}

// ─── Lightbox ──────────────────────────────────────────────────────────────
function openLb(i){lbImages=[...modalImgBuffer.filter(img=>img._previewUrl)];lbIndex=Math.min(i,lbImages.length-1);lbScale=1;lbPanX=0;lbPanY=0;_lbRender();document.getElementById('lb').classList.add('open');}
function _lbRender(){const img=document.getElementById('lbImg'),cur=lbImages[lbIndex];if(!cur)return;img.src=cur._previewUrl||'';img.style.transform=`translate(${lbPanX}px,${lbPanY}px) scale(${lbScale})`;document.getElementById('lbPrev').style.display=lbIndex>0?'flex':'none';document.getElementById('lbNext').style.display=lbIndex<lbImages.length-1?'flex':'none';const dots=document.getElementById('lbDots');dots.innerHTML=lbImages.length>1?lbImages.map((_,i)=>`<div class="lb-dot${i===lbIndex?' active':''}"></div>`).join(''):'';}
function lbNav(dir){lbIndex=Math.max(0,Math.min(lbImages.length-1,lbIndex+dir));lbScale=1;lbPanX=0;lbPanY=0;_lbRender();}
function lbZoom(delta){lbScale=Math.max(0.5,Math.min(5,lbScale+delta));document.getElementById('lbImg').style.transform=`translate(${lbPanX}px,${lbPanY}px) scale(${lbScale})`;}
function lbResetZoom(){lbScale=1;lbPanX=0;lbPanY=0;document.getElementById('lbImg').style.transform='';}
function lbDeleteCurrent(){const src=lbImages[lbIndex];const bufIdx=modalImgBuffer.findIndex(img=>(img._previewUrl||img.data)===(src._previewUrl||src.data));if(bufIdx>-1)modalImgBuffer.splice(bufIdx,1);lbImages=modalImgBuffer.filter(img=>img._previewUrl);if(!lbImages.length){closeLb();renderImgGallery();triggerAutoSave();return;}if(lbIndex>=lbImages.length)lbIndex=lbImages.length-1;lbScale=1;lbPanX=0;lbPanY=0;_lbRender();renderImgGallery();triggerAutoSave();}
function closeLb(){document.getElementById('lb').classList.remove('open');lbScale=1;lbPanX=0;lbPanY=0;}
const lbWrap=document.getElementById('lbImgWrap');
lbWrap.addEventListener('mousedown',e=>{if(e.button!==0)return;lbDragging=true;lbLastX=e.clientX;lbLastY=e.clientY;lbWrap.classList.add('grabbing');});
document.addEventListener('mousemove',e=>{if(!lbDragging)return;lbPanX+=e.clientX-lbLastX;lbPanY+=e.clientY-lbLastY;lbLastX=e.clientX;lbLastY=e.clientY;document.getElementById('lbImg').style.transform=`translate(${lbPanX}px,${lbPanY}px) scale(${lbScale})`;});
document.addEventListener('mouseup',()=>{lbDragging=false;lbWrap.classList.remove('grabbing');});
lbWrap.addEventListener('wheel',e=>{e.preventDefault();lbZoom(e.deltaY>0?-0.15:0.15);},{passive:false});
document.getElementById('lb').addEventListener('click',e=>{if(e.target===document.getElementById('lb'))closeLb();});
document.addEventListener('keydown',e=>{
  if(document.getElementById('lb').classList.contains('open')){if(e.key==='Escape')closeLb();if(e.key==='ArrowLeft')lbNav(-1);if(e.key==='ArrowRight')lbNav(1);}
  else if(document.getElementById('pdfPrevOverlay').classList.contains('open')){if(e.key==='Escape')closePdfPreview();}
  else if(document.getElementById('imgPrevOverlay').classList.contains('open')){if(e.key==='Escape')closeImgPreview();}
  else if(document.getElementById('overlay').classList.contains('open')){if(e.key==='Escape')closeModal();}
  else if(document.getElementById('cnOverlay').classList.contains('open')){if(e.key==='Escape')closeCNModal();}
});
window.addEventListener('resize',()=>{if(window.innerWidth<=520&&_fmOpen){const modal=document.getElementById('filterModal');modal.style.left='';modal.style.top='';_fmPosX=null;_fmPosY=null;}});

// ─── Toast ─────────────────────────────────────────────────────────────────
let _tt;
function showToast(msg,icon='fa-solid fa-circle-check',cls=''){const t=document.getElementById('toast');document.getElementById('toastIcon').className=icon;document.getElementById('toastMsg').textContent=msg;t.className='show'+(cls?' '+cls:'');clearTimeout(_tt);_tt=setTimeout(()=>{t.className='';},3200);}

// Inline onclick/oninput/onchange/onkeydown handlers in notes.html (and
// dynamically-rendered cards) call these by global name.
Object.assign(window, {
  closeFilterModal, fmSetSort, fmToggleChip, fmStarClick, fmTogglePinnedOnly,
  fmCalNav, resetAllFilters, switchTab, onSearchInput, toggleFilterModal,
  clearAllFilters, openCNModal, toggleExportMenu, exportFilteredToPdf,
  closeExportMenu, downloadFilteredImages, overlayClick, toggleLogPin,
  closeModal, onNoteInput, triggerImgUpload, handleModalUpload,
  cnOverlayClick, closeCNModal, selectColor, cnTriggerImgUpload,
  cnHandleImgUpload, saveCNModal, imgPrevOverlayClick, closeImgPreview,
  downloadZipFromPreview, pdfPrevOverlayClick, closePdfPreview,
  printPdfPreview, downloadPdfFromPreview, lbZoom, lbResetZoom,
  lbDeleteCurrent, closeLb, lbNav, openModal, removeTag, tagKeydown,
  askDeleteCN, confirmDeleteCN, render, toggleCustomPin, cnOpenLb,
  cnRemoveImg, openLb, removeModalImg
});