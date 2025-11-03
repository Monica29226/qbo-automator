import { useState, useEffect } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeOrganization, setActiveOrganization] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Establecer listener primero
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        // Cargar datos de organización
        if (session?.user) {
          setTimeout(() => {
            loadUserOrganizations(session.user.id);
            checkAdminRole(session.user.id);
          }, 0);
        } else {
          setIsAdmin(false);
          setActiveOrganization(null);
          setOrganizations([]);
        }
        
        setIsLoading(false);
      }
    );

    // Luego verificar sesión existente
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        loadUserOrganizations(session.user.id);
        checkAdminRole(session.user.id);
      }
      
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserOrganizations = async (userId: string) => {
    try {
      // Obtener organizaciones del usuario
      const { data: memberships, error: membershipsError } = await supabase
        .from("organization_members")
        .select("organization_id, role, organizations(*)")
        .eq("user_id", userId)
        .eq("is_active", true);

      if (!membershipsError && memberships) {
        const orgs = memberships.map((m: any) => ({
          id: m.organization_id,
          name: m.organizations.name,
          role: m.role,
        }));
        setOrganizations(orgs);

        // Obtener organización activa
        const { data: activeOrg, error: activeOrgError } = await supabase
          .from("user_active_organization")
          .select("organization_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (!activeOrgError && activeOrg) {
          setActiveOrganization(activeOrg.organization_id);
        } else if (orgs.length > 0) {
          // Si no hay organización activa, establecer la primera
          setActiveOrganization(orgs[0].id);
          await supabase
            .from("user_active_organization")
            .upsert({ user_id: userId, organization_id: orgs[0].id });
        }
      }
    } catch (error) {
      console.error("Error loading organizations:", error);
    }
  };

  const checkAdminRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      if (!error && data) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    } catch (error) {
      console.error("Error checking admin role:", error);
      setIsAdmin(false);
    }
  };

  const switchOrganization = async (organizationId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("user_active_organization")
        .upsert({ user_id: user.id, organization_id: organizationId });

      if (!error) {
        setActiveOrganization(organizationId);
        // Recargar la página para actualizar todos los datos
        window.location.reload();
      }
    } catch (error) {
      console.error("Error switching organization:", error);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    setActiveOrganization(null);
    setOrganizations([]);
    navigate("/auth");
  };

  return {
    user,
    session,
    isLoading,
    isAdmin,
    activeOrganization,
    organizations,
    switchOrganization,
    signOut,
  };
};
