import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  documentId: string;
  uploaded?: boolean;
  status?: string | null;
  onUploaded?: () => void;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
}

export function SharePointUploadButton({ documentId, uploaded, status, onUploaded, size = "sm", variant = "outline" }: Props) {
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("sharepoint_admin_account")
        .select("id")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      setHasAccount(!!data);
    })();
  }, []);

  if (hasAccount === null || hasAccount === false) return null;

  const onClick = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("upload-to-sharepoint", { body: { document_id: documentId } });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error(`SharePoint: ${error?.message || (data as any)?.error}`);
      return;
    }
    if ((data as any)?.skipped) {
      toast.info(`SharePoint: ${(data as any).reason}`);
      return;
    }
    toast.success("📁 Subido a SharePoint");
    onUploaded?.();
  };

  const isFailed = status === "failed";

  return (
    <Button size={size} variant={variant} onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> :
        isFailed ? <CloudOff className="h-4 w-4 mr-1 text-destructive" /> :
          <Cloud className={`h-4 w-4 mr-1 ${uploaded ? "text-green-600" : ""}`} />}
      {uploaded ? "Re-subir a SharePoint" : "Subir a SharePoint"}
    </Button>
  );
}

export function SharePointStatusIcon({ uploaded, status, error }: { uploaded?: boolean; status?: string | null; error?: string | null }) {
  if (uploaded && status !== "failed") {
    return <span title="Subido a SharePoint"><Cloud className="h-4 w-4 text-green-600 inline" /></span>;
  }
  if (status === "failed") {
    return <span title={error || "Falló subida a SharePoint"}><CloudOff className="h-4 w-4 text-destructive inline" /></span>;
  }
  return null;
}
