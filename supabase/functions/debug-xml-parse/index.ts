import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SECURITY: verify the caller is an authenticated user before exposing internal parser data.
async function requireAuthenticatedUser(req: Request): Promise<Response | null> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}

// ============ XML helpers (same logic as process-document-xml) ============

function parseXMLValue(xml: string, tag: string): string {
  let regex = new RegExp(`<[\\w]*:?${tag}[^>]*>([^<]*)<\\/[\\w]*:?${tag}>`, 'i');
  let match = xml.match(regex);
  if (match) return match[1].trim();
  regex = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
  match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXMLBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'gi');
  const blocks: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) blocks.push(match[1]);
  return blocks;
}

function parseFirstXMLBlock(xml: string, tag: string): string {
  return parseXMLBlocks(xml, tag)[0] || '';
}

function parseNumber(...values: Array<string | number | null | undefined>): number {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).replace(/,/g, '').trim();
    if (!normalized) continue;
    const parsed = parseFloat(normalized);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function isInvoiceXml(xml: string): boolean {
  return /<(?:[\w]+:)?(?:FacturaElectronica|NotaCreditoElectronica|NotaDebitoElectronica|TiqueteElectronico)\b/i.test(xml);
}

function detectDocType(xml: string): string {
  if (/NotaCreditoElectronica/i.test(xml)) return 'NotaCreditoElectronica';
  if (/NotaDebitoElectronica/i.test(xml)) return 'NotaDebitoElectronica';
  if (/TiqueteElectronico/i.test(xml)) return 'TiqueteElectronico';
  if (/FacturaElectronica/i.test(xml)) return 'FacturaElectronica';
  return 'Unknown';
}

function parseIssueDate(xml: string): string {
  const rawDate = parseXMLValue(xml, 'FechaEmision') || parseXMLValue(xml, 'FechaEmisionDoc') || parseXMLValue(xml, 'Fecha');
  if (!rawDate) return '';
  return rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
}

function parseNumeroConsecutivo(xml: string): string {
  const directValue = parseXMLValue(xml, 'NumeroConsecutivo');
  if (directValue && directValue.length > 0 && directValue.length <= 25) return directValue;
  const clave = parseXMLValue(xml, 'Clave');
  if (clave && clave.length === 50) return clave.substring(30, 50);
  if (directValue && directValue.length > 25) return directValue.substring(directValue.length - 20);
  return directValue || '';
}

function parseReceptorData(xml: string) {
  const receptorXml = parseFirstXMLBlock(xml, 'Receptor');
  if (!receptorXml) return { nombre: '', identificacion: '' };
  const nombre = parseXMLValue(receptorXml, 'Nombre');
  let identificacion = parseXMLValue(receptorXml, 'Numero') || parseXMLValue(receptorXml, 'NumeroIdentificacion');
  if (!identificacion) {
    const idXml = parseFirstXMLBlock(receptorXml, 'Identificacion');
    if (idXml) identificacion = parseXMLValue(idXml, 'Numero');
  }
  return { nombre, identificacion };
}

function parseEmisorData(xml: string) {
  const emisorXml = parseFirstXMLBlock(xml, 'Emisor');
  if (!emisorXml) {
    return {
      nombre: parseXMLValue(xml, 'Nombre'),
      identificacion: parseXMLValue(xml, 'Numero') || parseXMLValue(xml, 'NumeroIdentificacion'),
      email: parseXMLValue(xml, 'CorreoElectronico'),
    };
  }
  const nombre = parseXMLValue(emisorXml, 'Nombre');
  let identificacion = parseXMLValue(emisorXml, 'Numero') || parseXMLValue(emisorXml, 'NumeroIdentificacion');
  if (!identificacion) {
    const idXml = parseFirstXMLBlock(emisorXml, 'Identificacion');
    if (idXml) identificacion = parseXMLValue(idXml, 'Numero');
  }
  const email = parseXMLValue(emisorXml, 'CorreoElectronico');
  return { nombre, identificacion, email };
}

function normalizeTaxId(value?: string | null): string {
  return (value || '').replace(/[^0-9]/g, '').replace(/^0+/, '').trim();
}

