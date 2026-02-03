import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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

    const { organization_id, doc_number, document_id } = await req.json();
    if (!organization_id || !doc_number) {
      throw new Error("organization_id and doc_number are required");
    }

    console.log(`🔍 Buscando PDF para documento ${doc_number} en Gmail...`);

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
      throw new Error("No hay cuenta de Gmail conectada");
    }

    const credentials = gmailAccount.credentials as any;
    if (!credentials?.access_token) {
      throw new Error("No hay token de acceso de Gmail");
    }

    // Función para renovar el token si es necesario
    const refreshGmailToken = async (): Promise<string> => {
      console.log("🔄 Renovando token de Gmail...");
      
      const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
      const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        throw new Error("Credenciales de Google no configuradas");
      }

      if (!credentials.refresh_token) {
        throw new Error("No hay refresh token - reconecte Gmail");
      }

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
        throw new Error("Error al renovar token de Gmail");
      }

      const refreshData = await refreshResponse.json();
      
      // Actualizar credenciales
      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: refreshData.access_token,
            expires_at: Date.now() + (refreshData.expires_in * 1000),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", gmailAccount.id);

      return refreshData.access_token;
    };

    // Obtener token válido
    let accessToken = credentials.access_token;
    const expiresAt = credentials.expires_at || 0;
    
    if (Date.now() > expiresAt - 60000) {
      accessToken = await refreshGmailToken();
    }

    // Buscar el email con el documento
    const searchQuery = `has:attachment filename:pdf ${doc_number}`;
    console.log(`📧 Buscando en Gmail: ${searchQuery}`);
    
    const searchResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=5`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!searchResponse.ok) {
      if (searchResponse.status === 401) {
        accessToken = await refreshGmailToken();
        // Reintentar búsqueda
        const retryResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=5`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (!retryResponse.ok) {
          throw new Error("Error al buscar en Gmail después de renovar token");
        }
      } else {
        throw new Error(`Error al buscar en Gmail: ${searchResponse.status}`);
      }
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages || [];
    
    if (messages.length === 0) {
      console.log(`❌ No se encontró email con PDF para ${doc_number}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "No se encontró el PDF en Gmail. Es posible que el email original no tuviera PDF adjunto." 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    // Función para encontrar todas las partes del mensaje
    const findAllParts = (payload: any): any[] => {
      const parts: any[] = [];
      
      const traverse = (part: any) => {
        if (part.filename && part.body?.attachmentId) {
          parts.push(part);
        }
        if (part.parts) {
          for (const subPart of part.parts) {
            traverse(subPart);
          }
        }
      };
      
      traverse(payload);
      return parts;
    };

    // Procesar mensajes buscando el PDF
    for (const message of messages) {
      try {
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!messageResponse.ok) continue;

        const messageData = await messageResponse.json();
        const allParts = findAllParts(messageData.payload);
        
        // Buscar PDF
        const pdfPart = allParts.find((p: any) => 
          p.filename?.toLowerCase().endsWith(".pdf")
        );

        if (!pdfPart?.body?.attachmentId) continue;

        console.log(`📥 Descargando PDF: ${pdfPart.filename}`);

        // Descargar el PDF
        const pdfAttachmentResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/attachments/${pdfPart.body.attachmentId}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!pdfAttachmentResponse.ok) {
          console.error(`Error descargando PDF: ${pdfAttachmentResponse.status}`);
          continue;
        }

        const pdfAttachmentData = await pdfAttachmentResponse.json();
        const pdfBase64 = pdfAttachmentData.data.replace(/-/g, "+").replace(/_/g, "/");
        
        // Decodificar base64 a bytes
        const pdfBinary = atob(pdfBase64);
        const pdfBytes = new Uint8Array(pdfBinary.length);
        for (let i = 0; i < pdfBinary.length; i++) {
          pdfBytes[i] = pdfBinary.charCodeAt(i);
        }

        // Guardar en Supabase Storage
        const pdfPath = `${organization_id}/${doc_number}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("company-documents")
          .upload(pdfPath, pdfBytes, {
            contentType: "application/pdf",
            upsert: true
          });

        if (uploadError) {
          console.error(`Error subiendo PDF:`, uploadError);
          throw new Error(`Error al guardar PDF: ${uploadError.message}`);
        }

        // Guardar ruta RELATIVA (bucket privado)
        const pdfUrl = pdfPath;
        console.log(`✅ PDF guardado: ${pdfPath}`);

        // Actualizar el documento con la ruta del PDF
        if (document_id) {
          const { error: updateError } = await supabase
            .from("processed_documents")
            .update({ 
              pdf_attachment_url: pdfUrl,
              updated_at: new Date().toISOString()
            })
            .eq("id", document_id);

          if (updateError) {
            console.error(`Error actualizando documento:`, updateError);
          } else {
            console.log(`📝 Documento actualizado con URL del PDF`);
          }
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            pdf_url: pdfUrl,
            storage_path: pdfPath,
            message: "PDF descargado y guardado exitosamente"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (msgError) {
        console.error(`Error procesando mensaje ${message.id}:`, msgError);
        continue;
      }
    }

    // Si llegamos aquí, no encontramos PDF en ningún mensaje
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "Se encontraron emails pero ninguno tiene un PDF adjunto válido" 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
    );

  } catch (error: unknown) {
    console.error("❌ Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Error al descargar PDF";
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
