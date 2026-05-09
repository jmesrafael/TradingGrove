# Architecture

## Folder Structure

```
TradingGrove/
├── src/
│   ├── pages/                  # All HTML pages
│   │   ├── index.html          # Landing page
│   │   ├── dashboard.html      # User dashboard
│   │   ├── journal.html        # Trading journal
│   │   ├── analytics.html      # Analytics & charts
│   │   ├── calendar.html       # Trade calendar
│   │   ├── notes.html          # Trade notes
│   │   ├── profile.html        # User profile & settings
│   │   ├── subscription.html   # Billing & subscription
│   │   ├── pricing.html        # Public pricing page
│   │   ├── help.html           # FAQ & help centre
│   │   ├── auth.html           # Sign in / sign up
│   │   ├── confirm.html        # Email confirmation
│   │   ├── reset-password.html # Password reset
│   │   ├── terms.html          # Terms of service
│   │   ├── privacy.html        # Privacy policy
│   │   ├── refund.html         # Refund policy
│   │   └── calculators/
│   │       ├── position-calculator.html  # Full calculator page
│   │       ├── calculator.html           # Crypto tab fragment (iframe)
│   │       ├── crypto-calculator.html    # Crypto calculator fragment
│   │       └── forex-calculator.html     # Forex calculator fragment
│   │
│   ├── js/
│   │   ├── lib/                # Shared global scripts (loaded on every page)
│   │   │   ├── supabase-client.js  # Supabase init, auth helpers, profile cache
│   │   │   └── theme.js            # Theme/font application from profile
│   │   │
│   │   └── modules/            # Per-page JavaScript (one file per page)
│   │       ├── landing.js
│   │       ├── dashboard.js
│   │       ├── journal.js
│   │       ├── analytics.js
│   │       ├── calendar.js
│   │       ├── notes.js
│   │       ├── profile.js
│   │       ├── subscription.js
│   │       ├── pricing.js
│   │       ├── help.js
│   │       ├── auth.js
│   │       ├── confirm.js
│   │       ├── reset-password.js
│   │       ├── logs.js
│   │       ├── presession.js
│   │       └── position-calculator.js
│   │
│   ├── styles/
│   │   ├── presession.css      # Presession page styles
│   │   └── pages/              # Per-page CSS (one file per page)
│   │       ├── index.css
│   │       ├── dashboard.css
│   │       ├── journal.css
│   │       ├── analytics.css
│   │       ├── calendar.css
│   │       ├── notes.css
│   │       ├── profile.css
│   │       ├── subscription.css
│   │       ├── pricing.css
│   │       ├── help.css
│   │       ├── auth.css
│   │       ├── confirm.css
│   │       ├── reset-password.css
│   │       ├── terms.css
│   │       ├── privacy.css
│   │       ├── refund.css
│   │       └── position-calculator.css
│   │
│   └── assets/
│       ├── favicon.svg
│       └── images/             # Brand images, logos, etc.
│
├── logs/                       # Logs iframe embed (served at /logs/)
│   ├── index.html
│   └── logs.css
│
├── presession/                 # Pre-session checklist iframe embed
│   └── presession.html
│
├── supabase/                   # Backend (Supabase Edge Functions + migrations)
│   ├── functions/              # Edge functions (billing, auth, webhooks, etc.)
│   ├── migrations/             # Database migrations
│   └── config.toml
│
├── favicon.js                  # Global favicon loader (loaded on all pages)
├── dev-server.js               # Local dev server (applies vercel.json rewrites)
├── vercel.json                 # Routing rewrites for Vercel production
└── .gitignore
```

## Script Loading Order

Every page loads scripts in this order:

```html
<!-- 1. CDN: Supabase SDK -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/..."></script>

<!-- 2. Favicon handler -->
<script src="/favicon.js"></script>

<!-- 3. Shared lib: theme (must run before body renders) -->
<script src="/src/js/lib/theme.js"></script>

<!-- 4. Shared lib: Supabase client, auth helpers, profile cache -->
<script src="/src/js/lib/supabase-client.js"></script>

<!-- 5. Page module (at end of <body>) -->
<script src="/src/js/modules/{page}.js"></script>
```

## Routing

Clean URLs are mapped to `src/pages/` HTML files via `vercel.json` rewrites (production) and `dev-server.js` (local).

| URL | File served |
|-----|-------------|
| `/` | `src/pages/index.html` |
| `/dashboard` | `src/pages/dashboard.html` |
| `/journal` | `src/pages/journal.html` |
| `/analytics` | `src/pages/analytics.html` |
| `/calendar` | `src/pages/calendar.html` |
| `/notes` | `src/pages/notes.html` |
| `/profile` | `src/pages/profile.html` |
| `/subscription` | `src/pages/subscription.html` |
| `/pricing` | `src/pages/pricing.html` |
| `/help` | `src/pages/help.html` |
| `/auth` | `src/pages/auth.html` |
| `/confirm` | `src/pages/confirm.html` |
| `/reset-password` | `src/pages/reset-password.html` |
| `/terms` | `src/pages/terms.html` |
| `/privacy` | `src/pages/privacy.html` |
| `/refund` | `src/pages/refund.html` |

## Iframe Embeds

The journal page loads the following pages in iframes at runtime:

| Frame | Source |
|-------|--------|
| Logs tab | `/logs/index.html` |
| Pre-session tab | `/presession/presession.html` |
| Calendar tab | `/calendar` |
| Notes tab | `/notes` |
| Analytics tab | `/analytics.html` |

## Supabase Globals

`supabase-client.js` exposes these globals used by every page module:

| Global | Type | Description |
|--------|------|-------------|
| `db` | Supabase client | Authenticated Supabase client |
| `SUPABASE_URL` | string | Project URL |
| `requireAuth()` | async fn | Redirects to `/auth` if no session |
| `getProfile(userId)` | async fn | Returns cached user profile |
| `applyProfileTheme(profile)` | fn | Applies theme/font from profile |
| `TZ` | object | Loader hide/show helpers |
