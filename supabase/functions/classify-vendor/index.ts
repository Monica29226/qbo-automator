import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProviderMapping {
  proveedor: string;
  cedula: string;
  cuentaGasto: string;
  cuentaIVA: string;
  gravado: boolean;
  tasaIVA: number;
  descuentoDefault: number;
}

interface BillData {
  emisor: {
    nombre: string;
    identificacion: string;
  };
  detalle: Array<{
    tarifa?: number;
    montoDescuento?: number;
  }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bill_data, provider_map } = await req.json();

    if (!bill_data || !provider_map) {
      throw new Error("bill_data y provider_map son requeridos");
    }

    const billData = bill_data as BillData;
    const providerMappings = provider_map as ProviderMapping[];

    console.log(`Classifying vendor: ${billData.emisor.nombre}`);

    // Buscar por cédula (prioritario)
    let mapping = providerMappings.find(
      (p) => p.cedula.trim().toLowerCase() === billData.emisor.identificacion.trim().toLowerCase()
    );

    // Si no encontró por cédula, buscar por nombre
    if (!mapping) {
      mapping = providerMappings.find(
        (p) => p.proveedor.trim().toLowerCase() === billData.emisor.nombre.trim().toLowerCase()
      );
    }

    if (!mapping) {
      console.log("Vendor not found in mapping, using defaults");
      return new Response(
        JSON.stringify({
          found: false,
          mapping: {
            cuentaGasto: "Gastos por clasificar",
            cuentaIVA: "",
            gravado: true,
            tasaIVA: 13,
            descuentoDefault: 0,
          },
          estadoMapeo: "OBSERVACIONES",
          mensaje: "Proveedor no encontrado en el mapeo",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Aplicar mapeo encontrado
    console.log(`Vendor found: ${mapping.proveedor}`);

    // Verificar si el XML ya trae tasas/descuentos definidos
    const hasDefinedTaxes = billData.detalle.some((d) => d.tarifa !== undefined && d.tarifa > 0);
    const hasDefinedDiscounts = billData.detalle.some((d) => d.montoDescuento !== undefined && d.montoDescuento > 0);

    return new Response(
      JSON.stringify({
        found: true,
        mapping: {
          cuentaGasto: mapping.cuentaGasto,
          cuentaIVA: mapping.cuentaIVA,
          gravado: mapping.gravado,
          tasaIVA: hasDefinedTaxes ? undefined : mapping.tasaIVA, // Respetar tasas del XML
          descuentoDefault: hasDefinedDiscounts ? undefined : mapping.descuentoDefault,
        },
        estadoMapeo: "OK",
        mensaje: `Mapeado a: ${mapping.cuentaGasto}`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in classify-vendor:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
