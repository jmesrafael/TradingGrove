// help.js — help / FAQ page
// Loaded by /src/pages/help.html. Depends on globals from supabase-client.js
// (requireAuth, getProfile, applyProfileTheme, TZ).

// ── Boot ──────────────────────────────────────────────────────────────────────
(async()=>{
  try{
    const user=await requireAuth();
    if(!user)return;
    const profile=await getProfile(user.id);
    applyProfileTheme(profile);
  }catch(e){}
  if(window.TZ)TZ.hideLoader();
  renderFAQ('');
})();

// ── FAQ Data ──────────────────────────────────────────────────────────────────
const FAQ=[
  {
    category:'Getting Started',icon:'fa-solid fa-rocket',color:'cat-teal',
    items:[
      {q:'What is TradingGrove?',a:'TradingGrove is a trading journal app that helps you track trades, analyze performance, and build better habits. You can log every trade with details like entry, exit, PnL, strategy, mood, and screenshots.',tags:['journal','start','what']},
      {q:'How do I create my first journal?',a:'From the Dashboard, click <strong>+ New Journal</strong>. Give it a name (e.g. "Spot", "Futures"), set an optional starting capital, and click Create. You can make multiple journals to separate different markets or strategies.',tags:['journal','create','start']},
      {q:'Can I use TradingGrove on mobile?',a:'Yes! TradingGrove is fully responsive and works in any modern mobile browser. For the best experience, open it in Chrome or Safari on your phone.',tags:['mobile','app','phone']},
      {q:'Is my data safe?',a:'Your data is stored securely using Supabase with row-level security. Only you can access your journals and trades. We never sell your data. See our <a href="/privacy">Privacy Policy</a> for full details.',tags:['security','safe','data','privacy']},
    ]
  },
  {
    category:'Logging Trades',icon:'fa-solid fa-chart-line',color:'cat-blue',
    items:[
      {q:'How do I add a trade?',a:'Open a journal and go to the <strong>Logs</strong> tab. Click <strong>+ Add Trade</strong>. Fill in fields like pair, direction (long/short), entry, stop loss, take profit, PnL, strategy, timeframe, and notes. You can also attach screenshots.',tags:['trade','add','log']},
      {q:'What is the R Factor field?',a:'The R Factor (Risk/Reward) measures how much you won or lost relative to your initial risk. An R of 2 means you made twice your risk. An R of -1 means you lost your full risk. It\'s calculated automatically if you fill in your risk amount.',tags:['trade','r factor','risk reward']},
      {q:'Can I attach screenshots to trades?',a:'Yes — Pro users can attach trade screenshots. Click the image icon when adding or editing a trade. Images are stored securely and embedded in JSON exports.',tags:['trade','screenshot','image','pro']},
      {q:'How do I edit or delete a trade?',a:'In the Logs tab, click the row to open the trade detail, then use the Edit or Delete buttons. Deleted trades cannot be recovered.',tags:['trade','edit','delete']},
      {q:'What are Mood Tags used for?',a:'Mood tags let you record your emotional state when entering a trade (e.g. "Confident", "FOMO", "Patient"). This helps you identify patterns between your psychology and performance over time.',tags:['trade','mood','emotion']},
    ]
  },
  {
    category:'Analytics & Calendar',icon:'fa-solid fa-chart-bar',color:'cat-purple',
    items:[
      {q:'How does the Analytics tab work?',a:'The Analytics tab shows win rate, average PnL, best/worst trades, streaks, and breakdown by strategy, pair, and timeframe. Use it to identify what\'s working and what isn\'t.',tags:['analytics','stats','performance']},
      {q:'What is the Calendar view?',a:'The Calendar view shows your trading activity by day. Each day is color-coded by net PnL — green for profitable, red for losing days. Click any day to see all trades for that date.',tags:['calendar','view','day']},
      {q:'How do I enable the analytics bar in Logs?',a:'Go to <strong>Journal Settings → Display Options</strong> and toggle on <strong>Show Analytics Bar in Logs</strong>. This shows a summary strip of your win rate and PnL above the trades table.',tags:['analytics','logs','toggle']},
    ]
  },
  {
    category:'Pro Plan',icon:'fa-solid fa-star',color:'cat-amber',
    items:[
      {q:'What does Pro include?',a:'Pro unlocks:<ul><li>Unlimited journals (Free = 1)</li><li>Trade screenshot attachments</li><li>Full analytics and advanced filters</li><li>JSON export with embedded images</li><li>CSV export for Excel/Sheets</li><li>Journal PIN protection</li><li>All premium color themes</li><li>All font pairings</li><li>Mood color customization</li><li>Risk Calculator</li></ul>',tags:['pro','plan','features','upgrade']},
      {q:'How do I upgrade to Pro?',a:'Go to <strong>Dashboard → click your plan badge</strong> or visit the <a href="/subscription">Subscription</a> page. Choose Monthly or Yearly billing.',tags:['pro','upgrade','subscribe','billing']},
      {q:'What happens when my Pro plan expires?',a:'Your data stays safe. You\'ll be downgraded to the Free tier — meaning you can still access 1 journal, but Pro-only features like multiple journals, screenshots, and exports will be locked until you renew.',tags:['pro','expire','renew']},
      {q:'Can I get a refund?',a:'Please contact us at <a href="mailto:support@tradinggrove.com">support@tradinggrove.com</a> within 7 days of purchase if you\'d like to request a refund. See our <a href="/terms">Terms of Service</a> for full policy.',tags:['pro','refund','billing']},
    ]
  },
  {
    category:'Export & Import',icon:'fa-solid fa-database',color:'cat-indigo',
    items:[
      {q:'How do I export my trades?',a:'Go to <strong>Journal → Settings → Export & Import</strong>. Pro users can export as <strong>JSON</strong> (full backup including images) or <strong>CSV</strong> (for Excel/Google Sheets).',tags:['export','csv','json','backup']},
      {q:'What is included in a JSON backup?',a:'A JSON backup includes all your trades, journal settings, strategy/timeframe/pair tags, mood tags and colors, account capital, and all trade screenshots embedded as base64 data.',tags:['export','json','backup','images']},
      {q:'How do I import/restore a backup?',a:'Go to <strong>Journal → Settings → Export & Import → Import</strong>. Upload your <code>.json</code> file. Choose Replace (overwrites existing trades) or Merge (adds new trades only). Check "Restore settings too" to also restore tags and configuration.',tags:['import','restore','backup']},
      {q:'Can I open a CSV in Excel?',a:'Yes. Open Excel, go to <strong>Data → Get External Data → From Text/CSV</strong> and select your exported file. Alternatively, double-click the .csv file to open directly in Excel on Windows.',tags:['csv','excel','sheets','export']},
    ]
  },
  {
    category:'Risk Calculator',icon:'fa-solid fa-calculator',color:'cat-teal',
    items:[
      {q:'What is the Risk Calculator?',a:'The floating Risk Calculator (bottom-right button in your journal) helps you calculate proper position sizing for Crypto and Forex trades. Enter your balance, risk %, entry, and stop loss to get the correct position size.',tags:['calculator','risk','position sizing']},
      {q:'How is position size calculated for Forex?',a:'For Forex, the calculator converts your stop loss distance into pips, then divides your risk amount by (pips × pip value per lot) to get your lot size. JPY pairs and exotics use the correct pip multiplier automatically.',tags:['calculator','forex','lot size','pips']},
      {q:'How is position size calculated for Crypto?',a:'For Crypto: <strong>Position Size = Risk Amount ÷ Stop Loss Distance</strong>. This gives you the number of coins/units to buy so that hitting your stop loss equals exactly your risk amount.',tags:['calculator','crypto','position size','bitcoin']},
    ]
  },
  {
    category:'Referrals',icon:'fa-solid fa-gift',color:'cat-indigo',
    items:[
      {q:'How does the referral program work?',a:'Share your unique referral code or link with fellow traders. When they sign up and <strong>subscribe to Pro</strong>, you automatically receive <strong>30 free days of Pro</strong> added to your account — with no limit on how many friends you can refer.',tags:['referral','refer','reward','free']},
      {q:'Where do I find my referral code?',a:'Go to <strong>Dashboard → click your avatar → Refer a Friend</strong>. Your code and shareable link are displayed there.',tags:['referral','code','link']},
      {q:'When do I receive my referral reward?',a:'Rewards are applied automatically as soon as your referred friend completes their first paid Pro subscription. You\'ll see it reflected in your account\'s Pro expiry date.',tags:['referral','reward','when']},
    ]
  },
  {
    category:'Account & Security',icon:'fa-solid fa-shield-halved',color:'cat-red',
    items:[
      {q:'How do I change my password?',a:'Go to <strong>Dashboard → Avatar → Profile</strong> and scroll to the Password section. Enter your new password (minimum 8 characters), confirm it, and click Save Password.',tags:['password','security','account']},
      {q:'Can I protect my journal with a PIN?',a:'Yes — Pro users can set a 4–6 digit PIN per journal. Go to <strong>Journal → Settings → Journal PIN → Add PIN</strong>. The PIN is required each time someone tries to open that journal.',tags:['pin','security','pro','journal']},
      {q:'How do I delete my account?',a:'Go to <strong>Dashboard → Avatar → Profile → Danger Zone</strong> or <strong>Dashboard Settings (gear) → Danger Zone</strong>. Type DELETE to confirm. This permanently removes all your data.',tags:['delete','account','data']},
      {q:'I forgot my PIN — how do I reset it?',a:'Contact us at <a href="mailto:support@tradinggrove.com">support@tradinggrove.com</a> with your account email. We can verify your identity and help you reset the journal PIN.',tags:['pin','forgot','reset']},
    ]
  },
];

