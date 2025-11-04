import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, query } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id es requerido");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Obtener tokens de Gmail
    const { data: account, error: accountError } = await supabase
      .from("integration_accounts")
      .select("credentials, account_email")
      .eq("organization_id", organization_id)
      .eq("service_type", "gmail")
      .eq("is_active", true)
      .single();

    if (accountError || !account) {
      throw new Error("No se encontró cuenta de Gmail activa");
    }

    const credentials = account.credentials as any;
    const accessToken = credentials.access_token;

    // Buscar correos en Gmail
    const searchQuery = query || 'has:attachment (filename:xml OR filename:pdf OR filename:zip) newer_than:30d';
    const gmailSearchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=50`;

    const searchResponse = await fetch(gmailSearchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error("Gmail search error:", errorText);
      throw new Error(`Error al buscar correos: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages || [];

    console.log(`Found ${messages.length} messages`);

    // Obtener detalles de cada mensaje
    const messageDetails = await Promise.all(
      messages.slice(0, 20).map(async (msg: any) => {
        const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
        const detailResponse = await fetch(detailUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!detailResponse.ok) {
          console.error(`Error fetching message ${msg.id}`);
          return null;
        }

        const detail = await detailResponse.json();
        const headers = detail.payload.headers;
        
        const getHeader = (name: string) => {
          const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
          return header ? header.value : '';
        };

        const attachments = [];
        
        // Procesar adjuntos
        const processParts = (parts: any[]) => {
          if (!parts) return;
          
          for (const part of parts) {
            if (part.filename && part.body?.attachmentId) {
              const filename = part.filename.toLowerCase();
              if (filename.endsWith('.xml') || filename.endsWith('.pdf') || filename.endsWith('.zip')) {
                attachments.push({
                  filename: part.filename,
                  mimeType: part.mimeType,
                  size: part.body.size || 0,
                  attachmentId: part.body.attachmentId,
                });
              }
            }
            
            if (part.parts) {
              processParts(part.parts);
            }
          }
        };

        processParts([detail.payload]);

        return {
          id: msg.id,
          threadId: msg.threadId,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          date: getHeader('Date'),
          attachments,
        };
      })
    );

    const validMessages = messageDetails.filter((m) => m !== null);

    console.log(`Returning ${validMessages.length} valid messages`);

    return new Response(
      JSON.stringify({
        messages: validMessages,
        total: messages.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in fetch-gmail-invoices:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
