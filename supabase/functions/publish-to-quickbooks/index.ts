import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

// DEBUG flag - set to false in production
const DEBUG = Deno.env.get("DEBUG") === "true";

// Conditional logging helpers
const log = (...args: any[]) => DEBUG && console.log(...args);
const logInfo = (msg: string) => console.log(msg);
const logError = (...args: any[]) => console.error(...args);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper: Delay function for rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Per-invoice timeout for processing
const INVOICE_TIMEOUT_MS = 45000; // 45 seconds per invoice max

// Helper: Fetch with retry for rate limiting (429 errors)
const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelay = 2000
): Promise<Response> => {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Check for rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : baseDelay * Math.pow(2, attempt); // Exponential backoff
        
        if (attempt < maxRetries) {
          logInfo(`⏳ Rate limited (429), waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
          await delay(waitTime);
          continue;
        }
      }
      
      // Check for throttle error in response body
      if (!response.ok) {
        const clonedResponse = response.clone();
        try {
          const errorBody = await clonedResponse.text();
          if (errorBody.includes('ThrottleExceeded') || errorBody.includes('003001')) {
            const waitTime = baseDelay * Math.pow(2, attempt);
            if (attempt < maxRetries) {
              logInfo(`⏳ Throttle exceeded, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
              await delay(waitTime);
              continue;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
      
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const waitTime = baseDelay * Math.pow(2, attempt);
        logInfo(`⏳ Network error, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await delay(waitTime);
        continue;
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    
    // Allow internal calls without auth header (for batch operations)
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const isServiceRole = token === supabaseKey;
      
      if (!isServiceRole) {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          throw new Error("Authentication failed");
        }
        userId = user.id;
      }
    }

    const { organization_id, document_ids } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    logInfo(`📤 Publishing documents for org: ${organization_id}`);

    // Obtener configuración de la organización para manejos especiales
    const { data: orgSettings } = await supabase
      .from("organizations")
      .select("settings, name")
      .eq("id", organization_id)
      .maybeSingle();
    
    const settings = orgSettings?.settings as any || {};
    const taxHandling = settings?.tax_handling || 'standard'; // 'standard' o 'included_in_line_items'
    
    // Obtener configuración de default_uses_tax desde system_settings
    const { data: defaultUsesTaxSetting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("organization_id", organization_id)
      .eq("key", "default_uses_tax")
      .maybeSingle();
    
    // Si default_uses_tax = 'false', el IVA se trata como gasto no recuperable
    const orgDefaultUsesTax = defaultUsesTaxSetting?.value !== 'false';
    
    if (!orgDefaultUsesTax) {
      logInfo(`💰 Organización "${orgSettings?.name}" - IVA tratado como gasto no recuperable`);
    }
    
    if (taxHandling === 'included_in_line_items') {
      logInfo(`🏷️ Organización "${orgSettings?.name}" - IVA incluido en líneas de producto`);
    }

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
      logInfo("🔄 Refreshing QuickBooks token");
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

    // Obtener configuración de fecha mínima para publicar (por defecto: 90 días atrás)
    const { data: minDateSetting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("organization_id", organization_id)
      .eq("key", "min_publish_date")
      .maybeSingle();
    
    // Si no hay configuración, usar 180 días atrás como mínimo (para incluir más facturas)
    const minDate = minDateSetting?.value || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    logInfo(`📅 Fecha mínima de publicación: ${minDate}`);

    // Obtener documentos a publicar
    let query = supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .is("qbo_entity_id", null)
      .in("status", ["pending", "processed"])
      .gte("issue_date", minDate);

    if (document_ids && document_ids.length > 0) {
      query = query.in("id", document_ids);
    }

    const { data: documents, error: docError } = await query.limit(50);

    if (docError) throw docError;

    if (!documents || documents.length === 0) {
      logInfo(`⚠️ No documents found to publish (min_date: ${minDate}, org: ${organization_id})`);
      return new Response(
        JSON.stringify({ success: true, message: "No documents to publish", published: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logInfo(`📋 Found ${documents.length} document(s) to publish`);
    
    const isSingleDocument = documents.length === 1;

    const results = {
      published: 0,
      failed: 0,
      skipped_duplicates: 0,
      errors: [] as any[],
    };

    // Helper para buscar vendor en QBO (con timeout)
    // MULTI-CURRENCY: Si currency es USD, busca/crea vendor con sufijo " USD"
    const findOrCreateVendor = async (supplierName: string, supplierTaxId: string, currency: string = 'CRC') => {
      // Determinar el nombre del vendor según la moneda
      let baseNormalizedName = supplierName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
      
      // Para USD, agregar sufijo " USD" al nombre del vendor
      const isUSD = currency === 'USD';
      let vendorDisplayName = baseNormalizedName;
      
      if (isUSD) {
        // Quitar sufijo USD si ya existe para evitar duplicación
        vendorDisplayName = baseNormalizedName.replace(/\s*USD$/i, '').trim();
        vendorDisplayName = `${vendorDisplayName} USD`;
        logInfo(`💱 Factura en USD - Buscando/creando vendor: "${vendorDisplayName}"`);
      }
      
      // Truncar a 100 caracteres (límite de QB)
      vendorDisplayName = vendorDisplayName.substring(0, 100).trim();
      
      log(`🔍 Searching vendor: "${vendorDisplayName}" (currency: ${currency})`);
      
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout for vendor search
      
      try {
        // First try exact match
        const searchQuery = `SELECT * FROM Vendor WHERE DisplayName = '${vendorDisplayName.replace(/'/g, "\\'")}'`;
        const searchUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(searchQuery)}`;

        const searchResponse = await fetch(searchUrl, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.QueryResponse?.Vendor?.length > 0) {
            log(`✓ Found vendor: ${searchData.QueryResponse.Vendor[0].DisplayName}`);
            return searchData.QueryResponse.Vendor[0].Id;
          }
        }
        
        // Try LIKE search if exact match fails (handles slight variations)
        const likeController = new AbortController();
        const likeTimeoutId = setTimeout(() => likeController.abort(), 8000);
        
        try {
          const likeQuery = `SELECT * FROM Vendor WHERE DisplayName LIKE '%${vendorDisplayName.substring(0, 30).replace(/'/g, "\\'")}%'`;
          const likeUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(likeQuery)}`;

          const likeResponse = await fetch(likeUrl, {
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
            },
            signal: likeController.signal
          });

          clearTimeout(likeTimeoutId);

          if (likeResponse.ok) {
            const likeData = await likeResponse.json();
            if (likeData.QueryResponse?.Vendor?.length > 0) {
              // Find best match
              const normalizedTarget = vendorDisplayName.toLowerCase().replace(/\s+/g, ' ').trim();
              for (const vendor of likeData.QueryResponse.Vendor) {
                const normalizedVendor = (vendor.DisplayName || '').toLowerCase().replace(/\s+/g, ' ').trim();
                if (normalizedVendor.includes(normalizedTarget.substring(0, 20)) || 
                    normalizedTarget.includes(normalizedVendor.substring(0, 20))) {
                  logInfo(`✓ Found vendor via LIKE: ${vendor.DisplayName} (ID: ${vendor.Id})`);
                  return vendor.Id;
                }
              }
            }
          }
        } catch (likeErr) {
          clearTimeout(likeTimeoutId);
          // Continue to vendor creation
        }
      } catch (e) {
        clearTimeout(timeoutId);
        if (e instanceof Error && e.name === 'AbortError') {
          logError(`⏱️ Timeout searching vendor: ${vendorDisplayName}`);
          throw new Error(`Timeout buscando proveedor "${vendorDisplayName}"`);
        }
        throw e;
      }
      
      // Create vendor with timeout
      logInfo(`➕ Creating vendor: ${vendorDisplayName}${isUSD ? ' (para facturas USD)' : ''}`);
      
      const createController = new AbortController();
      const createTimeoutId = setTimeout(() => createController.abort(), 10000); // 10s for creation
      
      try {
        // Para vendors USD, intentar configurar la moneda en la creación
        const vendorPayload: any = { 
          DisplayName: vendorDisplayName,
        };
        
        // Si es USD, intentar establecer la moneda del vendor
        if (isUSD) {
          vendorPayload.CurrencyRef = { value: 'USD', name: 'United States Dollar' };
        }
        
        const createResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(vendorPayload),
            signal: createController.signal
          }
        );

        clearTimeout(createTimeoutId);

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          logError(`❌ Failed to create vendor "${vendorDisplayName}": ${errorText}`);
          
          // Intentar parsear el error de QBO
          try {
            const errorJson = JSON.parse(errorText);
            const qboError = errorJson?.Fault?.Error?.[0];
            if (qboError) {
              // Si es error de duplicado, extraer el ID existente
              if (qboError.code === '6240' || (qboError.Detail && qboError.Detail.includes('Id='))) {
                const idMatch = qboError.Detail?.match(/Id=(\d+)/);
                if (idMatch) {
                  const existingId = idMatch[1];
                  logInfo(`✅ Vendor already exists: ${vendorDisplayName} (ID: ${existingId}) - usando existente`);
                  return existingId;
                }
              }
              const detail = qboError.Detail || qboError.Message || 'Error desconocido';
              throw new Error(`Error QBO creando proveedor "${vendorDisplayName}": ${detail}`);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message.includes('Error QBO')) {
              throw parseErr;
            }
            // Si no se puede parsear, usar el mensaje genérico
          }
          
          throw new Error(`No se pudo crear el proveedor "${vendorDisplayName}" en QuickBooks: ${errorText.substring(0, 200)}`);
        }

        const vendorData = await createResponse.json();
        logInfo(`✅ Created vendor: ${vendorData.Vendor.DisplayName} (ID: ${vendorData.Vendor.Id})${isUSD ? ' - Configurado para USD' : ''}`);
        return vendorData.Vendor.Id;
      } catch (e) {
        clearTimeout(createTimeoutId);
        if (e instanceof Error && e.name === 'AbortError') {
          logError(`⏱️ Timeout creating vendor: ${vendorDisplayName}`);
          throw new Error(`Timeout creando proveedor "${vendorDisplayName}"`);
        }
        throw e;
      }
    };

    // Helper para verificar duplicados en QBO (con timeout) - CRITICAL: NO asumir "no duplicado" en timeout
    // Ahora verifica tanto Bill como VendorCredit según el tipo de documento
    const checkDuplicateInQBO = async (docNumber: string, vendorId: string | null, isCreditNote: boolean = false): Promise<{ isDuplicate: boolean; entityId: string | null; entityType: string | null; error?: string }> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout (increased)
      
      // Preparar DocNumber para búsqueda (mismo formato que se usa al crear)
      const qboDocNumber = docNumber.length > 21 
        ? docNumber.substring(docNumber.length - 21)
        : docNumber;
      
      // Determinar tipo de entidad a buscar
      const entityName = isCreditNote ? 'VendorCredit' : 'Bill';
      
      try {
        const query = `SELECT * FROM ${entityName} WHERE DocNumber = '${qboDocNumber.replace(/'/g, "\\'")}'`;
        const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const entities = data.QueryResponse?.[entityName] || [];
          
          if (entities.length > 0) {
            if (vendorId) {
              const matchingEntity = entities.find((entity: any) => 
                entity.VendorRef?.value === vendorId
              );
              if (matchingEntity) {
                log(`✓ Found existing ${entityName} ${qboDocNumber} for vendor ${vendorId}: ${matchingEntity.Id}`);
                return { isDuplicate: true, entityId: matchingEntity.Id, entityType: entityName };
              }
              log(`⚠️ ${entityName} ${qboDocNumber} exists in QBO but for different vendor - NOT a duplicate`);
              return { isDuplicate: false, entityId: null, entityType: null };
            }
            return { isDuplicate: true, entityId: entities[0].Id, entityType: entityName };
          }
        }
        return { isDuplicate: false, entityId: null, entityType: null };
      } catch (e) {
        clearTimeout(timeoutId);
        if (e instanceof Error && e.name === 'AbortError') {
          logError(`⏱️ Timeout verificando duplicado ${entityName}: ${docNumber} - DETENIENDO para evitar duplicación`);
          // CRITICAL: NO asumir que no es duplicado - lanzar error para evitar duplicación
          return { isDuplicate: false, entityId: null, entityType: null, error: `Timeout verificando duplicado - reintentar más tarde` };
        }
        return { isDuplicate: false, entityId: null, entityType: null, error: `Error verificando duplicado: ${e}` };
      }
    };
    
    // Alias para compatibilidad (función anterior)
    const checkDuplicateBill = (docNumber: string, vendorId: string | null) => checkDuplicateInQBO(docNumber, vendorId, false);

    const batchStartTime = Date.now();
    
    // Pre-cargar vendors en batch
    const uniqueVendorNames = [...new Set(documents.map(d => d.supplier_name))];
    const { data: allVendors } = await supabase
      .from("vendors")
      .select("*")
      .eq("organization_id", organization_id)
      .in("vendor_name", uniqueVendorNames);
    
    const vendorsMap = new Map(allVendors?.map(v => [v.vendor_name, v]) || []);
    
    const { data: allVendorDefaults } = await supabase
      .from("vendor_defaults")
      .select("*")
      .eq("organization_id", organization_id)
      .in("vendor_name", uniqueVendorNames);
    
    const vendorDefaultsMap = new Map(allVendorDefaults?.map(v => [v.vendor_name, v]) || []);
    
    log(`✓ Pre-loaded ${vendorsMap.size} vendors, ${vendorDefaultsMap.size} defaults`);
    
    // Función auxiliar para procesar un documento
    const processDocument = async (doc: any, index: number, total: number) => {
      const progress = `[${index + 1}/${total}]`;
      const startTime = Date.now();
      
      try {
        log(`${progress} 📄 Processing ${doc.doc_number}`);
        
        // Verificar duplicado en DB por doc_key (único) o doc_number + supplier_tax_id
        const { data: duplicateInDB } = await supabase
          .from("processed_documents")
          .select("id, doc_number, doc_key, supplier_tax_id, status, qbo_entity_id")
          .eq("organization_id", organization_id)
          .eq("doc_key", doc.doc_key)
          .neq("id", doc.id)
          .maybeSingle();
        
        if (duplicateInDB) {
          logError(`⚠️ Duplicate in DB by doc_key: ${doc.doc_number}`);
          
          await supabase
            .from("processed_documents")
            .update({
              status: "error",
              error_message: `Factura duplicada - Ya existe con ID ${duplicateInDB.id}`,
            })
            .eq("id", doc.id);
          
          return { success: false, docNumber: doc.doc_number, error: "Factura duplicada" };
        }
        
        // FIRST: Get or create the vendor - we need vendorId BEFORE checking QB duplicates
        // MULTI-CURRENCY: Pasar la moneda del documento para crear vendor USD si es necesario
        const vendorId = await findOrCreateVendor(doc.supplier_name, doc.supplier_tax_id, doc.currency);
        
        // Detectar si es nota de crédito ANTES de verificar duplicados
        const docXmlData = doc.xml_data || {};
        const isDocCreditNote = docXmlData.esNotaCredito === true || 
                             doc.doc_type === 'NotaCreditoElectronica' || 
                             doc.doc_type === 'NC' || 
                             doc.doc_type === '03';
        
        // Verificar duplicado en QBO - usa la función correcta según tipo de documento
        // This prevents false matches when same invoice number exists for different vendors
        const duplicateCheck = await checkDuplicateInQBO(doc.doc_number, vendorId, isDocCreditNote);
        
        // Si hubo error verificando duplicado, NO continuar para evitar duplicación
        if (duplicateCheck.error) {
          logError(`❌ Error verificando duplicado para ${doc.doc_number}: ${duplicateCheck.error}`);
          await supabase
            .from("processed_documents")
            .update({
              status: "error",
              error_message: duplicateCheck.error,
            })
            .eq("id", doc.id);
          return { success: false, docNumber: doc.doc_number, error: duplicateCheck.error };
        }
        
        if (duplicateCheck.isDuplicate && duplicateCheck.entityId) {
          const entityType = duplicateCheck.entityType || (isDocCreditNote ? 'VendorCredit' : 'Bill');
          logInfo(`⚠️ DUPLICADO DETECTADO: ${entityType} ${doc.doc_number} ya existe en QuickBooks (ID: ${duplicateCheck.entityId}) para vendor ${doc.supplier_name}`);
          
          await supabase
            .from("processed_documents")
            .update({
              qbo_entity_id: duplicateCheck.entityId,
              qbo_entity_type: entityType,
              status: "published",
              error_message: `Ya existía en QuickBooks (${entityType} ID: ${duplicateCheck.entityId})`,
            })
            .eq("id", doc.id);

          return { success: true, docNumber: doc.doc_number, skipped: true, reason: `Ya existe en QuickBooks (ID: ${duplicateCheck.entityId})` };
        }
        
        // RE-VERIFICACIÓN CRÍTICA: Verificar que el documento NO tiene qbo_entity_id antes de crear
        // Esto previene duplicación cuando hay ejecuciones paralelas
        const { data: freshDoc } = await supabase
          .from("processed_documents")
          .select("qbo_entity_id, status")
          .eq("id", doc.id)
          .single();
        
        if (freshDoc?.qbo_entity_id) {
          logInfo(`⚠️ Documento ${doc.doc_number} ya fue publicado por otra ejecución: ${freshDoc.qbo_entity_id}`);
          return { success: true, docNumber: doc.doc_number };
        }

        // Cache global para TaxCodes (evitar múltiples llamadas)
        let allTaxCodes: any[] = [];
        let taxCodesLoaded = false;
        let defaultNoTaxId: string | null = null;
        
        // Función para cargar todos los TaxCodes una sola vez
        const loadAllTaxCodes = async (): Promise<any[]> => {
          if (taxCodesLoaded) return allTaxCodes;
          
          try {
            const query = `SELECT Id, Name, Description FROM TaxCode WHERE Active = true MAXRESULTS 100`;
            const queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            const response = await fetchWithRetry(queryUrl, {
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/json",
              },
            });

            taxCodesLoaded = true;
            
            if (!response.ok) {
              allTaxCodes = [];
              return [];
            }

            const data = await response.json();
            allTaxCodes = data.QueryResponse?.TaxCode || [];
            
            // Log de TaxCodes disponibles para debug
            logInfo(`📋 TaxCodes disponibles en QBO: ${allTaxCodes.map((tc: any) => `${tc.Name} (${tc.Id})`).join(', ')}`);
            
            // Encontrar el código "No VAT" o similar para usar como fallback
            for (const taxCode of allTaxCodes) {
              const name = (taxCode.Name || "").toLowerCase();
              if (name.includes('no vat') || name.includes('non') || name === 'out of scope') {
                defaultNoTaxId = taxCode.Id;
                logInfo(`✅ TaxCode por defecto (sin IVA): ${taxCode.Name} (${taxCode.Id})`);
                break;
              }
            }
            
            return allTaxCodes;
          } catch (err) {
            logError('Error cargando TaxCodes:', err);
            taxCodesLoaded = true;
            allTaxCodes = [];
            return [];
          }
        };

        // Función para obtener código de impuesto
        const getTaxCodeRef = async (taxRate: number): Promise<string | null> => {
          const taxCodes = await loadAllTaxCodes();
          
          for (const taxCode of taxCodes) {
            const name = (taxCode.Name || "").toLowerCase();
            const description = (taxCode.Description || "").toLowerCase();
            
            if (taxRate === 0) {
              // Buscar código sin impuesto
              const zeroPatterns = ['no vat', 'non', 'sin iva', 'exento', 'exempt', '0%', 'out of scope'];
              for (const pattern of zeroPatterns) {
                if (name.includes(pattern) || description.includes(pattern)) {
                  return taxCode.Id;
                }
              }
            } else {
              // Patrones específicos para tasas de Costa Rica
              // Ej: "13% S (13%)", "4% R (4%)", "1% R Import (1%)", "2% R Import (2%)"
              const rate = Math.round(taxRate);
              const patterns = [
                `${rate}%`,           // "13%"
                `(${rate}%)`,         // "(13%)"
                `${rate}% s`,         // "13% S" - Servicios
                `${rate}% r`,         // "4% R" - Retención
                `iva ${rate}%`,       // "IVA 13%"
                `iva${rate}`,         // "IVA13"
              ];
              
              for (const pattern of patterns) {
                if (name.includes(pattern) || description.includes(pattern)) {
                  return taxCode.Id;
                }
              }
              
              // Buscar coincidencia exacta del porcentaje en el nombre
              const rateRegex = new RegExp(`\\b${rate}%?\\b`);
              if (rateRegex.test(name)) {
                return taxCode.Id;
              }
            }
          }
          
          // Si no encontró, retornar el código por defecto (No VAT)
          if (defaultNoTaxId) {
            logInfo(`⚠️ No se encontró TaxCode para ${taxRate}%, usando fallback: ${defaultNoTaxId}`);
          }
          return defaultNoTaxId;
        };

        // Función para obtener ID de cuenta (con retry y búsqueda mejorada)
        const getAccountIdByCode = async (accountCode: string): Promise<string | null> => {
          try {
            const query = `SELECT Id, Name, AcctNum, AccountType FROM Account MAXRESULTS 1000`;
            const queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
            
            const response = await fetchWithRetry(queryUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });

            if (!response.ok) return null;

            const data = await response.json();
            const allAccounts = data.QueryResponse?.Account || [];
            
            // Normalizar el código de búsqueda
            const searchCode = accountCode.trim();
            const searchCodeLower = searchCode.toLowerCase();
            
            logInfo(`🔍 Buscando cuenta con código: "${searchCode}" entre ${allAccounts.length} cuentas`);
            
            // 0. FIRST: Si es un número simple (1-3 dígitos), buscar DIRECTAMENTE por ID interno de QB
            // Esto resuelve el bug donde vendor_defaults tiene IDs internos (97, 81, 93) en vez de códigos
            if (/^\d{1,3}$/.test(searchCode)) {
              const targetByInternalId = allAccounts.find((acc: any) => acc.Id === searchCode);
              if (targetByInternalId) {
                logInfo(`✅ Cuenta encontrada por ID interno de QB: ${targetByInternalId.Name} (ID: ${targetByInternalId.Id}, AcctNum: ${targetByInternalId.AcctNum || 'N/A'})`);
                return targetByInternalId.Id;
              }
            }
            
            // 1. Buscar match exacto por AcctNum
            let targetAccount = allAccounts.find((acc: any) => 
              acc.AcctNum && acc.AcctNum === searchCode
            );
            
            if (targetAccount) {
              logInfo(`✅ Cuenta encontrada por AcctNum exacto: ${targetAccount.Name} (ID: ${targetAccount.Id})`);
              return targetAccount.Id;
            }
            
            // 2. Buscar por nombre que empiece con el código
            targetAccount = allAccounts.find((acc: any) => {
              const name = acc.Name || '';
              return name.startsWith(searchCode + ' ') || 
                     name.startsWith(searchCode + '-') ||
                     name.startsWith(searchCode + ':');
            });
            
            if (targetAccount) {
              logInfo(`✅ Cuenta encontrada por nombre con código: ${targetAccount.Name} (ID: ${targetAccount.Id})`);
              return targetAccount.Id;
            }
            
            // 3. Buscar por nombre que CONTENGA el código/palabra clave
            const searchWords = searchCodeLower.split(/[\s\-]+/);
            targetAccount = allAccounts.find((acc: any) => {
              const nameLower = (acc.Name || '').toLowerCase();
              // Si busca "Combustibles", encontrar cuenta que contenga esa palabra
              return searchWords.some(word => word.length > 3 && nameLower.includes(word));
            });
            
            if (targetAccount) {
              logInfo(`✅ Cuenta encontrada por palabra clave: ${targetAccount.Name} (ID: ${targetAccount.Id})`);
              return targetAccount.Id;
            }
            
            // 4. Fallback: buscar cuenta padre si tiene guión
            if (searchCode.includes('-')) {
              const baseCode = searchCode.split('-')[0];
              
              targetAccount = allAccounts.find((acc: any) => {
                if (acc.AcctNum && acc.AcctNum === baseCode) return true;
                if (acc.Name && acc.Name.startsWith(baseCode + ' ')) return true;
                return false;
              });
              
              if (targetAccount) {
                logInfo(`⚠️ Usando cuenta padre: ${targetAccount.Name} (ID: ${targetAccount.Id})`);
                return targetAccount.Id;
              }
            }
            
            // Log de cuentas similares para debug
            const similarAccounts = allAccounts
              .filter((acc: any) => {
                const name = (acc.Name || '').toLowerCase();
                const acctNum = (acc.AcctNum || '').toLowerCase();
                return name.includes('combust') || 
                       name.includes('gasolin') ||
                       name.includes('costo') ||
                       acctNum.startsWith('51');
              })
              .slice(0, 10);
            
            if (similarAccounts.length > 0) {
              logError(`❌ Cuenta "${searchCode}" no encontrada. Cuentas similares disponibles:`);
              similarAccounts.forEach((acc: any) => {
                logError(`   - ${acc.AcctNum || 'Sin código'}: ${acc.Name} (ID: ${acc.Id})`);
              });
            } else {
              logError(`❌ Cuenta "${searchCode}" no encontrada y no hay cuentas similares`);
            }
            
            return null;
          } catch (err) {
            logError('Error buscando cuenta:', err);
            return null;
          }
        };

        // Buscar cuenta contable
        let accountCode: string | null = null;
        
        // 1. Cuenta del documento
        if (doc.default_account_ref) {
          const rawCode = doc.default_account_ref;
          
          // Si es un ID puro (número de 1-3 dígitos), usarlo directamente
          if (/^\d{1,3}$/.test(rawCode.trim())) {
            accountCode = rawCode.trim();
            log(`✓ Account from document (ID directo): ${accountCode}`);
          } else {
            // Si tiene formato "670 - Nombre" o "670 Nombre", extraer el código
            const extractedCode = rawCode.includes(' - ') 
              ? rawCode.split(' - ')[0].trim()
              : rawCode.split(' ')[0].trim();
            
            // Si el código extraído parece un número válido, usarlo
            if (/^\d+/.test(extractedCode)) {
              accountCode = extractedCode;
              log(`✓ Account from document (extraído): ${accountCode}`);
            } else {
              // Fallback: usar el valor raw completo para búsqueda por nombre
              accountCode = rawCode.trim();
              log(`✓ Account from document (nombre completo): ${accountCode}`);
            }
          }
          
          if (!accountCode) {
            throw new Error(`Código de cuenta vacío: "${rawCode}"`);
          }
        }
        
        // 2. Buscar en vendors
        if (!accountCode) {
          let vendorData = null;
          
          if (doc.vendor_id) {
            const { data } = await supabase
              .from("vendors")
              .select("vendor_name, default_account_ref, qbo_vendor_ref")
              .eq("id", doc.vendor_id)
              .maybeSingle();
            vendorData = data;
          }
          
          if (!vendorData && vendorId) {
            const { data } = await supabase
              .from("vendors")
              .select("vendor_name, default_account_ref, qbo_vendor_ref")
              .eq("organization_id", organization_id)
              .eq("qbo_vendor_ref", vendorId)
              .maybeSingle();
            vendorData = data;
          }
          
          if (!vendorData) {
            const normalizedSupplierName = doc.supplier_name
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            
            const { data: allOrgVendors } = await supabase
              .from("vendors")
              .select("vendor_name, default_account_ref, qbo_vendor_ref")
              .eq("organization_id", organization_id);
            
            if (allOrgVendors) {
              vendorData = allOrgVendors.find(v => {
                const normalizedVendorName = v.vendor_name
                  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                return normalizedVendorName === normalizedSupplierName;
              });
            }
          }
          
          if (vendorData?.default_account_ref) {
            const rawCode = vendorData.default_account_ref;
            accountCode = rawCode.includes(' - ') 
              ? rawCode.split(' - ')[0].trim()
              : rawCode.split(' ')[0].trim();
            log(`✓ Account from vendor: ${accountCode}`);
          }
        }
        
        // 3. Buscar en vendor_defaults
        if (!accountCode) {
          const normalizedSupplierName = doc.supplier_name
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          
          const { data: allVendorDefaults } = await supabase
            .from("vendor_defaults")
            .select("vendor_name, default_account_ref")
            .eq("organization_id", organization_id);
          
          if (allVendorDefaults) {
            const matchedDefault = allVendorDefaults.find(vd => {
              const normalizedVendorName = vd.vendor_name
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
              return normalizedVendorName === normalizedSupplierName;
            });
            
            if (matchedDefault?.default_account_ref) {
              const rawCode = matchedDefault.default_account_ref;
              accountCode = rawCode.includes(' - ') 
                ? rawCode.split(' - ')[0].trim()
                : rawCode.split(' ')[0].trim();
              log(`✓ Account from vendor_defaults: ${accountCode}`);
            }
          }
        }
        
        // 4. Buscar en vendor_categories
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
            log(`✓ Account from vendor_categories: ${accountCode}`);
          }
        }
        
        // 5. Buscar en classification rules
        if (!accountCode) {
          const normalizedSupplierName = doc.supplier_name
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          
          const { data: allClassificationRules } = await supabase
            .from("vendor_classification_rules")
            .select("vendor_name, account_code")
            .eq("organization_id", organization_id)
            .eq("is_active", true);
          
          if (allClassificationRules) {
            const matchedRule = allClassificationRules.find(rule => {
              const normalizedRuleName = rule.vendor_name
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
              return normalizedRuleName === normalizedSupplierName;
            });
            
            if (matchedRule?.account_code) {
              accountCode = matchedRule.account_code.split(" ")[0];
              log(`✓ Account from classification rule: ${accountCode}`);
            }
          }
        }
        
        // 6. Buscar en xml_data
        if (!accountCode && doc.xml_data?.cuentaContable) {
          const rawAccount = doc.xml_data.cuentaContable.trim();
          const xmlAccount = rawAccount.split(" ")[0].split(":")[0];
          
          if (xmlAccount && xmlAccount !== "Gastos" && xmlAccount !== "por" && xmlAccount !== "clasificar") {
            accountCode = xmlAccount;
            log(`✓ Account from XML: ${accountCode}`);
          }
        }
        
        // 7. Sin cuenta configurada
        if (!accountCode) {
          log(`❌ No account for ${doc.supplier_name}`);
          
          await supabase
            .from("processed_documents")
            .update({
              status: "pending_config",
              error_message: "Proveedor sin cuenta contable configurada",
            })
            .eq("id", doc.id);

          return { success: false, docNumber: doc.doc_number, error: "No account configured" };
        }
        
        // Obtener ID de cuenta en QuickBooks
        let accountRef = await getAccountIdByCode(accountCode!);
        
        if (!accountRef) {
          throw new Error(`Cuenta ${accountCode} no existe en QuickBooks. Factura ${doc.doc_number} - Proveedor: ${doc.supplier_name}. Verifica que la cuenta esté creada.`);
        }

        const isCreditNote = doc.xml_data?.esNotaCredito === true || doc.doc_type === 'NotaCreditoElectronica';
        
        // ============================================
        // NOTAS DE CRÉDITO: Asegurar montos negativos
        // ============================================
        if (isCreditNote) {
          logInfo(`💳 NOTA DE CRÉDITO detectada: ${doc.doc_number}`);
          // Verificar que los montos sean negativos
          if (doc.total_amount > 0) {
            logInfo(`⚠️ Nota de crédito con monto positivo (${doc.total_amount}), convirtiendo a negativo`);
            // Actualizar en memoria para el procesamiento
            doc.total_amount = -Math.abs(doc.total_amount);
            doc.total_tax = -(Math.abs(doc.total_tax || 0));
          }
          logInfo(`💳 Montos NC: total=${doc.total_amount}, tax=${doc.total_tax}`);
        }
        
        // ============================================
        // FIX ERROR 1: Detectar y usar UNA SOLA MONEDA
        // ============================================
        const xmlData = doc.xml_data as any;
        
        // Determinar la moneda principal del documento
        let documentCurrency = 'CRC'; // Default
        
        // 1. Del campo currency del documento
        if (doc.currency) {
          documentCurrency = doc.currency.toUpperCase();
        }
        // 2. Del XML data
        else if (xmlData?.moneda) {
          documentCurrency = xmlData.moneda.toUpperCase();
        }
        // 3. Inferir si tiene tipo de cambio mayor a 1
        else if (xmlData?.tipoCambio && parseFloat(xmlData.tipoCambio) > 1) {
          documentCurrency = 'USD';
        }
        
        log(`💱 Document currency: ${documentCurrency}`);
        
        // Preparar líneas con UNA SOLA moneda
        const lines = [];
        const taxCodeCache = new Map<number, string | null>();
        
        // Tree of Life mode: IVA incluido en líneas de producto
        const includeTaxInLines = taxHandling === 'included_in_line_items';
        
        if (includeTaxInLines) {
          logInfo(`💰 Modo Tree of Life: IVA proporcional incluido en cada línea`);
        }
        
        if (xmlData?.detalle && Array.isArray(xmlData.detalle) && xmlData.detalle.length > 0) {
          for (const item of xmlData.detalle) {
            const cantidad = parseFloat(item.cantidad) || 1;
            let precioUnitario = parseFloat(item.precioUnitario) || 0;
            let subtotal = parseFloat(item.subtotal) || (cantidad * precioUnitario);
            
            // NOTAS DE CRÉDITO: Asegurar que los montos de línea sean negativos
            if (isCreditNote) {
              precioUnitario = -Math.abs(precioUnitario);
              subtotal = -Math.abs(subtotal);
            }
            
            let tasaImpuesto = 0;
            let montoImpuesto = 0;
            
            if (item.impuestos && Array.isArray(item.impuestos)) {
              const ivaImpuesto = item.impuestos.find((imp: any) => imp.codigo === '01');
              if (ivaImpuesto) {
                tasaImpuesto = parseFloat(ivaImpuesto.tarifa) || 0;
                montoImpuesto = parseFloat(ivaImpuesto.monto) || 0;
                // NOTAS DE CRÉDITO: Impuesto también negativo
                if (isCreditNote) {
                  montoImpuesto = -Math.abs(montoImpuesto);
                }
              }
            } else {
              tasaImpuesto = parseFloat(item.tarifa) || 0;
              montoImpuesto = parseFloat(item.montoImpuesto) || 0;
              if (isCreditNote) {
                montoImpuesto = -Math.abs(montoImpuesto);
              }
            }
            
            if (montoImpuesto === 0 && tasaImpuesto > 0) {
              montoImpuesto = subtotal * (tasaImpuesto / 100); // subtotal ya es negativo si es NC
            }
            
            // TREE OF LIFE: Incluir IVA en el monto de la línea
            let lineAmount = subtotal;
            if (includeTaxInLines && Math.abs(montoImpuesto) > 0) {
              lineAmount = subtotal + montoImpuesto; // Ambos negativos en NC
              log(`   💰 Línea con IVA incluido: ${subtotal} + ${montoImpuesto} = ${lineAmount}`);
            }
            
            if (Math.abs(lineAmount) > 0) {
              const descripcionBase = item.descripcion || "";
              const codigoProducto = item.codigoProducto || item.codigo || "";
              const unidadMedida = item.unidadMedida || "";
              
              let descripcionFinal = descripcionBase;
              if (codigoProducto && !descripcionBase.includes(codigoProducto)) {
                descripcionFinal = `[${codigoProducto}] ${descripcionBase}`;
              }
              if (unidadMedida && !descripcionBase.toLowerCase().includes(unidadMedida.toLowerCase())) {
                descripcionFinal += ` (${unidadMedida})`;
              }
              if (cantidad > 1) {
                descripcionFinal += ` - Cant: ${cantidad}`;
              }
              
              // TREE OF LIFE: Indicar en descripción que IVA está incluido
              if (includeTaxInLines && montoImpuesto > 0) {
                descripcionFinal += ` (IVA ${tasaImpuesto}% incluido)`;
              }
              
              descripcionFinal = descripcionFinal.substring(0, 4000);

              const lineDetail: any = {
                DetailType: "AccountBasedExpenseLineDetail",
                Amount: lineAmount,
                Description: descripcionFinal,
                AccountBasedExpenseLineDetail: {
                  AccountRef: { value: accountRef },
                },
              };

              // SIEMPRE asignar TaxCodeRef (QuickBooks lo requiere en todas las líneas)
              // Para Tree of Life (IVA incluido en líneas), usar tasa 0% ya que el impuesto está en el monto
              const taxRateForCode = includeTaxInLines ? 0 : tasaImpuesto;
              
              let taxCodeId = taxCodeCache.get(taxRateForCode);
              if (taxCodeId === undefined) {
                taxCodeId = await getTaxCodeRef(taxRateForCode);
                taxCodeCache.set(taxRateForCode, taxCodeId);
              }
              
              if (taxCodeId) {
                lineDetail.AccountBasedExpenseLineDetail.TaxCodeRef = { value: taxCodeId };
              } else {
                logInfo(`⚠️ Línea sin TaxCodeRef asignado para tasa ${taxRateForCode}%`);
              }

              lines.push(lineDetail);
            }
          }
        }
        
        // Fallback: crear línea desde totales
        if (lines.length === 0) {
          // TREE OF LIFE: Usar total_amount directamente (ya incluye IVA)
          let subtotal: number;
          if (includeTaxInLines) {
            subtotal = doc.total_amount; // Total con IVA incluido
          } else {
            // Aplicar configuración de organización: si orgDefaultUsesTax es false, el IVA se incluye en el monto
            const effectiveUsesTax = (doc.uses_tax !== false) && orgDefaultUsesTax;
            subtotal = effectiveUsesTax
              ? doc.total_amount - (doc.total_tax || 0)
              : doc.total_amount;
          }
          
          if (Math.abs(subtotal) <= 0) {
            throw new Error(`Invalid total amount: ${doc.total_amount}`);
          }
          
          const fallbackLine: any = {
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: subtotal,
            Description: `${isCreditNote ? 'Nota de Crédito' : 'Factura'} ${doc.doc_number} - ${doc.supplier_name}${includeTaxInLines ? ' (IVA incluido)' : ''}`,
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: accountRef },
            },
          };
          
          // SIEMPRE asignar TaxCodeRef (QuickBooks lo requiere en todas las líneas)
          // Para Tree of Life o cuando orgDefaultUsesTax es false, usar tasa 0%
          const effectiveUsesTax = (doc.uses_tax !== false) && orgDefaultUsesTax && !includeTaxInLines;
          const fallbackTaxRate = effectiveUsesTax && doc.total_tax && doc.total_tax > 0 ? 13 : 0;
          const fallbackTaxCodeId = await getTaxCodeRef(fallbackTaxRate);
          
          if (fallbackTaxCodeId) {
            fallbackLine.AccountBasedExpenseLineDetail.TaxCodeRef = { value: fallbackTaxCodeId };
          }
          
          lines.push(fallbackLine);
        }
        
        // Aplicar configuración de organización para determinar si usar IVA como línea separada
        const effectiveDocUsesTax = (doc.uses_tax !== false) && orgDefaultUsesTax;
        const documentUsesTax = effectiveDocUsesTax && !includeTaxInLines;
        const totalTax = documentUsesTax ? (parseFloat(doc.total_tax as any) || 0) : 0;
        const subtotalLines = lines.reduce((sum, l) => sum + l.Amount, 0);
        
        log(`✓ Lines: ${lines.length}, subtotal: ${subtotalLines}, tax: ${totalTax}${includeTaxInLines ? ' (IVA en líneas)' : ''}`);

        // Preparar DocNumber
        if (doc.doc_number.length > 30) {
          throw new Error(`Invalid doc_number - appears to be Clave`);
        }
        
        const qboDocNumber = doc.doc_number.length > 21 
          ? doc.doc_number.substring(doc.doc_number.length - 21)
          : doc.doc_number;

        if (!lines || lines.length === 0) {
          throw new Error(`Cannot create bill without line items`);
        }

        // ============================================
        // Crear Bill o VendorCredit según tipo de documento
        // ============================================
        
        let entityId: string;
        let entityType: string;
        
        if (isCreditNote) {
          // ============================================
          // NOTA DE CRÉDITO → VendorCredit (montos POSITIVOS en QBO)
          // ============================================
          logInfo(`💳 Creando VendorCredit para NC ${doc.doc_number}`);
          
          // VendorCredit en QBO usa montos POSITIVOS (el sistema sabe que es un crédito)
          const vendorCreditLines = lines.map(line => ({
            ...line,
            Amount: Math.abs(line.Amount), // Convertir a positivo para VendorCredit
          }));
          
          const vendorCreditSubtotal = vendorCreditLines.reduce((sum, l) => sum + l.Amount, 0);
          logInfo(`💳 VendorCredit subtotal: ${vendorCreditSubtotal} (${vendorCreditLines.length} líneas)`);
          
          const vendorCreditPayload: any = {
            VendorRef: { value: vendorId },
            TxnDate: doc.issue_date,
            DocNumber: qboDocNumber,
            Line: vendorCreditLines,
            PrivateNote: `Nota de Crédito XML: ${doc.doc_number}\nProveedor: ${doc.supplier_name}\nMoneda: ${documentCurrency}`,
            GlobalTaxCalculation: includeTaxInLines ? "TaxInclusive" : "TaxExcluded",
          };
          
          // Solo agregar CurrencyRef si es USD
          if (documentCurrency === 'USD') {
            vendorCreditPayload.CurrencyRef = { value: "USD" };
            const exchangeRate = parseFloat(xmlData?.resumen_factura?.tipoCambio || xmlData?.tipoCambio || '1');
            if (exchangeRate && exchangeRate > 1) {
              vendorCreditPayload.ExchangeRate = exchangeRate;
            }
          }
          
          // Tax detail para VendorCredit (montos positivos)
          if (documentUsesTax && totalTax !== 0 && !includeTaxInLines) {
            vendorCreditPayload.TxnTaxDetail = { TotalTax: Math.abs(totalTax) };
          }
          
          await delay(1000);
          
          const vendorCreditResponse = await fetchWithRetry(
            `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendorcredit`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(vendorCreditPayload),
            }
          );
          
          if (!vendorCreditResponse.ok) {
            const errorText = await vendorCreditResponse.text();
            logError(`❌ Failed to create VendorCredit: ${errorText.substring(0, 200)}`);
            
            await supabase
              .from("processed_documents")
              .update({
                status: "error",
                error_message: `QBO VendorCredit Error: ${errorText.substring(0, 500)}`,
              })
              .eq("id", doc.id);
            
            return { success: false, docNumber: doc.doc_number, error: errorText.substring(0, 200) };
          }
          
          const vendorCreditData = await vendorCreditResponse.json();
          entityId = vendorCreditData.VendorCredit.Id;
          entityType = "VendorCredit";
          
          logInfo(`✅ VendorCredit created: ${doc.doc_number} → ${entityId}`);
          
        } else {
          // ============================================
          // FACTURA → Bill
          // ============================================
          const billPayload: any = {
            VendorRef: { value: vendorId },
            TxnDate: doc.issue_date,
            DocNumber: qboDocNumber,
            Line: lines,
            DueDate: doc.issue_date,
            PrivateNote: `Factura XML: ${doc.doc_number}\nProveedor: ${doc.supplier_name}\nMoneda: ${documentCurrency}${includeTaxInLines ? '\nIVA incluido en líneas' : ''}`,
            GlobalTaxCalculation: includeTaxInLines ? "TaxInclusive" : "TaxExcluded",
          };

          // Solo agregar CurrencyRef si NO es CRC (moneda base)
          if (documentCurrency === 'USD') {
            billPayload.CurrencyRef = { value: "USD" };
            
            // Tipo de cambio
            const exchangeRate = parseFloat(xmlData?.resumen_factura?.tipoCambio || xmlData?.tipoCambio || '1');
            if (exchangeRate && exchangeRate > 1) {
              billPayload.ExchangeRate = exchangeRate;
            }
          }

          // TREE OF LIFE: NO agregar TxnTaxDetail cuando IVA está en líneas
          if (documentUsesTax && totalTax > 0 && !includeTaxInLines) {
            billPayload.TxnTaxDetail = { TotalTax: totalTax };
          }

          // ============================================
          // FIX ERROR 2: Usar fetchWithRetry para rate limiting
          // ============================================
          // Small delay before creating bill (rate limiting prevention)
          await delay(1000);
          
          const billResponse = await fetchWithRetry(
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
            logError(`❌ Failed to create bill: ${errorText.substring(0, 200)}`);
            
            await supabase
              .from("processed_documents")
              .update({
                status: "error",
                error_message: `QBO Error: ${errorText.substring(0, 500)}`,
              })
              .eq("id", doc.id);

            return { success: false, docNumber: doc.doc_number, error: errorText.substring(0, 200) };
          }

          const billData = await billResponse.json();
          entityId = billData.Bill.Id;
          entityType = "Bill";

          logInfo(`✅ Bill created: ${doc.doc_number} → ${entityId}`);
          
          // ============================================
          // VERIFICACIÓN POST-PUBLICACIÓN: Confirmar que el Bill existe
          // ============================================
          try {
            await delay(300); // Pequeña pausa antes de verificar
            const verifyResponse = await fetch(
              `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill/${entityId}?minorversion=73`,
              {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Accept': 'application/json'
                }
              }
            );
            
            if (!verifyResponse.ok) {
              logError(`⚠️ VERIFICACIÓN FALLIDA: Bill ${entityId} no existe después de creación`);
              // NO marcar como published si no podemos verificar
              await supabase
                .from("processed_documents")
                .update({
                  status: "error",
                  error_message: `Bill creado (ID: ${entityId}) pero verificación falló - requiere auditoría`,
                  qbo_entity_id: entityId, // Guardar ID para investigación
                  qbo_entity_type: entityType
                })
                .eq("id", doc.id);
              
              return { success: false, docNumber: doc.doc_number, error: "Verificación post-publicación falló" };
            }
            
            log(`✓ Verificación exitosa: Bill ${entityId} confirmado en QBO`);
          } catch (verifyErr: any) {
            // Si falla la verificación pero el Bill se creó, continuar pero loguear
            logError(`⚠️ No se pudo verificar Bill ${entityId}: ${verifyErr.message}`);
          }
        }

        // Adjuntar PDF (con delay para rate limiting)
        if (doc.pdf_attachment_url) {
          try {
            await delay(500); // Small delay before attachment
            
            let pdfPath = doc.pdf_attachment_url;
            if (pdfPath.includes('/object/public/company-documents/')) {
              pdfPath = pdfPath.split('/object/public/company-documents/')[1];
            } else if (pdfPath.includes('company-documents/')) {
              pdfPath = pdfPath.split('company-documents/').pop() || pdfPath;
            } else if (pdfPath.startsWith('http')) {
              const urlParts = pdfPath.split('company-documents/');
              if (urlParts.length > 1) pdfPath = urlParts[1];
            }
            
            const { data: pdfData, error: downloadError } = await supabase.storage
              .from("company-documents")
              .download(pdfPath);

            if (!downloadError && pdfData) {
              const arrayBuffer = await pdfData.arrayBuffer();
              const base64Pdf = btoa(
                new Uint8Array(arrayBuffer).reduce(
                  (data, byte) => data + String.fromCharCode(byte), ""
                )
              );

              const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
              const attachmentMetadata = {
                AttachableRef: [{ EntityRef: { type: entityType, value: entityId } }],
                FileName: `${isCreditNote ? 'nc' : 'factura'}_${doc.doc_number}.pdf`,
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

              const attachResponse = await fetchWithRetry(
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
                log(`✅ PDF attached to ${entityType} ${doc.doc_number}`);
              }
            }
          } catch (pdfError: any) {
            logError(`⚠️ PDF attachment error: ${pdfError.message}`);
          }
        }

        // Actualizar documento
        await supabase
          .from("processed_documents")
          .update({
            qbo_entity_id: entityId,
            qbo_entity_type: entityType,
            status: "published",
            processed_at: new Date().toISOString(),
            processed_by: userId,
            error_message: null,
          })
          .eq("id", doc.id);

        // Guardar regla automática
        if (accountRef && doc.supplier_name) {
          try {
            const { data: existingDefault } = await supabase
              .from("vendor_defaults")
              .select("id")
              .eq("organization_id", organization_id)
              .eq("vendor_name", doc.supplier_name)
              .maybeSingle();

            const defaultData = {
              vendor_name: doc.supplier_name,
              default_account_ref: accountRef,
              default_uses_tax: doc.uses_tax !== false,
              organization_id: organization_id,
            };

            if (existingDefault) {
              await supabase
                .from("vendor_defaults")
                .update({
                  default_account_ref: accountRef,
                  default_uses_tax: doc.uses_tax !== false,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existingDefault.id);
            } else {
              await supabase.from("vendor_defaults").insert(defaultData);
            }
          } catch {
            // Silently continue
          }
        }

        const elapsedTime = Date.now() - startTime;
        log(`${progress} ✅ Done in ${elapsedTime}ms`);
        return { success: true, docNumber: doc.doc_number };
      } catch (error) {
        const elapsedTime = Date.now() - startTime;
        logError(`${progress} ❌ Error after ${elapsedTime}ms:`, error);
        
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        await supabase
          .from("processed_documents")
          .update({
            status: "error",
            error_message: errorMessage.substring(0, 500),
          })
          .eq("id", doc.id);

        return { success: false, docNumber: doc.doc_number, error: errorMessage };
      }
    };
    
    // ============================================
    // Procesamiento con DELAYS entre documentos
    // ============================================
    const BATCH_SIZE = 2; // Reduced batch size for rate limiting
    const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches
    
    if (isSingleDocument) {
      const doc = documents[0];
      const result = await processDocument(doc, 0, 1);
      
      if (result.success) {
        if (result.skipped) {
          results.skipped_duplicates = 1;
        } else {
          results.published = 1;
        }
      } else {
        results.failed = 1;
        results.errors.push({ doc_number: result.docNumber, error: result.error });
      }
      
      const totalTime = Date.now() - batchStartTime;
      logInfo(`⚡ Single document processed in ${totalTime}ms${result.skipped ? ' (skipped - already in QBO)' : ''}`);
      
      return new Response(
        JSON.stringify({
          success: result.success,
          published: results.published,
          skipped_duplicates: results.skipped_duplicates,
          failed: results.failed,
          skipped_reason: result.reason || undefined,
          errors: results.errors.length > 0 ? results.errors : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
    
    // Múltiples documentos en lotes con delay
    const documentResults = [];
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      
      // Process batch sequentially to avoid rate limits
      for (let j = 0; j < batch.length; j++) {
        const doc = batch[j];
        const result = await processDocument(doc, i + j, documents.length);
        documentResults.push(result);
        
        // Add delay between documents in the same batch
        if (j < batch.length - 1) {
          await delay(1500);
        }
      }
      
      // Add delay between batches
      if (i + BATCH_SIZE < documents.length) {
        logInfo(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }
    
    // Contabilizar resultados
    for (const result of documentResults) {
      if (result.success) {
        if (result.skipped) {
          results.skipped_duplicates++;
        } else {
          results.published++;
        }
      } else {
        results.failed++;
        results.errors.push({ doc_number: result.docNumber, error: result.error });
      }
    }
    
    const totalTime = Date.now() - batchStartTime;
    logInfo(`📊 Batch complete: ${results.published} published, ${results.skipped_duplicates} skipped (duplicates), ${results.failed} failed in ${totalTime}ms`);

    return new Response(
      JSON.stringify({
        success: results.failed === 0,
        published: results.published,
        skipped_duplicates: results.skipped_duplicates,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    logError("❌ Publish error:", error);
    
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
