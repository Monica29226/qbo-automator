const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const testCases = [
      {
        name: "Factura con descuento en línea",
        subtotal: 1443000,
        descuentos: 144300,
        iva: 168831,
        total: 1467531,
        expected: true,
        formula: "(subtotal - descuentos) + iva = total"
      },
      {
        name: "Factura sin descuento",
        subtotal: 100000,
        descuentos: 0,
        iva: 13000,
        total: 113000,
        expected: true,
        formula: "(subtotal - descuentos) + iva = total"
      },
      {
        name: "Factura sin IVA (exenta)",
        subtotal: 50000,
        descuentos: 0,
        iva: 0,
        total: 50000,
        expected: true,
        formula: "(subtotal - descuentos) + iva = total"
      },
      {
        name: "Nota de crédito con descuento",
        subtotal: -100000,
        descuentos: -10000,
        iva: -11700,
        total: -101700,
        expected: true,
        formula: "(subtotal - descuentos) + iva = total"
      },
      {
        name: "Factura con descuento y múltiples impuestos",
        subtotal: 200000,
        descuentos: 20000,
        iva: 23400,
        total: 203400,
        expected: true,
        formula: "(subtotal - descuentos) + iva = total"
      },
      {
        name: "Error: Total incorrecto",
        subtotal: 100000,
        descuentos: 0,
        iva: 13000,
        total: 115000, // Incorrecto intencionalmente
        expected: false,
        formula: "(subtotal - descuentos) + iva = total"
      },
      {
        name: "Error: Descuento no aplicado",
        subtotal: 100000,
        descuentos: 10000,
        iva: 13000, // Calculado sobre subtotal original, no sobre subtotal con descuento
        total: 103000,
        expected: false,
        formula: "(subtotal - descuentos) + iva = total"
      },
      {
        name: "Factura grande con descuento porcentual",
        subtotal: 5000000,
        descuentos: 500000,
        iva: 585000,
        total: 5085000,
        expected: true,
        formula: "(subtotal - descuentos) + iva = total"
      }
    ];

    const tolerance = 1.0;
    const results = testCases.map(test => {
      const subtotalAfterDiscount = test.subtotal - test.descuentos;
      const calculatedTotal = subtotalAfterDiscount + test.iva;
      const diff = Math.abs(calculatedTotal - test.total);
      const isValid = diff <= tolerance;
      const passed = isValid === test.expected;

      return {
        name: test.name,
        formula: test.formula,
        input: {
          subtotal: test.subtotal,
          descuentos: test.descuentos,
          iva: test.iva,
          total: test.total
        },
        calculation: {
          subtotalAfterDiscount,
          calculatedTotal,
          diff,
          isValid
        },
        expected: test.expected ? "VÁLIDO" : "INVÁLIDO",
        result: isValid ? "VÁLIDO" : "INVÁLIDO",
        passed,
        status: passed ? "✅ PASS" : "❌ FAIL"
      };
    });

    const summary = {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      successRate: ((results.filter(r => r.passed).length / results.length) * 100).toFixed(1)
    };

    return new Response(
      JSON.stringify({
        success: true,
        summary,
        results,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    );

  } catch (error) {
    console.error("❌ Error in test:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
