import { useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BankStatementsList } from "@/components/bank/BankStatementsList";
import { BankImportConfigPanel } from "@/components/bank/BankImportConfigPanel";
import { BankUploadDialog } from "@/components/bank/BankUploadDialog";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

const BankStatements = () => {
  const { isAdmin, signOut } = useAuth();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <DashboardSidebar isAdmin={isAdmin} reviewCount={0} onSignOut={signOut} />
        <main className="flex-1 p-6 overflow-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">
                Estados de Cuenta
              </h1>
              <p className="text-muted-foreground text-sm">
                Importar estados bancarios y generar CSV para QuickBooks Banking
              </p>
            </div>
            <div className="flex items-center gap-3">
              <OrganizationSwitcher />
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Subir Estado de Cuenta
              </Button>
            </div>
          </div>

          <Tabs defaultValue="jobs" className="space-y-4">
            <TabsList>
              <TabsTrigger value="jobs">Importaciones</TabsTrigger>
              <TabsTrigger value="config">Configuración</TabsTrigger>
            </TabsList>
            <TabsContent value="jobs">
              <BankStatementsList />
            </TabsContent>
            <TabsContent value="config">
              <BankImportConfigPanel />
            </TabsContent>
          </Tabs>

          <BankUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
        </main>
      </div>
    </SidebarProvider>
  );
};

export default BankStatements;
