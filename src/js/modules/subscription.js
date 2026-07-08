// subscription.js — billing/subscription page
// Loaded by /src/pages/subscription.html. Depends on globals from supabase-client.js
// (db, requireAuth, getProfile, applyProfileTheme, getSubscriptionStatus, SUPABASE_URL).

let selectedPlan = 'monthly';
let currentProfile = null;

// ── Billing toggle ────────────────────────────────────────
function setPlan(plan) {
  selectedPlan = plan;
  document.getElementById('btnMonthly').classList.toggle('active', plan === 'monthly');
  document.getElementById('btnAnnual').classList.toggle('active',  plan === 'annual');
  document.getElementById('priceMonthly').style.display = plan === 'monthly' ? 'block' : 'none';
  document.getElementById('priceAnnual').style.display  = plan === 'annual'  ? 'block' : 'none';

  const btn = document.getElementById('proPlanBtn');
  if (btn && !btn.disabled) {
    document.getElementById('proBtnText').textContent =
      plan === 'annual' ? 'Upgrade to Pro — $10/mo billed $120/yr' : 'Upgrade to Pro — $15/mo';
  }
}

// ── FAQ ───────────────────────────────────────────────────
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const open = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
  if (!open) item.classList.add('open');
}

// ── Upgrade — opens payment gateway selector modal ────────
function redirectToPayment() {
  openPaymentModal();
}

function openPaymentModal() {
  const badge = document.getElementById('pgwPlanBadgeText');
  badge.textContent = selectedPlan === 'annual'
    ? 'TradingGrove Pro — Annual · $10/mo billed $120/yr'
    : 'TradingGrove Pro — Monthly · $15/mo';

  _pgwReset();
  document.getElementById('paymentGatewayOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePaymentModal() {
  document.getElementById('paymentGatewayOverlay').classList.remove('open');
  document.body.style.overflow = '';
  _pgwReset();
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('paymentGatewayOverlay')) {
    closePaymentModal();
  }
}

function _pgwReset() {
  ['pgwStripeBtn', 'pgwPaypalBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = false;
  });
  const si = document.getElementById('pgwStripeInner');
  const pi = document.getElementById('pgwPaypalInner');
  const sl = document.getElementById('pgwStripeLoader');
  const pl = document.getElementById('pgwPaypalLoader');
  if (si) si.style.display = 'flex';
  if (pi) pi.style.display = 'flex';
  if (sl) sl.style.display = 'none';
  if (pl) pl.style.display = 'none';
}

/* STRIPE COMMENTED OUT - will enable when returning to multi-gateway
async function pgwPayWithStripe() {
  const btn    = document.getElementById('pgwStripeBtn');
  const inner  = document.getElementById('pgwStripeInner');
  const loader = document.getElementById('pgwStripeLoader');
  btn.disabled = true;
  inner.style.display  = 'none';
  loader.style.display = 'flex';

  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { location.href = '/auth'; return; }

    const lookupKey = selectedPlan === 'annual' ? 'tradinggrove_pro_annual' : 'tradinggrove_pro_monthly';
    const res = await fetch(SUPABASE_URL + '/functions/v1/create-checkout', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lookup_key: lookupKey }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Could not create Stripe checkout session.');
    }
  } catch (err) {
    showToast('Stripe error: ' + err.message, 'fa-solid fa-circle-exclamation', 'r');
    _pgwReset();
  }
}
*/

async function pgwPayWithPayPal() {
  const btn    = document.getElementById('pgwPaypalBtn');
  const inner  = document.getElementById('pgwPaypalInner');
  const loader = document.getElementById('pgwPaypalLoader');
  btn.disabled = true;
  inner.style.display  = 'none';
  loader.style.display = 'flex';

  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { location.href = '/auth'; return; }

    const res = await fetch(SUPABASE_URL + '/functions/v1/create-paypal-subscription', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ plan: selectedPlan }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Could not create PayPal subscription.');
    }
  } catch (err) {
    showToast('PayPal error: ' + err.message, 'fa-solid fa-circle-exclamation', 'r');
    _pgwReset();
  }
}

// ── Manage billing portal ─────────────────────────────────
// PayPal is the only supported gateway — subscribers manage billing directly on paypal.com.
function openBillingPortal() {
  window.open('https://www.paypal.com/myaccount/autopay/', '_blank');
}

// ══════════════════════════════════════════════════════════════
//  PRO SUBSCRIPTION CELEBRATION MODAL
//  Ported exactly from profile.html reward modal.
//  Fires automatically when ?upgraded=1 is in the URL.
// ══════════════════════════════════════════════════════════════

function _openRewardModal() {
  document.getElementById('rewardOverlay').classList.add('open');
  _launchRewardConfetti();
  _spawnRewardParticles();
}

