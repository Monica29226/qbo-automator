import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
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
  const [iframeKey, setIframeKey] = useState(0); // Force iframe refresh

  useEffect(() => {
    console.log('📄 PdfViewer useEffect - url:', url?.substring(0, 80), 'storagePath:', storagePath);
    
    // Reset states when inputs change
    setError(false);
    setLoading(true);
    
    if (url) {
      console.log('✅ PdfViewer: Usando URL directa');
      setSignedUrl(url);
      setLoading(false);
      setIframeKey(prev => prev + 1); // Force iframe refresh
      return;
    }
    
    if (storagePath) {
      console.log('🔑 PdfViewer: Generando signed URL para:', storagePath);
      generateSignedUrl();
    } else {
      console.warn('⚠️ PdfViewer: Sin URL ni storagePath');
      setLoading(false);
      setError(true);
    }
  }, [url, storagePath]);

  const generateSignedUrl = async () => {
    if (!storagePath) {
      setError(true);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(false);
    
    try {
      console.log('🔄 Generando signed URL para path:', storagePath);
      
      const { data, error: signedUrlError } = await supabase.storage
        .from('company-documents')
        .createSignedUrl(storagePath, 3600); // 1 hora de expiración
      
      if (signedUrlError) {
        console.error('❌ Error generando signed URL:', signedUrlError);
        throw signedUrlError;
      }
      
      console.log('✅ Signed URL generada exitosamente');
      setSignedUrl(data.signedUrl);
      setIframeKey(prev => prev + 1);
    } catch (err) {
      console.error('❌ Error en generateSignedUrl:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const openInNewTab = () => {
    if (signedUrl) {
      console.log('🔗 Abriendo PDF en nueva pestaña:', signedUrl.substring(0, 80));
      window.open(signedUrl, '_blank');
    }
  };

  const downloadPdf = () => {
    if (signedUrl) {
      console.log('⬇️ Descargando PDF');
      const a = document.createElement('a');
      a.href = signedUrl;
      a.download = `${fileName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleRetry = () => {
    console.log('🔄 Reintentando cargar PDF...');
    if (url) {
      setSignedUrl(url);
      setError(false);
      setLoading(false);
      setIframeKey(prev => prev + 1);
    } else if (storagePath) {
      generateSignedUrl();
    }
  };

  const handleIframeError = () => {
    console.error('❌ Error cargando iframe del PDF');
    setError(true);
    setLoading(false);
  };

  const handleIframeLoad = () => {
    console.log('✅ Iframe cargado correctamente');
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[500px]">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Cargando PDF...</span>
        </div>
      </div>
    );
  }

  if (error || !signedUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center min-h-[500px]">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground">No se pudo cargar el PDF</p>
        <p className="text-xs text-muted-foreground/70">
          {!signedUrl ? 'URL no disponible' : 'Error al cargar el documento'}
        </p>
        <Button onClick={handleRetry} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </Button>
        {signedUrl && (
          <Button onClick={openInNewTab} variant="link" className="gap-1 text-xs">
            <ExternalLink className="h-3 w-3" />
            Probar abrir en nueva pestaña
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[500px]">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <Button size="sm" variant="outline" onClick={openInNewTab} className="gap-1 bg-background/80 backdrop-blur">
          <ExternalLink className="h-4 w-4" />
          Nueva pestaña
        </Button>
        <Button size="sm" variant="outline" onClick={downloadPdf} className="gap-1 bg-background/80 backdrop-blur">
          <Download className="h-4 w-4" />
          Descargar
        </Button>
      </div>
      <iframe
        key={iframeKey}
        src={signedUrl}
        className="w-full h-full border-0"
        title={fileName}
        onError={handleIframeError}
        onLoad={handleIframeLoad}
      />
    </div>
  );
};

export default PdfViewer;
