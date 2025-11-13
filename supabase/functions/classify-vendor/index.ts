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

    const systemPrompt = `Eres un experto en clasificación de proveedores de Costa Rica. 
Tu tarea es identificar qué proveedor del catálogo corresponde a la factura proporcionada.

Analiza cuidadosamente:
1. El nombre exacto del proveedor
2. La cédula jurídica (si está disponible)
3. El correo electrónico
4. Las pistas de mapeo configuradas

Devuelve tu análisis usando la herramienta classify_vendor.`;

    const userPrompt = `Analiza esta factura y clasifica el proveedor:

Datos del emisor:
- Nombre: ${supplier_name}
- Cédula: ${supplier_tax_id || "No disponible"}
- Correo: ${supplier_email || "No disponible"}

Catálogo de proveedores disponibles:
${JSON.stringify(vendorsList, null, 2)}

¿Qué proveedor del catálogo corresponde a esta factura?`;

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

    // Agregar clasificación de cuenta si se encontró
    if (accountClassification) {
      classification.account_classification = accountClassification;
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