function closeRewardModal() {
  const overlay = document.getElementById('rewardOverlay');
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity .25s';
  setTimeout(() => {
    overlay.classList.remove('open');
    overlay.style.opacity = '';
    overlay.style.transition = '';
    // Clean the URL so refreshing doesn't retrigger
    window.history.replaceState({}, '', window.location.pathname);
  }, 260);
}

// Close on backdrop click
document.getElementById('rewardOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeRewardModal();
});

// Close payment modal on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closePaymentModal();
    closeRewardModal();
  }
});

// ── Floating ✨ particles (exact copy from profile.html) ──
function _spawnRewardParticles() {
  const container = document.getElementById('rewardParticles');
  container.innerHTML = '';
  for (let i = 0; i < 14; i++) {
    const el = document.createElement('span');
    el.className = 'reward-particle';
    el.textContent = '✨';
    el.style.left              = (4 + Math.random() * 92) + '%';
    el.style.bottom            = (4 + Math.random() * 45) + '%';
    el.style.animationDelay    = (i * 0.15) + 's';
    el.style.fontSize          = (13 + Math.random() * 16) + 'px';
    el.style.animationDuration = (1.5 + Math.random() * .9) + 's';
    container.appendChild(el);
  }
}

// ── Canvas confetti burst (exact copy from profile.html) ──
function _launchRewardConfetti() {
  const canvas = document.getElementById('rewardConfettiCanvas');
  const ctx = canvas.getContext('2d');
  const card = document.getElementById('rewardCard');
  const W = card.offsetWidth || 420;
  const H = card.offsetHeight || 520;
  canvas.width = W;
  canvas.height = H;

  const FALLBACK_COLORS = ['#00ff88', '#f5c842', '#ff5f6d', '#a5b4fc', '#fbbf24', '#34d399', '#60a5fa', '#fb923c'];

  const particles = Array.from({ length: 90 }, (_, i) => ({
    x: Math.random() * W,
    y: -12 - Math.random() * 50,
    size: 5 + Math.random() * 7,
    color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    vx: (Math.random() - .5) * 3.5,
    vy: 1.8 + Math.random() * 3.5,
    rot: Math.random() * 360,
    vrot: (Math.random() - .5) * 9,
    shape: Math.random() > .45 ? 'rect' : 'circle',
    alpha: 1,
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    particles.forEach(p => {
      if (p.y > H + 20 || p.alpha <= 0) return;
      alive++;
      p.x += p.vx;
      p.y += p.vy + frame * .01;
      p.rot += p.vrot;
      if (p.y > H * .55) p.alpha = Math.max(0, p.alpha - .02);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    });
    frame++;
    if (alive > 0 && frame < 240) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, W, H);
  }
  draw();
}

// ── Toast ─────────────────────────────────────────────────
let _tt;
function showToast(msg, icon, type) {
  const t = document.getElementById('toast');
  document.getElementById('toastIcon').className = icon;
  document.getElementById('toastMsg').textContent = msg;
  t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(_tt);
  _tt = setTimeout(() => t.className = '', 3500);
}

// ── Init ──────────────────────────────────────────────────
(async () => {
  try {
    const user = await requireAuth();
    if (!user) return;

  // After a PayPal redirect (?upgraded=1 / ?cancelled=1), capture the flags once
  // and strip the query string immediately — before any async work — so a page
  // refresh (or the reward modal's own DOM churn) can never re-trigger this branch.
  const sp = new URLSearchParams(window.location.search);
  const justUpgraded  = sp.get('upgraded') === '1';
  const justCancelled = sp.get('cancelled') === '1';
  if (justUpgraded || justCancelled) {
    window.history.replaceState({}, '', window.location.pathname);
  }

  currentProfile = await getProfile(user.id);

  // The PayPal webhook may not have processed yet when we land back here —
  // poll the (cache-busted) profile for a few seconds until it reflects Pro,
  // instead of blindly reloading the page (which caused the old infinite loop).
  if (justUpgraded) {
    for (let attempt = 0; attempt < 5 && currentProfile?.plan !== 'pro'; attempt++) {
      await new Promise(r => setTimeout(r, 1200));
      _cacheInvalidate('profile:' + user.id);
      currentProfile = await getProfile(user.id);
    }
  }

  // Apply the user's saved theme before anything else renders
  applyProfileTheme(currentProfile);

  const subStatus = getSubscriptionStatus(currentProfile);
  // A profile that was ever Pro (even if fully downgraded past grace) still shows the
  // Pro plan-strip header + subscription period; only the CTA button state differs.
  const wasEverPro = currentProfile?.plan === 'pro';
  const planType   = currentProfile?.plan_type || 'none';

  const psIcon = document.getElementById('psIcon');
  const psVal  = document.getElementById('psVal');
  const psMeta = document.getElementById('psMeta');

  if (wasEverPro) {
    psIcon.className = 'ps-icon pro';
    psIcon.innerHTML = '<i class="fa-solid fa-star"></i>';
    psVal.textContent = 'Pro Plan';
    psVal.className   = 'ps-val pro';

    if (subStatus.downgraded) {
      psMeta.textContent = 'Your subscription has expired';
      psMeta.className   = 'ps-meta danger';
    } else if (subStatus.inGrace) {
      psMeta.textContent = subStatus.label;
      psMeta.className   = 'ps-meta danger';
    } else if (subStatus.expiring) {
      psMeta.textContent = subStatus.label;
      psMeta.className   = 'ps-meta warn';
    } else {
      psMeta.textContent = subStatus.label;
    }

    // Show queued subscription notice if exists
    const queued = currentProfile?.queued_subscription;
    if (queued) {
      const queuedElement = document.getElementById('queuedNotice');
      if (queuedElement) {
        const startsAt = new Date(queued.starts_at);
        const queuedType = queued.plan_type === 'yearly' ? 'Annual' : 'Monthly';
        const startFmt = startsAt.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
        document.getElementById('queuedNoticeBadge').textContent = queuedType;
        document.getElementById('queuedNoticeDate').textContent = startFmt;
        queuedElement.style.display = 'block';
      }
    }

    document.getElementById('manageBtn').style.display = 'inline-flex';

    const expiresAt = currentProfile?.subscription_expires_at || currentProfile?.pro_expires_at;
    if (expiresAt && planType !== 'lifetime') {
      const totalDays = planType === 'yearly' ? 365 : planType === 'monthly' ? 30 : ((subStatus.daysLeft ?? 0) > 60 ? 365 : 30);
      const daysLeft  = subStatus.daysLeft ?? 0;
      const pct       = Math.max(0, Math.min(100, (daysLeft / totalDays) * 100));
      const isBad     = subStatus.downgraded || subStatus.inGrace;
      const fillColor = isBad ? 'var(--red,#ff5f6d)' : subStatus.expiring ? 'var(--amber,#f59e0b)' : 'var(--accent2)';
      document.getElementById('daysBarFill').style.width      = pct + '%';
      document.getElementById('daysBarFill').style.background = fillColor;
      document.getElementById('daysBarLeft').textContent      = subStatus.downgraded ? 'Expired' : isBad ? 'In grace period' : daysLeft + ' days remaining';
      document.getElementById('daysBarLeft').style.color      = isBad ? 'var(--red,#ff5f6d)' : subStatus.expiring ? 'var(--amber,#f59e0b)' : '';
      document.getElementById('daysBarRight').textContent     = subStatus.label;
      document.getElementById('daysBarWrap').style.display    = 'block';
    }

    const proBtn  = document.getElementById('proPlanBtn');
    const freeBtn = document.getElementById('freePlanBtn');

    if (subStatus.downgraded) {
      // Pro has fully lapsed (past grace) — treat Free as the active plan and let
      // the user re-subscribe. This is the fix for the "still says Your Current
      // Plan after expiry" bug.
      setPlan('monthly');
      proBtn.disabled  = false;
      proBtn.className = 'plan-btn cta';
      proBtn.innerHTML = '<i class="fa-solid fa-rocket"></i> <span id="proBtnText">Renew Pro</span>';
      document.querySelector('.cta-nudge').style.display = '';
      document.getElementById('billingToggle').style.display = '';

      freeBtn.disabled    = true;
      freeBtn.textContent = 'Current Plan';
    } else {
      // Active Pro, or within the grace period — Pro stays the current plan.
      proBtn.disabled  = true;
      proBtn.className = 'plan-btn current';
      proBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Your Current Plan';
      document.querySelector('.cta-nudge').style.display = 'none';
      document.getElementById('billingToggle').style.display = 'none';

      freeBtn.disabled    = true;
      freeBtn.textContent = 'Free Plan';
    }

  } else {
    setPlan('monthly');
    document.getElementById('freePlanBtn').disabled    = true;
    document.getElementById('freePlanBtn').textContent = 'Current Plan';
  }

    // ── Fire the Pro celebration modal on successful upgrade (once — the URL is
    //    already stripped above, so a refresh won't re-enter this branch) ──
  if (justUpgraded) {
    setTimeout(() => _openRewardModal(), 700);
  }
  if (justCancelled) {
    setTimeout(() => showToast('Checkout cancelled — still on Free plan.', 'fa-solid fa-circle-info', ''), 600);
  }
  } finally {
    const loader = document.getElementById('pageLoader');
    if (loader) {
      loader.classList.add('gone');
      setTimeout(() => { if (loader) loader.style.display = 'none'; }, 450);
    }
  }
})();

// Inline onclick handlers in subscription.html call these by global name.
window.setPlan = setPlan;
window.toggleFaq = toggleFaq;
window.redirectToPayment = redirectToPayment;
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;
window.handleOverlayClick = handleOverlayClick;
// window.pgwPayWithStripe = pgwPayWithStripe; // STRIPE COMMENTED OUT - will enable when returning to multi-gateway
window.pgwPayWithPayPal = pgwPayWithPayPal;
window.openBillingPortal = openBillingPortal;
window.closeRewardModal = closeRewardModal;

