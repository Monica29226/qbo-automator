import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;
const TIMEOUT_MS = 45000; // Increased from 25s to 45s per invoice

interface ProcessResult {
  doc_id: string;
  doc_number: string;
  supplier_name: string;
  success: boolean;
  reason?: string;
  qbo_id?: string;
  elapsed_ms?: number;
}

interface OtroCargo {
  tipo: string;
  detalle: string;
  monto: number;
}

// Parse OtrosCargos from XML data
function parseOtrosCargos(xmlData: any): OtroCargo[] {
  const otrosCargos: OtroCargo[] = [];
  
  if (!xmlData) return otrosCargos;
  
  try {
    // Check in resumen_factura or ResumenFactura
    const resumen = xmlData.resumen_factura || xmlData.ResumenFactura || xmlData;
    
    // Look for otros_cargos array
    const cargos = resumen.otros_cargos || resumen.OtrosCargos || 
                   xmlData.otros_cargos || xmlData.OtrosCargos || [];
    
    if (Array.isArray(cargos)) {
      for (const cargo of cargos) {
        otrosCargos.push({
          tipo: cargo.tipo_documento || cargo.TipoDocumento || '',
          detalle: cargo.detalle || cargo.Detalle || 'Otros Cargos',
          monto: parseFloat(cargo.monto_cargo || cargo.MontoCargo || cargo.monto || '0')
        });
      }
    }
    
    // Also check for single cargo
    if (resumen.total_otros_cargos || resumen.TotalOtrosCargos) {
      const totalCargos = parseFloat(resumen.total_otros_cargos || resumen.TotalOtrosCargos || '0');
      if (totalCargos > 0 && otrosCargos.length === 0) {
        otrosCargos.push({
          tipo: 'OC',
          detalle: 'Otros Cargos',
          monto: totalCargos
        });
      }
    }
  } catch (e) {
    console.error('Error parsing OtrosCargos:', e);
  }
  
  return otrosCargos;
}

// Validate totals match
function validateTotals(xmlData: any, totalAmount: number): { valid: boolean; diff: number } {
  try {
    const resumen = xmlData?.resumen_factura || xmlData?.ResumenFactura || xmlData || {};
    
    const subtotal = parseFloat(resumen.total_venta_neta || resumen.TotalVentaNeta || resumen.subtotal || '0');
    const tax = parseFloat(resumen.total_impuesto || resumen.TotalImpuesto || resumen.total_tax || '0');
    const otrosCargos = parseOtrosCargos(xmlData);
    const otrosCargosTotal = otrosCargos.reduce((sum, c) => sum + c.monto, 0);
    const discount = parseFloat(resumen.total_descuento || resumen.TotalDescuentos || '0');
    
    const calculated = subtotal + tax + otrosCargosTotal - discount;
    const diff = Math.abs(calculated - totalAmount);
    
    return { valid: diff <= 0.02, diff };
  } catch (e) {
    console.warn('Error validating totals:', e);
    return { valid: true, diff: 0 }; // Allow if can't validate
  }
}

