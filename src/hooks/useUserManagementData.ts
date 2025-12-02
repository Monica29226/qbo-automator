import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  organizations: { name: string }[];
}

interface PendingInvitation {
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  organizations: string[];
  invitation_ids: string[];
}

interface Organization {
  id: string;
  name: string;
}

export const useUserManagementData = (activeOrganization: string | null) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["user-management", activeOrganization],
    queryFn: async () => {
      if (!activeOrganization) throw new Error("No active organization");

      // Ejecutar TODAS las queries en paralelo
      const [
        profilesResult,
        rolesResult,
        membersResult,
        orgsResult,
        invitationsResult,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, email, full_name, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
        supabase
          .from("organization_members")
          .select("user_id, organization_id, role, is_active, organizations(name)")
          .eq("is_active", true),
        supabase
          .from("organizations")
          .select("id, name")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("organization_invitations")
          .select("id, email, role, created_at, expires_at, organization_id, organizations(name)")
          .is("accepted_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false }),
      ]);

      if (profilesResult.error) throw profilesResult.error;

      // Procesar usuarios
      const rolesMap = new Map<string, string>();
      (rolesResult.data || []).forEach((r: any) => rolesMap.set(r.user_id, r.role));

      const membersMap = new Map<string, { name: string }[]>();
      (membersResult.data || []).forEach((m: any) => {
        const existing = membersMap.get(m.user_id) || [];
        if (m.organizations?.name) {
          existing.push({ name: m.organizations.name });
        }
        membersMap.set(m.user_id, existing);
      });

      const users: UserProfile[] = (profilesResult.data || []).map((user: any) => ({
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: rolesMap.get(user.id) || "user",
        created_at: user.created_at,
        organizations: membersMap.get(user.id) || [],
      }));

      // Procesar organizaciones
      const organizations: Organization[] = orgsResult.data || [];

      // Procesar invitaciones
      const groupedInvitations = (invitationsResult.data || []).reduce((acc: any, inv: any) => {
        const key = inv.email;
        if (!acc[key]) {
          acc[key] = {
            email: inv.email,
            role: inv.role,
            created_at: inv.created_at,
            expires_at: inv.expires_at,
            organizations: [],
            invitation_ids: [],
          };
        }
        acc[key].organizations.push(inv.organizations?.name);
        acc[key].invitation_ids.push(inv.id);
        return acc;
      }, {});

      const pendingInvitations: PendingInvitation[] = Object.values(groupedInvitations);

      return { users, organizations, pendingInvitations };
    },
    enabled: !!activeOrganization,
    staleTime: 2 * 60 * 1000, // 2 minutos
    gcTime: 5 * 60 * 1000, // 5 minutos
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["user-management"] });
  };

  return {
    users: data?.users || [],
    organizations: data?.organizations || [],
    pendingInvitations: data?.pendingInvitations || [],
    isLoading,
    invalidate,
  };
};
