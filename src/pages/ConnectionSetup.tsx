import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, CheckCircle, Copy, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ConnectionSetup = () => {
  const [gmailClientId, setGmailClientId] = useState("");
  const [gmailClientSecret, setGmailClientSecret] = useState("");
  const [qbClientId, setQbClientId] = useState("");
  const [qbClientSecret, setQbClientSecret] = useState("");

  const redirectUri = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-google-callback`;
  const qbRedirectUri = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-quickbooks-callback`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/integrations">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold">Configuración de Conexiones OAuth</h1>
            <p className="text-xs text-muted-foreground">Guía paso a paso para conectar Gmail y QuickBooks</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-4xl">
        <Alert className="mb-6">
          <AlertDescription>
            Para conectar Gmail y QuickBooks necesitas crear aplicaciones OAuth en Google Cloud y Intuit Developer.
            Sigue estos pasos cuidadosamente.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="gmail" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="gmail">Gmail (Google Cloud)</TabsTrigger>
            <TabsTrigger value="quickbooks">QuickBooks Online</TabsTrigger>
          </TabsList>

          <TabsContent value="gmail" className="space-y-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">1. Crear Proyecto en Google Cloud</h2>
              <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
                <li>
                  Ve a{" "}
                  <a
                    href="https://console.cloud.google.com/projectcreate"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Google Cloud Console
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Crea un nuevo proyecto (ej: "FacturaFlow CR")</li>
                <li>Selecciona el proyecto recién creado</li>
              </ol>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">2. Configurar Pantalla de Consentimiento</h2>
              <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
                <li>
                  Ve a{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials/consent"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Pantalla de Consentimiento OAuth
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Selecciona "Externo" y haz clic en "Crear"</li>
                <li>Completa el nombre de la aplicación y correo de soporte</li>
                <li>Agrega los scopes: <code className="bg-muted px-1 rounded">gmail.readonly</code>, <code className="bg-muted px-1 rounded">gmail.modify</code></li>
                <li>Guarda y continúa</li>
              </ol>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">3. Crear Credenciales OAuth</h2>
              <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside mb-4">
                <li>
                  Ve a{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Credenciales
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Haz clic en "Crear credenciales" → "ID de cliente de OAuth 2.0"</li>
                <li>Tipo de aplicación: "Aplicación web"</li>
                <li>Nombre: "FacturaFlow Gmail"</li>
                <li>Agrega esta URL de redirección autorizada:</li>
              </ol>

              <div className="bg-muted p-3 rounded-lg mb-4 flex items-center justify-between">
                <code className="text-xs break-all">{redirectUri}</code>
                <Button size="sm" variant="ghost" onClick={() => copyToClipboard(redirectUri)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="gmail-client-id">Client ID</Label>
                  <Input
                    id="gmail-client-id"
                    value={gmailClientId}
                    onChange={(e) => setGmailClientId(e.target.value)}
                    placeholder="123456789.apps.googleusercontent.com"
                  />
                </div>
                <div>
                  <Label htmlFor="gmail-client-secret">Client Secret</Label>
                  <Textarea
                    id="gmail-client-secret"
                    value={gmailClientSecret}
                    onChange={(e) => setGmailClientSecret(e.target.value)}
                    placeholder="GOCSPX-..."
                    rows={3}
                  />
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-success" />
                ¡Listo!
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Copia el Client ID y Client Secret arriba. Luego ve a crear tu organización
                "Café Luna" e ingresa estas credenciales en la pestaña de Google.
              </p>
              <Button asChild>
                <Link to="/dashboard">Ir al Dashboard</Link>
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="quickbooks" className="space-y-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">1. Crear Aplicación en Intuit</h2>
              <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
                <li>
                  Ve a{" "}
                  <a
                    href="https://developer.intuit.com/app/developer/myapps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Intuit Developer
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Inicia sesión con tu cuenta de Intuit</li>
                <li>Haz clic en "Create an app"</li>
                <li>Selecciona "QuickBooks Online and Payments"</li>
                <li>Nombre: "FacturaFlow CR"</li>
              </ol>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">2. Configurar URLs de Redirección</h2>
              <p className="text-sm text-muted-foreground mb-4">
                En la sección "Keys & credentials" de tu app, agrega esta Redirect URI:
              </p>

              <div className="bg-muted p-3 rounded-lg mb-4 flex items-center justify-between">
                <code className="text-xs break-all">{qbRedirectUri}</code>
                <Button size="sm" variant="ghost" onClick={() => copyToClipboard(qbRedirectUri)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">3. Obtener Credenciales</h2>
              <p className="text-sm text-muted-foreground mb-4">
                En "Keys & credentials" encontrarás:
              </p>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="qb-client-id">Client ID</Label>
                  <Input
                    id="qb-client-id"
                    value={qbClientId}
                    onChange={(e) => setQbClientId(e.target.value)}
                    placeholder="AB..."
                  />
                </div>
                <div>
                  <Label htmlFor="qb-client-secret">Client Secret</Label>
                  <Textarea
                    id="qb-client-secret"
                    value={qbClientSecret}
                    onChange={(e) => setQbClientSecret(e.target.value)}
                    placeholder="..."
                    rows={3}
                  />
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-success" />
                ¡Listo!
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Copia el Client ID y Client Secret arriba. Luego ve a crear tu organización
                "Café Luna" e ingresa estas credenciales en la pestaña de QuickBooks.
              </p>
              <Button asChild>
                <Link to="/dashboard">Ir al Dashboard</Link>
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default ConnectionSetup;
