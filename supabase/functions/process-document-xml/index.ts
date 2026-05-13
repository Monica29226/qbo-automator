import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessDocumentRequest {
  organization_id: string;
  xml_content?: string;
  xml_attachment_url?: string;
  pdf_attachment_url?: string;
  file_path?: string;
  clave?: string;
  source?: string;
}

// Enhanced XML parser functions with namespace support
function parseXMLValue(xml: string, tag: string): string {
  // Try with namespace prefix (e.g., <ns:NumeroConsecutivo>)
  let regex = new RegExp(`<[\\w]*:?${tag}[^>]*>([^<]*)<\\/[\\w]*:?${tag}>`, 'i');
  let match = xml.match(regex);
  if (match) return match[1].trim();
  
  // Try without namespace
  regex = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
  match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXMLBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'gi');
  const blocks: string[] = [];
  let match;

  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}

function parseFirstXMLBlock(xml: string, tag: string): string {
  return parseXMLBlocks(xml, tag)[0] || '';
}

function parseNumber(...values: Array<string | number | null | undefined>): number {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).replace(/,/g, '').trim();
    if (!normalized) continue;

    const parsed = parseFloat(normalized);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function calculateSubtotalFromLines(lineItems: any[]): number {
  return lineItems.reduce((sum, item) => {
    return sum + parseNumber(item.baseImponible, item.subtotal, item.montoTotal);
  }, 0);
}

function isInvoiceXml(xml: string): boolean {
  return /<(?:[\w]+:)?(?:FacturaElectronica|NotaCreditoElectronica|NotaDebitoElectronica|TiqueteElectronico)\b/i.test(xml);
}

function parseIssueDate(xml: string): string {
  const rawDate =
    parseXMLValue(xml, 'FechaEmision') ||
    parseXMLValue(xml, 'FechaEmisionDoc') ||
    parseXMLValue(xml, 'Fecha');

  if (!rawDate) return '';
  return rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
}

// Función mejorada para extraer NumeroConsecutivo
// El NumeroConsecutivo es usualmente de 20 dígitos y está al final de la Clave de 50 dígitos
function parseNumeroConsecutivo(xml: string): string {
  // Primero intentar extraer directamente del tag NumeroConsecutivo
  const directValue = parseXMLValue(xml, 'NumeroConsecutivo');
  
  if (directValue && directValue.length > 0 && directValue.length <= 25) {
    console.log(`✓ NumeroConsecutivo encontrado directamente: ${directValue} (${directValue.length} dígitos)`);
    return directValue;
  }
  
  // Si no existe o es demasiado largo (posiblemente es la Clave), extraer de Clave
  const clave = parseXMLValue(xml, 'Clave');
  
  if (clave && clave.length === 50) {
    // La Clave tiene 50 dígitos: 
    // - Posiciones 1-21: información del emisor, fecha, tipo doc
    // - Posiciones 22-30: información de situación y seguridad  
    // - Posiciones 31-50: NumeroConsecutivo (últimos 20 dígitos)
    const numeroConsecutivo = clave.substring(30, 50);
    console.log(`✓ NumeroConsecutivo extraído de Clave (últimos 20 dígitos): ${numeroConsecutivo}`);
    return numeroConsecutivo;
  }
  
  // Fallback: si directValue existe pero es muy largo, recortarlo
  if (directValue && directValue.length > 25) {
    const shortened = directValue.substring(directValue.length - 20);
    console.warn(`⚠️ NumeroConsecutivo muy largo (${directValue.length} dígitos), usando últimos 20: ${shortened}`);
    return shortened;
  }
  
  console.error(`❌ No se pudo extraer NumeroConsecutivo válido. Direct: ${directValue}, Clave: ${clave?.substring(0, 20)}...`);
  return directValue || '';
}

