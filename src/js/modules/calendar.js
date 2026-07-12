// calendar.js - calendar page
// Loaded by /src/pages/calendar.html. Depends on globals from supabase-client.js.
window.addEventListener('message', e => {
  if (e.data?.type === 'tz_plan' && typeof e.data.isPro !== 'undefined') {
    userIsPro = e.data.isPro;
    document.getElementById('freeBanner').style.display = userIsPro ? 'none' : 'flex';
    updateNavButtons();
  }
  // Logs broadcasts this every time a trade is saved; reload trades and redraw
  // so the calendar always shows the latest PNL totals without manual refresh.
  if (e.data?.type === 'tz_trades_changed') {
    refreshCalendarTrades();
  }
});

let _calRefreshing = false;
async function refreshCalendarTrades(){
  if(_calRefreshing||!jid)return;
  _calRefreshing=true;
  try{
    const raw=await getTrades(jid);
    allTrades=raw.map(dbToTrade);
    renderMonth();
  }catch(err){console.warn('[calendar] refresh failed:',err);}
  finally{_calRefreshing=false;}
}

// Apply a single realtime payload in place — no Supabase round-trip.
function applyCalendarDelta(payload){
  if(!payload||!payload.eventType){refreshCalendarTrades();return;}
  allTrades=applyTradeDelta(allTrades,payload);
  renderMonth();
}

const jid = sessionStorage.getItem('tz_current_journal')||localStorage.getItem('tz_current_journal')||(()=>{try{return parent?.sessionStorage?.getItem('tz_current_journal')||parent?.localStorage?.getItem('tz_current_journal');}catch(e){return null;}})();
let allTrades=[], curYear=new Date().getFullYear(), curMonth=new Date().getMonth(), userIsPro=false;
let _prevOpen=true;
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
let _proLocked=false;

// Hardcoded PNL colors — independent of theme
const G='#19c37d', R='#ff5f6d';

function buildDowHeader(id){
  const el=document.getElementById(id);if(!el)return;el.innerHTML='';
  DOW.forEach(label=>{const cell=document.createElement('div');cell.className='dow-cell';cell.textContent=label;el.appendChild(cell);});
}
function buildSkelGrid(){
  const el=document.getElementById('skelGrid');if(!el)return;
  for(let i=0;i<35;i++){const c=document.createElement('div');c.className='cell-skel';el.appendChild(c);}
}

function fP(v){const n=parseFloat(v);if(isNaN(n))return'';return(n>=0?'+':'-')+'$'+Math.abs(n).toFixed(2);}
function isLocked(dateStr){if(userIsPro)return false;const d=new Date(dateStr+'T12:00:00'),cut=new Date();cut.setDate(cut.getDate()-90);return d<cut;}
function isMonthLocked(y,m){if(userIsPro)return false;const lastDay=new Date(y,m+1,0);const cut=new Date();cut.setDate(cut.getDate()-90);return lastDay<cut;}

(async()=>{
  try{
    buildDowHeader('skelDow');buildDowHeader('calDow');buildSkelGrid();
    if(!jid){_calHideLoading();return;}
    try{userIsPro=parent&&parent._userIsPro||false;}catch(e){}
    try{
      if(!userIsPro){const res=await db.auth.getUser();if(res.data&&res.data.user){const p=await getProfile(res.data.user.id);userIsPro=getSubscriptionStatus(p).isPro;}}
    }catch(e){
      console.warn('[calendar] Failed to fetch subscription status:',e);
    }
    if(!userIsPro)document.getElementById('freeBanner').style.display='flex';
    try{
      const raw=await getTrades(jid);
      allTrades=raw.map(dbToTrade);
    }catch(e){
      console.error('[calendar] Failed to fetch trades:',e);
      document.getElementById('skelWrap').style.display='none';
      document.body.style.visibility='visible';
      _calHideLoading();
      alert('Failed to load calendar data. Please refresh the page.');
      return;
    }
    document.getElementById('skelWrap').style.display='none';
    document.getElementById('calWrap').style.display='block';
    renderMonth();updateNavButtons();
    // Backup live-sync path — covers cross-tab / cross-window scenarios where
    // the postMessage from logs can't reach this frame. Apply inline deltas
    // instead of re-fetching the whole trade list on every event.
    try{
      subscribeTrades(jid,(payload)=>applyCalendarDelta(payload));
    }catch(e){console.warn('[calendar] subscribeTrades failed:',e);}
    if(!userIsPro){
      document.getElementById('calAdSlot').style.display='block';
      document.getElementById('calUpgradeNudge').style.display='flex';
      // TODO: replace ca-pub-XXXXXXXXXXXXXXXX with real AdSense publisher ID to enable ads
      // try{(adsbygoogle=window.adsbygoogle||[]).push({});}catch(e){}
    }
    document.body.style.visibility='visible';
    _calHideLoading();
  }catch(e){
    console.error('[calendar] Initialization failed:',e);
    document.getElementById('skelWrap').style.display='none';
    document.body.style.visibility='visible';
    _calHideLoading();
    alert('Failed to load calendar. Please refresh the page.');
  }
})();

