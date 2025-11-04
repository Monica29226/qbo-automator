import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/appStore";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileSearch, Send, Loader2, Eye } from "lucide-react";

export const PreviewTable = () => {
  const { activeOrganization } = useAuth();
  const { 
    previewItems, 
    selectedItems, 
    toggleItemSelection,
    clearSelection,
    companyId,
    qboStatus,
    updatePreviewItem,
    addToLog
  } = useAppStore();
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);

  const selectedPreviews = previewItems.filter(p => 
    selectedItems.includes(p.docKey || '')
  );

  const handleSyncToQBO = async () => {
    if (!activeOrganization || !companyId || !qboStatus.connected) {
      toast.error("QuickBooks no está configurado correctamente");
      return;
    }

    if (selectedPreviews.length === 0) {
      toast.error("Selecciona al menos un documento");
      return;
    }

    setIsSyncing(true);
    addToLog({ 
      level: "INFO", 
      message: `Iniciando envío de ${selectedPreviews.length} documentos a QBO...` 
    });

    let successCount = 0;
    let errorCount = 0;

    for (const preview of selectedPreviews) {
      try {
        const { data, error } = await supabase.functions.invoke("sync-to-quickbooks", {
          body: {
            organization_id: activeOrganization,
            realm_id: companyId,
            bill_preview: preview,
          },
        });

        if (error) throw error;

        if (data.isDuplicate) {
          updatePreviewItem(preview.docKey!, {
            duplicateCheck: {
              isDuplicate: true,
              existingId: data.existingId,
            },
          });
          
          addToLog({ 
            level: "WARN", 
            message: `⚠ Duplicado: ${preview.consecutivo}` 
          });
          errorCount++;
        } else {
          updatePreviewItem(preview.docKey!, {
            creadoEnQBO: {
              id: data.entityId,
              fecha: new Date(),
            },
          });
          
          addToLog({ 
            level: "INFO", 
            message: `✓ Creado en QBO: ${preview.consecutivo} (ID: ${data.entityId})` 
          });
          successCount++;
        }
      } catch (error: any) {
        console.error(`Error syncing ${preview.consecutivo}:`, error);
        addToLog({ 
          level: "ERROR", 
          message: `Error en ${preview.consecutivo}: ${error.message}` 
        });
        errorCount++;
      }
    }

    setIsSyncing(false);
    clearSelection();

    if (successCount > 0) {
      toast.success(`${successCount} documentos creados en QBO`);
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} documentos con errores`);
    }
  };

  if (previewItems.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center py-8 text-muted-foreground">
          <FileSearch className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No hay documentos en previsualización</p>
          <p className="text-sm mt-1">Procesa correos para ver los documentos aquí</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileSearch className="h-5 w-5" />
              📋 Previsualización
            </h2>
            <p className="text-sm text-muted-foreground">
              {selectedPreviews.length} de {previewItems.length} seleccionados
            </p>
          </div>
          
          <Button
            onClick={handleSyncToQBO}
            disabled={isSyncing || selectedPreviews.length === 0 || !qboStatus.connected}
          >
            {isSyncing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Crear en QBO ({selectedPreviews.length})
              </>
            )}
          </Button>
        </div>

        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedPreviews.length === previewItems.length}
                    onCheckedChange={() => {
                      if (selectedPreviews.length === previewItems.length) {
                        clearSelection();
                      } else {
                        previewItems.forEach(p => {
                          if (!selectedItems.includes(p.docKey || '')) {
                            toggleItemSelection(p.docKey || '');
                          }
                        });
                      }
                    }}
                  />
                </TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Consecutivo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>QBO</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewItems.map((item) => (
                <TableRow key={item.docKey}>
                  <TableCell>
                    <Checkbox
                      checked={selectedItems.includes(item.docKey || '')}
                      onCheckedChange={() => toggleItemSelection(item.docKey || '')}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.tipo === 'FACTURA' ? 'default' : 'secondary'}>
                      {item.tipo === 'FACTURA' ? 'Bill' : 'NC'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{item.proveedor}</TableCell>
                  <TableCell className="font-mono text-xs">{item.consecutivo}</TableCell>
                  <TableCell>{new Date(item.fecha).toLocaleDateString()}</TableCell>
                  <TableCell>{item.moneda}</TableCell>
                  <TableCell className="text-right">
                    {item.total.toLocaleString('es-CR', { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.estadoMapeo === 'OK' ? 'default' :
                        item.estadoMapeo === 'OBSERVACIONES' ? 'destructive' :
                        'secondary'
                      }
                    >
                      {item.estadoMapeo}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.creadoEnQBO ? (
                      <Badge variant="outline" className="text-xs text-success">
                        ✓ {item.creadoEnQBO.id}
                      </Badge>
                    ) : item.duplicateCheck?.isDuplicate ? (
                      <Badge variant="destructive" className="text-xs">
                        Duplicado
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDetailItem(item)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!detailItem} onOpenChange={() => setDetailItem(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Documento</DialogTitle>
          </DialogHeader>
          
          {detailItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Proveedor</p>
                  <p>{detailItem.proveedor}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Cédula</p>
                  <p className="font-mono">{detailItem.cedula}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Consecutivo</p>
                  <p className="font-mono text-sm">{detailItem.consecutivo}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Cuenta Gasto</p>
                  <p>{detailItem.mapping?.cuentaGasto || '-'}</p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Líneas del Documento</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="text-right">IVA</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailItem.lineas.map((linea: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell>{linea.descripcion}</TableCell>
                        <TableCell className="text-right">{linea.cantidad}</TableCell>
                        <TableCell className="text-right">
                          {linea.precioUnitario.toLocaleString('es-CR')}
                        </TableCell>
                        <TableCell className="text-right">{linea.tasaIVA}%</TableCell>
                        <TableCell className="text-right">
                          {(linea.cantidad * linea.precioUnitario).toLocaleString('es-CR')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-end space-y-1 flex-col items-end">
                  <div className="flex justify-between w-48">
                    <span className="text-sm">Subtotal:</span>
                    <span className="font-mono">{detailItem.subtotal.toLocaleString('es-CR')}</span>
                  </div>
                  <div className="flex justify-between w-48">
                    <span className="text-sm">Descuento:</span>
                    <span className="font-mono">{detailItem.descuento.toLocaleString('es-CR')}</span>
                  </div>
                  <div className="flex justify-between w-48">
                    <span className="text-sm">Impuesto:</span>
                    <span className="font-mono">{detailItem.impuesto.toLocaleString('es-CR')}</span>
                  </div>
                  <div className="flex justify-between w-48 border-t pt-1">
                    <span className="font-bold">Total:</span>
                    <span className="font-mono font-bold">{detailItem.total.toLocaleString('es-CR')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