function parseLineItems(xml: string): any[] {
  const lineItems: any[] = [];
  let lineNumber = 1;
  const detailBlocks = parseXMLBlocks(xml, 'LineaDetalle');
  
  for (const lineXml of detailBlocks) {
    
    // Extract all relevant fields for each line item
    const descripcion = parseXMLValue(lineXml, 'Detalle') || parseXMLValue(lineXml, 'NombreComercial') || '';
    const cantidad = parseFloat(parseXMLValue(lineXml, 'Cantidad') || '1');
    const unidadMedida = parseXMLValue(lineXml, 'UnidadMedida') || 'Unidad';
    const precioUnitario = parseFloat(parseXMLValue(lineXml, 'PrecioUnitario') || '0');
    const montoTotalLinea = parseFloat(parseXMLValue(lineXml, 'MontoTotalLinea') || '0');
    const montoDescuento = parseFloat(parseXMLValue(lineXml, 'MontoDescuento') || '0');
    
    // CRITICAL: Capturar MontoTotal (antes de descuentos) y SubTotal (después de descuentos)
    const montoTotal = parseFloat(parseXMLValue(lineXml, 'MontoTotal') || (cantidad * precioUnitario).toString());
    const subtotal = parseFloat(parseXMLValue(lineXml, 'SubTotal') || montoTotal.toString());
    
    // Capturar BaseImponible (base para calcular impuestos) e ImpuestoNeto
    const baseImponible = parseFloat(parseXMLValue(lineXml, 'BaseImponible') || subtotal.toString());
    const impuestoNeto = parseFloat(parseXMLValue(lineXml, 'ImpuestoNeto') || '0');
    const impuestoAsumidoEmisor = parseFloat(parseXMLValue(lineXml, 'ImpuestoAsumidoEmisorFabrica') || '0');
    
    // Extract ALL tax information per line (puede haber múltiples impuestos)
    const impuestos: any[] = [];
    const taxBlocks = parseXMLBlocks(lineXml, 'Impuesto');

    for (const taxXml of taxBlocks) {
      const codigo = parseXMLValue(taxXml, 'Codigo');
      const tarifa = parseFloat(parseXMLValue(taxXml, 'Tarifa') || '0');
      const monto = parseFloat(parseXMLValue(taxXml, 'Monto') || '0');
      const codigoTarifaIVA = parseXMLValue(taxXml, 'CodigoTarifaIVA');
      
      impuestos.push({
        codigo,
        tarifa,
        monto,
        codigoTarifaIVA
      });
    }
    
    // Para mantener compatibilidad, extraer el IVA principal (código 01)
    const ivaImpuesto = impuestos.find(imp => imp.codigo === '01');
    const tarifa = ivaImpuesto?.tarifa || 0;
    const montoImpuesto = ivaImpuesto?.monto || 0;
    
    // Extract product code if available
    const codigoProducto = parseXMLValue(lineXml, 'Codigo') || parseXMLValue(lineXml, 'CodigoCabys');
    
    lineItems.push({
      numeroLinea: lineNumber++,
      codigoProducto,
      descripcion,
      impuestos, // Array con TODOS los impuestos
      cantidad,
      unidadMedida,
      precioUnitario,
      montoTotal, // Monto antes de descuentos (cantidad × precioUnitario)
      montoDescuento,
      subtotal, // Monto después de descuentos
      baseImponible, // Base para calcular impuestos (puede incluir otros cargos)
      impuestoNeto, // Impuesto que efectivamente se cobra al receptor
      impuestoAsumidoEmisor, // Impuesto asumido por el emisor (ej: IEBL)
      montoTotalLinea,
      impuesto: {
        tarifa, // Tasa de impuesto IVA (1, 2, 4, 8, 13, etc.)
        montoImpuesto // Monto del IVA para esta línea
      },
      // Campos planos para acceso directo
      tarifa,
      montoImpuesto
    });
  }
  
  return lineItems;
}

// Función para extraer datos del Receptor del XML
function parseReceptorData(xml: string): { nombre: string; identificacion: string } {
  // Buscar la sección Receptor
  const receptorXml = parseFirstXMLBlock(xml, 'Receptor');
  if (!receptorXml) {
    return { nombre: '', identificacion: '' };
  }
  
  // Extraer nombre del receptor
  const nombre = parseXMLValue(receptorXml, 'Nombre');
  
  // Extraer identificación del receptor (puede estar en diferentes tags)
  let identificacion = parseXMLValue(receptorXml, 'Numero');
  if (!identificacion) {
    identificacion = parseXMLValue(receptorXml, 'NumeroIdentificacion');
  }
  if (!identificacion) {
    // Buscar dentro de <Identificacion>
    const identificacionXml = parseFirstXMLBlock(receptorXml, 'Identificacion');
    if (identificacionXml) {
      identificacion = parseXMLValue(identificacionXml, 'Numero');
    }
  }
  
  return { nombre, identificacion };
}

