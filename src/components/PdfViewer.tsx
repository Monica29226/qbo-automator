import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Download, ExternalLink, RefreshCw } from 'lucide-react';

interface PdfViewerProps {
  url: string;
  fileName?: string;
}

export const PdfViewer = ({ url, fileName = 'documento' }: PdfViewerProps) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const objectRef = useRef<HTMLObjectElement>(null);

  // Detectar si es blob URL
  const isBlobUrl = url.startsWith('blob:');

  useEffect(() => {
    setLoading(true);
    setError(null);
    console.log('📄 PdfViewer cargando:', isBlobUrl ? 'Blob URL' : url);
    
    // Para blob URLs, simplemente mostrar después de un breve delay
    // ya que el blob ya está en memoria
    if (isBlobUrl) {
      const timer = setTimeout(() => {
        setLoading(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [url, isBlobUrl]);

  const handleLoad = () => {
    console.log('✅ PDF cargado');
    setLoading(false);
  };

  const handleError = () => {
    console.log('❌ Error cargando PDF');
    setError('No se pudo mostrar el PDF en el visor');
    setLoading(false);
  };

  const openInNewTab = () => {
    if (isBlobUrl) {
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head><title>${fileName}</title></head>
            <body style="margin:0;padding:0;height:100vh;">
              <iframe src="${url}" style="width:100%;height:100%;border:none;"></iframe>
            </body>
          </html>
        `);
        newWindow.document.close();
      }
    } else {
      window.open(url, '_blank');
    }
  };

  const downloadPdf = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center bg-muted/20">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <div className="space-y-2">
          <p className="text-lg font-medium">PDF disponible</p>
          <p className="text-sm text-muted-foreground">El visor no pudo cargar. Use las opciones abajo.</p>
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="default" onClick={openInNewTab}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Abrir en nueva pestaña
          </Button>
          <Button variant="outline" onClick={downloadPdf}>
            <Download className="h-4 w-4 mr-2" />
            Descargar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-end px-4 py-2 border-b bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={openInNewTab} title="Abrir en nueva pestaña">
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={downloadPdf} title="Descargar PDF">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Content */}
      <div className="flex-1 relative bg-white min-h-[500px]">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 z-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Cargando PDF...</p>
          </div>
        )}
        
        {/* Object tag with iframe fallback */}
        <object
          ref={objectRef}
          data={url}
          type="application/pdf"
          className="w-full h-full"
          onLoad={handleLoad}
          onError={handleError}
        >
          {/* Fallback: iframe */}
          <iframe
            src={url}
            className="w-full h-full border-0"
            title={fileName}
          />
        </object>
      </div>
    </div>
  );
};

export default PdfViewer;
