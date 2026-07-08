// profile.js - profile page
// Loaded by /src/pages/profile.html. Depends on globals from supabase-client.js
// (db, requireAuth, getProfile, getReferrals, updateProfile, applyProfileTheme,
//  getSubscriptionStatus, buildReferralUrl, SUPABASE_URL, TZ).
let currentUser = null;
let currentProfile = null;

// ── Toggle password section ──────────────────────────────
let _passwordShown = false;
let _originalNameValue = '';
let _originalEmailValue = '';

function togglePasswordSection() {
  _passwordShown = !_passwordShown;
  const section = document.getElementById('passwordSection');
  const btn = document.getElementById('changePassBtn');
  section.classList.toggle('show', _passwordShown);
  if (_passwordShown) {
    btn.textContent = '';
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Hide Password';
    setTimeout(() => document.getElementById('fieldPass').focus(), 100);
  } else {
    btn.textContent = '';
    btn.innerHTML = '<i class="fa-solid fa-lock"></i> Change Password';
  }
}

function cancelPasswordChange() {
  _passwordShown = false;
  document.getElementById('passwordSection').classList.remove('show');
  document.getElementById('fieldPass').value = '';
  document.getElementById('fieldPassConfirm').value = '';
  document.getElementById('savePassMsg').classList.remove('show');
  document.getElementById('changePassBtn').innerHTML = '<i class="fa-solid fa-lock"></i> Change Password';
}

// ── Save button visibility ───────────────────────────────
function updateSaveButtons() {
  const nameVal = document.getElementById('fieldName').value.trim();
  const nameChanged = nameVal !== _originalNameValue;
  document.getElementById('saveNameBtn').classList.toggle('hidden', !nameChanged);

  const emailVal = document.getElementById('fieldEmail').value.trim();
  const emailChanged = emailVal !== _originalEmailValue;
  document.getElementById('saveEmailBtn').classList.toggle('hidden', !emailChanged);
}

// ── Boot ─────────────────────────────────────────────────
(async () => {
  currentUser = await requireAuth();
  if (!currentUser) return;

  currentProfile = await getProfile(currentUser.id);

  // ── Apply saved theme/font (persisted per user)
  applyProfileTheme(currentProfile);

  const isPro = currentProfile?.plan === 'pro';

  // ── Profile hero
  const initials = (currentProfile?.name || currentUser.email || '?')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('avatarEl').textContent = initials;
  document.getElementById('heroName').textContent = currentProfile?.name || '(No name set)';
  document.getElementById('heroEmail').textContent = currentUser.email;

  // ── Get actual referral count from database
  let actualReferralCount = 0;
  try {
    const refs = await getReferrals(currentUser.id);
    actualReferralCount = refs.length;
  } catch (e) {
    console.warn('[profile] Failed to load referral count:', e);
  }

  const heroBadges = document.getElementById('heroBadges');
  heroBadges.innerHTML = `
    <span class="plan-badge ${isPro ? 'badge-pro' : 'badge-free'}">${isPro ? 'Pro' : 'Free'}</span>
    ${actualReferralCount > 0
      ? `<span class="badge-referral"><i class="fa-solid fa-gift"></i> ${actualReferralCount} referral${actualReferralCount > 1 ? 's' : ''}</span>`
      : ''}
  `;

  // ── Form fields
  const nameValue = currentProfile?.name || '';
  const emailValue = currentUser.email || '';
  document.getElementById('fieldName').value  = nameValue;
  document.getElementById('fieldEmail').value = emailValue;

  // Store original values for change detection
  _originalNameValue = nameValue;
  _originalEmailValue = emailValue;

  // Add change listeners
  document.getElementById('fieldName').addEventListener('input', updateSaveButtons);

  // Initial button states
  updateSaveButtons();

  // ── Subscription card
  populateSubscription(currentProfile, isPro);

  // ── Referral card
  populateReferral(currentProfile);
  await loadReferrals();

  if (window.TZ) TZ.hideLoader();
})();