// Publish with timeout
async function publishWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  docNumber: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms para ${docNumber}`)), timeoutMs)
    )
  ]);
}

// Attach PDF to QuickBooks Bill
async function attachPDFToQuickBooks(
  billId: string,
  pdfUrl: string,
  accessToken: string,
  realmId: string,
  docNumber: string
): Promise<boolean> {
  try {
    if (!pdfUrl) {
      console.log(`📎 ${docNumber}: Sin PDF para adjuntar`);
      return false;
    }
    
    console.log(`📎 ${docNumber}: Descargando PDF...`);
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      console.warn(`📎 ${docNumber}: Error descargando PDF (${pdfResponse.status})`);
      return false;
    }
    
    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfArrayBuffer);
    
    // Create boundary for multipart
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    
    const metadata = JSON.stringify({
      AttachableRef: [{
        EntityRef: {
          type: "Bill",
          value: billId
        }
      }],
      FileName: `factura_${docNumber}.pdf`,
      ContentType: "application/pdf"
    });
    
    // Build multipart body
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    
    // Metadata part
    parts.push(encoder.encode(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file_metadata_01"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      metadata + `\r\n`
    ));
    
    // File part
    parts.push(encoder.encode(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file_content_01"; filename="factura_${docNumber}.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    ));
    parts.push(pdfBytes);
    parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
    
    // Combine all parts
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }
    
    console.log(`📎 ${docNumber}: Subiendo PDF a QuickBooks...`);
    const uploadResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/upload`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: body
      }
    );
    
    if (uploadResponse.ok) {
      console.log(`✅ ${docNumber}: PDF adjuntado exitosamente`);
      return true;
    } else {
      const errorText = await uploadResponse.text();
      console.warn(`📎 ${docNumber}: Error subiendo PDF (${uploadResponse.status}): ${errorText.substring(0, 200)}`);
      return false;
    }
  } catch (e) {
    console.warn(`📎 ${docNumber}: Error adjuntando PDF:`, e);
    return false;
  }
}

// Helper para verificar duplicados en QBO
async function checkDuplicateInQBO(
  docNumber: string, 
  accessToken: string, 
  realmId: string,
  isCreditNote: boolean
): Promise<{ isDuplicate: boolean; entityId: string | null; entityType: string | null }> {
  try {
    // Use full document number as-is from XML
    const qboDocNumber = docNumber;
    
    // Buscar según tipo de documento
    const entityName = isCreditNote ? 'VendorCredit' : 'Bill';
    const query = `SELECT Id, DocNumber FROM ${entityName} WHERE DocNumber = '${qboDocNumber.replace(/'/g, "\\'")}'`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        },
        signal: controller.signal
      }
    );
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      const entities = data.QueryResponse?.[entityName] || [];
      if (entities.length > 0) {
        console.log(`✓ ${entityName} ${qboDocNumber} ya existe en QBO: ID ${entities[0].Id}`);
        return { isDuplicate: true, entityId: entities[0].Id, entityType: entityName };
      }
    }
    
    return { isDuplicate: false, entityId: null, entityType: null };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      console.error(`⏱️ Timeout verificando duplicado: ${docNumber}`);
      // En caso de timeout, devolver error para evitar duplicación
      return { isDuplicate: false, entityId: null, entityType: 'TIMEOUT_ERROR' };
    }
    console.error(`Error verificando duplicado: ${e}`);
    return { isDuplicate: false, entityId: null, entityType: null };
  }
}

