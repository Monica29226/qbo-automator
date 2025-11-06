import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

const AcceptInvitation = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    
    if (!token) {
      setStatus("error");
      setMessage("Token de invitación no válido");
      return;
    }

    acceptInvitation(token);
  }, [searchParams]);

  const acceptInvitation = async (token: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        // Guardar token y redirigir a login
        localStorage.setItem("pending_invitation_token", token);
        toast.info("Debes iniciar sesión para aceptar la invitación");
        navigate("/auth?redirect=/accept-invitation");
        return;
      }

      const { data, error } = await supabase.functions.invoke("accept-invitation", {
        body: { token },
      });

      if (error) throw error;

      if (data.error) {
        setStatus("error");
        setMessage(data.error);
        toast.error(data.error);
      } else {
        setStatus("success");
        setMessage(data.message || "¡Invitación aceptada exitosamente!");
        toast.success("¡Bienvenido al equipo!");
        
        // Redirigir al dashboard después de 2 segundos
        setTimeout(() => {
          navigate("/dashboard");
          window.location.reload(); // Recargar para actualizar organizaciones
        }, 2000);
      }
    } catch (error: any) {
      console.error("Error accepting invitation:", error);
      setStatus("error");
      setMessage(error.message || "Error al aceptar la invitación");
      toast.error("Error al aceptar la invitación");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        {status === "loading" && (
          <>
            <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Procesando invitación...</h2>
            <p className="text-muted-foreground">Por favor espera</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">¡Éxito!</h2>
            <p className="text-muted-foreground mb-6">{message}</p>
            <Button onClick={() => navigate("/dashboard")}>
              Ir al Dashboard
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Error</h2>
            <p className="text-muted-foreground mb-6">{message}</p>
            <Button onClick={() => navigate("/dashboard")} variant="outline">
              Volver al Dashboard
            </Button>
          </>
        )}
      </Card>
    </div>
  );
};

export default AcceptInvitation;
