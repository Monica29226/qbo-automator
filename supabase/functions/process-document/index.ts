import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, message_id, attachment_id, filename, categories } = await req.json();

    if (!organization_id || !message_id || !attachment_id) {
      throw new Error("Faltan parámetros requeridos");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Processing document: ${filename} from message ${message_id}`);

    // Obtener tokens de Gmail
    const { data: account } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "gmail")
      .eq("is_active", true)
      .single();

    if (!account) {
      throw new Error("No se encontró cuenta de Gmail activa");
    }

    const credentials = account.credentials as any;
    const accessToken = credentials.access_token;

    // Descargar adjunto
    const attachmentUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/attachments/${attachment_id}`;
    const attachmentResponse = await fetch(attachmentUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!attachmentResponse.ok) {
      throw new Error("Error al descargar adjunto");
    }

    const attachmentData = await attachmentResponse.json();
    const data = attachmentData.data; // Base64 URL-safe

    // Decodificar Base64
    const decoded = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    
    let xmlContent = decoded;

    // Si es ZIP, extraer XMLs
    if (filename.toLowerCase().endsWith('.zip')) {
      console.log("ZIP file detected - would extract XMLs here");
      // TODO: Implementar extracción de ZIP si es necesario
      return new Response(
        JSON.stringify({ error: "ZIP extraction not yet implemented" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Si no es XML, retornar
    if (!filename.toLowerCase().endsWith('.xml')) {
      return new Response(
        JSON.stringify({ 
          error: "Not an XML file",
          filename,
          pdfAttachmentId: attachment_id
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Extracting data from XML with Lovable AI");

    // Usar Lovable AI para extraer datos del XML
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY no configurada");
    }

    const systemPrompt = `Eres un experto en facturas electrónicas de Costa Rica (Hacienda v4.4).
Tu tarea es extraer información de facturas y notas de crédito en formato XML.

REGLAS IMPORTANTES:
1. Si no hay tarifa en una línea, usar 0; EXCEPCIÓN: si es impuesto IEBL usar 13
2. aceptada=false SOLO si el XML indica explícitamente rechazo (EstadoMensaje u otras variantes "Rechazado")
3. Si es recibo (no factura), aceptada=false
4. Usa las categorías proporcionadas para clasificar. Si el emisor no está listado, usar "Gastos por clasificar"

Extrae y devuelve un objeto JSON con esta estructura:
{
  "emisor": {
    "nombre": "string",
    "identificacion": "string (cédula)",
    "correo": "string"
  },
  "receptor": {
    "nombre": "string",
    "identificacion": "string"
  },
  "numeroConsecutivo": "string",
  "fechaEmision": "ISO date-time",
  "moneda": "CRC|USD|string",
  "tipoCambio": number (opcional),
  "detalle": [
    {
      "descripcion": "string",
      "cantidad": number,
      "precioUnitario": number,
      "montoTotal": number,
      "tarifa": number (0, 1, 2, 4, 13),
      "montoDescuento": number (opcional)
    }
  ],
  "subTotal": number,
  "totalDescuento": number,
  "totalImpuesto": number,
  "totalComprobante": number,
  "cuentaContable": "string (de categorías o 'Gastos por clasificar')",
  "esNotaCredito": boolean,
  "aceptada": boolean
}`;

    const userPrompt = `XML de factura:
${xmlContent}

Categorías disponibles:
${JSON.stringify(categories || [])}

Extrae la información según las reglas.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Lovable AI error:", errorText);
      throw new Error("Error al procesar XML con AI");
    }

    const aiData = await aiResponse.json();
    const extractedContent = aiData.choices[0].message.content;
    const parsed = JSON.parse(extractedContent);

    console.log("Successfully extracted data:", parsed.numeroConsecutivo);

    return new Response(
      JSON.stringify({
        parsed,
        xmlData: xmlContent,
        messageId: message_id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in process-document:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