function normalizeLegalName(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/sociedad anonima|sociedad de responsabilidad limitada|s\.?a\.?|s\.?r\.?l\.?/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLineItems(xml: string) {
  const items: any[] = [];
  let n = 1;
  for (const lineXml of parseXMLBlocks(xml, 'LineaDetalle')) {
    const descripcion = parseXMLValue(lineXml, 'Detalle') || parseXMLValue(lineXml, 'NombreComercial') || '';
    const cantidad = parseNumber(parseXMLValue(lineXml, 'Cantidad')) || 1;
    const precioUnitario = parseNumber(parseXMLValue(lineXml, 'PrecioUnitario'));
    const montoTotal = parseNumber(parseXMLValue(lineXml, 'MontoTotal')) || cantidad * precioUnitario;
    const montoDescuento = parseNumber(parseXMLValue(lineXml, 'MontoDescuento'));
    const subtotal = parseNumber(parseXMLValue(lineXml, 'SubTotal')) || montoTotal;
    const baseImponible = parseNumber(parseXMLValue(lineXml, 'BaseImponible')) || subtotal;
    const montoTotalLinea = parseNumber(parseXMLValue(lineXml, 'MontoTotalLinea'));
    const impuestos: any[] = [];
    for (const taxXml of parseXMLBlocks(lineXml, 'Impuesto')) {
      impuestos.push({
        codigo: parseXMLValue(taxXml, 'Codigo'),
        tarifa: parseNumber(parseXMLValue(taxXml, 'Tarifa')),
        monto: parseNumber(parseXMLValue(taxXml, 'Monto')),
        codigoTarifaIVA: parseXMLValue(taxXml, 'CodigoTarifaIVA'),
      });
    }
    items.push({
      numeroLinea: n++,
      descripcion,
      cantidad,
      precioUnitario,
      montoTotal,
      montoDescuento,
      subtotal,
      baseImponible,
      montoTotalLinea,
      impuestos,
    });
  }
  return items;
}

// ============ Main ============

interface Step {
  step: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  message: string;
  data?: any;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authError = await requireAuthenticatedUser(req);
  if (authError) return authError;


  const trace: Step[] = [];
  const log = (step: string, status: Step['status'], message: string, data?: any) => {
    trace.push({ step, status, message, data });
  };

  try {
    const { xml_content, organization_id } = await req.json();

    if (!xml_content || typeof xml_content !== 'string') {
      return new Response(JSON.stringify({ error: 'xml_content requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log('1. Recepción XML', 'ok', `XML recibido (${xml_content.length} bytes)`);

    // 2. Tipo
    const docType = detectDocType(xml_content);
    if (!isInvoiceXml(xml_content)) {
      log('2. Tipo de documento', 'error', 'No es Factura/Tiquete/Nota Crédito/Débito', { docType });
    } else {
      log('2. Tipo de documento', 'ok', `Detectado: ${docType}`);
    }

    // 3. Datos básicos
    const clave = parseXMLValue(xml_content, 'Clave');
    const docNumber = parseNumeroConsecutivo(xml_content);
    const issueDate = parseIssueDate(xml_content);
    log('3. Identificación', clave && docNumber && issueDate ? 'ok' : 'warn', 'Datos cabecera', {
      clave, docNumber, issueDate,
    });

    // 4. Emisor / Receptor
    const emisor = parseEmisorData(xml_content);
    const receptor = parseReceptorData(xml_content);
    log('4. Emisor', emisor.nombre ? 'ok' : 'error', emisor.nombre ? `Emisor: ${emisor.nombre}` : 'Emisor no encontrado', emisor);
    log('5. Receptor', receptor.nombre ? 'ok' : 'warn', receptor.nombre ? `Receptor: ${receptor.nombre}` : 'Receptor no encontrado', receptor);

    // 6. Validación contra organización
    let orgInfo: any = null;
    if (organization_id) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: org } = await supabase
        .from('organizations')
        .select('name, tax_id, identification_number')
        .eq('id', organization_id)
        .single();
      orgInfo = org;
      if (!org) {
        log('6. Validación organización', 'error', 'Organización no encontrada');
      } else {
        const orgIds = [normalizeTaxId(org.tax_id), normalizeTaxId(org.identification_number)].filter(Boolean);
        const recId = normalizeTaxId(receptor.identificacion);
        const recName = normalizeLegalName(receptor.nombre);
        const orgName = normalizeLegalName(org.name);
        const matchById = !!recId && orgIds.includes(recId);
        const matchByName = !recId && !!recName && !!orgName && (recName.includes(orgName) || orgName.includes(recName));
        if (orgIds.length === 0) {
          log('6. Validación organización', 'error', 'Organización sin cédula configurada (Mi Empresa)', { org });
        } else if (recId && !matchById) {
          log('6. Validación organización', 'error', 'Cédula del receptor NO coincide con la organización', {
            receptor: { id: receptor.identificacion, normalized: recId },
            organizacion: { ids: orgIds, name: org.name },
          });
        } else if (!recId && receptor.nombre && !matchByName) {
          log('6. Validación organización', 'error', 'Receptor sin cédula y nombre no coincide', {
            receptor: receptor.nombre, organizacion: org.name,
          });
        } else {
          log('6. Validación organización', 'ok', `Receptor válido (${matchById ? 'por cédula' : 'por nombre'})`);
        }
      }
    } else {
      log('6. Validación organización', 'info', 'Sin organization_id (validación omitida)');
    }

    // 7. Totales
    const subtotalResumen = parseNumber(
      parseXMLValue(xml_content, 'TotalVentaNeta'),
      parseXMLValue(xml_content, 'TotalGravado'),
      parseXMLValue(xml_content, 'TotalVenta'),
    );
    const totalImpuesto = parseNumber(parseXMLValue(xml_content, 'TotalImpuesto'));
    const totalDescuentos = parseNumber(parseXMLValue(xml_content, 'TotalDescuentos'));
    const totalComprobante = parseNumber(parseXMLValue(xml_content, 'TotalComprobante'));
    const currency = parseXMLValue(xml_content, 'CodigoMoneda') || 'CRC';
    const exchangeRate = parseNumber(parseXMLValue(xml_content, 'TipoCambio')) || 1;
    log('7. Totales (Resumen)', totalComprobante ? 'ok' : 'warn', 'Totales del bloque ResumenFactura', {
      subtotalResumen, totalImpuesto, totalDescuentos, totalComprobante, currency, exchangeRate,
    });

    // 8. Líneas
    const lines = parseLineItems(xml_content);
    log('8. Líneas detalle', lines.length > 0 ? 'ok' : 'error', `${lines.length} línea(s) detectadas`, lines);

    // 9. Validación de cuadre
    const sumLineas = lines.reduce((s, l) => s + parseNumber(l.montoTotalLinea), 0);
    const sumImpuestos = lines.reduce((s, l) => s + l.impuestos.reduce((a: number, i: any) => a + parseNumber(i.monto), 0), 0);
    const cuadra = Math.abs(sumLineas - totalComprobante) < 1;
    log('9. Cuadre montos', cuadra ? 'ok' : 'warn', cuadra ? 'Suma líneas = TotalComprobante' : 'Suma líneas NO coincide con TotalComprobante', {
      sumaLineas: sumLineas, totalComprobante, diferencia: sumLineas - totalComprobante,
      sumaImpuestosLineas: sumImpuestos, totalImpuestoResumen: totalImpuesto,
    });

    // Parsed JSON summary
    const parsed = {
      doc_type: docType,
      doc_key: clave,
      doc_number: docNumber,
      issue_date: issueDate,
      currency,
      exchange_rate: exchangeRate,
      supplier: emisor,
      receiver: receptor,
      totals: { subtotalResumen, totalImpuesto, totalDescuentos, totalComprobante },
      lines,
    };

    return new Response(JSON.stringify({ success: true, parsed, trace, organization: orgInfo }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    trace.push({ step: 'Excepción', status: 'error', message: e?.message || String(e) });
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e), trace }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
