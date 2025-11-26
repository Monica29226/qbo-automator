import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAdmin: boolean;
  activeOrganization: string | null;
  organizations: any[];
  switchOrganization: (organizationId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeOrganization, setActiveOrganization] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    let isInitialized = false;

    // Solo cargar sesión inicial una vez
    const startTime = performance.now();
    console.log('🚀 AuthContext: Iniciando carga de sesión');
    
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      
      console.log('⏱️ AuthContext: Sesión obtenida en', performance.now() - startTime, 'ms');
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        try {
          const orgStart = performance.now();
          await Promise.all([
            loadUserOrganizations(session.user.id),
            checkAdminRole(session.user.id)
          ]);
          console.log('⏱️ AuthContext: Datos de usuario cargados en', performance.now() - orgStart, 'ms');
        } catch (error) {
          console.error('❌ Error loading user data:', error);
        }
      }
      
      isInitialized = true;
      setIsLoading(false);
      console.log('✅ AuthContext: Inicialización completa en', performance.now() - startTime, 'ms');
    });

    // Escuchar cambios solo después de inicialización
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted || !isInitialized) return;
        
        console.log('🔄 AuthContext: Cambio de estado de auth:', event);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          try {
            await Promise.all([
              loadUserOrganizations(session.user.id),
              checkAdminRole(session.user.id)
            ]);
          } catch (error) {
            console.error('❌ Error loading user data:', error);
          }
        } else {
          setIsAdmin(false);
          setActiveOrganization(null);
          setOrganizations([]);
        }
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadUserOrganizations = async (userId: string) => {
    try {
      console.log('📊 Cargando organizaciones para usuario:', userId);
      const orgStart = performance.now();
      
      const { data: memberships, error: membershipsError } = await supabase
        .from("organization_members")
        .select("organization_id, role, organizations(*)")
        .eq("user_id", userId)
        .eq("is_active", true);

      console.log('⏱️ Query organizaciones:', performance.now() - orgStart, 'ms');

      if (!membershipsError && memberships) {
        const orgs = memberships.map((m: any) => ({
          id: m.organization_id,
          name: m.organizations.name,
          role: m.role,
        }));
        setOrganizations(orgs);
        console.log('✅ Organizaciones cargadas:', orgs.length);

        const activeOrgStart = performance.now();
        const { data: activeOrg, error: activeOrgError } = await supabase
          .from("user_active_organization")
          .select("organization_id")
          .eq("user_id", userId)
          .maybeSingle();

        console.log('⏱️ Query org activa:', performance.now() - activeOrgStart, 'ms');

        if (!activeOrgError && activeOrg) {
          setActiveOrganization(activeOrg.organization_id);
          console.log('✅ Organización activa:', activeOrg.organization_id);
        } else if (orgs.length > 0) {
          setActiveOrganization(orgs[0].id);
          await supabase
            .from("user_active_organization")
            .upsert({ user_id: userId, organization_id: orgs[0].id });
          console.log('✅ Primera organización establecida como activa');
        }
      }
    } catch (error) {
      console.error("❌ Error loading organizations:", error);
    }
  };

  const checkAdminRole = async (userId: string) => {
    try {
      console.log('🔍 Verificando rol admin para usuario:', userId);
      const adminStart = performance.now();
      
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      console.log('⏱️ Query rol admin:', performance.now() - adminStart, 'ms');

      if (!error && data) {
        console.log('✅ Usuario ES admin');
        setIsAdmin(true);
      } else {
        console.log('ℹ️ Usuario NO es admin');
        setIsAdmin(false);
      }
    } catch (error) {
      console.error("❌ Error verificando rol admin:", error);
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

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAdmin,
        activeOrganization,
        organizations,
        switchOrganization,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
