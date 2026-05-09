# 🏗️ TradingGrove Restructuring Tracker

**Project:** TradingGrove Trading Journal Platform  
**Status:** 🟡 IN PROGRESS (Phase 1 ✅ · Phase 2 ✅ · Phase 3 🟡 CSS done, docs pending)  
**Last Updated:** 2026-05-09  
**Estimated Duration:** 4-6 hours total (3 phases)

---

## 📊 Current State Summary

### Frontend Structure (Before)
```
TradingGrove/
├── *.html files scattered at root (20+ files)
├── *.js at root (supabase.js, theme.js, favicon.js, dev-server.js)
├── assets/ (only images)
├── pages/ (only calculator pages)
├── presession/ (standalone folder)
├── logs/ (standalone folder)
└── supabase/ (backend)
```

**Issues:**
- [ ] HTML files not organized
- [ ] JS logic mixed with inline CSS
- [ ] No clear folder hierarchy
- [ ] Hard for GitHub visitors to understand
- [ ] Difficult to maintain and scale

---

## 🎯 Restructuring Goals

**End Goal Structure:**
```
TradingGrove/
├── src/
│   ├── pages/          # All HTML files
│   ├── js/             # Organized scripts
│   ├── styles/         # Extracted CSS
│   └── assets/         # Images, fonts
├── supabase/           # Backend (reorganized)
├── docs/               # New documentation
├── README.md           # Updated
└── RESTRUCTURING_TRACKER.md (this file)
```

---

## 📋 Phase Breakdown

### Phase 1: Foundation & Pages Organization
**Status:** ✅ COMPLETE  
**Estimated Time:** 1-2 hours  
**Goal:** Create folder structure, move pages, update routing

#### Checklist

- [x] **Create folder structure**
  - [x] Create `/src/` directory
  - [x] Create `/src/pages/` directory
  - [x] Create `/src/js/` directory
  - [x] Create `/src/js/lib/` directory
  - [x] Create `/src/js/modules/` directory
  - [x] Create `/src/js/components/` directory
  - [x] Create `/src/styles/` directory
  - [x] Create `/src/assets/` directory
  - [x] Create `/docs/` directory

- [x] **Move HTML pages to `/src/pages/`**
  - [x] Move `index.html` → `/src/pages/index.html`
  - [x] Move `dashboard.html` → `/src/pages/dashboard.html`
  - [x] Move `journal.html` → `/src/pages/journal.html`
  - [x] Move `analytics.html` → `/src/pages/analytics.html`
  - [x] Move `calendar.html` → `/src/pages/calendar.html`
  - [x] Move `notes.html` → `/src/pages/notes.html`
  - [x] Move `auth.html` → `/src/pages/auth.html`
  - [x] Move `subscription.html` → `/src/pages/subscription.html`
  - [x] Move `calculator.html` → `/src/pages/calculators/calculator.html`
  - [x] Move `crypto-calculator.html` → `/src/pages/calculators/crypto-calculator.html`
  - [x] Move `forex-calculator.html` → `/src/pages/calculators/forex-calculator.html`
  - [x] Move `confirm.html` → `/src/pages/confirm.html`
  - [x] Move `reset-password.html` → `/src/pages/reset-password.html`
  - [x] Move `pricing.html` → `/src/pages/pricing.html`
  - [x] Move `terms.html` → `/src/pages/terms.html`
  - [x] Move `privacy.html` → `/src/pages/privacy.html`
  - [x] Move `help.html` → `/src/pages/help.html`
  - [x] Move `refund.html` → `/src/pages/refund.html`
  - [x] Move `profile.html` → `/src/pages/profile.html`
  - [x] Move `calculatorpage.html` → `/src/pages/calculators/position-calculator.html`

- [x] **Move assets**
  - [x] Move `favicon.svg` → `/src/assets/favicon.svg`
  - [x] Move all images from `assets/` → `/src/assets/images/`
  - [x] Update favicon reference in all HTML files

- [x] **Move presession files**
  - [x] Move `presession/presession.css` → `/src/styles/presession.css`
  - [x] Move `presession/presession.js` → `/src/js/modules/presession.js`

- [x] **Move logs files**
  - [x] Move `logs/logs.js` → `/src/js/modules/logs.js`

- [x] **Update Vercel rewrites** (`vercel.json`)
  - [x] Update all `destination` paths from `/xxx.html` to `/src/pages/xxx.html`
  - [x] Added missing routes: pricing, help, terms, privacy, refund, profile

- [x] **Update HTML file script/link paths**
  - [x] Update all `<script src="">` references
  - [x] Update all `<link href="">` references
  - [x] Update all image `src=""` paths
  - [x] Update all favicon references

