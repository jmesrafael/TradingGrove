/**
 * theme.js — TradingGrove Design System v3.1
 * ─────────────────────────────────────────────────────────────
 * v3.1 changes:
 *   - TZ.setTheme / TZ.setFont now sync to Supabase in background
 *   - Uses saveThemeToProfile() from supabase.js (loaded before theme.js on inner pages)
 *   - On auth pages theme.js loads without supabase.js — no-op for DB sync
 */

window.TZ = window.TZ || {};

// ══════════════════════════════════════════════════════════════
//  1. COLOR TOKENS
// ══════════════════════════════════════════════════════════════
TZ.tokens = {

  dark: {
    '--bg':      '#0b0f0c',
    '--panel':   '#111816',
    '--panel2':  '#161d1a',
    '--accent':  '#00ff88',
    '--accent2': '#19c37d',
    '--border':  '#1c2a25',
    '--border2': '#243530',
    '--text':    '#e6f2ec',
    '--muted':   '#8fa39a',
    '--muted2':  '#5c7068',
    '--red':     '#ff5f6d',
    '--amber':   '#f59e0b',
    '--blue':    '#60a5fa',
  },

  light: {
    '--bg':      '#eef3f0',
    '--panel':   '#ffffff',
    '--panel2':  '#e8f0ec',
    '--accent':  '#19c37d',
    '--accent2': '#0a9460',
    '--border':  '#c4d4cc',
    '--border2': '#b5c8bf',
    '--text':    '#0a1812',
    '--muted':   '#2e5044',
    '--muted2':  '#4a7065',
    '--red':     '#dc2626',
    '--amber':   '#b45309',
    '--blue':    '#1d4ed8',
  },

  'blue-electric': {
    '--bg':      '#060d18',
    '--panel':   '#0a1628',
    '--panel2':  '#0d1e35',
    '--accent':  '#00e5ff',
    '--accent2': '#0ea5e9',
    '--border':  '#0f2a45',
    '--border2': '#163860',
    '--text':    '#e0f2fe',
    '--muted':   '#7ab3d4',
    '--muted2':  '#3d6e8c',
    '--red':     '#ff4d6a',
    '--amber':   '#fbbf24',
    '--blue':    '#38bdf8',
  },

  golden: {
    '--bg':      '#0e0c09',
    '--panel':   '#16120c',
    '--panel2':  '#1e1910',
    '--accent':  '#f5c842',
    '--accent2': '#d4a017',
    '--border':  '#2e2412',
    '--border2': '#3d3018',
    '--text':    '#f5ead8',
    '--muted':   '#a08c6a',
    '--muted2':  '#6b5c3e',
    '--red':     '#e05c5c',
    '--amber':   '#f59e0b',
    '--blue':    '#7eb8d4',
  },

  void: {
    '--bg':      '#000000',
    '--panel':   '#0d0d0d',
    '--panel2':  '#141414',
    '--accent':  '#ffffff',
    '--accent2': '#b0b0b0',
    '--border':  '#2a2a2a',
    '--border2': '#3a3a3a',
    '--text':    '#f0f0f0',
    '--muted':   '#777777',
    '--muted2':  '#444444',
    '--red':     '#ff4444',
    '--amber':   '#ccaa00',
    '--blue':    '#88aaff',
  },
};

// ══════════════════════════════════════════════════════════════
//  2. THEME METADATA
// ══════════════════════════════════════════════════════════════
TZ.themeList = [
  { id: 'system',         label: 'System',       desc: 'Follows your OS setting',   icon: 'fa-solid fa-circle-half-stroke', pro: false, swatches: ['#111111', '#1a1a1a', '#aaaaaa'] },
  { id: 'dark',           label: 'Dark',         desc: 'Deep green-tinted dark',    icon: 'fa-solid fa-moon',               pro: false, swatches: ['#0b0f0c', '#111816', '#00ff88'] },
  { id: 'light',          label: 'Light',        desc: 'Clean light mode',          icon: 'fa-solid fa-sun',                pro: false, swatches: ['#eef3f0', '#ffffff', '#19c37d'] },
  { id: 'blue-electric',  label: 'Electric',     desc: 'Deep navy · neon cyan',     icon: 'fa-solid fa-bolt',               pro: true,  swatches: ['#060d18', '#0a1628', '#00e5ff'] },
  { id: 'golden',         label: 'Golden Hour',  desc: 'Warm dark · rich gold',     icon: 'fa-solid fa-crown',              pro: true,  swatches: ['#0e0c09', '#16120c', '#f5c842'] },
  { id: 'void',           label: 'Void',         desc: 'Pure black · crisp white',  icon: 'fa-solid fa-circle',             pro: true,  swatches: ['#000000', '#0d0d0d', '#f0f0f0'] },
];

