import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Download, ExternalLink, RefreshCw } from 'lucide-react';

interface PdfViewerProps {
  url: string;
  fileName?: string;
}

export const PdfViewer = ({ url, fileName = 'documento' }: PdfViewerProps) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Detectar si es blob URL
  const isBlobUrl = url.startsWith('blob:');
  
  // URL para el iframe
  const iframeSrc = useMemo(() => {
    if (isBlobUrl) {
      return url;
    }
    return `${url}#toolbar=1&navpanes=0`;
  }, [url, isBlobUrl]);

  // Reset state when URL changes
  useEffect(() => {
    setLoading(true);
    setError(null);
    console.log('📄 PdfViewer cargando:', isBlobUrl ? 'Blob URL' : url);
    
    // Timeout de 10 segundos para detectar si no carga
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (loading) {
        console.log('⏱️ PDF timeout - mostrando de todos modos');
        setLoading(false);
      }
    }, 10000);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [url, isBlobUrl]);

  const handleIframeLoad = () => {
    console.log('✅ PDF iframe cargado');
    setLoading(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  const handleIframeError = () => {
    console.log('❌ PDF iframe error');
    setError('Error al cargar el PDF');
    setLoading(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  const openInNewTab = () => {
    if (isBlobUrl) {
      // Para blob URLs, crear un nuevo tab con el contenido
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head><title>${fileName}</title></head>
            <body style="margin:0;padding:0;">
              <embed src="${url}" type="application/pdf" width="100%" height="100%" style="position:absolute;top:0;left:0;right:0;bottom:0;">
            </body>
          </html>
        `);
      }
    } else {
      window.open(url, '_blank');
    }
  };
  
  const retry = () => {
    setLoading(true);
    setError(null);
    setIframeKey(prev => prev + 1);
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
          <p className="text-lg font-medium text-destructive">Error al cargar el PDF</p>
          <p className="text-sm text-muted-foreground max-w-md">{error}</p>
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="outline" onClick={retry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
          <Button variant="outline" onClick={openInNewTab}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Abrir en nueva pestaña
          </Button>
          <Button onClick={downloadPdf}>
            <Download className="h-4 w-4 mr-2" />
            Descargar PDF
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
      <div className="flex-1 relative bg-muted/10 min-h-[400px]">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 z-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Cargando PDF...</p>
          </div>
        )}
        
        {/* Use embed for blob URLs, iframe for regular URLs */}
        {isBlobUrl ? (
          <embed
            key={iframeKey}
            src={url}
            type="application/pdf"
            className="w-full h-full"
            onLoad={handleIframeLoad}
          />
        ) : (
          <iframe
            key={iframeKey}
            src={iframeSrc}
            className="w-full h-full border-0"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            title={fileName}
          />
        )}
      </div>
    </div>
  );
};

export default PdfViewer;