// ── Render ────────────────────────────────────────────────────────────────────
function renderFAQ(query){
  const q=query.trim().toLowerCase();
  const container=document.getElementById('faqContainer');
  const noRes=document.getElementById('noResults');
  let totalVisible=0;

  container.innerHTML=FAQ.map((cat,ci)=>{
    const visItems=cat.items.filter(item=>{
      if(!q)return true;
      return item.q.toLowerCase().includes(q)||item.a.toLowerCase().replace(/<[^>]+>/g,'').includes(q)||(item.tags||[]).some(t=>t.includes(q));
    });
    if(!visItems.length)return'';
    totalVisible+=visItems.length;
    const itemsHtml=visItems.map((item,ii)=>{
      const qText=q?highlight(item.q,q):item.q;
      const aText=item.a;
      const id=`faq-${ci}-${ii}`;
      return`<div class="faq-item" id="${id}">
        <div class="faq-q" onclick="toggleFAQ('${id}')">
          <span class="faq-q-text">${qText}</span>
          <i class="fa-solid fa-chevron-down faq-chevron"></i>
        </div>
        <div class="faq-a">${aText}</div>
      </div>`;
    }).join('');
    return`<div class="faq-category" style="animation-delay:${ci*.05}s">
      <div class="faq-cat-hdr">
        <div class="cat-icon ${cat.color}"><i class="${cat.icon}"></i></div>
        <span class="faq-cat-title">${cat.category}</span>
      </div>
      ${itemsHtml}
    </div>`;
  }).join('');

  if(q&&totalVisible===0){noRes.classList.add('show');document.getElementById('noResultsQ').textContent=query;}
  else{noRes.classList.remove('show');}

  // Auto-open first match when searching
  if(q&&totalVisible>0){const first=container.querySelector('.faq-item');if(first)first.classList.add('open');}
}

