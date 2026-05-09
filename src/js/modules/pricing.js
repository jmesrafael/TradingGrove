// pricing.js — public pricing page
// Loaded by /src/pages/pricing.html. Depends on `db` and `SUPABASE_URL` from supabase-client.js.

let selectedPlan = 'monthly';

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

function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const open = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
  if (!open) item.classList.add('open');
}

async function upgradeToPro() {
  const btn = document.getElementById('proPlanBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Redirecting to checkout…</span>';

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
      throw new Error(data.error || 'Could not create checkout session.');
    }
  } catch (err) {
    const btn2 = document.getElementById('proPlanBtn');
    btn2.disabled = false;
    btn2.innerHTML = '<i class="fa-solid fa-rocket"></i><span id="proBtnText">' +
      (selectedPlan === 'annual' ? 'Upgrade to Pro — $10/mo billed $120/yr' : 'Upgrade to Pro — $15/mo') + '</span>';
  }
}

(async () => {
  const loader = document.getElementById('pageLoader');
  loader.classList.add('gone');
  setTimeout(() => { if (loader) loader.style.display = 'none'; }, 450);
})();

// Inline onclick handlers in pricing.html call these by global name.
window.setPlan = setPlan;
window.toggleFaq = toggleFaq;
window.upgradeToPro = upgradeToPro;
