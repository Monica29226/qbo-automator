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
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const extractCompanyDocumentsPathFromPublicUrl = (rawUrl: string) => {
    // When bucket is private, the `/public/...` endpoint responds 404 "Bucket not found".
    // In that case we should generate a signed URL using the object path.
    const marker = '/storage/v1/object/public/company-documents/';
    const idx = rawUrl.indexOf(marker);
    if (idx === -1) return null;

    const after = rawUrl.slice(idx + marker.length);
    const clean = after.split('?')[0].split('#')[0];
    try {
      return decodeURIComponent(clean);
    } catch {
      return clean;
    }
  };

  useEffect(() => {
    console.log('📄 PdfViewer useEffect - url:', url?.substring(0, 80), 'storagePath:', storagePath);

    setError(false);
    setLoading(true);
    setPdfUrl(null);

    if (url) {
      const companyDocsPath = extractCompanyDocumentsPathFromPublicUrl(url);
      if (companyDocsPath) {
        console.log('🔑 PdfViewer: URL pública detectada (bucket privado). Usando signed URL:', companyDocsPath);
        generateSignedUrl(companyDocsPath);
        return;
      }

      console.log('✅ PdfViewer: Usando URL directa:', url);
      setPdfUrl(url);
      setLoading(false);
      setIframeKey((prev) => prev + 1);
      return;
    }

    if (storagePath && storagePath.toLowerCase().endsWith('.pdf')) {
      console.log('🔑 PdfViewer: Generando signed URL para PDF:', storagePath);
      generateSignedUrl(storagePath);
    } else if (storagePath && storagePath.includes('/')) {
      // storagePath might be XML in some flows; try to derive PDF path only when it looks like a bucket path
      const pdfPath = storagePath.replace(/\.xml$/i, '.pdf');
      console.log('🔄 PdfViewer: storagePath es XML, intentando con PDF:', pdfPath);
      generateSignedUrl(pdfPath);
    } else {
      console.warn('⚠️ PdfViewer: Sin URL ni storagePath usable');
      setLoading(false);
      setError(true);
    }
  }, [url, storagePath]);

  const generateSignedUrl = async (path: string) => {
    setLoading(true);
    setError(false);
    
    try {
      console.log('🔄 Generando signed URL para path:', path);
      
      // Primero verificar si el archivo existe
      const { data: fileList, error: listError } = await supabase.storage
        .from('company-documents')
        .list(path.split('/').slice(0, -1).join('/'), {
          search: path.split('/').pop() || ''
        });
      
      const fileExists = fileList && fileList.some(f => path.endsWith(f.name));
      console.log('📂 Archivo existe en storage:', fileExists, 'Files encontrados:', fileList?.length || 0);
      
      if (!fileExists) {
        console.warn('⚠️ Archivo PDF no encontrado en storage:', path);
        setError(true);
        setLoading(false);
        return;
      }
      
      const { data, error: signedUrlError } = await supabase.storage
        .from('company-documents')
        .createSignedUrl(path, 3600);
      
      if (signedUrlError) {
        console.error('❌ Error generando signed URL:', signedUrlError);
        throw signedUrlError;
      }
      
      console.log('✅ Signed URL generada exitosamente:', data.signedUrl.substring(0, 80));
      setPdfUrl(data.signedUrl);
      setIframeKey(prev => prev + 1);
    } catch (err) {
      console.error('❌ Error en generateSignedUrl:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const openInNewTab = () => {
    if (pdfUrl) {
      console.log('🔗 Abriendo PDF en nueva pestaña');
      window.open(pdfUrl, '_blank');
    }
  };

  const downloadPdf = () => {
    if (pdfUrl) {
      console.log('⬇️ Descargando PDF');
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = `${fileName}.pdf`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleRetry = () => {
    console.log('🔄 Reintentando cargar PDF...');
    setIframeKey((prev) => prev + 1);

    if (url) {
      const companyDocsPath = extractCompanyDocumentsPathFromPublicUrl(url);
      if (companyDocsPath) {
        generateSignedUrl(companyDocsPath);
        return;
      }

      setPdfUrl(url);
      setError(false);
      setLoading(false);
      return;
    }

    if (storagePath && storagePath.toLowerCase().endsWith('.pdf')) {
      generateSignedUrl(storagePath);
    } else if (storagePath && storagePath.includes('/')) {
      generateSignedUrl(storagePath.replace(/\.xml$/i, '.pdf'));
    }
  };

  const handleIframeLoad = () => {
    console.log('✅ Iframe PDF cargado');
    setLoading(false);
  };

  const handleIframeError = () => {
    console.error('❌ Error cargando iframe del PDF');
    setError(true);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[500px] bg-muted/30">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Cargando PDF...</span>
        </div>
      </div>
    );
  }

  if (error || !pdfUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center min-h-[500px] bg-muted/30">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground font-medium">No se pudo cargar el PDF</p>
        <p className="text-xs text-muted-foreground/70 max-w-md">
          {!pdfUrl 
            ? 'El archivo PDF no está disponible. Es posible que el documento solo tenga el XML sin PDF adjunto.' 
            : 'Error al cargar el documento. Intente abrir en nueva pestaña.'}
        </p>
        <div className="flex gap-2">
          <Button onClick={handleRetry} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
          {pdfUrl && (
            <Button onClick={openInNewTab} variant="default" className="gap-1">
              <ExternalLink className="h-4 w-4" />
              Abrir en nueva pestaña
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Use iframe for better PDF rendering compatibility
  return (
    <div className="relative w-full h-full min-h-[500px] bg-muted/20">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <Button size="sm" variant="outline" onClick={openInNewTab} className="gap-1 bg-background/90 backdrop-blur shadow-sm">
          <ExternalLink className="h-4 w-4" />
          Nueva pestaña
        </Button>
        <Button size="sm" variant="outline" onClick={downloadPdf} className="gap-1 bg-background/90 backdrop-blur shadow-sm">
          <Download className="h-4 w-4" />
          Descargar
        </Button>
      </div>
      <iframe
        key={iframeKey}
        src={pdfUrl}
        className="w-full h-full border-0"
        title={fileName}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
      />
    </div>
  );
};

export default PdfViewer;
