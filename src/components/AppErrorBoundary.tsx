import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const RELOAD_ONCE_KEY = "ff_reload_once";

type AppErrorBoundaryProps = {
  children: React.ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // Diagnostic only; avoid logging any sensitive payloads.
    console.error("AppErrorBoundary caught:", error);

    const message = String(error?.message ?? "");
    const isChunkOrLazyError =
      /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError/i.test(message);

    // If this is a deploy-cache mismatch, a single hard reload usually fixes it.
    if (isChunkOrLazyError) {
      try {
        const alreadyReloaded = sessionStorage.getItem(RELOAD_ONCE_KEY) === "1";
        if (!alreadyReloaded) {
          sessionStorage.setItem(RELOAD_ONCE_KEY, "1");
          window.location.reload();
        }
      } catch {
        // ignore
      }
    }
  }

  private handleReload = () => {
    try {
      sessionStorage.removeItem(RELOAD_ONCE_KEY);
    } catch {
      // ignore
    }
    window.location.reload();
  };

  private handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = "/";
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Error cargando la aplicación
            </CardTitle>
            <CardDescription>
              Ocurrió un problema al cargar la pantalla. Puedes recargar o volver a iniciar sesión.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={this.handleReload} className="w-full">
                <RefreshCw className="h-4 w-4 mr-2" />
                Recargar
              </Button>
              <Button variant="outline" onClick={this.handleSignOut} className="w-full">
                <LogOut className="h-4 w-4 mr-2" />
                Cerrar sesión
              </Button>
            </div>

            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground break-words">
                Detalle técnico: {this.state.error.message}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
}
