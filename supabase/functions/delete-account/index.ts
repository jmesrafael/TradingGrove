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
    console.log("Soft-deleting account for user:", userId);

    // ── Soft delete: mark the profile, keep all data ───────────────────────
    // Rows stay in place so the account shows up in the admin "Deleted" view;
    // permanent erasure happens only from there (admin purge).
    const { error: markErr } = await admin
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", userId);

    if (markErr) {
      console.error("Failed to mark profile deleted:", markErr.message);
      return new Response(
        JSON.stringify({ error: "Failed to delete account: " + markErr.message }),
        { status: 500, headers: CORS }
      );
    }

    // ── Permanently block login (ban instead of deleting the auth user) ────
    const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "876000h", // ~100 years
    });

    if (banErr) {
      console.error("Failed to ban auth user:", banErr.message);
      return new Response(
        JSON.stringify({ error: "Failed to disable login: " + banErr.message }),
        { status: 500, headers: CORS }
      );
    }

    console.log("Account soft-deleted and login disabled for user:", userId);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });

  } catch (err: any) {
    console.error("FATAL:", err.message);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: CORS,
    });
  }
});