function _calHideLoading(){
  const overlay=document.getElementById('calLoadingOverlay');
  if(overlay){overlay.classList.add('hidden');setTimeout(()=>{overlay.style.display='none';},300);}
}

function renderMonth(){
  document.getElementById('monthLbl').textContent=MONTHS[curMonth]+' '+curYear;
  document.getElementById('proLockMsg').classList.remove('show');

  if(isMonthLocked(curYear,curMonth)){
    _proLocked=true;
    document.getElementById('calGrid').innerHTML='';
    document.getElementById('sumBar').style.display='none';
    document.getElementById('proLockMsg').classList.add('show');
    return;
  }
  _proLocked=false;

  const firstDay=new Date(curYear,curMonth,1);
  const lastDay=new Date(curYear,curMonth+1,0);
  let startDow=firstDay.getDay()-1;if(startDow<0)startDow=6;
  const dayMap={};
  allTrades.forEach(t=>{
    if(!t.date)return;
    const parts=t.date.split('-').map(Number);
    if(parts[0]===curYear&&parts[1]-1===curMonth){
      if(!dayMap[parts[2]])dayMap[parts[2]]=[];
      dayMap[parts[2]].push(t);
    }
  });
  const today=new Date();
  const calGrid=document.getElementById('calGrid');calGrid.innerHTML='';
  let monthPnl=0,tradeCnt=0,winDays=0,lossDays=0,bestDay=null,worstDay=null;
  const dayPnls={};
  Object.keys(dayMap).forEach(day=>{
    const dayTrades=dayMap[day];
    const dt=dayTrades.filter(t=>t.pnl!==''&&!isNaN(parseFloat(t.pnl))).reduce((s,t)=>s+parseFloat(t.pnl),0);
    dayPnls[day]=dt;monthPnl+=dt;tradeCnt+=dayTrades.length;
    if(dt>0)winDays++;else if(dt<0)lossDays++;
    if(bestDay===null||dt>bestDay)bestDay=dt;
    if(worstDay===null||dt<worstDay)worstDay=dt;
  });
  const totalCells=Math.ceil((startDow+lastDay.getDate())/7)*7;
  for(let i=0;i<totalCells;i++){
    const dayNum=i-startDow+1;
    const inMonth=dayNum>=1&&dayNum<=lastDay.getDate();
    const padM=String(curMonth+1).padStart(2,'0'),padD=String(dayNum).padStart(2,'0');
    const dateStr=curYear+'-'+padM+'-'+padD;
    const isToday=inMonth&&dayNum===today.getDate()&&curMonth===today.getMonth()&&curYear===today.getFullYear();
    const hasTrades=inMonth&&dayMap[dayNum]&&dayMap[dayNum].length>0;
    const dayPnl=hasTrades?dayPnls[dayNum]:null;
    const cell=document.createElement('div');
    let cls='cal-day';
    if(!inMonth)cls+=' other-month';
    if(isToday)cls+=' today';
    cell.className=cls;
    if(inMonth){
      const dn=document.createElement('span');dn.className='dn';dn.textContent=String(dayNum);cell.appendChild(dn);
      if(hasTrades){
        const dd=document.createElement('div');dd.className='day-data';
        const ce=document.createElement('span');ce.className='day-cnt';
        ce.textContent=dayMap[dayNum].length+(dayMap[dayNum].length===1?' trade':' trades');
        dd.appendChild(ce);
        const pe=document.createElement('span');
        pe.className='day-pnl '+(dayPnl>0?'pos':dayPnl<0?'neg':'be');
        pe.textContent=fP(dayPnl)||'—';
        dd.appendChild(pe);
        cell.appendChild(dd);
        if(dayPnl!==0){const bar=document.createElement('div');bar.className='day-bar '+(dayPnl>0?'pos':'neg');cell.appendChild(bar);}
        cell.addEventListener('click',(()=>{const dn2=dayNum,ds2=dateStr,tr2=dayMap[dayNum];return()=>showDayModal(dn2,ds2,tr2);})());
      }
    }
    calGrid.appendChild(cell);
  }
  // Collect all trades in this month for R + trade-based win rate
  const allMonthTrades=Object.values(dayMap).flat();
  const pnlTrades=allMonthTrades.filter(t=>t.pnl!==''&&!isNaN(parseFloat(t.pnl)));
  const winTradeCount=pnlTrades.filter(t=>parseFloat(t.pnl)>0).length;
  const tradeWR=pnlTrades.length>0?winTradeCount/pnlTrades.length*100:null;
  const rVals=allMonthTrades.filter(t=>t.r!==undefined&&t.r!==''&&t.r!==null&&!isNaN(parseFloat(t.r))).map(t=>parseFloat(t.r));
  const totalR=rVals.reduce((s,v)=>s+v,0);
  const winR=rVals.filter(v=>v>0).reduce((s,v)=>s+v,0);
  const lossR=Math.abs(rVals.filter(v=>v<0).reduce((s,v)=>s+v,0));

  if(tradeCnt>0){
    document.getElementById('sumBar').style.display='flex';
    const ps=document.getElementById('sumPnl');
    ps.textContent=fP(monthPnl)||'—';
    ps.style.color=monthPnl>0?G:monthPnl<0?R:'';
    ps.className='sum-val';
    document.getElementById('sumTrades').textContent=tradeCnt;
    document.getElementById('sumWin').textContent=winDays;
    document.getElementById('sumLoss').textContent=lossDays;
    // Win rate — trade-based
    const wrEl=document.getElementById('sumWR');
    wrEl.textContent=tradeWR!==null?tradeWR.toFixed(0)+'%':'—';
    wrEl.style.color=tradeWR!==null?(tradeWR>=50?G:R):'';
    // Total R
    const totalREl=document.getElementById('sumTotalR');
    totalREl.textContent=rVals.length>0?(totalR>=0?'+':'')+totalR.toFixed(2)+'R':'—';
    totalREl.style.color=totalR>0?G:totalR<0?R:'var(--muted)';
    // Win R / Loss R
    document.getElementById('sumWinR').textContent=rVals.length>0?'+'+winR.toFixed(2)+'R':'—';
    document.getElementById('sumLossR').textContent=rVals.length>0?'-'+lossR.toFixed(2)+'R':'—';
    document.getElementById('sumBest').textContent=bestDay!==null?fP(bestDay):'—';
    document.getElementById('sumWorst').textContent=worstDay!==null?fP(worstDay):'—';
  } else {
    document.getElementById('sumBar').style.display='none';
  }
  renderPrevMonths();
}

