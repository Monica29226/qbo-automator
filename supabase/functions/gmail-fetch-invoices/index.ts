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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) throw new Error("Invalid authorization");

    const { organization_id } = await req.json();
    if (!organization_id) throw new Error("organization_id required");

    console.log(`Fetching Gmail invoices for organization ${organization_id}`);

    // Obtener cuenta de Gmail activa
    const { data: gmailAccount, error: accountError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("service_type", "gmail")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (accountError || !gmailAccount) {
      throw new Error("No active Gmail account found");
    }

    const credentials = gmailAccount.credentials as any;
    if (!credentials?.access_token) {
      throw new Error("No access token found");
    }

    // Verificar si el token está expirado y renovarlo si es necesario
    let accessToken = credentials.access_token;
    if (credentials.expires_at && Date.now() > credentials.expires_at) {
      console.log("Access token expired, refreshing...");
      
      const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
      const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

      const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: credentials.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!refreshResponse.ok) {
        throw new Error("Failed to refresh token");
      }

      const newTokens = await refreshResponse.json();
      accessToken = newTokens.access_token;

      // Actualizar tokens en DB
      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: newTokens.access_token,
            expires_at: Date.now() + (newTokens.expires_in * 1000),
          },
        })
        .eq("id", gmailAccount.id);
    }

    // Obtener settings de búsqueda
    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("organization_id", organization_id)
      .in("key", ["mail_query"]);

    const mailQuery = settings?.find(s => s.key === "mail_query")?.value || 
      "has:attachment (filename:xml OR filename:pdf) newer_than:7d";

    // Buscar mensajes en Gmail
    const searchResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(mailQuery)}&maxResults=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!searchResponse.ok) {
      throw new Error("Failed to search Gmail messages");
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages || [];
    
    console.log(`Found ${messages.length} messages matching query`);

    const processedMessages = [];

    // Procesar cada mensaje
    for (const message of messages.slice(0, 20)) { // Limitar a 20 por ejecución
      try {
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!messageResponse.ok) continue;

        const messageData = await messageResponse.json();
        const parts = messageData.payload?.parts || [];

        // Buscar archivos adjuntos XML
        for (const part of parts) {
          if (part.filename?.toLowerCase().endsWith(".xml")) {
            const attachmentId = part.body?.attachmentId;
            if (!attachmentId) continue;

            // Descargar archivo adjunto
            const attachmentResponse = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/attachments/${attachmentId}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );

            if (!attachmentResponse.ok) continue;

            const attachmentData = await attachmentResponse.json();
            const xmlContent = atob(attachmentData.data.replace(/-/g, "+").replace(/_/g, "/"));

            processedMessages.push({
              message_id: message.id,
              filename: part.filename,
              xml_content: xmlContent,
              size: part.body?.size || 0,
            });
          }
        }
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        messages_found: messages.length,
        invoices_extracted: processedMessages.length,
        invoices: processedMessages,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in gmail-fetch-invoices:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
