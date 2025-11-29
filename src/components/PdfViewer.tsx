import { useState, useEffect } from 'react';
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

  // Reset state when URL changes
  useEffect(() => {
    setLoading(true);
    setError(null);
  }, [url]);

  const handleIframeLoad = () => {
    setLoading(false);
  };

  const handleIframeError = () => {
    setError('Error al cargar el PDF');
    setLoading(false);
  };

  const openInNewTab = () => window.open(url, '_blank');
  
  const retry = () => {
    setLoading(true);
    setError(null);
    setIframeKey(prev => prev + 1);
  };

  // Construct Google Docs viewer URL for better compatibility
  const googleViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;

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
          <a
            href={url}
            download={`${fileName}.pdf`}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4"
          >
            <Download className="h-4 w-4 mr-2" />
            Descargar PDF
          </a>
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
          <a
            href={url}
            download={`${fileName}.pdf`}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 w-8"
            title="Descargar PDF"
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* PDF Content */}
      <div className="flex-1 relative bg-muted/10">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 z-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Cargando PDF...</p>
          </div>
        )}
        
        {/* Direct iframe - fastest option */}
        <iframe
          key={iframeKey}
          src={`${url}#toolbar=1&navpanes=0`}
          className="w-full h-full border-0"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          title={fileName}
        />
      </div>
    </div>
  );
};

export default PdfViewer;