// ══════════════════════════════════════════════════════════════
//  3. FONT PAIRINGS
// ══════════════════════════════════════════════════════════════
TZ.fontList = [
  {
    id: 'default', label: 'Default', desc: 'Space Grotesk + Inter', pro: false,
    heading: "'Space Grotesk', sans-serif", body: "'Inter', sans-serif", mono: "'Space Grotesk', sans-serif",
    url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500&display=swap',
    preview: { heading: 'Space Grotesk', body: 'Inter' },
  },
  {
    id: 'terminal', label: 'Terminal', desc: 'IBM Plex Mono + IBM Plex Sans', pro: true,
    heading: "'IBM Plex Mono', monospace", body: "'IBM Plex Sans', sans-serif", mono: "'IBM Plex Mono', monospace",
    url: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500&display=swap',
    preview: { heading: 'IBM Plex Mono', body: 'IBM Plex Sans' },
  },
  {
    id: 'geist', label: 'Geist', desc: 'Geist Mono + Geist', pro: true,
    heading: "'Geist Mono', monospace", body: "'Geist', sans-serif", mono: "'Geist Mono', monospace",
    url: 'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@400;500&display=swap',
    preview: { heading: 'Geist Mono', body: 'Geist' },
  },
  {
    id: 'jetbrains', label: 'JetBrains', desc: 'JetBrains Mono + DM Sans', pro: true,
    heading: "'JetBrains Mono', monospace", body: "'DM Sans', sans-serif", mono: "'JetBrains Mono', monospace",
    url: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=DM+Sans:wght@400;500&display=swap',
    preview: { heading: 'JetBrains Mono', body: 'DM Sans' },
  },
  {
    id: 'outfit', label: 'Outfit', desc: 'Clean geometric sans', pro: true,
    heading: "'Outfit', sans-serif", body: "'Outfit', sans-serif", mono: "'Outfit', sans-serif",
    url: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap',
    preview: { heading: 'Outfit Bold', body: 'Outfit Regular' },
  },
];

// ══════════════════════════════════════════════════════════════
//  4. SHAPE + MOTION TOKENS
// ══════════════════════════════════════════════════════════════
TZ.shape = {
  radius:  { '--radius-sm': '6px', '--radius-md': '8px', '--radius-lg': '10px', '--radius-xl': '12px', '--radius-pill': '20px' },
  spacing: { '--sp-xs': '4px', '--sp-sm': '8px', '--sp-md': '12px', '--sp-lg': '18px', '--sp-xl': '24px' },
};

TZ.motion = {
  '--transition-fast':   '0.12s ease',
  '--transition-base':   '0.20s ease',
  '--transition-slow':   '0.35s ease',
  '--transition-spring': '0.25s cubic-bezier(.34,1.56,.64,1)',
};

// ══════════════════════════════════════════════════════════════
//  5. HELPERS
// ══════════════════════════════════════════════════════════════
TZ._hexToRgb = function(hex) {
  const h    = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return `${parseInt(full.slice(0,2),16)},${parseInt(full.slice(2,4),16)},${parseInt(full.slice(4,6),16)}`;
};

TZ._injectedFontUrls = new Set();
TZ._injectFont = function(url) {
  if (!url || TZ._injectedFontUrls.has(url)) return;
  TZ._injectedFontUrls.add(url);
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
};

// ══════════════════════════════════════════════════════════════
//  6. FONT ENGINE
// ══════════════════════════════════════════════════════════════
TZ.applyFont = function(fontId) {
  const id   = fontId || localStorage.getItem('tl_font') || 'default';
  const meta = TZ.fontList.find(f => f.id === id) || TZ.fontList[0];
  const root = document.documentElement;
  if (meta.url) TZ._injectFont(meta.url);
  root.style.setProperty('--font-heading', meta.heading);
  root.style.setProperty('--font-body',    meta.body);
  root.style.setProperty('--font-mono',    meta.mono);
  if (document.body) document.body.style.fontFamily = meta.body;
  TZ.currentFont = id;
};

/**
 * setFont: update localStorage + DOM + DB (background)
 */
TZ.setFont = function(fontId) {
  localStorage.setItem('tl_font', fontId);
  TZ.applyFont(fontId);

  // Sync to DB if supabase.js saveThemeToProfile is available
  if (typeof saveThemeToProfile === 'function') {
    const currentTheme = localStorage.getItem('tl_theme') || 'dark';
    saveThemeToProfile(currentTheme, fontId);
  }

  document.querySelectorAll('iframe').forEach(f => {
    try { f.contentWindow.postMessage({ type: 'tz_font', font: fontId }, '*'); } catch(e) {}
  });
};

