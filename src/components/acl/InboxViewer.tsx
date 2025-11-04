import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, FileText, Loader2, CheckCircle2 } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const InboxViewer = () => {
  const { activeOrganization } = useAuth();
  const { 
    inboxItems, 
    setInboxItems, 
    gmailStatus, 
    settings, 
    addToLog,
    providerMap,
    addPreviewItem 
  } = useAppStore();
  
  const [isSearching, setIsSearching] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const handleSearchEmails = async () => {
    if (!activeOrganization || !gmailStatus.connected) {
      toast.error("Gmail no está conectado");
      return;
    }

    setIsSearching(true);
    addToLog({ level: "INFO", message: "Buscando correos en Gmail..." });

    try {
      const { data, error } = await supabase.functions.invoke("fetch-gmail-invoices", {
        body: {
          organization_id: activeOrganization,
          query: settings.queryGmail,
        },
      });

      if (error) throw error;

      setInboxItems(data.messages || []);
      addToLog({ 
        level: "INFO", 
        message: `✓ ${data.messages?.length || 0} correos encontrados` 
      });
      
      toast.success(`${data.messages?.length || 0} correos encontrados`);
    } catch (error: any) {
      console.error("Error searching emails:", error);
      addToLog({ level: "ERROR", message: `Error al buscar correos: ${error.message}` });
      toast.error("Error al buscar correos");
    } finally {
      setIsSearching(false);
    }
  };

  const handleProcessEmail = async (mailItem: any) => {
    if (!activeOrganization) return;

    setProcessingIds(prev => new Set(prev).add(mailItem.id));
    addToLog({ 
      level: "INFO", 
      message: `Procesando correo: ${mailItem.subject}` 
    });

    try {
      // Procesar cada adjunto XML
      for (const attachment of mailItem.attachments) {
        if (attachment.filename.toLowerCase().endsWith('.xml')) {
          // Procesar XML
          const { data: processData, error: processError } = await supabase.functions.invoke(
            "process-document",
            {
              body: {
                organization_id: activeOrganization,
                message_id: mailItem.id,
                attachment_id: attachment.attachmentId,
                filename: attachment.filename,
                categories: providerMap,
              },
            }
          );

          if (processError) {
            addToLog({ 
              level: "ERROR", 
              message: `Error procesando ${attachment.filename}: ${processError.message}` 
            });
            continue;
          }

          // Clasificar vendor
          const { data: classifyData } = await supabase.functions.invoke(
            "classify-vendor",
            {
              body: {
                bill_data: processData.parsed,
                provider_map: providerMap,
              },
            }
          );

          // Crear preview
          const preview = {
            tipo: processData.parsed.esNotaCredito ? "NOTA_CREDITO" : "FACTURA",
            proveedor: processData.parsed.emisor.nombre,
            cedula: processData.parsed.emisor.identificacion,
            fecha: new Date(processData.parsed.fechaEmision),
            moneda: processData.parsed.moneda,
            subtotal: processData.parsed.subTotal,
            descuento: processData.parsed.totalDescuento,
            impuesto: processData.parsed.totalImpuesto,
            total: processData.parsed.totalComprobante,
            lineas: processData.parsed.detalle.map((d: any) => ({
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              gravado: d.tarifa > 0,
              tasaIVA: d.tarifa || 0,
              descuentoLinea: d.montoDescuento || 0,
            })),
            mapping: classifyData?.mapping || {},
            estadoMapeo: classifyData?.estadoMapeo || "PENDIENTE",
            consecutivo: processData.parsed.numeroConsecutivo,
            docKey: `${mailItem.id}_${attachment.attachmentId}`,
            xmlData: processData.xmlData,
            mailId: mailItem.id,
          };

          addPreviewItem(preview as any);
          
          addToLog({ 
            level: "INFO", 
            message: `✓ Procesado: ${processData.parsed.numeroConsecutivo}` 
          });
        }
      }

      toast.success("Correo procesado correctamente");
    } catch (error: any) {
      console.error("Error processing email:", error);
      addToLog({ level: "ERROR", message: `Error: ${error.message}` });
      toast.error("Error al procesar correo");
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(mailItem.id);
        return next;
      });
    }
  };

  if (!gmailStatus.connected) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <Mail className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>Gmail no está conectado</p>
          <p className="text-sm mt-1">Conecta Gmail para buscar correos con facturas</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Mail className="h-5 w-5" />
          📥 Bandeja de Correos
        </h2>
        <Button 
          onClick={handleSearchEmails} 
          disabled={isSearching}
        >
          {isSearching ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Mail className="h-4 w-4 mr-2" />
          )}
          Buscar correos
        </Button>
      </div>

      {inboxItems.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No hay correos en la bandeja</p>
          <p className="text-sm mt-1">Haz clic en "Buscar correos" para cargar</p>
        </div>
      ) : (
        <div className="space-y-2">
          {inboxItems.map((item) => {
            const isProcessing = processingIds.has(item.id);
            const xmlCount = item.attachments.filter(a => 
              a.filename.toLowerCase().endsWith('.xml')
            ).length;
            const pdfCount = item.attachments.filter(a => 
              a.filename.toLowerCase().endsWith('.pdf')
            ).length;

            return (
              <div
                key={item.id}
                className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{item.subject}</h3>
                    <p className="text-sm text-muted-foreground truncate">
                      De: {item.from}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(item.date).toLocaleString()}
                    </p>
                    <div className="flex gap-2 mt-2">
                      {xmlCount > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          <FileText className="h-3 w-3 mr-1" />
                          {xmlCount} XML
                        </Badge>
                      )}
                      {pdfCount > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {pdfCount} PDF
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <Button
                    onClick={() => handleProcessEmail(item)}
                    disabled={isProcessing || xmlCount === 0}
                    size="sm"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Leer y parsear
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};
