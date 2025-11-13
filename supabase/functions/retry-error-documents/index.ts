import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to get Gmail credentials
async function getGmailCredentials(supabase: any, organizationId: string) {
  const { data: accounts, error } = await supabase
    .from("integration_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("service_type", "gmail")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !accounts || accounts.length === 0) {
    throw new Error("No active Gmail account found");
  }

  const account = accounts[0];
  const credentials = account.credentials;

  // Check if token needs refresh
  const expiresAt = new Date(credentials.expires_at).getTime();
  const now = Date.now();

  if (now >= expiresAt - 5 * 60 * 1000) {
    // Refresh token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error("Failed to refresh Gmail token");
    }

    const tokenData = await tokenResponse.json();
    credentials.access_token = tokenData.access_token;
    credentials.expires_at = new Date(now + tokenData.expires_in * 1000).toISOString();

    // Update credentials in DB
    await supabase
      .from("integration_accounts")
      .update({ credentials })
      .eq("id", account.id);
  }

  return credentials.access_token;
}

// Helper function to search Gmail for document and download XML/PDF
async function searchGmailForDocument(
  accessToken: string,
  docNumber: string,
  supabase: any,
  organizationId: string
): Promise<{ xmlContent: string; pdfUrl: string | null; xmlUrl: string | null } | null> {
  try {
    console.log(`🔍 Searching Gmail for document: ${docNumber}`);
    
    // Search for emails with XML attachment containing the doc number
    const searchQuery = encodeURIComponent(`has:attachment filename:xml "${docNumber}"`);
    const searchResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${searchQuery}&maxResults=5`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!searchResponse.ok) {
      console.error(`Gmail search failed: ${searchResponse.status}`);
      return null;
    }

    const searchData = await searchResponse.json();
    if (!searchData.messages || searchData.messages.length === 0) {
      console.log(`❌ No messages found in Gmail for: ${docNumber}`);
      return null;
    }

    // Get the first message details
    const messageId = searchData.messages[0].id;
    const messageResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!messageResponse.ok) {
      console.error(`Failed to fetch message: ${messageResponse.status}`);
      return null;
    }

    const messageData = await messageResponse.json();
    let xmlContent = "";
    let pdfUrl: string | null = null;
    let xmlUrl: string | null = null;

    // Process attachments
    for (const part of messageData.payload.parts || []) {
      const filename = part.filename || "";
      const mimeType = part.mimeType || "";
      
      if (!part.body?.attachmentId) continue;

      // Download attachment
      const attachmentResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!attachmentResponse.ok) continue;

      const attachmentData = await attachmentResponse.json();
      const fileContent = Uint8Array.from(atob(attachmentData.data.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

      // Handle XML
      if (filename.toLowerCase().endsWith(".xml") || mimeType.includes("xml")) {
        xmlContent = new TextDecoder().decode(fileContent);
        console.log(`✓ XML found: ${filename}`);

        // Save XML to storage
        const xmlPath = `${organizationId}/${docNumber}.xml`;
        const { error: uploadError } = await supabase.storage
          .from("company-documents")
          .upload(xmlPath, fileContent, {
            contentType: "application/xml",
            upsert: true,
          });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from("company-documents")
            .getPublicUrl(xmlPath);
          xmlUrl = urlData.publicUrl;
          console.log(`✓ XML saved to storage: ${xmlPath}`);
        }
      }

      // Handle PDF
      if (filename.toLowerCase().endsWith(".pdf") || mimeType === "application/pdf") {
        const pdfPath = `${organizationId}/${docNumber}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("company-documents")
          .upload(pdfPath, fileContent, {
            contentType: "application/pdf",
            upsert: true,
          });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from("company-documents")
            .getPublicUrl(pdfPath);
          pdfUrl = urlData.publicUrl;
          console.log(`✓ PDF saved to storage: ${pdfPath}`);
        }
      }
    }

    if (!xmlContent) {
      console.log(`❌ No XML content found in message`);
      return null;
    }

    return { xmlContent, pdfUrl, xmlUrl };
  } catch (error) {
    console.error(`Error searching Gmail:`, error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      throw new Error("Authentication failed");
    }

    const { organization_id, document_ids } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    console.log(`Retrying error documents for organization: ${organization_id}`);

    // Obtener documentos con error
    let query = supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("status", "error");

    if (document_ids && document_ids.length > 0) {
      query = query.in("id", document_ids);
    }

    const { data: errorDocs, error: fetchError } = await query;

    if (fetchError) throw fetchError;

    if (!errorDocs || errorDocs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No error documents to retry", fixed: 0, published: 0, skipped: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${errorDocs.length} error documents to retry`);

    const results = {
      fixed: 0,
      published: 0,
      skipped_duplicates: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Get Gmail credentials once for all documents
    let gmailAccessToken: string | null = null;
    try {
      gmailAccessToken = await getGmailCredentials(supabase, organization_id);
      console.log(`✓ Gmail credentials obtained`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.log(`⚠ Could not get Gmail credentials: ${errorMsg}`);
    }

    // Intentar re-procesar y publicar cada documento
    for (const doc of errorDocs) {
      console.log(`\n=== Processing document ${doc.doc_number} (retry ${doc.retry_count || 0}) ===`);
      
      try {
        // Check retry limit
        if ((doc.retry_count || 0) >= 3) {
          console.log(`⚠ Document ${doc.doc_number} has reached max retries, skipping`);
          await supabase
            .from("processed_documents")
            .update({ 
              status: "error",
              error_message: "[PERMANENTE] Max retries reached (3 attempts)"
            })
            .eq("id", doc.id);
          results.failed++;
          continue;
        }

        // Detectar duplicados - skip y marcar como duplicado
        if (doc.error_message?.includes("duplicate") || doc.error_message?.includes("duplicado")) {
          console.log(`✓ Duplicate detected: ${doc.doc_number} - marking as duplicate (skip)`);
          
          await supabase
            .from("processed_documents")
            .update({ 
              status: "duplicate",
              error_message: "Documento duplicado - ya existe en QuickBooks"
            })
            .eq("id", doc.id);
          
          results.skipped_duplicates++;
          continue;
        }

        // Si el documento YA TIENE xml_data, simplemente intentar publicarlo sin re-procesar
        if (doc.xml_data && Object.keys(doc.xml_data).length > 0) {
          console.log(`✓ Document already has parsed XML data, attempting direct publish: ${doc.doc_number}`);
          
          // Incrementar retry_count
          await supabase
            .from("processed_documents")
            .update({ 
              retry_count: (doc.retry_count || 0) + 1,
              status: "pending", // Cambiar a pending para que publish-to-quickbooks lo procese
              error_message: null
            })
            .eq("id", doc.id);

          // Intentar publicar directamente
          const { data: publishData, error: publishError } = await supabase.functions.invoke(
            "publish-to-quickbooks",
            {
              body: {
                organization_id: organization_id,
                document_ids: [doc.id],
              },
              headers: {
                Authorization: authHeader,
              },
            }
          );

          if (publishError) {
            console.log(`✗ Publication failed for ${doc.doc_number}:`, publishError);
            results.failed++;
            results.errors.push({
              doc_number: doc.doc_number,
              error: publishError.message || "Unknown publication error",
            });
          } else if (publishData?.published > 0) {
            console.log(`✓ Successfully published: ${doc.doc_number}`);
            results.published++;
          } else if (publishData?.failed > 0) {
            console.log(`✗ Publication failed: ${doc.doc_number}`);
            const errorMsg = publishData.errors?.[0]?.error || "Unknown publication error";
            results.failed++;
            results.errors.push({
              doc_number: doc.doc_number,
              error: errorMsg,
            });
          }
          continue; // Pasar al siguiente documento
        }

        // Si NO tiene xml_data, intentar recuperar y re-procesar
        let xmlContent = "";
        let pdfUrl = doc.pdf_attachment_url;
        let xmlUrl = doc.xml_attachment_url;

        console.log(`→ Document needs re-processing (no xml_data): ${doc.doc_number}`);

        // Si no hay xml_attachment_url, intentar recuperar de Gmail
        if (!doc.xml_attachment_url && gmailAccessToken) {
          console.log(`⚠ No XML URL found, attempting Gmail recovery...`);
          
          const gmailResult = await searchGmailForDocument(
            gmailAccessToken,
            doc.doc_number,
            supabase,
            organization_id
          );

          if (gmailResult) {
            xmlContent = gmailResult.xmlContent;
            pdfUrl = gmailResult.pdfUrl || pdfUrl;
            xmlUrl = gmailResult.xmlUrl || xmlUrl;
            console.log(`✓ Document recovered from Gmail`);
          } else {
            throw new Error("Could not recover document from Gmail - not found");
          }
        } else if (!doc.xml_attachment_url) {
          throw new Error("No XML URL and Gmail credentials unavailable");
        }

        // Primero, eliminar el documento con error de la BD
        await supabase
          .from("processed_documents")
          .delete()
          .eq("id", doc.id);

        // Re-procesar usando process-document-xml
        if (doc.xml_attachment_url || xmlContent) {
          try {
            // Descargar el XML si no lo tenemos ya
            if (!xmlContent) {
              const xmlResponse = await fetch(doc.xml_attachment_url);
              if (!xmlResponse.ok) {
                throw new Error(`Failed to fetch XML: ${xmlResponse.statusText}`);
              }
              xmlContent = await xmlResponse.text();
            }

            // Re-procesar con process-document-xml
            const { data: reprocessData, error: reprocessError } = await supabase.functions.invoke(
              "process-document-xml",
              {
                body: {
                  organization_id: organization_id,
                  xml_content: xmlContent,
                  pdf_url: pdfUrl,
                  xml_url: xmlUrl,
                },
              }
            );

            if (reprocessError) throw reprocessError;

            if (reprocessData?.success && reprocessData?.documentId) {
              console.log(`✓ Document re-processed: ${doc.doc_number}`);
              results.fixed++;

              // Ahora intentar publicar el nuevo documento
              const { data: publishData, error: publishError } = await supabase.functions.invoke(
                "publish-to-quickbooks",
                {
                  body: {
                    organization_id: organization_id,
                    document_ids: [reprocessData.documentId],
                  },
                  headers: {
                    Authorization: authHeader,
                  },
                }
              );

              if (publishError) throw publishError;

              if (publishData?.published > 0) {
                console.log(`✓ Successfully published: ${doc.doc_number}`);
                results.published++;
              } else if (publishData?.failed > 0) {
                console.log(`✗ Publication failed: ${doc.doc_number}`);
                const errorMsg = publishData.errors?.[0]?.error || "Unknown publication error";
                results.failed++;
                results.errors.push({
                  doc_number: doc.doc_number,
                  error: errorMsg,
                });
              }
            } else {
              throw new Error(reprocessData?.error || "Re-processing failed");
            }
          } catch (xmlError: any) {
            console.error(`✗ Error re-processing ${doc.doc_number}:`, xmlError);
            
            // Update existing document with error (don't create duplicate)
            await supabase
              .from("processed_documents")
              .insert({
                ...doc,
                error_message: `Re-processing failed: ${xmlError.message}`,
                retry_count: (doc.retry_count || 0) + 1,
                updated_at: new Date().toISOString(),
              });
            
            results.failed++;
            results.errors.push({
              doc_number: doc.doc_number,
              error: xmlError.message,
            });
          }
        } else {
          throw new Error("No XML content available for re-processing");
        }

      } catch (error) {
        console.error(`✗ Failed to process document ${doc.doc_number}:`, error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        // Update existing document with error (don't create duplicate)
        await supabase
          .from("processed_documents")
          .update({
            error_message: `Retry failed: ${errorMessage}`,
            retry_count: (doc.retry_count || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id);
        
        results.failed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: errorMessage,
        });
      }
    }

    console.log(`\n=== Retry Summary ===`);
    console.log(`Fixed: ${results.fixed}`);
    console.log(`Published: ${results.published}`);
    console.log(`Skipped (duplicates): ${results.skipped_duplicates}`);
    console.log(`Failed: ${results.failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        fixed: results.fixed,
        published: results.published,
        skipped_duplicates: results.skipped_duplicates,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in retry-error-documents:", error);
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
