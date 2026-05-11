# Development Guide

## Prerequisites

- [Node.js](https://nodejs.org/) v18+ (for the dev server)
- A Supabase project (for auth and database features)

No package manager or bundler is required — the project is vanilla HTML/CSS/JS.

## Running Locally

```bash
node dev-server.js
```

Open [http://localhost:5500](http://localhost:5500).

The dev server:
- Reads `vercel.json` and applies the same rewrites locally (so `/dashboard` works the same as in production)
- Falls back to `src/pages/{name}.html` for any unmatched route
- Handles direct `.html` requests (`/analytics.html?preload=1`) used by journal iframe preloads
- Sets CORS headers for local API testing

## Environment

Supabase credentials are **hardcoded** in `src/js/lib/supabase-client.js` (the public anon key is safe to expose — row-level security enforces data isolation). No `.env` file is needed to run the frontend.

## Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full folder layout.

## Adding a New Page

1. Create `src/pages/{name}.html`
2. Add the standard script loading order (see ARCHITECTURE.md)
3. Create `src/js/modules/{name}.js` with page logic; expose any `onclick`/`oninput` handlers via:
   ```js
   Object.assign(window, { functionA, functionB });
   ```
4. Create `src/styles/{name}.css` with page styles
5. Add a rewrite to `vercel.json`:
   ```json
   { "source": "/{name}", "destination": "/src/pages/{name}.html" }
   ```
   The dev server picks this up automatically on next start.

## Editing Styles

Each page has its own CSS file at `src/styles/{page}.css`. Theme variables (`--bg`, `--text`, `--accent`, `--panel`, `--border`, etc.) are defined in `src/js/lib/theme.js` and applied as inline CSS variables on `<html>` by the theme system.

## Supabase Edge Functions

Located in `supabase/functions/`. Deploy with:

```bash
supabase functions deploy {function-name}
```

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and a linked project (`supabase link`).

## Deploying

The project deploys to **Vercel**. Every push to `main` triggers an automatic deployment. The `vercel.json` rewrites map clean URLs to the files in `src/pages/`.

To deploy manually:

```bash
vercel --prod
```

## Common Issues

| Problem | Fix |
|---------|-----|
| Port 5500 already in use | Stop the process using the port, or edit `PORT` in `dev-server.js` |
| `/dashboard` returns 404 | Make sure `dev-server.js` is running (not a plain file server) |
| Supabase session not found | Clear localStorage and sign in again |
| CSS not loading | Check the `<link>` href in the HTML matches the file in `src/styles/` |
