import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { 
  Building2, 
  Shield, 
  Database, 
  Lock, 
  Users, 
  Settings, 
  FileText,
  CheckCircle,
  ArrowRight,
  AlertTriangle
} from "lucide-react";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";

export default function MultiTenantDocs() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tight mb-2 flex items-center gap-3">
              <Building2 className="h-10 w-10" />
              Sistema Multi-Empresa
            </h1>
            <p className="text-muted-foreground text-lg">
              Gestión completa y aislada de múltiples organizaciones
            </p>
          </div>
          <OrganizationSwitcher />
        </div>

        {/* Main Feature Card */}
        <Card className="mb-8 border-2 border-primary/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-2xl">Arquitectura 100% Multi-Tenant</CardTitle>
              <Badge variant="default" className="text-sm">
                <Shield className="h-3 w-3 mr-1" />
                Totalmente Implementado
              </Badge>
            </div>
            <CardDescription>
              El sistema está completamente configurado para manejar múltiples empresas con aislamiento total de datos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Key Features Grid */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-blue-500" />
                  <h3 className="font-semibold">Aislamiento de Datos</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Todas las tablas incluyen <code className="bg-muted px-1 py-0.5 rounded">organization_id</code> para separar datos por empresa
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge variant="outline" className="text-xs">processed_documents</Badge>
                  <Badge variant="outline" className="text-xs">vendors</Badge>
                  <Badge variant="outline" className="text-xs">vendor_categories</Badge>
                  <Badge variant="outline" className="text-xs">integration_accounts</Badge>
                </div>
              </div>

              <div className="p-4 border rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <Lock className="h-5 w-5 text-red-500" />
                  <h3 className="font-semibold">Row Level Security (RLS)</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Políticas de seguridad a nivel de base de datos que previenen acceso no autorizado entre empresas
                </p>
                <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  <span>Validación en cada query</span>
                </div>
              </div>

              <div className="p-4 border rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-purple-500" />
                  <h3 className="font-semibold">Integraciones Separadas</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Cada empresa tiene sus propias credenciales de QuickBooks, tokens de Gmail y configuraciones
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge variant="secondary" className="text-xs">QuickBooks OAuth</Badge>
                  <Badge variant="secondary" className="text-xs">Gmail OAuth</Badge>
                </div>
              </div>

              <div className="p-4 border rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-orange-500" />
                  <h3 className="font-semibold">Control de Acceso</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Los usuarios pueden pertenecer a múltiples empresas con roles específicos (owner, admin, member)
                </p>
                <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  <span>Gestión granular de permisos</span>
                </div>
              </div>
            </div>

            {/* How it Works */}
            <div className="border-t pt-6">
              <h3 className="font-semibold text-lg mb-4">¿Cómo Funciona?</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 mt-1">
                    <span className="text-sm font-bold text-primary">1</span>
                  </div>
                  <div>
                    <h4 className="font-medium">Selección de Empresa Activa</h4>
                    <p className="text-sm text-muted-foreground">
                      Al iniciar sesión, el sistema carga las empresas disponibles para el usuario y establece una como activa
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 mt-1">
                    <span className="text-sm font-bold text-primary">2</span>
                  </div>
                  <div>
                    <h4 className="font-medium">Filtrado Automático</h4>
                    <p className="text-sm text-muted-foreground">
                      Todas las consultas incluyen automáticamente <code className="bg-muted px-1 py-0.5 rounded">WHERE organization_id = X</code>
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 mt-1">
                    <span className="text-sm font-bold text-primary">3</span>
                  </div>
                  <div>
                    <h4 className="font-medium">Validación de Seguridad</h4>
                    <p className="text-sm text-muted-foreground">
                      Las políticas RLS y funciones de base de datos verifican que cada usuario solo acceda a datos de sus empresas
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 mt-1">
                    <span className="text-sm font-bold text-primary">4</span>
                  </div>
                  <div>
                    <h4 className="font-medium">Cambio de Contexto</h4>
                    <p className="text-sm text-muted-foreground">
                      Los usuarios pueden cambiar entre empresas usando el selector, actualizando el contexto completo
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step by Step Guide */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Guía Paso a Paso: Agregar Nueva Empresa</CardTitle>
            <CardDescription>
              Ejemplo: Agregar "Mobiliario Moderno" sin afectar datos de "Café Luna"
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500 mt-1 flex-shrink-0" />
                <div className="space-y-1">
                  <h4 className="font-medium">Paso 1: Crear Nueva Organización</h4>
                  <p className="text-sm text-muted-foreground">
                    Haz clic en el selector de empresas (esquina superior derecha) → "Nueva Empresa" → Ingresa "Mobiliario Moderno"
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500 mt-1 flex-shrink-0" />
                <div className="space-y-1">
                  <h4 className="font-medium">Paso 2: Configurar Integraciones</h4>
                  <p className="text-sm text-muted-foreground">
                    Ve a "Integraciones" → Conecta QuickBooks y Gmail con las credenciales específicas de Mobiliario Moderno
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500 mt-1 flex-shrink-0" />
                <div className="space-y-1">
                  <h4 className="font-medium">Paso 3: Configurar Proveedores</h4>
                  <p className="text-sm text-muted-foreground">
                    Crea las categorías de proveedores y reglas específicas para Mobiliario Moderno
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500 mt-1 flex-shrink-0" />
                <div className="space-y-1">
                  <h4 className="font-medium">Paso 4: Procesar Facturas</h4>
                  <p className="text-sm text-muted-foreground">
                    Todas las facturas procesadas se almacenarán únicamente para Mobiliario Moderno. Café Luna permanece intacto.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-6 border-t">
              <Button onClick={() => navigate("/organizations")} className="flex-1">
                <Building2 className="h-4 w-4 mr-2" />
                Gestionar Empresas
              </Button>
              <Button onClick={() => navigate("/integrations")} variant="outline" className="flex-1">
                <Settings className="h-4 w-4 mr-2" />
                Configurar Integraciones
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Security Guarantees */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-green-500" />
              Garantías de Seguridad
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                <div className="text-sm">
                  <strong>Aislamiento Total:</strong> Es imposible que datos de una empresa aparezcan en otra
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                <div className="text-sm">
                  <strong>Validación en BD:</strong> Las políticas RLS previenen acceso no autorizado incluso con SQL directo
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                <div className="text-sm">
                  <strong>Integraciones Únicas:</strong> Cada empresa usa sus propias credenciales OAuth sin compartir tokens
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                <div className="text-sm">
                  <strong>Sin Mezcla de Datos:</strong> Los Edge Functions validan organization_id en cada operación
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <Button onClick={() => navigate("/dashboard")} size="lg">
            Ir al Dashboard
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
