import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProcessDocumentRequest {
  xml_content: string;
  doc_key?: string;
  organization_id: string;
  pdf_path?: string;
  xml_path?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { xml_content, doc_key, organization_id, pdf_path, xml_path }: ProcessDocumentRequest = await req.json();

    if (!organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "organization_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Obtener categorías contables (vendors) para el prompt
    const { data: vendors, error: vendorsError } = await supabase
      .from("vendors")
      .select("vendor_name, default_account_ref, qbo_vendor_ref")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    if (vendorsError) {
      console.error("Error fetching vendors:", vendorsError);
    }

    const categoriesForPrompt = vendors && vendors.length > 0
      ? vendors.map(v => `${v.vendor_name}: ${v.default_account_ref}`).join("\n")
      : "No categories configured";

    // Usar IA para extraer datos del XML con el prompt mejorado
    const systemPrompt = `# Role

You are an expert in bookkeeping. Your role is to read and analyze financial invoices, bills or vendor credits that come in XML format, then extract all relevant purchase information. You ALWAYS base your outputs on real and factual information contained in the original invoice that the user will give you as input. Ignore fields of the XML that don't contribute to the invoice's, bill's or credit's content extraction, such as signatures. The input ALWAYS comes in a VALID XML FORMAT, so you MUST use whatever info the user gives you, even if you think it is not a valid XML. You must accept any XML like format as input and try to extract as high fidelity as possible.

These are the accounting account categories for you to place the category in the JSON. These categories are for the "Emisor" only:
${categoriesForPrompt}

If the accounting account is empty or the "Emisor" is not in the list, please place the accounting account as "Gastos por clasificar".

# Special considerations

- You should consider the extra charges too, and add them as a new item of detalle.
- If no tarifa is provided, put 0. An exception is the Impuesto IEBL, that always has a tarifa of 13, even if it is not mentioned.
- Set "aceptada": false only if the XML **explicitly** indicates rejection; search for a field named "EstadoMensaje" or similar and see its state to determine if it is accepted or not. If this field does not exists then search for keywords "Aceptado" or "Rechazado".
- **Only** accept invoices, not receipts. If it is a receipt, then set "aceptada" as false.`;

    const userPrompt = `Extract all information from this XML invoice:\n\n${xml_content}`;

    // Llamar a Lovable AI con structured output
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_invoice_data",
              description: "Extract structured invoice data from XML",
              parameters: {
                type: "object",
                properties: {
                  emisor: {
                    type: "object",
                    description: "Información del emisor de la factura o comprobante.",
                    properties: {
                      nombre: { type: "string", description: "Nombre completo o razón social del emisor." },
                      identificacion: { type: "string", description: "Número de identificación fiscal del emisor." },
                      correo: { type: "string", description: "Correo electrónico del emisor." },
                      telefono: { type: "string", description: "Número de teléfono del emisor." },
                      direccion: { type: "string", description: "Dirección física del emisor." }
                    },
                    required: ["nombre", "identificacion"]
                  },
                  numeroConsecutivo: { type: "string", description: "Número consecutivo único del comprobante." },
                  fechaEmision: { type: "string", description: "Fecha y hora en que se emite el comprobante." },
                  receptor: {
                    type: "object",
                    description: "Información del receptor del comprobante.",
                    properties: {
                      nombre: { type: "string", description: "Nombre completo o razón social del receptor." },
                      identificacion: { type: "string", description: "Número de identificación fiscal del receptor." }
                    },
                    required: ["nombre"]
                  },
                  detalle: {
                    type: "array",
                    description: "Lista de los productos o servicios incluidos en el comprobante.",
                    items: {
                      type: "object",
                      properties: {
                        descripcion: { type: "string" },
                        cantidad: { type: "number" },
                        precioUnitario: { type: "number" },
                        montoTotalLinea: { type: "number" },
                        tarifa: { type: "number" },
                        montoDescuento: { type: "number" }
                      },
                      required: ["descripcion", "cantidad", "precioUnitario", "montoTotalLinea", "tarifa", "montoDescuento"]
                    }
                  },
                  subTotal: { type: "number" },
                  totalComprobante: { type: "number" },
                  cuentaContable: { type: "string" },
                  moneda: { type: "string" },
                  esNotaCredito: { type: "boolean" },
                  aceptada: { type: "boolean" }
                },
                required: ["emisor", "numeroConsecutivo", "fechaEmision", "receptor", "detalle", "subTotal", "totalComprobante", "cuentaContable", "moneda", "esNotaCredito", "aceptada"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_invoice_data" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI extraction error:", aiResponse.status, errorText);
      throw new Error("Failed to extract invoice data with AI");
    }

    const aiData = await aiResponse.json();
    console.log("AI response:", JSON.stringify(aiData, null, 2));

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No tool call in AI response");
    }

    const invoiceData = JSON.parse(toolCall.function.arguments);
    console.log("Extracted invoice data:", JSON.stringify(invoiceData, null, 2));

    // Si el documento no fue aceptado, rechazarlo
    if (!invoiceData.aceptada) {
      return new Response(
        JSON.stringify({
          success: false,
          status: "rejected",
          message: "Document rejected - not accepted or is a receipt",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Determinar tipo de documento
    let docType = "FacturaElectronica";
    if (invoiceData.esNotaCredito) {
      docType = "NotaCreditoElectronica";
    }

    // Construir extractedData desde la respuesta de IA
    const extractedData = {
      doc_key: doc_key || "",
      doc_type: docType,
      doc_number: invoiceData.numeroConsecutivo,
      issue_date: invoiceData.fechaEmision.split("T")[0],
      supplier_name: invoiceData.emisor.nombre,
      supplier_tax_id: invoiceData.emisor.identificacion,
      supplier_email: invoiceData.emisor.correo || "",
      currency: invoiceData.moneda || "CRC",
      total_amount: invoiceData.totalComprobante,
      total_tax: invoiceData.detalle.reduce((sum: number, item: any) => 
        sum + (item.montoTotalLinea * item.tarifa / 100), 0
      ),
      total_discount: invoiceData.detalle.reduce((sum: number, item: any) => 
        sum + item.montoDescuento, 0
      ),
    };

    console.log("Extracted data:", extractedData);

    // Verificar duplicados
    const duplicateWindowDays = 120;
    const windowDate = new Date();
    windowDate.setDate(windowDate.getDate() - duplicateWindowDays);

    const { data: existingDoc, error: duplicateError } = await supabase
      .from("processed_documents")
      .select("id, status")
      .eq("doc_key", extractedData.doc_key)
      .eq("organization_id", organization_id)
      .gte("created_at", windowDate.toISOString())
      .maybeSingle();

    if (duplicateError) {
      console.error("Error checking duplicates:", duplicateError);
    }

    if (existingDoc) {
      return new Response(
        JSON.stringify({
          success: false,
          status: "duplicate",
          message: "Document already processed",
          doc_id: existingDoc.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Clasificar proveedor usando Lovable AI
    let vendorId = null;
    let classificationReason = "No classification attempted";

    try {
      const classifyResponse = await fetch(
        `${supabaseUrl}/functions/v1/classify-vendor`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            supplier_name: extractedData.supplier_name,
            supplier_tax_id: extractedData.supplier_tax_id,
            supplier_email: extractedData.supplier_email,
            xml_data: extractedData,
            organization_id: organization_id,
          }),
        }
      );

      if (classifyResponse.ok) {
        const classification = await classifyResponse.json();
        console.log("Classification result:", classification);
        
        if (classification.vendor_id && classification.confidence >= 70) {
          vendorId = classification.vendor_id;
          classificationReason = classification.reason;
        } else {
          classificationReason = `Low confidence (${classification.confidence}%): ${classification.reason}`;
        }
      }
    } catch (classifyError) {
      console.error("Error classifying vendor:", classifyError);
      classificationReason = "Classification service unavailable";
    }

    // Determinar estado
    let status = "processed";
    if (!vendorId) {
      status = "review";
    }

    // Guardar documento
    const { data: savedDoc, error: saveError } = await supabase
      .from("processed_documents")
      .insert([
        {
          doc_key: extractedData.doc_key,
          doc_type: extractedData.doc_type,
          doc_number: extractedData.doc_number,
          issue_date: extractedData.issue_date,
          supplier_name: extractedData.supplier_name,
          supplier_tax_id: extractedData.supplier_tax_id,
          supplier_email: extractedData.supplier_email,
          vendor_id: vendorId,
          currency: extractedData.currency,
          total_amount: extractedData.total_amount,
          total_tax: extractedData.total_tax,
          total_discount: extractedData.total_discount,
          status: status,
          xml_data: invoiceData, // Guardar toda la información estructurada extraída por IA
          error_message: !vendorId ? classificationReason : null,
          organization_id: organization_id,
          file_path: pdf_path || xml_path,
          pdf_attachment_url: pdf_path,
          xml_attachment_url: xml_path,
        },
      ])
      .select()
      .single();

    if (saveError) {
      console.error("Error saving document:", saveError);
      throw new Error("Failed to save document");
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: status,
        message: vendorId ? "Document processed successfully" : "Document needs manual review",
        doc_id: savedDoc.id,
        vendor_id: vendorId,
        classification_reason: classificationReason,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in process-document:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
