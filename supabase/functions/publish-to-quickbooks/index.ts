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
// 
// CRITICAL HANDLING FOR:
// - IEBLE (código 07): Impuesto específico sobre bebidas - tarifa=0 but has montoImpuesto
// - Credit Notes: May have negative montoTotalLinea values
// - Discounts: Some XMLs have montoDescuento NOT reflected in baseImponible
// =============================================================
function calculateTotalFromLines(xmlData: any): { 
  total: number; 
  subtotal: number; 
  tax: number; 
  ieble: number; 
  lineDiscounts: number;
  lineCount: number;
  isCreditNote: boolean;
} {
  if (!xmlData) return { total: 0, subtotal: 0, tax: 0, ieble: 0, lineDiscounts: 0, lineCount: 0, isCreditNote: false };
  
  const detalle = xmlData.detalle || xmlData.detalles || xmlData.DetalleServicio || [];
  const detalleArray = Array.isArray(detalle) ? detalle : (detalle ? [detalle] : []);
  
  let totalLines = 0;
  let subtotalLines = 0;
  let taxLines = 0;
  let iebleTotal = 0;
  let lineDiscounts = 0;
  let processedLines = 0;
  let hasNegativeTotal = false;
  
  for (const item of detalleArray) {
    if (!item) continue;
    processedLines++;
    
    // MontoTotalLinea is the total for the line (subtotal + tax)
    const montoTotalLinea = parseFloat(
      item.montoTotalLinea || 
      item.MontoTotalLinea || 
      '0'
    );
    
    // Detect credit notes by negative montoTotalLinea
    if (montoTotalLinea < 0) {
      hasNegativeTotal = true;
    }
    
    // Subtotal/BaseImponible is the pre-tax amount (after discount applied)
    const lineSubtotal = parseFloat(
      item.baseImponible || 
      item.BaseImponible ||
      item.subtotal || 
      item.Subtotal || 
      item.montoTotal ||
      item.MontoTotal ||
      '0'
    );
    
    // Get line-level discount (NOT already applied to baseImponible in some XMLs)
    const lineDiscount = parseFloat(item.montoDescuento || item.MontoDescuento || '0');
    
    // Tax for this line - check ALL types of taxes including IEBLE (código 07)
    let lineTax = 0;
    let lineIeble = 0;
    
    // First check direct impuestoNeto (most reliable)
    const directTax = parseFloat(item.impuestoNeto || item.ImpuestoNeto || '0');
    
    // Also check impuestos array for detailed breakdown
    const impuestos = item.impuestos || [];
    const impuestosArray = Array.isArray(impuestos) ? impuestos : [impuestos];
    
    for (const imp of impuestosArray) {
      if (!imp) continue;
      const codigo = imp.codigo || imp.Codigo || '';
      const monto = parseFloat(imp.monto || imp.Monto || '0');
      
      if (codigo === '07') {
        // IEBLE - Impuesto Específico sobre Bebidas Envasadas
        // This is a SPECIFIC tax added to the total, NOT a percentage of subtotal
        lineIeble += Math.abs(monto);
        logInfo(`📊 IEBLE detectado en línea ${item.numeroLinea || processedLines}: ${monto.toFixed(2)}`);
      } else if (monto > 0) {
        // Regular tax (IVA, etc.)
        lineTax += Math.abs(monto);
      }
    }
    
    // If no impuestos array, use directTax
    if (lineTax === 0 && directTax > 0) {
      lineTax = Math.abs(directTax);
    }
    
    // Handle credit notes - use absolute values for calculations
    totalLines += Math.abs(montoTotalLinea);
    subtotalLines += Math.abs(lineSubtotal);
    taxLines += lineTax;
    iebleTotal += lineIeble;
    lineDiscounts += Math.abs(lineDiscount);
  }
  
  logInfo(`📊 calculateTotalFromLines: ${processedLines}/${detalleArray.length} líneas procesadas`);
  logInfo(`📊 Sumas: Total=${totalLines.toFixed(2)}, Subtotal=${subtotalLines.toFixed(2)}, IVA=${taxLines.toFixed(2)}, IEBLE=${iebleTotal.toFixed(2)}, Descuentos línea=${lineDiscounts.toFixed(2)}`);
  
  return { 
    total: totalLines, 
    subtotal: subtotalLines, 
    tax: taxLines, 
    ieble: iebleTotal,
    lineDiscounts,
    lineCount: processedLines,
    isCreditNote: hasNegativeTotal
  };
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
    
    // IEBLE is already included in montoTotalLinea for each line
    const totalTaxes = lineCalc.tax + lineCalc.ieble;
    
    logInfo(`📊 Cálculo líneas: Total=${lineCalc.total.toFixed(2)}, Subtotal=${lineCalc.subtotal.toFixed(2)}, IVA=${lineCalc.tax.toFixed(2)}, IEBLE=${lineCalc.ieble.toFixed(2)}, Líneas=${lineCalc.lineCount}`);
    logInfo(`📊 Descuentos totales: ${totalDescuentos.toFixed(2)}, Descuentos línea: ${lineCalc.lineDiscounts.toFixed(2)}, OtrosCargos: ${totalOtrosCargos.toFixed(2)}`);
    logInfo(`📊 Es Nota de Crédito (por valores negativos): ${lineCalc.isCreditNote}`);
    
    // If montoTotalLinea is available and > 0, use it as primary validation
    // montoTotalLinea already includes: (subtotal - descuento) + impuesto (including IEBLE)
    // So we just add OtrosCargos (shipping, fees, etc.) - NO need to subtract discounts!
    if (lineCalc.total > 0) {
      // FORMULA 1: montoTotalLinea sums + OtrosCargos = TotalComprobante
      // This works when discounts are ALREADY embedded in baseImponible
      const calculatedFromLines = lineCalc.total + totalOtrosCargos;
      const lineDifference = Math.abs(calculatedFromLines - xmlTotal);
      
      logInfo(`📊 [F1] montoTotalLinea + OtrosCargos: ${calculatedFromLines.toFixed(2)} vs XML ${xmlTotal.toFixed(2)} (diff: ${lineDifference.toFixed(2)})`);
      
      if (lineDifference <= tolerance) {
        return {
          valid: true,
          xmlTotal,
          calculatedTotal: calculatedFromLines,
          difference: lineDifference,
          breakdown: {
            subtotal: lineCalc.subtotal,
            totalImpuestos: totalTaxes,
            totalDescuentos,
            totalOtrosCargos,
            totalExoneraciones: 0
          },
          errors: []
        };
      }
      
      // FORMULA 2: Some XMLs have discounts NOT reflected in montoTotalLinea
      // (montoTotalLinea was calculated from montoTotal, not baseImponible)
      const calculatedWithDiscounts = lineCalc.total + totalOtrosCargos - totalDescuentos;
      const withDiscountsDiff = Math.abs(calculatedWithDiscounts - xmlTotal);
      
      logInfo(`📊 [F2] montoTotalLinea - Descuentos + OtrosCargos: ${calculatedWithDiscounts.toFixed(2)} vs XML ${xmlTotal.toFixed(2)} (diff: ${withDiscountsDiff.toFixed(2)})`);
      
      if (withDiscountsDiff <= tolerance) {
        return {
          valid: true,
          xmlTotal,
          calculatedTotal: calculatedWithDiscounts,
          difference: withDiscountsDiff,
          breakdown: {
            subtotal: lineCalc.subtotal,
            totalImpuestos: totalTaxes,
            totalDescuentos,
            totalOtrosCargos,
            totalExoneraciones: 0
          },
          errors: []
        };
      }
      
      // FORMULA 3: For PINTURAS NANDY case - montoTotalLinea includes PRE-discount values
      // baseImponible = subtotal - descuento, but montoTotal = precioUnitario * cantidad (NO discount)
      // So: (subtotal after discount) + tax + OtrosCargos = Total
      const calculatedFromBase = lineCalc.subtotal + totalTaxes + totalOtrosCargos;
      const fromBaseDiff = Math.abs(calculatedFromBase - xmlTotal);
      
      logInfo(`📊 [F3] baseImponible + Impuestos + OtrosCargos: ${calculatedFromBase.toFixed(2)} vs XML ${xmlTotal.toFixed(2)} (diff: ${fromBaseDiff.toFixed(2)})`);
      
      if (fromBaseDiff <= tolerance) {
        return {
          valid: true,
          xmlTotal,
          calculatedTotal: calculatedFromBase,
          difference: fromBaseDiff,
          breakdown: {
            subtotal: lineCalc.subtotal,
            totalImpuestos: totalTaxes,
            totalDescuentos,
            totalOtrosCargos,
            totalExoneraciones: 0
          },
          errors: []
        };
      }
      
      // FORMULA 4: AQUI MAS FRESCO case - IEBLE is separate and NOT in montoTotalLinea
      // Some XMLs have tarifa:0 but impuestoNeto contains IEBLE that needs to be added
      // montoTotalLinea might NOT include the IEBLE
      if (lineCalc.ieble > 0) {
        const calculatedWithIEBLE = lineCalc.total + lineCalc.ieble + totalOtrosCargos;
        const iebleDiff = Math.abs(calculatedWithIEBLE - xmlTotal);
        
        logInfo(`📊 [F4] montoTotalLinea + IEBLE separado + OtrosCargos: ${calculatedWithIEBLE.toFixed(2)} vs XML ${xmlTotal.toFixed(2)} (diff: ${iebleDiff.toFixed(2)})`);
        
        if (iebleDiff <= tolerance) {
          return {
            valid: true,
            xmlTotal,
            calculatedTotal: calculatedWithIEBLE,
            difference: iebleDiff,
            breakdown: {
              subtotal: lineCalc.subtotal,
              totalImpuestos: totalTaxes,
              totalDescuentos,
              totalOtrosCargos,
              totalExoneraciones: 0
            },
            errors: []
          };
        }
      }
    }
    
    // FALLBACK: Try with subtotal + tax + IEBLE calculation
    if (lineCalc.subtotal > 0) {
      const calculatedStandard = lineCalc.subtotal + totalTaxes + totalOtrosCargos - totalDescuentos;
      const standardDiff = Math.abs(calculatedStandard - xmlTotal);
      
      // Also try exempt case (taxes not added)
      const calculatedExempt = lineCalc.subtotal + totalOtrosCargos - totalDescuentos;
      const exemptDiff = Math.abs(calculatedExempt - xmlTotal);
      
      // Try with IEBLE added but IVA exempt
      const calculatedIebleOnly = lineCalc.subtotal + lineCalc.ieble + totalOtrosCargos - totalDescuentos;
      const iebleOnlyDiff = Math.abs(calculatedIebleOnly - xmlTotal);
      
      logInfo(`📊 Fallback: Standard=${calculatedStandard.toFixed(2)} (diff:${standardDiff.toFixed(2)}), Exento=${calculatedExempt.toFixed(2)} (diff:${exemptDiff.toFixed(2)}), IEBLE-only=${calculatedIebleOnly.toFixed(2)} (diff:${iebleOnlyDiff.toFixed(2)})`);
      
      const minDiff = Math.min(standardDiff, exemptDiff, iebleOnlyDiff);
      if (minDiff <= tolerance) {
        const usedCalc = standardDiff <= tolerance ? calculatedStandard : 
                         exemptDiff <= tolerance ? calculatedExempt : calculatedIebleOnly;
        return {
          valid: true,
          xmlTotal,
          calculatedTotal: usedCalc,
          difference: minDiff,
          breakdown: {
            subtotal: lineCalc.subtotal,
            totalImpuestos: totalTaxes,
            totalDescuentos,
            totalOtrosCargos,
            totalExoneraciones: 0
          },
          errors: []
        };
      }
      
      // Neither formula matched - report detailed error with all attempts
      errors.push(`Ninguna fórmula coincide con Total XML (${xmlTotal.toFixed(2)}): ` +
                  `SumaLineas=${lineCalc.total.toFixed(2)}, ` +
                  `Subtotal=${lineCalc.subtotal.toFixed(2)}, ` +
                  `IVA=${lineCalc.tax.toFixed(2)}, IEBLE=${lineCalc.ieble.toFixed(2)}, ` +
                  `Descuentos=${totalDescuentos.toFixed(2)}, OtrosCargos=${totalOtrosCargos.toFixed(2)}, ` +
                  `Std=${calculatedStandard.toFixed(2)}`);
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

// =============================================================
// PDF ATTACHMENT TO QUICKBOOKS BILL
// Uses QuickBooks Attachable API with multipart/form-data
// =============================================================
async function attachPdfToQuickBooks(
  pdfUrl: string,
  entityId: string,
  entityType: string,
  docNumber: string,
  realmId: string,
  accessToken: string,
  supabase: any
): Promise<boolean> {
  try {
    logInfo(`📎 ${docNumber}: Attaching PDF to ${entityType} ${entityId}...`);
    
    // Step 1: Download PDF from storage (handle both public URLs and storage paths)
    let pdfData: ArrayBuffer;
    let filename = `${docNumber}.pdf`;
    
    if (pdfUrl.startsWith('http')) {
      // Public URL - fetch directly
      const pdfResponse = await fetch(pdfUrl);
      if (!pdfResponse.ok) {
        logError(`❌ ${docNumber}: Failed to download PDF: ${pdfResponse.status}`);
        return false;
      }
      pdfData = await pdfResponse.arrayBuffer();
    } else {
      // Storage path - use Supabase storage
      const { data, error } = await supabase.storage
        .from('company-documents')
        .download(pdfUrl);
      
      if (error || !data) {
        logError(`❌ ${docNumber}: Failed to download PDF from storage: ${error?.message}`);
        return false;
      }
      pdfData = await data.arrayBuffer();
    }
    
    if (!pdfData || pdfData.byteLength === 0) {
      logError(`❌ ${docNumber}: PDF data is empty`);
      return false;
    }
    
    logInfo(`   📄 ${docNumber}: PDF downloaded (${Math.round(pdfData.byteLength / 1024)} KB)`);
    
    // Step 2: Create multipart form data for QuickBooks Upload API
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    
    // Metadata for the attachable
    const metadata = {
      AttachableRef: [{
        EntityRef: {
          type: entityType,
          value: entityId
        }
      }],
      FileName: filename,
      ContentType: 'application/pdf'
    };
    
    // Build multipart body
    const metadataJson = JSON.stringify(metadata);
    const pdfBytes = new Uint8Array(pdfData);
    
    // Create the multipart body parts
    const metadataPart = `--${boundary}\r\nContent-Disposition: form-data; name="file_metadata_01"; filename="file_metadata_01"\r\nContent-Type: application/json\r\n\r\n${metadataJson}\r\n`;
    const filePartHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file_content_01"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`;
    const endBoundary = `\r\n--${boundary}--\r\n`;
    
    // Combine all parts into a single Uint8Array
    const encoder = new TextEncoder();
    const metadataBytes = encoder.encode(metadataPart);
    const headerBytes = encoder.encode(filePartHeader);
    const endBytes = encoder.encode(endBoundary);
    
    const totalLength = metadataBytes.length + headerBytes.length + pdfBytes.length + endBytes.length;
    const body = new Uint8Array(totalLength);
    
    let offset = 0;
    body.set(metadataBytes, offset); offset += metadataBytes.length;
    body.set(headerBytes, offset); offset += headerBytes.length;
    body.set(pdfBytes, offset); offset += pdfBytes.length;
    body.set(endBytes, offset);
    
    // Step 3: Upload to QuickBooks
    const uploadUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/upload?minorversion=69`;
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      logError(`❌ ${docNumber}: QuickBooks upload failed: ${uploadResponse.status} - ${errorText.substring(0, 200)}`);
      return false;
    }
    
    const uploadResult = await uploadResponse.json();
    const attachableId = uploadResult.AttachableResponse?.[0]?.Attachable?.Id;
    
    if (attachableId) {
      logInfo(`✅ ${docNumber}: PDF attached to ${entityType} ${entityId} (Attachable ID: ${attachableId})`);
      return true;
    } else {
      logInfo(`⚠️ ${docNumber}: Upload succeeded but no Attachable ID returned`);
      return true; // Still consider it a success
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`❌ ${docNumber}: PDF attachment error: ${errorMessage}`);
    return false;
  }
}

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
      .in("status", ["pending", "processed"]);
    
    // Only apply date filter when NOT targeting specific documents
    if (!document_ids || document_ids.length === 0) {
      findQuery = findQuery.gte("issue_date", minDate);
    }

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
          
          // Check for duplicate error (vendor already exists)
          try {
            const errorJson = JSON.parse(errorText);
            const qboError = errorJson?.Fault?.Error?.[0];
            if (qboError?.code === '6240' || qboError?.Detail?.includes('Id=')) {
              const idMatch = qboError.Detail?.match(/Id=(\d+)/);
              if (idMatch) {
                return idMatch[1];
              }
            }
            
            // Check for name conflict with Customer/Employee (code 6000)
            // QBO doesn't allow same DisplayName for Vendor and Customer
            if (qboError?.code === '6000' || qboError?.Detail?.includes('tipo de nombre')) {
              logInfo(`⚠️ Name conflict for "${vendorDisplayName}" - exists as Customer/Employee. Retrying with suffix...`);
              const suffixedName = `${vendorDisplayName} (Proveedor)`;
              const retryResponse = await fetch(
                `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendor`,
                {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ ...vendorPayload, DisplayName: suffixedName }),
                }
              );
              if (retryResponse.ok) {
                const retryData = await retryResponse.json();
                logInfo(`✅ Vendor created with suffix: ${suffixedName} (ID: ${retryData.Vendor.Id})`);
                return retryData.Vendor.Id;
              }
              // Also try searching if suffixed vendor already exists
              const searchSuffixed = await fetch(
                `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName = '${suffixedName.replace(/'/g, "\\'")}'`)}`,
                { headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" } }
              );
              if (searchSuffixed.ok) {
                const searchData = await searchSuffixed.json();
                if (searchData.QueryResponse?.Vendor?.length > 0) {
                  return searchData.QueryResponse.Vendor[0].Id;
                }
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
        
        // FIXED: Account codes can include dashes for sub-accounts (e.g., "6130-03")
        // Only split by space to separate code from description, NOT by dash
        // Examples: "6130-03 Utencilios cafeteria" → "6130-03"
        //           "661 Materiales Medicos" → "661"
        const codeOnly = searchCode.split(' ')[0].trim();
        
        logInfo(`🔍 Buscando cuenta: código="${codeOnly}" (original="${searchCode}")`);
        
        // Exact match by AcctNum (most reliable)
        let account = allAccounts.find((acc: any) => acc.AcctNum === codeOnly);
        if (account) {
          logInfo(`✓ Cuenta encontrada por AcctNum: ${account.Name} (ID: ${account.Id})`);
          return account.Id;
        }
        
        // Match by name starting with code (for sub-accounts like "6130-03")
        account = allAccounts.find((acc: any) => {
          const name = acc.Name || '';
          return name === codeOnly || name.startsWith(codeOnly + ' ') || name.startsWith(codeOnly + '-');
        });
        if (account) {
          logInfo(`✓ Cuenta encontrada por Name: ${account.Name} (ID: ${account.Id})`);
          return account.Id;
        }
        
        // Fallback: search by name containing
        account = allAccounts.find((acc: any) => {
          const name = (acc.Name || '').toLowerCase();
          return name.includes(searchCode.toLowerCase());
        });
        if (account) {
          logInfo(`✓ Cuenta encontrada por búsqueda: ${account.Name} (ID: ${account.Id})`);
          return account.Id;
        }
        
        logInfo(`⚠️ Cuenta no encontrada: ${codeOnly}`);
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
    let taxRatesCache: Map<string, number> | null = null;
    
    // Fetch TaxRates to map TaxCode IDs to their actual rates
    const loadTaxRatesMap = async () => {
      if (taxRatesCache) return;
      taxRatesCache = new Map();
      try {
        const query = `SELECT Id, Name, RateValue, AgencyRef FROM TaxRate WHERE Active = true MAXRESULTS 200`;
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
          const rates = data.QueryResponse?.TaxRate || [];
          for (const rate of rates) {
            taxRatesCache!.set(rate.Id, parseFloat(rate.RateValue) || 0);
          }
          logInfo(`📊 TaxRates loaded: ${taxRatesCache!.size} rates`);
        }
      } catch (e) {
        logError('Error loading TaxRates:', e);
      }
    };
    
    const getTaxCodeRef = async (taxRate: number): Promise<string | null> => {
      if (!taxCodesCache) {
        try {
          const query = `SELECT Id, Name, Description, SalesTaxRateList, PurchaseTaxRateList FROM TaxCode WHERE Active = true MAXRESULTS 100`;
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
            logInfo(`📊 TaxCodes loaded: ${taxCodesCache!.length} codes: ${taxCodesCache!.map(tc => `${tc.Name}(${tc.Id})`).join(', ')}`);
          } else {
            taxCodesCache = [];
          }
        } catch {
          taxCodesCache = [];
        }
      }
      
      // Also load TaxRates for accurate matching
      await loadTaxRatesMap();
      
      const rate = Math.round(taxRate);
      
      // STEP 1: Match by name containing the rate percentage
      for (const taxCode of taxCodesCache!) {
        const name = (taxCode.Name || "").toLowerCase();
        
        if (rate === 0) {
          if (name.includes('no vat') || name.includes('exento') || name.includes('out of scope') || name.includes('exempt')) {
            return taxCode.Id;
          }
        } else {
          // Match exact rate in name: "4%", "(4%)", "IVA 4%"
          // CRITICAL: Use regex to prevent "1%" matching "13%" via substring
          const ratePattern = new RegExp(`(^|[^0-9])${rate}%`);
          if (ratePattern.test(name)) {
            return taxCode.Id;
          }
        }
      }
      
      // STEP 2: Match by actual PurchaseTaxRateList rates (more reliable)
      if (rate > 0 && taxRatesCache) {
        for (const taxCode of taxCodesCache!) {
          const purchaseRates = taxCode.PurchaseTaxRateList?.TaxRateDetail || [];
          for (const detail of purchaseRates) {
            const taxRateRef = detail.TaxRateRef?.value;
            if (taxRateRef && taxRatesCache.has(taxRateRef)) {
              const actualRate = taxRatesCache.get(taxRateRef)!;
              if (Math.abs(actualRate - rate) < 0.5) {
                logInfo(`   📋 TaxCode match by rate: ${taxCode.Name} (rate=${actualRate}%) for requested ${rate}%`);
                return taxCode.Id;
              }
            }
          }
        }
      }
      
      // STEP 3: For non-zero rates where we couldn't find a match, 
      // use any tax code that has a non-zero rate (better than "No VAT")
      if (rate > 0) {
        for (const taxCode of taxCodesCache!) {
          const name = (taxCode.Name || "").toLowerCase();
          // Skip explicitly zero/exempt codes
          if (name.includes('no vat') || name.includes('exento') || name.includes('out of scope') || name.includes('exempt') || name.includes('non')) {
            continue;
          }
          // Use any tax code that looks like it has tax
          if (name.includes('vat') || name.includes('iva') || name.includes('%')) {
            logInfo(`   ⚠️ No exact TaxCode for ${rate}%, using closest: ${taxCode.Name}`);
            return taxCode.Id;
          }
        }
      }
      
      // STEP 4: Return first no-tax code as final fallback
      for (const taxCode of taxCodesCache!) {
        const name = (taxCode.Name || "").toLowerCase();
        if (name.includes('no vat') || name.includes('non') || name.includes('exempt')) {
          return taxCode.Id;
        }
      }
      
      return null;
    };

    // =============================================================
    // HELPER: Get TaxRate ID for TxnTaxDetail.TaxLine
    // =============================================================
    const getTaxRateRefForRate = async (taxRate: number): Promise<string | null> => {
      await loadTaxRatesMap();
      if (!taxRatesCache) return null;
      const rate = Math.round(taxRate);
      for (const [rateId, rateValue] of taxRatesCache.entries()) {
        if (Math.abs(rateValue - rate) < 0.5) {
          return rateId;
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
        // STEP 2.5: VALIDATE HACIENDA ACCEPTANCE STATUS
        // Only publish invoices with EstadoMensaje = "1" (Aceptado)
        // This reads the Hacienda response XML field
        // =============================================================
        const estadoMensaje = xmlData.EstadoMensaje || 
                              xmlData.estadoMensaje || 
                              xmlData.estado_mensaje ||
                              xmlData.respuesta_hacienda?.EstadoMensaje ||
                              xmlData.respuesta_hacienda?.estadoMensaje ||
                              xmlData.MensajeHacienda?.EstadoMensaje ||
                              xmlData.mensaje_hacienda?.estado_mensaje ||
                              xmlData.hacienda?.estado ||
                              null;
        
        // Also check string representations
        const estadoMensajeStr = String(estadoMensaje || '').toLowerCase();
        const isAceptado = estadoMensaje === '1' || 
                           estadoMensaje === 1 || 
                           estadoMensajeStr === 'aceptado' ||
                           estadoMensajeStr === 'accepted' ||
                           estadoMensajeStr === '1';
        
        // If EstadoMensaje is present and is NOT "Aceptado", block the document
        if (estadoMensaje !== null && estadoMensaje !== undefined && !isAceptado) {
          const estadoStr = estadoMensaje === '2' || estadoMensaje === 2 ? 'Aceptado Parcialmente' :
                            estadoMensaje === '3' || estadoMensaje === 3 ? 'Rechazado' : 
                            `Estado: ${estadoMensaje}`;
          
          const errorMsg = `Factura no aceptada por Hacienda (${estadoStr})`;
          logInfo(`🚫 ${doc.doc_number}: ${errorMsg}`);
          
          await registerInTracking(doc, 'blocked_hacienda', null, null, errorMsg);
          
          await supabase
            .from("processed_documents")
            .update({
              status: "error",
              error_message: errorMsg,
            })
            .eq("id", doc.id);
          
          return { success: false, docNumber: doc.doc_number, error: errorMsg };
        }
        
        // If no EstadoMensaje field found, log warning but continue (legacy invoices)
        if (estadoMensaje === null || estadoMensaje === undefined) {
          logInfo(`⚠️ ${doc.doc_number}: No se encontró EstadoMensaje en XML - continuando...`);
        } else {
          logInfo(`✅ ${doc.doc_number}: Hacienda aceptó la factura (EstadoMensaje: ${estadoMensaje})`);
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
        // STEP 6: GET ACCOUNT - Priority: vendor_defaults > vendors > document
        // CRITICAL: Always check vendor config FIRST, then use document as fallback
        // =============================================================
        let accountCode: string | null = null;
        
        // PRIORITY 1: Try vendor_defaults table (highest priority - user-configured rules)
        const { data: vendorDefault } = await supabase
          .from("vendor_defaults")
          .select("default_account_ref")
          .eq("organization_id", organization_id)
          .ilike("vendor_name", doc.supplier_name)
          .maybeSingle();
        
        if (vendorDefault?.default_account_ref) {
          accountCode = vendorDefault.default_account_ref;
          logInfo(`   📋 ${doc.doc_number}: Using vendor_defaults account: ${accountCode}`);
        }
        
        // PRIORITY 2: Try vendors table
        if (!accountCode) {
          const { data: vendor } = await supabase
            .from("vendors")
            .select("default_account_ref")
            .eq("organization_id", organization_id)
            .ilike("vendor_name", doc.supplier_name)
            .maybeSingle();
          
          if (vendor?.default_account_ref) {
            accountCode = vendor.default_account_ref;
            logInfo(`   📋 ${doc.doc_number}: Using vendors table account: ${accountCode}`);
          }
        }
        
        // PRIORITY 3: Use document's default_account_ref (from UI assignment)
        if (!accountCode && doc.default_account_ref) {
          accountCode = doc.default_account_ref;
          logInfo(`   📋 ${doc.doc_number}: Using document account: ${accountCode}`);
        }
        
        // PRIORITY 4: Check for auto_unclassified_account setting
        if (!accountCode) {
          const { data: autoUnclassifiedSetting } = await supabase
            .from("system_settings")
            .select("value")
            .eq("organization_id", organization_id)
            .eq("key", "auto_unclassified_account")
            .maybeSingle();
          
          if (autoUnclassifiedSetting?.value) {
            accountCode = autoUnclassifiedSetting.value;
            logInfo(`   🎯 ${doc.doc_number}: Using auto_unclassified_account: ${accountCode}`);
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
        // IMPORTANT: Account codes can be like "6130-03 Utencilios cafeteria"
        // The dash is part of the code (subcuenta), NOT a separator
        // Only split by space to separate code from description
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
        
        // PRE-DETECT tax exemption: when subTotal ≈ totalComprobante but tax > 0
        // This means "impuesto asumido" - tax is NOT added to total, it's informational
        // In this case, IVA must be included in line amounts so QBO total = totalComprobante
        const earlyXmlTotal = parseFloat(xmlData.totalComprobante || xmlData.TotalComprobante || doc.total_amount);
        const earlyXmlSubtotal = parseFloat(xmlData.subTotal || xmlData.SubTotal || '0');
        const earlyXmlTax = parseFloat(doc.total_tax as any) || 0;
        const earlyIsTaxExempt = Math.abs(earlyXmlTax) > 0 && earlyXmlSubtotal > 0 && Math.abs(Math.abs(earlyXmlTotal) - Math.abs(earlyXmlSubtotal)) < 1.0;
        
        // Force IVA into line amounts when tax is "asumido" (exempt from total)
        const includeTaxInLines = taxHandling === 'included_in_line_items' || earlyIsTaxExempt;
        
        if (earlyIsTaxExempt) {
          logInfo(`   📋 ${doc.doc_number}: IMPUESTO ASUMIDO detectado temprano - SubTotal=${earlyXmlSubtotal.toFixed(2)} ≈ Total=${earlyXmlTotal.toFixed(2)}, Tax=${earlyXmlTax.toFixed(2)} → IVA incluido en líneas`);
        }
        
        // Tax accumulator: group IVA by rate for TxnTaxDetail.TaxLine
        const taxByRate: Record<number, { taxAmount: number; netAmount: number }> = {};
        
        // Parse detail lines
        if (xmlData.detalle && Array.isArray(xmlData.detalle) && xmlData.detalle.length > 0) {
          for (const item of xmlData.detalle) {
            const cantidad = parseFloat(item.cantidad) || 1;
            let precioUnitario = parseFloat(item.precioUnitario) || 0;
            let subtotal = parseFloat(item.subtotal) || (cantidad * precioUnitario);
            
            if (isCreditNote) {
              subtotal = -Math.abs(subtotal);
            }
            
            let montoImpuestoIVA = 0;
            let montoImpuestoIEBLE = 0;
            let tasaImpuesto = 0;
            
            if (item.impuestos && Array.isArray(item.impuestos)) {
              for (const imp of item.impuestos) {
                const codigo = imp.codigo || '';
                const monto = parseFloat(imp.monto) || 0;
                
                if (codigo === '01') {
                  // IVA
                  tasaImpuesto = parseFloat(imp.tarifa) || 0;
                  montoImpuestoIVA = monto;
                } else if (codigo === '07') {
                  // IEBLE - Impuesto Específico sobre Bebidas Envasadas
                  montoImpuestoIEBLE = monto;
                  logInfo(`   📊 IEBLE detectado: ${monto.toFixed(2)}`);
                }
              }
              if (isCreditNote) {
                montoImpuestoIVA = -Math.abs(montoImpuestoIVA);
                montoImpuestoIEBLE = -Math.abs(montoImpuestoIEBLE);
              }
            } else {
              tasaImpuesto = parseFloat(item.tarifa) || 0;
              montoImpuestoIVA = parseFloat(item.montoImpuesto) || 0;
              // Check for IEBLE in impuestoNeto when tarifa=0 but there's tax
              if (tasaImpuesto === 0 && parseFloat(item.impuestoNeto || '0') > 0) {
                montoImpuestoIEBLE = parseFloat(item.impuestoNeto) || 0;
              }
              if (isCreditNote) {
                montoImpuestoIVA = -Math.abs(montoImpuestoIVA);
                montoImpuestoIEBLE = -Math.abs(montoImpuestoIEBLE);
              }
            }
            
            // Calculate line amount
            // CRITICAL: baseImponible already has discount applied
            // We need to add IEBLE as it's a specific tax that goes into the expense
            let lineAmount = subtotal;
            
            // If tax should be included in lines (IVA como gasto), add IVA to line
            if (includeTaxInLines && Math.abs(montoImpuestoIVA) > 0) {
              lineAmount = subtotal + montoImpuestoIVA;
            }
            
            // ALWAYS add IEBLE to the line amount - it's always an expense, never recoverable
            if (Math.abs(montoImpuestoIEBLE) > 0) {
              lineAmount += Math.abs(montoImpuestoIEBLE);
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
              
              // Accumulate IVA by rate for TxnTaxDetail.TaxLine
              if (!includeTaxInLines && tasaImpuesto > 0 && Math.abs(montoImpuestoIVA) > 0.001) {
                const rateKey = Math.round(tasaImpuesto);
                if (!taxByRate[rateKey]) {
                  taxByRate[rateKey] = { taxAmount: 0, netAmount: 0 };
                }
                taxByRate[rateKey].taxAmount += Math.abs(montoImpuestoIVA);
                taxByRate[rateKey].netAmount += Math.abs(subtotal);
              }
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
          // Use actual tax rate from XML instead of hardcoded 13%
          const xmlDetalle = xmlData.detalle || xmlData.detalles || xmlData.DetalleServicio || [];
          const xmlDetalleArr = Array.isArray(xmlDetalle) ? xmlDetalle : [xmlDetalle];
          let fallbackTaxRate = 0;
          if (effectiveUsesTax && doc.total_tax > 0) {
            for (const item of xmlDetalleArr) {
              const impuestos = item?.impuestos || [];
              const impArr = Array.isArray(impuestos) ? impuestos : [impuestos];
              for (const imp of impArr) {
                if ((!imp.codigo || imp.codigo === '01') && parseFloat(imp.tarifa) > 0) {
                  fallbackTaxRate = parseFloat(imp.tarifa);
                  break;
                }
              }
              if (fallbackTaxRate > 0) break;
              // Also check direct tarifa field
              if (parseFloat(item?.tarifa) > 0 && (!item?.impuestos || !Array.isArray(item.impuestos))) {
                fallbackTaxRate = parseFloat(item.tarifa);
                break;
              }
            }
            if (fallbackTaxRate === 0) fallbackTaxRate = 13; // Final fallback to 13%
          }
          const fallbackTaxCodeId = await getTaxCodeRef(fallbackTaxRate);
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
        
        // Use early-detected tax exemption from STEP 7 pre-detection
        const xmlTotal = parseFloat(xmlData.totalComprobante || xmlData.TotalComprobante || doc.total_amount);
        const xmlSubtotal = parseFloat(xmlData.subTotal || xmlData.SubTotal || '0');
        const xmlTax = parseFloat(doc.total_tax as any) || 0;
        const isTaxExempt = earlyIsTaxExempt;
        
        // Calculate IEBLE from lines - this is ALREADY included in line amounts
        // so we must NOT add it again via totalTax
        let totalIEBLEInLines = 0;
        const detalleForIeble = xmlData.detalle || xmlData.detalles || xmlData.DetalleServicio || [];
        const detalleArrayIeble = Array.isArray(detalleForIeble) ? detalleForIeble : [detalleForIeble];
        for (const item of detalleArrayIeble) {
          if (!item?.impuestos) continue;
          const impuestos = Array.isArray(item.impuestos) ? item.impuestos : [item.impuestos];
          for (const imp of impuestos) {
            if (imp?.codigo === '07') {
              totalIEBLEInLines += Math.abs(parseFloat(imp.monto) || 0);
            }
          }
        }
        
        // Solo reportar TxnTaxDetail si el IVA es recuperable Y NO está exonerado
        const effectiveUsesTax = (doc.uses_tax !== false) && orgDefaultUsesTax && !includeTaxInLines && !isTaxExempt;
        
        // CRITICAL: xmlTax includes ALL taxes (IVA + IEBLE + asumido)
        // But IEBLE is already included in line amounts, so we subtract it to avoid double-counting
        // Also, impuesto asumido (código 05) should NOT be added to total at all
        const ivaOnlyTax = effectiveUsesTax 
          ? Math.max(0, Math.abs(xmlTax) - totalIEBLEInLines)
          : 0;
        
        if (totalIEBLEInLines > 0) {
          logInfo(`   📊 ${doc.doc_number}: IEBLE ya incluido en líneas: ${totalIEBLEInLines.toFixed(2)} (restado de Tax para evitar doble conteo)`);
        }
        
        if (isTaxExempt) {
          logInfo(`   📋 ${doc.doc_number}: IMPUESTO EXONERADO detectado - Tax=${xmlTax.toFixed(2)} NO se suma al total`);
        }
        
        // CRITICAL: Validate that lines total + IVA-only tax = document total (with tolerance)
        // Lines already include IEBLE, so we only add IVA portion
        const expectedQBOTotal = linesTotalAmount + ivaOnlyTax;
        const documentTotal = Math.abs(doc.total_amount);
        const qboTotalDiff = Math.abs(expectedQBOTotal - documentTotal);
        
        // Use larger tolerance for complex invoices with multiple tax types
        const validationTolerance = totalIEBLEInLines > 0 ? 5.0 : 2.0;
        
        if (qboTotalDiff > validationTolerance) {
          const errorMsg = `MONTO INCORRECTO: Lines=${linesTotalAmount.toFixed(2)} + IVA=${ivaOnlyTax.toFixed(2)} (IEBLE ya en líneas: ${totalIEBLEInLines.toFixed(2)}) = ${expectedQBOTotal.toFixed(2)}, pero documento=${documentTotal.toFixed(2)}. Diferencia: ${qboTotalDiff.toFixed(2)}`;
          logError(`❌ ${doc.doc_number}: ${errorMsg}`);
          
          await registerInTracking(doc, 'error_amount_mismatch', null, null, errorMsg);
          await supabase
            .from("processed_documents")
            .update({ status: "error", error_message: errorMsg.substring(0, 500) })
            .eq("id", doc.id);
          
          return { success: false, docNumber: doc.doc_number, error: errorMsg };
        }
        
        logInfo(`   📊 ${doc.doc_number}: Validación final OK - Lines=${linesTotalAmount.toFixed(2)}, IVA=${ivaOnlyTax.toFixed(2)}, IEBLE(en líneas)=${totalIEBLEInLines.toFixed(2)}, Total=${expectedQBOTotal.toFixed(2)} (esperado: ${documentTotal.toFixed(2)})`);
        
        // Use ivaOnlyTax for TxnTaxDetail instead of full xmlTax
        const totalTax = ivaOnlyTax;
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
            GlobalTaxCalculation: earlyIsTaxExempt ? "NotApplicable" : (includeTaxInLines ? "TaxInclusive" : "TaxExcluded"),
          };
          
          if (documentCurrency === 'USD') {
            vendorCreditPayload.CurrencyRef = { value: "USD" };
            const exchangeRate = parseFloat(xmlData?.resumen_factura?.tipoCambio || xmlData?.tipoCambio || '1');
            if (exchangeRate > 1) vendorCreditPayload.ExchangeRate = exchangeRate;
          }
          
          if (effectiveUsesTax && totalTax > 0) {
            const taxLines: any[] = [];
            const rateKeys = Object.keys(taxByRate).map(Number);
            for (const rate of rateKeys) {
              const { taxAmount, netAmount } = taxByRate[rate];
              if (taxAmount > 0.001) {
                const taxRateId = await getTaxRateRefForRate(rate);
                if (taxRateId) {
                  taxLines.push({
                    Amount: parseFloat(taxAmount.toFixed(2)),
                    DetailType: "TaxLineDetail",
                    TaxLineDetail: {
                      TaxRateRef: { value: taxRateId },
                      PercentBased: true,
                      TaxPercent: rate,
                      NetAmountTaxable: parseFloat(netAmount.toFixed(2)),
                    },
                  });
                }
              }
            }
            if (taxLines.length > 0) {
              vendorCreditPayload.TxnTaxDetail = { TotalTax: parseFloat(Math.abs(totalTax).toFixed(2)), TaxLine: taxLines };
            } else {
              vendorCreditPayload.TxnTaxDetail = { TotalTax: parseFloat(Math.abs(totalTax).toFixed(2)) };
            }
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
          
          // CRITICAL FIX: If QBO returns tax calculation error on VendorCredit, retry WITHOUT TxnTaxDetail
          if (!vcResponse.ok) {
            const errorText = await vcResponse.clone().text();
            
            // Check if it's a tax calculation error
            if (errorText.includes('impositiva no válida') ||
                errorText.includes('error al calcular el impuesto') || 
                errorText.includes('calculating the tax') ||
                errorText.includes('tax rate') ||
                errorText.includes('Invalid tax rate') ||
                errorText.includes('TaxCodeRef')) {
              
              logInfo(`⚠️ ${doc.doc_number}: Error de impuesto en VendorCredit, reintentando SIN TxnTaxDetail...`);
              
              // Remove TxnTaxDetail and TaxCodeRef from lines
              const vcTotalTaxToRedistribute = vendorCreditPayload.TxnTaxDetail?.TotalTax || 0;
              delete vendorCreditPayload.TxnTaxDetail;
              
              // CRITICAL: Redistribute tax into line amounts so total matches document
              const vcExpenseLines = vendorCreditPayload.Line.filter((l: any) => l.DetailType === "AccountBasedExpenseLineDetail");
              const vcLinesTotalBeforeTax = vcExpenseLines.reduce((sum: number, l: any) => sum + (l.Amount || 0), 0);
              
              for (const line of vendorCreditPayload.Line) {
                if (line.AccountBasedExpenseLineDetail?.TaxCodeRef) {
                  delete line.AccountBasedExpenseLineDetail.TaxCodeRef;
                }
                // Proportionally add tax to each expense line
                if (line.DetailType === "AccountBasedExpenseLineDetail" && vcTotalTaxToRedistribute > 0 && vcLinesTotalBeforeTax > 0) {
                  const proportion = line.Amount / vcLinesTotalBeforeTax;
                  line.Amount = parseFloat((line.Amount + vcTotalTaxToRedistribute * proportion).toFixed(2));
                }
              }
              vendorCreditPayload.GlobalTaxCalculation = "NotApplicable";
              logInfo(`   📊 ${doc.doc_number}: IVA redistribuido en líneas: ${vcTotalTaxToRedistribute.toFixed(2)} sobre ${vcExpenseLines.length} líneas`);
              
              // Retry without tax
              await delay(1000);
              const vcRetryResponse = await fetchWithRetry(
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
              
              if (vcRetryResponse.ok) {
                logInfo(`✅ ${doc.doc_number}: Reintento VendorCredit exitoso sin impuestos`);
                const vcRetryData = await vcRetryResponse.json();
                entityId = vcRetryData.VendorCredit.Id;
                entityType = "VendorCredit";
              } else {
                const retryErrorText = await vcRetryResponse.text();
                await registerInTracking(doc, 'error', null, null, retryErrorText.substring(0, 500));
                await supabase
                  .from("processed_documents")
                  .update({ status: "error", error_message: `QBO VendorCredit Error (retry): ${retryErrorText.substring(0, 500)}` })
                  .eq("id", doc.id);
                return { success: false, docNumber: doc.doc_number, error: retryErrorText.substring(0, 200) };
              }
            } else {
              await registerInTracking(doc, 'error', null, null, errorText.substring(0, 500));
              await supabase
                .from("processed_documents")
                .update({ status: "error", error_message: `QBO VendorCredit Error: ${errorText.substring(0, 500)}` })
                .eq("id", doc.id);
              return { success: false, docNumber: doc.doc_number, error: errorText.substring(0, 200) };
            }
          }
          
          // Only parse original response if entityId wasn't set by retry
          if (!entityId) {
            const vcData = await vcResponse.json();
            entityId = vcData.VendorCredit.Id;
            entityType = "VendorCredit";
            
            // POST-CREATION VERIFICATION for VendorCredit
            const vcQboTotal = parseFloat(vcData.VendorCredit.TotalAmt || '0');
            const vcExpectedTotal = Math.abs(doc.total_amount);
            const vcDiscrepancy = Math.abs(vcQboTotal - vcExpectedTotal);
            
            if (vcDiscrepancy > 1.0 && vendorCreditPayload.GlobalTaxCalculation !== "NotApplicable") {
              logInfo(`⚠️ ${doc.doc_number}: DISCREPANCIA en VendorCredit! QBO=${vcQboTotal}, Esperado=${vcExpectedTotal}, Diff=${vcDiscrepancy.toFixed(2)}`);
              logInfo(`   🔄 Eliminando VendorCredit ${entityId} y recreando...`);
              
              try {
                const delUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/vendorcredit?operation=delete`;
                await fetchWithRetry(delUrl, {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json", "Content-Type": "application/json" },
                  body: JSON.stringify({ Id: entityId, SyncToken: vcData.VendorCredit.SyncToken }),
                });
              } catch (_) { /* continue */ }
              
              const vcTaxRedist = vendorCreditPayload.TxnTaxDetail?.TotalTax || totalTax || 0;
              delete vendorCreditPayload.TxnTaxDetail;
              const vcLines = vendorCreditPayload.Line.filter((l: any) => l.DetailType === "AccountBasedExpenseLineDetail");
              const vcLinesTotal = vcLines.reduce((sum: number, l: any) => sum + (l.Amount || 0), 0);
              for (const line of vendorCreditPayload.Line) {
                if (line.AccountBasedExpenseLineDetail?.TaxCodeRef) delete line.AccountBasedExpenseLineDetail.TaxCodeRef;
                if (line.DetailType === "AccountBasedExpenseLineDetail" && vcTaxRedist > 0 && vcLinesTotal > 0) {
                  const p = line.Amount / vcLinesTotal;
                  line.Amount = parseFloat((line.Amount + vcTaxRedist * p).toFixed(2));
                }
              }
              vendorCreditPayload.GlobalTaxCalculation = "NotApplicable";
              
              await delay(1500);
              const vcRetry2 = await fetchWithRetry(`https://quickbooks.api.intuit.com/v3/company/${realmId}/vendorcredit`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json", "Content-Type": "application/json" },
                body: JSON.stringify(vendorCreditPayload),
              });
              
              if (vcRetry2.ok) {
                const vcRetry2Data = await vcRetry2.json();
                entityId = vcRetry2Data.VendorCredit.Id;
                logInfo(`✅ ${doc.doc_number}: VendorCredit recreado (ID: ${entityId}, Total: ${vcRetry2Data.VendorCredit.TotalAmt})`);
              } else {
                const vcRetryErr = await vcRetry2.text();
                await registerInTracking(doc, 'error', null, null, `Discrepancia VC: QBO=${vcQboTotal} vs Esperado=${vcExpectedTotal}`);
                await supabase.from("processed_documents").update({ status: "error", error_message: `Discrepancia VC total` }).eq("id", doc.id);
                return { success: false, docNumber: doc.doc_number, error: `VC total discrepancy: ${vcDiscrepancy.toFixed(2)}` };
              }
            }
          }
          
        } else {
          // Bill
          const billPayload: any = {
            VendorRef: { value: vendorId },
            TxnDate: doc.issue_date,
            DueDate: doc.issue_date,
            DocNumber: qboDocNumber,
            Line: lines,
            PrivateNote: `Factura XML: ${doc.doc_number}\nClave: ${claveHacienda}\nProveedor: ${doc.supplier_name}`,
            GlobalTaxCalculation: earlyIsTaxExempt ? "NotApplicable" : (includeTaxInLines ? "TaxInclusive" : "TaxExcluded"),
          };
          
          if (documentCurrency === 'USD') {
            billPayload.CurrencyRef = { value: "USD" };
            const exchangeRate = parseFloat(xmlData?.resumen_factura?.tipoCambio || xmlData?.tipoCambio || '1');
            if (exchangeRate > 1) billPayload.ExchangeRate = exchangeRate;
          }
          
          if (effectiveUsesTax && totalTax > 0) {
            // Build detailed TaxLine entries so QBO knows exact rates
            const taxLines: any[] = [];
            const rateKeys = Object.keys(taxByRate).map(Number);
            
            for (const rate of rateKeys) {
              const { taxAmount, netAmount } = taxByRate[rate];
              if (taxAmount > 0.001) {
                const taxRateId = await getTaxRateRefForRate(rate);
                if (taxRateId) {
                  taxLines.push({
                    Amount: parseFloat(taxAmount.toFixed(2)),
                    DetailType: "TaxLineDetail",
                    TaxLineDetail: {
                      TaxRateRef: { value: taxRateId },
                      PercentBased: true,
                      TaxPercent: rate,
                      NetAmountTaxable: parseFloat(netAmount.toFixed(2)),
                    },
                  });
                  logInfo(`   📊 ${doc.doc_number}: TaxLine: ${rate}% sobre ${netAmount.toFixed(2)} = ${taxAmount.toFixed(2)} (TaxRateRef: ${taxRateId})`);
                }
              }
            }
            
            if (taxLines.length > 0) {
              billPayload.TxnTaxDetail = { TotalTax: parseFloat(totalTax.toFixed(2)), TaxLine: taxLines };
            } else {
              // Fallback: just TotalTax if we couldn't resolve TaxRate IDs
              billPayload.TxnTaxDetail = { TotalTax: parseFloat(totalTax.toFixed(2)) };
              logInfo(`   ⚠️ ${doc.doc_number}: No TaxRate IDs found, using TotalTax only`);
            }
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
            const errorText = await billResponse.clone().text();
            
            // Check if it's a tax calculation error
            if (errorText.includes('error al calcular el impuesto') || 
                errorText.includes('calculating the tax') ||
                errorText.includes('tax rate') ||
                errorText.includes('TaxCodeRef')) {
              
              logInfo(`⚠️ ${doc.doc_number}: Error de impuesto en QBO, reintentando SIN TxnTaxDetail...`);
              
              // Remove TxnTaxDetail and TaxCodeRef from lines
              const billTotalTaxToRedistribute = billPayload.TxnTaxDetail?.TotalTax || 0;
              delete billPayload.TxnTaxDetail;
              
              // CRITICAL: Redistribute tax into line amounts so total matches document
              const billExpenseLines = billPayload.Line.filter((l: any) => l.DetailType === "AccountBasedExpenseLineDetail");
              const billLinesTotalBeforeTax = billExpenseLines.reduce((sum: number, l: any) => sum + (l.Amount || 0), 0);
              
              for (const line of billPayload.Line) {
                if (line.AccountBasedExpenseLineDetail?.TaxCodeRef) {
                  delete line.AccountBasedExpenseLineDetail.TaxCodeRef;
                }
                // Proportionally add tax to each expense line
                if (line.DetailType === "AccountBasedExpenseLineDetail" && billTotalTaxToRedistribute > 0 && billLinesTotalBeforeTax > 0) {
                  const proportion = line.Amount / billLinesTotalBeforeTax;
                  line.Amount = parseFloat((line.Amount + billTotalTaxToRedistribute * proportion).toFixed(2));
                }
              }
              billPayload.GlobalTaxCalculation = "NotApplicable";
              logInfo(`   📊 ${doc.doc_number}: IVA redistribuido en líneas: ${billTotalTaxToRedistribute.toFixed(2)} sobre ${billExpenseLines.length} líneas`);
              
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
            const errorText = await billResponse.clone().text();
            
            // Check for Vendor/Customer name conflict at Bill level
            if (errorText.includes('tipo de nombre') || errorText.includes('name type')) {
              logInfo(`⚠️ ${doc.doc_number}: Name conflict at Bill level. Recreating vendor with suffix...`);
              
              // Try creating/finding vendor with " (Proveedor)" suffix
              const suffixedName = `${doc.supplier_name} (Proveedor)`.substring(0, 100);
              try {
                const newVendorId = await findOrCreateVendor(doc.supplier_name + ' (Proveedor)', doc.supplier_tax_id || '', documentCurrency);
                if (newVendorId) {
                  billPayload.VendorRef = { value: newVendorId };
                  await delay(1000);
                  const retryBillResponse = await fetchWithRetry(
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
                  if (retryBillResponse.ok) {
                    const retryData = await retryBillResponse.json();
                    entityId = retryData.Bill.Id;
                    entityType = "Bill";
                    logInfo(`✅ ${doc.doc_number}: Bill created with suffixed vendor (ID: ${entityId})`);
                  } else {
                    const retryError = await retryBillResponse.text();
                    await registerInTracking(doc, 'error', null, null, retryError.substring(0, 500));
                    await supabase
                      .from("processed_documents")
                      .update({ status: "error", error_message: `QBO Bill Error (retry): ${retryError.substring(0, 500)}` })
                      .eq("id", doc.id);
                    return { success: false, docNumber: doc.doc_number, error: retryError.substring(0, 200) };
                  }
                }
              } catch (retryErr: any) {
                logInfo(`❌ ${doc.doc_number}: Suffix retry also failed: ${retryErr.message}`);
                await registerInTracking(doc, 'error', null, null, errorText.substring(0, 500));
                await supabase
                  .from("processed_documents")
                  .update({ status: "error", error_message: `QBO Bill Error: ${errorText.substring(0, 500)}` })
                  .eq("id", doc.id);
                return { success: false, docNumber: doc.doc_number, error: errorText.substring(0, 200) };
              }
            } else {
              await registerInTracking(doc, 'error', null, null, errorText.substring(0, 500));
              await supabase
                .from("processed_documents")
                .update({ status: "error", error_message: `QBO Bill Error: ${errorText.substring(0, 500)}` })
                .eq("id", doc.id);
              return { success: false, docNumber: doc.doc_number, error: errorText.substring(0, 200) };
            }
          }
          
          const billData = await billResponse.json();
          entityId = billData.Bill.Id;
          entityType = "Bill";
          
          // POST-CREATION VERIFICATION: Compare QBO TotalAmt with expected total
          const qboTotalAmt = parseFloat(billData.Bill.TotalAmt || '0');
          const expectedTotal = Math.abs(doc.total_amount);
          const totalDiscrepancy = Math.abs(qboTotalAmt - expectedTotal);
          
          if (totalDiscrepancy > 1.0 && billPayload.GlobalTaxCalculation !== "NotApplicable") {
            logInfo(`⚠️ ${doc.doc_number}: DISCREPANCIA detectada! QBO Total=${qboTotalAmt}, Esperado=${expectedTotal}, Diff=${totalDiscrepancy.toFixed(2)}`);
            logInfo(`   🔄 Eliminando Bill ${entityId} y recreando con impuesto redistribuido...`);
            
            // Delete the incorrect bill
            try {
              const deleteUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/bill?operation=delete`;
              await fetchWithRetry(deleteUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${accessToken}`,
                  "Accept": "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ Id: entityId, SyncToken: billData.Bill.SyncToken }),
              });
              logInfo(`   🗑️ ${doc.doc_number}: Bill ${entityId} eliminado`);
            } catch (delErr) {
              logInfo(`   ⚠️ ${doc.doc_number}: No se pudo eliminar Bill ${entityId}, continuando...`);
            }
            
            // Rebuild payload with tax redistributed into lines
            const taxToRedistribute = billPayload.TxnTaxDetail?.TotalTax || totalTax || 0;
            delete billPayload.TxnTaxDetail;
            
            const expenseLines = billPayload.Line.filter((l: any) => l.DetailType === "AccountBasedExpenseLineDetail");
            const linesTotalBeforeTax = expenseLines.reduce((sum: number, l: any) => sum + (l.Amount || 0), 0);
            
            for (const line of billPayload.Line) {
              if (line.AccountBasedExpenseLineDetail?.TaxCodeRef) {
                delete line.AccountBasedExpenseLineDetail.TaxCodeRef;
              }
              if (line.DetailType === "AccountBasedExpenseLineDetail" && taxToRedistribute > 0 && linesTotalBeforeTax > 0) {
                const proportion = line.Amount / linesTotalBeforeTax;
                line.Amount = parseFloat((line.Amount + taxToRedistribute * proportion).toFixed(2));
              }
            }
            billPayload.GlobalTaxCalculation = "NotApplicable";
            
            await delay(1500);
            const verifyRetryResponse = await fetchWithRetry(
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
            
            if (verifyRetryResponse.ok) {
              const retryData = await verifyRetryResponse.json();
              entityId = retryData.Bill.Id;
              logInfo(`✅ ${doc.doc_number}: Bill recreado correctamente (ID: ${entityId}, Total: ${retryData.Bill.TotalAmt})`);
            } else {
              const retryErr = await verifyRetryResponse.text();
              logError(`❌ ${doc.doc_number}: Recreación falló: ${retryErr.substring(0, 300)}`);
              await registerInTracking(doc, 'error', null, null, `Discrepancia de total: QBO=${qboTotalAmt} vs Esperado=${expectedTotal}`);
              await supabase.from("processed_documents").update({ 
                status: "error", 
                error_message: `Discrepancia de total: QBO=${qboTotalAmt} vs Esperado=${expectedTotal}` 
              }).eq("id", doc.id);
              return { success: false, docNumber: doc.doc_number, error: `Total discrepancy: ${totalDiscrepancy.toFixed(2)}` };
            }
          } else if (totalDiscrepancy > 1.0) {
            logInfo(`⚠️ ${doc.doc_number}: Discrepancia de ${totalDiscrepancy.toFixed(2)} (QBO=${qboTotalAmt} vs Esperado=${expectedTotal}) pero ya es NotApplicable, no se puede corregir`);
          }
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
        
        // Attach PDF to QuickBooks Bill - AWAIT to ensure it completes before function terminates
        if (doc.pdf_attachment_url && entityId) {
          try {
            const pdfAttached = await attachPdfToQuickBooks(
              doc.pdf_attachment_url,
              entityId,
              entityType,
              doc.doc_number,
              realmId,
              accessToken,
              supabase
            );
            if (!pdfAttached) {
              logError(`⚠️ ${doc.doc_number}: PDF attachment failed but bill was created successfully`);
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logError(`⚠️ ${doc.doc_number}: PDF attachment error (non-blocking): ${errMsg}`);
          }
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
