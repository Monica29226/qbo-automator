import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

// DEBUG flag - set to false in production
const DEBUG = Deno.env.get("DEBUG") === "true";

// Conditional logging helpers
const log = (...args: any[]) => DEBUG && console.log(...args);
const logInfo = (msg: string) => console.log(msg);
const logError = (...args: any[]) => console.error(...args);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper: Delay function for rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Per-invoice timeout for processing
const INVOICE_TIMEOUT_MS = 45000; // 45 seconds per invoice max

// =============================================================
// INTERFACE: OtrosCargos from Costa Rica XML schema v4.4
// =============================================================
interface OtroCargo {
  tipoDocumento: string;  // "06" = Flete, "07" = Seguro, etc.
  detalle: string;
  porcentaje?: number;
  monto: number;
}

// =============================================================
// INTERFACE: Totals validation result
// =============================================================
interface TotalsValidation {
  valid: boolean;
  xmlTotal: number;
  calculatedTotal: number;
  difference: number;
  breakdown: {
    subtotal: number;
    totalImpuestos: number;
    totalDescuentos: number;
    totalOtrosCargos: number;
    totalExoneraciones: number;
  };
  errors: string[];
}

// =============================================================
// PARSE OTROS CARGOS: Complete parsing per XML schema v4.4
// =============================================================
function parseOtrosCargosComplete(xmlData: any): OtroCargo[] {
  const otrosCargos: OtroCargo[] = [];
  
  if (!xmlData) return otrosCargos;
  
  try {
    // Look in multiple possible locations
    const locations = [
      xmlData.OtrosCargos,
      xmlData.otros_cargos,
      xmlData.resumen_factura?.OtrosCargos,
      xmlData.resumen_factura?.otros_cargos,
      xmlData.ResumenFactura?.OtrosCargos,
      xmlData.ResumenFactura?.otros_cargos,
    ];
    
    for (const cargosSource of locations) {
      if (!cargosSource) continue;
      
      // Handle array of OtroCargo
      const cargosArray = Array.isArray(cargosSource) ? cargosSource : 
                          cargosSource.OtroCargo ? (Array.isArray(cargosSource.OtroCargo) ? cargosSource.OtroCargo : [cargosSource.OtroCargo]) :
                          [cargosSource];
      
      for (const cargo of cargosArray) {
        const monto = parseFloat(
          cargo.MontoCargo || cargo.monto_cargo || cargo.monto || cargo.Monto || '0'
        );
        
        if (Math.abs(monto) > 0.001) {
          otrosCargos.push({
            tipoDocumento: cargo.TipoDocumento || cargo.tipo_documento || cargo.tipo || 'OC',
            detalle: cargo.Detalle || cargo.detalle || cargo.NombreTercero || cargo.nombre_tercero || 
                     getCargoDescription(cargo.TipoDocumento || cargo.tipo_documento || ''),
            porcentaje: parseFloat(cargo.Porcentaje || cargo.porcentaje || '0') || undefined,
            monto: monto
          });
        }
      }
      
      if (otrosCargos.length > 0) break;
    }
    
    // Fallback: Check for TotalOtrosCargos if no individual items found
    if (otrosCargos.length === 0) {
      const totalCargos = parseFloat(
        xmlData.TotalOtrosCargos || 
        xmlData.totalOtrosCargos || 
        xmlData.total_otros_cargos ||
        xmlData.resumen_factura?.TotalOtrosCargos ||
        xmlData.resumen_factura?.total_otros_cargos ||
        '0'
      );
      
      if (Math.abs(totalCargos) > 0.001) {
        otrosCargos.push({
          tipoDocumento: 'OC',
          detalle: 'Otros Cargos (Flete/Envío)',
          monto: totalCargos
        });
      }
    }
  } catch (e) {
    logError('Error parsing OtrosCargos:', e);
  }
  
  return otrosCargos;
}

// Get description based on tipoDocumento code
function getCargoDescription(tipo: string): string {
  const tipos: Record<string, string> = {
    '01': 'Contenedores',
    '02': 'Carga/Descarga',
    '03': 'Almacenaje',
    '04': 'Tramitación aduanera',
    '05': 'Peso',
    '06': 'Flete',
    '07': 'Seguro',
    '08': 'Gastos administrativos',
    '09': 'Impuesto de salida',
    '10': 'Timbre pro indigente',
    '99': 'Otros cargos',
  };
  return tipos[tipo] || 'Otros Cargos';
}

// =============================================================
// PARSE DISCOUNTS: Complete parsing from XML
// =============================================================
function parseDescuentosTotal(xmlData: any): number {
  if (!xmlData) return 0;
  
  let totalDescuento = 0;
  
  try {
    // Check resumen_factura for total discount (nested or flat structure)
    const resumen = xmlData.resumen_factura || xmlData.ResumenFactura || xmlData;
    totalDescuento = parseFloat(
      resumen.TotalDescuentos || 
      resumen.total_descuentos || 
      resumen.totalDescuentos ||
      '0'
    );
    
    // Sum from detail lines if available (some XMLs have line-level discounts)
    if (xmlData.detalle && Array.isArray(xmlData.detalle)) {
      for (const item of xmlData.detalle) {
        // Check montoDescuento at line level
        const lineDiscount = parseFloat(item.montoDescuento || item.MontoDescuento || '0');
        if (lineDiscount > 0 && totalDescuento === 0) {
          totalDescuento += lineDiscount;
        }
        
        // Check nested descuentos array
        const descuentos = item.descuentos || item.Descuento || [];
        const descuentosArr = Array.isArray(descuentos) ? descuentos : [descuentos];
        
        for (const desc of descuentosArr) {
          if (desc) {
            totalDescuento += parseFloat(desc.MontoDescuento || desc.monto_descuento || desc.monto || '0');
          }
        }
      }
    }
  } catch (e) {
    logError('Error parsing descuentos:', e);
  }
  
  return Math.abs(totalDescuento);
}

// =============================================================
// PARSE TAXES: Complete parsing from XML (including from lines)
// =============================================================
function parseImpuestosTotal(xmlData: any): number {
  if (!xmlData) return 0;
  
  try {
    // First try from resumen (nested or flat structure)
    const resumen = xmlData.resumen_factura || xmlData.ResumenFactura || xmlData;
    let total = parseFloat(
      resumen.TotalImpuesto || 
      resumen.total_impuesto || 
      resumen.totalImpuesto ||
      resumen.total_tax ||
      '0'
    );
    
    // If no summary tax, sum from detail lines
    if (total === 0 && xmlData.detalle && Array.isArray(xmlData.detalle)) {
      for (const item of xmlData.detalle) {
        // Check direct impuestoNeto or montoImpuesto
        const lineTax = parseFloat(
          item.impuestoNeto || 
          item.ImpuestoNeto || 
          item.montoImpuesto || 
          item.MontoImpuesto || 
          '0'
        );
        total += lineTax;
        
        // Also check impuestos array
        if (item.impuestos && Array.isArray(item.impuestos)) {
          for (const imp of item.impuestos) {
            const impMonto = parseFloat(imp.monto || imp.Monto || '0');
            // Only add if not already counted
            if (impMonto > 0 && lineTax === 0) {
              total += impMonto;
            }
          }
        }
      }
    }
    
    return total;
  } catch (e) {
    logError('Error parsing impuestos:', e);
    return 0;
  }
}

// =============================================================
// PARSE EXONERATIONS: Complete parsing from XML
// =============================================================
function parseExoneracionesTotal(xmlData: any): number {
  if (!xmlData) return 0;
  
  try {
    const resumen = xmlData.resumen_factura || xmlData.ResumenFactura || xmlData;
    return parseFloat(
      resumen.TotalExoneracion || 
      resumen.total_exoneracion || 
      resumen.totalExoneracion ||
      '0'
    );
  } catch (e) {
    return 0;
  }
}