function togglePrevMonths(){
  _prevOpen=!_prevOpen;
  renderPrevMonths();
}

function renderPrevMonths(){
  const section=document.getElementById('prevMonthsSection');
  const grid=document.getElementById('prevMonthsGrid');
  if(!section||!grid)return;

  // Group ALL trades by year-month (including current month)
  const monthData={};
  allTrades.forEach(t=>{
    if(!t.date)return;
    const parts=t.date.split('-').map(Number);
    const y=parts[0],m=parts[1]-1;
    const key=y+'-'+String(m).padStart(2,'0');
    if(!monthData[key])monthData[key]={y,m,trades:[]};
    monthData[key].trades.push(t);
  });

  const keys=Object.keys(monthData).sort().reverse();
  if(keys.length===0){section.style.display='none';return;}
  section.style.display='block';

  // Sync toggle button label & icon
  const toggleIcon=document.getElementById('pmToggleIcon');
  const toggleLbl=document.getElementById('pmToggleLbl');
  if(toggleIcon)toggleIcon.className=`fa-solid ${_prevOpen?'fa-chevron-up':'fa-chevron-down'}`;
  if(toggleLbl)toggleLbl.textContent=_prevOpen?'Hide':'Show';

  // Show/hide grid without re-rendering when collapsed
  if(!_prevOpen){grid.style.display='none';return;}
  grid.style.display='block';
  grid.innerHTML='';

  const mkStat=(lbl,val,color)=>{
    const s=document.createElement('div');s.className='pm-stat';
    const l=document.createElement('span');l.className='pm-stat-lbl';l.textContent=lbl;
    const v=document.createElement('span');v.className='pm-stat-val';v.textContent=val;
    if(color)v.style.color=color;
    s.appendChild(l);s.appendChild(v);return s;
  };

  keys.slice(0,24).forEach(key=>{
    const{y,m,trades}=monthData[key];
    if(isMonthLocked(y,m))return;
    const isCurrent=y===curYear&&m===curMonth;

    const pnlT=trades.filter(t=>t.pnl!==''&&!isNaN(parseFloat(t.pnl)));
    const totalPnl=pnlT.reduce((s,t)=>s+parseFloat(t.pnl),0);
    const winT=pnlT.filter(t=>parseFloat(t.pnl)>0).length;
    const wr=pnlT.length>0?winT/pnlT.length*100:null;
    const rT=trades.filter(t=>t.r!==undefined&&t.r!==''&&t.r!==null&&!isNaN(parseFloat(t.r)));
    const tR=rT.reduce((s,t)=>s+parseFloat(t.r),0);
    const aR=rT.length>0?tR/rT.length:null;
    const rVals=rT.map(t=>parseFloat(t.r));
    const winRm=rVals.filter(v=>v>0).reduce((s,v)=>s+v,0);
    const lossRm=Math.abs(rVals.filter(v=>v<0).reduce((s,v)=>s+v,0));

    const row=document.createElement('div');
    row.className='pm-row'+(isCurrent?' is-current':'');
    row.title=(isCurrent?'Currently viewing — ':'')+MONTHS[m]+' '+y;
    row.onclick=()=>{curYear=y;curMonth=m;renderMonth();updateNavButtons();window.scrollTo({top:0,behavior:'smooth'});};

    const nameEl=document.createElement('div');
    nameEl.className='pm-name';
    const nameText=document.createElement('span');
    nameText.textContent=MONTHS[m].slice(0,3)+' '+y;
    nameEl.appendChild(nameText);
    if(isCurrent){
      const badge=document.createElement('span');
      badge.className='pm-current-badge';
      badge.textContent='Current';
      nameEl.appendChild(badge);
    }

    const statsEl=document.createElement('div');
    statsEl.className='pm-stats';
    statsEl.appendChild(mkStat('Trades',trades.length,''));
    statsEl.appendChild(mkStat('Win Rate',wr!==null?wr.toFixed(0)+'%':'—',wr!==null?(wr>=50?G:R):''));
    statsEl.appendChild(mkStat('Avg R',aR!==null?(aR>=0?'+':'')+aR.toFixed(2)+'R':'—',aR!==null?(aR>0?G:aR<0?R:'var(--muted)'):''));
    statsEl.appendChild(mkStat('Win R',rT.length>0?'+'+winRm.toFixed(2)+'R':'—',G));
    statsEl.appendChild(mkStat('Loss R',rT.length>0?'-'+lossRm.toFixed(2)+'R':'—',R));
    statsEl.appendChild(mkStat('Total R',rT.length>0?(tR>=0?'+':'')+tR.toFixed(2)+'R':'—',tR>0?G:tR<0?R:'var(--muted)'));
    statsEl.appendChild(mkStat('PNL',fP(totalPnl)||'—',totalPnl>0?G:totalPnl<0?R:''));

    const chev=document.createElement('i');
    chev.className='fa-solid fa-chevron-right pm-chevron';
    row.appendChild(nameEl);row.appendChild(statsEl);row.appendChild(chev);
    grid.appendChild(row);
  });

  if(grid.children.length===0)section.style.display='none';
}