// ══════════════════════════════════════════════════════════════
//  7. THEME ENGINE
// ══════════════════════════════════════════════════════════════
TZ._resolveTokens = function(mode) {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme:light)').matches
      ? TZ.tokens.light : TZ.tokens.dark;
  }
  return TZ.tokens[mode] || TZ.tokens.dark;
};

TZ.applyTheme = function(mode) {
  const pref   = mode || localStorage.getItem('tl_theme') || 'dark';
  const tokens = TZ._resolveTokens(pref);
  const root   = document.documentElement;

  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));

  if (tokens['--accent'])  root.style.setProperty('--accent-rgb',  TZ._hexToRgb(tokens['--accent']));
  if (tokens['--accent2']) root.style.setProperty('--accent2-rgb', TZ._hexToRgb(tokens['--accent2']));
  if (tokens['--red'])     root.style.setProperty('--red-rgb',     TZ._hexToRgb(tokens['--red']));
  if (tokens['--blue'])    root.style.setProperty('--blue-rgb',    TZ._hexToRgb(tokens['--blue']));

  Object.entries(TZ.shape.radius).forEach(([k, v])  => root.style.setProperty(k, v));
  Object.entries(TZ.shape.spacing).forEach(([k, v]) => root.style.setProperty(k, v));
  Object.entries(TZ.motion).forEach(([k, v])        => root.style.setProperty(k, v));

  root.dataset.theme   = pref === 'light' ? 'light' : 'dark';
  root.dataset.variant = pref;

  TZ.currentTheme = pref;
  TZ.accent  = tokens['--accent'];
  TZ.accent2 = tokens['--accent2'];
  TZ.muted   = tokens['--muted'];
  TZ.border  = tokens['--border'];
  TZ.text    = tokens['--text'];
  TZ.red     = tokens['--red'];
};

/**
 * setTheme: update localStorage + DOM + DB (background)
 */
TZ.setTheme = function(mode) {
  localStorage.setItem('tl_theme', mode);
  TZ.applyTheme(mode);

  // Sync to DB if supabase.js saveThemeToProfile is available
  if (typeof saveThemeToProfile === 'function') {
    const currentFont = localStorage.getItem('tl_font') || 'default';
    saveThemeToProfile(mode, currentFont);
  }

  document.querySelectorAll('iframe').forEach(f => {
    try { f.contentWindow.postMessage({ type: 'tz_theme', theme: mode }, '*'); } catch(e) {}
  });
};

// ── Messages from parent ──────────────────────────────────────
window.addEventListener('message', function(e) {
  if (e.data?.type === 'tz_theme') TZ.applyTheme(e.data.theme);
  if (e.data?.type === 'tz_font')  TZ.applyFont(e.data.font);
  if (e.data?.theme && !e.data?.type) TZ.applyTheme(e.data.theme);
});

window.applyTheme = TZ.applyTheme;
window.applyFont  = TZ.applyFont;

// Apply immediately from localStorage (no flicker)
TZ.applyTheme();
TZ.applyFont();

// ══════════════════════════════════════════════════════════════
//  8. PAGE LOADER
// ══════════════════════════════════════════════════════════════
(function() {
  const s = document.createElement('style');
  s.textContent = `
    @keyframes tz-spin { to { transform: rotate(360deg); } }
    #pageLoader {
      position: fixed; inset: 0; background: var(--bg);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 18px; z-index: 9999;
      transition: opacity var(--transition-slow, .35s ease);
    }
    #pageLoader.gone { opacity: 0; pointer-events: none; }
    #pageLoader .tz-pl-logo {
      font-family: var(--font-heading, 'Space Grotesk', sans-serif);
      font-size: 22px; font-weight: 700; letter-spacing: .3px; color: var(--text);
    }
    #pageLoader .tz-pl-logo span { color: var(--accent); }
    #pageLoader .tz-pl-spin {
      width: 28px; height: 28px; border: 2px solid var(--border);
      border-top-color: var(--accent); border-radius: 50%;
      animation: tz-spin .7s linear infinite;
    }
    /* Bitcoin glyph — replaces Font Awesome brands subset (~120 KB font file) */
    .ico-btc {
      display: inline-block;
      font-family: var(--font-heading, 'Space Grotesk', sans-serif);
      font-weight: 700;
      font-size: 1.05em;
      line-height: 1;
      vertical-align: -1px;
    }
  `;
  document.head.appendChild(s);
})();

TZ.buildLoader = function() {
  const el = document.getElementById('pageLoader');
  if (!el || el.children.length) return;
  el.innerHTML = `<div class="tz-pl-logo">Trading<span>Grove</span></div><div class="tz-pl-spin"></div>`;
};

TZ.hideLoader = function() {
  const el = document.getElementById('pageLoader');
  if (!el) return;
  el.classList.add('gone');
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', TZ.buildLoader);
} else {
  TZ.buildLoader();
}