// ── Subscription ─────────────────────────────────────────
function populateSubscription(profile, isPro) {
  const planEl     = document.getElementById('subPlan');
  const cycleEl    = document.getElementById('subCycle');
  const statusEl   = document.getElementById('subStatus');
  const expiryEl   = document.getElementById('subExpiry');
  const expiryRow  = document.getElementById('subExpiryRow');
  const upgradeBtn = document.getElementById('upgradeBtn');
  const barWrap    = document.getElementById('expiryBarWrap');

  const subStatus = getSubscriptionStatus(profile);
  const planType  = profile?.plan_type || 'none';

  if (isPro) {
    planEl.textContent   = 'Pro';
    planEl.className     = 'sub-val pro';

    // Billing cycle
    const cycleMap = { monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime', none: '—' };
    cycleEl.textContent = cycleMap[planType] || '—';
    cycleEl.className   = 'sub-val pro';

    if (subStatus.expired) {
      statusEl.textContent = 'Expired';
      statusEl.className   = 'sub-val expired';
      upgradeBtn.style.display = 'inline-flex';
    } else {
      statusEl.textContent = 'Active ✓';
      statusEl.className   = 'sub-val pro';
    }

    if (profile?.subscription_expires_at || profile?.pro_expires_at) {
      expiryEl.textContent = subStatus.label;
      expiryEl.className   = 'sub-val ' + (subStatus.expired ? 'expired' : subStatus.expiring ? 'expiring' : 'pro');
      expiryRow.style.display = 'flex';

      // Progress bar: show for non-lifetime plans
      if (planType !== 'lifetime') {
        const totalDays = planType === 'yearly' ? 365 : planType === 'monthly' ? 30 : (subStatus.daysLeft > 60 ? 365 : 30);
        const daysLeft  = subStatus.daysLeft ?? 0;
        const pct       = Math.max(0, Math.min(100, (daysLeft / totalDays) * 100));
        const fillColor = subStatus.expired ? 'var(--red)' : subStatus.expiring ? '#fbbf24' : 'var(--accent2)';

        document.getElementById('expiryBarFill').style.width      = pct + '%';
        document.getElementById('expiryBarFill').style.background = fillColor;
        document.getElementById('expiryBarLeft').textContent  = daysLeft + ' days remaining';
        document.getElementById('expiryBarRight').textContent = totalDays + ' day cycle';
        barWrap.style.display = 'block';
      }
    } else {
      expiryEl.textContent    = 'Active subscription';
      expiryEl.className      = 'sub-val pro';
      expiryRow.style.display = 'flex';
    }
  } else {
    planEl.textContent      = 'Free';
    planEl.className        = 'sub-val free';
    cycleEl.textContent     = '—';
    cycleEl.className       = 'sub-val free';
    statusEl.textContent    = 'Free tier';
    statusEl.className      = 'sub-val free';
    expiryRow.style.display = 'none';
    upgradeBtn.style.display = 'inline-flex';
  }
}

// ── Referral ─────────────────────────────────────────────
function populateReferral(profile) {
  const code = profile?.referral_code || '—';
  document.getElementById('refCodeDisplay').textContent = code;
  const url = buildReferralUrl(code);
  document.getElementById('shareUrlDisplay').textContent = url;
}

async function loadReferrals() {
  const referrals = await getReferrals(currentUser.id);
  const total     = referrals.length;
  const rewarded  = referrals.filter(r => r.reward_granted).length;
  const pending   = referrals.filter(r => !r.reward_granted).length;

  document.getElementById('statTotal').textContent    = total;
  document.getElementById('statRewarded').textContent = rewarded;
  document.getElementById('statPending').textContent  = pending;

  const wrap = document.getElementById('refHistoryWrap');

  if (!referrals.length) {
    wrap.innerHTML = `<div class="empty-ref">
      <i class="fa-solid fa-user-group"></i>
      No referrals yet. Share your link to start earning free Pro!
    </div>`;
    // No referrals = no rewards, bail early
    return;
  }

  wrap.innerHTML = `
    <table class="ref-table">
      <thead><tr><th>User</th><th>Date Joined</th><th>Status</th><th>Reward</th></tr></thead>
      <tbody>
        ${referrals.map(r => {
          const date = fmtDate(r.created_at);
          const name = r.referred_profile?.name || 'Anonymous';
          let statusClass = 'status-pending', statusLabel = 'Pending';
          if (r.status === 'rewarded')   { statusClass = 'status-rewarded';  statusLabel = 'Rewarded'; }
          if (r.status === 'converted')  { statusClass = 'status-converted'; statusLabel = 'Subscribed'; }
          return `<tr>
            <td style="font-weight:500">${name}</td>
            <td>${date}</td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td style="color:${r.reward_granted ? 'var(--accent2)' : 'var(--muted)'}">
              ${r.reward_granted
                ? '<i class="fa-solid fa-circle-check" style="margin-right:5px"></i>+30 days Pro'
                : '<i class="fa-solid fa-clock" style="margin-right:5px;opacity:.5"></i>Waiting'}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  // ── Check for newly rewarded referrals and fire celebration modal
  checkAndShowRewardModal(referrals);
}

// ── Copy helpers ─────────────────────────────────────────
function copyCode() {
  const code = document.getElementById('refCodeDisplay').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('copyCodeBtn');
    btn.classList.add('copied');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy Code'; }, 2000);
  });
}
function copyShareUrl() {
  const url = document.getElementById('shareUrlDisplay').textContent;
  navigator.clipboard.writeText(url).then(() => showToast('Share link copied!', 'fa-solid fa-link', 'green'));
}