function showDayModal(dayNum,dateStr,trades){
  document.getElementById('dmTitle').textContent=fmtDate(dateStr);
  const dayPnl=trades.filter(t=>t.pnl!==''&&!isNaN(parseFloat(t.pnl))).reduce((s,t)=>s+parseFloat(t.pnl),0);
  const body=document.getElementById('dmBody');body.innerHTML='';

  // Summary line — hardcoded green/red for total PNL
  const sum=document.createElement('div');sum.className='dm-summary';
  const sc=document.createElement('span');sc.style.cssText='font-size:12px;color:var(--muted)';sc.textContent=trades.length+' trade'+(trades.length>1?'s':'');
  const sp=document.createElement('span');
  sp.style.cssText=`font-family:var(--font-mono,"Space Grotesk",sans-serif);font-size:15px;font-weight:700;color:${dayPnl>0?G:dayPnl<0?R:'var(--muted)'}`;
  sp.textContent=fP(dayPnl)||'—';
  sum.appendChild(sc);sum.appendChild(sp);body.appendChild(sum);

  trades.forEach(t=>{
    const row=document.createElement('div');row.className='dm-trade';
    const left=document.createElement('div');left.style.cssText='display:flex;align-items:center;gap:7px;flex-wrap:wrap';
    const pair=document.createElement('span');pair.className='dp-pair';pair.textContent=t.pair||'—';
    // Long always green, Short always red
    const pos=document.createElement('span');
    pos.className='dp-pos '+((t.position||'Long').toLowerCase());
    pos.textContent=t.position||'Long';
    left.appendChild(pair);left.appendChild(pos);
    const right=document.createElement('div');right.style.cssText='display:flex;align-items:center;gap:8px';
    if(t.time){const time=document.createElement('span');time.style.cssText='font-size:11px;color:var(--muted)';time.textContent=t.time;right.appendChild(time);}
    // Trade PNL — hardcoded green/red
    const pnlN=parseFloat(t.pnl);
    const pnlEl=document.createElement('span');
    pnlEl.className='dp-pnl '+(pnlN>0?'pos':pnlN<0?'neg':'');
    pnlEl.textContent=fP(t.pnl)||'—';
    right.appendChild(pnlEl);
    // R factor — hardcoded green/red
    if(t.r){
      const rEl=document.createElement('span');
      const rv=parseFloat(t.r);
      rEl.style.cssText=`font-size:11px;font-family:var(--font-mono,"Space Grotesk",sans-serif);color:${rv>0?G:rv<0?R:'var(--muted)'}`;
      rEl.textContent=(rv>0?'+':'')+rv.toFixed(2)+'R';
      right.appendChild(rEl);
    }
    row.appendChild(left);row.appendChild(right);body.appendChild(row);
  });
  document.getElementById('dayModalOverlay').classList.add('open');
}

