import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { X, Copy, Check } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useState } from "react";
import { toast } from "sonner";

export const HelpPanel = () => {
  const { settings, setSettings } = useAppStore();
  const [copied, setCopied] = useState<string | null>(null);

  if (!settings.showHelp) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copiado`);
    setTimeout(() => setCopied(null), 2000);
  };

  const redirectUri = `${window.location.origin}/integrations`;

  return (
    <Card className="p-6 mb-6 border-2 border-primary/20">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            🔧 ¿Qué necesito para conectar?
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Información técnica para configurar las integraciones OAuth2
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setSettings({ showHelp: false })}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="gmail">
          <AccordionTrigger>
            <span className="text-lg font-semibold">📧 Gmail (Google OAuth2)</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground">CLIENT ID</Label>
                <div className="flex gap-2 mt-1">
                  <code className="flex-1 bg-background p-2 rounded text-xs font-mono border">
                    tu-client-id.apps.googleusercontent.com
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard("tu-client-id.apps.googleusercontent.com", "Client ID")}
                  >
                    {copied === "Client ID" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground">CLIENT SECRET</Label>
                <div className="flex gap-2 mt-1">
                  <code className="flex-1 bg-background p-2 rounded text-xs font-mono border">
                    tu-client-secret
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard("tu-client-secret", "Client Secret")}
                  >
                    {copied === "Client Secret" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground">REDIRECT URI</Label>
                <div className="flex gap-2 mt-1">
                  <code className="flex-1 bg-background p-2 rounded text-xs font-mono border">
                    {redirectUri}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(redirectUri, "Redirect URI")}
                  >
                    {copied === "Redirect URI" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <div>
              <Label className="font-semibold">Scopes requeridos:</Label>
              <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
                <li><code className="bg-muted px-1 py-0.5 rounded">https://www.googleapis.com/auth/gmail.readonly</code></li>
                <li><code className="bg-muted px-1 py-0.5 rounded">https://www.googleapis.com/auth/gmail.modify</code> (opcional, para etiquetar)</li>
              </ul>
            </div>

            <Badge variant="outline" className="text-xs">
              Configura en: <a href="https://console.cloud.google.com" target="_blank" rel="noopener" className="underline ml-1">Google Cloud Console</a>
            </Badge>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="quickbooks">
          <AccordionTrigger>
            <span className="text-lg font-semibold">💰 QuickBooks Online (Intuit OAuth2)</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground">CLIENT ID</Label>
                <div className="flex gap-2 mt-1">
                  <code className="flex-1 bg-background p-2 rounded text-xs font-mono border">
                    tu-quickbooks-client-id
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard("tu-quickbooks-client-id", "QBO Client ID")}
                  >
                    {copied === "QBO Client ID" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground">CLIENT SECRET</Label>
                <div className="flex gap-2 mt-1">
                  <code className="flex-1 bg-background p-2 rounded text-xs font-mono border">
                    tu-quickbooks-client-secret
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard("tu-quickbooks-client-secret", "QBO Client Secret")}
                  >
                    {copied === "QBO Client Secret" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground">REDIRECT URI</Label>
                <div className="flex gap-2 mt-1">
                  <code className="flex-1 bg-background p-2 rounded text-xs font-mono border">
                    {redirectUri}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(redirectUri, "QBO Redirect URI")}
                  >
                    {copied === "QBO Redirect URI" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground">COMPANY ID (Realm ID)</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Obtén este ID desde el panel de QuickBooks Online. Es obligatorio para todas las operaciones.
                </p>
                <code className="block bg-background p-2 rounded text-xs font-mono border mt-2">
                  Ej.: 123456789012345
                </code>
              </div>
            </div>

            <div>
              <Label className="font-semibold">Scopes requeridos:</Label>
              <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
                <li><code className="bg-muted px-1 py-0.5 rounded">com.intuit.quickbooks.accounting</code></li>
                <li><code className="bg-muted px-1 py-0.5 rounded">openid</code></li>
                <li><code className="bg-muted px-1 py-0.5 rounded">profile</code></li>
                <li><code className="bg-muted px-1 py-0.5 rounded">email</code></li>
              </ul>
            </div>

            <Badge variant="outline" className="text-xs">
              Configura en: <a href="https://developer.intuit.com" target="_blank" rel="noopener" className="underline ml-1">Intuit Developer Portal</a>
            </Badge>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
};

const Label = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => {
  return <span className={`block ${className}`}>{children}</span>;
};
