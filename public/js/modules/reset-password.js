// reset-password.js — password reset page
// Loaded by /src/pages/reset-password.html. Depends on `db` global from supabase-client.js.

function showState(id) {
  document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── On load: check if this is a valid reset link ──────────
(async () => {
  // Supabase embeds the token in the URL hash or as params
  // When user clicks the email link, Supabase handles the session automatically
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);

  // Give Supabase a moment to process the hash token
  await new Promise(r => setTimeout(r, 500));

  const { data: { session } } = await db.auth.getSession();

  // Check for PASSWORD_RECOVERY event or active session from reset link
  if (session || hash.includes('access_token') || params.get('type') === 'recovery') {
    showState('stateForm');
  } else {
    showState('stateInvalid');
  }
})();

// Listen for recovery event
db.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    showState('stateForm');
  }
});

// ── Password strength ─────────────────────────────────────
function checkPw(val) {
  const bar  = document.getElementById('pwBar');
  const reqLen   = document.getElementById('req-len');
  const reqUpper = document.getElementById('req-upper');
  const reqNum   = document.getElementById('req-num');

  const hasLen   = val.length >= 8;
  const hasUpper = /[A-Z]/.test(val);
  const hasNum   = /[0-9]/.test(val);

  reqLen.classList.toggle('met', hasLen);
  reqLen.querySelector('i').className = hasLen ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle';
  reqUpper.classList.toggle('met', hasUpper);
  reqUpper.querySelector('i').className = hasUpper ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle';
  reqNum.classList.toggle('met', hasNum);
  reqNum.querySelector('i').className = hasNum ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle';

  let strength = 0;
  if (hasLen) strength++;
  if (val.length >= 12) strength++;
  if (hasUpper) strength++;
  if (hasNum) strength++;
  if (/[^A-Za-z0-9]/.test(val)) strength++;

  const levels = [
    { w:'20%', bg:'#ff5f6d' },
    { w:'40%', bg:'#f59e0b' },
    { w:'60%', bg:'#f59e0b' },
    { w:'80%', bg:'var(--accent2)' },
    { w:'100%',bg:'var(--accent)' },
  ];
  const lvl = levels[Math.min(strength, 4)];
  bar.style.width = lvl.w;
  bar.style.background = lvl.bg;

  checkMatch();
  updateSubmitBtn();
}

function checkMatch() {
  const pw1 = document.getElementById('pw1').value;
  const pw2 = document.getElementById('pw2').value;
  const hint = document.getElementById('matchHint');
  if (!pw2) { hint.textContent = ''; return; }
  if (pw1 === pw2) {
    hint.style.color = 'var(--accent2)';
    hint.textContent = '✓ Passwords match';
  } else {
    hint.style.color = 'var(--red)';
    hint.textContent = '✗ Passwords do not match';
  }
  updateSubmitBtn();
}

function updateSubmitBtn() {
  const pw1 = document.getElementById('pw1').value;
  const pw2 = document.getElementById('pw2').value;
  const valid = pw1.length >= 8 && pw1 === pw2;
  document.getElementById('submitBtn').disabled = !valid;
}

function togglePw(id, btn) {
  const inp = document.getElementById(id);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.querySelector('i').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
}

// ── Submit ────────────────────────────────────────────────
async function doReset() {
  const pw1 = document.getElementById('pw1').value;
  const pw2 = document.getElementById('pw2').value;
  const errAlert = document.getElementById('alertErr');

  errAlert.classList.remove('show');

  if (pw1 !== pw2) {
    document.getElementById('alertErrMsg').textContent = 'Passwords do not match.';
    errAlert.classList.add('show');
    return;
  }
  if (pw1.length < 8) {
    document.getElementById('alertErrMsg').textContent = 'Password must be at least 8 characters.';
    errAlert.classList.add('show');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  document.getElementById('submitIcon').outerHTML = '<div class="spin-ring" id="submitIcon"></div>';
  document.getElementById('submitText').textContent = 'Updating password…';

  try {
    const { error } = await db.auth.updateUser({ password: pw1 });
    if (error) throw error;
    showState('stateSuccess');
    // Sign out so user signs in fresh
    setTimeout(() => db.auth.signOut(), 2000);
  } catch(err) {
    document.getElementById('alertErrMsg').textContent = err.message || 'Failed to update password. Try requesting a new reset link.';
    errAlert.classList.add('show');
    const icon = document.getElementById('submitIcon');
    if (icon) icon.outerHTML = '<i class="fa-solid fa-key" id="submitIcon"></i>';
    document.getElementById('submitText').textContent = 'Set New Password';
    btn.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !document.getElementById('submitBtn').disabled) doReset();
});

// Exposed on window because inline oninput/onclick handlers in reset-password.html call them.
window.checkPw = checkPw;
window.checkMatch = checkMatch;
window.togglePw = togglePw;
window.doReset = doReset;