function closeDayModal(e){if(e.target===document.getElementById('dayModalOverlay'))closeDayModalDirect();}
function closeDayModalDirect(){document.getElementById('dayModalOverlay').classList.remove('open');}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDayModalDirect();});

function prevMonthClick(){
  let testM=curMonth-1,testY=curYear;
  if(testM<0){testM=11;testY--;}
  if(isMonthLocked(testY,testM)){
    const banner=document.getElementById('freeBanner');
    banner.style.background='rgba(245,158,11,.12)';banner.style.borderColor='rgba(245,158,11,.5)';
    setTimeout(()=>{banner.style.background='';banner.style.borderColor='';},2000);
    return;
  }
  prevMonth();
}
function prevMonth(){curMonth--;if(curMonth<0){curMonth=11;curYear--;}renderMonth();updateNavButtons();}
function nextMonth(){curMonth++;if(curMonth>11){curMonth=0;curYear++;}renderMonth();updateNavButtons();}
function goToday(){curYear=new Date().getFullYear();curMonth=new Date().getMonth();renderMonth();updateNavButtons();}

function updateNavButtons(){
  const prevBtn=document.getElementById('prevBtn'),nextBtn=document.getElementById('nextBtn');
  if(!prevBtn||!nextBtn)return;
  const today=new Date(),todayY=today.getFullYear(),todayM=today.getMonth();
  const isCurrentOrFuture=(curYear>todayY)||(curYear===todayY&&curMonth>=todayM);
  nextBtn.disabled=isCurrentOrFuture;nextBtn.style.opacity=isCurrentOrFuture?'.35':'';nextBtn.style.cursor=isCurrentOrFuture?'not-allowed':'';
  if(!userIsPro){
    let testM=curMonth-1,testY=curYear;if(testM<0){testM=11;testY--;}
    const prevBlocked=isMonthLocked(testY,testM);
    prevBtn.disabled=prevBlocked;prevBtn.style.opacity=prevBlocked?'.35':'';prevBtn.style.cursor=prevBlocked?'not-allowed':'';
    prevBtn.title=prevBlocked?'Upgrade to Pro to view older history':'';
  } else {
    prevBtn.disabled=false;prevBtn.style.opacity='';prevBtn.style.cursor='';
  }
}

// Inline handlers in calendar.html call these by global name.
Object.assign(window, { closeDayModal, closeDayModalDirect, goToday, nextMonth, prevMonthClick, togglePrevMonths });