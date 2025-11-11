import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { xmlContent, categories } = await req.json();
    
    if (!xmlContent) {
      throw new Error("XML content is required");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Extracting invoice data from XML using Lovable AI...");

    const systemPrompt = `You are an expert in bookkeeping. Your role is to read and analyze financial invoices, bills or vendor credits that come in XML format, then extract all relevant purchase information. You ALWAYS base your outputs on real and factual information contained in the original invoice. Ignore fields of the XML that don't contribute to the invoice's, bill's or credit's content extraction, such as signatures. The input ALWAYS comes in a VALID XML FORMAT, so you MUST use whatever info the user gives you, even if you think it is not a valid XML. You must accept any XML like format as input and try to extract as high fidelity as possible.

These are the accounting account categories for the "Emisor" only: ${categories || 'None provided'}. You should take the full account name and info. If the accounting account is empty or the "Emisor" is not in the list, please place the accounting account as "Gastos por clasificar".

Special considerations:
- You should consider the extra charges too, and add them as a new item of detalle.
- If no tarifa is provided, put 0. An exception is the Impuesto IEBL, that always has a tarifa of 13, even if it is not mentioned.
- Set "aceptada": false only if the XML explicitly indicates rejection; search for a field named "EstadoMensaje" or similar and see its state to determine if it is accepted or not. If this field does not exist then search for keywords "Aceptado" or "Rechazado".
- Only accept invoices, not receipts. If it is a receipt, then set "aceptada" as false.

CRITICAL: You MUST extract line items (detalle array). Look for:
1. DetalleServicio/LineaDetalle nodes
2. If not found, look for any alternative line item structure in the XML
3. If absolutely no line items exist, create ONE line with:
   - descripcion: "Servicio/Producto según factura [NumeroConsecutivo]"
   - cantidad: 1
   - precioUnitario: [total amount from MontoTotalComprobante or TotalComprobante]
   - montoTotalLinea: [same total amount]
   - tarifa: 0
   - montoDescuento: 0

The detalle array MUST NEVER be empty.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extract invoice data from this XML:\n\n${xmlContent}` }
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
                      identificacion: { type: "string", description: "Número de identificación fiscal del receptor." },
                      correo: { type: "string", description: "Correo electrónico del receptor." },
                      telefono: { type: "string", description: "Número de teléfono del receptor." },
                      direccion: { type: "string", description: "Dirección física del receptor." }
                    },
                    required: ["nombre"]
                  },
                  detalle: {
                    type: "array",
                    description: "Lista de los productos o servicios incluidos en el comprobante.",
                    items: {
                      type: "object",
                      properties: {
                        descripcion: { type: "string", description: "Descripción del producto o servicio." },
                        cantidad: { type: "number", description: "Cantidad del producto o servicio." },
                        precioUnitario: { type: "number", description: "Precio por unidad del producto o servicio." },
                        montoTotalLinea: { type: "number", description: "Monto total de la línea (cantidad * precio unitario - descuento)." },
                        tarifa: { type: "number", description: "Tarifa de impuesto IVA aplicable a esta línea. SOLO considera el IVA y ningún otro tipo de impuesto." },
                        montoDescuento: { type: "number", description: "Monto de descuento aplicado a esta línea. Si no se especifica, se debe asumir 0." }
                      },
                      required: ["descripcion", "cantidad", "precioUnitario", "montoTotalLinea", "tarifa", "montoDescuento"]
                    }
                  },
                  subTotal: { type: "number", description: "Subtotal de todos los productos o servicios antes de impuestos y descuentos." },
                  tipoCambio: { type: "number", description: "Tipo de cambio aplicado si la moneda es distinta de la moneda base." },
                  montoTotalLinea: { type: "number", description: "Monto total de todas las líneas de detalle." },
                  totalImpuesto: { type: "number", description: "Monto total de IVA e impuestos aplicados al comprobante. CRITICAL: Siempre extraer este valor." },
                  totalComprobante: { type: "number", description: "Monto total del comprobante, incluyendo impuestos y descuentos." },
                  totalExonerado: { type: "number", description: "Monto total exonerado de impuestos si aplica." },
                  totalIvaDevuelto: { type: "number", description: "Monto total de IVA devuelto o acreditado si aplica." },
                  cuentaContable: { type: "string", description: "Cuenta contable asociada al comprobante." },
                  moneda: { type: "string", description: "Moneda en la que se realiza el comprobante (ej. USD, CRC)." },
                  esNotaCredito: { type: "boolean", description: "Indica si el comprobante es una nota de crédito." },
                  aceptada: { type: "boolean", description: "Indica si el comprobante ha sido aceptado o rechazado." }
                },
                required: [
                  "emisor",
                  "numeroConsecutivo",
                  "fechaEmision",
                  "receptor",
                  "detalle",
                  "subTotal",
                  "totalComprobante",
                  "cuentaContable",
                  "moneda",
                  "esNotaCredito",
                  "aceptada"
                ]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_invoice_data" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    console.log("AI response received");

    // Extract the tool call result
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "extract_invoice_data") {
      throw new Error("Invalid AI response format");
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    
    // VALIDATION: Ensure detalle array has at least one item
    if (!extractedData.detalle || extractedData.detalle.length === 0) {
      console.warn("No line items extracted, creating default line");
      const totalAmount = extractedData.totalComprobante || extractedData.subTotal || 0;
      extractedData.detalle = [{
        descripcion: `Servicio/Producto según factura ${extractedData.numeroConsecutivo || 'N/A'}`,
        cantidad: 1,
        precioUnitario: totalAmount,
        montoTotalLinea: totalAmount,
        tarifa: 0,
        montoDescuento: 0
      }];
      console.log("Default line created:", extractedData.detalle[0]);
    }
    
    console.log(`Extracted ${extractedData.detalle.length} line items`);
    console.log("Invoice data extracted successfully");

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in extract-invoice-data:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
