// dashboard.js - dashboard page
// Loaded by /src/pages/dashboard.html. Depends on globals from supabase-client.js & theme.js.
let currentUser=null,journals=[],pnlMap={},isPro=false,currentProfile=null;
let _themeDropOpen=false,_fontDropOpen=false,_menuOpen=false;

// ── Welcome ─────────────────────────────────────────────────────────────────
const WELCOME_KEY='tz_welcome_seen';
function maybeShowWelcome(isEmpty){if(!isEmpty)return;if(localStorage.getItem(WELCOME_KEY))return;setTimeout(()=>{document.getElementById('welcomeOverlay').classList.remove('hidden');document.getElementById('newJournalBtn').classList.add('spotlight-ring');},900);}
function dismissWelcome(){document.getElementById('welcomeOverlay').classList.add('hidden');document.getElementById('newJournalBtn').classList.remove('spotlight-ring');localStorage.setItem(WELCOME_KEY,'1');}
document.getElementById('welcomeOverlay').addEventListener('click',function(e){if(e.target===this)dismissWelcome();});

// ── Avatar dropdown ──────────────────────────────────────────────────────────
function toggleMenu(){_menuOpen=!_menuOpen;document.getElementById('avatarMenu').classList.toggle('open',_menuOpen);}
function closeMenu(){_menuOpen=false;document.getElementById('avatarMenu')?.classList.remove('open');}
document.addEventListener('click',e=>{
  if(_menuOpen){const w=document.getElementById('avatarWrap');if(w&&!w.contains(e.target))closeMenu();}
  if(_themeDropOpen){const dd=document.getElementById('themeDropdown'),btn=document.getElementById('themeTrigger');if(dd&&!dd.contains(e.target)&&btn&&!btn.contains(e.target))closeThemeDropdown();}
  if(_fontDropOpen){const dd=document.getElementById('fontDropdown'),btn=document.getElementById('fontTrigger');if(dd&&!dd.contains(e.target)&&btn&&!btn.contains(e.target))closeFontDropdown();}
});

