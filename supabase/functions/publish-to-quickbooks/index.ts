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

    // Autenticar usuario o validar service role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;
    let userId: string | null = null;
    
    if (!isServiceRole) {
      // Si no es service role, validar que sea un usuario autenticado
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        throw new Error("Authentication failed");
      }
      userId = user.id;
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

    // Obtener documentos a publicar (pending o processed que no tengan qbo_entity_id)
    // FILTRO: Solo facturas de noviembre 2025 en adelante
    let query = supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .is("qbo_entity_id", null)
      .in("status", ["pending", "processed"])
      .gte("issue_date", "2025-11-01");

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
      
      // Preparar body del vendor - QuickBooks API no acepta PrimaryTaxIdentifier
      const vendorBody: any = {
        DisplayName: normalizedName,
      };
      
      const createResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(vendorBody),
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

    // PRE-CARGAR DATOS EN BATCH para evitar llamadas repetidas
    console.log(`⚙️ Iniciando procesamiento de ${documents.length} factura(s)...`);
    const batchStartTime = Date.now();
    
    // Pre-cargar todos los vendors en una sola consulta
    const uniqueVendorNames = [...new Set(documents.map(d => d.supplier_name))];
    const { data: allVendors } = await supabase
      .from("vendors")
      .select("*")
      .eq("organization_id", organization_id)
      .in("vendor_name", uniqueVendorNames);
    
    const vendorsMap = new Map(allVendors?.map(v => [v.vendor_name, v]) || []);
    
    // Pre-cargar vendor defaults
    const { data: allVendorDefaults } = await supabase
      .from("vendor_defaults")
      .select("*")
      .eq("organization_id", organization_id)
      .in("vendor_name", uniqueVendorNames);
    
    const vendorDefaultsMap = new Map(allVendorDefaults?.map(v => [v.vendor_name, v]) || []);
    
    console.log(`✓ Pre-cargados ${vendorsMap.size} vendors y ${vendorDefaultsMap.size} defaults en ${Date.now() - batchStartTime}ms`);
    
    // Función auxiliar para procesar un documento individual
    const processDocument = async (doc: any, index: number, total: number) => {
      const progress = `[${index + 1}/${total}]`;
      const startTime = Date.now();
      
      try {
        console.log(`${progress} 📄 Procesando documento ${doc.doc_number} (ID: ${doc.id})`);
        
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
          
          return {
            success: false,
            docNumber: doc.doc_number,
            error: "Factura duplicada en la base de datos"
          };
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

          return {
            success: true,
            docNumber: doc.doc_number
          };
        }

        // Obtener o crear vendor
        const vendorId = await findOrCreateVendor(doc.supplier_name, doc.supplier_tax_id);

        // Función para obtener código de impuesto de QuickBooks
        const getTaxCodeRef = async (taxRate: number): Promise<string | null> => {
          try {
            console.log(`🔍 Buscando código de impuesto para tasa: ${taxRate}%`);
            
            const query = `SELECT Id, Name, Description FROM TaxCode WHERE Active = true MAXRESULTS 100`;
            const queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            const response = await fetch(queryUrl, {
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/json",
              },
            });

            if (!response.ok) {
              console.error("Failed to fetch tax codes from QuickBooks");
              return null;
            }

            const data = await response.json();
            const taxCodes = data.QueryResponse?.TaxCode || [];
            
            console.log(`✓ Retrieved ${taxCodes.length} tax codes from QuickBooks`);
            
            // Buscar el código que coincida con la tasa de impuesto
            // Soportar tasas: 0%, 1%, 2%, 4%, 8%, 13%
            for (const taxCode of taxCodes) {
              const name = (taxCode.Name || "").toLowerCase();
              const description = (taxCode.Description || "").toLowerCase();
              
               // Para tasa 0%, buscar códigos "NON", "Sin IVA", "0%", "No VAT", etc.
               if (taxRate === 0) {
                 const zeroPatterns = [
                   'non',
                   'sin iva',
                   'sin impuesto',
                   'exento',
                   'exempt',
                   '0%',
                   '(0%)',
                   'no vat',
                   'out of scope',
                   'out of scope of vat',
                 ];
                 
                 for (const pattern of zeroPatterns) {
                   if (name.includes(pattern) || description.includes(pattern)) {
                     console.log(`✅ Found tax code for 0%: ${taxCode.Name} (ID: ${taxCode.Id})`);
                     return taxCode.Id;
                   }
                 }
               } else {
                // Para tasas > 0%
                const targetRate = `${taxRate}%`.toLowerCase();
                const patterns = [
                  targetRate,                    // "13%"
                  `(${taxRate}%)`,              // "(13%)"
                  `${taxRate} %`,               // "13 %"
                  `iva ${taxRate}%`,            // "iva 13%"
                  `impuesto ${taxRate}%`,       // "impuesto 13%"
                ];
                
                for (const pattern of patterns) {
                  if (name.includes(pattern) || description.includes(pattern)) {
                    console.log(`✅ Found tax code for ${taxRate}%: ${taxCode.Name} (ID: ${taxCode.Id})`);
                    return taxCode.Id;
                  }
                }
              }
            }
            
            console.error(`❌ No tax code found for ${taxRate}% in QuickBooks. Available codes:`, 
              taxCodes.slice(0, 10).map((t: any) => `${t.Name} (${t.Description || 'N/A'})`).join(', '));
            return null;
          } catch (error) {
            console.error("Error fetching tax codes:", error);
            return null;
          }
        };

        // Función mejorada para obtener el ID real de QuickBooks de una cuenta por su código
        const getAccountIdByCode = async (accountCode: string): Promise<string | null> => {
          try {
            console.log(`🔍 Searching for account with code: ${accountCode}`);
            
            // ⚡ NUEVA ESTRATEGIA: Obtener TODAS las cuentas y buscar manualmente
            // Esto evita problemas con queries específicas que no devuelven resultados
            const query = `SELECT Id, Name, AcctNum, AccountType FROM Account MAXRESULTS 1000`;
            const queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            console.log(`📊 Fetching all QuickBooks accounts...`);
            const response = await fetch(queryUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });

            if (!response.ok) {
              console.error(`❌ Failed to fetch accounts from QuickBooks`);
              return null;
            }

            const data = await response.json();
            const allAccounts = data.QueryResponse?.Account || [];
            console.log(`✓ Retrieved ${allAccounts.length} accounts from QuickBooks`);
            
            // PASO 1: Buscar EXACTAMENTE por el código completo primero
            console.log(`🎯 PRIORITY: Searching for EXACT match: "${accountCode}"`);
            let targetAccount = allAccounts.find((acc: any) => {
              // Coincidencia EXACTA en AcctNum
              if (acc.AcctNum && acc.AcctNum === accountCode) {
                return true;
              }
              
              // Coincidencia EXACTA al inicio del Name seguido de espacio
              if (acc.Name && acc.Name.startsWith(accountCode + ' ')) {
                return true;
              }
              
              // Coincidencia EXACTA al inicio del Name seguido de guion
              if (acc.Name && acc.Name.startsWith(accountCode + '-')) {
                return true;
              }
              
              return false;
            });
            
            if (targetAccount) {
              console.log(`✅ EXACT MATCH FOUND for ${accountCode}:`);
              console.log(`   ID: ${targetAccount.Id}`);
              console.log(`   Name: "${targetAccount.Name}"`);
              console.log(`   AcctNum: "${targetAccount.AcctNum || 'N/A'}"`);
              console.log(`   Type: "${targetAccount.AccountType}"`);
              return targetAccount.Id;
            }
            
            // PASO 2: Si NO encontró match exacto Y el código tiene guion, intentar con código base (cuenta madre)
            if (accountCode.includes('-')) {
              const baseCode = accountCode.split('-')[0]; // "5500-03" → "5500"
              console.log(`⚠️ FALLBACK: No exact match, searching for parent account: "${baseCode}"`);
              
              targetAccount = allAccounts.find((acc: any) => {
                // Buscar código base
                if (acc.AcctNum && acc.AcctNum === baseCode) {
                  return true;
                }
                
                if (acc.Name && acc.Name.startsWith(baseCode + ' ')) {
                  return true;
                }
                
                return false;
              });
              
              if (targetAccount) {
                console.log(`⚠️ USING PARENT ACCOUNT as fallback for ${accountCode}:`);
                console.log(`   ID: ${targetAccount.Id}`);
                console.log(`   Name: "${targetAccount.Name}"`);
                console.log(`   AcctNum: "${targetAccount.AcctNum || 'N/A'}"`);
                console.log(`   ⚠️ WARNING: This is a parent account, not the specific sub-account requested!`);
                return targetAccount.Id;
              }
            }
            
            // Si no se encontró, mostrar cuentas similares para debugging
            console.error(`❌ Account ${accountCode} NOT FOUND in ${allAccounts.length} QuickBooks accounts`);
            console.log(`🔍 Accounts that might be related (containing "${accountCode.substring(0, 2)}"):`);
            const similarAccounts = allAccounts
              .filter((acc: any) => {
                const nameStr = (acc.Name || '').toLowerCase();
                const numStr = (acc.AcctNum || '').toString();
                const searchPrefix = accountCode.substring(0, 2);
                return nameStr.includes(searchPrefix) || numStr.includes(searchPrefix);
              })
              .slice(0, 15);
            
            similarAccounts.forEach((acc: any) => {
              console.log(`   - ID: ${acc.Id}, AcctNum: "${acc.AcctNum || 'N/A'}", Name: "${acc.Name}", Type: "${acc.AccountType}"`);
            });
            
            return null;
          } catch (error) {
            console.error(`Error fetching account ID for ${accountCode}:`, error);
            return null;
          }
        };

        // Buscar cuenta contable del vendor o de las reglas de clasificación
        let accountCode: string | null = null;
        
        // 1. PRIORIDAD MÁXIMA: Cuenta configurada específicamente en el documento
        if (doc.default_account_ref) {
          // Extraer solo el código (antes del primer espacio)
          // Ej: "6124-01 Alimentación y hoteles" → "6124-01"
          const rawCode = doc.default_account_ref;
          accountCode = rawCode.split(' ')[0].trim();
          console.log(`✓✓ PRIORITY: Account code from document: ${accountCode} (raw: ${rawCode})`);
        }
        
        // 2. Si no hay cuenta en el documento, intentar desde el vendor
        if (!accountCode && doc.vendor_id) {
          const { data: vendorData } = await supabase
            .from("vendors")
            .select("default_account_ref")
            .eq("id", doc.vendor_id)
            .maybeSingle();
          
          if (vendorData?.default_account_ref) {
            // Extraer solo el código (antes del primer espacio)
            // Ej: "6124-01 Alimentación y hoteles" → "6124-01"
            const rawCode = vendorData.default_account_ref;
            accountCode = rawCode.split(' ')[0].trim();
            console.log(`✓ Account code from vendor: ${accountCode} (raw: ${rawCode})`);
          }
        }
        
        // 3. Si no hay cuenta del vendor, buscar en vendor_categories por tax_id
        if (!accountCode && doc.supplier_tax_id) {
          const { data: vendorCategory } = await supabase
            .from("vendor_categories")
            .select("account_code")
            .eq("organization_id", organization_id)
            .eq("vendor_identification", doc.supplier_tax_id)
            .eq("is_active", true)
            .maybeSingle();
          
          if (vendorCategory?.account_code) {
            accountCode = vendorCategory.account_code;
            console.log(`✓ Account code from vendor_categories: ${accountCode} for ${doc.supplier_name}`);
          }
        }
        
        // 4. Si aún no hay cuenta, buscar en las reglas de clasificación por nombre
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
        
        // 5. Si aún no hay cuenta, buscar en xml_data.cuentaContable
        if (!accountCode && doc.xml_data?.cuentaContable) {
          // Extraer solo el código, ignorando descripción adicional
          // Formato: "6130-03 Gasto de operacion:Utencilios cafeteria" -> "6130-03"
          const rawAccount = doc.xml_data.cuentaContable.trim();
          const xmlAccount = rawAccount.split(" ")[0].split(":")[0];
          
          if (xmlAccount && xmlAccount !== "Gastos" && xmlAccount !== "por" && xmlAccount !== "clasificar") {
            accountCode = xmlAccount;
            console.log(`✓ Account code extracted from XML: ${accountCode} (from: ${rawAccount})`);
          }
        }
        
        // 6. Si no se pudo determinar ninguna cuenta, marcar como pending_config
        if (!accountCode) {
          console.log(`❌ No account code found for ${doc.supplier_name}, requires manual configuration`);
          
          await supabase
            .from("processed_documents")
            .update({
              status: "pending_config",
              error_message: "Proveedor sin cuenta contable configurada. Configure la cuenta en 'Proveedores con Errores' para continuar.",
            })
            .eq("id", doc.id);

          return {
            success: false,
            docNumber: doc.doc_number,
            error: "No account code configured for vendor"
          };
        }
        
        // Obtener el ID real de QuickBooks para el código de cuenta
        let accountRef = await getAccountIdByCode(accountCode!);
        
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

        // Determinar si es una nota de crédito (los valores YA vienen negativos del procesamiento XML)
        const isCreditNote = doc.xml_data?.esNotaCredito === true || doc.doc_type === 'NotaCreditoElectronica';
        
        if (isCreditNote) {
          console.log(`⚠️ Processing CREDIT NOTE - amounts already negative from XML processing`);
        }

        // Preparar líneas del bill con validación robusta
        const lines = [];
        const xmlData = doc.xml_data as any;
        
        // Cache de códigos de impuesto para evitar múltiples llamadas al API
        const taxCodeCache = new Map<number, string | null>();
        
        if (xmlData?.detalle && Array.isArray(xmlData.detalle) && xmlData.detalle.length > 0) {
          console.log(`Found ${xmlData.detalle.length} line items in xml_data`);
          for (const item of xmlData.detalle) {
            // Usar el subtotal (cantidad * precioUnitario) sin IVA
            const cantidad = parseFloat(item.cantidad) || 1;
            const precioUnitario = parseFloat(item.precioUnitario) || 0;
            const subtotal = parseFloat(item.subtotal) || (cantidad * precioUnitario);
            const lineAmount = subtotal; // Los valores YA vienen negativos para notas de crédito
            
            // IMPORTANTE: Obtener SOLO el impuesto IVA (código 01)
            // Ignorar impuestos específicos (código 05) y otros
            let tasaImpuesto = 0;
            let montoImpuesto = 0;
            
            if (item.impuestos && Array.isArray(item.impuestos)) {
              // Buscar el impuesto con código 01 (IVA)
              const ivaImpuesto = item.impuestos.find((imp: any) => imp.codigo === '01');
              if (ivaImpuesto) {
                tasaImpuesto = parseFloat(ivaImpuesto.tarifa) || 0;
                montoImpuesto = parseFloat(ivaImpuesto.monto) || 0;
                console.log(`✓ IVA encontrado para línea: ${tasaImpuesto}% (monto: ${montoImpuesto})`);
              } else {
                console.log(`ℹ️ No se encontró IVA (código 01) en esta línea, usando tasa 0%`);
              }
            } else {
              // Fallback al método antiguo si no hay array de impuestos
              tasaImpuesto = parseFloat(item.tarifa) || 0;
              montoImpuesto = parseFloat(item.montoImpuesto) || 0;
            }
            
            // CRÍTICO: Calcular montoImpuesto si no está presente
            if (montoImpuesto === 0 && tasaImpuesto > 0) {
              // Calcular IVA: subtotal * (tasa / 100)
              montoImpuesto = subtotal * (tasaImpuesto / 100);
              console.log(`⚙️ Calculando IVA automáticamente: ${subtotal} × ${tasaImpuesto}% = ${montoImpuesto.toFixed(2)}`);
            }
            // Los valores YA vienen con el signo correcto (negativo para notas de crédito)
            
            if (Math.abs(lineAmount) > 0) {
              // Construir descripción detallada usando todos los campos capturados
              const descripcionBase = item.descripcion || "";
              const unidadMedida = item.unidadMedida || "";
              const codigoProducto = item.codigoProducto || "";
              const numeroLinea: number = item.numeroLinea || (lines.length + 1);
              
              let descripcionCompleta = descripcionBase;
              
              // Agregar código de producto si existe
              if (codigoProducto) {
                descripcionCompleta = `[${codigoProducto}] ${descripcionCompleta}`;
              }
              
              // Agregar cantidad y unidad de medida con precio unitario (sin IVA)
              if (cantidad && unidadMedida && precioUnitario > 0) {
                descripcionCompleta = `${cantidad} ${unidadMedida} × ₡${precioUnitario.toFixed(2)} - ${descripcionCompleta}`;
              } else if (cantidad > 1) {
                descripcionCompleta = `Cant: ${cantidad} - ${descripcionCompleta}`;
              }
              
              // ENVIAR SOLO EL SUBTOTAL - QuickBooks calculará el IVA
              const lineDetail: any = {
                DetailType: "AccountBasedExpenseLineDetail",
                Amount: lineAmount, // Solo subtotal - QuickBooks calculará el IVA con TaxCodeRef
                Description: descripcionCompleta.substring(0, 4000) || `Línea ${numeroLinea}`,
                AccountBasedExpenseLineDetail: {
                  AccountRef: {
                    value: accountRef,
                  },
                },
              };
             
             // SIEMPRE agregar TaxCodeRef (requerido por QuickBooks)
             const taxRateToUse = tasaImpuesto || 0;
             
             // Verificar si ya tenemos el código de impuesto en caché
             if (!taxCodeCache.has(taxRateToUse)) {
               const taxCodeRef = await getTaxCodeRef(taxRateToUse);
               taxCodeCache.set(taxRateToUse, taxCodeRef);
             }
             
             const taxCodeRef = taxCodeCache.get(taxRateToUse);
             
             if (!taxCodeRef) {
               // CRÍTICO: QuickBooks requiere TaxCodeRef en TODAS las líneas
               console.error(`❌ CRÍTICO: No se encontró código de impuesto para ${taxRateToUse}% - NO se puede crear el bill`);
               throw new Error(`No se encontró código de impuesto para ${taxRateToUse}% en QuickBooks. Configure los códigos de impuesto correctamente antes de publicar.`);
             }
             
             lineDetail.AccountBasedExpenseLineDetail.TaxCodeRef = {
               value: taxCodeRef,
             };
             
             if (tasaImpuesto > 0) {
               console.log(`✓ Line ${numeroLinea}: ${descripcionBase.substring(0, 40)} - Subtotal: ${lineAmount.toFixed(2)}, IVA ${tasaImpuesto}%: ${montoImpuesto.toFixed(2)} [TaxCode: ${taxCodeRef}] → QBO calculará total`);
             } else {
               console.log(`✓ Line ${numeroLinea}: ${descripcionBase.substring(0, 50)} - Subtotal: ${lineAmount.toFixed(2)} [TaxCode: ${taxCodeRef} - Sin IVA]`);
             }
              
              lines.push(lineDetail);
            }
          }
        }
        
        // DOUBLE VALIDATION: Si aún no hay líneas, crear una línea por defecto con el subtotal
        if (lines.length === 0) {
          console.warn(`⚠️ No valid lines found for ${doc.doc_number}, creating fallback line`);
          const subtotal = (parseFloat(doc.total_amount as any) - parseFloat(doc.total_tax as any)) || 0;
          
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
        
        // CRÍTICO: Verificar si el documento usa IVA según configuración del usuario
        const documentUsesTax = doc.uses_tax !== false; // Default true si no está definido
        console.log(`📊 Documento usa IVA según configuración: ${documentUsesTax} (uses_tax=${doc.uses_tax})`);
        
        // Calcular el IVA SOLO si el documento está configurado para usar IVA
        // Los valores YA vienen con el signo correcto (negativo para notas de crédito)
        const totalTax = documentUsesTax ? (parseFloat(doc.total_tax as any) || 0) : 0;
        
        if (!documentUsesTax && doc.total_tax) {
          console.log(`⚠️ Factura tiene IVA en XML (${doc.total_tax}) pero está marcada como SIN IVA - Ignorando impuesto`);
        }
        
        const subtotalLines = lines.reduce((sum, l) => sum + l.Amount, 0);
        console.log(`✓ Final line count for ${doc.doc_number}: ${lines.length} line(s), subtotal: ${subtotalLines}, tax: ${totalTax}, total: ${subtotalLines + totalTax}`);

        // Preparar DocNumber - QuickBooks acepta máx 21 caracteres
        // IMPORTANTE: doc.doc_number contiene NumeroConsecutivo (ej: 00100001010000108314)
        // NO la Clave numérica de 50 dígitos
        console.log(`📋 DocNumber original: ${doc.doc_number} (length: ${doc.doc_number.length})`);
        
        // Validar que no sea la clave numérica por error
        if (doc.doc_number.length > 30) {
          console.error(`❌ ERROR: doc_number parece ser Clave numérica: ${doc.doc_number.substring(0, 50)}`);
          throw new Error(`Invalid doc_number - appears to be Clave instead of NumeroConsecutivo for doc ${doc.id}`);
        }
        
        const qboDocNumber = doc.doc_number.length > 21 
          ? doc.doc_number.substring(doc.doc_number.length - 21) // Últimos 21 caracteres
          : doc.doc_number;
        
        console.log(`✓ Using DocNumber for QuickBooks: ${qboDocNumber}`);

        // Logging para debug (sin validación - publicar exactamente lo que dice el XML)
        console.log("=== DATOS PARA PUBLICACIÓN ===");
        console.log(`Documento: ${doc.doc_number}, Proveedor: ${doc.supplier_name}`);
        console.log(`Usa IVA según configuración: ${documentUsesTax} (campo uses_tax=${doc.uses_tax})`);
        const xmlSubtotal = Math.abs(parseFloat(xmlData?.subTotal || String(doc.total_amount - (doc.total_tax || 0))));
        const xmlTotalImpuesto = Math.abs(parseFloat(xmlData?.totalImpuesto || String(doc.total_tax || 0)));
        const xmlTotalDescuentos = Math.abs(parseFloat(xmlData?.totalDescuentos || '0'));
        console.log(`XML: Subtotal=${xmlSubtotal}, IVA=${xmlTotalImpuesto}, Descuentos=${xmlTotalDescuentos}`);
        console.log(`Líneas construidas: ${lines.length} línea(s), Subtotal=${subtotalLines.toFixed(2)}, IVA=${totalTax.toFixed(2)}, Total a enviar a QBO=${(subtotalLines + totalTax).toFixed(2)}`);
        console.log("=== FIN DATOS ===");

        // FINAL VALIDATION before sending to QuickBooks
        if (!lines || lines.length === 0) {
          console.error(`❌ Cannot create bill without line items for doc ${doc.doc_number}`);
          throw new Error(`Cannot create bill without line items for doc ${doc.doc_number}`);
        }

        // Crear Bill en QuickBooks con TxnTaxDetail para el IVA
        const billPayload: any = {
          VendorRef: {
            value: vendorId,
          },
          TxnDate: doc.issue_date,
          DocNumber: qboDocNumber,
          Line: lines,
          DueDate: doc.issue_date,
          PrivateNote: `Factura XML: ${doc.doc_number}\nProveedor: ${doc.supplier_name}\nImportado automáticamente`,
          // CRÍTICO: Especificar que los impuestos NO están incluidos en el monto de las líneas
          GlobalTaxCalculation: "TaxExcluded",
        };

        // Agregar soporte multi-moneda para facturas en USD
        if (doc.currency && doc.currency.toUpperCase() === 'USD') {
          billPayload.CurrencyRef = {
            value: "USD"
          };
          
          // Agregar tipo de cambio si está disponible en el XML
          const exchangeRate = parseFloat(xmlData?.resumen_factura?.tipoCambio || xmlData?.tipoCambio || '1');
          if (exchangeRate && exchangeRate > 1) {
            billPayload.ExchangeRate = exchangeRate;
            console.log(`💱 USD Invoice - Exchange Rate: ${exchangeRate}`);
          } else {
            console.log(`💰 Currency set to USD but no valid exchange rate found, QuickBooks will use default`);
          }
          console.log(`💰 Currency set to USD for invoice ${doc.doc_number}`);
        }

        // Agregar TxnTaxDetail SOLO si el documento usa IVA y el total de impuestos es mayor a 0
        if (documentUsesTax && totalTax > 0) {
          billPayload.TxnTaxDetail = {
            TotalTax: totalTax
          };
          console.log(`✓ Added TxnTaxDetail with TotalTax: ${totalTax.toFixed(2)} - GlobalTaxCalculation: TaxExcluded`);
        } else {
          if (!documentUsesTax) {
            console.log(`✓ Factura marcada como SIN IVA - No se agregará TxnTaxDetail`);
          } else {
            console.log(`✓ No tax to add (totalTax: ${totalTax})`);
          }
        }

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

          return {
            success: false,
            docNumber: doc.doc_number,
            error: errorText.substring(0, 200)
          };
        }

        const billData = await billResponse.json();
        const billId = billData.Bill.Id;

        console.log(`Successfully created bill ${doc.doc_number} with ID: ${billId}`);

        // Adjuntar PDF si existe
        if (doc.pdf_attachment_url) {
          try {
            console.log(`📎 Attempting to attach PDF for bill ${doc.doc_number}`);
            console.log(`   PDF URL: ${doc.pdf_attachment_url}`);
            
            // Extraer el path correcto del storage - manejar múltiples formatos de URL
            let pdfPath = doc.pdf_attachment_url;
            if (pdfPath.includes('/object/public/company-documents/')) {
              pdfPath = pdfPath.split('/object/public/company-documents/')[1];
            } else if (pdfPath.includes('company-documents/')) {
              pdfPath = pdfPath.split('company-documents/').pop() || pdfPath;
            } else if (pdfPath.startsWith('http')) {
              // Si es una URL completa, extraer el path después del bucket
              const urlParts = pdfPath.split('company-documents/');
              if (urlParts.length > 1) {
                pdfPath = urlParts[1];
              }
            }
            
            console.log(`   Extracted path: ${pdfPath}`);
            
            // Descargar el PDF del storage
            const { data: pdfData, error: downloadError } = await supabase.storage
              .from("company-documents")
              .download(pdfPath);

            if (downloadError) {
              console.error(`❌ Failed to download PDF from storage: ${downloadError.message}`);
              throw downloadError;
            }

            if (!pdfData) {
              console.error(`❌ No PDF data retrieved from storage`);
              throw new Error('No PDF data returned from storage');
            }

            console.log(`✓ PDF downloaded successfully, size: ${pdfData.size} bytes`);

            if (pdfData) {
              console.log(`🔄 Converting PDF to base64...`);
              // Convertir blob a base64
              const arrayBuffer = await pdfData.arrayBuffer();
              const base64Pdf = btoa(
                new Uint8Array(arrayBuffer).reduce(
                  (data, byte) => data + String.fromCharCode(byte),
                  ""
                )
              );
              
              console.log(`✓ PDF converted to base64, length: ${base64Pdf.length} chars`);

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

              console.log(`📤 Uploading PDF to QuickBooks...`);
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
                const attachResult = await attachResponse.json();
                console.log(`✅ PDF attached successfully to bill ${doc.doc_number}`);
                console.log(`   Attachment ID: ${attachResult.AttachableResponse?.[0]?.Attachable?.Id || 'N/A'}`);
              } else {
                const errorText = await attachResponse.text();
                console.error(`❌ Failed to attach PDF (HTTP ${attachResponse.status}): ${errorText}`);
              }
            } else {
              console.warn(`⚠️ No PDF data retrieved for ${doc.doc_number}`);
            }
          } catch (pdfError: any) {
            console.error(`❌ Error attaching PDF for ${doc.doc_number}:`, pdfError);
            console.error(`   Error details: ${pdfError.message || 'Unknown error'}`);
            // No fallar la publicación si falla el adjunto
          }
        } else {
          console.log(`ℹ️ No PDF attachment URL for ${doc.doc_number}, skipping PDF upload`);
        }

        // Actualizar documento con QBO ID
        await supabase
          .from("processed_documents")
          .update({
            qbo_entity_id: billId,
            qbo_entity_type: "Bill",
            status: "published",
            processed_at: new Date().toISOString(),
            processed_by: userId,
            error_message: null,
          })
          .eq("id", doc.id);

        // CREAR/ACTUALIZAR REGLA EN CATÁLOGO DE PROVEEDORES AUTOMÁTICAMENTE
        // Guardar la cuenta contable usada para este proveedor como regla por defecto
        if (accountRef && doc.supplier_name) {
          console.log(`💾 Guardando regla automática para proveedor: ${doc.supplier_name} → Cuenta: ${accountRef}`);
          
          try {
            // Verificar si ya existe un default para este proveedor
            const { data: existingDefault } = await supabase
              .from("vendor_defaults")
              .select("id")
              .eq("organization_id", organization_id)
              .eq("vendor_name", doc.supplier_name)
              .maybeSingle();

            const defaultData = {
              vendor_name: doc.supplier_name,
              default_account_ref: accountRef,
              default_uses_tax: doc.uses_tax !== false, // Default true si no está definido
              organization_id: organization_id,
            };

            if (existingDefault) {
              // Actualizar regla existente
              await supabase
                .from("vendor_defaults")
                .update({
                  default_account_ref: accountRef,
                  default_uses_tax: doc.uses_tax !== false,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existingDefault.id);
              
              console.log(`✅ Regla actualizada para ${doc.supplier_name}`);
            } else {
              // Crear nueva regla
              await supabase
                .from("vendor_defaults")
                .insert(defaultData);
              
              console.log(`✅ Nueva regla creada para ${doc.supplier_name}`);
            }
          } catch (ruleError) {
            // No fallar la publicación si falla guardar la regla
            console.error(`⚠️ Error guardando regla para ${doc.supplier_name}:`, ruleError);
          }
        }

        const elapsedTime = Date.now() - startTime;
        console.log(`${progress} ✅ Factura ${doc.doc_number} publicada exitosamente en ${elapsedTime}ms`);
        return { success: true, docNumber: doc.doc_number };
      } catch (error) {
        const elapsedTime = Date.now() - startTime;
        console.error(`${progress} ❌ Error procesando documento ${doc.doc_number} después de ${elapsedTime}ms:`, error);
        
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
        
        // Guardar error en la BD
        await supabase
          .from("processed_documents")
          .update({
            status: "error",
            error_message: enhancedMessage.substring(0, 500),
          })
          .eq("id", doc.id);

        return {
          success: false,
          docNumber: doc.doc_number,
          error: enhancedMessage
        };
      }
    };
    
    // PROCESAMIENTO EN PARALELO (3 facturas simultáneas máximo)
    const BATCH_SIZE = 3;
    const documentResults = [];
    
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, Math.min(i + BATCH_SIZE, documents.length));
      const batchPromises = batch.map((doc, batchIndex) => 
        processDocument(doc, i + batchIndex, documents.length)
      );
      
      const batchResults = await Promise.all(batchPromises);
      documentResults.push(...batchResults);
    }
    
    // Contar resultados
    results.published = documentResults.filter(r => r.success).length;
    results.failed = documentResults.filter(r => !r.success).length;
    results.errors = documentResults
      .filter(r => !r.success)
      .map(r => ({ doc_number: r.docNumber, error: r.error }));
    
    const totalTime = Date.now() - batchStartTime;
    console.log(`🏁 Procesamiento completado en ${totalTime}ms: ${results.published} exitosas, ${results.failed} fallidas`);

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