// Process single document to QuickBooks
async function processSingleDocument(
  supabase: any,
  doc: any,
  accessToken: string,
  realmId: string,
  qboAccounts: any[]
): Promise<ProcessResult> {
  const startTime = Date.now();
  const docNumber = doc.doc_number;
  const supplierName = doc.supplier_name;
  
  try {
    console.log(`📄 ${docNumber} (${supplierName}): Iniciando...`);
    
    // 1. Filter tiquetes (tipo_documento 04)
    const docType = doc.doc_type || doc.xml_data?.tipo_documento || '';
    if (docType === '04' || docType === 'TE') {
      return {
        doc_id: doc.id,
        doc_number: docNumber,
        supplier_name: supplierName,
        success: false,
        reason: 'Tiquete electrónico (no se procesa)',
        elapsed_ms: Date.now() - startTime
      };
    }
    
    // Detect if this is a credit note
    const isCreditNote = doc.xml_data?.esNotaCredito === true || 
                         docType === 'NotaCreditoElectronica' || 
                         docType === 'NC' ||
                         docType === '03';
    
    if (isCreditNote) {
      console.log(`💳 ${docNumber}: Nota de Crédito detectada`);
    }
    
    // 2. CRITICAL: Check for duplicate in QuickBooks BEFORE creating
    const duplicateCheck = await checkDuplicateInQBO(docNumber, accessToken, realmId, isCreditNote);
    
    if (duplicateCheck.entityType === 'TIMEOUT_ERROR') {
      return {
        doc_id: doc.id,
        doc_number: docNumber,
        supplier_name: supplierName,
        success: false,
        reason: 'Timeout verificando duplicado - reintentar más tarde',
        elapsed_ms: Date.now() - startTime
      };
    }
    
    if (duplicateCheck.isDuplicate && duplicateCheck.entityId) {
      console.log(`✓ ${docNumber}: Ya existe en QBO (${duplicateCheck.entityType} ID: ${duplicateCheck.entityId}) - marcando como publicado`);
      
      await supabase
        .from('processed_documents')
        .update({
          qbo_entity_id: duplicateCheck.entityId,
          qbo_entity_type: duplicateCheck.entityType,
          status: 'published',
          error_message: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', doc.id);
      
      return {
        doc_id: doc.id,
        doc_number: docNumber,
        supplier_name: supplierName,
        success: true,
        qbo_id: duplicateCheck.entityId,
        elapsed_ms: Date.now() - startTime
      };
    }
    
    // 3. Filter rejected invoices
    const situacion = doc.xml_data?.situacion || doc.xml_data?.mensaje_receptor;
    if (situacion === '3' || situacion === 3) {
      return {
        doc_id: doc.id,
        doc_number: docNumber,
        supplier_name: supplierName,
        success: false,
        reason: 'Factura rechazada por receptor',
        elapsed_ms: Date.now() - startTime
      };
    }
    
    // 4. Validate totals
    const totalsCheck = validateTotals(doc.xml_data, doc.total_amount);
    if (!totalsCheck.valid) {
      console.warn(`⚠️ ${docNumber}: Diferencia en totales: ${totalsCheck.diff.toFixed(2)}`);
      // Continue anyway but log warning
    }
    
    // 5. Parse OtrosCargos
    const otrosCargos = parseOtrosCargos(doc.xml_data);
    if (otrosCargos.length > 0) {
      console.log(`📄 ${docNumber}: ${otrosCargos.length} otros cargos detectados`);
    }
    
    // 5. Find vendor in QuickBooks (with timeout protection)
    let vendorRef = doc.vendor?.qbo_vendor_ref;
    if (!vendorRef) {
      // Search vendor by name with timeout
      const vendorSearchTimeout = 8000; // 8 second timeout for vendor search
      const vendorController = new AbortController();
      const vendorTimeoutId = setTimeout(() => vendorController.abort(), vendorSearchTimeout);
      
      try {
        // Simplified search - just look for exact match first
        const normalizedName = supplierName
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .substring(0, 100)
          .trim();
        
        const vendorQuery = encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName = '${normalizedName.replace(/'/g, "\\'")}'`);
        const vendorResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${vendorQuery}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json'
            },
            signal: vendorController.signal
          }
        );
        
        clearTimeout(vendorTimeoutId);
        
        if (vendorResponse.ok) {
          const vendorData = await vendorResponse.json();
          if (vendorData.QueryResponse?.Vendor?.[0]) {
            vendorRef = vendorData.QueryResponse.Vendor[0].Id;
          }
        }
        
        // If not found, try creating the vendor
        if (!vendorRef) {
          console.log(`➕ ${docNumber}: Creando proveedor "${normalizedName}"...`);
          const createController = new AbortController();
          const createTimeoutId = setTimeout(() => createController.abort(), 10000);
          
          const createResponse = await fetch(
            `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ DisplayName: normalizedName }),
              signal: createController.signal
            }
          );
          
          clearTimeout(createTimeoutId);
          
          if (createResponse.ok) {
            const vendorData = await createResponse.json();
            vendorRef = vendorData.Vendor?.Id;
            console.log(`✅ ${docNumber}: Proveedor creado (ID: ${vendorRef})`);
          } else {
            const errorText = await createResponse.text();
            // If duplicate name error, try to find existing vendor
            if (errorText.includes('Duplicate Name')) {
              const retryQuery = encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName LIKE '%${normalizedName.substring(0, 15)}%'`);
              const retryResponse = await fetch(
                `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${retryQuery}`,
                {
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                  }
                }
              );
              if (retryResponse.ok) {
                const retryData = await retryResponse.json();
                if (retryData.QueryResponse?.Vendor?.[0]) {
                  vendorRef = retryData.QueryResponse.Vendor[0].Id;
                }
              }
            }
          }
        }
      } catch (e) {
        clearTimeout(vendorTimeoutId);
        if (e instanceof Error && e.name === 'AbortError') {
          console.warn(`⏱️ ${docNumber}: Timeout buscando proveedor`);
        } else {
          console.warn(`⚠️ ${docNumber}: Error buscando proveedor:`, e);
        }
      }
      
      if (!vendorRef) {
        return {
          doc_id: doc.id,
          doc_number: docNumber,
          supplier_name: supplierName,
          success: false,
          reason: 'Proveedor no encontrado/creado en QuickBooks (timeout o error)',
          elapsed_ms: Date.now() - startTime
        };
      }
    }
    
    // 6. Find account
    let accountRef = doc.default_account_ref || doc.vendor?.default_account_ref;
    if (!accountRef) {
      return {
        doc_id: doc.id,
        doc_number: docNumber,
        supplier_name: supplierName,
        success: false,
        reason: 'Cuenta contable no configurada',
        elapsed_ms: Date.now() - startTime
      };
    }
    
    // Search account by code
    const account = qboAccounts.find(a => 
      a.AcctNum === accountRef || 
      a.Id === accountRef ||
      a.Name?.toLowerCase().includes(accountRef.toLowerCase())
    );
    
    if (!account) {
      return {
        doc_id: doc.id,
        doc_number: docNumber,
        supplier_name: supplierName,
        success: false,
        reason: `Cuenta ${accountRef} no existe en QuickBooks`,
        elapsed_ms: Date.now() - startTime
      };
    }
    
    // 7. Build lines (positive amounts for both Bill and VendorCredit)
    const lines: any[] = [];
    const detalle = doc.xml_data?.detalle || doc.xml_data?.lineas || [];
    
    if (Array.isArray(detalle) && detalle.length > 0) {
      for (const item of detalle) {
        const amount = Math.abs(parseFloat(item.monto_total_linea || item.MontoTotalLinea || item.subtotal || item.monto || '0'));
        if (amount > 0) {
          lines.push({
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: amount,
            Description: (item.detalle || item.Detalle || item.descripcion || (isCreditNote ? 'Línea NC' : 'Línea de factura')).substring(0, 4000),
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: account.Id },
              BillableStatus: "NotBillable"
            }
          });
        }
      }
    }
    
    // If no lines from detail, create single line
    if (lines.length === 0) {
      const baseAmount = Math.abs(doc.total_amount) - Math.abs(doc.total_tax || 0);
      lines.push({
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: baseAmount > 0 ? baseAmount : Math.abs(doc.total_amount),
        Description: `${isCreditNote ? 'Nota de Crédito' : 'Factura'} ${docNumber} - ${supplierName}`,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: account.Id },
          BillableStatus: "NotBillable"
        }
      });
    }
    
    // 8. Add OtrosCargos as additional lines
    for (const cargo of otrosCargos) {
      // Find or use default account for otros cargos
      const cargosAccount = qboAccounts.find(a => 
        a.AcctNum === '79' || 
        a.Name?.toLowerCase().includes('otros') ||
        a.Name?.toLowerCase().includes('gastos')
      ) || account;
      
      lines.push({
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: cargo.monto,
        Description: `Otros Cargos: ${cargo.detalle}`.substring(0, 4000),
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: cargosAccount.Id },
          BillableStatus: "NotBillable"
        }
      });
    }
    
    // Use full document number as-is from XML
    const qboDocNumber = docNumber;
    
    let entityId: string;
    let entityType: string;
    
    if (isCreditNote) {
      // ============================================
      // NOTA DE CRÉDITO → VendorCredit
      // ============================================
      const vendorCreditPayload = {
        VendorRef: { value: vendorRef },
        TxnDate: doc.issue_date,
        DocNumber: qboDocNumber,
        CurrencyRef: { value: doc.currency || 'CRC' },
        ExchangeRate: doc.exchange_rate || 1,
        Line: lines, // VendorCredit uses positive amounts
        PrivateNote: `Nota de Crédito - Clave: ${doc.doc_key || docNumber}`
      };
      
      console.log(`📤 ${docNumber}: Enviando VendorCredit a QuickBooks (${lines.length} líneas)...`);
      
      const vcController = new AbortController();
      const vcTimeoutId = setTimeout(() => vcController.abort(), 15000);
      
      const qbResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendorcredit?minorversion=65`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(vendorCreditPayload),
          signal: vcController.signal
        }
      );
      
      clearTimeout(vcTimeoutId);
      
      const qbResult = await qbResponse.json();
      
      if (!qbResponse.ok) {
        const errorMsg = qbResult.Fault?.Error?.[0]?.Message || 
                         qbResult.Fault?.Error?.[0]?.Detail || 
                         JSON.stringify(qbResult).substring(0, 200);
        console.error(`❌ ${docNumber}: Error QB VendorCredit - ${errorMsg}`);
        
        await supabase
          .from('processed_documents')
          .update({
            status: 'error',
            error_message: errorMsg.substring(0, 500),
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id);
        
        return {
          doc_id: doc.id,
          doc_number: docNumber,
          supplier_name: supplierName,
          success: false,
          reason: errorMsg,
          elapsed_ms: Date.now() - startTime
        };
      }
      
      entityId = qbResult.VendorCredit?.Id;
      entityType = 'VendorCredit';
      console.log(`✅ ${docNumber}: VendorCredit creado (ID: ${entityId})`);
      
    } else {
      // ============================================
      // FACTURA → Bill
      // ============================================
      const billPayload = {
        VendorRef: { value: vendorRef },
        TxnDate: doc.issue_date,
        DueDate: doc.issue_date,
        DocNumber: qboDocNumber,
        CurrencyRef: { value: doc.currency || 'CRC' },
        ExchangeRate: doc.exchange_rate || 1,
        Line: lines,
        PrivateNote: `Clave: ${doc.doc_key || docNumber}`
      };
      
      console.log(`📤 ${docNumber}: Enviando Bill a QuickBooks (${lines.length} líneas)...`);
      
      const billController = new AbortController();
      const billTimeoutId = setTimeout(() => billController.abort(), 15000);
      
      const qbResponse = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill?minorversion=65`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(billPayload),
          signal: billController.signal
        }
      );
      
      clearTimeout(billTimeoutId);
      
      const qbResult = await qbResponse.json();
      
      if (!qbResponse.ok) {
        const errorMsg = qbResult.Fault?.Error?.[0]?.Message || 
                         qbResult.Fault?.Error?.[0]?.Detail || 
                         JSON.stringify(qbResult).substring(0, 200);
        console.error(`❌ ${docNumber}: Error QB Bill - ${errorMsg}`);
        
        await supabase
          .from('processed_documents')
          .update({
            status: 'error',
            error_message: errorMsg.substring(0, 500),
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id);
        
        return {
          doc_id: doc.id,
          doc_number: docNumber,
          supplier_name: supplierName,
          success: false,
          reason: errorMsg,
          elapsed_ms: Date.now() - startTime
        };
      }
      
      entityId = qbResult.Bill?.Id;
      entityType = 'Bill';
      console.log(`✅ ${docNumber}: Bill creado (ID: ${entityId})`);
    }
    
    // 10. Update document as published
    await supabase
      .from('processed_documents')
      .update({
        status: 'published',
        qbo_entity_type: entityType,
        qbo_entity_id: entityId,
        error_message: null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', doc.id);
    
    // 11. Attach PDF (fire and forget, don't block)
    if (doc.pdf_attachment_url) {
      attachPDFToQuickBooks(entityId, doc.pdf_attachment_url, accessToken, realmId, docNumber)
        .catch(e => console.warn(`📎 ${docNumber}: Error en background PDF:`, e));
    }
    
    return {
      doc_id: doc.id,
      doc_number: docNumber,
      supplier_name: supplierName,
      success: true,
      qbo_id: entityId,
      elapsed_ms: Date.now() - startTime
    };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`❌ ${docNumber}: ${errorMsg}`);
    
    return {
      doc_id: doc.id,
      doc_number: docNumber,
      supplier_name: supplierName,
      success: false,
      reason: errorMsg,
      elapsed_ms: Date.now() - startTime
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
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

    console.log(`🚀 BATCH PUBLISH iniciando para org: ${organization_id}`);
    console.log(`⚙️ Configuración: BATCH_SIZE=${BATCH_SIZE}, TIMEOUT=${TIMEOUT_MS}ms`);

    // 1. Get QuickBooks credentials
    const { data: integration, error: intError } = await supabase
      .from('integration_accounts')
      .select('credentials')
      .eq('organization_id', organization_id)
      .eq('service_type', 'quickbooks')
      .eq('is_active', true)
      .single();

    if (intError || !integration?.credentials) {
      throw new Error('QuickBooks no conectado');
    }

    const { access_token, realm_id } = integration.credentials as any;
    if (!access_token || !realm_id) {
      throw new Error('Credenciales QuickBooks incompletas');
    }

    // 2. Get organization realm_id
    const { data: org } = await supabase
      .from('organizations')
      .select('qbo_realm_id')
      .eq('id', organization_id)
      .single();

    const realmId = org?.qbo_realm_id || realm_id;

    // 3. Fetch all QuickBooks accounts for mapping
    console.log('📊 Cargando cuentas de QuickBooks...');
    const accountsQuery = encodeURIComponent("SELECT * FROM Account WHERE AccountType IN ('Expense', 'Other Expense', 'Cost of Goods Sold') MAXRESULTS 500");
    const accountsResponse = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${accountsQuery}`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!accountsResponse.ok) {
      throw new Error('Error cargando cuentas de QuickBooks');
    }

    const accountsData = await accountsResponse.json();
    const qboAccounts = accountsData.QueryResponse?.Account || [];
    console.log(`📊 ${qboAccounts.length} cuentas cargadas`);

    // 4. Fetch documents to publish
    let query = supabase
      .from('processed_documents')
      .select(`
        *,
        vendor:vendors(qbo_vendor_ref, default_account_ref, default_class_ref)
      `)
      .eq('organization_id', organization_id)
      .in('status', ['processed', 'pending', 'pending_config'])
      .is('qbo_entity_id', null);

    // If specific document_ids provided, filter by them
    if (document_ids && Array.isArray(document_ids) && document_ids.length > 0) {
      query = query.in('id', document_ids);
    }

    const { data: documents, error: docError } = await query
      .order('issue_date', { ascending: true })
      .limit(200);

    if (docError) {
      throw new Error(`Error fetching documents: ${docError.message}`);
    }

    if (!documents || documents.length === 0) {
      console.log('✅ No hay documentos pendientes de publicar');
      return new Response(
        JSON.stringify({
          success: true,
          published: 0,
          failed: 0,
          skipped: 0,
          message: 'No hay documentos pendientes'
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 ${documents.length} documentos a procesar`);

    // 5. Filter duplicates by doc_key + supplier (NOT just doc_number)
    const uniqueDocs: typeof documents = [];
    const seenKeys = new Set<string>();
    
    for (const doc of documents) {
      // Use doc_key (clave numerica) + supplier_tax_id as unique identifier
      const uniqueKey = `${doc.doc_key || doc.doc_number}_${doc.supplier_tax_id || doc.supplier_name}`;
      
      if (!seenKeys.has(uniqueKey)) {
        seenKeys.add(uniqueKey);
        uniqueDocs.push(doc);
      } else {
        console.log(`⏭️ ${doc.doc_number}: Duplicado (misma clave+proveedor)`);
      }
    }

    console.log(`📋 ${uniqueDocs.length} documentos únicos después de filtrar duplicados`);

    // 6. Check for already published in QuickBooks by doc_key
    const docKeys = uniqueDocs.map(d => d.doc_key).filter(Boolean);
    if (docKeys.length > 0) {
      const { data: alreadyPublished } = await supabase
        .from('processed_documents')
        .select('doc_key')
        .eq('organization_id', organization_id)
        .eq('status', 'published')
        .not('qbo_entity_id', 'is', null)
        .in('doc_key', docKeys);
      
      const publishedKeys = new Set((alreadyPublished || []).map(d => d.doc_key));
      const filteredDocs = uniqueDocs.filter(d => !publishedKeys.has(d.doc_key));
      
      if (filteredDocs.length < uniqueDocs.length) {
        console.log(`⏭️ ${uniqueDocs.length - filteredDocs.length} documentos ya publicados (filtrados)`);
      }
      
      uniqueDocs.length = 0;
      uniqueDocs.push(...filteredDocs);
    }

    if (uniqueDocs.length === 0) {
      console.log('✅ Todos los documentos ya están publicados');
      return new Response(
        JSON.stringify({
          success: true,
          published: 0,
          failed: 0,
          skipped: documents.length,
          message: 'Todos ya publicados'
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Process in batches
    const results: ProcessResult[] = [];
    const totalBatches = Math.ceil(uniqueDocs.length / BATCH_SIZE);
    
    console.log(`🔄 Procesando ${uniqueDocs.length} documentos en ${totalBatches} lotes de ${BATCH_SIZE}`);

    for (let i = 0; i < uniqueDocs.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = uniqueDocs.slice(i, i + BATCH_SIZE);
      const batchStart = Date.now();
      
      console.log(`\n🚀 Lote ${batchNum}/${totalBatches} (${batch.length} facturas)`);
      
      // Process batch in parallel with timeout
      const batchPromises = batch.map(doc =>
        publishWithTimeout(
          processSingleDocument(supabase, doc, access_token, realmId, qboAccounts),
          TIMEOUT_MS,
          doc.doc_number
        ).catch(error => ({
          doc_id: doc.id,
          doc_number: doc.doc_number,
          supplier_name: doc.supplier_name,
          success: false,
          reason: error instanceof Error ? error.message : 'Error desconocido',
          elapsed_ms: Date.now() - batchStart
        } as ProcessResult))
      );

      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            doc_id: 'unknown',
            doc_number: 'unknown',
            supplier_name: 'unknown',
            success: false,
            reason: result.reason?.message || 'Promise rejected'
          });
        }
      }
      
      const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
      const batchSuccess = batchResults.filter(r => r.status === 'fulfilled' && (r.value as ProcessResult).success).length;
      console.log(`⏱️ Lote ${batchNum} completado: ${batchSuccess}/${batch.length} exitosos en ${batchElapsed}s`);
      
      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < uniqueDocs.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 8. Summary
    const published = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`\n📊 RESUMEN FINAL:`);
    console.log(`✅ Publicados: ${published}`);
    console.log(`❌ Fallidos: ${failed}`);
    console.log(`⏱️ Tiempo total: ${totalElapsed}s`);
    console.log(`📈 Promedio: ${(parseFloat(totalElapsed) / results.length).toFixed(1)}s por factura`);

    // Log failed ones
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      console.log(`\n❌ Facturas fallidas:`);
      for (const f of failures.slice(0, 20)) {
        console.log(`  - ${f.doc_number} (${f.supplier_name}): ${f.reason}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        published,
        failed,
        skipped: documents.length - uniqueDocs.length,
        total_time_seconds: parseFloat(totalElapsed),
        avg_time_per_invoice: parseFloat((parseFloat(totalElapsed) / results.length).toFixed(1)),
        results: results.map(r => ({
          doc_number: r.doc_number,
          supplier: r.supplier_name,
          success: r.success,
          qbo_id: r.qbo_id,
          reason: r.reason,
          elapsed_ms: r.elapsed_ms
        }))
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("❌ Error en batch-publish-all:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        published: 0,
        failed: 0
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
