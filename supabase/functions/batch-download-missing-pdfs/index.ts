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

    const { organization_id, limit = 50 } = await req.json();
    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    console.log(`🔍 Buscando documentos sin PDF para organización ${organization_id}...`);

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

    // Buscar documentos pendientes sin PDF o con PDF faltante
    const { data: documents, error: docsError } = await supabase
      .from("processed_documents")
      .select("id, doc_number, doc_key, pdf_attachment_url, file_path, status")
      .eq("organization_id", organization_id)
      .in("status", ["pending", "review", "pending_config", "error"])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (docsError) {
      throw new Error(`Error al obtener documentos: ${docsError.message}`);
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No hay documentos pendientes",
          processed: 0,
          downloaded: 0,
          failed: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Encontrados ${documents.length} documentos para verificar`);

    // Verificar cuáles realmente no tienen PDF en storage
    const documentsWithoutPdf: typeof documents = [];
    
    for (const doc of documents) {
      // Si no tiene URL de PDF, definitivamente falta
      if (!doc.pdf_attachment_url) {
        documentsWithoutPdf.push(doc);
        continue;
      }

      // Verificar si el archivo existe en storage
      const pdfPath = `${organization_id}/${doc.doc_number}.pdf`;
      const { data: fileData, error: fileError } = await supabase.storage
        .from("company-documents")
        .list(organization_id, {
          search: `${doc.doc_number}.pdf`
        });

      if (fileError || !fileData || fileData.length === 0) {
        documentsWithoutPdf.push(doc);
      }
    }

    console.log(`📥 ${documentsWithoutPdf.length} documentos sin PDF en storage`);

    if (documentsWithoutPdf.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Todos los documentos tienen su PDF",
          processed: documents.length,
          downloaded: 0,
          failed: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    // Procesar cada documento
    const results = {
      downloaded: 0,
      failed: 0,
      notFound: 0,
      details: [] as { doc_number: string; status: string; error?: string }[]
    };

    for (const doc of documentsWithoutPdf) {
      try {
        console.log(`🔍 Buscando PDF para ${doc.doc_number}...`);

        // Buscar el email con el documento
        const searchQuery = `has:attachment filename:pdf ${doc.doc_number}`;
        
        const searchResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=5`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!searchResponse.ok) {
          if (searchResponse.status === 401) {
            accessToken = await refreshGmailToken();
          } else {
            throw new Error(`Error de Gmail: ${searchResponse.status}`);
          }
        }

        const searchData = await searchResponse.json();
        const messages = searchData.messages || [];
        
        if (messages.length === 0) {
          console.log(`❌ No se encontró email para ${doc.doc_number}`);
          results.notFound++;
          results.details.push({ doc_number: doc.doc_number, status: "not_found" });
          continue;
        }

        let pdfDownloaded = false;

        // Procesar mensajes buscando el PDF
        for (const message of messages) {
          if (pdfDownloaded) break;

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

            // Descargar el PDF
            const pdfAttachmentResponse = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/attachments/${pdfPart.body.attachmentId}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );

            if (!pdfAttachmentResponse.ok) continue;

            const pdfAttachmentData = await pdfAttachmentResponse.json();
            const pdfBase64 = pdfAttachmentData.data.replace(/-/g, "+").replace(/_/g, "/");
            
            // Decodificar base64 a bytes
            const pdfBinary = atob(pdfBase64);
            const pdfBytes = new Uint8Array(pdfBinary.length);
            for (let i = 0; i < pdfBinary.length; i++) {
              pdfBytes[i] = pdfBinary.charCodeAt(i);
            }

            // Guardar en Supabase Storage
            const pdfPath = `${organization_id}/${doc.doc_number}.pdf`;
            const { error: uploadError } = await supabase.storage
              .from("company-documents")
              .upload(pdfPath, pdfBytes, {
                contentType: "application/pdf",
                upsert: true
              });

            if (uploadError) {
              console.error(`Error subiendo PDF para ${doc.doc_number}:`, uploadError);
              continue;
            }

            // Generar URL pública
            const { data: urlData } = supabase.storage
              .from("company-documents")
              .getPublicUrl(pdfPath);
            
            const pdfUrl = urlData.publicUrl;

            // Actualizar el documento con la URL del PDF
            await supabase
              .from("processed_documents")
              .update({ 
                pdf_attachment_url: pdfUrl,
                updated_at: new Date().toISOString()
              })
              .eq("id", doc.id);

            console.log(`✅ PDF descargado para ${doc.doc_number}`);
            results.downloaded++;
            results.details.push({ doc_number: doc.doc_number, status: "downloaded" });
            pdfDownloaded = true;
          } catch (msgError) {
            console.error(`Error procesando mensaje para ${doc.doc_number}:`, msgError);
          }
        }

        if (!pdfDownloaded) {
          results.notFound++;
          results.details.push({ 
            doc_number: doc.doc_number, 
            status: "not_found",
            error: "PDF no encontrado en emails"
          });
        }

        // Pequeña pausa para no saturar la API de Gmail
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (docError: any) {
        console.error(`Error procesando ${doc.doc_number}:`, docError);
        results.failed++;
        results.details.push({ 
          doc_number: doc.doc_number, 
          status: "error",
          error: docError.message 
        });
      }
    }

    console.log(`📊 Resultados: ${results.downloaded} descargados, ${results.notFound} no encontrados, ${results.failed} errores`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Proceso completado`,
        processed: documentsWithoutPdf.length,
        downloaded: results.downloaded,
        notFound: results.notFound,
        failed: results.failed,
        details: results.details
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("❌ Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Error al procesar PDFs";
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
