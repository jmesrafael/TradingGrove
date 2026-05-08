# 🏗️ TradingGrove Restructuring Tracker

**Project:** TradingGrove Trading Journal Platform  
**Status:** 🟡 IN PROGRESS (Phase 1 Complete · Phase 2 Partial — lib moves done, page extractions ongoing)  
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

- [ ] **Test Phase 1**
  - [ ] Run dev-server.js and verify routing works
  - [ ] Check all page links navigate correctly
  - [ ] Verify no 404 errors for assets
  - [ ] Test favicon loads
  - [x] Commit changes: "Phase 1: Reorganize folder structure and move pages"

---

### Phase 2: Scripts Consolidation
**Status:** 🟡 IN PROGRESS (lib moves done · per-page extraction starting)  
**Estimated Time:** 1-2 hours  
**Goal:** Extract and organize JavaScript

#### Checklist

- [x] **Organize shared library scripts** (`/src/js/lib/`)
  - [x] Move `supabase.js` → `/src/js/lib/supabase-client.js`
  - [x] Move `theme.js` → `/src/js/lib/theme.js`
  - [ ] Create `/src/js/lib/cache.js` (extract cache functions from supabase-client.js) — *deferred*
  - [ ] Create `/src/js/lib/api.js` (shared API helpers) — *deferred*

- [ ] **Organize page-specific modules** (`/src/js/modules/`)
  Already extracted in earlier work: `presession.js`, `logs.js`
  
  Extraction approach: one page at a time, verifying in browser after each. Tick off only when the extracted module loads cleanly and the page works.
  
  | Page | Module Path | Status |
  |------|-------------|--------|
  | `auth.html` | `/src/js/modules/auth.js` | ⬜ pending |
  | `confirm.html` | `/src/js/modules/confirm.js` | ⬜ pending |
  | `reset-password.html` | `/src/js/modules/reset-password.js` | ⬜ pending |
  | `subscription.html` | `/src/js/modules/subscription.js` | ⬜ pending |
  | `pricing.html` | `/src/js/modules/pricing.js` | ⬜ pending |
  | `help.html` | `/src/js/modules/help.js` | ⬜ pending |
  | `profile.html` | `/src/js/modules/profile.js` | ⬜ pending |
  | `notes.html` | `/src/js/modules/notes.js` | ⬜ pending |
  | `calendar.html` | `/src/js/modules/calendar.js` | ⬜ pending |
  | `analytics.html` | `/src/js/modules/analytics.js` | ⬜ pending |
  | `journal.html` | `/src/js/modules/journal.js` | ⬜ pending |
  | `dashboard.html` | `/src/js/modules/dashboard.js` | ⬜ pending |
  | `index.html` | `/src/js/modules/landing.js` | ⬜ pending |
  | `position-calculator.html` | `/src/js/modules/position-calculator.js` | ⬜ pending |
  | `pages/calculators/calculator.html` (fragment) | `/src/js/modules/calculator.js` | ⬜ pending |
  | `pages/calculators/crypto-calculator.html` (fragment) | `/src/js/modules/crypto-calculator.js` | ⬜ pending |
  | `pages/calculators/forex-calculator.html` (fragment) | `/src/js/modules/forex-calculator.js` | ⬜ pending |

  Order rationale: smallest/simplest pages first (auth, confirm, reset-password) → static-content pages → dashboards. Riskiest (dashboard, journal) last.

- [ ] **Organize reusable components** (`/src/js/components/`) — *deferred until per-page extraction reveals real shared patterns*
  - [ ] Extract navbar logic → `/src/js/components/navbar.js`
  - [ ] Extract dropdown logic → `/src/js/components/dropdown.js`
  - [ ] Extract modal logic → `/src/js/components/modal.js`
  - [ ] Extract form logic → `/src/js/components/form.js`

- [x] **Update HTML files for lib paths**
  - [x] All `<script src="/supabase.js">` → `<script src="/src/js/lib/supabase-client.js">`
  - [x] All `<script src="/theme.js">` → `<script src="/src/js/lib/theme.js">`
  - [ ] Per-page module `<script>` tags will be added as each page is extracted

- [x] **Dev server**
  - [x] Kept `dev-server.js` at root
  - [x] Updated to read `vercel.json` rewrites so `/dashboard`, `/journal`, etc. work locally

- [ ] **Test Phase 2**
  - [ ] Run dev-server and check all pages work
  - [ ] Verify Supabase auth still works
  - [ ] Check theme switching works
  - [ ] Verify calculator functionality
  - [ ] Commit changes: "Phase 2: Organize and consolidate JavaScript"

---

### Phase 3: Styles Extraction & Polish
**Status:** 🔴 NOT STARTED  
**Estimated Time:** 1-2 hours  
**Goal:** Extract CSS, add documentation

#### Checklist

- [ ] **Extract CSS from index.html** (main styles)
  - [ ] Extract all `<style>` content from index.html
  - [ ] Create `/src/styles/global.css` with base styles
  - [ ] Create `/src/styles/navigation.css` with nav/header styles
  - [ ] Create `/src/styles/hero.css` with hero section styles
  - [ ] Create `/src/styles/components.css` with reusable component styles
  - [ ] Create `/src/styles/responsive.css` with media queries
  - [ ] Create `/src/styles/theme.css` with theme variables

- [ ] **Extract CSS from other pages** (page-specific styles)
  - [ ] Extract calculator styles → `/src/styles/pages/calculator.css`
  - [ ] Extract dashboard styles → `/src/styles/pages/dashboard.css`
  - [ ] Extract journal styles → `/src/styles/pages/journal.css`
  - [ ] Extract presession styles → `/src/styles/pages/presession.css`
  - [ ] Extract other page styles

- [ ] **Update HTML files to link new stylesheets**
  - [ ] Replace all inline `<style>` with `<link rel="stylesheet" href="/src/styles/...">`
  - [ ] Update all pages to include global.css first

- [ ] **Create documentation**
  - [ ] Create `/docs/ARCHITECTURE.md` (explain folder structure, file organization)
  - [ ] Create `/docs/DEVELOPMENT.md` (setup, dev server, local testing)
  - [ ] Create `/docs/PROJECT_OVERVIEW.md` (copy from TRADZONA_OVERVIEW.txt)
  - [ ] Update `/README.md` with new structure and getting started

- [ ] **Improve .gitignore**
  - [ ] Add node_modules/ (if adding package.json)
  - [ ] Add .env and .env.local
  - [ ] Add supabase/.temp/
  - [ ] Add logs/
  - [ ] Add dist/ and build/ (if adding bundler later)

- [ ] **Test Phase 3**
  - [ ] Run dev-server and verify all CSS loads
  - [ ] Check responsive design on mobile (calculator, pages)
  - [ ] Verify theme switching still works
  - [ ] Check all pages render correctly
  - [ ] Test in light and dark mode
  - [ ] Commit changes: "Phase 3: Extract CSS and add documentation"

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
Phase 1: ██████████ 100% (committed)
Phase 2: ███░░░░░░░ ~30% (lib moves + dev-server done; 0/17 pages extracted)
Phase 3: ░░░░░░░░░░ 0%
Phase 4: ░░░░░░░░░░ 0% [Optional]
```

### Completed Milestones
- [ ] Phase 1 Committed
- [ ] Phase 2 Committed
- [ ] Phase 3 Committed
- [ ] Phase 4 Committed (optional)
- [ ] Final testing complete
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

*Last Updated: 2026-05-08*  
*Created for TradingGrove Restructuring Project*
