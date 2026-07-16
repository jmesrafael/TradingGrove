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
      plan === 'annual' ? 'Upgrade to Pro · $10/mo billed $120/yr' : 'Upgrade to Pro · $15/mo';
  }
}

function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const open = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
  if (!open) item.classList.add('open');
}

// PayPal is the only supported gateway — send the user to /subscription to
// pick a plan and check out there, rather than starting a Stripe checkout here.
async function upgradeToPro() {
  const { data: { session } } = await db.auth.getSession();
  location.href = session ? '/subscription' : '/auth';
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
