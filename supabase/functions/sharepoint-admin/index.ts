// Admin endpoints: list sites, select site, test connection, disconnect
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { refreshSharePointToken, ensureRootFolder, graphFetch, GRAPH } from "../_shared/sharepoint.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Admin required" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "status") {
      const { data: account } = await admin
        .from("sharepoint_admin_account")
        .select("id, admin_email, site_id, site_url, site_name, drive_id, root_folder_id, root_folder_path, is_active, updated_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return json({ account: account || null });
    }

    if (action === "list_sites") {
      const { accessToken } = await refreshSharePointToken(admin);
      const q = body.query || "*";
      const sites = await graphFetch(
        accessToken,
        `${GRAPH}/sites?search=${encodeURIComponent(q)}`,
      );
      return json({ sites: sites.value || [] });
    }

    if (action === "select_site") {
      const siteId = body.site_id;
      if (!siteId) return json({ error: "site_id required" }, 400);
      const { accessToken, account } = await refreshSharePointToken(admin);

      // Get site details
      const site = await graphFetch(accessToken, `${GRAPH}/sites/${siteId}`);
      // Get default drive
      const drive = await graphFetch(accessToken, `${GRAPH}/sites/${siteId}/drive`);
      const driveId = drive.id;

      const rootFolderName = body.root_folder_path || account.root_folder_path || "FacturaFlow";
      const rootFolderId = await ensureRootFolder(accessToken, driveId, rootFolderName);

      const { error: upErr } = await admin
        .from("sharepoint_admin_account")
        .update({
          site_id: siteId,
          site_url: site.webUrl,
          site_name: site.displayName || site.name,
          drive_id: driveId,
          root_folder_id: rootFolderId,
          root_folder_path: rootFolderName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true, site_id: siteId, drive_id: driveId, root_folder_id: rootFolderId });
    }

    if (action === "test") {
      const { accessToken, account } = await refreshSharePointToken(admin);
      const me = await graphFetch(accessToken, `${GRAPH}/me`);
      let driveOk = false;
      if (account.drive_id) {
        try {
          await graphFetch(accessToken, `${GRAPH}/drives/${account.drive_id}/root`);
          driveOk = true;
        } catch (_) { /* */ }
      }
      return json({ ok: true, user: me.userPrincipalName || me.mail, drive_ok: driveOk });
    }

    if (action === "disconnect") {
      await admin
        .from("sharepoint_admin_account")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("is_active", true);
      return json({ ok: true });
    }

    if (action === "update_root_folder") {
      const newName = (body.root_folder_path || "FacturaFlow").trim();
      const { accessToken, account } = await refreshSharePointToken(admin);
      if (!account.drive_id) return json({ error: "drive not selected" }, 400);
      const rootFolderId = await ensureRootFolder(accessToken, account.drive_id, newName);
      await admin
        .from("sharepoint_admin_account")
        .update({ root_folder_path: newName, root_folder_id: rootFolderId, updated_at: new Date().toISOString() })
        .eq("id", account.id);
      return json({ ok: true, root_folder_id: rootFolderId });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