// =============================================================
// PARSE SUBTOTAL: ALWAYS sum from detail lines for accuracy
// The resumen.subTotal field can be incorrect for multi-line invoices
// with different tax rates (GTI format issue)
// Also handles credit notes with negative amounts correctly
// =============================================================
function parseSubtotal(xmlData: any): number {
  if (!xmlData) return 0;
  
  try {
    // CRITICAL FIX: Always sum from detail lines first if available
    // This handles GTI invoices where subTotal only shows last line
    const detalle = xmlData.detalle || xmlData.detalles || xmlData.DetalleServicio || [];
    const detalleArray = Array.isArray(detalle) ? detalle : [detalle];
    
    if (detalleArray.length > 0 && detalleArray[0]) {
      let lineSubtotal = 0;
      for (const item of detalleArray) {
        if (!item) continue;
        // Use subtotal or montoTotal from each line (before tax)
        // IMPORTANT: Use absolute value since some systems store negative amounts for credit notes
        const amount = parseFloat(
          item.subtotal || 
          item.Subtotal || 
          item.montoTotal ||
          item.MontoTotal ||
          item.SubTotal ||
          item.baseImponible ||
          item.BaseImponible ||
          '0'
        );
        lineSubtotal += Math.abs(amount);
      }
      
      if (lineSubtotal > 0) {
        log(`📊 Subtotal calculado de ${detalleArray.length} líneas: ${lineSubtotal.toFixed(2)}`);
        return lineSubtotal;
      }
    }
    
    // Fallback: Try from resumen fields
    const resumen = xmlData.resumen_factura || xmlData.ResumenFactura || xmlData;
    
    const subtotal = parseFloat(
      resumen.TotalVentaNeta || 
      resumen.total_venta_neta || 
      resumen.totalVentaNeta ||
      resumen.TotalMercanciasServicios ||
      resumen.total_mercancias_servicios ||
      resumen.TotalVenta ||
      resumen.total_venta ||
      resumen.totalVenta ||
      resumen.SubTotal ||
      resumen.subTotal ||
      resumen.subtotal ||
      '0'
    );
    
    return Math.abs(subtotal);
  } catch (e) {
    logError('Error parsing subtotal:', e);
    return 0;
  }
}

// =============================================================
// CALCULATE TOTAL FROM LINE ITEMS: Sum montoTotalLinea
// This is the most reliable way to get the true total for validation
// montoTotalLinea includes subtotal + taxes for each line
// =============================================================
function calculateTotalFromLines(xmlData: any): { total: number; subtotal: number; tax: number; lineCount: number } {
  if (!xmlData) return { total: 0, subtotal: 0, tax: 0, lineCount: 0 };
  
  const detalle = xmlData.detalle || xmlData.detalles || xmlData.DetalleServicio || [];
  const detalleArray = Array.isArray(detalle) ? detalle : (detalle ? [detalle] : []);
  
  let totalLines = 0;
  let subtotalLines = 0;
  let taxLines = 0;
  let processedLines = 0;
  
  for (const item of detalleArray) {
    if (!item) continue;
    processedLines++;
    
    // MontoTotalLinea is the total for the line (subtotal + tax)
    const montoTotalLinea = parseFloat(
      item.montoTotalLinea || 
      item.MontoTotalLinea || 
      '0'
    );
    
    // Subtotal/BaseImponible is the pre-tax amount
    const lineSubtotal = parseFloat(
      item.subtotal || 
      item.Subtotal || 
      item.montoTotal ||
      item.MontoTotal ||
      item.baseImponible ||
      item.BaseImponible ||
      '0'
    );
    
    // Tax for this line
    const lineTax = parseFloat(
      item.impuestoNeto || 
      item.ImpuestoNeto || 
      item.montoImpuesto || 
      item.MontoImpuesto || 
      '0'
    );
    
    // Use absolute values since credit notes may have negative amounts
    totalLines += Math.abs(montoTotalLinea);
    subtotalLines += Math.abs(lineSubtotal);
    taxLines += Math.abs(lineTax);
  }
  
  logInfo(`📊 calculateTotalFromLines: ${processedLines}/${detalleArray.length} líneas procesadas`);
  logInfo(`📊 Sumas: Total=${totalLines.toFixed(2)}, Subtotal=${subtotalLines.toFixed(2)}, Impuesto=${taxLines.toFixed(2)}`);
  
  return { total: totalLines, subtotal: subtotalLines, tax: taxLines, lineCount: processedLines };
}

