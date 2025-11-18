import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { Shield, Database, Lock, CheckCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const CompanyIsolationStatus = () => {
  const { activeOrganization, organizations } = useAuth();
  const [stats, setStats] = useState({
    documents: 0,
    vendors: 0,
    integrations: 0,
  });

  const currentOrg = organizations.find(org => org.id === activeOrganization);

  useEffect(() => {
    if (!activeOrganization) return;

    const fetchStats = async () => {
      const [docs, vendors, integrations] = await Promise.all([
        supabase
          .from("processed_documents")
          .select("id", { count: "exact" })
          .eq("organization_id", activeOrganization),
        supabase
          .from("vendors")
          .select("id", { count: "exact" })
          .eq("organization_id", activeOrganization),
        supabase
          .from("integration_accounts")
          .select("id", { count: "exact" })
          .eq("organization_id", activeOrganization)
          .eq("is_active", true),
      ]);

      setStats({
        documents: docs.count || 0,
        vendors: vendors.count || 0,
        integrations: integrations.count || 0,
      });
    };

    fetchStats();
  }, [activeOrganization]);

  if (!currentOrg) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5 text-green-500" />
          Estado de Aislamiento
        </CardTitle>
        <CardDescription>
          Empresa activa: <span className="font-semibold">{currentOrg.name}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-medium">Documentos</span>
          </div>
          <Badge variant="secondary">{stats.documents}</Badge>
        </div>

        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-medium">Proveedores</span>
          </div>
          <Badge variant="secondary">{stats.vendors}</Badge>
        </div>

        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-medium">Integraciones</span>
          </div>
          <Badge variant="secondary">{stats.integrations}</Badge>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
          <CheckCircle className="h-3 w-3 text-green-500" />
          <span>Datos completamente aislados por empresa</span>
        </div>
      </CardContent>
    </Card>
  );
};

const Users = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
