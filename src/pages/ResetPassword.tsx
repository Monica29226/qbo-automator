import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Lock, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";
import calderonLogo from "@/assets/acl-logo-new.png";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const recoveryHashParams = useMemo(() => new URLSearchParams(window.location.hash.replace(/^#/, "")), []);
  const isRecoveryLink = recoveryHashParams.get("type") === "recovery" || Boolean(recoveryHashParams.get("access_token"));
  
  const [isLoading, setIsLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isInvalidToken, setIsInvalidToken] = useState(false);

  useEffect(() => {
    const validateRecoveryAccess = async () => {
      if (token || isRecoveryLink) {
        setIsInvalidToken(false);
        return;
      }

      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session) {
        setIsInvalidToken(true);
      }
    };

    void validateRecoveryAccess();
  }, [token, isRecoveryLink]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password || !confirmPassword) {
      toast.error("Por favor completa todos los campos");
      return;
    }

    if (password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }

    setIsLoading(true);

    try {
      if (token) {
        const { data, error } = await supabase.functions.invoke("reset-password", {
          body: { token, newPassword: password },
        });

        if (error) throw error;

        if (data?.error) {
          toast.error(data.error);
          if (data.error.includes("inválido") || data.error.includes("expirado") || data.error.includes("utilizado")) {
            setIsInvalidToken(true);
          }
          return;
        }
      } else {
        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
          if (error.message.toLowerCase().includes("session") || error.message.toLowerCase().includes("expired")) {
            setIsInvalidToken(true);
          }
          throw error;
        }
      }

      setIsSuccess(true);
      toast.success("Contraseña actualizada correctamente");

      setTimeout(() => {
        navigate("/");
      }, 2000);
    } catch (error: any) {
      console.error("Error resetting password:", error);
      toast.error(error.message || "Error al actualizar la contraseña");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Card className="p-8 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">
              ¡Contraseña Actualizada!
            </h2>
            <p className="text-muted-foreground">
              Tu contraseña ha sido cambiada exitosamente. Serás redirigido al inicio de sesión...
            </p>
          </Card>
        </div>
      </div>
    );
  }

  if (isInvalidToken) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Card className="p-8 text-center">
            <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">
              Enlace Inválido
            </h2>
            <p className="text-muted-foreground mb-6">
              El enlace de recuperación es inválido, ha expirado o ya fue utilizado. Por favor solicita un nuevo enlace.
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => navigate("/forgot-password")} className="w-full">
                Solicitar Nuevo Enlace
              </Button>
              <Button variant="outline" onClick={() => navigate("/")} className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver al Inicio
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mb-6 flex justify-center">
            <img src={calderonLogo} alt="Logo" className="h-20 w-auto" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Restablecer Contraseña
          </h1>
          <p className="text-muted-foreground">
            Ingresa tu nueva contraseña
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nueva Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="pl-10"
                  required
                  minLength={6}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  className="pl-10"
                  required
                  minLength={6}
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Actualizando...
                </>
              ) : (
                "Actualizar Contraseña"
              )}
            </Button>
          </form>
        </Card>

        <div className="text-center mt-4">
          <Button
            variant="link"
            onClick={() => navigate("/")}
            className="text-muted-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al inicio de sesión
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
