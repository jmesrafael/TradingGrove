// payment-method.js — payment provider selection page
// Loaded by /src/pages/payment-method.html
// Depends on globals from supabase-client.js (db, requireAuth, applyProfileTheme, SUPABASE_URL)

let selectedPlan = 'monthly';

// ── Read plan from URL and update badge ───────────────────
(function initPlan() {
  const sp = new URLSearchParams(window.location.search);
  const plan = sp.get('plan');
  if (plan === 'annual') selectedPlan = 'annual';

  const badge = document.getElementById('planBadgeText');
  if (selectedPlan === 'annual') {
    badge.textContent = 'TradingGrove Pro — Annual · $10/mo billed $120/yr';
  } else {
    badge.textContent = 'TradingGrove Pro — Monthly · $15/mo';
  }
})();

// ── Pay with Stripe ───────────────────────────────────────
async function payWithStripe() {
  const btn    = document.getElementById('stripeBtn');
  const loader = document.getElementById('stripeLoader');
  btn.disabled = true;
  btn.querySelector('.pm-card-inner').style.display = 'none';
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
    btn.disabled = false;
    btn.querySelector('.pm-card-inner').style.display = 'flex';
    loader.style.display = 'none';
  }
}

// ── Pay with PayPal ───────────────────────────────────────
async function payWithPayPal() {
  const btn    = document.getElementById('paypalBtn');
  const loader = document.getElementById('paypalLoader');
  btn.disabled = true;
  btn.querySelector('.pm-card-inner').style.display = 'none';
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
    btn.disabled = false;
    btn.querySelector('.pm-card-inner').style.display = 'flex';
    loader.style.display = 'none';
  }
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

  const profile = await getProfile(user.id);
  applyProfileTheme(profile);

  // Already pro? Redirect back to subscription page
  if (profile?.plan === 'pro') {
    const expires = profile.subscription_expires_at;
    const isActive = expires && new Date(expires) > new Date();
    if (isActive || profile.plan_type === 'lifetime') {
      location.href = '/subscription';
      return;
    }
  }

  // Show cancelled toast if coming back from a cancelled PayPal flow
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('cancelled') === '1') {
    setTimeout(() => showToast('Payment cancelled — choose a method to try again.', 'fa-solid fa-circle-info', ''), 400);
    window.history.replaceState({}, '', window.location.pathname + '?plan=' + selectedPlan);
  }

  const loader = document.getElementById('pageLoader');
  loader.classList.add('gone');
  setTimeout(() => { if (loader) loader.style.display = 'none'; }, 450);
})();

window.payWithStripe  = payWithStripe;
window.payWithPayPal  = payWithPayPal;
