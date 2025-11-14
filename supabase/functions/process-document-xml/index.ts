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
  const detailRegex = /<LineaDetalle>(.*?)<\/LineaDetalle>/gis;
  const lineItems: any[] = [];
  let match;
  let lineNumber = 1;
  
  while ((match = detailRegex.exec(xml)) !== null) {
    const lineXml = match[1];
    
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
    const impuestosRegex = /<Impuesto>(.*?)<\/Impuesto>/gis;
    const impuestos: any[] = [];
    let taxMatch;
    
    while ((taxMatch = impuestosRegex.exec(lineXml)) !== null) {
      const taxXml = taxMatch[1];
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: ProcessDocumentRequest = await req.json();
    console.log("🚀 Processing document - NO AI");
    
    if (!payload.organization_id) {
      throw new Error("organization_id is required");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const xmlContent = payload.xml_content || '';
    
    console.log("📄 XML Preview:", xmlContent.substring(0, 500));
    
    // Parse XML to extract all data
    const doc_key = parseXMLValue(xmlContent, 'Clave'); // Clave numérica larga (50 dígitos)
    const doc_number = parseNumeroConsecutivo(xmlContent); // Número de factura (20 dígitos aprox)
    
    // VALIDACIÓN CRÍTICA: Asegurar que doc_number NO sea la clave numérica
    if (doc_number && doc_number.length > 25) {
      console.error("❌ ERROR: doc_number muy largo, parece ser una Clave en lugar de NumeroConsecutivo");
      console.error(`   doc_number length: ${doc_number.length}, value: ${doc_number.substring(0, 50)}`);
      throw new Error("NumeroConsecutivo inválido - demasiado largo. Verificar estructura del XML.");
    }
    
    const issue_date_str = parseXMLValue(xmlContent, 'FechaEmision');
    const issue_date = issue_date_str ? issue_date_str.split('T')[0] : '';
    const supplier_name = parseXMLValue(xmlContent, 'Nombre');
    const supplier_tax_id = parseXMLValue(xmlContent, 'Numero') || parseXMLValue(xmlContent, 'NumeroIdentificacion');
    const supplier_email = parseXMLValue(xmlContent, 'CorreoElectronico');
    
    console.log("🔍 Parsed values:", { doc_number, doc_key: doc_key?.substring(0, 20), supplier_name, supplier_tax_id });
    
    // Validate required fields
    if (!doc_number) {
      console.error("❌ NumeroConsecutivo not found. XML structure:", xmlContent.substring(0, 1000));
      throw new Error("Document number (NumeroConsecutivo) not found in XML");
    }
    if (!issue_date || issue_date === '') {
      throw new Error("Issue date (FechaEmision) not found in XML");
    }
    if (!supplier_name) {
      throw new Error("Supplier name (Nombre) not found in XML");
    }
    
    // Parse amounts
    const subtotal = parseFloat(parseXMLValue(xmlContent, 'TotalGravado') || parseXMLValue(xmlContent, 'TotalVenta') || '0');
    let total_tax = parseFloat(parseXMLValue(xmlContent, 'TotalImpuesto') || '0');
    let total_discount = parseFloat(parseXMLValue(xmlContent, 'TotalDescuentos') || '0');
    let total_amount = parseFloat(parseXMLValue(xmlContent, 'TotalComprobante'));
    
    // Capturar impuestos asumidos por el emisor y otros cargos
    const totalImpuestoAsumidoEmisor = parseFloat(parseXMLValue(xmlContent, 'TotalImpAsumEmisorFabrica') || '0');
    const totalOtrosCargos = parseFloat(parseXMLValue(xmlContent, 'TotalOtrosCargos') || '0');
    
    const currency = parseXMLValue(xmlContent, 'CodigoMoneda') || 'CRC';
    const exchange_rate = parseFloat(parseXMLValue(xmlContent, 'TipoCambio') || '1');
    
    // Parse line items
    const detalle = parseLineItems(xmlContent);
    
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

    // Check for duplicates
    const { data: duplicates } = await supabase
      .from('processed_documents')
      .select('id, doc_number')
      .eq('organization_id', payload.organization_id)
      .eq('doc_number', doc_number);

    if (duplicates && duplicates.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Documento duplicado: ${doc_number} ya existe`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up vendor by tax ID for automatic assignment
    let accountCode = "Gastos por clasificar";
    let vendorId = null;
    let status = "pending";
    
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
        
        // Fallback: check vendor_categories for account code
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
          
          // Debug: List vendors to compare
          const { data: allVendors, error: listError } = await supabase
            .from('vendors')
            .select('vendor_tax_id, vendor_name, default_account_ref')
            .eq('organization_id', payload.organization_id)
            .eq('is_active', true)
            .limit(5);
          
          if (listError) {
            console.error("❌ Error listing vendors:", listError);
          } else {
            console.log("📋 Sample vendors in DB:", JSON.stringify(allVendors));
          }
        }
      }
    }

    // Save document
    const { data: document, error: insertError } = await supabase
      .from('processed_documents')
      .insert([{
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
        processed_at: status === "processed" ? new Date().toISOString() : null,
        xml_data: {
          emisor: {
            nombre: supplier_name,
            identificacion: supplier_tax_id,
            email: supplier_email
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