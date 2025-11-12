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

// Enhanced XML parser functions
function parseXMLValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)<\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseLineItems(xml: string): any[] {
  const detailRegex = /<LineaDetalle>(.*?)<\/LineaDetalle>/gis;
  const lineItems: any[] = [];
  let match;
  
  while ((match = detailRegex.exec(xml)) !== null) {
    const lineXml = match[1];
    
    lineItems.push({
      descripcion: parseXMLValue(lineXml, 'Detalle') || parseXMLValue(lineXml, 'NombreComercial'),
      cantidad: parseFloat(parseXMLValue(lineXml, 'Cantidad') || '1'),
      precioUnitario: parseFloat(parseXMLValue(lineXml, 'PrecioUnitario') || '0'),
      montoTotalLinea: parseFloat(parseXMLValue(lineXml, 'MontoTotalLinea') || '0'),
      montoDescuento: parseFloat(parseXMLValue(lineXml, 'MontoDescuento') || '0'),
      tarifa: parseFloat(parseXMLValue(lineXml, 'Tarifa') || '0')
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
    
    // Parse XML to extract all data
    const doc_key = parseXMLValue(xmlContent, 'Clave');
    const doc_number = parseXMLValue(xmlContent, 'NumeroConsecutivo');
    const issue_date_str = parseXMLValue(xmlContent, 'FechaEmision');
    const issue_date = issue_date_str.split('T')[0];
    const supplier_name = parseXMLValue(xmlContent, 'Nombre');
    const supplier_tax_id = parseXMLValue(xmlContent, 'Numero') || parseXMLValue(xmlContent, 'NumeroIdentificacion');
    const supplier_email = parseXMLValue(xmlContent, 'CorreoElectronico');
    
    // Validate required fields
    if (!doc_number) {
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
    const total_tax = parseFloat(parseXMLValue(xmlContent, 'TotalImpuesto') || '0');
    const total_discount = parseFloat(parseXMLValue(xmlContent, 'TotalDescuentos') || '0');
    let total_amount = parseFloat(parseXMLValue(xmlContent, 'TotalComprobante'));
    
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
      total_amount = -Math.abs(total_amount);
      detalle.forEach(item => {
        item.montoTotalLinea = -Math.abs(item.montoTotalLinea);
        item.precioUnitario = -Math.abs(item.precioUnitario);
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

    // Look up vendor category by tax ID
    let accountCode = "Gastos por clasificar";
    let vendorId = null;
    
    if (supplier_tax_id) {
      const { data: category } = await supabase
        .from('vendor_categories')
        .select('*')
        .eq('organization_id', payload.organization_id)
        .eq('vendor_identification', supplier_tax_id)
        .eq('is_active', true)
        .single();
      
      if (category) {
        accountCode = category.account_code;
        console.log("✅ Vendor category found:", category.vendor_name, "→", accountCode);
      } else {
        console.log("⚠️  No category for:", supplier_tax_id);
      }
    }

    const status = accountCode !== "Gastos por clasificar" ? "processed" : "review";

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
          totalImpuesto: total_tax,
          totalDescuentos: total_discount,
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