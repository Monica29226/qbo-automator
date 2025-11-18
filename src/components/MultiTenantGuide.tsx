import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Shield, Database, Users, Settings, CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const MultiTenantGuide = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Sistema Multi-Empresa Activado
          </CardTitle>
          <CardDescription>
            Este sistema está configurado como 100% multi-empresa (multi-tenant) con aislamiento total de datos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-500" />
                <h3 className="font-semibold">Aislamiento Total</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Cada empresa tiene sus propios datos completamente separados. No hay mezcla de información entre organizaciones.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-500" />
                <h3 className="font-semibold">Datos Independientes</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Proveedores, facturas, categorías, y configuraciones son únicos por empresa.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-purple-500" />
                <h3 className="font-semibold">Integraciones Separadas</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Cada empresa tiene sus propias credenciales de QuickBooks y configuraciones de Gmail.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-orange-500" />
                <h3 className="font-semibold">Control de Acceso</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Los usuarios pueden pertenecer a múltiples empresas con roles específicos en cada una.
              </p>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">¿Cómo agregar una nueva empresa?</h3>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>Haz clic en el selector de empresas en la esquina superior derecha</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>Selecciona "Nueva Empresa" e ingresa el nombre (ej: "Mobiliario Moderno")</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>Configura las integraciones de QuickBooks y Gmail para la nueva empresa</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>Define los proveedores y categorías específicos de esa empresa</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>Cambia entre empresas cuando necesites usando el selector</span>
              </li>
            </ol>
          </div>

          <div className="flex gap-3 pt-2">
            <Button 
              onClick={() => navigate("/organizations")}
              className="w-full"
            >
              <Building2 className="h-4 w-4 mr-2" />
              Gestionar Empresas
            </Button>
            <Button 
              onClick={() => navigate("/integrations")}
              variant="outline"
              className="w-full"
            >
              <Settings className="h-4 w-4 mr-2" />
              Configurar Integraciones
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
