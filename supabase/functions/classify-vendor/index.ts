import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ClassifyRequest {
  supplier_name: string;
  supplier_tax_id?: string;
  supplier_email?: string;
  xml_data: any;
  organization_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { supplier_name, supplier_tax_id, supplier_email, xml_data, organization_id }: ClassifyRequest = await req.json();
    
    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Obtener reglas de clasificación activas
    const { data: classificationRules, error: rulesError } = await supabase
      .from("vendor_classification_rules")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    if (rulesError) {
      console.error("Error fetching classification rules:", rulesError);
    }

    // Obtener todos los proveedores activos de la organización
    const { data: vendors, error: vendorsError } = await supabase
      .from("vendors")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    if (vendorsError) {
      console.error("Error fetching vendors:", vendorsError);
      throw new Error("Failed to fetch vendors");
    }

    // Buscar primero en las reglas de clasificación por nombre exacto
    let accountClassification = null;
    if (classificationRules && classificationRules.length > 0) {
      const rule = classificationRules.find(
        (r) => r.vendor_name.toLowerCase() === supplier_name.toLowerCase()
      );
      
      if (rule) {
        console.log(`Found classification rule for ${supplier_name}: ${rule.account_code}`);
        accountClassification = {
          account_code: rule.account_code,
          account_description: rule.account_description,
          matched_by: "exact_name",
        };
      }
    }

    if (!vendors || vendors.length === 0) {
      // Si no hay proveedores pero sí reglas de clasificación, devolver la clasificación
      if (accountClassification) {
        return new Response(
          JSON.stringify({ 
            vendor_id: null,
            confidence: 90,
            reason: "Vendor not in catalog but account classification found by name",
            account_classification: accountClassification
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ 
          error: "No active vendors found",
          vendor_id: null,
          confidence: 0,
          reason: "No vendors in catalog"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Preparar contexto para Lovable AI
    const vendorsList = vendors.map((v) => ({
      id: v.id,
      name: v.vendor_name,
      tax_id: v.vendor_tax_id,
      email: v.vendor_email,
      hints: v.mapping_hints,
    }));

    // Extraer descripciones de líneas de detalle del XML
    const lineDescriptions = xml_data?.detalle?.map((item: any) => item.descripcion).filter(Boolean) || [];
    const itemsDescription = lineDescriptions.length > 0 ? lineDescriptions.join(", ") : "No disponible";

    const systemPrompt = `Eres un experto en clasificación contable de facturas de Costa Rica. 
Tu tarea es:
1. Identificar qué proveedor del catálogo corresponde a la factura
2. CLASIFICAR la cuenta contable según el CONTENIDO de la factura (lo que se está comprando/servicio)

Analiza cuidadosamente:
1. Las DESCRIPCIONES de los items/servicios de la factura (MUY IMPORTANTE)
2. El nombre del proveedor
3. La cédula jurídica
4. Las reglas de clasificación existentes

CATEGORÍAS CONTABLES COMUNES:
- "Viáticos": hospedaje, transporte, combustible, peajes, alimentación en viaje
- "Gastos Médicos": consultas médicas, medicamentos, exámenes, servicios de salud
- "Vehículos": mantenimiento vehicular, ITV, inspección, repuestos auto
- "Servicios Profesionales": consultoría, honorarios, servicios legales
- "Suministros de Oficina": papelería, útiles, materiales de oficina
- "Telecomunicaciones": internet, teléfono, servicios de comunicación
- "Publicidad": marketing, anuncios, promoción

Devuelve tu análisis usando la herramienta classify_vendor.`;

    const userPrompt = `Analiza esta factura y clasifica el proveedor Y la cuenta contable según el CONTENIDO:

Datos del emisor:
- Nombre: ${supplier_name}
- Cédula: ${supplier_tax_id || "No disponible"}
- Correo: ${supplier_email || "No disponible"}

CONTENIDO DE LA FACTURA (items/servicios):
${itemsDescription}

Catálogo de proveedores disponibles:
${JSON.stringify(vendorsList, null, 2)}

Reglas de clasificación existentes:
${classificationRules?.map(r => `${r.vendor_name}: ${r.account_code} (${r.account_description})`).join('\n') || 'Ninguna'}

¿Qué proveedor del catálogo corresponde? ¿Qué cuenta contable según el CONTENIDO/NATURALEZA del gasto?`;

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
              name: "classify_vendor",
              description: "Clasifica el proveedor de una factura basándose en el catálogo",
              parameters: {
                type: "object",
                properties: {
                  vendor_id: {
                    type: "string",
                    description: "ID del proveedor identificado del catálogo, o null si no se encuentra coincidencia",
                  },
                  confidence: {
                    type: "number",
                    description: "Nivel de confianza de 0 a 100",
                  },
                  reason: {
                    type: "string",
                    description: "Explicación detallada de por qué se eligió este proveedor o por qué no se encontró coincidencia",
                  },
                  suggested_account_code: {
                    type: "string",
                    description: "Código de cuenta contable sugerido BASADO EN EL CONTENIDO de la factura (ej: 'Viáticos', 'Gastos Médicos', 'Vehículos')",
                  },
                  account_classification_reason: {
                    type: "string",
                    description: "Explicación de POR QUÉ se sugiere esa cuenta contable basándose en las descripciones de los items",
                  },
                  suggested_mapping_hints: {
                    type: "string",
                    description: "Sugerencias de palabras clave para mejorar futuras clasificaciones",
                  },
                },
                required: ["vendor_id", "confidence", "reason"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_vendor" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      throw new Error("AI classification failed");
    }

    const aiData = await aiResponse.json();
    console.log("AI response:", JSON.stringify(aiData, null, 2));

    // Extraer el resultado de la herramienta
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No tool call in AI response");
    }

    const classification = JSON.parse(toolCall.function.arguments);

    // Agregar clasificación de cuenta si se encontró por nombre exacto
    if (accountClassification) {
      classification.account_classification = accountClassification;
    } else if (classification.suggested_account_code) {
      // Si la IA sugiere una cuenta basada en el contenido, usarla
      classification.account_classification = {
        account_code: classification.suggested_account_code,
        account_description: classification.account_classification_reason || "Clasificación basada en contenido de factura",
        matched_by: "content_analysis",
      };
    }

    return new Response(JSON.stringify(classification), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in classify-vendor:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
