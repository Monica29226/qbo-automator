import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { Button } from '@/components/ui/button';
import { FileText, Download, ExternalLink, Loader2, RefreshCw, CloudDownload, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Configurar el worker de PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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
  const [pdfData, setPdfData] = useState<{ data: Uint8Array } | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [pdfNotFound, setPdfNotFound] = useState(false);
  const [pdfInvalid, setPdfInvalid] = useState(false);
  
  // Estados para navegación y zoom
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);

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

  useEffect(() => {
    console.log('📄 PdfViewer useEffect - url:', url?.substring(0, 80), 'storagePath:', storagePath);

    setError(false);
    setLoading(true);
    setPdfData(null);
    setPdfNotFound(false);
    setPdfInvalid(false);
    setPageNumber(1);

    if (url) {
      const companyDocsPath = extractCompanyDocumentsPathFromPublicUrl(url);
      if (companyDocsPath) {
        console.log('🔑 PdfViewer: URL pública detectada (bucket privado). Cargando desde storage:', companyDocsPath);
        loadPdfFromStorage(companyDocsPath);
        return;
      }

      // Detectar si es una ruta relativa de storage (no empieza con http)
      // Formatos válidos: "{org_id}/pdf/{clave}.pdf" o "{org_id}/{doc_number}.pdf"
      const isStoragePath = !url.startsWith('http') && url.endsWith('.pdf') && url.includes('/');
      if (isStoragePath) {
        console.log('🔑 PdfViewer: Ruta de storage detectada. Cargando desde storage:', url);
        loadPdfFromStorage(url);
        return;
      }

      // Si es una URL externa, cargar directamente
      console.log('✅ PdfViewer: Cargando desde URL externa');
      loadPdfFromUrl(url);
      return;
    }

    if (storagePath && storagePath.toLowerCase().endsWith('.pdf')) {
      console.log('🔑 PdfViewer: Cargando PDF desde storagePath:', storagePath);
      loadPdfFromStorage(storagePath);
    } else if (storagePath && storagePath.includes('/')) {
      const pdfPath = storagePath.replace(/\.xml$/i, '.pdf');
      console.log('🔄 PdfViewer: storagePath es XML, intentando con PDF:', pdfPath);
      loadPdfFromStorage(pdfPath);
    } else {
      console.warn('⚠️ PdfViewer: Sin URL ni storagePath usable');
      setLoading(false);
      setError(true);
      setPdfNotFound(true);
    }
  }, [url, storagePath]);

  // Limpiar blob URL al desmontar
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  const loadPdfFromUrl = async (pdfUrl: string) => {
    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error('Error fetching PDF');
      
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Validar que es un PDF
      const header = new TextDecoder().decode(uint8Array.slice(0, 4));
      if (!header.startsWith('%PDF')) {
        console.warn('⚠️ El archivo no parece un PDF válido');
        setError(true);
        setPdfInvalid(true);
        return;
      }
      
      setPdfData({ data: uint8Array });
      // Crear blob URL para descarga
      const blob = new Blob([uint8Array], { type: 'application/pdf' });
      setPdfBlobUrl(URL.createObjectURL(blob));
      console.log('✅ PDF cargado desde URL');
    } catch (err) {
      console.error('❌ Error cargando PDF desde URL:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const loadPdfFromStorage = async (path: string) => {
    setLoading(true);
    setError(false);
    setPdfNotFound(false);
    setPdfInvalid(false);

    try {
      console.log('🔄 Cargando PDF desde storage:', path);
      const startTime = performance.now();

      // Descargar directamente sin verificar existencia previa (más rápido)
      const { data: blob, error: downloadError } = await supabase.storage
        .from('company-documents')
        .download(path);

      const downloadTime = performance.now() - startTime;
      console.log(`⏱️ Tiempo de descarga: ${downloadTime.toFixed(0)}ms`);

      if (downloadError) {
        // Si el error es "not found", marcar como no encontrado
        if (downloadError.message?.includes('not found') || downloadError.message?.includes('Object not found')) {
          console.warn('⚠️ Archivo PDF no encontrado en storage:', path);
          setError(true);
          setPdfNotFound(true);
          return;
        }
        console.error('❌ Error descargando PDF:', downloadError);
        throw downloadError;
      }

      if (!blob) {
        throw new Error('No blob returned');
      }

      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Validar que es un PDF
      const header = new TextDecoder().decode(uint8Array.slice(0, 4));
      if (!header.startsWith('%PDF')) {
        console.warn('⚠️ El archivo no parece un PDF válido. Header:', header);
        setError(true);
        setPdfInvalid(true);
        return;
      }

      setPdfData({ data: uint8Array });
      // Crear blob URL para descarga/nueva pestaña
      const pdfBlob = new Blob([uint8Array], { type: 'application/pdf' });
      setPdfBlobUrl(URL.createObjectURL(pdfBlob));
      console.log('✅ PDF cargado correctamente desde storage');
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
        
        if (onPdfDownloaded) {
          onPdfDownloaded(data.pdf_url);
        }
        
        const path = data.storage_path;
        if (path) {
          await loadPdfFromStorage(path);
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
    if (pdfBlobUrl) {
      window.open(pdfBlobUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const downloadPdf = () => {
    if (pdfBlobUrl) {
      const a = document.createElement('a');
      a.href = pdfBlobUrl;
      a.download = `${fileName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleRetry = () => {
    if (url) {
      const companyDocsPath = extractCompanyDocumentsPathFromPublicUrl(url);
      if (companyDocsPath) {
        loadPdfFromStorage(companyDocsPath);
        return;
      }
      loadPdfFromUrl(url);
      return;
    }

    if (storagePath && storagePath.toLowerCase().endsWith('.pdf')) {
      loadPdfFromStorage(storagePath);
    } else if (storagePath && storagePath.includes('/')) {
      loadPdfFromStorage(storagePath.replace(/\.xml$/i, '.pdf'));
    }
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    console.log('📖 PDF cargado con', numPages, 'páginas');
  };

  const onDocumentLoadError = (error: Error) => {
    console.error('❌ Error cargando PDF en react-pdf:', error);
    setError(true);
  };

  const goToPrevPage = () => setPageNumber((prev) => Math.max(prev - 1, 1));
  const goToNextPage = () => setPageNumber((prev) => Math.min(prev + 1, numPages));
  const zoomIn = () => setScale((prev) => Math.min(prev + 0.25, 3));
  const zoomOut = () => setScale((prev) => Math.max(prev - 0.25, 0.5));

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

  if (error || !pdfData) {
    const canDownloadFromGmail = organizationId && docNumber && (pdfNotFound || pdfInvalid);

    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center min-h-[500px] bg-muted/30">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground font-medium">No se pudo mostrar el PDF</p>
        <p className="text-xs text-muted-foreground/70 max-w-md">
          {pdfNotFound
            ? 'El PDF no existe en el storage.'
            : pdfInvalid
              ? 'El archivo encontrado en storage no parece ser un PDF válido.'
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-[500px] bg-muted/20">
      {/* Barra de herramientas */}
      <div className="flex items-center justify-between gap-2 p-2 bg-background border-b flex-wrap">
        {/* Navegación de páginas */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={goToPrevPage} disabled={pageNumber <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm px-2 min-w-[80px] text-center">
            {pageNumber} / {numPages}
          </span>
          <Button size="sm" variant="outline" onClick={goToNextPage} disabled={pageNumber >= numPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Controles de zoom */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={zoomOut} disabled={scale <= 0.5}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm px-2 min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button size="sm" variant="outline" onClick={zoomIn} disabled={scale >= 3}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={openInNewTab} className="gap-1">
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva pestaña</span>
          </Button>
          <Button size="sm" variant="outline" onClick={downloadPdf} className="gap-1">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Descargar</span>
          </Button>
        </div>
      </div>

      {/* Visor de PDF con react-pdf */}
      <div className="flex-1 overflow-auto flex justify-center p-4 bg-muted/40">
        <Document
          file={pdfData}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Renderizando PDF...</span>
            </div>
          }
        >
          <Page 
            pageNumber={pageNumber} 
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            className="shadow-lg"
          />
        </Document>
      </div>
    </div>
  );
};

export default PdfViewer;