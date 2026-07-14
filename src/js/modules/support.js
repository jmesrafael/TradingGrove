// support.js - in-app support/feedback page.
// Inserts into public.support_messages (RLS: insert own + select own).
// Status changes ('read'/'resolved') are made by the local admin tool.

let supUser = null;

(async () => {
  supUser = await requireAuth();
  if (!supUser) return;
  const profile = await getProfile(supUser.id);
  applyProfileTheme(profile);
  if (window.TZ) TZ.hideLoader();
  wireCounters();
  loadHistory();
})();

function wireCounters() {
  const subject = document.getElementById('supSubject');
  const message = document.getElementById('supMessage');
  subject.addEventListener('input', () => {
    document.getElementById('subjectCount').textContent = `${subject.value.length} / 200`;
  });
  message.addEventListener('input', () => {
    document.getElementById('messageCount').textContent = `${message.value.length} / 5000`;
  });
}

async function sendSupportMessage() {
  const subjectEl = document.getElementById('supSubject');
  const messageEl = document.getElementById('supMessage');
  const btn = document.getElementById('supSendBtn');
  const msgEl = document.getElementById('supSendMsg');

  const subject = subjectEl.value.trim();
  const message = messageEl.value.trim();
  if (!subject) { showMsg(msgEl, 'Please add a subject.', true); return; }
  if (message.length < 10) { showMsg(msgEl, 'Please describe it in a bit more detail (at least 10 characters).', true); return; }

  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner" style="animation:spin 1s linear infinite"></i> Sending…';
  try {
    const { error } = await db.from('support_messages').insert({
      user_id: supUser.id,
      subject,
      message
    });
    if (error) throw error;
    subjectEl.value = ''; messageEl.value = '';
    document.getElementById('subjectCount').textContent = '0 / 200';
    document.getElementById('messageCount').textContent = '0 / 5000';
    showMsg(msgEl, 'Sent. Thank you, we read every message.', false);
    window.tgTrack?.('support_sent');
    loadHistory();
  } catch (e) {
    console.error('[support] send failed:', e);
    showMsg(msgEl, 'Could not send right now. Please try again in a moment.', true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

function showMsg(el, text, isError) {
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--accent2)';
  setTimeout(() => { el.textContent = ''; }, 5000);
}

async function loadHistory() {
  const wrap = document.getElementById('supHistory');
  try {
    const { data, error } = await db
      .from('support_messages')
      .select('id, subject, message, status, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    if (!data?.length) {
      wrap.innerHTML = '<div class="sup-empty">Nothing yet. Your sent messages will appear here with their status.</div>';
      return;
    }
    wrap.innerHTML = data.map(m => `
      <div class="sup-item">
        <div class="sup-item-top">
          <span class="sup-item-subject">${escapeHtml(m.subject)}</span>
          <span class="sup-status ${m.status}">${m.status}</span>
        </div>
        <div class="sup-item-body">${escapeHtml(m.message)}</div>
        <div class="sup-item-date" style="margin-top:8px">${new Date(m.created_at).toLocaleString()}</div>
      </div>`).join('');
  } catch (e) {
    console.error('[support] history failed:', e);
    wrap.innerHTML = '<div class="sup-empty">Could not load your previous messages.</div>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.sendSupportMessage = sendSupportMessage;
