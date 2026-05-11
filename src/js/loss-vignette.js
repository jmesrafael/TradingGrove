// loss-vignette.js — self-contained loss limit vignette component
// Drop one <script src="/js/loss-vignette.js"></script> in any iframe page.
// Responds to postMessages: TG_LOSS_LIMIT_HIT | TG_LOSS_LIMIT_CLEAR
//
// Gradient is static — only `opacity` animates (GPU-composited, always smooth).
// Badge is a sibling element so its opacity is independent of the vignette fade.
(function () {
  var STYLE = [
    // Vignette layer — static gradient, opacity-only animation
    '#tg-loss-vignette{',
      'position:fixed;inset:0;z-index:99998;pointer-events:none;',
      'background:radial-gradient(ellipse at center,',
        'transparent 52%,',
        'rgba(140,0,0,.18) 74%,',
        'rgba(100,0,0,.42) 100%',
      ');',
      'border:1.5px solid rgba(180,30,30,.22);',
      'box-shadow:inset 0 0 50px rgba(130,0,0,.18);',
      'opacity:0;',
      'animation:tlv-fade 3.5s ease-in-out infinite alternate;',
      'will-change:opacity;',
    '}',

    // Only opacity changes — browsers compositor-thread this, zero jank
    '@keyframes tlv-fade{',
      'from{opacity:.15}',
      'to  {opacity:.80}',
    '}',

    // Badge — separate sibling, always fully visible, pulsing red glow
    '#tg-loss-badge{',
      'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);',
      'z-index:99999;pointer-events:none;',
      'background:rgba(14,2,2,.88);',
      'border:1px solid rgba(170,38,38,.35);',
      'border-radius:10px;padding:8px 16px;',
      'display:flex;align-items:center;gap:9px;',
      'backdrop-filter:blur(12px);white-space:nowrap;',
      'opacity:0;',
      // fade-in first, then glow starts (delay matches fade-in duration)
      'animation:tlv-badge-in .45s ease forwards, tlv-glow 3.5s ease-in-out .45s infinite alternate;',
      'will-change:box-shadow,border-color,opacity;',
    '}',
    '@keyframes tlv-badge-in{',
      'from{opacity:0;transform:translateX(-50%) translateY(6px)}',
      'to  {opacity:1;transform:translateX(-50%) translateY(0)}',
    '}',
    // Only box-shadow + border-color animate — both are smooth on modern GPUs
    '@keyframes tlv-glow{',
      'from{',
        'box-shadow:0 0 8px rgba(140,0,0,.22),0 0 18px rgba(110,0,0,.10),0 4px 18px rgba(0,0,0,.45);',
        'border-color:rgba(150,32,32,.28);',
      '}',
      'to{',
        'box-shadow:0 0 22px rgba(210,0,0,.55),0 0 44px rgba(170,0,0,.28),0 4px 22px rgba(0,0,0,.55);',
        'border-color:rgba(210,52,52,.52);',
      '}',
    '}',

    '.tlv-icon{color:#aa3030;font-size:13px}',
    '.tlv-title{font-size:11px;font-weight:700;color:#b03535;letter-spacing:.07em;text-transform:uppercase}',
    '.tlv-sub{font-size:10px;color:#8a4f4f;margin-top:1px}',
  ].join('');

  var styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'TG_LOSS_LIMIT_HIT') showLossVignette(e.data);
    if (e.data && e.data.type === 'TG_LOSS_LIMIT_CLEAR') clearLossVignette();
  });

  function showLossVignette(data) {
    if (document.getElementById('tg-loss-vignette')) return;

    var parts = [];
    // Dual-threshold format
    if (data.limitLosses > 0 && data.currentLosses >= data.limitLosses)
      parts.push(data.currentLosses + ' loss' + (data.currentLosses !== 1 ? 'es' : '') + ' today');
    if (data.limitUsd > 0 && data.currentUsd >= data.limitUsd)
      parts.push('$' + parseFloat(data.currentUsd || 0).toFixed(2) + ' lost today');
    // Legacy single-type fallback
    if (!parts.length && data.limitType) {
      parts.push(data.limitType === 'losses'
        ? data.current + ' loss' + (data.current !== 1 ? 'es' : '') + ' today'
        : '$' + parseFloat(data.current || 0).toFixed(2) + ' lost today');
    }
    if (!parts.length) parts.push('Limit reached today');
    var sub = parts.join(' · ');

    // Vignette layer (gradient + fade animation)
    var v = document.createElement('div');
    v.id = 'tg-loss-vignette';
    document.body.appendChild(v);

    // Badge — sibling so it stays fully opaque while vignette breathes
    var b = document.createElement('div');
    b.id = 'tg-loss-badge';
    b.innerHTML =
      '<i class="fa-solid fa-triangle-exclamation tlv-icon"></i>' +
      '<div>' +
        '<div class="tlv-title">Loss Limit Reached</div>' +
        '<div class="tlv-sub">' + sub + '</div>' +
      '</div>';
    document.body.appendChild(b);
  }

  function clearLossVignette() {
    var v = document.getElementById('tg-loss-vignette');
    var b = document.getElementById('tg-loss-badge');
    if (v) v.remove();
    if (b) b.remove();
  }

  window.showLossVignette = showLossVignette;
  window.clearLossVignette = clearLossVignette;
})();
