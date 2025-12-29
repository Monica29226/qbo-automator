import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Download, ExternalLink, Loader2, RefreshCw, CloudDownload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PdfViewerProps {
  url?: string;
  storagePath?: string;
  fileName?: string;
  organizationId?: string;
  docNumber?: string;
  documentId?: string;
  onPdfDownloaded?: (newUrl: string) => void;
}

export const PdfViewer = ({ 
  url, 
  storagePath, 
  fileName = 'documento',
  organizationId,
  docNumber,
  documentId,
  onPdfDownloaded
}: PdfViewerProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [pdfNotFound, setPdfNotFound] = useState(false);
  const [pdfInvalid, setPdfInvalid] = useState(false);

  const extractCompanyDocumentsPathFromPublicUrl = (rawUrl: string) => {
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

  const toAbsoluteStorageUrl = (maybeRelativeUrl: string) => {
    if (!maybeRelativeUrl) return maybeRelativeUrl;
    if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;

    const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!base) return maybeRelativeUrl;

    const origin = base.replace(/\/$/, '');

    // Storage signed URLs can come back as /object/sign/... (relative to /storage/v1)
    if (maybeRelativeUrl.startsWith('/storage/v1')) return `${origin}${maybeRelativeUrl}`;
    if (maybeRelativeUrl.startsWith('/')) return `${origin}/storage/v1${maybeRelativeUrl}`;

    return `${origin}/storage/v1/${maybeRelativeUrl}`;
  };
  useEffect(() => {
    console.log('📄 PdfViewer useEffect - url:', url?.substring(0, 80), 'storagePath:', storagePath);

    setError(false);
    setLoading(true);
    setPdfUrl(null);
    setPdfNotFound(false);
    setPdfInvalid(false);

    if (url) {
      const companyDocsPath = extractCompanyDocumentsPathFromPublicUrl(url);
      if (companyDocsPath) {
        console.log('🔑 PdfViewer: URL pública detectada (bucket privado). Cargando desde storage:', companyDocsPath);
        generateSignedUrl(companyDocsPath);
        return;
      }

      console.log('✅ PdfViewer: Usando URL directa:', url);
      setPdfUrl(toAbsoluteStorageUrl(url));
      setLoading(false);
      setIframeKey((prev) => prev + 1);
      return;
    }

    if (storagePath && storagePath.toLowerCase().endsWith('.pdf')) {
      console.log('🔑 PdfViewer: Cargando PDF desde storagePath:', storagePath);
      generateSignedUrl(storagePath);
    } else if (storagePath && storagePath.includes('/')) {
      const pdfPath = storagePath.replace(/\.xml$/i, '.pdf');
      console.log('🔄 PdfViewer: storagePath es XML, intentando con PDF:', pdfPath);
      generateSignedUrl(pdfPath);
    } else {
      console.warn('⚠️ PdfViewer: Sin URL ni storagePath usable');
      setLoading(false);
      setError(true);
      setPdfNotFound(true);
    }
  }, [url, storagePath]);

  useEffect(() => {
    return () => {
      if (pdfUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  const generateSignedUrl = async (path: string) => {
    setLoading(true);
    setError(false);
    setPdfNotFound(false);
    setPdfInvalid(false);

    try {
      console.log('🔄 Cargando PDF desde storage:', path);

      // Verificar si el archivo existe
      const folderPath = path.split('/').slice(0, -1).join('/');
      const targetName = path.split('/').pop() || '';

      const { data: fileList } = await supabase.storage
        .from('company-documents')
        .list(folderPath, { search: targetName });

      const fileExists = fileList && fileList.some((f) => f.name === targetName);
      console.log('📂 Archivo existe en storage:', fileExists, 'Buscando:', targetName);

      if (!fileExists) {
        console.warn('⚠️ Archivo PDF no encontrado en storage:', path);
        setError(true);
        setPdfNotFound(true);
        return;
      }

      // 1) Preferir descargar como Blob y crear objectURL (evita problemas de iframe/X-Frame/CSP)
      const { data: blob, error: downloadError } = await supabase.storage
        .from('company-documents')
        .download(path);

      if (!downloadError && blob) {
        const pdfBlob = blob.type === 'application/pdf' ? blob : blob.slice(0, blob.size, 'application/pdf');

        // Validación rápida: un PDF válido empieza con "%PDF"
        const headerBuf = await pdfBlob.slice(0, 4).arrayBuffer();
        const header = new TextDecoder().decode(headerBuf);
        if (!header.startsWith('%PDF')) {
          console.warn('⚠️ El archivo descargado no parece un PDF válido. Header:', header);
          setError(true);
          setPdfInvalid(true);
          return;
        }

        const objectUrl = URL.createObjectURL(pdfBlob);
        console.log('✅ PDF listo para visor (blob URL)');
        setPdfUrl(objectUrl);
        setIframeKey((prev) => prev + 1);
        return;
      }

      console.warn('⚠️ No se pudo descargar el PDF (download). Intentando signed URL...', downloadError);

      // 2) Fallback: signed URL
      const { data, error: signedUrlError } = await supabase.storage
        .from('company-documents')
        .createSignedUrl(path, 3600);

      if (signedUrlError) {
        console.error('❌ Error generando signed URL:', signedUrlError);
        throw signedUrlError;
      }

      const absoluteSignedUrl = toAbsoluteStorageUrl(data.signedUrl);
      console.log('✅ Signed URL generada (fallback)');
      console.log('🔗 Signed URL final:', absoluteSignedUrl?.substring(0, 140));
      setPdfUrl(absoluteSignedUrl);
      setIframeKey((prev) => prev + 1);
    } catch (err) {
      console.error('❌ Error en carga de PDF:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const downloadFromGmail = async () => {
    if (!organizationId || !docNumber) {
      toast.error('Información insuficiente para buscar en Gmail');
      return;
    }

    setDownloading(true);
    toast.info('Buscando PDF en Gmail...');

    try {
      const { data, error } = await supabase.functions.invoke('download-missing-pdf', {
        body: {
          organization_id: organizationId,
          doc_number: docNumber,
          document_id: documentId
        }
      });

      if (error) throw error;

      if (data?.success && data?.pdf_url) {
        toast.success('PDF descargado exitosamente');
        
        // Notificar al componente padre
        if (onPdfDownloaded) {
          onPdfDownloaded(data.pdf_url);
        }
        
        // Recargar el visor con la nueva URL
        const path = data.storage_path;
        if (path) {
          await generateSignedUrl(path);
        }
      } else {
        toast.error(data?.error || 'No se encontró el PDF en Gmail');
      }
    } catch (err) {
      console.error('Error descargando PDF:', err);
      toast.error('Error al buscar PDF en Gmail');
    } finally {
      setDownloading(false);
    }
  };

  const openInNewTab = () => {
    if (pdfUrl) {
      // Para blob URLs, abrir la nueva pestaña inmediatamente.
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const downloadPdf = () => {
    if (pdfUrl) {
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
    setIframeKey((prev) => prev + 1);

    if (url) {
      const companyDocsPath = extractCompanyDocumentsPathFromPublicUrl(url);
      if (companyDocsPath) {
        generateSignedUrl(companyDocsPath);
        return;
      }
      setPdfUrl(toAbsoluteStorageUrl(url));
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
    setLoading(false);
  };

  const handleIframeError = () => {
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
    const canDownloadFromGmail = organizationId && docNumber && (pdfNotFound || pdfInvalid);

    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center min-h-[500px] bg-muted/30">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground font-medium">No se pudo mostrar el PDF</p>
        <p className="text-xs text-muted-foreground/70 max-w-md">
          {pdfNotFound
            ? 'El PDF no existe en el storage.'
            : pdfInvalid
              ? 'El archivo encontrado en storage no parece ser un PDF válido. Re-descárguelo desde Gmail.'
              : 'Error al cargar el documento.'}
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Button onClick={handleRetry} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
          {canDownloadFromGmail && (
            <Button 
              onClick={downloadFromGmail} 
              variant="default" 
              className="gap-2"
              disabled={downloading}
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando en Gmail...
                </>
              ) : (
                <>
                  <CloudDownload className="h-4 w-4" />
                  Descargar desde Gmail
                </>
              )}
            </Button>
          )}
          {pdfUrl && (
            <Button onClick={openInNewTab} variant="secondary" className="gap-1">
              <ExternalLink className="h-4 w-4" />
              Abrir en nueva pestaña
            </Button>
          )}
        </div>
      </div>
    );
  }

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