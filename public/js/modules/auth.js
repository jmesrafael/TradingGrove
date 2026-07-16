// auth.js — sign-in / sign-up page
// Loaded by /src/pages/auth.html. Depends on `db` global and `getUser()` from supabase-client.js.

// ── Boot: redirect if already signed in ──────────────────
(async () => {
  const user = await getUser();
  if (user) { window.location.href = '/dashboard'; return; }
  document.getElementById('pageLoader').classList.add('gone');
})();

// ── Referral code from URL ────────────────────────────────
const _p      = new URLSearchParams(window.location.search);
const refCode = _p.get('ref');

if (refCode) {
  localStorage.setItem('ref_code', refCode);
  switchTab('signup');
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('signupRefCode');
    if (el) { el.value = refCode.toUpperCase(); validateRefCode(); }
  });
}

const storedRef = localStorage.getItem('ref_code');
if (storedRef && !refCode) {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('signupRefCode');
    if (el && !el.value) el.value = storedRef.toUpperCase();
  });
}

if (_p.get('signup') === '1') switchTab('signup');

// ── Pending email (after signup, before confirm) ──────────
let _pendingEmail = sessionStorage.getItem('tz_pending_email') || '';

// ── Tab switching ─────────────────────────────────────────
function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('loginPanel').style.display  = isLogin ? 'block' : 'none';
  document.getElementById('signupPanel').style.display = isLogin ? 'none'  : 'block';
  document.getElementById('confirmPanel').classList.remove('show');
  document.getElementById('authTabs').style.display    = 'flex';
  document.getElementById('tabLogin').classList.toggle('active',  isLogin);
  document.getElementById('tabSignup').classList.toggle('active', !isLogin);
  clearAlerts();
}

function showConfirmPanel(email) {
  _pendingEmail = email;
  sessionStorage.setItem('tz_pending_email', email);
  document.getElementById('confirmEmailBadge').textContent = email;
  document.getElementById('loginPanel').style.display  = 'none';
  document.getElementById('signupPanel').style.display = 'none';
  document.getElementById('authTabs').style.display    = 'none';
  document.getElementById('confirmPanel').classList.add('show');
  clearAlerts();
}

function backToSignup() {
  _pendingEmail = '';
  sessionStorage.removeItem('tz_pending_email');
  switchTab('signup');
}

// ── Password toggle ───────────────────────────────────────
function togglePw(id, btn) {
  const inp  = document.getElementById(id);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.querySelector('i').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
}

// ── Password strength ─────────────────────────────────────
function checkStrength(val) {
  const bar  = document.getElementById('pwBar');
  const hint = document.getElementById('pwHint');
  if (!val) { bar.style.width = '0'; hint.textContent = ''; return; }
  let s = 0;
  if (val.length >= 8)           s++;
  if (val.length >= 12)          s++;
  if (/[A-Z]/.test(val))         s++;
  if (/[0-9]/.test(val))         s++;
  if (/[^A-Za-z0-9]/.test(val))  s++;
  const lvl = [
    {w:'20%',bg:'#ff5f6d',t:'Too short'},
    {w:'40%',bg:'#f59e0b',t:'Weak'},
    {w:'60%',bg:'#f59e0b',t:'Fair'},
    {w:'80%',bg:'var(--accent2)',t:'Good'},
    {w:'100%',bg:'var(--accent)',t:'Strong'},
  ][Math.min(s, 4)];
  bar.style.width      = lvl.w;
  bar.style.background = lvl.bg;
  hint.textContent     = lvl.t;
  hint.style.color     = lvl.bg;
}

// ── Alert helpers ─────────────────────────────────────────
function showError(msg)   {
  document.getElementById('authErrorMsg').textContent = msg;
  document.getElementById('authError').classList.add('show');
  document.getElementById('authSuccess').classList.remove('show');
  document.getElementById('authWarning').classList.remove('show');
}
function showSuccess(msg) {
  document.getElementById('authSuccessMsg').textContent = msg;
  document.getElementById('authSuccess').classList.add('show');
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authWarning').classList.remove('show');
}
function showWarning(msg) {
  document.getElementById('authWarningMsg').innerHTML = msg;
  document.getElementById('authWarning').classList.add('show');
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authSuccess').classList.remove('show');
}
function clearAlerts() {
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authSuccess').classList.remove('show');
  document.getElementById('authWarning').classList.remove('show');
}
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// ── Referral code validation ──────────────────────────────
let _refValidated  = false;
let _refValidCode  = '';
let _refValidTimer = null;

function onRefCodeInput(val) {
  _refValidated = false;
  _refValidCode = '';
  clearRefStatus();
  if (val.length === 8) {
    clearTimeout(_refValidTimer);
    _refValidTimer = setTimeout(validateRefCode, 600);
  }
}

function clearRefStatus() {
  const el = document.getElementById('refStatus');
  el.className = 'ref-status';
  el.innerHTML = '';
}