// ── Save name ─────────────────────────────────────────────
async function saveName() {
  const name = document.getElementById('fieldName').value.trim();
  if (!name) { showSaveMsg('saveNameMsg', 'Enter a name.', 'err'); return; }
  const btn = document.getElementById('saveNameBtn');
  btn.disabled = true;
  try {
    await updateProfile(currentUser.id, { name });
    await db.auth.updateUser({ data: { name } });
    document.getElementById('heroName').textContent = name;
    document.getElementById('avatarEl').textContent = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    _originalNameValue = name;
    updateSaveButtons();
    showSaveMsg('saveNameMsg', 'Saved!', 'ok');
    showToast('Name updated!', 'fa-solid fa-circle-check', 'green');
  } catch (e) {
    showSaveMsg('saveNameMsg', e.message || 'Error saving.', 'err');
  } finally { btn.disabled = false; }
}

// ── Save email ────────────────────────────────────────────
async function saveEmail() {
  const email = document.getElementById('fieldEmail').value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showSaveMsg('saveEmailMsg', 'Enter a valid email.', 'err'); return; }
  const btn = document.getElementById('saveEmailBtn');
  btn.disabled = true;
  try {
    const { error } = await db.auth.updateUser({ email });
    if (error) throw error;
    showSaveMsg('saveEmailMsg', 'Check inbox to confirm.', 'ok');
    showToast('Confirmation email sent!', 'fa-solid fa-envelope', 'green');
  } catch (e) {
    showSaveMsg('saveEmailMsg', e.message || 'Error.', 'err');
  } finally { btn.disabled = false; }
}

// ── Save password ─────────────────────────────────────────
async function savePassword() {
  const pass  = document.getElementById('fieldPass').value;
  const passC = document.getElementById('fieldPassConfirm').value;
  if (!pass)         { showSaveMsg('savePassMsg', 'Enter a password.', 'err'); return; }
  if (pass.length<8) { showSaveMsg('savePassMsg', 'Min 8 characters.', 'err'); return; }
  if (pass !== passC){ showSaveMsg('savePassMsg', 'Passwords do not match.', 'err'); return; }
  const btn = document.getElementById('savePassBtn');
  btn.disabled = true;
  try {
    const { error } = await db.auth.updateUser({ password: pass });
    if (error) throw error;
    document.getElementById('fieldPass').value = '';
    document.getElementById('fieldPassConfirm').value = '';
    showSaveMsg('savePassMsg', 'Password updated!', 'ok');
    showToast('Password updated!', 'fa-solid fa-circle-check', 'green');
    setTimeout(() => { cancelPasswordChange(); }, 1500);
  } catch (e) {
    showSaveMsg('savePassMsg', e.message || 'Error.', 'err');
  } finally { btn.disabled = false; }
}

function showSaveMsg(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'save-msg show ' + type;
  setTimeout(() => el.classList.remove('show'), 3000);
}

function toggleEye(id, btn) {
  const inp  = document.getElementById(id);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.querySelector('i').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
}

// ── Delete Account ────────────────────────────────────────
function openDelAccount() {
  document.getElementById('delAccInputProfile').value = '';
  document.getElementById('delAccFormProfile').style.display = 'block';
  document.getElementById('delAccProgressProfile').style.display = 'none';
  checkDelAccProfile();
  document.getElementById('delAccountOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('delAccInputProfile').focus(), 150);
}
function closeDelAccount() { document.getElementById('delAccountOverlay').style.display = 'none'; }
function checkDelAccProfile() {
  const ok  = document.getElementById('delAccInputProfile').value.trim() === 'DELETE';
  const btn = document.getElementById('delAccBtnProfile');
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '.4';
  btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
}
async function executeDeleteAccount() {
  document.getElementById('delAccFormProfile').style.display = 'none';
  document.getElementById('delAccProgressProfile').style.display = 'block';
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const res  = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Deletion failed');
    document.getElementById('delAccMsgProfile').textContent = 'Account deleted. Redirecting…';
    await db.auth.signOut();
    sessionStorage.clear(); localStorage.clear();
    setTimeout(() => location.href = '/', 1500);
  } catch (e) {
    showToast('Failed: ' + e.message, 'fa-solid fa-circle-exclamation', 'red');
    document.getElementById('delAccFormProfile').style.display = 'block';
    document.getElementById('delAccProgressProfile').style.display = 'none';
  }
}

