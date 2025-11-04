import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Filter, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { toast } from "sonner";
import { useState } from "react";

export const ProcessingLogs = () => {
  const { processingLog, clearLog } = useAppStore();
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');

  const filteredLogs = filterLevel === 'ALL' 
    ? processingLog 
    : processingLog.filter(log => log.level === filterLevel);

  const copyLogs = () => {
    const text = filteredLogs
      .map(log => `[${log.ts.toLocaleString('es-CR')}] ${log.level}: ${log.message}`)
      .join('\n');
    
    navigator.clipboard.writeText(text);
    toast.success('Registro copiado al portapapeles');
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">📋 Registro de Actividad</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setFilterLevel('ALL')}>
            Todos
          </Button>
          <Button variant="outline" size="sm" onClick={() => setFilterLevel('INFO')}>
            INFO
          </Button>
          <Button variant="outline" size="sm" onClick={() => setFilterLevel('WARN')}>
            WARN
          </Button>
          <Button variant="outline" size="sm" onClick={() => setFilterLevel('ERROR')}>
            ERROR
          </Button>
          <Button variant="outline" size="sm" onClick={copyLogs}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={clearLog}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[300px] rounded-lg border bg-muted/20 p-4">
        {filteredLogs.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No hay entradas de registro{filterLevel !== 'ALL' ? ` de tipo ${filterLevel}` : ''}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLogs.map((log, index) => (
              <div key={index} className="flex items-start gap-3 text-sm">
                <Badge
                  variant={
                    log.level === 'ERROR' ? 'destructive' :
                    log.level === 'WARN' ? 'secondary' :
                    'outline'
                  }
                  className="shrink-0 min-w-[60px] justify-center"
                >
                  {log.level}
                </Badge>
                <span className="text-muted-foreground text-xs shrink-0">
                  {log.ts.toLocaleTimeString('es-CR')}
                </span>
                <span className="flex-1">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {processingLog.length > 50 && (
        <p className="text-xs text-muted-foreground mt-2">
          Mostrando últimas 100 entradas
        </p>
      )}
    </Card>
  );
};
