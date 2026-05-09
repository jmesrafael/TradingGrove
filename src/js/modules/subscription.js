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

// ── Upgrade — redirects to payment method selection ───────
function redirectToPayment() {
  location.href = '/payment-method?plan=' + selectedPlan;
}

// ── Manage billing portal ─────────────────────────────────
async function openBillingPortal() {
  const btn = document.getElementById('manageBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading…';
  try {
    // PayPal subscribers manage their subscription directly on paypal.com
    if (currentProfile?.paypal_subscription_id && !currentProfile?.stripe_customer_id) {
      window.open('https://www.paypal.com/myaccount/autopay/', '_blank');
      return;
    }

    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const res = await fetch(SUPABASE_URL + '/functions/v1/billing-portal', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        return_url: window.location.origin + '/subscription',
        customer_id: session.user?.id
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.message) {
      showToast(data.message, 'fa-solid fa-gift', 'green');
      if (data.url && data.url.includes('#')) {
        setTimeout(() => { window.location.href = data.url; }, 1500);
      }
      return;
    }

    if (!data.url) throw new Error(data.error || 'No billing portal URL returned');
    window.location.href = data.url;

  } catch (err) {
    console.error('Billing portal error:', err);
    showToast('Error: ' + err.message, 'fa-solid fa-circle-exclamation', 'r');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-gear"></i> Manage Billing';
  }
}

// ══════════════════════════════════════════════════════════════
//  PRO SUBSCRIPTION CELEBRATION MODAL
//  Ported exactly from profile.html reward modal.
//  Fires automatically when ?upgraded=1 is in the URL.
// ══════════════════════════════════════════════════════════════

// ── REMOVE THIS ENTIRE FUNCTION WHEN DONE TESTING ──────────
function _testRewardModal() {
  // Bypasses the normal trigger so the modal always fires on click.
  _openRewardModal();
}
// ── END REMOVE ──────────────────────────────────────────────

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
  const user = await requireAuth();
  if (!user) return;

  currentProfile = await getProfile(user.id);

  // Apply the user's saved theme before anything else renders
  applyProfileTheme(currentProfile);

  const isPro     = currentProfile?.plan === 'pro';
  const subStatus = getSubscriptionStatus(currentProfile);
  const planType  = currentProfile?.plan_type || 'none';

  const psIcon = document.getElementById('psIcon');
  const psVal  = document.getElementById('psVal');
  const psMeta = document.getElementById('psMeta');

  if (isPro) {
    psIcon.className = 'ps-icon pro';
    psIcon.innerHTML = '<i class="fa-solid fa-star"></i>';
    psVal.textContent = 'Pro Plan';
    psVal.className   = 'ps-val pro';

    if (subStatus.expired) {
      psMeta.textContent = 'Your subscription has expired';
      psMeta.className   = 'ps-meta danger';
    } else if (subStatus.expiring) {
      psMeta.textContent = subStatus.label;
      psMeta.className   = 'ps-meta warn';
    } else {
      psMeta.textContent = subStatus.label;
    }

    document.getElementById('manageBtn').style.display = 'inline-flex';

    const expiresAt = currentProfile?.subscription_expires_at || currentProfile?.pro_expires_at;
    if (expiresAt && planType !== 'lifetime') {
      const totalDays = planType === 'yearly' ? 365 : planType === 'monthly' ? 30 : ((subStatus.daysLeft ?? 0) > 60 ? 365 : 30);
      const daysLeft  = subStatus.daysLeft ?? 0;
      const pct       = Math.max(0, Math.min(100, (daysLeft / totalDays) * 100));
      const fillColor = subStatus.expired ? 'var(--red,#ff5f6d)' : subStatus.expiring ? 'var(--amber,#f59e0b)' : 'var(--accent2)';
      document.getElementById('daysBarFill').style.width      = pct + '%';
      document.getElementById('daysBarFill').style.background = fillColor;
      document.getElementById('daysBarLeft').textContent      = subStatus.expired ? 'Expired' : daysLeft + ' days remaining';
      document.getElementById('daysBarLeft').style.color      = subStatus.expired ? 'var(--red,#ff5f6d)' : subStatus.expiring ? 'var(--amber,#f59e0b)' : '';
      document.getElementById('daysBarRight').textContent     = subStatus.label;
      document.getElementById('daysBarWrap').style.display    = 'block';
    }

    const proBtn = document.getElementById('proPlanBtn');
    proBtn.disabled  = true;
    proBtn.className = 'plan-btn current';
    proBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Your Current Plan';
    document.querySelector('.cta-nudge').style.display = 'none';
    document.getElementById('billingToggle').style.display = 'none';

    const freeBtn = document.getElementById('freePlanBtn');
    freeBtn.disabled    = true;
    freeBtn.textContent = 'Free Plan';

  } else {
    setPlan('monthly');
    document.getElementById('freePlanBtn').disabled    = true;
    document.getElementById('freePlanBtn').textContent = 'Current Plan';
  }

  const loader = document.getElementById('pageLoader');
  loader.classList.add('gone');
  setTimeout(() => { if (loader) loader.style.display = 'none'; }, 450);

  // ── Fire the Pro celebration modal on successful upgrade ──
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('upgraded') === '1') {
    setTimeout(() => _openRewardModal(), 700);
  }
  if (sp.get('cancelled') === '1') {
    setTimeout(() => showToast('Checkout cancelled — still on Free plan.', 'fa-solid fa-circle-info', ''), 600);
  }
})();

// Inline onclick handlers in subscription.html call these by global name.
window.setPlan = setPlan;
window.toggleFaq = toggleFaq;
window.redirectToPayment = redirectToPayment;
window.openBillingPortal = openBillingPortal;
window.closeRewardModal = closeRewardModal;
window._testRewardModal = _testRewardModal;
