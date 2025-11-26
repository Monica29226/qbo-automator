import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Zap, Shield, BarChart3, ArrowRight, CheckCircle, Tag, LogIn } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import calderonLogo from "@/assets/acl-logo-new.png";

const Index = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Quick Actions - Admin Only */}
      <section className="bg-muted/30 py-4 border-b">
        <div className="container mx-auto px-6">
          <div className="flex gap-3 overflow-x-auto pb-2 items-center justify-between">
            <div className="flex gap-3 overflow-x-auto">
              <Link to="/dashboard">
                <Button variant="outline" size="sm">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Dashboard
                </Button>
              </Link>
              <Link to="/vendor-categories">
                <Button variant="outline" size="sm">
                  <Tag className="mr-2 h-4 w-4" />
                  Categorías de Proveedores
                </Button>
              </Link>
              <Link to="/review-queue">
                <Button variant="outline" size="sm">
                  <FileText className="mr-2 h-4 w-4" />
                  Cola de Revisión
                </Button>
              </Link>
              <Link to="/integrations">
                <Button variant="outline" size="sm">
                  <Zap className="mr-2 h-4 w-4" />
                  Integraciones
                </Button>
              </Link>
            </div>
            {!user && (
              <Link to="/auth">
                <Button variant="default" size="sm">
                  <LogIn className="mr-2 h-4 w-4" />
                  Iniciar Sesión
                </Button>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/5">
        <div className="container mx-auto px-6 py-20 lg:py-32">
          <div className="max-w-4xl mx-auto text-center">
            {/* Logo Calderón */}
            <div className="mb-8 flex justify-center">
              <img src={calderonLogo} alt="Calderón Logo" className="h-24 w-auto" />
            </div>
            <Badge className="mb-6" variant="secondary">
              Procesamiento XML Directo - Sin IA
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
              De XML a QuickBooks
              <span className="block text-primary mt-2">Sin Intervención Manual</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Sistema de extracción XML directo con mapeo predefinido de proveedores. 
              Procesa facturas y notas de crédito de Costa Rica según Hacienda v4.x y registra automáticamente en QuickBooks.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" asChild className="text-lg h-12 px-8">
                <Link to="/vendor-categories">
                  Configurar Categorías
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="text-lg h-12 px-8" asChild>
                <Link to="/dashboard">
                  Ver Dashboard
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-card/50">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Extracción XML Directa
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Procesamiento rápido y preciso sin depender de IA
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={FileText}
              title="Parseo XML Nativo"
              description="Lee directamente XML de Hacienda CR v4.x extrayendo todos los campos estructurados sin IA."
            />
            <FeatureCard
              icon={Tag}
              title="Mapeo Predefinido"
              description="Catálogo de proveedores con identificación → cuenta contable para clasificación instantánea."
            />
            <FeatureCard
              icon={Shield}
              title="Validación Automática"
              description="Detecta duplicados, valida montos, identifica notas de crédito y aplica negativos correctamente."
            />
            <FeatureCard
              icon={BarChart3}
              title="Registro en QuickBooks"
              description="Crea Bills y VendorCredits con líneas de detalle, impuestos y adjuntos PDF/XML."
            />
            <FeatureCard
              icon={CheckCircle}
              title="Cola de Revisión"
              description="Proveedores sin categoría van a cola manual con interfaz de aprobación rápida."
            />
            <FeatureCard
              icon={Zap}
              title="Importación Masiva"
              description="Carga catálogo completo de proveedores desde Excel (identificación, nombre, cuenta)."
            />
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Flujo de Procesamiento
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              100% automático con mapeo predefinido
            </p>
          </div>

          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <ProcessStep
                number="1"
                title="Recibir XML"
                description="Lee correo o carga manual con XML de factura"
              />
              <ProcessStep
                number="2"
                title="Extraer Datos"
                description="Parse directo de campos: proveedor, monto, líneas"
              />
              <ProcessStep
                number="3"
                title="Buscar Categoría"
                description="Match por identificación en catálogo predefinido"
              />
              <ProcessStep
                number="4"
                title="Publicar QBO"
                description="Crea Bill/Credit con cuenta asignada"
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-br from-primary to-accent">
        <div className="container mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-6">
            Listo para Configurar?
          </h2>
          <p className="text-lg text-primary-foreground/90 mb-8 max-w-2xl mx-auto">
            Define tu catálogo de proveedores y comienza a procesar facturas automáticamente
          </p>
          <Button size="lg" variant="secondary" asChild className="text-lg h-12 px-8">
            <Link to="/vendor-categories">
              Configurar Ahora
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
};

const FeatureCard = ({ icon: Icon, title, description }: { 
  icon: React.ElementType; 
  title: string; 
  description: string; 
}) => {
  return (
    <Card className="p-6 hover:shadow-lg transition-shadow">
      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </Card>
  );
};

const ProcessStep = ({ number, title, description }: { 
  number: string; 
  title: string; 
  description: string; 
}) => {
  return (
    <div className="text-center">
      <div className="h-16 w-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold mx-auto mb-4">
        {number}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
};

export default Index;