import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Building2 } from "lucide-react";
import aclLogo from "@/assets/acl-logo.png";

const SelectCompany = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    loadUserAndOrganizations();
  }, []);

  const loadUserAndOrganizations = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        navigate("/");
        return;
      }

      setUser(session.user);

      // Obtener organizaciones del usuario
      const { data: memberships, error } = await supabase
        .from("organization_members")
        .select("organization_id, role, organizations(*)")
        .eq("user_id", session.user.id)
        .eq("is_active", true);

      if (error) throw error;

      if (memberships && memberships.length > 0) {
        const orgs = memberships.map((m: any) => ({
          id: m.organization_id,
          name: m.organizations.name,
          role: m.role,
        }));
        setOrganizations(orgs);
      } else {
        toast.error("No tienes acceso a ninguna empresa");
        await supabase.auth.signOut();
        navigate("/");
      }
    } catch (error) {
      console.error("Error loading organizations:", error);
      toast.error("Error al cargar las empresas");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectCompany = async () => {
    if (!selectedOrg || !user) return;

    try {
      setIsLoading(true);
      
      // Establecer la organización activa
      const { error } = await supabase
        .from("user_active_organization")
        .upsert({ 
          user_id: user.id, 
          organization_id: selectedOrg 
        });

      if (error) throw error;

      toast.success("Empresa seleccionada");
      navigate("/dashboard");
    } catch (error) {
      console.error("Error selecting company:", error);
      toast.error("Error al seleccionar la empresa");
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
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
            <img src={aclLogo} alt="ACL Logo" className="h-20 w-auto" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Selecciona tu Empresa</h1>
          <p className="text-muted-foreground">
            Elige la empresa con la que deseas trabajar
          </p>
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => setSelectedOrg(org.id)}
                className={`w-full p-4 rounded-lg border-2 transition-all text-left flex items-center gap-4 hover:border-primary ${
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
              </button>
            ))}
          </div>

          <Button
            onClick={handleSelectCompany}
            disabled={!selectedOrg || isLoading}
            className="w-full mt-6"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cargando...
              </>
            ) : (
              "Continuar"
            )}
          </Button>
        </Card>
      </div>
    </div>
  );
};

export default SelectCompany;
