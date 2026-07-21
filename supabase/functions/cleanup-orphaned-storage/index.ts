import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "company-documents";
const PAGE_SIZE = 500;
const REMOVE_BATCH_SIZE = 100;
const MAX_EXECUTION_TIME_MS = 120_000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Normalize a stored path/URL to the object `name` used inside the bucket.
// processed_documents.*_attachment_url is normally stored as `{org_id}/{doc}.pdf`
// (relative path convention), but historically some rows may hold a full public
// URL. Handle both defensively.
function normalizeToObjectName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const marker = `/object/public/${BUCKET}/`;
  const idx = trimmed.indexOf(marker);
  if (idx >= 0) return trimmed.substring(idx + marker.length);
  const signedMarker = `/object/sign/${BUCKET}/`;
  const sidx = trimmed.indexOf(signedMarker);
  if (sidx >= 0) {
    const rest = trimmed.substring(sidx + signedMarker.length);
    const q = rest.indexOf("?");
    return q >= 0 ? rest.substring(0, q) : rest;
  }
  // Already a relative path
  return trimmed.replace(/^\/+/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // -------- AuthN + AuthZ (global admin only) --------
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "").trim();
    if (!token) return json(401, { success: false, error: "Unauthorized" });

    // Service role can call directly (for cron/manual scripts).
    let isServiceRole = token === serviceRoleKey;
    let userId: string | null = null;

    if (!isServiceRole) {
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authError } = await authClient.auth.getUser(token);
      if (authError || !user) {
        return json(401, { success: false, error: "Unauthorized" });
      }
      userId = user.id;
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (!isServiceRole && userId) {
      const { data: roleRow, error: roleErr } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (roleErr || !roleRow) {
        return json(403, { success: false, error: "Forbidden: admin role required" });
      }
    }

    // -------- Parse input --------
    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }
    const inputCursor: string | null = typeof body?.cursor === "string" && body.cursor
      ? body.cursor
      : null;
    const dryRun: boolean = body?.dry_run === true;

    // -------- Build "keep" set from processed_documents --------
    // Iterate in pages to avoid loading everything at once.
    const keepSet = new Set<string>();
    const KEEP_PAGE = 1000;
    let keepFrom = 0;
    while (true) {
      const { data: rows, error } = await admin
        .from("processed_documents")
        .select("pdf_attachment_url, xml_attachment_url")
        .or("pdf_attachment_url.not.is.null,xml_attachment_url.not.is.null")
        .range(keepFrom, keepFrom + KEEP_PAGE - 1);
      if (error) {
        return json(500, { success: false, error: `Error leyendo processed_documents: ${error.message}` });
      }
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        const p = normalizeToObjectName((r as any).pdf_attachment_url);
        const x = normalizeToObjectName((r as any).xml_attachment_url);
        if (p) keepSet.add(p);
        if (x) keepSet.add(x);
      }
      if (rows.length < KEEP_PAGE) break;
      keepFrom += KEEP_PAGE;
    }

    const startedAt = Date.now();
    let scanned = 0;
    let deleted = 0;
    let kept = 0;
    let removeErrors = 0;
    let lastId: string | null = inputCursor;
    let done = false;

    const storageSchema = admin.schema("storage");

    while (true) {
      if (Date.now() - startedAt > MAX_EXECUTION_TIME_MS) break;

      let query = storageSchema
        .from("objects")
        .select("id, name")
        .eq("bucket_id", BUCKET)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (lastId) query = query.gt("id", lastId);

      const { data: objs, error: objErr } = await query;
      if (objErr) {
        return json(500, { success: false, error: `Error listando storage.objects: ${objErr.message}` });
      }
      if (!objs || objs.length === 0) {
        done = true;
        break;
      }

      scanned += objs.length;
      lastId = (objs[objs.length - 1] as any).id;

      const orphans: string[] = [];
      for (const o of objs) {
        const name = (o as any).name as string;
        if (keepSet.has(name)) {
          kept++;
        } else {
          orphans.push(name);
        }
      }

      // Remove orphans in sub-batches of 100 so Supabase actually frees the space.
      if (orphans.length > 0 && !dryRun) {
        for (let i = 0; i < orphans.length; i += REMOVE_BATCH_SIZE) {
          if (Date.now() - startedAt > MAX_EXECUTION_TIME_MS) break;
          const chunk = orphans.slice(i, i + REMOVE_BATCH_SIZE);
          const { data: removed, error: rmErr } = await admin
            .storage
            .from(BUCKET)
            .remove(chunk);
          if (rmErr) {
            removeErrors++;
            console.error(`remove() error (chunk of ${chunk.length}):`, rmErr.message);
          } else {
            deleted += (removed?.length ?? chunk.length);
          }
        }
      } else if (dryRun) {
        deleted += orphans.length; // simulated
      }

      if (objs.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const summary = {
      success: true,
      bucket: BUCKET,
      dry_run: dryRun,
      keep_paths: keepSet.size,
      scanned,
      deleted,
      kept,
      remove_errors: removeErrors,
      last_id: lastId,
      done,
      elapsed_ms: elapsedMs,
    };

    console.log(
      `🧹 cleanup-orphaned-storage summary: scanned=${scanned} deleted=${deleted} kept=${kept} ` +
      `keep_paths=${keepSet.size} done=${done} last_id=${lastId} elapsed=${elapsedMs}ms dry_run=${dryRun}`,
    );

    return json(200, summary);
  } catch (e: any) {
    console.error("cleanup-orphaned-storage fatal:", e?.message || e);
    return json(500, { success: false, error: e?.message || String(e) });
  }
});
