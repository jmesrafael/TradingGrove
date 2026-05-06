/**
 * Dynamic Favicon Generator
 * Generates theme-aware favicons that update based on user's color theme selection
 */

class FaviconGenerator {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 192;
    this.canvas.height = 192;
    this.ctx = this.canvas.getContext('2d');
    this.currentTheme = null;
    this.faviconLink = this.getFaviconLink();
    this.init();
  }

  getFaviconLink() {
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/x-icon';
      document.head.appendChild(link);
    }
    return link;
  }

  // Get accent color from current theme or localStorage
  getThemeColors() {
    let themeId = localStorage.getItem('tl_theme') || 'dark';

    // Map theme IDs to their accent colors
    const themeColorMap = {
      dark: { bg: '#0b0f0c', accent: '#00ff88', accent2: '#19c37d' },
      light: { bg: '#eef3f0', accent: '#19c37d', accent2: '#0a9460' },
      'blue-electric': { bg: '#060d18', accent: '#00e5ff', accent2: '#0ea5e9' },
      void: { bg: '#000000', accent: '#ffffff', accent2: '#b0b0b0' },
      'grove-dusk': { bg: '#08080f', accent: '#a78bfa', accent2: '#7c5ce8' },
      moss: { bg: '#050e08', accent: '#3a9858', accent2: '#2b7a45' },
    };

    // Handle system theme - detect OS preference
    if (themeId === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? themeColorMap.dark : themeColorMap.light;
    }

    return themeColorMap[themeId] || themeColorMap.dark;
  }

  // Generate favicon with "T" and "G" letters in theme colors
  generateFavicon() {
    const colors = this.getThemeColors();
    const canvas = this.canvas;
    const ctx = this.ctx;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background with rounded corners effect
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw subtle rounded corner circles for depth
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.arc(192, 192, 40, 0, Math.PI * 2);
    ctx.fill();

    // Draw main icon: stylized "TG" with theme colors
    const fontSize = 90;
    ctx.font = `bold ${fontSize}px 'Arial', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // "T" in primary accent color (green/cyan/etc)
    ctx.fillStyle = colors.accent;
    ctx.fillText('T', canvas.width * 0.35, canvas.height * 0.5);

    // "G" in secondary accent color (lighter green/white/etc)
    ctx.fillStyle = colors.accent2;
    ctx.fillText('G', canvas.width * 0.65, canvas.height * 0.5);

    // Add subtle glow effect
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.2;
    ctx.strokeText('T', canvas.width * 0.35, canvas.height * 0.5);
    ctx.globalAlpha = 1.0;

    // Convert to data URL and update favicon
    const dataUrl = canvas.toDataURL('image/png');
    this.faviconLink.href = dataUrl;
  }

  // Watch for theme changes from the TZ system
  watchThemeChanges() {
    // Listen for custom theme change event (dispatched by theme.js)
    document.addEventListener('themeChanged', (e) => {
      this.generateFavicon();
    });

    // Also watch for storage changes (for multi-tab sync)
    window.addEventListener('storage', (e) => {
      if (e.key === 'tl_theme') {
        this.generateFavicon();
      }
    });

    // Listen for system theme changes (when OS preference changes)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const themeId = localStorage.getItem('tl_theme');
      if (themeId === 'system') {
        this.generateFavicon();
      }
    });
  }

  init() {
    // Generate initial favicon
    this.generateFavicon();

    // Start watching for theme changes
    this.watchThemeChanges();

    // Regenerate on visibility change (when user comes back to tab)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.generateFavicon();
      }
    });
  }

  // Manual method to update favicon (can be called explicitly)
  updateFavicon(themeId) {
    localStorage.setItem('tl_theme', themeId);
    this.generateFavicon();
  }
}

// Initialize favicon generator when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.faviconGen = new FaviconGenerator();
  });
} else {
  window.faviconGen = new FaviconGenerator();
}