- [x] **Fix dev-server.js for new structure**
  - [x] Updated dev-server.js to read & apply `vercel.json` rewrites locally so `/dashboard` etc. work after moves

- [x] **Test Phase 1**
  - [x] Run dev-server.js and verify routing works (clean URLs `/dashboard`, `/analytics` etc. all return HTTP 200)
  - [x] Check all page links navigate correctly
  - [x] Verify no 404 errors for assets (favicon, supabase-client.js, theme.js paths verified)
  - [x] Test favicon loads (`/src/assets/favicon.svg` referenced correctly)
  - [x] Commit changes: "Phase 1: Reorganize folder structure and move pages"

---

### Phase 2: Scripts Consolidation
**Status:** ✅ COMPLETE (all extractions done · dev-server fixed · ready for testing)  
**Estimated Time:** 1-2 hours  
**Goal:** Extract and organize JavaScript

#### Checklist

- [x] **Organize shared library scripts** (`/src/js/lib/`)
  - [x] Move `supabase.js` → `/src/js/lib/supabase-client.js`
  - [x] Move `theme.js` → `/src/js/lib/theme.js`
  - [ ] Create `/src/js/lib/cache.js` (extract cache functions from supabase-client.js) — *deferred*
  - [ ] Create `/src/js/lib/api.js` (shared API helpers) — *deferred*

- [x] **Organize page-specific modules** (`/src/js/modules/`)
  Already extracted in earlier work: `presession.js`, `logs.js`
  
  All per-page modules extracted, committed, and route-tested via dev server (HTTP 200 + module path references verified).
  
  | Page | Module Path | Status |
  |------|-------------|--------|
  | `auth.html` | `/src/js/modules/auth.js` | ✅ extracted + linked |
  | `confirm.html` | `/src/js/modules/confirm.js` | ✅ extracted + linked |
  | `reset-password.html` | `/src/js/modules/reset-password.js` | ✅ extracted + linked |
  | `subscription.html` | `/src/js/modules/subscription.js` | ✅ extracted + linked |
  | `pricing.html` | `/src/js/modules/pricing.js` | ✅ extracted + linked |
  | `help.html` | `/src/js/modules/help.js` | ✅ extracted + linked |
  | `profile.html` | `/src/js/modules/profile.js` | ✅ extracted + linked |
  | `notes.html` | `/src/js/modules/notes.js` | ✅ extracted + linked |
  | `calendar.html` | `/src/js/modules/calendar.js` | ✅ extracted + linked |
  | `analytics.html` | `/src/js/modules/analytics.js` | ✅ extracted + linked |
  | `journal.html` | `/src/js/modules/journal.js` | ✅ extracted + linked |
  | `dashboard.html` | `/src/js/modules/dashboard.js` | ✅ extracted + linked |
  | `index.html` | `/src/js/modules/landing.js` | ✅ extracted + linked |
  | `position-calculator.html` | `/src/js/modules/position-calculator.js` | ✅ extracted + linked |
  | `pages/calculators/calculator.html` (fragment) | n/a — pure HTML fragment, logic lives in position-calculator.js | ✅ no extraction needed |
  | `pages/calculators/crypto-calculator.html` (fragment) | n/a — pure HTML fragment, logic lives in position-calculator.js | ✅ no extraction needed |
  | `pages/calculators/forex-calculator.html` (fragment) | n/a — pure HTML fragment, logic lives in position-calculator.js | ✅ no extraction needed |

  Order rationale: smallest/simplest pages first (auth, confirm, reset-password) → static-content pages → dashboards. Riskiest (dashboard, journal) last.

- [ ] **Organize reusable components** (`/src/js/components/`) — *deferred until per-page extraction reveals real shared patterns*
  - [ ] Extract navbar logic → `/src/js/components/navbar.js`
  - [ ] Extract dropdown logic → `/src/js/components/dropdown.js`
  - [ ] Extract modal logic → `/src/js/components/modal.js`
  - [ ] Extract form logic → `/src/js/components/form.js`

- [x] **Update HTML files for lib paths**
  - [x] All `<script src="/supabase.js">` → `<script src="/src/js/lib/supabase-client.js">`
  - [x] All `<script src="/theme.js">` → `<script src="/src/js/lib/theme.js">`
  - [x] Per-page module `<script>` tags added to each page

- [x] **Dev server**
  - [x] Kept `dev-server.js` at root
  - [x] Updated to read `vercel.json` rewrites so `/dashboard`, `/journal`, etc. work locally
  - [x] Fixed `.html`-extension fallback bug (committed `e3ebdc4`) so iframe preloads like `/analytics.html?preload=1` from `journal.js` resolve correctly

