import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Building2, Plus, X } from "lucide-react";
import calderonLogo from "@/assets/acl-logo-new.png";
import { useAuth } from "@/hooks/useAuth";
import { CreateOrganizationDialog } from "@/components/CreateOrganizationDialog";

const SelectCompany = () => {
  const navigate = useNavigate();
  const { user, organizations, isLoading: authLoading, setActiveOrganizationLocal, isAdmin } = useAuth();
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);
  
  // Ordenar organizaciones alfabéticamente
  const sortedOrganizations = [...organizations].sort((a, b) => 
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  );

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/");
    }
  }, [authLoading, user, navigate]);

  const handleSelectCompany = async () => {
    if (!selectedOrg || !user) return;

    try {
      setIsSelecting(true);
      
      // Actualizar estado local INMEDIATAMENTE para evitar delay
      console.log('⚡ Actualizando organización local antes de guardar:', selectedOrg);
      setActiveOrganizationLocal(selectedOrg);
      
      // Navegar INMEDIATAMENTE después de actualizar estado local
      console.log('🚀 Navegando al dashboard con org:', selectedOrg);
      navigate("/dashboard");
      
      // Guardar en BD en segundo plano
      const { error } = await supabase
        .from("user_active_organization")
        .upsert({ 
          user_id: user.id, 
          organization_id: selectedOrg 
        });

      if (error) {
        console.error('❌ Error guardando organización:', error);
        toast.error("Error al guardar la selección");
      } else {
        console.log('✅ Organización guardada en BD');
        toast.success("Empresa seleccionada");
      }
    } catch (error) {
      console.error("Error selecting company:", error);
      toast.error("Error al seleccionar la empresa");
    } finally {
      setIsSelecting(false);
    }
  };

  const handleOrganizationCreated = (organizationId: string) => {
    // Navigate to dashboard after successful creation
    navigate("/dashboard");
  };

  const handleDeleteOrg = async (e: React.MouseEvent, orgId: string, orgName: string) => {
    e.stopPropagation();
    const confirmText = prompt(
      `Esta acción eliminará permanentemente la empresa "${orgName}" y todos sus datos relacionados.\n\nEscriba ELIMINAR para confirmar:`
    );
    if (confirmText !== "ELIMINAR") {
      toast.info("Eliminación cancelada");
      return;
    }

    setDeletingOrgId(orgId);
    try {
      const tables = [
        "organization_members",
        "organization_invitations",
        "system_settings",
        "vendor_defaults",
        "vendors",
        "vendor_classification_rules",
        "vendor_categories",
        "processed_documents",
        "qbo_publish_tracking",
        "sync_logs",
        "alert_history",
        "audit_log",
        "sales_invoices",
        "customer_defaults",
        "cabys_items",
        "billing_sequences",
        "hacienda_certificates",
        "integration_accounts",
        "oauth_credentials",
        "onedrive_subscriptions",
        "bank_import_configs",
        "bank_import_jobs",
        "bank_import_job_items",
        "bank_import_sources",
      ] as const;

      for (const t of tables) {
        const { error } = await supabase.from(t as any).delete().eq("organization_id", orgId);
        if (error) console.warn(`No se pudo limpiar ${t}:`, error.message);
      }

      const { error: orgErr } = await supabase.from("organizations").delete().eq("id", orgId);
      if (orgErr) {
        toast.error(`Error al eliminar empresa: ${orgErr.message}`);
      } else {
        toast.success(`Empresa "${orgName}" eliminada`);
        if (selectedOrg === orgId) setSelectedOrg(null);
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err: any) {
      toast.error(`Error inesperado: ${err.message}`);
    } finally {
      setDeletingOrgId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="mb-6 flex justify-center">
            <img src={calderonLogo} alt="Calderón Logo" className="h-24 w-auto" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Selecciona tu Empresa</h1>
          <p className="text-muted-foreground">
            Elige la empresa con la que deseas trabajar
          </p>
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            {sortedOrganizations.map((org) => {
              const canDelete = org.role === "owner" || org.role === "admin" || isAdmin;
              return (
                <div
                  key={org.id}
                  onClick={() => setSelectedOrg(org.id)}
                  role="button"
                  tabIndex={0}
                  className={`w-full p-4 rounded-lg border-2 transition-all text-left flex items-center gap-4 hover:border-primary cursor-pointer ${
                    selectedOrg === org.id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex-shrink-0">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      selectedOrg === org.id ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}>
                      <Building2 className="h-6 w-6" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">{org.name}</div>
                    <div className="text-sm text-muted-foreground capitalize">
                      Rol: {org.role}
                    </div>
                  </div>
                  {selectedOrg === org.id && (
                    <div className="flex-shrink-0">
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                        <svg className="w-4 h-4 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteOrg(e, org.id, org.name)}
                      disabled={deletingOrgId === org.id}
                      title="Eliminar empresa"
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
                    >
                      {deletingOrgId === org.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="outline" className="flex-1" onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva Empresa
            </Button>

            <Button
              onClick={handleSelectCompany}
              disabled={!selectedOrg || isSelecting}
              className="flex-1"
            >
              {isSelecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando...
                </>
              ) : (
                "Continuar"
              )}
            </Button>
          </div>
        </Card>
      </div>

      <CreateOrganizationDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSuccess={handleOrganizationCreated}
      />
    </div>
  );
};

export default SelectCompany;
