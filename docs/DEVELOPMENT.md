# Development Guide

## Prerequisites

- [Node.js](https://nodejs.org/) v18+ (for the dev server and build script)
- A Supabase project (for auth and database features)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (to deploy edge functions and run migrations)

No package manager or bundler is required for the frontend — the project is vanilla HTML/CSS/JS.

## Running Locally

```bash
node dev-server.js
```

Open [http://localhost:5500](http://localhost:5500).

The dev server:
- Reads `vercel.json` and applies the same rewrites locally (so `/dashboard` resolves to `src/dashboard.html`)
- Falls back to `src/{name}.html` for any unmatched route
- Handles direct `.html` requests (`/analytics.html?preload=1`) used by journal iframe preloads
- Sets CORS headers for local API testing

## Build

```bash
node build.js
```

Recursively copies `src/` → `public/`. Vercel serves `public/` as the deployment root. Files at `src/foo/bar.html` become accessible at `/foo/bar.html` in production.

## Environment

Supabase URL + anon key are **hardcoded** in `src/js/lib/supabase-client.js` (the public anon key is safe to expose — RLS enforces isolation). No `.env` file is needed to run the frontend.

Edge function secrets live in Supabase. See `.env.example` for the full list and [DEPLOYMENT.md](DEPLOYMENT.md#set-or-update-secrets) for how to set them.

## Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full folder layout. Key points:

- All HTML pages live at the **root of `src/`** (e.g. `src/dashboard.html`)
- Per-page JS lives at `src/js/modules/{page}.js`
- Per-page CSS lives at `src/styles/{page}.css`
- Shared globals are `src/js/lib/supabase-client.js` and `src/js/lib/theme.js`
- Edge functions live in `supabase/functions/{function-name}/index.ts`

## Adding a New Page

1. Create `src/{name}.html`
2. Add the standard script loading order in `<head>` (see [ARCHITECTURE.md → Script Loading Order](ARCHITECTURE.md#script-loading-order))
3. Create `src/js/modules/{name}.js` with page logic; expose any `onclick`/`oninput` handlers as globals:
   ```js
   Object.assign(window, { functionA, functionB });
   ```
4. Create `src/styles/{name}.css` and link it from the new HTML page
5. Add a rewrite to `vercel.json`:
   ```json
   { "source": "/{name}", "destination": "/{name}.html" }
   ```
   The dev server picks this up automatically on next start.

## Editing Styles

Each page has its own CSS file at `src/styles/{page}.css`. Theme variables (`--bg`, `--text`, `--accent`, `--panel`, `--border`, etc.) are defined in `src/js/lib/theme.js` and applied as inline CSS variables on `<html>` by the theme system.

## Supabase Edge Functions

Located in `supabase/functions/`. Deploy with:

```bash
supabase functions deploy {function-name}
```

Requires the Supabase CLI and a linked project (`supabase link --project-ref <ref>`).

Most functions verify the user's JWT automatically; the ones that handle their auth manually (`create-checkout`, `create-paypal-subscription`, `delete-account`) are deployed with `--no-verify-jwt`. Webhook functions (`stripe-webhook`, `paypal-webhook`) use a `config.toml` to disable JWT verification because they verify signatures instead.

## Database Migrations

```bash
supabase db push
```

Runs every file in `supabase/migrations/` in filename order. See [DATABASE.md](DATABASE.md) for the schema reference.

## Deploying

The project deploys to **Vercel**. Every push to `main` triggers an automatic deployment. `vercel.json` rewrites map clean URLs to HTML files at `src/` root.

Manual deploy:

```bash
vercel --prod
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deploy workflow including edge functions and migrations.

## Common Issues

| Problem | Fix |
|---------|-----|
| Port 5500 already in use | Stop the process using the port, or edit `PORT` in `dev-server.js` |
| `/dashboard` returns 404 | Make sure `dev-server.js` is running (not a plain file server) |
| Supabase session not found | Clear localStorage and sign in again |
| CSS not loading | Check the `<link>` href in the HTML matches the file in `src/styles/` |
| Edge function 401 | Verify the user's session is still valid; check the function expects JWT vs verifies manually |
| Image upload silently fails | Check R2 secrets in Supabase; the upload happens directly from browser → R2 |