function toggleFAQ(id){
  const el=document.getElementById(id);
  const wasOpen=el.classList.contains('open');
  // Close all in same category
  el.closest('.faq-category').querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'));
  if(!wasOpen)el.classList.add('open');
}

function highlight(text,q){
  const re=new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return text.replace(re,'<mark>$1</mark>');
}

// ── Search ────────────────────────────────────────────────────────────────────
let _st;
function onSearch(val){
  clearTimeout(_st);
  document.getElementById('searchClear').classList.toggle('show',val.length>0);
  _st=setTimeout(()=>renderFAQ(val),160);
}
function clearSearch(){document.getElementById('helpSearch').value='';document.getElementById('searchClear').classList.remove('show');renderFAQ('');}
function filterChip(tag){const inp=document.getElementById('helpSearch');inp.value=tag;document.getElementById('searchClear').classList.add('show');renderFAQ(tag);}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _tt;
function showToast(msg,icon='fa-solid fa-circle-check',type=''){const t=document.getElementById('toast');document.getElementById('toastIcon').className=icon;document.getElementById('toastMsg').textContent=msg;t.className='show'+(type==='green'?' toast-green':'');clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show','toast-green'),3400);}

// Inline onclick/oninput handlers in help.html (and templated rows) call these.
window.onSearch = onSearch;
window.clearSearch = clearSearch;
window.filterChip = filterChip;
window.toggleFAQ = toggleFAQ;