async function validateRefCode() {
  const raw  = document.getElementById('signupRefCode').value.trim().toUpperCase();
  const stat = document.getElementById('refStatus');
  if (!raw) { clearRefStatus(); return; }
  if (raw.length < 4) {
    stat.className = 'ref-status invalid';
    stat.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Code too short';
    return;
  }
  stat.className = 'ref-status checking';
  stat.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking…';
  try {
    const { data, error } = await db.rpc('validate_referral_code', { code: raw });
    if (error) throw error;
    if (data?.valid) {
      _refValidated = true;
      _refValidCode = raw;
      localStorage.setItem('ref_code', raw);
      stat.className = 'ref-status valid';
      stat.innerHTML = `<i class="fa-solid fa-circle-check"></i> Valid! Referred by <strong>${data.referrer_name}</strong>`;
    } else {
      _refValidated = false;
      _refValidCode = '';
      stat.className = 'ref-status invalid';
      stat.innerHTML = data?.reason === 'not_found'
        ? '<i class="fa-solid fa-circle-xmark"></i> Code not found. Check spelling and try again.'
        : '<i class="fa-solid fa-circle-xmark"></i> Invalid code.';
    }
  } catch (e) {
    stat.className = 'ref-status invalid';
    stat.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Could not verify. Try again.';
  }
}

// ── Button loading helper ─────────────────────────────────
function setBtnLoading(btnId, iconId, textId, loading, defaultIcon, defaultText, loadingText) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  if (loading) {
    document.getElementById(iconId).outerHTML = `<div class="spin-ring" id="${iconId}"></div>`;
    document.getElementById(textId).textContent = loadingText;
  } else {
    const el = document.getElementById(iconId);
    if (el) el.outerHTML = `<i class="${defaultIcon}" id="${iconId}"></i>`;
    document.getElementById(textId).textContent = defaultText;
  }
}

// ── Google OAuth ──────────────────────────────────────────
async function doGoogleAuth() {
  clearAlerts();
  // Disable both google buttons while redirecting
  const btns = ['googleLoginBtn','googleSignupBtn'];
  btns.forEach(id => { const b = document.getElementById(id); if(b) b.disabled = true; });

  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/dashboard',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) throw error;
    // Supabase will redirect to Google — no further action needed here
  } catch (err) {
    showError(err.message || 'Google sign-in failed. Try again.');
    btns.forEach(id => { const b = document.getElementById(id); if(b) b.disabled = false; });
  }
}

// ── Login ─────────────────────────────────────────────────
async function doLogin() {
  clearAlerts();
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  if (!email || !isValidEmail(email)) { showError('Please enter a valid email address.'); return; }
  if (!pass) { showError('Please enter your password.'); return; }

  setBtnLoading('loginBtn','loginBtnIcon','loginBtnText',true,'fa-solid fa-arrow-right-to-bracket','Sign In','Signing in…');
  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;

    // Extra guard: if email not confirmed, block and show confirm panel
    if (!data.user?.email_confirmed_at) {
      await db.auth.signOut();
      showConfirmPanel(email);
      showWarning('Please confirm your email before signing in. Check your inbox or resend below.');
      setBtnLoading('loginBtn','loginBtnIcon','loginBtnText',false,'fa-solid fa-arrow-right-to-bracket','Sign In','');
      return;
    }

    showSuccess('Signed in! Redirecting…');
    setTimeout(() => window.location.href = '/dashboard', 700);
  } catch (err) {
    let msg = err.message || 'Login failed.';
    if (msg === 'Invalid login credentials') {
      msg = 'Incorrect email or password.';
    } else if (msg.toLowerCase().includes('banned')) {
      msg = 'This account has been deleted and can no longer be accessed.';
    } else if (msg.toLowerCase().includes('email not confirmed')) {
      // Supabase returns this when confirm email is enabled
      showConfirmPanel(email);
      showWarning('Please confirm your email first. Check your inbox or resend below.');
      setBtnLoading('loginBtn','loginBtnIcon','loginBtnText',false,'fa-solid fa-arrow-right-to-bracket','Sign In','');
      return;
    }
    showError(msg);
    setBtnLoading('loginBtn','loginBtnIcon','loginBtnText',false,'fa-solid fa-arrow-right-to-bracket','Sign In','');
  }
}

