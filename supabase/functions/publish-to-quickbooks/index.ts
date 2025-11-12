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
      // Normalizar nombre del proveedor para evitar problemas de encoding
      const normalizedName = supplierName
        .normalize('NFD')  // Descomponer caracteres con acentos
        .replace(/[\u0300-\u036f]/g, '')  // Remover marcas diacríticas
        .substring(0, 100)
        .trim();
      
      console.log(`Searching/creating vendor: "${supplierName}" (normalized: "${normalizedName}")`);
      
      // Buscar vendor existente primero con nombre original
      let searchQuery = `SELECT * FROM Vendor WHERE DisplayName = '${supplierName.replace(/'/g, "\\'")}'`;
      let searchUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(searchQuery)}`;

      let searchResponse = await fetch(searchUrl, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.QueryResponse?.Vendor?.length > 0) {
          console.log(`✓ Found existing vendor: ${searchData.QueryResponse.Vendor[0].DisplayName}`);
          return searchData.QueryResponse.Vendor[0].Id;
        }
      }
      
      // Si no se encuentra con nombre original, buscar con nombre normalizado
      if (normalizedName !== supplierName) {
        searchQuery = `SELECT * FROM Vendor WHERE DisplayName = '${normalizedName.replace(/'/g, "\\'")}'`;
        searchUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(searchQuery)}`;

        searchResponse = await fetch(searchUrl, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.QueryResponse?.Vendor?.length > 0) {
            console.log(`✓ Found existing vendor with normalized name: ${searchData.QueryResponse.Vendor[0].DisplayName}`);
            return searchData.QueryResponse.Vendor[0].Id;
          }
        }
      }

      // Crear vendor si no existe - usar nombre normalizado para evitar errores de encoding
      console.log(`Creating vendor with normalized name: ${normalizedName}`);
      const createResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            DisplayName: normalizedName,
            PrimaryTaxIdentifier: supplierTaxId || undefined,
          }),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`Failed to create vendor "${normalizedName}": ${errorText}`);
        throw new Error(`No se pudo crear el proveedor "${supplierName}" en QuickBooks. Error: ${errorText.substring(0, 200)}`);
      }

      const vendorData = await createResponse.json();
      console.log(`✓ Created vendor: ${vendorData.Vendor.DisplayName} (ID: ${vendorData.Vendor.Id})`);
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
        console.log(`Processing document ${doc.doc_number} (ID: ${doc.id})`);
        
        // VALIDACIÓN 1: Verificar que no exista otro documento con el mismo número en la DB
        const { data: duplicateInDB, error: dbCheckError } = await supabase
          .from("processed_documents")
          .select("id, doc_number, status, qbo_entity_id")
          .eq("organization_id", organization_id)
          .eq("doc_number", doc.doc_number)
          .neq("id", doc.id) // Excluir el documento actual
          .maybeSingle();
        
        if (duplicateInDB) {
          console.warn(`⚠️ Document ${doc.doc_number} already exists in DB with ID: ${duplicateInDB.id}`);
          
          // Marcar como error para evitar publicación
          await supabase
            .from("processed_documents")
            .update({
              status: "error",
              error_message: `Factura duplicada - Ya existe con ID ${duplicateInDB.id} (${duplicateInDB.status})`,
            })
            .eq("id", doc.id);
          
          results.failed++;
          results.errors.push({
            doc_number: doc.doc_number,
            error: "Factura duplicada en la base de datos",
          });
          continue;
        }
        
        // VALIDACIÓN 2: Verificar duplicado en QBO
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

        // Función mejorada para obtener el ID real de QuickBooks de una cuenta por su código
        const getAccountIdByCode = async (accountCode: string): Promise<string | null> => {
          try {
            console.log(`🔍 Searching for account with code: ${accountCode}`);
            
            // Búsqueda 1: Coincidencia exacta en AcctNum
            let query = `SELECT Id, Name, AcctNum, FullyQualifiedName, AccountType FROM Account WHERE AcctNum='${accountCode}'`;
            let queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            console.log(`Query 1 (exact AcctNum): ${query}`);
            let response = await fetch(queryUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });

            if (response.ok) {
              const data = await response.json();
              console.log(`Query 1 result:`, JSON.stringify(data.QueryResponse));
              
              if (data.QueryResponse?.Account && data.QueryResponse.Account.length > 0) {
                const account = data.QueryResponse.Account[0];
                console.log(`✓ Found account via exact AcctNum: ID=${account.Id}, Name="${account.Name}", AcctNum="${account.AcctNum}"`);
                return account.Id;
              }
            }
            
            // Búsqueda 2: LIKE en AcctNum (para cuentas con sufijos tipo "5105-01")
            query = `SELECT Id, Name, AcctNum, FullyQualifiedName, AccountType FROM Account WHERE AcctNum LIKE '${accountCode}%'`;
            queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            console.log(`Query 2 (LIKE AcctNum): ${query}`);
            response = await fetch(queryUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });

            if (response.ok) {
              const data = await response.json();
              console.log(`Query 2 result:`, JSON.stringify(data.QueryResponse));
              
              if (data.QueryResponse?.Account && data.QueryResponse.Account.length > 0) {
                const account = data.QueryResponse.Account[0];
                console.log(`✓ Found account via LIKE AcctNum: ID=${account.Id}, Name="${account.Name}", AcctNum="${account.AcctNum}"`);
                return account.Id;
              }
            }
            
            // Búsqueda 3: Buscar en Name (para cuentas donde el código está en el nombre)
            query = `SELECT Id, Name, AcctNum, FullyQualifiedName, AccountType FROM Account WHERE Name LIKE '%${accountCode}%'`;
            queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            console.log(`Query 3 (Name contains): ${query}`);
            response = await fetch(queryUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });

            if (response.ok) {
              const data = await response.json();
              console.log(`Query 3 result:`, JSON.stringify(data.QueryResponse));
              
              if (data.QueryResponse?.Account && data.QueryResponse.Account.length > 0) {
                const account = data.QueryResponse.Account[0];
                console.log(`✓ Found account via Name search: ID=${account.Id}, Name="${account.Name}", AcctNum="${account.AcctNum}"`);
                return account.Id;
              }
            }
            
            // Búsqueda 4: Buscar en cuentas Cost of Goods Sold (COGS) - para Costo de ventas
            // Importante: Soporta QuickBooks en inglés y español
            query = `SELECT Id, Name, AcctNum, AccountType FROM Account WHERE AccountType IN ('Cost of Goods Sold', 'Costo de las ventas')`;
            queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            console.log(`Query 4 (COGS accounts): ${query}`);
            response = await fetch(queryUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });

            if (response.ok) {
              const data = await response.json();
              console.log(`Query 4 result:`, JSON.stringify(data.QueryResponse));
              
              if (data.QueryResponse?.Account && data.QueryResponse.Account.length > 0) {
                // Registrar el AccountType para debugging
                console.log(`📊 Found ${data.QueryResponse.Account.length} COGS accounts. Sample AccountType: "${data.QueryResponse.Account[0].AccountType}"`);
                
                // Buscar la cuenta manualmente en los resultados
                const cogsAccount = data.QueryResponse.Account.find((acc: any) => 
                  acc.AcctNum === accountCode || 
                  acc.AcctNum?.toString().startsWith(accountCode) ||
                  acc.Name?.includes(accountCode)
                );
                
                if (cogsAccount) {
                  console.log(`✓ Found account via COGS search: ID=${cogsAccount.Id}, Name="${cogsAccount.Name}", AcctNum="${cogsAccount.AcctNum}", Type="${cogsAccount.AccountType}"`);
                  return cogsAccount.Id;
                } else {
                  console.log(`⚠️ No COGS account found with code ${accountCode}. Available COGS accounts:`);
                  data.QueryResponse.Account.forEach((acc: any) => {
                    console.log(`  - ID: ${acc.Id}, AcctNum: "${acc.AcctNum || 'N/A'}", Name: "${acc.Name}", Type: "${acc.AccountType}"`);
                  });
                }
              } else {
                console.log(`⚠️ Query 4 returned no COGS accounts`);
              }
            }
            
            // Si no se encontró, listar todas las cuentas de gasto y COGS para debugging
            console.error(`❌ Account code ${accountCode} NOT FOUND in QuickBooks after 4 searches`);
            console.log(`📋 Listing all Expense and COGS accounts for debugging...`);
            
            query = `SELECT Id, Name, AcctNum, AccountType FROM Account WHERE AccountType IN ('Expense', 'Cost of Goods Sold', 'Costo de las ventas') MAXRESULTS 100`;
            queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            response = await fetch(queryUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });

            if (response.ok) {
              const data = await response.json();
              if (data.QueryResponse?.Account) {
                console.log(`📋 Available Accounts (${data.QueryResponse.Account.length}):`);
                data.QueryResponse.Account.forEach((acc: any) => {
                  console.log(`  - ID: ${acc.Id}, Type: ${acc.AccountType}, AcctNum: "${acc.AcctNum || 'N/A'}", Name: "${acc.Name}"`);
                });
              }
            }
            
            return null;
          } catch (error) {
            console.error(`Error fetching account ID for ${accountCode}:`, error);
            return null;
          }
        };

        // Buscar cuenta contable del vendor o de las reglas de clasificación
        let accountCode: string | null = null;
        
        // 1. Primero intentar desde el vendor
        if (doc.vendor_id) {
          const { data: vendorData } = await supabase
            .from("vendors")
            .select("default_account_ref")
            .eq("id", doc.vendor_id)
            .maybeSingle();
          
          if (vendorData?.default_account_ref) {
            accountCode = vendorData.default_account_ref;
            console.log(`✓ Account code from vendor: ${accountCode}`);
          }
        }
        
        // 2. Si no hay cuenta del vendor, buscar en las reglas de clasificación por nombre
        if (!accountCode) {
          const { data: classificationRule } = await supabase
            .from("vendor_classification_rules")
            .select("account_code")
            .eq("organization_id", organization_id)
            .ilike("vendor_name", doc.supplier_name)
            .eq("is_active", true)
            .maybeSingle();
          
          if (classificationRule?.account_code) {
            // Extraer solo el código numérico (ej: "5105" de "5105 Costo de ventas")
            accountCode = classificationRule.account_code.split(" ")[0];
            console.log(`✓ Account code from classification rule: ${accountCode} for ${doc.supplier_name}`);
          }
        }
        
        // 3. Si aún no hay cuenta, buscar en xml_data.cuentaContable
        if (!accountCode && doc.xml_data?.cuentaContable) {
          const xmlAccount = doc.xml_data.cuentaContable.split(" ")[0];
          if (xmlAccount && xmlAccount !== "Gastos" && xmlAccount !== "por" && xmlAccount !== "clasificar") {
            accountCode = xmlAccount;
            console.log(`✓ Account code from XML: ${accountCode}`);
          }
        }
        
        // 4. Si no se pudo determinar ninguna cuenta, error descriptivo
        if (!accountCode) {
          const errorMsg = `❌ No se pudo determinar cuenta contable para factura ${doc.doc_number} - Proveedor: ${doc.supplier_name}. Opciones: 1) Configurar cuenta en vendor, 2) Agregar regla de clasificación, 3) Verificar XML cuentaContable`;
          console.error(errorMsg);
          throw new Error(errorMsg);
        }
        
        // Obtener el ID real de QuickBooks para el código de cuenta
        let accountRef = await getAccountIdByCode(accountCode);
        
        if (!accountRef) {
          console.error(`❌ CRITICAL: Account ${accountCode} not found for vendor ${doc.supplier_name}`);
          console.error(`   This invoice will be classified incorrectly into default account "60"`);
          console.error(`   Please verify that account ${accountCode} exists in QuickBooks`);
          
          // Throw error instead of silent fallback for visibility
          throw new Error(`Cuenta ${accountCode} no existe en QuickBooks. Factura ${doc.doc_number} - Proveedor: ${doc.supplier_name}. Verifica que la cuenta esté creada.`);
        }
        
        console.log(`✅ Final accountRef (QB ID) for ${doc.doc_number}: ${accountRef} (from code ${accountCode})`);

        // CRITICAL: Log document details for debugging
        console.log(`Processing document ${doc.doc_number}:`, {
          doc_id: doc.id,
          doc_type: doc.doc_type,
          has_xml_data: !!doc.xml_data,
          detalle_length: doc.xml_data?.detalle?.length || 0,
          total_amount: doc.total_amount,
          is_credit_note: doc.xml_data?.esNotaCredito || doc.doc_type === 'NC'
        });

        // Determinar si es una nota de crédito
        const isCreditNote = doc.xml_data?.esNotaCredito === true || doc.doc_type === 'NC';
        const multiplier = isCreditNote ? -1 : 1;
        
        if (isCreditNote) {
          console.log(`⚠️ Processing as CREDIT NOTE with negative amounts`);
        }

        // Preparar líneas del bill con validación robusta
        const lines = [];
        const xmlData = doc.xml_data as any;
        
        if (xmlData?.detalle && Array.isArray(xmlData.detalle) && xmlData.detalle.length > 0) {
          console.log(`Found ${xmlData.detalle.length} line items in xml_data`);
          for (const item of xmlData.detalle) {
            // Usar el subtotal (cantidad * precioUnitario) en lugar del total con IVA
            const cantidad = parseFloat(item.cantidad) || 1;
            const precioUnitario = parseFloat(item.precioUnitario) || 0;
            const subtotal = cantidad * precioUnitario * multiplier; // Negativo si es nota de crédito
            
            if (Math.abs(subtotal) > 0) {
              // Construir descripción detallada con toda la información disponible
              const descripcionBase = item.descripcion || item.detalle || item.Detalle || "";
              const unidadMedida = item.unidadMedida || item.UnidadMedida || "";
              const codigoComercial = item.codigoComercial || item.codigo || "";
              
              let descripcionCompleta = descripcionBase;
              
              // Agregar cantidad y unidad de medida si existen
              if (cantidad && unidadMedida) {
                descripcionCompleta = `${cantidad} ${unidadMedida} - ${descripcionCompleta}`;
              } else if (cantidad > 1) {
                descripcionCompleta = `Cant: ${cantidad} - ${descripcionCompleta}`;
              }
              
              // Agregar código comercial si existe
              if (codigoComercial) {
                descripcionCompleta = `[${codigoComercial}] ${descripcionCompleta}`;
              }
              
              lines.push({
                DetailType: "AccountBasedExpenseLineDetail",
                Amount: subtotal,
                Description: descripcionCompleta.substring(0, 4000) || `Línea ${lines.length + 1}`,
                AccountBasedExpenseLineDetail: {
                  AccountRef: {
                    value: accountRef,
                  },
                },
              });
            }
          }
        }
        
        // DOUBLE VALIDATION: Si aún no hay líneas, crear una línea por defecto con el subtotal
        if (lines.length === 0) {
          console.warn(`⚠️ No valid lines found for ${doc.doc_number}, creating fallback line`);
          const subtotal = (parseFloat(doc.total_amount as any) - parseFloat(doc.total_tax as any)) * multiplier || 0;
          
          if (Math.abs(subtotal) <= 0) {
            console.error(`Invalid total amount for ${doc.doc_number}: ${doc.total_amount}`);
            throw new Error(`Invalid total amount: ${doc.total_amount}. Cannot create bill without valid amount.`);
          }
          
          lines.push({
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: subtotal,
            Description: `${isCreditNote ? 'Nota de Crédito' : 'Factura'} ${doc.doc_number} - ${doc.supplier_name}`,
            AccountBasedExpenseLineDetail: {
              AccountRef: {
                value: accountRef,
              },
            },
          });
          console.log(`✓ Created fallback line with subtotal: ${subtotal}`);
        }
        
        // Agregar línea de IVA si existe
        const totalTax = (parseFloat(doc.total_tax as any) || 0) * multiplier; // Negativo si es nota de crédito
        if (Math.abs(totalTax) > 0) {
          lines.push({
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: totalTax,
            Description: `IVA (Impuesto al Valor Agregado)${isCreditNote ? ' - NC' : ''}`,
            AccountBasedExpenseLineDetail: {
              AccountRef: {
                value: accountRef, // Mismo account que las líneas principales
              },
            },
          });
          console.log(`✓ Added tax line with amount: ${totalTax}`);
        }
        
        const subtotalLines = lines.slice(0, lines.length - (Math.abs(totalTax) > 0 ? 1 : 0)).reduce((sum, l) => sum + l.Amount, 0);
        console.log(`✓ Final line count for ${doc.doc_number}: ${lines.length} line(s), subtotal: ${subtotalLines}, tax: ${totalTax}, total: ${lines.reduce((sum, l) => sum + l.Amount, 0)}`);

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
            console.log(`Attempting to attach PDF for bill ${doc.doc_number}, URL: ${doc.pdf_attachment_url}`);
            
            // Extraer el path correcto del storage
            const pdfPath = doc.pdf_attachment_url.replace(/^.*\/object\/public\/company-documents\//, "")
                                                   .replace(/^.*\/company-documents\//, "");
            
            console.log(`Downloading PDF from path: ${pdfPath}`);
            
            // Descargar el PDF del storage
            const { data: pdfData, error: downloadError } = await supabase.storage
              .from("company-documents")
              .download(pdfPath);

            if (downloadError) {
              console.error(`Failed to download PDF: ${downloadError.message}`);
              throw downloadError;
            }

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
                console.log(`✓ PDF attached successfully to bill ${doc.doc_number}`);
              } else {
                const errorText = await attachResponse.text();
                console.error(`❌ Failed to attach PDF (HTTP ${attachResponse.status}): ${errorText}`);
              }
            } else {
              console.warn(`⚠️ No PDF data retrieved for ${doc.doc_number}`);
            }
          } catch (pdfError) {
            console.error(`❌ Error attaching PDF for ${doc.doc_number}:`, pdfError);
            // No fallar la publicación si falla el adjunto
          }
        } else {
          console.log(`No PDF attachment URL for ${doc.doc_number}, skipping PDF upload`);
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
