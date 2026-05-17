// Shared helpers for SharePoint integration (Microsoft Graph)
// deno-lint-ignore-file no-explicit-any

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export const SP_SCOPES = [
  "https://graph.microsoft.com/Sites.ReadWrite.All",
  "https://graph.microsoft.com/Files.ReadWrite.All",
  "https://graph.microsoft.com/User.Read",
  "offline_access",
].join(" ");

export const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function monthEs(dateIso: string): string {
  const d = new Date(dateIso);
  return MONTHS_ES[d.getUTCMonth()] || "Desconocido";
}

export function sanitizeName(s: string): string {
  return (s || "Desconocido")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\/\\:*?"<>|#%&{}]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "Desconocido";
}

export function buildSafeFileName(
  supplier: string,
  amount: number | string,
  date: string,
  currency: string,
  ext: string,
): string {
  const sup = sanitizeName(supplier);
  let amt: string;
  const n = Number(amount) || 0;
  if ((currency || "CRC").toUpperCase() === "USD") {
    amt = n.toFixed(2).replace(".", "-");
  } else {
    amt = Math.round(n).toString();
  }
  const d = (date || "").slice(0, 10);
  return `${sup}_${amt}_${d}.${ext}`;
}

export async function refreshSharePointToken(supabase: any): Promise<{
  accessToken: string;
  account: any;
}> {
  const { data: account, error } = await supabase
    .from("sharepoint_admin_account")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[SharePoint] DB error: ${error.message}`);
  if (!account) throw new Error("[SharePoint] No active admin account");

  const creds = account.credentials || {};
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(creds.expires_at || 0);

  if (creds.access_token && exp > now + 60) {
    return { accessToken: creds.access_token, account };
  }
  if (!creds.refresh_token) {
    throw new Error("[SharePoint] Missing refresh_token; reconnect required");
  }

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: creds.refresh_token,
    scope: SP_SCOPES,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`[SharePoint] Token refresh failed: ${JSON.stringify(json)}`);
  }

  const newCreds = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || creds.refresh_token,
    expires_at: now + Number(json.expires_in || 3600),
    token_type: json.token_type,
  };

  await supabase
    .from("sharepoint_admin_account")
    .update({ credentials: newCreds, updated_at: new Date().toISOString() })
    .eq("id", account.id);

  return { accessToken: newCreds.access_token, account: { ...account, credentials: newCreds } };
}

async function graphFetch(token: string, url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return {};
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Graph ${res.status}: ${json?.error?.message || text}`);
    (err as any).status = res.status;
    (err as any).body = json;
    throw err;
  }
  return json;
}

export async function ensureFolderPath(
  token: string,
  driveId: string,
  rootFolderId: string,
  segments: string[],
): Promise<string> {
  let parentId = rootFolderId;
  for (const rawSeg of segments) {
    const seg = sanitizeName(rawSeg);
    // Try create with conflict=fail; if conflict, list and find
    try {
      const created = await graphFetch(
        token,
        `${GRAPH}/drives/${driveId}/items/${parentId}/children`,
        {
          method: "POST",
          body: JSON.stringify({
            name: seg,
            folder: {},
            "@microsoft.graph.conflictBehavior": "fail",
          }),
        },
      );
      parentId = created.id;
    } catch (e: any) {
      if (e.status === 409 || e.status === 412) {
        // Already exists — fetch it
        const list = await graphFetch(
          token,
          `${GRAPH}/drives/${driveId}/items/${parentId}/children?$filter=name eq '${encodeURIComponent(seg).replace(/'/g, "''")}'&$select=id,name`,
        );
        const match = (list.value || []).find((x: any) => x.name === seg);
        if (!match) throw new Error(`Could not resolve existing folder '${seg}'`);
        parentId = match.id;
      } else {
        throw e;
      }
    }
  }
  return parentId;
}

export async function uploadFileToSharePoint(
  token: string,
  driveId: string,
  folderId: string,
  fileName: string,
  content: Uint8Array,
  contentType: string,
): Promise<{ id: string; webUrl: string; name: string }> {
  const url = `${GRAPH}/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content?@microsoft.graph.conflictBehavior=replace`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
    },
    body: content,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`[SharePoint] Upload ${fileName} failed ${res.status}: ${JSON.stringify(json)}`);
  }
  return { id: json.id, webUrl: json.webUrl, name: json.name };
}

export async function ensureRootFolder(
  token: string,
  driveId: string,
  rootName: string,
): Promise<string> {
  // List children of drive root
  const list = await graphFetch(
    token,
    `${GRAPH}/drives/${driveId}/root/children?$select=id,name`,
  );
  const match = (list.value || []).find((x: any) => x.name === rootName);
  if (match) return match.id;
  const created = await graphFetch(
    token,
    `${GRAPH}/drives/${driveId}/root/children`,
    {
      method: "POST",
      body: JSON.stringify({
        name: rootName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    },
  );
  return created.id;
}

export { graphFetch, GRAPH, TOKEN_URL };