- [ ] **Test Phase 2** *(automated/route-level tests done; full UI smoke test still pending)*
  - [x] Run dev-server and confirm all pages return HTTP 200 (clean URLs + direct file paths)
  - [ ] Verify Supabase auth still works *(needs manual browser test)*
  - [ ] Check theme switching works *(needs manual browser test)*
  - [ ] Verify calculator functionality *(needs manual browser test)*
  - [x] Commit changes: "Phase 2: Organize and consolidate JavaScript"

---

### Phase 3: Styles Extraction & Polish
**Status:** 🟡 IN PROGRESS (CSS ✅ · Docs ✅ · .gitignore ✅ · manual browser test pending)  
**Estimated Time:** 1-2 hours  
**Goal:** Extract CSS, add documentation

#### Checklist

- [x] **Extract CSS from all HTML pages** → `/src/styles/pages/{page}.css`
  - [x] analytics.css (8 KB)
  - [x] auth.css (10 KB)
  - [x] calendar.css (9 KB)
  - [x] confirm.css (4 KB)
  - [x] dashboard.css (32 KB)
  - [x] help.css (7 KB)
  - [x] index.css (46 KB)
  - [x] journal.css (48 KB)
  - [x] notes.css (39 KB)
  - [x] position-calculator.css (19 KB)
  - [x] pricing.css (12 KB)
  - [x] privacy.css (11 KB)
  - [x] profile.css (20 KB)
  - [x] refund.css (9 KB)
  - [x] reset-password.css (5 KB)
  - [x] subscription.css (21 KB)
  - [x] terms.css (9 KB)
  - [x] presession.css (already extracted in Phase 1)

  Note: per-page extraction approach (not pre-split into global/components/etc.) — refactoring into shared CSS modules is deferred until duplication patterns become clear.

- [x] **Update HTML files to link new stylesheets**
  - [x] Replace all inline `<style>` with `<link rel="stylesheet" href="/src/styles/pages/...">`
  - [x] Verified all CSS loads (HTTP 200) and HTML references are correct

- [x] **Create documentation**
  - [x] Create `/docs/ARCHITECTURE.md` (folder layout, script loading order, routing table, iframe embeds, Supabase globals)
  - [x] Create `/docs/DEVELOPMENT.md` (dev server setup, adding pages, deploying, common issues)
  - [x] Create `/docs/PROJECT_OVERVIEW.md` (mission, features, tech stack, business model — adapted from TRADINGGROVE_OVERVIEW.txt)
  - [x] Update `/README.md` (structure diagram, local setup, tech stack, pricing)

- [x] **Improve .gitignore** — already complete; all required entries were present:
  - [x] `node_modules/` ✅
  - [x] `.env`, `.env.local`, `.env.*.local` ✅
  - [x] `supabase/.temp/` ✅
  - [x] `dist/`, `build/`, `.output/`, `.cache/` ✅

- [ ] **Test Phase 3** *(route-level tests done; visual/UI tests pending)*
  - [x] Run dev-server and verify all CSS loads (HTTP 200 confirmed for analytics, dashboard, journal)
  - [ ] Check responsive design on mobile (calculator, pages) *(needs manual browser test)*
  - [ ] Verify theme switching still works *(needs manual browser test)*
  - [ ] Check all pages render correctly *(needs manual browser test)*
  - [ ] Test in light and dark mode *(needs manual browser test)*
  - [x] Commit changes: "Phase 3: Extract CSS and add documentation" *(commit `76aab8a` — CSS portion only; docs commit still pending)*

---

### Phase 4 (Optional): Backend Reorganization & Future Setup
**Status:** 🔴 NOT STARTED  
**Estimated Time:** 1 hour (optional)  
**Goal:** Organize backend, add package.json, prepare for future optimization

#### Checklist

- [ ] **Reorganize Supabase functions**
  - [ ] Create `/supabase/functions/billing/` and move functions there
  - [ ] Create `/supabase/functions/auth/` and move functions there
  - [ ] Create `/supabase/functions/referrals/` and move functions there
  - [ ] Create `/supabase/functions/webhooks/` and move functions there
  - [ ] Create `/supabase/functions/storage/` and move functions there
  - [ ] Add README to each folder explaining its purpose

- [ ] **Add package.json** (optional, for dependency management)
  - [ ] Create `package.json` with scripts
  - [ ] Add dev dependencies (optional: vite, esbuild)
  - [ ] Add scripts: `dev`, `build`, `deploy`

- [ ] **Create additional docs** (optional)
  - [ ] Create `/docs/API.md` (Supabase functions documentation)
  - [ ] Create `/docs/DATABASE.md` (schema, migrations)
  - [ ] Create `/docs/DEPLOYMENT.md` (Vercel, Supabase setup)

- [ ] **Test Phase 4**
  - [ ] Verify Supabase functions still deploy correctly
  - [ ] Test all API calls still work
  - [ ] Commit changes: "Phase 4: Reorganize backend and add documentation"