// =============================================================
// VALIDATE TOTALS: CRITICAL - Block if totals don't match
// Handles Costa Rican invoice edge cases:
// - Standard: TotalComprobante = Subtotal + Impuestos - Descuentos
// - Exonerado/Asumido: TotalComprobante = Subtotal (impuesto NO se suma al total)
// - Credit Notes: Amounts may be stored as negative
// =============================================================
function validateTotalsStrict(xmlData: any, docTotalAmount: number, isCreditNote: boolean): TotalsValidation {
  const errors: string[] = [];
  
  // Use absolute value for XML total (credit notes are negative)
  const resumen = xmlData?.resumen_factura || xmlData?.ResumenFactura || xmlData || {};
  const rawXmlTotal = parseFloat(
    resumen.TotalComprobante || 
    resumen.total_comprobante || 
    resumen.totalComprobante ||
    docTotalAmount.toString()
  );
  const xmlTotal = Math.abs(rawXmlTotal);
  
  // Use 1.00 tolerance (1 colón/cent) for rounding differences  
  const tolerance = 1.0;
  
  // Parse OtrosCargos FIRST (important for GTI format where this is stored as flat field)
  const otrosCargos = parseOtrosCargosComplete(xmlData);
  let totalOtrosCargos = otrosCargos.reduce((sum, c) => sum + c.monto, 0);
  
  // ALSO check for flat totalOtrosCargos field directly (GTI format stores it this way)
  if (totalOtrosCargos === 0) {
    const flatOtrosCargos = parseFloat(
      xmlData?.totalOtrosCargos || 
      xmlData?.TotalOtrosCargos ||
      xmlData?.total_otros_cargos ||
      '0'
    );
    if (flatOtrosCargos > 0) {
      totalOtrosCargos = flatOtrosCargos;
      logInfo(`📦 OtrosCargos encontrado en campo plano: ${totalOtrosCargos.toFixed(2)}`);
    }
  }
  
  // Check if we have detail lines
  const detalle = xmlData?.detalle || xmlData?.detalles || xmlData?.DetalleServicio;
  const hasDetailLines = detalle && Array.isArray(detalle) && detalle.length > 0;
  
  logInfo(`📋 Validación: ${hasDetailLines ? detalle.length + ' líneas' : 'Sin líneas detalle'}, OtrosCargos=${totalOtrosCargos.toFixed(2)}`);
  
  // PRIMARY VALIDATION: Sum montoTotalLinea from all lines
  // This is the most reliable method as montoTotalLinea = baseImponible + impuesto for each line
  // CRITICAL: montoTotalLinea ALREADY has discounts applied (baseImponible = subtotal - descuento)
  // So we should NOT subtract totalDescuentos again!
  if (hasDetailLines) {
    const lineCalc = calculateTotalFromLines(xmlData);
    const totalDescuentos = parseDescuentosTotal(xmlData);
    
    logInfo(`📊 Cálculo líneas: Total=${lineCalc.total.toFixed(2)}, Subtotal=${lineCalc.subtotal.toFixed(2)}, Tax=${lineCalc.tax.toFixed(2)}, Líneas=${lineCalc.lineCount}`);
    logInfo(`📊 Descuentos totales: ${totalDescuentos.toFixed(2)}, OtrosCargos: ${totalOtrosCargos.toFixed(2)}`);
    
    // If montoTotalLinea is available and > 0, use it as primary validation
    // montoTotalLinea already includes: (subtotal - descuento) + impuesto
    // So we just add OtrosCargos (shipping, fees, etc.) - NO need to subtract discounts!
    if (lineCalc.total > 0) {
      // CORRECT FORMULA: montoTotalLinea sums + OtrosCargos = TotalComprobante
      // Discounts are ALREADY embedded in baseImponible/montoTotalLinea
      const calculatedFromLines = lineCalc.total + totalOtrosCargos;
      const lineDifference = Math.abs(calculatedFromLines - xmlTotal);
      
      logInfo(`📊 Validación líneas (SIN restar descuentos): ${calculatedFromLines.toFixed(2)} vs XML ${xmlTotal.toFixed(2)} (diff: ${lineDifference.toFixed(2)})`);
      
      if (lineDifference <= tolerance) {
        // Perfect match using line totals
        return {
          valid: true,
          xmlTotal,
          calculatedTotal: calculatedFromLines,
          difference: lineDifference,
          breakdown: {
            subtotal: lineCalc.subtotal,
            totalImpuestos: lineCalc.tax,
            totalDescuentos,
            totalOtrosCargos,
            totalExoneraciones: 0
          },
          errors: []
        };
      }
      
      // FALLBACK: Some older XMLs might need discount subtracted
      // (if montoTotalLinea was calculated from subtotal WITHOUT discount applied first)
      const calculatedWithDiscounts = lineCalc.total + totalOtrosCargos - totalDescuentos;
      const withDiscountsDiff = Math.abs(calculatedWithDiscounts - xmlTotal);
      
      logInfo(`📊 Validación líneas (CON descuentos): ${calculatedWithDiscounts.toFixed(2)} vs XML ${xmlTotal.toFixed(2)} (diff: ${withDiscountsDiff.toFixed(2)})`);
      
      if (withDiscountsDiff <= tolerance) {
        return {
          valid: true,
          xmlTotal,
          calculatedTotal: calculatedWithDiscounts,
          difference: withDiscountsDiff,
          breakdown: {
            subtotal: lineCalc.subtotal,
            totalImpuestos: lineCalc.tax,
            totalDescuentos,
            totalOtrosCargos,
            totalExoneraciones: 0
          },
          errors: []
        };
      }
    }
    
    // FALLBACK: Try with subtotal + tax calculation
    if (lineCalc.subtotal > 0) {
      const calculatedStandard = lineCalc.subtotal + lineCalc.tax + totalOtrosCargos - totalDescuentos;
      const standardDiff = Math.abs(calculatedStandard - xmlTotal);
      
      // Also try exempt case (taxes not added)
      const calculatedExempt = lineCalc.subtotal + totalOtrosCargos - totalDescuentos;
      const exemptDiff = Math.abs(calculatedExempt - xmlTotal);
      
      logInfo(`📊 Fallback: Standard=${calculatedStandard.toFixed(2)} (diff:${standardDiff.toFixed(2)}), Exento=${calculatedExempt.toFixed(2)} (diff:${exemptDiff.toFixed(2)})`);
      
      if (standardDiff <= tolerance || exemptDiff <= tolerance) {
        const usedCalc = standardDiff <= tolerance ? calculatedStandard : calculatedExempt;
        return {
          valid: true,
          xmlTotal,
          calculatedTotal: usedCalc,
          difference: Math.min(standardDiff, exemptDiff),
          breakdown: {
            subtotal: lineCalc.subtotal,
            totalImpuestos: lineCalc.tax,
            totalDescuentos,
            totalOtrosCargos,
            totalExoneraciones: 0
          },
          errors: []
        };
      }
      
      // Neither formula matched - report detailed error
      errors.push(`Suma líneas (${lineCalc.total.toFixed(2)}) o Subtotal+Impuesto (${calculatedStandard.toFixed(2)}) no coincide con TotalComprobante (${xmlTotal.toFixed(2)})`);
    }
  }
  
  // SECONDARY VALIDATION: Use parsed summary fields
  const subtotal = parseSubtotal(xmlData);
  const totalImpuestos = Math.abs(parseImpuestosTotal(xmlData));
  const secondaryDescuentos = parseDescuentosTotal(xmlData);
  const totalExoneraciones = parseExoneracionesTotal(xmlData);
  
  // Already have totalOtrosCargos from above, no need to recalculate
  
  // Check for tax exemption/assumption cases
  const taxesExemptFromTotal = totalImpuestos > 0 && Math.abs(xmlTotal - subtotal) < tolerance;
  
  let calculatedTotal: number;
  if (taxesExemptFromTotal) {
    calculatedTotal = subtotal - secondaryDescuentos + totalOtrosCargos;
    log(`📋 Impuesto exonerado/asumido detectado: Total=${xmlTotal}, Subtotal=${subtotal}, Impuesto=${totalImpuestos} (NO suma al total)`);
  } else {
    calculatedTotal = subtotal + totalImpuestos - secondaryDescuentos + totalOtrosCargos - totalExoneraciones;
  }
  
  const difference = Math.abs(calculatedTotal - xmlTotal);
  
  if (difference > tolerance && subtotal > 0) {
    // Try exempt case we might have missed
    const exemptCalc = subtotal - secondaryDescuentos + totalOtrosCargos;
    const exemptDiff = Math.abs(exemptCalc - xmlTotal);
    
    if (exemptDiff > tolerance) {
      errors.push(`Total calculado (${calculatedTotal.toFixed(2)}) ≠ Total XML (${xmlTotal.toFixed(2)}), diferencia: ${difference.toFixed(2)}`);
    }
  }
  
  // Validate document amount matches XML total
  const docDifference = Math.abs(Math.abs(docTotalAmount) - xmlTotal);
  if (docDifference > tolerance) {
    errors.push(`Total documento DB (${Math.abs(docTotalAmount).toFixed(2)}) ≠ Total XML (${xmlTotal.toFixed(2)})`);
  }
  
  return {
    valid: errors.length === 0,
    xmlTotal,
    calculatedTotal,
    difference,
    breakdown: {
      subtotal,
      totalImpuestos,
      totalDescuentos: secondaryDescuentos,
      totalOtrosCargos,
      totalExoneraciones
    },
    errors
  };
}

