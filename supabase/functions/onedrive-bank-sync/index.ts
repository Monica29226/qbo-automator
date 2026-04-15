import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  // Microsoft Graph webhook validation (GET with validationToken)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const validationToken = url.searchParams.get("validationToken");
    if (validationToken) {
      console.log("OneDrive webhook validation received");
      return new Response(validationToken, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("OK", { status: 200 });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    
    // Microsoft Graph webhook notification (POST from Microsoft)
    if (contentType.includes("application/json") && !req.headers.get("authorization")) {
      return await handleWebhookNotification(req);
    }

    // Authenticated actions from our UI
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization" }, 401);
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { action, ...params } = await req.json();

    switch (action) {
      case "create_subscription":
        return await createSubscription(supabaseAdmin, params);
      case "sync_folder":
        return await syncFolder(supabaseAdmin, params);
      case "list_folders":
        return await listOneDriveFolders(supabaseAdmin, params);
      case "download_and_process":
        return await downloadAndProcess(supabaseAdmin, params);
      default:
        return jsonResponse({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("onedrive-bank-sync error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
});

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===== Get Microsoft Graph access token for an organization =====
async function getAccessToken(supabase: any, organizationId: string): Promise<string> {
  const { data: creds } = await supabase
    .from("integration_accounts")
    .select("credentials")
    .eq("organization_id", organizationId)
    .eq("service_type", "onedrive")
    .eq("is_active", true)
    .single();

  if (!creds?.credentials) {
    throw new Error("No OneDrive credentials found for organization");
  }

  const { access_token, refresh_token, expires_at } = creds.credentials as any;

  // Check if token is still valid (with 5 min buffer)
  if (access_token && expires_at && Date.now() < (expires_at - 300000)) {
    return access_token;
  }

  // Refresh token
  if (!refresh_token) {
    throw new Error("No refresh token available, need to re-authorize");
  }

  const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
      scope: "offline_access Files.Read Files.Read.All User.Read",
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error("Token refresh failed:", errBody);
    throw new Error("Failed to refresh OneDrive token");
  }

  const tokenData = await tokenRes.json();

  // Save new tokens
  await supabase
    .from("integration_accounts")
    .update({
      credentials: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refresh_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("service_type", "onedrive");

  return tokenData.access_token;
}

// ===== Webhook notification handler =====
async function handleWebhookNotification(req: Request) {
  const body = await req.json();
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  console.log("OneDrive webhook notification:", JSON.stringify(body).slice(0, 500));

  if (body.value && Array.isArray(body.value)) {
    for (const notification of body.value) {
      const subscriptionId = notification.subscriptionId;
      const resource = notification.resource;

      // Find the subscription to get org context
      const { data: sub } = await supabaseAdmin
        .from("onedrive_subscriptions")
        .select("*")
        .eq("subscription_id", subscriptionId)
        .eq("state", "active")
        .single();

      if (sub) {
        console.log(`Processing notification for org ${sub.organization_id}, resource: ${resource}`);
        // Trigger a sync for this organization
        try {
          await syncFolderForOrg(supabaseAdmin, sub.organization_id, sub.delta_link);
        } catch (err) {
          console.error(`Error processing webhook for org ${sub.organization_id}:`, err);
        }
      }
    }
  }

  return new Response("", { status: 202 });
}

// ===== Create Microsoft Graph subscription =====
async function createSubscription(supabase: any, params: any) {
  const { organization_id } = params;
  if (!organization_id) return jsonResponse({ error: "organization_id required" }, 400);

  const accessToken = await getAccessToken(supabase, organization_id);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const notificationUrl = `${SUPABASE_URL}/functions/v1/onedrive-bank-sync`;

  // Get config to find folder
  const { data: configs } = await supabase
    .from("bank_import_configs")
    .select("onedrive_folder_incoming")
    .eq("organization_id", organization_id)
    .eq("is_active", true);

  // Subscribe to the user's entire drive for changes
  const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days

  const subRes = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      changeType: "updated",
      notificationUrl,
      resource: "/me/drive/root",
      expirationDateTime,
      clientState: `org_${organization_id}`,
    }),
  });

  if (!subRes.ok) {
    const errBody = await subRes.text();
    console.error("Subscription creation failed:", errBody);
    return jsonResponse({ error: "Failed to create subscription", details: errBody }, 500);
  }

  const subData = await subRes.json();

  // Save subscription
  await supabase.from("onedrive_subscriptions").upsert({
    organization_id,
    subscription_id: subData.id,
    resource: subData.resource,
    expiration_datetime: subData.expirationDateTime,
    state: "active",
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id" });

  return jsonResponse({
    success: true,
    subscription_id: subData.id,
    expires: subData.expirationDateTime,
  });
}

// ===== List OneDrive folders =====
async function listOneDriveFolders(supabase: any, params: any) {
  const { organization_id, path } = params;
  if (!organization_id) return jsonResponse({ error: "organization_id required" }, 400);

  const accessToken = await getAccessToken(supabase, organization_id);
  const folderPath = path || "/";
  const endpoint = folderPath === "/"
    ? "https://graph.microsoft.com/v1.0/me/drive/root/children"
    : `https://graph.microsoft.com/v1.0/me/drive/root:${folderPath}:/children`;

  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errBody = await res.text();
    return jsonResponse({ error: "Failed to list folders", details: errBody }, 500);
  }

  const data = await res.json();
  const items = (data.value || []).map((item: any) => ({
    id: item.id,
    name: item.name,
    isFolder: !!item.folder,
    path: item.parentReference?.path ? `${item.parentReference.path}/${item.name}` : `/${item.name}`,
    size: item.size,
    lastModified: item.lastModifiedDateTime,
  }));

  return jsonResponse({ items });
}

// ===== Sync folder using delta query =====
async function syncFolder(supabase: any, params: any) {
  const { organization_id } = params;
  if (!organization_id) return jsonResponse({ error: "organization_id required" }, 400);

  // Get existing delta link
  const { data: sub } = await supabase
    .from("onedrive_subscriptions")
    .select("delta_link")
    .eq("organization_id", organization_id)
    .single();

  const result = await syncFolderForOrg(supabase, organization_id, sub?.delta_link);
  return jsonResponse(result);
}

async function syncFolderForOrg(supabase: any, organizationId: string, deltaLink?: string) {
  const accessToken = await getAccessToken(supabase, organizationId);

  // Get bank configs with OneDrive folder settings
  const { data: configs } = await supabase
    .from("bank_import_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (!configs || configs.length === 0) {
    return { message: "No active bank configs found", new_files: 0 };
  }

  // Build set of monitored folder paths
  const monitoredFolders = new Map<string, any>();
  for (const config of configs) {
    if (config.onedrive_folder_incoming) {
      monitoredFolders.set(config.onedrive_folder_incoming.toLowerCase(), config);
    }
  }

  // Use delta query to get changes
  let deltaUrl = deltaLink || "https://graph.microsoft.com/v1.0/me/drive/root/delta";
  let newFiles: any[] = [];
  let newDeltaLink = "";

  while (deltaUrl) {
    const res = await fetch(deltaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Delta query failed:", errBody);
      throw new Error("Failed to query OneDrive delta");
    }

    const data = await res.json();

    // Check each changed item
    for (const item of (data.value || [])) {
      if (item.file && item.parentReference?.path) {
        const parentPath = item.parentReference.path.replace(/^\/drive\/root:?/, "").toLowerCase();
        const fullPath = `${parentPath}/${item.name}`.toLowerCase();

        // Check if this file is in a monitored folder
        for (const [folderPath, config] of monitoredFolders) {
          if (parentPath === folderPath.toLowerCase() || parentPath.endsWith(folderPath.toLowerCase())) {
            const ext = (item.name || "").split(".").pop()?.toLowerCase();
            if (["csv", "xlsx", "txt"].includes(ext || "")) {
              newFiles.push({
                fileId: item.id,
                fileName: item.name,
                filePath: `${item.parentReference.path}/${item.name}`,
                fileHash: item.file?.hashes?.sha256Hash || item.eTag || "",
                configId: config.id,
                size: item.size,
              });
            }
          }
        }
      }
    }

    deltaUrl = data["@odata.nextLink"] || "";
    if (data["@odata.deltaLink"]) {
      newDeltaLink = data["@odata.deltaLink"];
    }
  }

  // Save new delta link
  if (newDeltaLink) {
    await supabase
      .from("onedrive_subscriptions")
      .update({ delta_link: newDeltaLink, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId);
  }

  // Process new files - check for duplicates and create jobs
  let created = 0;
  let skipped = 0;

  for (const file of newFiles) {
    // Check duplicate by file_id or hash
    const { data: existing } = await supabase
      .from("bank_import_jobs")
      .select("id")
      .eq("organization_id", organizationId)
      .or(`onedrive_file_id.eq.${file.fileId},file_hash.eq.${file.fileHash}`)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    // Create job
    const { error: insertErr } = await supabase.from("bank_import_jobs").insert({
      organization_id: organizationId,
      bank_import_config_id: file.configId,
      onedrive_file_id: file.fileId,
      onedrive_file_name: file.fileName,
      onedrive_file_path: file.filePath,
      file_hash: file.fileHash,
      status: "PENDING",
    });

    if (!insertErr) created++;
  }

  return {
    success: true,
    total_changes: newFiles.length,
    new_jobs_created: created,
    duplicates_skipped: skipped,
  };
}

// ===== Download file from OneDrive and process =====
async function downloadAndProcess(supabase: any, params: any) {
  const { job_id, organization_id } = params;
  if (!job_id || !organization_id) {
    return jsonResponse({ error: "job_id and organization_id required" }, 400);
  }

  const { data: job } = await supabase
    .from("bank_import_jobs")
    .select("*")
    .eq("id", job_id)
    .single();

  if (!job || !job.onedrive_file_id) {
    return jsonResponse({ error: "Job not found or no OneDrive file ID" }, 404);
  }

  const accessToken = await getAccessToken(supabase, organization_id);

  // Update status
  await supabase
    .from("bank_import_jobs")
    .update({ status: "PROCESSING" })
    .eq("id", job_id);

  try {
    // Download file content
    const downloadRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${job.onedrive_file_id}/content`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!downloadRes.ok) {
      throw new Error(`Failed to download file: ${downloadRes.status}`);
    }

    const fileContent = await downloadRes.text();

    // Call process-bank-statement to process the content
    const processRes = await fetch(`${supabaseUrl}/functions/v1/process-bank-statement`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        action: "process_csv_content",
        job_id,
        csv_content: fileContent,
        organization_id,
        config_id: job.bank_import_config_id,
      }),
    });

    const processResult = await processRes.json();

    if (processResult.success) {
      // Auto-generate QBO CSV
      await fetch(`${supabaseUrl}/functions/v1/process-bank-statement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          action: "generate_qbo_csv",
          job_id,
          organization_id,
        }),
      });

      // Move file to Processed folder
      await moveOneDriveFile(supabase, accessToken, organization_id, job, "processed");
    } else {
      // Move file to Error folder
      await moveOneDriveFile(supabase, accessToken, organization_id, job, "error");
    }

    return jsonResponse(processResult);
  } catch (err) {
    console.error("Download and process error:", err);
    await supabase
      .from("bank_import_jobs")
      .update({ status: "ERROR", error_message: err.message })
      .eq("id", job_id);

    // Move to error folder
    try {
      const accessToken2 = await getAccessToken(supabase, organization_id);
      await moveOneDriveFile(supabase, accessToken2, organization_id, job, "error");
    } catch {}

    return jsonResponse({ error: err.message }, 500);
  }
}

