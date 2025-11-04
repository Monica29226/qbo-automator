import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id } = await req.json();

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Obtener cuenta de Gmail activa
    const { data: gmailAccount, error: accountError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("service_type", "gmail")
      .eq("is_active", true)
      .single();

    if (accountError || !gmailAccount) {
      return new Response(
        JSON.stringify({ error: "No hay cuenta de Gmail conectada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const credentials = gmailAccount.credentials as any;
    let accessToken = credentials.access_token;

    // Verificar si el token expiró y renovarlo si es necesario
    if (credentials.expires_at && Date.now() > credentials.expires_at) {
      console.log("Access token expired, refreshing...");
      
      const { data: oauthCreds } = await supabase
        .from("oauth_credentials")
        .select("client_id, client_secret")
        .eq("organization_id", organization_id)
        .eq("provider", "google")
        .single();

      if (oauthCreds && credentials.refresh_token) {
        const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: oauthCreds.client_id,
            client_secret: oauthCreds.client_secret,
            refresh_token: credentials.refresh_token,
            grant_type: "refresh_token",
          }),
        });

        if (refreshResponse.ok) {
          const tokens = await refreshResponse.json();
          accessToken = tokens.access_token;
          
          // Actualizar tokens en la base de datos
          await supabase
            .from("integration_accounts")
            .update({
              credentials: {
                ...credentials,
                access_token: tokens.access_token,
                expires_at: Date.now() + (tokens.expires_in * 1000),
              },
            })
            .eq("id", gmailAccount.id);
        }
      }
    }

    // Buscar correos con adjuntos XML o PDF
    const query = "has:attachment (filename:xml OR filename:pdf) is:unread";
    const gmailResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text();
      console.error("Gmail API error:", errorText);
      return new Response(
        JSON.stringify({ error: "Error al buscar correos en Gmail" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gmailData = await gmailResponse.json();
    const messages = gmailData.messages || [];

    console.log(`Found ${messages.length} messages with attachments`);

    const processedCount = 0;
    const errors: string[] = [];

    // Procesar cada mensaje
    for (const message of messages.slice(0, 10)) { // Limitar a 10 por ejecución
      try {
        // Obtener detalles del mensaje
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!messageResponse.ok) continue;

        const messageData = await messageResponse.json();
        
        // Buscar adjuntos XML
        const parts = messageData.payload.parts || [];
        for (const part of parts) {
          if (part.filename && (part.filename.endsWith(".xml") || part.filename.endsWith(".pdf"))) {
            // Obtener el adjunto
            if (part.body.attachmentId) {
              const attachmentResponse = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/attachments/${part.body.attachmentId}`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                }
              );

              if (attachmentResponse.ok) {
                const attachmentData = await attachmentResponse.json();
                
                // Llamar a process-document para procesar el archivo
                await supabase.functions.invoke("process-document", {
                  body: {
                    organization_id,
                    file_data: attachmentData.data,
                    file_name: part.filename,
                    source: "gmail",
                    message_id: message.id,
                  },
                });
              }
            }
          }
        }

        // Marcar mensaje como leído
        await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/modify`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              removeLabelIds: ["UNREAD"],
            }),
          }
        );
      } catch (error) {
        console.error("Error processing message:", error);
        errors.push(message.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        messages_found: messages.length,
        processed: processedCount,
        errors: errors.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fetch-gmail-invoices:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