// Helper: Fetch with retry for rate limiting (429 errors)
const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelay = 2000
): Promise<Response> => {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Check for rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : baseDelay * Math.pow(2, attempt);
        
        if (attempt < maxRetries) {
          logInfo(`⏳ Rate limited (429), waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
          await delay(waitTime);
          continue;
        }
      }
      
      // Check for throttle error in response body
      if (!response.ok) {
        const clonedResponse = response.clone();
        try {
          const errorBody = await clonedResponse.text();
          if (errorBody.includes('ThrottleExceeded') || errorBody.includes('003001')) {
            const waitTime = baseDelay * Math.pow(2, attempt);
            if (attempt < maxRetries) {
              logInfo(`⏳ Throttle exceeded, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
              await delay(waitTime);
              continue;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
      
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const waitTime = baseDelay * Math.pow(2, attempt);
        logInfo(`⏳ Network error, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await delay(waitTime);
        continue;
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    
    // Allow internal calls without auth header (for batch operations)
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const isServiceRole = token === supabaseKey;
      
      if (!isServiceRole) {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          throw new Error("Authentication failed");
        }
        userId = user.id;
      }
    }

    const { organization_id, document_ids } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    logInfo(`📤 Publishing documents for org: ${organization_id}`);

    // Obtener configuración de la organización
    const { data: orgSettings } = await supabase
      .from("organizations")
      .select("settings, name, tax_id")
      .eq("id", organization_id)
      .maybeSingle();
    
    const settings = orgSettings?.settings as any || {};
    const taxHandling = settings?.tax_handling || 'standard';
    const companyTaxId = orgSettings?.tax_id;
    
    // Obtener configuración de default_uses_tax
    // Cuando default_uses_tax = true (o undefined): IVA es impuesto recuperable, se reporta como Tax separado
    // Cuando default_uses_tax = false: IVA es gasto no recuperable, se incluye en el subtotal
    const { data: defaultUsesTaxSetting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("organization_id", organization_id)
      .eq("key", "default_uses_tax")
      .maybeSingle();
    
    // orgDefaultUsesTax = true significa IVA como impuesto recuperable (se resta del total y va como TxnTaxDetail)
    // orgDefaultUsesTax = false significa IVA como gasto (todo el monto va como línea de gasto, sin tax separado)
    const orgDefaultUsesTax = defaultUsesTaxSetting?.value !== 'false';
    
    logInfo(`💰 Organización "${orgSettings?.name}" - IVA: ${orgDefaultUsesTax ? 'Impuesto recuperable (Tax separado)' : 'Gasto no recuperable (incluido en subtotal)'}`);
    logInfo(`   📋 default_uses_tax setting value: "${defaultUsesTaxSetting?.value}" -> orgDefaultUsesTax: ${orgDefaultUsesTax}`);

    // Obtener integración de QuickBooks
    const { data: qboAccount } = await supabase
      .from("integration_accounts")
      .select("credentials")
      .eq("organization_id", organization_id)
      .eq("service_type", "quickbooks")
      .eq("is_active", true)
      .maybeSingle();

    if (!qboAccount) {
      throw new Error("QuickBooks not connected");
    }

    const credentials = qboAccount.credentials as any;
    let accessToken = credentials.access_token;
    const refreshToken = credentials.refresh_token;
    const realmId = credentials.realm_id;
    const expiresAt = credentials.expires_at;

    // Refresh token si está expirado
    if (new Date(expiresAt) < new Date()) {
      logInfo("🔄 Refreshing QuickBooks token");
      const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${Deno.env.get("QBO_CLIENT_ID")}:${Deno.env.get("QBO_CLIENT_SECRET")}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to refresh QuickBooks token");
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;

      await supabase
        .from("integration_accounts")
        .update({
          credentials: {
            ...credentials,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          },
        })
        .eq("organization_id", organization_id)
        .eq("service_type", "quickbooks");
    }

    // Obtener fecha mínima
    const { data: minDateSetting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("organization_id", organization_id)
      .eq("key", "min_publish_date")
      .maybeSingle();
    
    const minDate = minDateSetting?.value || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    logInfo(`📅 Fecha mínima de publicación: ${minDate}`);

    // CLEANUP: Revert documents stuck in 'publishing' for more than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckDocs } = await supabase
      .from("processed_documents")
      .update({ 
        status: "pending", 
        error_message: "Proceso anterior interrumpido - reintentando" 
      })
      .eq("organization_id", organization_id)
      .eq("status", "publishing")
      .lt("updated_at", fiveMinutesAgo)
      .select("id, doc_number");
    
    if (stuckDocs && stuckDocs.length > 0) {
      logInfo(`🔄 Reverted ${stuckDocs.length} document(s) stuck in 'publishing' state`);
    }

    // ATOMIC LOCK: Select and mark documents as 'publishing'
    let findQuery = supabase
      .from("processed_documents")
      .select("id")
      .eq("organization_id", organization_id)
      .is("qbo_entity_id", null)
      .in("status", ["pending", "processed"])
      .gte("issue_date", minDate);

    if (document_ids && document_ids.length > 0) {
      findQuery = findQuery.in("id", document_ids);
    }

    const { data: eligibleDocs, error: findError } = await findQuery.limit(50);

    if (findError) throw findError;

    if (!eligibleDocs || eligibleDocs.length === 0) {
      logInfo(`⚠️ No documents found to publish`);
      return new Response(
        JSON.stringify({ success: true, message: "No documents to publish", published: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const docIdsToProcess = eligibleDocs.map(d => d.id);
    logInfo(`📋 Found ${docIdsToProcess.length} document(s) eligible for publishing`);

    // Atomically update status to 'publishing'
    const { data: lockedDocs, error: lockError } = await supabase
      .from("processed_documents")
      .update({ status: "publishing", error_message: null })
      .in("id", docIdsToProcess)
      .in("status", ["pending", "processed"])
      .select("*");

    if (lockError) throw lockError;

    if (!lockedDocs || lockedDocs.length === 0) {
      logInfo(`⚠️ No documents to publish - all were already locked`);
      return new Response(
        JSON.stringify({ success: true, message: "Documents already being processed", published: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const documents = lockedDocs;
    logInfo(`🔒 Locked ${documents.length} document(s) for publishing`);
    
    const isSingleDocument = documents.length === 1;

    const results = {
      published: 0,
      failed: 0,
      skipped_duplicates: 0,
      blocked_totals: 0,
      errors: [] as any[],
      duplicates: [] as { doc_number: string; qbo_entity_id: string; reason: string }[],
    };

    // =============================================================
    // HELPER: Check duplicate in our tracking table FIRST
    // =============================================================
    const checkDuplicateInTracking = async (claveHacienda: string): Promise<{ isDuplicate: boolean; trackingRecord: any }> => {
      const { data: existing } = await supabase
        .from("qbo_publish_tracking")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("clave_hacienda", claveHacienda)
        .maybeSingle();
      
      if (existing && existing.status === 'published' && existing.qbo_entity_id) {
        return { isDuplicate: true, trackingRecord: existing };
      }
      
      return { isDuplicate: false, trackingRecord: existing };
    };

    // =============================================================
    // HELPER: Check duplicate in QBO (secondary check) - ENHANCED
    // Now also verifies amount matches to prevent false negatives
    // =============================================================
    const checkDuplicateInQBO = async (docNumber: string, vendorId: string | null, expectedAmount: number, isCreditNote: boolean = false): Promise<{ isDuplicate: boolean; entityId: string | null; entityType: string | null; qboAmount?: number; error?: string }> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const qboDocNumber = docNumber.length > 21 
        ? docNumber.substring(docNumber.length - 21)
        : docNumber;
      
      const entityName = isCreditNote ? 'VendorCredit' : 'Bill';
      
      try {
        // Search by DocNumber
        const query = `SELECT * FROM ${entityName} WHERE DocNumber = '${qboDocNumber.replace(/'/g, "\\'")}'`;
        const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const entities = data.QueryResponse?.[entityName] || [];
          
          if (entities.length > 0) {
            // CRITICAL: Must match BOTH vendor AND amount (with tolerance)
            if (vendorId) {
              const matchingEntity = entities.find((entity: any) => {
                const vendorMatches = entity.VendorRef?.value === vendorId;
                const qboTotal = parseFloat(entity.TotalAmt || entity.Balance || '0');
                const amountMatches = Math.abs(qboTotal - Math.abs(expectedAmount)) < 1.0;
                
                logInfo(`   🔍 QBO ${entityName} ID=${entity.Id}: Vendor=${entity.VendorRef?.value} (esperado: ${vendorId}), Total=${qboTotal} (esperado: ${expectedAmount}) -> vendorMatches=${vendorMatches}, amountMatches=${amountMatches}`);
                
                return vendorMatches && amountMatches;
              });
              
              if (matchingEntity) {
                return { 
                  isDuplicate: true, 
                  entityId: matchingEntity.Id, 
                  entityType: entityName,
                  qboAmount: parseFloat(matchingEntity.TotalAmt || '0')
                };
              }
              
              // No exact match found - might be different invoice with same number
              logInfo(`   ⚠️ ${docNumber}: Encontrado en QBO pero NO coincide vendor+monto - se creará nuevo`);
              return { isDuplicate: false, entityId: null, entityType: null };
            }
            
            // No vendor ID - just check first entity amount
            const firstEntity = entities[0];
            const qboTotal = parseFloat(firstEntity.TotalAmt || '0');
            const amountMatches = Math.abs(qboTotal - Math.abs(expectedAmount)) < 1.0;
            
            if (amountMatches) {
              return { isDuplicate: true, entityId: firstEntity.Id, entityType: entityName, qboAmount: qboTotal };
            }
            
            logInfo(`   ⚠️ ${docNumber}: Existe en QBO pero monto no coincide (QBO: ${qboTotal}, Esperado: ${expectedAmount})`);
            return { isDuplicate: false, entityId: null, entityType: null };
          }
        }
        return { isDuplicate: false, entityId: null, entityType: null };
      } catch (e) {
        clearTimeout(timeoutId);
        if (e instanceof Error && e.name === 'AbortError') {
          return { isDuplicate: false, entityId: null, entityType: null, error: `Timeout verificando duplicado` };
        }
        return { isDuplicate: false, entityId: null, entityType: null, error: `Error: ${e}` };
      }
    };

    // =============================================================
    // HELPER: Register in tracking table
    // =============================================================
    const registerInTracking = async (doc: any, status: string, qboEntityId?: string | null, qboEntityType?: string | null, errorMessage?: string) => {
      const claveHacienda = doc.doc_key || doc.xml_data?.clave || doc.xml_data?.Clave || doc.doc_number;
      const emisorId = doc.supplier_tax_id || doc.xml_data?.emisor?.identificacion?.numero || '';
      const receptorId = companyTaxId || doc.xml_data?.receptor?.identificacion?.numero || '';
      
      const qboDocNumber = doc.doc_number.length > 21 
        ? doc.doc_number.substring(doc.doc_number.length - 21)
        : doc.doc_number;
      
      try {
        await supabase
          .from("qbo_publish_tracking")
          .upsert({
            organization_id: organization_id,
            clave_hacienda: claveHacienda,
            doc_number: doc.doc_number,
            emisor_identificacion: emisorId,
            receptor_identificacion: receptorId,
            document_id: doc.id,
            qbo_entity_id: qboEntityId || null,
            qbo_entity_type: qboEntityType || null,
            qbo_doc_number: qboDocNumber,
            total_amount: doc.total_amount,
            currency: doc.currency || 'CRC',
            supplier_name: doc.supplier_name,
            status: status,
            error_message: errorMessage || null,
            published_at: status === 'published' ? new Date().toISOString() : null,
          }, {
            onConflict: 'organization_id,clave_hacienda'
          });
      } catch (e) {
        logError(`Error registering in tracking:`, e);
      }
    };

    // =============================================================
    // HELPER: Find or create vendor
    // =============================================================
    const findOrCreateVendor = async (supplierName: string, supplierTaxId: string, currency: string = 'CRC') => {
      let baseNormalizedName = supplierName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
      
      const isUSD = currency === 'USD';
      let vendorDisplayName = baseNormalizedName;
      
      if (isUSD) {
        vendorDisplayName = baseNormalizedName.replace(/\s*USD$/i, '').trim();
        vendorDisplayName = `${vendorDisplayName} USD`;
      }
      
      vendorDisplayName = vendorDisplayName.substring(0, 100).trim();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      try {
        const searchQuery = `SELECT * FROM Vendor WHERE DisplayName = '${vendorDisplayName.replace(/'/g, "\\'")}'`;
        const searchUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(searchQuery)}`;

        const searchResponse = await fetch(searchUrl, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.QueryResponse?.Vendor?.length > 0) {
            return searchData.QueryResponse.Vendor[0].Id;
          }
        }
      } catch (e) {
        clearTimeout(timeoutId);
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error(`Timeout buscando proveedor "${vendorDisplayName}"`);
        }
        throw e;
      }
      
      // Create vendor
      logInfo(`➕ Creating vendor: ${vendorDisplayName}`);
      
      const createController = new AbortController();
      const createTimeoutId = setTimeout(() => createController.abort(), 10000);
      
      try {
        const vendorPayload: any = { DisplayName: vendorDisplayName };
        if (isUSD) {
          vendorPayload.CurrencyRef = { value: 'USD', name: 'United States Dollar' };
        }
        
        const createResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(vendorPayload),
            signal: createController.signal
          }
        );

        clearTimeout(createTimeoutId);

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          
          // Check for duplicate error
          try {
            const errorJson = JSON.parse(errorText);
            const qboError = errorJson?.Fault?.Error?.[0];
            if (qboError?.code === '6240' || qboError?.Detail?.includes('Id=')) {
              const idMatch = qboError.Detail?.match(/Id=(\d+)/);
              if (idMatch) {
                return idMatch[1];
              }
            }
          } catch {}
          
          throw new Error(`No se pudo crear proveedor: ${errorText.substring(0, 200)}`);
        }

        const vendorData = await createResponse.json();
        return vendorData.Vendor.Id;
      } catch (e) {
        clearTimeout(createTimeoutId);
        throw e;
      }
    };

    // =============================================================
    // HELPER: Get account ID by code
    // =============================================================
    const getAccountIdByCode = async (accountCode: string): Promise<string | null> => {
      try {
        const query = `SELECT Id, Name, AcctNum, AccountType FROM Account MAXRESULTS 1000`;
        const queryUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
        
        const response = await fetchWithRetry(queryUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) return null;

        const data = await response.json();
        const allAccounts = data.QueryResponse?.Account || [];
        
        const searchCode = accountCode.trim();
        
        // Check if it's a pure number (internal QB ID)
        if (/^\d{1,3}$/.test(searchCode)) {
          const byId = allAccounts.find((acc: any) => acc.Id === searchCode);
          if (byId) return byId.Id;
        }
        
        // Extract code part
        const codeOnly = searchCode.split(/[\s·\-:]/)[0].trim();
        
        // Exact match by AcctNum
        let account = allAccounts.find((acc: any) => acc.AcctNum === codeOnly);
        if (account) return account.Id;
        
        // Match by name starting with code
        account = allAccounts.find((acc: any) => {
          const name = acc.Name || '';
          return name.startsWith(codeOnly + ' ') || name.startsWith(codeOnly + '-');
        });
        if (account) return account.Id;
        
        // Fallback: search by name containing
        account = allAccounts.find((acc: any) => {
          const name = (acc.Name || '').toLowerCase();
          return name.includes(searchCode.toLowerCase());
        });
        if (account) return account.Id;
        
        return null;
      } catch (e) {
        logError('Error getting account:', e);
        return null;
      }
    };

    // =============================================================
    // HELPER: Get TaxCode
    // =============================================================
    let taxCodesCache: any[] | null = null;
    const getTaxCodeRef = async (taxRate: number): Promise<string | null> => {
      if (!taxCodesCache) {
        try {
          const query = `SELECT Id, Name, Description FROM TaxCode WHERE Active = true MAXRESULTS 100`;
          const response = await fetchWithRetry(
            `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`,
            {
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/json",
              },
            }
          );
          
          if (response.ok) {
            const data = await response.json();
            taxCodesCache = data.QueryResponse?.TaxCode || [];
          } else {
            taxCodesCache = [];
          }
        } catch {
          taxCodesCache = [];
        }
      }
      
      const rate = Math.round(taxRate);
      
      for (const taxCode of taxCodesCache!) {
        const name = (taxCode.Name || "").toLowerCase();
        
        if (rate === 0) {
          if (name.includes('no vat') || name.includes('exento') || name.includes('out of scope')) {
            return taxCode.Id;
          }
        } else {
          if (name.includes(`${rate}%`) || name.includes(`(${rate}%)`)) {
            return taxCode.Id;
          }
        }
      }
      
      // Return first no-tax code as fallback
      for (const taxCode of taxCodesCache!) {
        const name = (taxCode.Name || "").toLowerCase();
        if (name.includes('no vat') || name.includes('non')) {
          return taxCode.Id;
        }
      }
      
      return null;
    };

    const batchStartTime = Date.now();

    // =============================================================
    // MAIN PROCESSING FUNCTION
    // =============================================================
    const processDocument = async (doc: any, index: number, total: number) => {
      const progress = `[${index + 1}/${total}]`;
      const startTime = Date.now();
      
      try {
        log(`${progress} 📄 Processing ${doc.doc_number}`);
        
        const xmlData = doc.xml_data as any || {};
        const claveHacienda = doc.doc_key || xmlData.clave || xmlData.Clave || doc.doc_number;
        
        // =============================================================
        // STEP 1: CHECK DUPLICATE IN TRACKING TABLE (PRIMARY CHECK)
        // =============================================================
        const trackingCheck = await checkDuplicateInTracking(claveHacienda);
        
        if (trackingCheck.isDuplicate) {
          logInfo(`🚫 DUPLICATE BLOCKED: ${doc.doc_number} - Already published as ${trackingCheck.trackingRecord.qbo_entity_type} ID: ${trackingCheck.trackingRecord.qbo_entity_id}`);
          
          // Update document to reflect it's already published
          await supabase
            .from("processed_documents")
            .update({
              qbo_entity_id: trackingCheck.trackingRecord.qbo_entity_id,
              qbo_entity_type: trackingCheck.trackingRecord.qbo_entity_type,
              status: "published",
              error_message: `Ya publicado (tracking ID: ${trackingCheck.trackingRecord.id})`,
            })
            .eq("id", doc.id);
          
          return { 
            success: true, 
            docNumber: doc.doc_number, 
            skipped: true, 
            reason: `Ya existe en tracking (QBO ID: ${trackingCheck.trackingRecord.qbo_entity_id})`,
            qbo_entity_id: trackingCheck.trackingRecord.qbo_entity_id 
          };
        }
        
        // =============================================================
        // STEP 2: DETECT DOCUMENT TYPE
        // =============================================================
        const docType = doc.doc_type || xmlData.tipo_documento || '';
        const isCreditNote = xmlData.esNotaCredito === true || 
                           docType === 'NotaCreditoElectronica' || 
                           docType === 'NC' || 
                           docType === '03';
        
        // Filter tiquetes
        if (docType === '04' || docType === 'TE') {
          await registerInTracking(doc, 'blocked_type', null, null, 'Tiquete electrónico');
          return { success: false, docNumber: doc.doc_number, error: 'Tiquete electrónico (no se procesa)' };
        }
        
        // Filter rejected invoices
        const situacion = xmlData.situacion || xmlData.mensaje_receptor;
        if (situacion === '3' || situacion === 3) {
          await registerInTracking(doc, 'blocked_rejected', null, null, 'Factura rechazada');
          return { success: false, docNumber: doc.doc_number, error: 'Factura rechazada por receptor' };
        }
        
        // =============================================================
        // STEP 3: VALIDATE TOTALS (STRICT)
        // =============================================================
        const totalsValidation = validateTotalsStrict(xmlData, doc.total_amount, isCreditNote);
        
        if (!totalsValidation.valid) {
          const errorMsg = `TOTALES NO COINCIDEN: XML=${totalsValidation.xmlTotal.toFixed(2)}, Calculado=${totalsValidation.calculatedTotal.toFixed(2)}, Diff=${totalsValidation.difference.toFixed(2)}. Desglose: Subtotal=${totalsValidation.breakdown.subtotal.toFixed(2)}, Impuestos=${totalsValidation.breakdown.totalImpuestos.toFixed(2)}, Descuentos=${totalsValidation.breakdown.totalDescuentos.toFixed(2)}, OtrosCargos=${totalsValidation.breakdown.totalOtrosCargos.toFixed(2)}`;
          
          logError(`❌ ${doc.doc_number}: ${errorMsg}`);
          
          await registerInTracking(doc, 'error_totals', null, null, errorMsg);
          
          await supabase
            .from("processed_documents")
            .update({
              status: "error",
              error_message: errorMsg.substring(0, 500),
            })
            .eq("id", doc.id);
          
          return { success: false, docNumber: doc.doc_number, error: errorMsg };
        }
        
        logInfo(`✅ ${doc.doc_number}: Totales validados correctamente (Total: ${totalsValidation.xmlTotal.toFixed(2)})`);
        
        // =============================================================
        // STEP 4: FIND OR CREATE VENDOR
        // =============================================================
        const vendorId = await findOrCreateVendor(doc.supplier_name, doc.supplier_tax_id, doc.currency);
        
        // =============================================================
        // STEP 5: CHECK DUPLICATE IN QBO (SECONDARY CHECK - with amount validation)
        // =============================================================
        const qboDuplicateCheck = await checkDuplicateInQBO(doc.doc_number, vendorId, doc.total_amount, isCreditNote);
        
        if (qboDuplicateCheck.error) {
          await registerInTracking(doc, 'error', null, null, qboDuplicateCheck.error);
          await supabase
            .from("processed_documents")
            .update({ status: "error", error_message: qboDuplicateCheck.error })
            .eq("id", doc.id);
          return { success: false, docNumber: doc.doc_number, error: qboDuplicateCheck.error };
        }
        
        if (qboDuplicateCheck.isDuplicate && qboDuplicateCheck.entityId) {
          logInfo(`✓ ${doc.doc_number}: Found in QBO (${qboDuplicateCheck.entityType} ID: ${qboDuplicateCheck.entityId}) - registering and marking published`);
          
          await registerInTracking(doc, 'published', qboDuplicateCheck.entityId, qboDuplicateCheck.entityType);
          
          await supabase
            .from("processed_documents")
            .update({
              qbo_entity_id: qboDuplicateCheck.entityId,
              qbo_entity_type: qboDuplicateCheck.entityType,
              status: "published",
              error_message: `Ya existía en QBO (ID: ${qboDuplicateCheck.entityId})`,
            })
            .eq("id", doc.id);
          
          return { 
            success: true, 
            docNumber: doc.doc_number, 
            skipped: true, 
            reason: `Ya existe en QBO`,
            qbo_entity_id: qboDuplicateCheck.entityId 
          };
        }
        
        // =============================================================
        // STEP 6: GET ACCOUNT
        // =============================================================
        let accountCode = doc.default_account_ref;
        
        // Check for auto_unclassified_account setting first
        if (!accountCode) {
          const { data: autoUnclassifiedSetting } = await supabase
            .from("system_settings")
            .select("value")
            .eq("organization_id", organization_id)
            .eq("key", "auto_unclassified_account")
            .maybeSingle();
          
          if (autoUnclassifiedSetting?.value) {
            accountCode = autoUnclassifiedSetting.value;
            console.log(`🎯 [AUTO-UNCLASSIFIED] Using auto_unclassified_account: ${accountCode}`);
          }
        }
        
        if (!accountCode) {
          // Try vendor_defaults
          const { data: vendorDefault } = await supabase
            .from("vendor_defaults")
            .select("default_account_ref")
            .eq("organization_id", organization_id)
            .ilike("vendor_name", doc.supplier_name)
            .maybeSingle();
          
          if (vendorDefault?.default_account_ref) {
            accountCode = vendorDefault.default_account_ref;
          }
        }
        
        if (!accountCode) {
          // Try vendors table
          const { data: vendor } = await supabase
            .from("vendors")
            .select("default_account_ref")
            .eq("organization_id", organization_id)
            .ilike("vendor_name", doc.supplier_name)
            .maybeSingle();
          
          if (vendor?.default_account_ref) {
            accountCode = vendor.default_account_ref;
          }
        }
        
        if (!accountCode) {
          await registerInTracking(doc, 'pending_config', null, null, 'Sin cuenta contable');
          await supabase
            .from("processed_documents")
            .update({ status: "pending_config", error_message: "Proveedor sin cuenta contable configurada" })
            .eq("id", doc.id);
          return { success: false, docNumber: doc.doc_number, error: "No account configured" };
        }
        
        // Extract account code if it has description
        const extractedCode = accountCode.includes(' - ') 
          ? accountCode.split(' - ')[0].trim()
          : accountCode.split(' ')[0].trim();
        
        const accountRef = await getAccountIdByCode(extractedCode);
        
        if (!accountRef) {
          const errMsg = `Cuenta ${accountCode} no existe en QuickBooks`;
          await registerInTracking(doc, 'error', null, null, errMsg);
          await supabase
            .from("processed_documents")
            .update({ status: "error", error_message: errMsg })
            .eq("id", doc.id);
          return { success: false, docNumber: doc.doc_number, error: errMsg };
        }
        
        // =============================================================
        // STEP 7: BUILD LINES FROM XML
        // =============================================================
        const lines: any[] = [];
        const includeTaxInLines = taxHandling === 'included_in_line_items';
        
        // Parse detail lines
        if (xmlData.detalle && Array.isArray(xmlData.detalle) && xmlData.detalle.length > 0) {
          for (const item of xmlData.detalle) {
            const cantidad = parseFloat(item.cantidad) || 1;
            let precioUnitario = parseFloat(item.precioUnitario) || 0;
            let subtotal = parseFloat(item.subtotal) || (cantidad * precioUnitario);
            
            if (isCreditNote) {
              subtotal = -Math.abs(subtotal);
            }
            
            let montoImpuesto = 0;
            let tasaImpuesto = 0;
            
            if (item.impuestos && Array.isArray(item.impuestos)) {
              const ivaImpuesto = item.impuestos.find((imp: any) => imp.codigo === '01');
              if (ivaImpuesto) {
                tasaImpuesto = parseFloat(ivaImpuesto.tarifa) || 0;
                montoImpuesto = parseFloat(ivaImpuesto.monto) || 0;
                if (isCreditNote) montoImpuesto = -Math.abs(montoImpuesto);
              }
            } else {
              tasaImpuesto = parseFloat(item.tarifa) || 0;
              montoImpuesto = parseFloat(item.montoImpuesto) || 0;
              if (isCreditNote) montoImpuesto = -Math.abs(montoImpuesto);
            }
            
            let lineAmount = subtotal;
            if (includeTaxInLines && Math.abs(montoImpuesto) > 0) {
              lineAmount = subtotal + montoImpuesto;
            }
            
            if (Math.abs(lineAmount) > 0.001) {
              const descripcion = item.descripcion || item.detalle || 'Línea de factura';
              const codigo = item.codigoProducto || item.codigo || '';
              
              let descripcionFinal = codigo ? `[${codigo}] ${descripcion}` : descripcion;
              if (cantidad > 1) descripcionFinal += ` - Cant: ${cantidad}`;
              
              const lineDetail: any = {
                DetailType: "AccountBasedExpenseLineDetail",
                Amount: Math.abs(lineAmount), // QBO uses positive amounts
                Description: descripcionFinal.substring(0, 4000),
                AccountBasedExpenseLineDetail: {
                  AccountRef: { value: accountRef },
                },
              };
              
              const taxCodeId = await getTaxCodeRef(includeTaxInLines ? 0 : tasaImpuesto);
              if (taxCodeId) {
                lineDetail.AccountBasedExpenseLineDetail.TaxCodeRef = { value: taxCodeId };
              }
              
              lines.push(lineDetail);
            }
          }
        }
        
        // =============================================================
        // STEP 8: ADD OTROS CARGOS AS LINES
        // =============================================================
        const otrosCargos = parseOtrosCargosComplete(xmlData);
        
        if (otrosCargos.length > 0) {
          logInfo(`📦 ${doc.doc_number}: ${otrosCargos.length} OtrosCargos detectados: ${otrosCargos.map(c => `${c.detalle}=${c.monto}`).join(', ')}`);
          
          for (const cargo of otrosCargos) {
            const cargoAmount = isCreditNote ? -Math.abs(cargo.monto) : cargo.monto;
            
            if (Math.abs(cargoAmount) > 0.001) {
              const cargoLine: any = {
                DetailType: "AccountBasedExpenseLineDetail",
                Amount: Math.abs(cargoAmount),
                Description: `${cargo.detalle} (${getCargoDescription(cargo.tipoDocumento)})`.substring(0, 4000),
                AccountBasedExpenseLineDetail: {
                  AccountRef: { value: accountRef },
                },
              };
              
              const cargoTaxCodeId = await getTaxCodeRef(0);
              if (cargoTaxCodeId) {
                cargoLine.AccountBasedExpenseLineDetail.TaxCodeRef = { value: cargoTaxCodeId };
              }
              
              lines.push(cargoLine);
            }
          }
        }
        
        // Fallback: single line from totals
        if (lines.length === 0) {
          // effectiveUsesTax = true: IVA como impuesto recuperable -> subtotal = total - tax, y tax va aparte
          // effectiveUsesTax = false: IVA como gasto -> subtotal = total (todo va como gasto, sin tax)
          const effectiveUsesTax = (doc.uses_tax !== false) && orgDefaultUsesTax && !includeTaxInLines;
          
          let subtotal: number;
          if (effectiveUsesTax) {
            // IVA recuperable: el subtotal es el monto SIN el impuesto (el impuesto irá en TxnTaxDetail)
            subtotal = Math.abs(doc.total_amount) - Math.abs(doc.total_tax || 0);
            logInfo(`   🧾 ${doc.doc_number}: IVA RECUPERABLE - Subtotal: ${subtotal.toFixed(2)} (Total ${doc.total_amount} - Tax ${doc.total_tax})`);
          } else {
            // IVA como gasto: el subtotal ES el total completo (el IVA ya está incluido como gasto)
            subtotal = Math.abs(doc.total_amount);
            logInfo(`   🧾 ${doc.doc_number}: IVA COMO GASTO - Subtotal: ${subtotal.toFixed(2)} (Total completo, sin tax separado)`);
          }
          
          const fallbackLine: any = {
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: subtotal,
            Description: `${isCreditNote ? 'Nota de Crédito' : 'Factura'} ${doc.doc_number} - ${doc.supplier_name}`,
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: accountRef },
            },
          };
          
          // Solo aplicar código de impuesto si es IVA recuperable
          const fallbackTaxCodeId = await getTaxCodeRef(effectiveUsesTax && doc.total_tax > 0 ? 13 : 0);
          if (fallbackTaxCodeId) {
            fallbackLine.AccountBasedExpenseLineDetail.TaxCodeRef = { value: fallbackTaxCodeId };
          }
          
          lines.push(fallbackLine);
        }
        
        // =============================================================
        // STEP 9: REGISTER IN TRACKING BEFORE QBO CALL (status: pending)
        // =============================================================
        await registerInTracking(doc, 'pending');
        
        // =============================================================
        // STEP 10: FINAL AMOUNT VALIDATION & TAX EXEMPTION DETECTION
        // =============================================================
        const linesTotalAmount = lines.reduce((sum, line) => sum + (parseFloat(line.Amount) || 0), 0);
        const documentCurrency = doc.currency || xmlData.moneda || 'CRC';
        
        // Detect tax exemption case: when subtotal = total but tax > 0
        // This means the tax is NOT added to the total (exonerado/asumido)
        const xmlTotal = parseFloat(xmlData.totalComprobante || xmlData.TotalComprobante || doc.total_amount);
        const xmlSubtotal = parseFloat(xmlData.subTotal || xmlData.SubTotal || '0');
        const xmlTax = parseFloat(doc.total_tax as any) || 0;
        const isTaxExempt = xmlTax > 0 && Math.abs(xmlTotal - xmlSubtotal) < 1.0;
        
        // Solo reportar TxnTaxDetail si el IVA es recuperable Y NO está exonerado
        const effectiveUsesTax = (doc.uses_tax !== false) && orgDefaultUsesTax && !includeTaxInLines && !isTaxExempt;
        const totalTax = effectiveUsesTax ? xmlTax : 0;
        
        if (isTaxExempt) {
          logInfo(`   📋 ${doc.doc_number}: IMPUESTO EXONERADO detectado - Tax=${xmlTax.toFixed(2)} NO se suma al total`);
        }
        
        // CRITICAL: Validate that lines total + tax = document total (with tolerance)
        const expectedQBOTotal = effectiveUsesTax 
          ? linesTotalAmount + totalTax
          : linesTotalAmount;
        const documentTotal = Math.abs(doc.total_amount);
        const qboTotalDiff = Math.abs(expectedQBOTotal - documentTotal);
        
        if (qboTotalDiff > 2.0) { // 2 colones tolerance for rounding
          const errorMsg = `MONTO INCORRECTO: Lines=${linesTotalAmount.toFixed(2)} + Tax=${totalTax.toFixed(2)} = ${expectedQBOTotal.toFixed(2)}, pero documento=${documentTotal.toFixed(2)}. Diferencia: ${qboTotalDiff.toFixed(2)}`;
          logError(`❌ ${doc.doc_number}: ${errorMsg}`);
          
          await registerInTracking(doc, 'error_amount_mismatch', null, null, errorMsg);
          await supabase
            .from("processed_documents")
            .update({ status: "error", error_message: errorMsg.substring(0, 500) })
            .eq("id", doc.id);
          
          return { success: false, docNumber: doc.doc_number, error: errorMsg };
        }
        
        logInfo(`   📊 ${doc.doc_number}: Validación final OK - Lines=${linesTotalAmount.toFixed(2)}, Tax=${totalTax.toFixed(2)}, Total=${expectedQBOTotal.toFixed(2)} (esperado: ${documentTotal.toFixed(2)})`);
        
        // =============================================================
        // STEP 11: CREATE BILL OR VENDORCREDIT IN QBO
        // =============================================================
        const qboDocNumber = doc.doc_number.length > 21 
          ? doc.doc_number.substring(doc.doc_number.length - 21)
          : doc.doc_number;
        
        logInfo(`   📊 ${doc.doc_number}: effectiveUsesTax=${effectiveUsesTax}, totalTax para QBO=${totalTax.toFixed(2)}`);
        
        let entityId: string;
        let entityType: string;
        
        await delay(1000);
        
        if (isCreditNote) {
          // VendorCredit
          const vendorCreditPayload: any = {
            VendorRef: { value: vendorId },
            TxnDate: doc.issue_date,
            DocNumber: qboDocNumber,
            Line: lines,
            PrivateNote: `Nota de Crédito - Clave: ${claveHacienda}\nProveedor: ${doc.supplier_name}`,
            GlobalTaxCalculation: includeTaxInLines ? "TaxInclusive" : "TaxExcluded",
          };
          
          if (documentCurrency === 'USD') {
            vendorCreditPayload.CurrencyRef = { value: "USD" };
            const exchangeRate = parseFloat(xmlData?.resumen_factura?.tipoCambio || xmlData?.tipoCambio || '1');
            if (exchangeRate > 1) vendorCreditPayload.ExchangeRate = exchangeRate;
          }
          
          if (effectiveUsesTax && totalTax > 0) {
            vendorCreditPayload.TxnTaxDetail = { TotalTax: Math.abs(totalTax) };
          }
          
          const vcResponse = await fetchWithRetry(
            `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendorcredit`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(vendorCreditPayload),
            }
          );
          
          if (!vcResponse.ok) {
            const errorText = await vcResponse.text();
            await registerInTracking(doc, 'error', null, null, errorText.substring(0, 500));
            await supabase
              .from("processed_documents")
              .update({ status: "error", error_message: `QBO VendorCredit Error: ${errorText.substring(0, 500)}` })
              .eq("id", doc.id);
            return { success: false, docNumber: doc.doc_number, error: errorText.substring(0, 200) };
          }
          
          const vcData = await vcResponse.json();
          entityId = vcData.VendorCredit.Id;
          entityType = "VendorCredit";
          
        } else {
          // Bill
          const billPayload: any = {
            VendorRef: { value: vendorId },
            TxnDate: doc.issue_date,
            DueDate: doc.issue_date,
            DocNumber: qboDocNumber,
            Line: lines,
            PrivateNote: `Factura XML: ${doc.doc_number}\nClave: ${claveHacienda}\nProveedor: ${doc.supplier_name}`,
            GlobalTaxCalculation: includeTaxInLines ? "TaxInclusive" : "TaxExcluded",
          };
          
          if (documentCurrency === 'USD') {
            billPayload.CurrencyRef = { value: "USD" };
            const exchangeRate = parseFloat(xmlData?.resumen_factura?.tipoCambio || xmlData?.tipoCambio || '1');
            if (exchangeRate > 1) billPayload.ExchangeRate = exchangeRate;
          }
          
          if (effectiveUsesTax && totalTax > 0) {
            billPayload.TxnTaxDetail = { TotalTax: totalTax };
          }
          
          let billResponse = await fetchWithRetry(
            `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(billPayload),
            }
          );
          
          // CRITICAL FIX: If QBO returns tax calculation error, retry WITHOUT TxnTaxDetail
          if (!billResponse.ok) {
            const errorText = await billResponse.text();
            
            // Check if it's a tax calculation error
            if (errorText.includes('error al calcular el impuesto') || 
                errorText.includes('calculating the tax') ||
                errorText.includes('tax rate') ||
                errorText.includes('TaxCodeRef')) {
              
              logInfo(`⚠️ ${doc.doc_number}: Error de impuesto en QBO, reintentando SIN TxnTaxDetail...`);
              
              // Remove TxnTaxDetail and TaxCodeRef from lines
              delete billPayload.TxnTaxDetail;
              for (const line of billPayload.Line) {
                if (line.AccountBasedExpenseLineDetail?.TaxCodeRef) {
                  delete line.AccountBasedExpenseLineDetail.TaxCodeRef;
                }
              }
              billPayload.GlobalTaxCalculation = "NotApplicable";
              
              // Retry without tax
              await delay(1000);
              billResponse = await fetchWithRetry(
                `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill`,
                {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(billPayload),
                }
              );
              
              if (billResponse.ok) {
                logInfo(`✅ ${doc.doc_number}: Reintento exitoso sin impuestos`);
              }
            }
          }
          
          if (!billResponse.ok) {
            const errorText = await billResponse.text();
            await registerInTracking(doc, 'error', null, null, errorText.substring(0, 500));
            await supabase
              .from("processed_documents")
              .update({ status: "error", error_message: `QBO Bill Error: ${errorText.substring(0, 500)}` })
              .eq("id", doc.id);
            return { success: false, docNumber: doc.doc_number, error: errorText.substring(0, 200) };
          }
          
          const billData = await billResponse.json();
          entityId = billData.Bill.Id;
          entityType = "Bill";
        }
        
        logInfo(`✅ ${doc.doc_number}: ${entityType} created (ID: ${entityId})`);
        
        // =============================================================
        // STEP 11: UPDATE TRACKING TABLE (status: published)
        // =============================================================
        await registerInTracking(doc, 'published', entityId, entityType);
        
        // =============================================================
        // STEP 12: UPDATE DOCUMENT
        // =============================================================
        await supabase
          .from("processed_documents")
          .update({
            qbo_entity_id: entityId,
            qbo_entity_type: entityType,
            status: "published",
            processed_at: new Date().toISOString(),
            processed_by: userId,
            error_message: null,
          })
          .eq("id", doc.id);
        
        // Attach PDF (fire and forget)
        if (doc.pdf_attachment_url) {
          // TODO: Implement PDF attachment
        }
        
        const elapsedTime = Date.now() - startTime;
        log(`${progress} ✅ Done in ${elapsedTime}ms`);
        return { success: true, docNumber: doc.doc_number, qbo_entity_id: entityId };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        await supabase
          .from("processed_documents")
          .update({ status: "error", error_message: errorMessage.substring(0, 500) })
          .eq("id", doc.id);
        
        return { success: false, docNumber: doc.doc_number, error: errorMessage };
      }
    };

    // =============================================================
    // PROCESS DOCUMENTS
    // =============================================================
    const BATCH_SIZE = 2;
    const DELAY_BETWEEN_BATCHES = 2000;
    
    if (isSingleDocument) {
      const doc = documents[0];
      const result = await processDocument(doc, 0, 1);
      
      if (result.success) {
        if (result.skipped) {
          results.skipped_duplicates = 1;
        } else {
          results.published = 1;
        }
      } else {
        results.failed = 1;
        results.errors.push({ doc_number: result.docNumber, error: result.error });
      }
      
      return new Response(
        JSON.stringify({
          success: result.success,
          published: results.published,
          skipped_duplicates: results.skipped_duplicates,
          failed: results.failed,
          errors: results.errors.length > 0 ? results.errors : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
    
    // Multiple documents
    const documentResults = [];
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      
      for (let j = 0; j < batch.length; j++) {
        const doc = batch[j];
        const result = await processDocument(doc, i + j, documents.length);
        documentResults.push(result);
        
        if (j < batch.length - 1) {
          await delay(1500);
        }
      }
      
      if (i + BATCH_SIZE < documents.length) {
        logInfo(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }
    
    // Count results
    for (const result of documentResults) {
      if (result.success) {
        if (result.skipped) {
          results.skipped_duplicates++;
          if (result.qbo_entity_id) {
            results.duplicates.push({
              doc_number: result.docNumber,
              qbo_entity_id: result.qbo_entity_id,
              reason: result.reason || 'Ya existe',
            });
          }
        } else {
          results.published++;
        }
      } else {
        results.failed++;
        results.errors.push({ doc_number: result.docNumber, error: result.error });
      }
    }
    
    const totalTime = Date.now() - batchStartTime;
    logInfo(`📊 Batch complete: ${results.published} published, ${results.skipped_duplicates} skipped, ${results.failed} failed in ${totalTime}ms`);

    return new Response(
      JSON.stringify({
        success: results.failed === 0,
        published: results.published,
        skipped_duplicates: results.skipped_duplicates,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
        duplicates: results.duplicates.length > 0 ? results.duplicates : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    logError("❌ Publish error:", error);
    
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