---

## 📈 Progress Tracker

### Overall Progress
```
Phase 1: ██████████ 100% (committed `64ba9b2`)
Phase 2: ██████████ 100% (committed `64ba9b2` + dev-server fix `e3ebdc4`)
Phase 3: █████████░  ~90% (CSS ✅ · docs ✅ · .gitignore ✅ · manual browser smoke test pending)
Phase 4: ░░░░░░░░░░   0% [Optional]
```

### Completed Milestones
- [x] Phase 1 Committed (`64ba9b2`)
- [x] Phase 2 Committed (`64ba9b2` + `e3ebdc4` dev-server fix)
- [ ] Phase 3 Committed (CSS done in `76aab8a`; awaiting docs + .gitignore commit)
- [ ] Phase 4 Committed (optional)
- [ ] Final manual browser smoke test complete
- [ ] Pushed to GitHub

---

## 📝 Notes & Decisions

### Current Decisions
- **Using 3-phase approach** (Phase 4 optional)
- **Keeping dev-server.js at root** (can move if preferred)
- **CSS: Extract to separate files** (not using CSS-in-JS framework)
- **No bundler yet** (can add Vite in Phase 4)
- **Keep existing build/deploy** (Vercel setup unchanged)

### Files Needing Attention
1. **vercel.json** — Update all path rewrites
2. **All HTML files** — Update script/link/image paths (20+ files)
3. **dev-server.js** — May need path adjustments
4. **Favicon references** — scattered across HTML files

### Potential Issues to Watch
- [ ] Supabase client initialization path changes
- [ ] Relative vs absolute paths in CSS/JS
- [ ] Theme switching after js reorganization
- [ ] localStorage references (`_tz_cache_` prefix)
- [ ] CDN scripts (Font Awesome, Google Fonts) — ensure they still load
- [ ] Mobile responsiveness after CSS extraction

---

## 🔗 File References

### Key Files to Update

| File | Current Location | Changes Needed |
|------|-----------------|-----------------|
| Vercel config | `vercel.json` | Update all destination paths |
| Supabase client | `supabase.js` | Move to `/src/js/lib/supabase-client.js` |
| Theme manager | `theme.js` | Move to `/src/js/lib/theme.js` |
| Dev server | `dev-server.js` | Keep at root or move to `/src/` |
| HTML Pages | 20+ at root | Move to `/src/pages/` |
| Favicon | `favicon.svg` | Move to `/src/assets/` |
| Styles | Inline in HTML | Extract to `/src/styles/` |
| Assets | `assets/` | Move to `/src/assets/` |

---

## ✅ Pre-Phase Checklist

Before starting Phase 1, confirm:
- [ ] Git is up to date (`git status` clean)
- [ ] Create a new branch: `git checkout -b restructure/phase-1`
- [ ] All changes backed up or in version control
- [ ] No active development on other features
- [ ] Team aware of restructuring (if team project)

---

## 🚀 How to Use This Tracker

1. **Print or keep this file open** while working
2. **Check off each task** as completed
3. **Update progress bars** after each phase
4. **Add notes** in the Notes section if anything changes
5. **Commit after each phase** with clear messages
6. **Update "Last Updated"** at top of file

### Git Commit Messages

```
Phase 1: git commit -m "Phase 1: Reorganize folder structure and move pages"
Phase 2: git commit -m "Phase 2: Organize and consolidate JavaScript"
Phase 3: git commit -m "Phase 3: Extract CSS and add documentation"
Phase 4: git commit -m "Phase 4: Reorganize backend and add documentation"
```

---

## 📞 Questions & Decisions Needed

- [ ] Keep `dev-server.js` at root or move to `/src/`?
- [ ] Extract CSS immediately (Phase 3) or integrate with bundler later?
- [ ] Add `package.json` now (Phase 4) or keep vanilla JS?
- [ ] Consolidate `calculatorpage.html` and `calculator.html`?
- [ ] Move presession/logs to modules or keep separate structure?

---

## 🎉 Success Criteria

After all phases complete:
- ✅ Clear `/src/` structure with pages, js, styles, assets
- ✅ All HTML pages in `/src/pages/` organized by feature
- ✅ All JS organized in `/src/js/lib/`, modules, components
- ✅ All CSS extracted to `/src/styles/` with clear organization
- ✅ Updated documentation in `/docs/`
- ✅ All pages work exactly as before (no functionality changes)
- ✅ GitHub visitors can instantly understand project structure
- ✅ Ready for future scaling/optimization

---

**Start Date:** TBD  
**Target Completion:** TBD  
**Completed Date:** TBD

---

*Last Updated: 2026-05-09*  
*Created for TradingGrove Restructuring Project*
