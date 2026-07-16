// track.js - lightweight product analytics.
// Inserts rows into public.app_events (RLS: insert-own only; reads are
// service-role only via the local admin tool). Every call is
// fire-and-forget and swallows errors: analytics must never break the app.
(function () {
  const VISIT_TTL_MS = 30 * 60 * 1000; // dedupe page visits per path per 30 min

  async function send(event, meta) {
    try {
      if (typeof db === 'undefined' || !db?.auth) return;
      const { data: { user } = {} } = await db.auth.getUser();
      if (!user) return;
      await db.from('app_events').insert({
        user_id: user.id,
        event: event,
        page: location.pathname,
        meta: meta || {}
      });
    } catch (e) { /* silent by design */ }
  }

  window.tgTrack = function (event, meta) { send(event, meta); };

  // Auto-track a page visit, deduped so refreshes/tab-hopping don't spam.
  try {
    const key = 'tg_visit_' + location.pathname;
    const last = Number(sessionStorage.getItem(key)) || 0;
    if (Date.now() - last > VISIT_TTL_MS) {
      sessionStorage.setItem(key, String(Date.now()));
      send('page_visit');
    }
  } catch (e) {
    send('page_visit');
  }
})();
