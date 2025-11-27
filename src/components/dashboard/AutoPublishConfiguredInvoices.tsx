import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle, Send } from "lucide-react";

export const AutoPublishConfiguredInvoices = () => {
  const { activeOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [isPublishing, setIsPublishing] = useState(false);
  const [lastPublished, setLastPublished] = useState<number | null>(null);
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (!activeOrganization || hasCheckedRef.current) return;
    
    // Check and auto-publish on mount
    checkAndAutoPublish();
    hasCheckedRef.current = true;

    // Also set up a periodic check every 60 seconds
    const interval = setInterval(() => {
      checkAndAutoPublish();
    }, 60000);

    return () => clearInterval(interval);
  }, [activeOrganization]);

  const checkAndAutoPublish = async () => {
    if (!activeOrganization || isPublishing) return;

    try {
      // Check for pending invoices with accounts assigned
      const { data: pendingWithAccounts, error } = await supabase
        .from("processed_documents")
        .select("id, doc_number, supplier_name")
        .eq("organization_id", activeOrganization)
        .eq("status", "pending")
        .not("default_account_ref", "is", null)
        .is("qbo_entity_id", null)
        .limit(50);

      if (error) {
        console.error("Error checking pending invoices:", error);
        return;
      }

      if (!pendingWithAccounts || pendingWithAccounts.length === 0) {
        return; // No invoices to publish
      }

      console.log(`📤 Auto-publishing ${pendingWithAccounts.length} invoices with configured accounts...`);
      setIsPublishing(true);

      // Show toast notification
      toast.info(
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Auto-publicando {pendingWithAccounts.length} factura(s) con cuenta asignada...</span>
        </div>,
        { duration: 10000 }
      );

      // Publish to QuickBooks
      const { data: publishResult, error: publishError } = await supabase.functions.invoke(
        "publish-to-quickbooks",
        {
          body: {
            organization_id: activeOrganization,
            document_ids: pendingWithAccounts.map(d => d.id),
          },
        }
      );

      if (publishError) {
        console.error("Error auto-publishing:", publishError);
        toast.error("Error al auto-publicar facturas");
        return;
      }

      const published = publishResult?.published || 0;
      const failed = publishResult?.failed || 0;

      if (published > 0) {
        setLastPublished(published);
        toast.success(
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <div>
              <p className="font-semibold">Auto-publicación completada</p>
              <p className="text-sm">{published} factura(s) enviadas a QuickBooks{failed > 0 ? ` (${failed} fallidas)` : ''}</p>
            </div>
          </div>,
          { duration: 5000 }
        );

        // Refresh queries
        queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
        queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      }
    } catch (err) {
      console.error("Error in auto-publish check:", err);
    } finally {
      setIsPublishing(false);
    }
  };

  // This component doesn't render anything visible, it just runs the auto-publish logic
  if (isPublishing) {
    return (
      <div className="fixed bottom-4 right-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Publicando facturas...</span>
      </div>
    );
  }

  return null;
};
