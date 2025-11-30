import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Download, ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface PdfViewerProps {
  url?: string;
  storagePath?: string;
  fileName?: string;
}

export const PdfViewer = ({ url, storagePath, fileName = 'documento' }: PdfViewerProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (url) {
      setSignedUrl(url);
      setLoading(false);
      return;
    }
    
    if (storagePath) {
      generateSignedUrl();
    }
  }, [url, storagePath]);

  const generateSignedUrl = async () => {
    setLoading(true);
    setError(false);
    
    try {
      const { data, error: signedUrlError } = await supabase.storage
        .from('company-documents')
        .createSignedUrl(storagePath!, 3600); // 1 hora de expiración
      
      if (signedUrlError) {
        console.error('Error generando signed URL:', signedUrlError);
        throw signedUrlError;
      }
      
      console.log('✅ Signed URL generada exitosamente');
      setSignedUrl(data.signedUrl);
    } catch (err) {
      console.error('Error en generateSignedUrl:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const openInNewTab = () => {
    if (signedUrl) {
      window.open(signedUrl, '_blank');
    }
  };

  const downloadPdf = () => {
    if (signedUrl) {
      const a = document.createElement('a');
      a.href = signedUrl;
      a.download = `${fileName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[500px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !signedUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground">No se pudo cargar el PDF</p>
        <Button onClick={generateSignedUrl} variant="outline">
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[500px]">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <Button size="sm" variant="outline" onClick={openInNewTab} className="gap-1">
          <ExternalLink className="h-4 w-4" />
          Nueva pestaña
        </Button>
        <Button size="sm" variant="outline" onClick={downloadPdf} className="gap-1">
          <Download className="h-4 w-4" />
          Descargar
        </Button>
      </div>
      <iframe
        src={signedUrl}
        className="w-full h-full border-0"
        title={fileName}
      />
    </div>
  );
};

export default PdfViewer;