// Función para extraer datos del Emisor del XML
function parseEmisorData(xml: string): { nombre: string; identificacion: string; email: string } {
  // Buscar la sección Emisor
  const emisorXml = parseFirstXMLBlock(xml, 'Emisor');
  if (!emisorXml) {
    // Fallback: buscar en todo el XML (para XMLs simples)
    return {
      nombre: parseXMLValue(xml, 'Nombre'),
      identificacion: parseXMLValue(xml, 'Numero') || parseXMLValue(xml, 'NumeroIdentificacion'),
      email: parseXMLValue(xml, 'CorreoElectronico')
    };
  }
  
  const nombre = parseXMLValue(emisorXml, 'Nombre');
  let identificacion = parseXMLValue(emisorXml, 'Numero');
  if (!identificacion) {
    identificacion = parseXMLValue(emisorXml, 'NumeroIdentificacion');
  }
  if (!identificacion) {
    const identificacionXml = parseFirstXMLBlock(emisorXml, 'Identificacion');
    if (identificacionXml) {
      identificacion = parseXMLValue(identificacionXml, 'Numero');
    }
  }
  const email = parseXMLValue(emisorXml, 'CorreoElectronico');
  
  return { nombre, identificacion, email };
}

function normalizeTaxId(value?: string | null): string {
  return (value || '').replace(/[^0-9]/g, '').replace(/^0+/, '').trim();
}

