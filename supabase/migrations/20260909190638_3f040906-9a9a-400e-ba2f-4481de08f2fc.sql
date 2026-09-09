CREATE OR REPLACE FUNCTION public.compras_formato_gti(p_desde date, p_hasta date)
RETURNS TABLE (
  organization_id uuid,
  empresa text,
  cedula_empresa text,
  doc_key text,
  consecutivo text,
  issue_date date,
  cedula_emisor text,
  nombre_emisor text,
  tipo text,
  moneda text,
  tipo_cambio numeric,
  t1 numeric,
  t2 numeric,
  t4 numeric,
  t8 numeric,
  t13 numeric,
  iva_total numeric,
  base_gravada numeric,
  descuento numeric,
  otros_cargos numeric,
  total_comprobante numeric,
  exento numeric,
  revisar boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH b AS (
  SELECT d.id, d.organization_id, d.doc_key, d.doc_type, d.issue_date, d.xml_data,
    coalesce(d.currency,'CRC') AS mon,
    CASE WHEN coalesce(d.currency,'CRC')='CRC' THEN 1
         ELSE coalesce(nullif((d.xml_data->>'tipoCambio')::numeric,0), d.exchange_rate, 1) END AS tc,
    CASE WHEN d.doc_type='NotaCreditoElectronica' THEN -1 ELSE 1 END AS sg
  FROM processed_documents d
  WHERE d.issue_date >= p_desde AND d.issue_date < p_hasta
    AND d.doc_type <> 'TiqueteElectronico'
    AND coalesce((d.xml_data->>'aceptada')::boolean, true)
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_organization_member(auth.uid(), d.organization_id)
    )
), l AS (
  SELECT b.id, b.sg, b.tc,
    CASE WHEN imp->>'codigoTarifaIVA'='08' THEN 13 WHEN imp->>'codigoTarifaIVA'='07' THEN 8
         WHEN imp->>'codigoTarifaIVA'='04' THEN 4  WHEN imp->>'codigoTarifaIVA'='03' THEN 2
         WHEN imp->>'codigoTarifaIVA'='02' THEN 1
         WHEN imp->>'codigoTarifaIVA' IN ('01','10','11') THEN 0
         WHEN coalesce((imp->>'tarifa')::numeric,0)>=10.5 THEN 13
         WHEN coalesce((imp->>'tarifa')::numeric,0)>=6    THEN 8
         WHEN coalesce((imp->>'tarifa')::numeric,0)>=3    THEN 4
         WHEN coalesce((imp->>'tarifa')::numeric,0)>=1.5  THEN 2
         WHEN coalesce((imp->>'tarifa')::numeric,0)>=0.75 THEN 1 ELSE 0 END AS pct,
    abs(coalesce((imp->>'monto')::numeric,0)) * b.tc * b.sg AS iva,
    ((imp->>'codigoTarifaIVA') IS NULL OR (imp->>'codigoTarifaIVA')='')
      AND coalesce((imp->>'tarifa')::numeric,0)>0 AS dudosa
  FROM b, LATERAL jsonb_array_elements(b.xml_data->'detalle') ln,
       LATERAL jsonb_array_elements(coalesce(ln->'impuestos','[]'::jsonb)) imp
), a AS (
  SELECT l.id,
    round(sum(iva) FILTER (WHERE pct=13),2) i13, round(sum(iva) FILTER (WHERE pct=8),2) i8,
    round(sum(iva) FILTER (WHERE pct=4),2)  i4,  round(sum(iva) FILTER (WHERE pct=2),2) i2,
    round(sum(iva) FILTER (WHERE pct=1),2)  i1,  round(sum(iva),2) iva_tot,
    round(sum(CASE WHEN pct>0 THEN iva/(pct/100.0) ELSE 0 END),2) base_grav,
    bool_or(dudosa) revisar
  FROM l GROUP BY l.id
)
SELECT b.organization_id, o.name AS empresa, o.tax_id AS cedula_empresa,
  b.doc_key, b.xml_data->>'numeroConsecutivo' AS consecutivo, b.issue_date,
  b.xml_data->'emisor'->>'identificacion' AS cedula_emisor,
  b.xml_data->'emisor'->>'nombre' AS nombre_emisor,
  CASE WHEN b.doc_type='NotaCreditoElectronica' THEN 'NC'
       WHEN b.doc_type='NotaDebitoElectronica'  THEN 'ND' ELSE 'FE' END AS tipo,
  b.mon AS moneda, round(b.tc,4) AS tipo_cambio,
  coalesce(a.i1,0) AS t1, coalesce(a.i2,0) AS t2, coalesce(a.i4,0) AS t4,
  coalesce(a.i8,0) AS t8, coalesce(a.i13,0) AS t13,
  coalesce(a.iva_tot,0) AS iva_total, coalesce(a.base_grav,0) AS base_gravada,
  round(abs(coalesce((b.xml_data->>'totalDescuentos')::numeric,0))*b.tc*b.sg,2)  AS descuento,
  round(abs(coalesce((b.xml_data->>'totalOtrosCargos')::numeric,0))*b.tc*b.sg,2) AS otros_cargos,
  round(abs(coalesce((b.xml_data->>'totalComprobante')::numeric,0))*b.tc*b.sg,2) AS total_comprobante,
  round(abs(coalesce((b.xml_data->>'totalComprobante')::numeric,0))*b.tc*b.sg
        - coalesce(a.base_grav,0) - coalesce(a.iva_tot,0),2) AS exento,
  coalesce(a.revisar,false) AS revisar
FROM b JOIN organizations o ON o.id=b.organization_id
LEFT JOIN a ON a.id=b.id
ORDER BY o.name, b.issue_date, 5;
$$;

REVOKE ALL ON FUNCTION public.compras_formato_gti(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compras_formato_gti(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compras_formato_gti(date, date) TO service_role;