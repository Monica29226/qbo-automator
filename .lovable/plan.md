## Hallazgo confirmado
La factura `00400001010000293929` repite el mismo patrón que reportaste:
- En el documento procesado el XML está correcto: `totalComprobante = 6,939.33` y `totalImpuesto = 798.33`.
- Ya fue publicada en contabilidad el `2026-06-02`, antes del endurecimiento reciente de la función.
- La organización es **Tree of Life** y sigue usando la combinación sensible `tax_handling = included_in_line_items` + `default_uses_tax = false`.
- No quedó una alerta histórica para esa factura, así que hoy el sistema no te la está señalando retroactivamente.

## Plan
1. **Auditar retroactivamente publicaciones afectadas**
   - Revisar facturas ya publicadas bajo esa configuración sensible.
   - Comparar XML (`totalComprobante`, `totalImpuesto`) contra el tracking guardado y dejar una lista de documentos sospechosos para revisión/republicación.
   - Empezar por Tree of Life y extender a cualquier otra organización que haya pasado por la misma lógica.

2. **Persistir la discrepancia como estado operativo visible**
   - Cuando la validación post-publicación detecte diferencia entre contabilidad y XML, no solo registrar alerta: también dejar el documento en un estado claramente revisable y visible en la app.
   - Mostrar el motivo exacto con monto XML, monto en contabilidad y diferencia.

3. **Bloquear configuraciones ambiguas antes de publicar**
   - Endurecer la función para que, si una combinación fiscal puede producir recalculo externo o no permite garantizar coincidencia literal con el XML, la publicación se detenga antes de enviarse.
   - Mantener la regla de “XML manda” como obligatoria, sin comportamiento variable por empresa.

4. **Preparar recuperación segura de casos ya dañados**
   - Dejar identificadas las facturas que requieren borrar y republicar en contabilidad.
   - Evitar que vuelvan a salir como “publicadas sanas” si ya nacieron con discrepancia.

## Detalles técnicos
- Revisaré y ajustaré principalmente:
  - `supabase/functions/publish-to-quickbooks/index.ts`
  - la persistencia de alertas / estado en `processed_documents` y `qbo_publish_tracking`
  - la UI de revisión donde se exponen errores y discrepancias
- La auditoría se basará en:
  - `processed_documents.doc_number`, `doc_key`, `total_amount`, `total_tax`, `status`
  - `qbo_publish_tracking.total_amount`, `status`, `error_message`
  - `system_settings.tax_handling` y `system_settings.default_uses_tax`

## Resultado esperado
- La app detecta automáticamente este tipo de casos viejos.
- Nuevas publicaciones quedan bloqueadas si no pueden respetar literalmente el XML.
- Los documentos afectados quedan visibles para corrección, en vez de pasar silenciosamente como publicados.

Si apruebas, implemento este blindaje y la auditoría retroactiva.