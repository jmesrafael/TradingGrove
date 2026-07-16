// confirm.js — email confirmation page
// Loaded by /src/pages/confirm.html. Depends on `db` global from supabase-client.js.

function showState(id) {
  document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

(async () => {
  // Check if there's a token hash in the URL (Supabase email confirmation)
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);

  // Supabase puts confirmation data in the hash fragment
  if (hash && hash.includes('access_token')) {
    // Let Supabase handle the token automatically
    const { data, error } = await db.auth.getSession();
    if (error || !data?.session) {
      showState('stateError');
    } else {
      showState('stateSuccess');
      setTimeout(() => window.location.href = '/dashboard', 2000);
    }
    return;
  }

  // Check URL params for type=signup (Supabase sends this)
  if (params.get('type') === 'signup' || params.get('type') === 'email_change') {
    const { data, error } = await db.auth.getSession();
    if (error || !data?.session) {
      showState('stateError');
    } else {
      showState('stateSuccess');
      setTimeout(() => window.location.href = '/dashboard', 2000);
    }
    return;
  }

  // Also handle when Supabase processes the token and creates a session
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    showState('stateSuccess');
    setTimeout(() => window.location.href = '/dashboard', 1500);
    return;
  }

  // No token — show waiting state
  const email = sessionStorage.getItem('tz_pending_email') || localStorage.getItem('tz_pending_email') || '';
  if (email) document.getElementById('emailDisplay').textContent = email;
  showState('stateWaiting');
})();

// Listen for auth state changes (fires when email is confirmed in another tab)
db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    showState('stateSuccess');
    setTimeout(() => window.location.href = '/dashboard', 1500);
  }
});

let resendCooldown = 0;
async function resendEmail() {
  if (resendCooldown > 0) return;
  const email = sessionStorage.getItem('tz_pending_email') || localStorage.getItem('tz_pending_email');
  if (!email) {
    window.location.href = '/auth';
    return;
  }
  const { error } = await db.auth.resend({ type: 'signup', email });
  if (error) {
    document.getElementById('resendArea').innerHTML = `<span style="color:var(--red)"><i class="fa-solid fa-circle-exclamation" style="margin-right:5px"></i>${error.message}</span>`;
    return;
  }
  // Start 60s cooldown
  resendCooldown = 60;
  const timer = setInterval(() => {
    resendCooldown--;
    const area = document.getElementById('resendArea');
    if (resendCooldown <= 0) {
      clearInterval(timer);
      area.innerHTML = '<a onclick="resendEmail()">Resend confirmation email</a>';
    } else {
      area.innerHTML = `<span>Email sent! Resend again in <strong>${resendCooldown}s</strong></span>`;
    }
  }, 1000);
  document.getElementById('resendArea').innerHTML = `<span>Email sent! Resend again in <strong>60s</strong></span>`;
}

// Exposed on window because inline onclick="resendEmail()" handlers in confirm.html call it.
window.resendEmail = resendEmail;