// ── Drag to reorder ─────────────────────────────────────────────────────────
let _dragSrcId=null;
function initDrag(){
  const grid=document.getElementById('grid');const cards=grid.querySelectorAll('.jcard[data-id]');if(cards.length<2)return;
  document.getElementById('dragHint').style.display='flex';
  cards.forEach(card=>{
    card.classList.add('draggable');card.setAttribute('draggable','true');
    card.addEventListener('dragstart',e=>{_dragSrcId=card.dataset.id;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    card.addEventListener('dragend',()=>{card.classList.remove('dragging');grid.querySelectorAll('.jcard').forEach(c=>c.classList.remove('drag-over'));});
    card.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';if(card.dataset.id!==_dragSrcId){grid.querySelectorAll('.jcard').forEach(c=>c.classList.remove('drag-over'));card.classList.add('drag-over');}});
    card.addEventListener('dragleave',()=>{card.classList.remove('drag-over');});
    card.addEventListener('drop',async e=>{
      e.preventDefault();card.classList.remove('drag-over');if(!_dragSrcId||_dragSrcId===card.dataset.id)return;
      const fi=journals.findIndex(j=>j.id===_dragSrcId),ti=journals.findIndex(j=>j.id===card.dataset.id);if(fi===-1||ti===-1)return;
      const[m]=journals.splice(fi,1);journals.splice(ti,0,m);renderJournals();initDrag();
      try{await updateJournalPositions(journals.map(j=>j.id));}catch(err){showToast('Could not save order','fa-solid fa-circle-exclamation','red');}
    });
  });
}

// ── Theme picker & logo swap ─────────────────────────────────────────────────
function applyLogoTheme(themeId){const logo=document.getElementById('headerLogo');if(!logo)return;logo.src=themeId==='light'?'/assets/images/dark.png':'/assets/images/light.png';}
function _buildThemeDropdown(){const dd=document.getElementById('themeDropdown');if(!dd||!window.TZ)return;const cur=localStorage.getItem('tl_theme')||'dark';dd.innerHTML='';TZ.themeList.forEach(th=>{const locked=th.pro&&!isPro,active=th.id===cur;const row=document.createElement('div');row.className='theme-row'+(active?' active':'')+(locked?' locked':'');const swatchHtml=th.swatches.map(c=>`<span class="tr-swatch" style="background:${c}"></span>`).join('');const proBadgeClass={'blue-electric':'electric','golden':'golden','void':'void'}[th.id]||'generic';const proHtml=(th.pro&&!isPro)?`<span class="tr-pro ${proBadgeClass}">PRO</span>`:'';row.innerHTML=`<div class="tr-swatches">${swatchHtml}</div><div class="tr-info"><div class="tr-name">${th.label}</div><div class="tr-desc">${th.desc}</div></div><div class="tr-right">${active?'<i class="fa-solid fa-check tr-check"></i>':''}${proHtml}</div>`;if(!locked){row.addEventListener('click',()=>{_applyThemeSelection(th.id);closeThemeDropdown();});}else{row.addEventListener('click',()=>{document.getElementById('themeProHint').classList.add('show');showToast(`${th.label} is a Pro theme.`,'fa-solid fa-crown','red');});}dd.appendChild(row);});}
function _updateThemeTrigger(themeId){const cur=themeId||localStorage.getItem('tl_theme')||'dark';const meta=TZ.themeList?.find(t=>t.id===cur)||TZ.themeList?.[1]||{label:'Dark',desc:'',swatches:['#111','#1a1a1a','#aaa']};const swEl=document.getElementById('triggerSwatches'),nameEl=document.getElementById('triggerName'),descEl=document.getElementById('triggerDesc');if(swEl)swEl.innerHTML=meta.swatches.map(c=>`<span class="theme-trigger-swatch" style="background:${c}"></span>`).join('');if(nameEl)nameEl.textContent=meta.label;if(descEl)descEl.textContent=meta.desc;const mini=document.getElementById('menuThemeSwatches');if(mini)mini.innerHTML=meta.swatches.map(c=>`<span class="tsm" style="background:${c}"></span>`).join('');}
async function _applyThemeSelection(id){if(window.TZ)TZ.setTheme(id);else localStorage.setItem('tl_theme',id);_updateThemeTrigger(id);_buildThemeDropdown();applyLogoTheme(id);try{await updateProfile(currentUser.id,{color_theme:id});}catch(e){}}
function toggleThemeDropdown(){if(_fontDropOpen)closeFontDropdown();const dd=document.getElementById('themeDropdown'),btn=document.getElementById('themeTrigger');_themeDropOpen=!_themeDropOpen;dd.classList.toggle('open',_themeDropOpen);btn.classList.toggle('open',_themeDropOpen);if(_themeDropOpen){_buildThemeDropdown();document.getElementById('themeProHint').classList.remove('show');}}
function closeThemeDropdown(){_themeDropOpen=false;document.getElementById('themeDropdown')?.classList.remove('open');document.getElementById('themeTrigger')?.classList.remove('open');}

// ── Font picker ──────────────────────────────────────────────────────────────
function _buildFontDropdown(){const dd=document.getElementById('fontDropdown');if(!dd||!window.TZ)return;const cur=localStorage.getItem('tl_font')||'default';dd.innerHTML='';TZ.fontList.forEach(f=>{if(f.url)TZ._injectFont(f.url);});TZ.fontList.forEach(f=>{const locked=f.pro&&!isPro,active=f.id===cur;const row=document.createElement('div');row.className='font-row'+(active?' active':'')+(locked?' locked':'');const proHtml=(f.pro&&!isPro)?'<span class="fr-pro">PRO</span>':'';row.innerHTML=`<div class="fr-preview"><div class="fr-heading-preview" style="font-family:${f.heading}">${f.preview.heading}</div><div class="fr-body-preview" style="font-family:${f.body}">${f.preview.body}</div><div class="fr-meta">${f.desc}</div></div><div class="fr-right">${active?'<i class="fa-solid fa-check fr-check"></i>':''}${proHtml}</div>`;if(!locked){row.addEventListener('click',()=>{_applyFontSelection(f.id);closeFontDropdown();});}else{row.addEventListener('click',()=>{document.getElementById('fontProHint').classList.add('show');showToast(`${f.label} is a Pro font.`,'fa-solid fa-crown','red');});}dd.appendChild(row);});}
function _updateFontTrigger(fontId){const cur=fontId||localStorage.getItem('tl_font')||'default';const meta=TZ.fontList?.find(f=>f.id===cur)||TZ.fontList?.[0];if(!meta)return;const el=document.getElementById('fontTriggerLeft');if(el)el.innerHTML=`<div class="font-trigger-preview"><span class="ftp-heading" style="font-family:${meta.heading}">${meta.preview.heading}</span><span class="ftp-body" style="font-family:${meta.body}">${meta.preview.body} · ${meta.desc}</span></div>`;}
async function _applyFontSelection(id){if(window.TZ)TZ.setFont(id);else localStorage.setItem('tl_font',id);_updateFontTrigger(id);_buildFontDropdown();try{await updateProfile(currentUser.id,{font_theme:id});}catch(e){}}
function toggleFontDropdown(){if(_themeDropOpen)closeThemeDropdown();const dd=document.getElementById('fontDropdown'),btn=document.getElementById('fontTrigger');_fontDropOpen=!_fontDropOpen;dd.classList.toggle('open',_fontDropOpen);btn.classList.toggle('open',_fontDropOpen);if(_fontDropOpen){_buildFontDropdown();document.getElementById('fontProHint').classList.remove('show');}}
function closeFontDropdown(){_fontDropOpen=false;document.getElementById('fontDropdown')?.classList.remove('open');document.getElementById('fontTrigger')?.classList.remove('open');}

// ── Sub banner ───────────────────────────────────────────────────────────────
function renderSubBanner(s){const banner=document.getElementById('subBanner'),text=document.getElementById('subBannerText');if(!banner||!text||!s.isPro)return;if(s.expired){text.innerHTML=`<i class="fa-solid fa-circle-xmark" style="margin-right:8px"></i><strong>Your Pro subscription has expired.</strong> Renew to keep access.`;banner.className='sub-banner show expired';}else if(s.expiring){text.innerHTML=`<i class="fa-solid fa-clock" style="margin-right:8px"></i><strong>${s.label}</strong> — Renew now to avoid losing Pro features.`;banner.className='sub-banner show expiring';}}

// ── Boot ─────────────────────────────────────────────────────────────────────
(async()=>{
  currentUser=await requireAuth();if(!currentUser)return;
  currentProfile=await getProfile(currentUser.id);
  applyProfileTheme(currentProfile);
  isPro=getSubscriptionStatus(currentProfile).isPro;
  window._userIsPro=isPro;

  // Avatar initials
  const name=currentProfile?.name||currentUser.email||'?';
  const initials=name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('avatarInitials').textContent=initials;
  document.getElementById('menuUname').textContent=name;
  document.getElementById('menuEmail').textContent=currentUser.email;

  // Plan badge
  const badge=document.getElementById('planBadge');
  const sub=getSubscriptionStatus(currentProfile);
  if(isPro){
    if(sub.expiring){badge.textContent=`Expires in ${sub.daysLeft}d`;badge.className='plan-badge badge-expiring';}
    else if(sub.expired){badge.textContent='Pro Expired';badge.className='plan-badge badge-free';}
    else{badge.textContent='Pro';badge.className='plan-badge badge-pro';}
    renderSubBanner(sub);
    // Show Billing button for Pro users
    document.getElementById('menuBillingBtn').style.display='flex';
  }else{
    document.getElementById('upgradeNudge').classList.add('visible');
  }

  // Theme/font triggers
  const currentTheme=localStorage.getItem('tl_theme')||'dark';
  _updateThemeTrigger(currentTheme);
  _updateFontTrigger(localStorage.getItem('tl_font')||'default');
  applyLogoTheme(currentTheme);

  // Referral badge (load actual count from database)
  try{
    const refs=await getReferrals(currentUser.id);
    const refCount=refs.length;
    if(refCount>0){const rb=document.getElementById('menuRefBadge');rb.textContent=refCount;rb.style.display='inline-flex';}
  }catch(e){console.warn('[dashboard] Failed to load referral count:',e);}

  await loadJournals();
  if(window.TZ)TZ.hideLoader();else hidePageLoader();
})();

// ── Journals ─────────────────────────────────────────────────────────────────
async function loadJournals(){
  journals=await getJournals(currentUser.id);
  pnlMap=await getJournalsPnl(journals.map(j=>j.id));
  document.getElementById('loadingState').style.display='none';
  renderJournals();initDrag();
  maybeShowWelcome(journals.length===0);
}
function renderJournals(){
  const grid=document.getElementById('grid');grid.style.display='';
  if(!journals.length){grid.innerHTML=`<div class="empty-state"><i class="fa-solid fa-chart-candlestick"></i>No journals yet.<br>Click <strong>+ New Journal</strong> to begin.</div>`;document.getElementById('dragHint').style.display='none';return;}
  grid.innerHTML=journals.map((j,i)=>{
    const pin=j.pin_hash?`<div class="pin-lock" title="PIN protected"><i class="fa-solid fa-lock"></i></div>`:'';
    const cap=(j.show_capital!==false)&&j.capital?`<div class="cap"><i class="fa-solid fa-wallet" style="font-size:10px"></i>$${Number(j.capital).toLocaleString()}</div>`:'';
    const pnl=pnlMap[j.id];let pnlHtml='';
    if((j.show_pnl!==false)&&pnl!=null){const cls=pnl>=0?'pnl-pos':'pnl-neg';const fmt=(pnl>=0?'+':'-')+'$'+Math.abs(pnl).toFixed(2);pnlHtml=`<div class="pnl-row"><span class="pnl-lbl">PNL</span><span class="pnl-val ${cls}">${fmt}</span></div>`;}
    return`<div class="jcard" data-id="${j.id}" style="animation-delay:${i*.06}s">
      <i class="fa-solid fa-grip-dots-vertical drag-handle" title="Drag to reorder"></i>
      <div class="jcard-body">
        <div><div class="jcard-top"><h3>${esc(j.name)}</h3>${pin}</div>${cap}${pnlHtml}</div>
        <button class="open-btn" onclick="goJournal('${j.id}')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Journal</button>
      </div>
    </div>`;
  }).join('');
}
function goJournal(id){if(!id)return;sessionStorage.setItem('tz_current_journal',id);localStorage.setItem('tz_current_journal',id);location.href='/journal';}

// ── Create journal ────────────────────────────────────────────────────────────
function openCreate(){
  if(!isPro&&journals.length>=1){showToast('Free plan: 1 journal only. Upgrade for unlimited.','fa-solid fa-lock','red');setTimeout(()=>location.href='/subscription',2100);return;}
  document.getElementById('createModal').classList.add('open');setTimeout(()=>document.getElementById('jName').focus(),100);
}
function closeCreate(){document.getElementById('createModal').classList.remove('open');document.getElementById('jName').value='';document.getElementById('jCapital').value='';}
async function doCreate(){
  const name=document.getElementById('jName').value.trim();const capital=document.getElementById('jCapital').value.trim();
  if(!name){document.getElementById('jName').style.borderColor='var(--red,#ff5f6d)';setTimeout(()=>document.getElementById('jName').style.borderColor='',1500);return;}
  const btn=document.getElementById('createBtn');btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Creating…';
  try{
    await createJournal(currentUser.id,{name,capital:capital?parseFloat(capital):null,pin_hash:null});
    closeCreate();showToast('Journal created!','fa-solid fa-circle-check','green');
    if(!document.getElementById('welcomeOverlay').classList.contains('hidden'))dismissWelcome();
    await loadJournals();
  }catch(e){showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red');}
  finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Create';}
}
document.getElementById('createModal').addEventListener('click',function(e){if(e.target===this)closeCreate();});

// ── Settings ──────────────────────────────────────────────────────────────────
function openSettings(){closeMenu();closeThemeDropdown();closeFontDropdown();_updateThemeTrigger();_updateFontTrigger();document.getElementById('settingsModal').classList.add('open');}
function closeSettings(){document.getElementById('settingsModal').classList.remove('open');closeThemeDropdown();closeFontDropdown();}
document.getElementById('settingsModal').addEventListener('click',function(e){if(e.target===this)closeSettings();});

// ── Referral modal ────────────────────────────────────────────────────────────
let _refLoaded=false;
async function openReferModal(){
  closeMenu();
  document.getElementById('referModal').classList.add('open');
  if(_refLoaded)return;
  _refLoaded=true;
  const code=currentProfile?.referral_code||'—';
  const url=buildReferralUrl?buildReferralUrl(code):`${location.origin}/?ref=${code}`;
  document.getElementById('refModalCode').textContent=code;
  document.getElementById('refModalUrl').textContent=url;
  // Load referrals
  try{
    const refs=await getReferrals(currentUser.id);
    const total=refs.length,rewarded=refs.filter(r=>r.reward_granted).length,pending=refs.filter(r=>!r.reward_granted).length;
    const days=rewarded*30;
    document.getElementById('refBalanceDays').textContent=days;
    ['refStatTotal','refHistTotal'].forEach(id=>document.getElementById(id).textContent=total);
    ['refStatRewarded','refHistRewarded'].forEach(id=>document.getElementById(id).textContent=rewarded);
    ['refStatPending','refHistPending'].forEach(id=>document.getElementById(id).textContent=pending);
    // History table
    const wrap=document.getElementById('refHistoryTable');
    if(!refs.length){wrap.innerHTML='<div class="ref-empty"><i class="fa-solid fa-user-group"></i>No referrals yet. Share your link!</div>';return;}
    wrap.innerHTML=`<table class="ref-table"><thead><tr><th>User</th><th>Date</th><th>Status</th><th>Reward</th></tr></thead><tbody>${refs.map(r=>{const d=new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});const n=r.referred_profile?.name||'Anonymous';let sc='status-pending',sl='Pending';if(r.status==='rewarded'){sc='status-rewarded';sl='Rewarded';}if(r.status==='converted'){sc='status-converted';sl='Subscribed';}return`<tr><td style="font-weight:500">${esc(n)}</td><td>${d}</td><td><span class="status-badge ${sc}">${sl}</span></td><td style="color:${r.reward_granted?'var(--accent2)':'var(--muted)'}">${r.reward_granted?'<i class="fa-solid fa-circle-check" style="margin-right:4px"></i>+30 days':'<i class="fa-solid fa-clock" style="margin-right:4px;opacity:.5"></i>Waiting'}</td></tr>`;}).join('')}</tbody></table>`;
  }catch(e){console.error(e);}
}
function closeReferModal(){document.getElementById('referModal').classList.remove('open');}
document.getElementById('referModal').addEventListener('click',function(e){if(e.target===this)closeReferModal();});
function switchRefTab(name,btn){
  document.querySelectorAll('.ref-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ref-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('refPanel-'+name).classList.add('active');
}
function copyModalCode(){
  const code=document.getElementById('refModalCode').textContent;
  navigator.clipboard.writeText(code).then(()=>{const b=document.getElementById('copyModalCodeBtn');b.classList.add('copied');b.innerHTML='<i class="fa-solid fa-check"></i> Copied!';setTimeout(()=>{b.classList.remove('copied');b.innerHTML='<i class="fa-solid fa-copy"></i> Copy Code';},2000);});
}
function copyModalUrl(){
  const url=document.getElementById('refModalUrl').textContent;
  navigator.clipboard.writeText(url).then(()=>showToast('Share link copied!','fa-solid fa-link','green'));
}

// ── Delete account ────────────────────────────────────────────────────────────
function openDelAccount(){document.getElementById('delAccInput').value='';document.getElementById('delAccForm').style.display='block';document.getElementById('delAccProgress').classList.remove('show');checkDelAcc();document.getElementById('delAccountOverlay').classList.add('open');setTimeout(()=>document.getElementById('delAccInput').focus(),150);}
function closeDelAccount(){document.getElementById('delAccountOverlay').classList.remove('open');}
function checkDelAcc(){const ok=document.getElementById('delAccInput').value.trim()==='DELETE';const btn=document.getElementById('delAccBtn');btn.disabled=!ok;btn.style.opacity=ok?'1':'.4';btn.style.cursor=ok?'pointer':'not-allowed';}
async function executeDeleteAccount(){
  document.getElementById('delAccForm').style.display='none';document.getElementById('delAccProgress').classList.add('show');
  try{
    const{data:{session}}=await db.auth.getSession();if(!session)throw new Error('Not authenticated');
    const res=await fetch(`${SUPABASE_URL}/functions/v1/delete-account`,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'}});
    const data=await res.json();if(!res.ok)throw new Error(data.error||'Deletion failed');
    document.getElementById('delAccMsg').textContent='Account deleted. Redirecting…';
    await db.auth.signOut();sessionStorage.clear();localStorage.clear();setTimeout(()=>location.href='/',1500);
  }catch(e){showToast('Failed: '+e.message,'fa-solid fa-circle-exclamation','red');document.getElementById('delAccForm').style.display='block';document.getElementById('delAccProgress').classList.remove('show');}
}
document.getElementById('delAccountOverlay').addEventListener('click',function(e){if(e.target===this)closeDelAccount();});

// ── Billing Modal ────────────────────────────────────────────────────────
function openBillingModal(){
  if(!isPro){showToast('Only Pro users have billing','fa-solid fa-info-circle');return;}

  const planType = currentProfile?.plan_type || 'monthly';
  const expiry = currentProfile?.subscription_expires_at;
  const gateway = currentProfile?.payment_gateway || 'unknown';
  const queued = currentProfile?.queued_subscription;

  // Plan name
  const planName = planType === 'yearly' ? 'Pro — Annual ($120/yr)' : 'Pro — Monthly ($15/mo)';
  document.getElementById('billingPlanName').textContent = planName;

  // Renewal date
  if(expiry){
    const date = new Date(expiry);
    const fmt = date.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    document.getElementById('billingRenewalDate').textContent = `Renews ${fmt}`;
  }

  // Queued subscription notice
  if(queued){
    const startDate = new Date(queued.starts_at);
    const startFmt = startDate.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    const queuedType = queued.plan_type === 'yearly' ? 'Annual ($120/yr)' : 'Monthly ($15/mo)';
    document.getElementById('billingQueuedText').textContent = `Scheduled upgrade to ${queuedType} on ${startFmt}`;
    document.getElementById('billingQueuedNotice').style.display = 'block';
  }else{
    document.getElementById('billingQueuedNotice').style.display = 'none';
  }

  // Payment method (PayPal only for now)
  const paymentName = 'PayPal';
  const paymentIcon = 'fa-brands fa-paypal';

  /* STRIPE COMMENTED OUT - will enable when returning to multi-gateway
  const paymentName = gateway === 'paypal' ? 'PayPal' : gateway === 'stripe' ? 'Stripe' : 'Unknown';
  const paymentIcon = gateway === 'paypal'
    ? 'fa-brands fa-paypal'
    : gateway === 'stripe'
    ? 'fa-credit-card'
    : 'fa-credit-card';
  */

  document.getElementById('billingPaymentIcon').className = paymentIcon;
  document.getElementById('billingPaymentName').textContent = paymentName;
  document.getElementById('billingPaymentDetails').textContent = `Billing via ${paymentName}`;

  document.getElementById('billingModal').classList.add('open');
}

function closeBillingModal(){
  document.getElementById('billingModal').classList.remove('open');
}

function openBillingPortal(){
  // PayPal only (for now)
  const paypalUrl = 'https://www.paypal.com/myaccount/autopay/';
  window.open(paypalUrl, '_blank');

  /* STRIPE COMMENTED OUT - will enable when returning to multi-gateway
  const gateway = currentProfile?.payment_gateway || 'paypal';
  if(gateway === 'paypal'){
    window.open('https://www.paypal.com/myaccount/autopay/', '_blank');
  }else if(gateway === 'stripe'){
    // Stripe portal - would need to call an edge function to get portal URL
    location.href = '/subscription';
  }
  */
}

function confirmCancelSubscription(){
  if(!confirm('Cancel your subscription? You\'ll keep Pro access until ' + new Date(currentProfile?.subscription_expires_at).toLocaleDateString())){
    return;
  }
  openBillingPortal(); // Redirect to manage billing where they can cancel
}

document.getElementById('billingModal')?.addEventListener('click', function(e){
  if(e.target === this) closeBillingModal();
});

async function logout(){await db.auth.signOut();sessionStorage.clear();location.href='/auth';}

let _tt;
function showToast(msg,icon='fa-solid fa-circle-check',type=''){const t=document.getElementById('toast');document.getElementById('toastIcon').className=icon;document.getElementById('toastMsg').textContent=msg;t.className='show'+(type==='green'?' toast-green':type==='red'?' toast-red':'');clearTimeout(_tt);_tt=setTimeout(()=>{t.classList.remove('show','toast-green','toast-red');},3400);}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

// Inline handlers in HTML call these by global name.
Object.assign(window, { checkDelAcc, closeCreate, closeDelAccount, closeReferModal, closeSettings, copyModalCode, copyModalUrl, dismissWelcome, doCreate, executeDeleteAccount, goJournal, logout, openCreate, openReferModal, openSettings, switchRefTab, toggleFontDropdown, toggleMenu, toggleThemeDropdown });