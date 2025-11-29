import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Download, ExternalLink, CheckCircle2 } from 'lucide-react';

interface PdfViewerProps {
  url: string;
  fileName?: string;
}

export const PdfViewer = ({ url, fileName = 'documento' }: PdfViewerProps) => {
  const [opened, setOpened] = useState(false);

  const openInNewTab = () => {
    // Crear una nueva ventana con el PDF
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${fileName}</title>
            <style>
              body { margin: 0; padding: 0; height: 100vh; overflow: hidden; }
              iframe { width: 100%; height: 100%; border: none; }
            </style>
          </head>
          <body>
            <iframe src="${url}"></iframe>
          </body>
        </html>
      `);
      newWindow.document.close();
      setOpened(true);
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

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center bg-gradient-to-b from-muted/30 to-muted/10">
      <div className="w-24 h-32 bg-white rounded-lg shadow-lg flex items-center justify-center border-2 border-primary/20">
        <FileText className="h-12 w-12 text-primary" />
      </div>
      
      <div className="space-y-2">
        <h3 className="text-xl font-semibold">{fileName}</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          PDF listo para visualizar
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mt-2">
        <Button 
          size="lg" 
          onClick={openInNewTab}
          className="gap-2"
        >
          {opened ? (
            <>
              <CheckCircle2 className="h-5 w-5" />
              Abierto - Abrir de nuevo
            </>
          ) : (
            <>
              <ExternalLink className="h-5 w-5" />
              Ver PDF
            </>
          )}
        </Button>
        
        <Button 
          variant="outline" 
          size="lg" 
          onClick={downloadPdf}
          className="gap-2"
        >
          <Download className="h-5 w-5" />
          Descargar
        </Button>
      </div>

      {opened && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          PDF abierto en nueva pestaña
        </p>
      )}
    </div>
  );
};

export default PdfViewer;