async function logout() { await db.auth.signOut(); sessionStorage.clear(); location.href = '/auth'; }

// ── Toast ─────────────────────────────────────────────────
let _tt;
function showToast(msg, icon = 'fa-solid fa-circle-check', type = '') {
  const t = document.getElementById('toast');
  document.getElementById('toastIcon').className = icon;
  document.getElementById('toastMsg').textContent = msg;
  t.className = 'show' + (type === 'green' ? ' toast-green' : type === 'red' ? ' toast-red' : '');
  clearTimeout(_tt);
  _tt = setTimeout(() => { t.classList.remove('show', 'toast-green', 'toast-red'); }, 3400);
}

// ══════════════════════════════════════════════════════════════
//  REFERRAL REWARD CELEBRATION MODAL
//  - Fires once per newly rewarded referral (tracked in localStorage)
//  - Called automatically at the end of loadReferrals()
// ══════════════════════════════════════════════════════════════

const REWARD_SEEN_KEY = 'tz_reward_seen_ids';

function _getSeenRewardIds() {
  try { return new Set(JSON.parse(localStorage.getItem(REWARD_SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}

function _markRewardIdsSeen(ids) {
  const seen = _getSeenRewardIds();
  ids.forEach(id => seen.add(id));
  localStorage.setItem(REWARD_SEEN_KEY, JSON.stringify([...seen]));
}

function checkAndShowRewardModal(referrals) {
  if (!referrals || !referrals.length) return;

  const seen = _getSeenRewardIds();

  // Find referrals that are rewarded (reward_granted=true) and not yet seen
  const newlyRewarded = referrals.filter(r =>
    r.reward_granted === true && r.id && !seen.has(String(r.id))
  );

  if (!newlyRewarded.length) return;

  // Mark all newly rewarded as seen immediately — prevents duplicate shows
  _markRewardIdsSeen(newlyRewarded.map(r => String(r.id)));

  // Populate the stat cells
  const totalRewarded = referrals.filter(r => r.reward_granted).length;
  document.getElementById('rewardTotalReferrals').textContent = referrals.length;
  document.getElementById('rewardDaysEarned').textContent = (totalRewarded * 30) + 'd';

  // Short delay so the page finishes rendering before the modal pops
  setTimeout(() => _openRewardModal(), 750);
}

function _openRewardModal() {
  document.getElementById('rewardOverlay').classList.add('open');
  _launchRewardConfetti();
  _spawnRewardParticles();
}

// ── Floating ✨ particles ─────────────────────────────────
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

function closeRewardModal() {
  const overlay = document.getElementById('rewardOverlay');
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity .25s';
  setTimeout(() => {
    overlay.classList.remove('open');
    overlay.style.opacity = '';
    overlay.style.transition = '';
  }, 260);
}

// Close on backdrop click
document.getElementById('rewardOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeRewardModal();
});

// ── Canvas confetti burst ─────────────────────────────────
function _launchRewardConfetti() {
  const canvas = document.getElementById('rewardConfettiCanvas');
  const ctx = canvas.getContext('2d');
  const card = document.getElementById('rewardCard');
  const W = card.offsetWidth || 420;
  const H = card.offsetHeight || 520;
  canvas.width = W;
  canvas.height = H;

  // Resolve a CSS color variable to a real rgba string for canvas use
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

// Inline onclick/oninput handlers in profile.html call these by global name.
window.togglePasswordSection = togglePasswordSection;
window.cancelPasswordChange = cancelPasswordChange;
window.saveName = saveName;
window.saveEmail = saveEmail;
window.savePassword = savePassword;
window.toggleEye = toggleEye;
window.copyCode = copyCode;
window.copyShareUrl = copyShareUrl;
window.openDelAccount = openDelAccount;
window.closeDelAccount = closeDelAccount;
window.checkDelAccProfile = checkDelAccProfile;
window.executeDeleteAccount = executeDeleteAccount;
window.logout = logout;
window.closeRewardModal = closeRewardModal;