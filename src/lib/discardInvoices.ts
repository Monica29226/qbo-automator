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

  // La función de base de datos registra la exclusión y elimina en una sola
  // transacción. Si no puede guardar la clave, tampoco borra el documento.
  const { error } = await supabase.rpc("discard_processed_documents", {
    _document_ids: ids,
    _reason: reason,
  });

  if (error) throw error;
}
