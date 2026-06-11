import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle, Send, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export const AutoPublishConfiguredInvoices = () => {
  const { activeOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [isPublishing, setIsPublishing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [dismissed, setDismissed] = useState(false);
  const hasCheckedRef = useRef(false);
  const isCheckingRef = useRef(false);

  const checkAndAutoPublish = useCallback(async () => {
    if (!activeOrganization || isPublishing || isCheckingRef.current) return;

    isCheckingRef.current = true;

    try {
      // Quick check for pending invoices with accounts assigned
      const { count, error } = await supabase
        .from("processed_documents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization)
        .eq("status", "pending")
        .not("default_account_ref", "is", null)
        .is("qbo_entity_id", null);

      if (error || !count || count === 0) {
        isCheckingRef.current = false;
        return;
      }

      console.log(`📤 Found ${count} invoices ready for auto-publish`);
      setProgress({ current: 0, total: count });
      setIsPublishing(true);
      setDismissed(false);

      // Get document IDs
      const { data: pendingDocs } = await supabase
        .from("processed_documents")
        .select("id")
        .eq("organization_id", activeOrganization)
        .eq("status", "pending")
        .not("default_account_ref", "is", null)
        .is("qbo_entity_id", null)
        .limit(50);

      if (!pendingDocs || pendingDocs.length === 0) {
        setIsPublishing(false);
        isCheckingRef.current = false;
        return;
      }

      // Publish in background - don't await, use fire-and-forget pattern
      supabase.functions.invoke("publish-to-quickbooks", {
        body: {
          organization_id: activeOrganization,
          document_ids: pendingDocs.map(d => d.id),
        },
      }).then(({ data: publishResult, error: publishError }) => {
        if (publishError) {
          console.error("Error auto-publishing:", publishError);
          toast.error("Error al auto-publicar facturas");
        } else {
          const published = publishResult?.published || 0;
          const failed = publishResult?.failed || 0;
          const review = publishResult?.review || publishResult?.needs_review || 0;
          const waiting = publishResult?.waiting || 0;

          if (published > 0 || failed > 0 || review > 0) {
            const parts: string[] = [];
            if (published > 0) parts.push(`${published} publicadas`);
            if (review > 0) parts.push(`${review} en revisión`);
            if (waiting > 0) parts.push(`${waiting} esperando QBO`);
            if (failed > 0) parts.push(`${failed} con error`);
            const msg = parts.join(" · ");
            if (failed > 0 && published === 0) {
              toast.error(`Auto-publicación: ${msg}`, { duration: 7000 });
            } else if (published > 0) {
              toast.success(`Auto-publicación: ${msg}`, { duration: 6000 });
            } else {
              toast.message(`Auto-publicación: ${msg}`, { duration: 6000 });
            }
            queryClient.invalidateQueries({ queryKey: ["recent-documents"] });
            queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
          }
        }
        setIsPublishing(false);
        setProgress({ current: 0, total: 0 });
      }).catch(err => {
        console.error("Auto-publish error:", err);
        setIsPublishing(false);
      });

    } catch (err) {
      console.error("Error in auto-publish check:", err);
    } finally {
      isCheckingRef.current = false;
    }
  }, [activeOrganization, isPublishing, queryClient]);

  useEffect(() => {
    if (!activeOrganization || hasCheckedRef.current) return;
    
    // Delay initial check to let dashboard load first
    const initialTimeout = setTimeout(() => {
      checkAndAutoPublish();
      hasCheckedRef.current = true;
    }, 2000);

    return () => clearTimeout(initialTimeout);
  }, [activeOrganization, checkAndAutoPublish]);

  // Subscribe to realtime changes to update progress
  useEffect(() => {
    if (!activeOrganization || !isPublishing) return;

    const channel = supabase
      .channel('auto-publish-progress')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'processed_documents',
          filter: `organization_id=eq.${activeOrganization}`
        },
        (payload) => {
          if (payload.new.status === 'published' && payload.old.status === 'pending') {
            setProgress(prev => ({
              ...prev,
              current: Math.min(prev.current + 1, prev.total)
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeOrganization, isPublishing]);

  if (!isPublishing || dismissed) return null;

  const progressPercent = progress.total > 0 
    ? Math.round((progress.current / progress.total) * 100) 
    : 0;

  return (
    <div className="fixed bottom-4 right-4 bg-card border shadow-lg rounded-lg p-4 z-50 min-w-[280px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">Publicando a QuickBooks</span>
        </div>
        <button 
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <Progress value={progressPercent} className="h-2 mb-2" />
      <p className="text-xs text-muted-foreground">
        {progress.current} de {progress.total} facturas procesadas
      </p>
    </div>
  );
};
