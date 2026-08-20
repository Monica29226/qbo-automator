import { supabase } from "@/integrations/supabase/client";

/**
 * Registra en la lista de exclusión permanente las claves (50 dígitos) de los
 * documentos indicados y luego los elimina de processed_documents.
 *
 * Esto evita que la sincronización de correo vuelva a reimportar facturas que
 * el usuario descartó a propósito (por viejas o repetidas).
 */
export async function discardDocuments(
  ids: string[],
  reason: string = "deleted_by_user"
): Promise<void> {
  if (ids.length === 0) return;

  const { data: docs, error: fetchError } = await supabase
    .from("processed_documents")
    .select("id, organization_id, doc_key, doc_number, issue_date, supplier_name")
    .in("id", ids);

  if (fetchError) throw fetchError;

  const rows = (docs || [])
    .filter((d) => d.organization_id && d.doc_key && d.doc_key.length === 50)
    .map((d) => ({
      organization_id: d.organization_id as string,
      doc_key: d.doc_key as string,
      doc_number: d.doc_number,
      issue_date: d.issue_date,
      supplier_name: d.supplier_name,
      reason,
    }));

  if (rows.length > 0) {
    const { error: ignoreError } = await supabase
      .from("ignored_documents")
      .upsert(rows, { onConflict: "organization_id,doc_key" });

    // No bloquear la eliminación si falla el registro, pero dejar constancia.
    if (ignoreError) {
      console.error("⚠️ No se pudo registrar la exclusión permanente:", ignoreError);
    }
  }

  const { error: deleteError } = await supabase
    .from("processed_documents")
    .delete()
    .in("id", ids);

  if (deleteError) throw deleteError;
}
