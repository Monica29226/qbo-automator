import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Download, ExternalLink, Loader2 } from 'lucide-react';

interface PdfViewerProps {
  url: string;
  fileName?: string;
}

export const PdfViewer = ({ url, fileName = 'documento' }: PdfViewerProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const openInNewTab = () => {
    window.open(url, '_blank');
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
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground">No se pudo mostrar el PDF en el visor</p>
        <div className="flex gap-2">
          <Button onClick={openInNewTab} className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Abrir en nueva pestaña
          </Button>
          <Button variant="outline" onClick={downloadPdf} className="gap-2">
            <Download className="h-4 w-4" />
            Descargar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[500px]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      <iframe
        src={url}
        className="w-full h-full border-0"
        title={fileName}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </div>
  );
};

export default PdfViewer;