function normalizeLegalName(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/sociedad anonima|sociedad de responsabilidad limitada|s\.?a\.?|s\.?r\.?l\.?/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getOrganizationIdentifiers(organization: { tax_id?: string | null; identification_number?: string | null; name?: string | null }) {
  const ids = [organization.tax_id, organization.identification_number]
    .map((value) => normalizeTaxId(value))
    .filter(Boolean);

  return Array.from(new Set(ids));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: ProcessDocumentRequest = await req.json();
    console.log("🚀 Processing document - NO AI");
    console.log("📎 PDF attachment URL received:", payload.pdf_attachment_url || "NONE");
    console.log("📂 XML attachment URL received:", payload.xml_attachment_url || "NONE");
    
    if (!payload.organization_id) {
      throw new Error("organization_id is required");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const xmlContent = payload.xml_content || '';
    
    console.log("📄 XML Preview:", xmlContent.substring(0, 500));

    if (!isInvoiceXml(xmlContent)) {
      return new Response(
        JSON.stringify({
          success: false,
          rejected: true,
          message: "XML no procesable: no corresponde a Factura/Tiquete/Nota de Crédito/Nota de Débito",
          reason: "non_invoice_xml"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // ============================================================
    // VALIDACIÓN CRÍTICA: Solo procesar facturas dirigidas a la organización
    // ============================================================
    
    // Obtener datos de la organización (nombre y cédula jurídica)
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('name, tax_id, identification_number')
      .eq('id', payload.organization_id)
      .single();
    
    if (orgError || !organization) {
      console.error("❌ Error obteniendo organización:", orgError);
      throw new Error("No se pudo obtener información de la organización");
    }
    
    // Extraer datos del Receptor del XML
    const receptor = parseReceptorData(xmlContent);
    console.log("🎯 Receptor del XML:", receptor);
    console.log("🏢 Organización esperada:", {
      name: organization.name,
      tax_id: organization.tax_id,
      identification_number: organization.identification_number,
    });
    
    const organizationIdentifiers = getOrganizationIdentifiers(organization);
    const normalizedReceptorId = normalizeTaxId(receptor.identificacion);
    const normalizedOrganizationName = normalizeLegalName(organization.name);
    const normalizedReceptorName = normalizeLegalName(receptor.nombre);

    // Validar que la factura sea para esta organización
    // IMPORTANTE: se acepta tax_id o identification_number como identificadores válidos de la organización
    if (organizationIdentifiers.length === 0) {
      console.error(`❌ FACTURA RECHAZADA - La organización ${organization.name} no tiene identificación configurada`);
      console.error(`   Configure la cédula en Mi Empresa antes de procesar facturas`);
      
      return new Response(
        JSON.stringify({
          success: false,
          rejected: true,
          message: `Organización sin identificación configurada. Configure la cédula en "Mi Empresa" antes de importar facturas.`,
          reason: 'org_no_tax_id'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const receptorMatchesById = !!normalizedReceptorId && organizationIdentifiers.includes(normalizedReceptorId);
    const receptorMatchesByName = !normalizedReceptorId && !!normalizedReceptorName && !!normalizedOrganizationName && (
      normalizedReceptorName.includes(normalizedOrganizationName) ||
      normalizedOrganizationName.includes(normalizedReceptorName)
    );

    if (normalizedReceptorId && !receptorMatchesById) {
      console.warn(`⚠️ FACTURA RECHAZADA - Receptor no coincide con la organización`);
      console.warn(`   Receptor: ${receptor.nombre} (${receptor.identificacion})`);
      console.warn(`   Esperado: ${organization.name} (${organizationIdentifiers.join(' / ')})`);
      
      return new Response(
        JSON.stringify({
          success: false,
          rejected: true,
          message: `Factura rechazada: El receptor (${receptor.nombre} - ${receptor.identificacion}) no coincide con la organización (${organization.name} - ${organizationIdentifiers.join(' / ')})`,
          reason: 'receptor_mismatch'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!normalizedReceptorId && receptor.nombre && !receptorMatchesByName) {
      console.warn(`⚠️ FACTURA RECHAZADA - Receptor sin cédula y nombre no coincide con la organización`);
      console.warn(`   Receptor: ${receptor.nombre}`);
      console.warn(`   Esperado: ${organization.name}`);

      return new Response(
        JSON.stringify({
          success: false,
          rejected: true,
          message: `Factura rechazada: El receptor (${receptor.nombre}) no coincide con la organización (${organization.name})`,
          reason: 'receptor_name_mismatch'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log("✅ Receptor validado correctamente:", receptor.nombre, receptor.identificacion);
    
    // ============================================================
    // Continuar con el procesamiento normal del documento
    // ============================================================
    
    // Parse XML to extract all data
    const doc_key = payload.clave || parseXMLValue(xmlContent, 'Clave');
    const doc_number = parseNumeroConsecutivo(xmlContent);
    
    // VALIDACIÓN CRÍTICA: Asegurar que doc_number NO sea la clave numérica
    if (doc_number && doc_number.length > 25) {
      console.error("❌ ERROR: doc_number muy largo, parece ser una Clave en lugar de NumeroConsecutivo");
      console.error(`   doc_number length: ${doc_number.length}, value: ${doc_number.substring(0, 50)}`);
      throw new Error("NumeroConsecutivo inválido - demasiado largo. Verificar estructura del XML.");
    }
    
    const issue_date = parseIssueDate(xmlContent);
    
    // Usar parseEmisorData para obtener datos del proveedor correctamente
    const emisor = parseEmisorData(xmlContent);
    const supplier_name = emisor.nombre;
    const supplier_tax_id = emisor.identificacion;
    const supplier_email = emisor.email;
    
    console.log("🔍 Parsed values:", { doc_number, doc_key: doc_key?.substring(0, 20), supplier_name, supplier_tax_id });
    
    // Validate required fields
    if (!doc_number) {
      console.error("❌ NumeroConsecutivo not found. XML structure:", xmlContent.substring(0, 1000));
      return new Response(
        JSON.stringify({
          success: false,
          rejected: true,
          message: "XML sin NumeroConsecutivo válido",
          reason: "missing_doc_number"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!issue_date || issue_date === '') {
      return new Response(
        JSON.stringify({
          success: false,
          rejected: true,
          message: "XML sin FechaEmision",
          reason: "missing_issue_date"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!supplier_name) {
      return new Response(
        JSON.stringify({
          success: false,
          rejected: true,
          message: "XML sin datos de Emisor",
          reason: "missing_supplier"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Parse amounts
    const subtotalFromResumen = parseNumber(
      parseXMLValue(xmlContent, 'TotalVentaNeta'),
      parseXMLValue(xmlContent, 'TotalMercanciasGravadas'),
      parseXMLValue(xmlContent, 'TotalMercanciasExentas'),
      parseXMLValue(xmlContent, 'TotalServiciosGravados'),
      parseXMLValue(xmlContent, 'TotalServiciosExentos'),
      parseXMLValue(xmlContent, 'TotalGravado'),
      parseXMLValue(xmlContent, 'TotalVenta'),
    );
    let total_tax = parseNumber(parseXMLValue(xmlContent, 'TotalImpuesto'));
    let total_discount = parseNumber(parseXMLValue(xmlContent, 'TotalDescuentos'));
    let total_amount = parseNumber(parseXMLValue(xmlContent, 'TotalComprobante'));
    
    // Capturar impuestos asumidos por el emisor y otros cargos
    const totalImpuestoAsumidoEmisor = parseNumber(parseXMLValue(xmlContent, 'TotalImpAsumEmisorFabrica'));
    const totalOtrosCargos = parseNumber(parseXMLValue(xmlContent, 'TotalOtrosCargos'));
    
    const currency = parseXMLValue(xmlContent, 'CodigoMoneda') || 'CRC';
    const exchange_rate = parseNumber(parseXMLValue(xmlContent, 'TipoCambio')) || 1;
    
    // Parse line items
    const detalle = parseLineItems(xmlContent);
    const subtotal = subtotalFromResumen || calculateSubtotalFromLines(detalle);

    if (!total_amount) {
      total_amount = parseNumber(...detalle.map((item) => item.montoTotalLinea));
    }

    if (!total_tax) {
      total_tax = detalle.reduce((sum, item) => {
        const taxes = Array.isArray(item.impuestos) ? item.impuestos : [];
        const lineTax = taxes.reduce((acc: number, imp: any) => acc + parseNumber(imp?.monto), 0);
        return sum + (lineTax || parseNumber(item.montoImpuesto, item.impuestoNeto));
      }, 0);
    }

    if (!total_discount) {
      total_discount = detalle.reduce((sum, item) => sum + parseNumber(item.montoDescuento), 0);
    }
    
    // Determine document type and apply negative amounts for credit notes
    let doc_type = 'FacturaElectronica';
    let esNotaCredito = false;
    
    if (xmlContent.includes('NotaCreditoElectronica')) {
      doc_type = 'NotaCreditoElectronica';
      esNotaCredito = true;
      // Convertir TODOS los montos a negativos para notas de crédito
      total_amount = -Math.abs(total_amount);
      total_tax = -Math.abs(total_tax);
      total_discount = -Math.abs(total_discount);
      detalle.forEach(item => {
        item.montoTotalLinea = -Math.abs(item.montoTotalLinea);
        item.precioUnitario = -Math.abs(item.precioUnitario);
        if (item.impuesto) {
          item.impuesto = -Math.abs(item.impuesto);
        }
        if (item.descuento) {
          item.descuento = -Math.abs(item.descuento);
        }
      });
      console.log('💳 NOTA DE CRÉDITO - Montos convertidos a negativos:', {
        total_amount,
        total_tax,
        total_discount
      });
    } else if (xmlContent.includes('NotaDebitoElectronica')) {
      doc_type = 'NotaDebitoElectronica';
    } else if (xmlContent.includes('TiqueteElectronico')) {
      doc_type = 'TiqueteElectronico';
    }
    
    // Check acceptance status
    const estadoMensaje = parseXMLValue(xmlContent, 'Mensaje') || parseXMLValue(xmlContent, 'EstadoMensaje');
    const aceptada = !estadoMensaje.toLowerCase().includes('rechazado');
    
    console.log("📊 Extracted:", { 
      doc_number, supplier_name, supplier_tax_id, total_amount,
      total_tax, total_discount, totalImpuestoAsumidoEmisor, totalOtrosCargos,
      doc_type, esNotaCredito, aceptada, detalle: detalle.length 
    });

    // ============================================================
    // DUPLICATE DETECTION: Use doc_key (50-char Clave) as THE ONLY truly unique identifier
    // CRITICAL: Same doc_number CAN exist from different vendors - NOT a duplicate!
    // ============================================================
    
    console.log(`🔍 [DUPLICATE CHECK] doc_key: ${doc_key?.substring(0, 20)}... | doc_number: ${doc_number} | vendor: ${supplier_name} (${supplier_tax_id})`);
    
    // FIRST: Check by doc_key (the ONLY truly unique identifier for Costa Rican invoices)
    if (doc_key && doc_key.length === 50) {
      const { data: duplicatesByKey } = await supabase
        .from('processed_documents')
        .select('id, doc_number, supplier_name, supplier_tax_id, qbo_entity_id')
        .eq('organization_id', payload.organization_id)
        .eq('doc_key', doc_key);

      if (duplicatesByKey && duplicatesByKey.length > 0) {
        const existing = duplicatesByKey[0];
        console.log(`❌ DUPLICATE by doc_key: ${existing.doc_number} from ${existing.supplier_name} (QB: ${existing.qbo_entity_id || 'not published'})`);
        return new Response(
          JSON.stringify({
            success: false,
          message: `Documento duplicado (Clave): ${doc_number} de ${supplier_name} ya existe`,
          reason: 'duplicate_doc_key'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // SECOND: Check by doc_number + supplier_tax_id combination (for cases where doc_key might differ slightly)
    // This is a SAFETY fallback - same doc_number from DIFFERENT vendors is NOT a duplicate!
    if (supplier_tax_id) {
      const normalizedTaxId = supplier_tax_id.replace(/[^0-9]/g, '');
      const { data: duplicatesByVendor } = await supabase
        .from('processed_documents')
        .select('id, doc_key, doc_number, supplier_name, supplier_tax_id, qbo_entity_id')
        .eq('organization_id', payload.organization_id)
        .eq('doc_number', doc_number);
      
      // Only match if SAME vendor (same tax ID)
      const exactMatch = duplicatesByVendor?.find(d => 
        d.supplier_tax_id?.replace(/[^0-9]/g, '') === normalizedTaxId
      );
      
      if (exactMatch) {
        console.log(`❌ DUPLICATE by doc_number+vendor: ${exactMatch.doc_number} from ${exactMatch.supplier_name} (QB: ${exactMatch.qbo_entity_id || 'not published'})`);
        return new Response(
          JSON.stringify({
            success: false,
              message: `Documento duplicado: ${doc_number} de ${supplier_name} ya existe`,
              reason: 'duplicate_doc_vendor'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Log if same doc_number exists but from DIFFERENT vendor - this is OK, NOT a duplicate!
      if (duplicatesByVendor && duplicatesByVendor.length > 0) {
        console.log(`ℹ️ SAME doc_number ${doc_number} exists from DIFFERENT vendor: ${duplicatesByVendor[0].supplier_name} (${duplicatesByVendor[0].supplier_tax_id})`);
        console.log(`   Current vendor: ${supplier_name} (${supplier_tax_id}) - PROCEEDING, not a duplicate`);
      }
    }
    
    console.log(`✅ No duplicate found - proceeding with import`);

    // Look up vendor by tax ID for automatic assignment
    let accountCode = "Gastos por clasificar";
    let vendorId = null;
    let status = "pending";
    
    // ============================================================
    // CHECK FOR AUTO-UNCLASSIFIED SETTING
    // Si la organización tiene configurado auto_unclassified_account,
    // todos los gastos van automáticamente a esa cuenta sin clasificar
    // ============================================================
    const { data: autoUnclassifiedSetting } = await supabase
      .from('system_settings')
      .select('value')
      .eq('organization_id', payload.organization_id)
      .eq('key', 'auto_unclassified_account')
      .maybeSingle();
    
    if (autoUnclassifiedSetting?.value) {
      accountCode = autoUnclassifiedSetting.value;
      status = "processed"; // Auto-procesar sin clasificación manual
      console.log(`🎯 [AUTO-UNCLASSIFIED] Org tiene auto_unclassified_account configurado: "${accountCode}"`);
      console.log(`✅ Documento asignado automáticamente a: ${accountCode} (sin clasificación de vendor)`);
    } else {
      // Normal vendor lookup flow
      console.log(`🔍 [VENDOR LOOKUP START] tax_id='${supplier_tax_id}' (type: ${typeof supplier_tax_id}, length: ${supplier_tax_id?.length})`);
      console.log(`🔍 [VENDOR LOOKUP START] org='${payload.organization_id}'`);
      
      if (!supplier_tax_id) {
        console.error("❌ supplier_tax_id is empty or null!");
      } else {
        console.log(`✓ supplier_tax_id exists, proceeding with lookup...`);
        
        // First, look up vendor in vendors table for automatic assignment
        const { data: vendor, error: vendorError } = await supabase
          .from('vendors')
          .select('*')
          .eq('organization_id', payload.organization_id)
          .eq('vendor_tax_id', supplier_tax_id)
          .eq('is_active', true)
          .maybeSingle();
        
        console.log(`🔍 [VENDOR LOOKUP] vendor=${vendor ? 'FOUND' : 'NOT FOUND'}, error=${vendorError ? vendorError.message : 'none'}`);
        
        if (vendorError) {
          console.error("❌ Error buscando vendor:", vendorError);
        } else if (vendor) {
          vendorId = vendor.id;
          accountCode = vendor.default_account_ref;
          status = "processed";
          console.log("✅ Vendor found and assigned:", vendor.vendor_name, "→", accountCode);
        } else {
          console.log("⚠️  No vendor found for tax_id:", supplier_tax_id);
          
          // ============================================================
          // NUEVO: Buscar en vendor_defaults por nombre de proveedor
          // Esta es la tabla donde se guardan las configuraciones de cuenta
          // ============================================================
          // Normalización agresiva: quitar acentos, espacios, puntuación, solo alfanuméricos
          const aggressiveNormalize = (name: string): string => {
            return name
              .toLowerCase()
              .trim()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "") // Remove accents
              .replace(/&amp;/g, "") // Remove HTML entities
              .replace(/&/g, "")
              .replace(/[^a-z0-9]/g, ""); // Only alphanumeric
          };
          
          const normalizedSupplierName = aggressiveNormalize(supplier_name);
          console.log(`🔍 [VENDOR_DEFAULTS] Buscando por nombre normalizado: "${normalizedSupplierName}" (original: "${supplier_name}")`);
          
          const { data: vendorDefaults, error: vdError } = await supabase
            .from('vendor_defaults')
            .select('*')
            .eq('organization_id', payload.organization_id);
          
          if (vdError) {
            console.error("❌ Error buscando vendor_defaults:", vdError);
          } else if (vendorDefaults && vendorDefaults.length > 0) {
            // Buscar coincidencia por nombre normalizado agresivamente
            const matchedDefault = vendorDefaults.find(vd => {
              const normalizedVdName = aggressiveNormalize(vd.vendor_name);
              const isMatch = normalizedVdName === normalizedSupplierName;
              if (isMatch) {
                console.log(`✅ [VENDOR_DEFAULTS] Match encontrado: "${vd.vendor_name}" → "${normalizedVdName}"`);
              }
              return isMatch;
            });
            
            if (matchedDefault && matchedDefault.default_account_ref) {
              accountCode = matchedDefault.default_account_ref;
              status = "processed"; // Auto-procesar porque tiene cuenta configurada
              console.log("✅ [VENDOR_DEFAULTS] Cuenta asignada automáticamente:", supplier_name, "→", accountCode);
            } else {
              console.log(`⚠️  No vendor_default encontrado para: "${supplier_name}" (normalizado: "${normalizedSupplierName}")`);
              // Log first 5 vendor_defaults for debugging
              const sample = vendorDefaults.slice(0, 5).map(vd => `"${vd.vendor_name}" → "${aggressiveNormalize(vd.vendor_name)}"`);
              console.log(`   Primeros 5 vendor_defaults: ${sample.join(', ')}`);
            }
          }
          
          // Si aún no tiene cuenta, buscar en vendor_categories
          if (status !== "processed") {
            const { data: category, error: catError } = await supabase
              .from('vendor_categories')
              .select('*')
              .eq('organization_id', payload.organization_id)
              .eq('vendor_identification', supplier_tax_id)
              .eq('is_active', true)
              .maybeSingle();
            
            console.log(`🔍 [CATEGORY LOOKUP] category=${category ? 'FOUND' : 'NOT FOUND'}, error=${catError ? catError.message : 'none'}`);
            
            if (catError) {
              console.error("❌ Error buscando category:", catError);
            } else if (category) {
              accountCode = category.account_code;
              status = "review";
              console.log("✅ Category found (needs manual review):", category.vendor_name, "→", accountCode);
            } else {
              console.log("⚠️  No category found for tax_id:", supplier_tax_id);
              status = "review"; // Sin configuración, necesita revisión manual
            }
          }
        }
      }
    }

    const documentRecord = {
      organization_id: payload.organization_id,
      doc_key,
      doc_number,
      doc_type,
      issue_date,
      supplier_name,
      supplier_tax_id,
      supplier_email,
      total_amount,
      total_tax,
      total_discount,
      currency,
      exchange_rate,
      vendor_id: vendorId,
      status,
      default_account_ref: status === "processed" ? accountCode : null,
      processed_at: status === "processed" ? new Date().toISOString() : null,
      error_message: status === "review" ? `Proveedor sin regla automática${payload.source ? ` (${payload.source})` : ''}` : null,
      xml_data: {
        emisor: {
          nombre: supplier_name,
          identificacion: supplier_tax_id,
          email: supplier_email
        },
        receptor: {
          nombre: receptor.nombre,
          identificacion: receptor.identificacion
        },
        numeroConsecutivo: doc_number,
        fechaEmision: issue_date,
        detalle,
        subTotal: subtotal,
        totalDescuentos: total_discount,
        totalImpuesto: total_tax,
        totalImpuestoAsumidoEmisor,
        totalOtrosCargos,
        totalComprobante: total_amount,
        moneda: currency,
        tipoCambio: exchange_rate,
        cuentaContable: accountCode,
        esNotaCredito,
        aceptada
      },
      xml_attachment_url: payload.xml_attachment_url,
      pdf_attachment_url: payload.pdf_attachment_url,
      file_path: payload.file_path
    };

    // Dry run: return the would-be record without writing to DB (used by /xml-debug compare)
    if ((payload as any).dry_run === true) {
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          status,
          account_code: accountCode,
          document: documentRecord
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save document
    const { data: document, error: insertError } = await supabase
      .from('processed_documents')
      .insert([{
        ...documentRecord,
        // Spread keeps original behavior - placeholder block below replaced
        _placeholder: undefined,
      } as any].map((r: any) => { delete r._placeholder; return r; }))
      .select()
      .single();

    if (false) { const _unused = {
          emisor: {
            nombre: supplier_name,
            identificacion: supplier_tax_id,
            email: supplier_email
          },
          receptor: {
            nombre: receptor.nombre,
            identificacion: receptor.identificacion
          },
          numeroConsecutivo: doc_number,
          fechaEmision: issue_date,
          detalle,
          subTotal: subtotal,
          totalDescuentos: total_discount,
          totalImpuesto: total_tax,
          totalImpuestoAsumidoEmisor, // Impuestos asumidos por emisor (ej: IEBL)
          totalOtrosCargos, // Otros cargos adicionales
          totalComprobante: total_amount,
          moneda: currency,
          tipoCambio: exchange_rate,
          cuentaContable: accountCode,
          esNotaCredito,
          aceptada
        },
        xml_attachment_url: payload.xml_attachment_url,
        pdf_attachment_url: payload.pdf_attachment_url,
        file_path: payload.file_path
      }])
      .select()
      .single();

    if (insertError) {
      console.error("❌ Insert error:", insertError);
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        status,
        message: status === "processed" ? "Document processed successfully" : "Needs manual review",
        documentId: document.id,
        doc_id: document.id,
        account_code: accountCode
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("❌ Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});