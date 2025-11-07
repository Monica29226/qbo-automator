import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Autenticar usuario
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

    console.log(`Publishing documents for organization: ${organization_id}`);

    // Obtener integración de QuickBooks
    const { data: qboAccount } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!qboAccount) {
      throw new Error("QuickBooks not connected");
    }

    const credentials = qboAccount.credentials as any;
    let accessToken = credentials.access_token;
    const refreshToken = credentials.refresh_token;
    const realmId = credentials.realm_id;
    const expiresAt = credentials.expires_at;

    // Refresh token si está expirado
    if (new Date(expiresAt) < new Date()) {
      console.log("Refreshing QuickBooks access token");
      const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${Deno.env.get("QBO_CLIENT_ID")}:${Deno.env.get("QBO_CLIENT_SECRET")}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to refresh QuickBooks token");
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;

      // Actualizar tokens en DB
      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          },
        })
        .eq("organization_id", organization_id)
        .eq("service_type", "quickbooks");
    }

    // Obtener documentos a publicar
    let query = supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .is("qbo_entity_id", null)
      .eq("status", "processed");

    if (document_ids && document_ids.length > 0) {
      query = query.in("id", document_ids);
    }

    const { data: documents, error: docError } = await query.limit(50);

    if (docError) throw docError;

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No documents to publish", published: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${documents.length} documents to publish`);

    const results = {
      published: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Helper para buscar vendor en QBO
    const findOrCreateVendor = async (supplierName: string, supplierTaxId: string) => {
      // Buscar vendor existente por DisplayName o PrimaryTaxIdentifier
      const searchQuery = `SELECT * FROM Vendor WHERE DisplayName = '${supplierName.replace(/'/g, "\\'")}'`;
      const searchUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(searchQuery)}`;

      const searchResponse = await fetch(searchUrl, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.QueryResponse?.Vendor?.length > 0) {
          return searchData.QueryResponse.Vendor[0].Id;
        }
      }

      // Crear vendor si no existe
      console.log(`Creating vendor: ${supplierName}`);
      const createResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            DisplayName: supplierName.substring(0, 100),
            PrimaryTaxIdentifier: supplierTaxId || undefined,
          }),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`Failed to create vendor: ${errorText}`);
        throw new Error(`Failed to create vendor: ${supplierName}`);
      }

      const vendorData = await createResponse.json();
      return vendorData.Vendor.Id;
    };

    // Helper para verificar duplicados en QBO
    const checkDuplicateBill = async (docNumber: string) => {
      const query = `SELECT * FROM Bill WHERE DocNumber = '${docNumber.replace(/'/g, "\\'")}'`;
      const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;

      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.QueryResponse?.Bill?.length > 0) {
          return data.QueryResponse.Bill[0].Id;
        }
      }
      return null;
    };

    // Procesar cada documento
    for (const doc of documents) {
      try {
        // Verificar duplicado en QBO
        const existingBillId = await checkDuplicateBill(doc.doc_number);
        if (existingBillId) {
          console.log(`Bill ${doc.doc_number} already exists in QuickBooks with ID: ${existingBillId}`);
          
          // Actualizar registro con el ID existente
          await supabase
            .from("processed_documents")
            .update({
              qbo_entity_id: existingBillId,
              qbo_entity_type: "Bill",
              status: "published",
              error_message: null,
            })
            .eq("id", doc.id);

          results.published++;
          continue;
        }

        // Obtener o crear vendor
        const vendorId = await findOrCreateVendor(doc.supplier_name, doc.supplier_tax_id);

        // Buscar cuenta contable del vendor
        const { data: vendorData } = await supabase
          .from("vendors")
          .select("default_account_ref")
          .eq("id", doc.vendor_id)
          .maybeSingle();

        const accountRef = vendorData?.default_account_ref || "1"; // Default a "Gastos sin clasificar" con ID 1

        // CRITICAL: Log document details for debugging
        console.log(`Processing document ${doc.doc_number}:`, {
          doc_id: doc.id,
          has_xml_data: !!doc.xml_data,
          detalle_length: doc.xml_data?.detalle?.length || 0,
          total_amount: doc.total_amount
        });

        // Preparar líneas del bill con validación robusta
        const lines = [];
        const xmlData = doc.xml_data as any;
        
        if (xmlData?.detalle && Array.isArray(xmlData.detalle) && xmlData.detalle.length > 0) {
          console.log(`Found ${xmlData.detalle.length} line items in xml_data`);
          for (const item of xmlData.detalle) {
            const amount = parseFloat(item.montoTotalLinea) || 0;
            if (amount > 0) {
              lines.push({
                DetailType: "AccountBasedExpenseLineDetail",
                Amount: amount,
                Description: (item.descripcion || item.detalle || "")?.substring(0, 4000) || `Línea ${lines.length + 1}`,
                AccountBasedExpenseLineDetail: {
                  AccountRef: {
                    value: accountRef,
                  },
                },
              });
            }
          }
        }
        
        // DOUBLE VALIDATION: Si aún no hay líneas, crear una línea por defecto con el total
        if (lines.length === 0) {
          console.warn(`⚠️ No valid lines found for ${doc.doc_number}, creating fallback line`);
          const amount = parseFloat(doc.total_amount as any) || 0;
          
          if (amount <= 0) {
            console.error(`Invalid total amount for ${doc.doc_number}: ${doc.total_amount}`);
            throw new Error(`Invalid total amount: ${doc.total_amount}. Cannot create bill without valid amount.`);
          }
          
          lines.push({
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: amount,
            Description: `Factura ${doc.doc_number} - ${doc.supplier_name}`,
            AccountBasedExpenseLineDetail: {
              AccountRef: {
                value: accountRef,
              },
            },
          });
          console.log(`✓ Created fallback line with amount: ${amount}`);
        }
        
        console.log(`✓ Final line count for ${doc.doc_number}: ${lines.length} line(s), total: ${lines.reduce((sum, l) => sum + l.Amount, 0)}`);

        // Preparar DocNumber - QuickBooks acepta máx 21 caracteres
        // Pero guardamos el número completo en PrivateNote
        const qboDocNumber = doc.doc_number.length > 21 
          ? doc.doc_number.substring(doc.doc_number.length - 21) // Últimos 21 caracteres
          : doc.doc_number;

        // FINAL VALIDATION before sending to QuickBooks
        if (!lines || lines.length === 0) {
          console.error(`❌ Cannot create bill without line items for doc ${doc.doc_number}`);
          throw new Error(`Cannot create bill without line items for doc ${doc.doc_number}`);
        }

        // Crear Bill en QuickBooks
        const billPayload = {
          VendorRef: {
            value: vendorId,
          },
          TxnDate: doc.issue_date,
          DocNumber: qboDocNumber,
          Line: lines,
          DueDate: doc.issue_date,
          PrivateNote: `Factura XML: ${doc.doc_number}\nProveedor: ${doc.supplier_name}\nImportado automáticamente`,
        };

        console.log(`Creating bill in QuickBooks for ${doc.doc_number} with ${lines.length} line(s)`);

        const billResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(billPayload),
          }
        );

        if (!billResponse.ok) {
          const errorText = await billResponse.text();
          console.error(`Failed to create bill: ${errorText}`);
          
          await supabase
            .from("processed_documents")
            .update({
              status: "error",
              error_message: `QBO Error: ${errorText.substring(0, 500)}`,
            })
            .eq("id", doc.id);

          results.failed++;
          results.errors.push({
            doc_number: doc.doc_number,
            error: errorText.substring(0, 200),
          });
          continue;
        }

        const billData = await billResponse.json();
        const billId = billData.Bill.Id;

        console.log(`Successfully created bill ${doc.doc_number} with ID: ${billId}`);

        // Adjuntar PDF si existe
        if (doc.pdf_attachment_url) {
          try {
            console.log(`Attaching PDF for bill ${doc.doc_number}`);
            
            // Descargar el PDF del storage
            const { data: pdfData } = await supabase.storage
              .from("company-documents")
              .download(doc.pdf_attachment_url.replace(/^.*\/company-documents\//, ""));

            if (pdfData) {
              // Convertir blob a base64
              const arrayBuffer = await pdfData.arrayBuffer();
              const base64Pdf = btoa(
                new Uint8Array(arrayBuffer).reduce(
                  (data, byte) => data + String.fromCharCode(byte),
                  ""
                )
              );

              // Crear attachment en QuickBooks
              const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
              const attachmentMetadata = {
                AttachableRef: [
                  {
                    EntityRef: {
                      type: "Bill",
                      value: billId,
                    },
                  },
                ],
                FileName: `factura_${doc.doc_number}.pdf`,
                ContentType: "application/pdf",
              };

              const attachmentBody = [
                `--${boundary}`,
                'Content-Disposition: form-data; name="file_metadata_0"',
                "Content-Type: application/json",
                "",
                JSON.stringify(attachmentMetadata),
                `--${boundary}`,
                `Content-Disposition: form-data; name="file_content_0"; filename="factura_${doc.doc_number}.pdf"`,
                "Content-Type: application/pdf",
                "Content-Transfer-Encoding: base64",
                "",
                base64Pdf,
                `--${boundary}--`,
              ].join("\r\n");

              const attachResponse = await fetch(
                `https://quickbooks.api.intuit.com/v3/company/${realmId}/upload`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/json",
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                  },
                  body: attachmentBody,
                }
              );

              if (attachResponse.ok) {
                console.log(`PDF attached successfully to bill ${doc.doc_number}`);
              } else {
                const errorText = await attachResponse.text();
                console.error(`Failed to attach PDF: ${errorText}`);
              }
            }
          } catch (pdfError) {
            console.error(`Error attaching PDF for ${doc.doc_number}:`, pdfError);
            // No fallar la publicación si falla el adjunto
          }
        }

        // Actualizar documento con QBO ID
        await supabase
          .from("processed_documents")
          .update({
            qbo_entity_id: billId,
            qbo_entity_type: "Bill",
            status: "published",
            error_message: null,
          })
          .eq("id", doc.id);

        results.published++;
      } catch (error) {
        console.error(`❌ Error processing document ${doc.doc_number}:`, error);
        
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        // Enhanced error message for missing line parameter
        let enhancedMessage = errorMessage;
        if (errorMessage.toLowerCase().includes("line") && errorMessage.toLowerCase().includes("required")) {
          const xmlData = doc.xml_data as any;
          enhancedMessage = `Falta el parámetro Line requerido. Detalle: ${xmlData?.detalle?.length || 0} líneas en XML, totalComprobante: ${doc.total_amount || 0}`;
          console.error(`Line parameter error details for ${doc.doc_number}:`, {
            docNumber: doc.doc_number,
            xmlDataDetalle: xmlData?.detalle?.length || 0,
            totalComprobante: doc.total_amount,
            xmlDataStructure: xmlData ? Object.keys(xmlData) : []
          });
        }
        
        await supabase
          .from("processed_documents")
          .update({
            status: "error",
            error_message: enhancedMessage.substring(0, 500),
          })
          .eq("id", doc.id);

        results.failed++;
        results.errors.push({
          doc_number: doc.doc_number,
          error: enhancedMessage,
        });
      }
    }

    console.log(`Publishing complete: ${results.published} published, ${results.failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        published: results.published,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in publish-to-quickbooks:", error);
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