// ===== Move file in OneDrive =====
async function moveOneDriveFile(
  supabase: any,
  accessToken: string,
  organizationId: string,
  job: any,
  destination: "processed" | "error"
) {
  const { data: config } = await supabase
    .from("bank_import_configs")
    .select("onedrive_folder_processed, onedrive_folder_error")
    .eq("id", job.bank_import_config_id)
    .single();

  if (!config) return;

  const targetFolder = destination === "processed"
    ? config.onedrive_folder_processed
    : config.onedrive_folder_error;

  if (!targetFolder) {
    console.log(`No ${destination} folder configured, skipping file move`);
    return;
  }

  try {
    // Get target folder ID
    const folderRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:${targetFolder}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!folderRes.ok) {
      // Try to create the folder
      const parts = targetFolder.split("/").filter(Boolean);
      const folderName = parts.pop()!;
      const parentPath = parts.length > 0 ? `/${parts.join("/")}` : "";

      const createRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/root:${parentPath}:/children`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: folderName,
            folder: {},
            "@microsoft.graph.conflictBehavior": "fail",
          }),
        }
      );

      if (!createRes.ok) {
        console.error(`Failed to create ${destination} folder`);
        return;
      }
    }

    const folderData = await (await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:${targetFolder}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )).json();

    // Move the file
    const moveRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${job.onedrive_file_id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parentReference: { id: folderData.id },
        }),
      }
    );

    if (moveRes.ok) {
      console.log(`File ${job.onedrive_file_name} moved to ${destination} folder`);
    } else {
      console.error(`Failed to move file: ${await moveRes.text()}`);
    }
  } catch (err) {
    console.error(`Error moving file to ${destination}:`, err);
  }
}
