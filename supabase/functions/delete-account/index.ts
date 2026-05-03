// supabase/functions/delete-account/index.ts
// Deploy with: supabase functions deploy delete-account --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), { status: 401, headers: CORS });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Admin client (can delete auth users) ──────────────────────────────
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── User client (to verify the token and get the caller's ID) ─────────
    const userClient = createClient(supabaseUrl, Deno.env.get("ANON_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user?.id) {
      console.error("Auth failed:", userErr);
      return new Response(
        JSON.stringify({ error: "Invalid or expired session. Please sign in again." }),
        { status: 401, headers: CORS }
      );
    }

    const userId = user.id;
    console.log("Deleting account for user:", userId);

    // ── Helper: delete rows via admin client ───────────────────────────────
    const del = async (table: string, col: string) => {
      const { error } = await admin.from(table).delete().eq(col, userId);
      if (error) console.error(`Failed to delete from ${table} (${col}):`, error.message);
      else console.log(`Deleted from ${table} (${col})`);
    };

    // ── Delete data in dependency order ───────────────────────────────────
    await del("trade_images",   "user_id");
    await del("trades",         "user_id");
    await del("journal_settings","user_id");
    await del("custom_notes",   "user_id");
    await del("journals",       "user_id");
    await del("referrals",      "referrer_id");
    await del("referrals",      "referred_user_id");
    await del("profiles",       "id");

    // ── Delete the auth user last (requires service role) ─────────────────
    const { error: deleteAuthErr } = await admin.auth.admin.deleteUser(userId);

    if (deleteAuthErr) {
      console.error("Auth user deletion failed:", deleteAuthErr.message);
      return new Response(
        JSON.stringify({ error: "Failed to delete auth user: " + deleteAuthErr.message }),
        { status: 500, headers: CORS }
      );
    }

    console.log("Account successfully deleted for user:", userId);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });

  } catch (err: any) {
    console.error("FATAL:", err.message);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: CORS,
    });
  }
});