// ── Signup ────────────────────────────────────────────────
async function doSignup() {
  clearAlerts();
  const name   = document.getElementById('signupName').value.trim();
  const email  = document.getElementById('signupEmail').value.trim();
  const pass   = document.getElementById('signupPassword').value;
  const rawRef = document.getElementById('signupRefCode').value.trim().toUpperCase();

  if (!name)                          { showError('Please enter your full name.'); return; }
  if (!email || !isValidEmail(email)) { showError('Please enter a valid email address.'); return; }
  if (pass.length < 8)                { showError('Password must be at least 8 characters.'); return; }

  if (rawRef && !_refValidated) {
    await validateRefCode();
    if (!_refValidated) {
      const proceed = confirm(`The referral code "${rawRef}" could not be verified. Continue without it?`);
      if (!proceed) return;
    }
  }

  setBtnLoading('signupBtn','signupBtnIcon','signupBtnText',true,'fa-solid fa-user-plus','Create Account — Free','Creating account…');

  try {
    const { data, error } = await db.auth.signUp({
      email,
      password: pass,
      options: { data: { name, plan: 'free' } },
    });
    if (error) throw error;

    // Store ref code for supabase-client.js SIGNED_IN handler
    const refToStore = _refValidated ? _refValidCode : (rawRef || '');
    if (refToStore) {
      localStorage.setItem('ref_code', refToStore);
      sessionStorage.setItem('ref_code', refToStore);
    }

    if (data.session) {
      // Email confirmation is disabled — user is auto signed in
      showSuccess('Account created! Redirecting…');
      setTimeout(() => window.location.href = '/dashboard', 900);
    } else {
      // Email confirmation required — show the confirm panel
      showConfirmPanel(email);
    }
  } catch (err) {
    let msg = err.message || 'Could not create account. Please try again.';
    // Handle "User already registered" gracefully
    if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already been registered')) {
      msg = 'An account with this email already exists. <a href="#" onclick="switchTab(\'login\');return false" style="color:inherit;font-weight:600;text-decoration:underline">Sign in instead?</a>';
      showWarning(msg);
      setBtnLoading('signupBtn','signupBtnIcon','signupBtnText',false,'fa-solid fa-user-plus','Create Account — Free','');
      return;
    }
    showError(msg);
    setBtnLoading('signupBtn','signupBtnIcon','signupBtnText',false,'fa-solid fa-user-plus','Create Account — Free','');
  }
}

// ── Resend confirmation email ─────────────────────────────
let _resendCooldown = false;
async function resendConfirmation() {
  if (_resendCooldown) return;
  const email = _pendingEmail || document.getElementById('loginEmail').value.trim();
  if (!email) {
    showError('Could not determine email address. Please go back and try again.');
    return;
  }

  const btn      = document.getElementById('resendBtn');
  const iconEl   = document.getElementById('resendBtnIcon');
  const textEl   = document.getElementById('resendBtnText');
  btn.disabled   = true;
  iconEl.outerHTML = `<div class="spin-ring-green" id="resendBtnIcon"></div>`;
  textEl.textContent = 'Sending…';

  try {
    const { error } = await db.auth.resend({ type: 'signup', email });
    if (error) throw error;

    document.getElementById('resendBtnIcon').outerHTML = `<i class="fa-solid fa-circle-check" id="resendBtnIcon"></i>`;
    textEl.textContent = 'Email sent! Check your inbox.';

    // Cooldown 60 seconds
    _resendCooldown = true;
    let secs = 60;
    const interval = setInterval(() => {
      secs--;
      textEl.textContent = `Resend again in ${secs}s`;
      if (secs <= 0) {
        clearInterval(interval);
        _resendCooldown = false;
        btn.disabled = false;
        document.getElementById('resendBtnIcon').outerHTML = `<i class="fa-solid fa-paper-plane" id="resendBtnIcon"></i>`;
        textEl.textContent = 'Resend Confirmation Email';
      }
    }, 1000);
  } catch (err) {
    document.getElementById('resendBtnIcon').outerHTML = `<i class="fa-solid fa-paper-plane" id="resendBtnIcon"></i>`;
    textEl.textContent = 'Resend Confirmation Email';
    btn.disabled = false;
    showError(err.message || 'Failed to resend. Try again.');
  }
}

// ── Forgot password ───────────────────────────────────────
async function showForgot(e) {
  e.preventDefault(); clearAlerts();
  const email = document.getElementById('loginEmail').value.trim();
  if (!email || !isValidEmail(email)) { showError('Enter your email address above first.'); return; }
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password',
  });
  if (error) showError(error.message);
  else showSuccess(`Password reset link sent to ${email}. Check your inbox.`);
}

// ── Enter key support ─────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (document.getElementById('confirmPanel').classList.contains('show')) return;
  const loginVisible = document.getElementById('loginPanel').style.display !== 'none';
  if (loginVisible) doLogin(); else doSignup();
});

// ── Pre-fill ref code field after DOM ready ───────────────
window.addEventListener('load', () => {
  const stored = localStorage.getItem('ref_code');
  const el     = document.getElementById('signupRefCode');
  if (el && stored && !el.value) {
    el.value = stored.toUpperCase();
    validateRefCode();
  }
});

// Inline onclick/oninput handlers in auth.html call these by global name.
window.switchTab = switchTab;
window.backToSignup = backToSignup;
window.togglePw = togglePw;
window.checkStrength = checkStrength;
window.clearAlerts = clearAlerts;
window.onRefCodeInput = onRefCodeInput;
window.validateRefCode = validateRefCode;
window.doGoogleAuth = doGoogleAuth;
window.doLogin = doLogin;
window.doSignup = doSignup;
window.resendConfirmation = resendConfirmation;
window.showForgot = showForgot;
