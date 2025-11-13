import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RepublishSingleDocButtonProps {
  documentId: string;
  docNumber: string;
}

export const RepublishSingleDocButton = ({ documentId, docNumber }: RepublishSingleDocButtonProps) => {
  const [isPublishing, setIsPublishing] = useState(false);

  const handleRepublish = async () => {
    try {
      setIsPublishing(true);
      console.log('🔄 Republishing document:', docNumber);

      const { data, error } = await supabase.functions.invoke('republish-single-document', {
        body: { documentId }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`✅ Factura ${docNumber} republicada exitosamente`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        throw new Error(data?.error || 'Error desconocido');
      }
    } catch (error: any) {
      console.error('❌ Error republishing:', error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Button
      onClick={handleRepublish}
      disabled={isPublishing}
      size="sm"
      variant="outline"
    >
      {isPublishing ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Republicando...
        </>
      ) : (
        <>
          <Upload className="mr-2 h-4 w-4" />
          Republicar
        </>
      )}
    </Button>
  );
};
