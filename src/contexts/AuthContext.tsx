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
          await loadUserData(session.user.id);
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
            await loadUserData(session.user.id);
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

  const loadUserData = async (userId: string) => {
    try {
      console.log('📊 Cargando datos de usuario:', userId);
      const startTime = performance.now();
      
      // Ejecutar todas las queries en paralelo para máxima velocidad
      const [membershipsResult, activeOrgResult, adminRoleResult] = await Promise.all([
        supabase
          .from("organization_members")
          .select("organization_id, role, organizations(id, name)")
          .eq("user_id", userId)
          .eq("is_active", true),
        supabase
          .from("user_active_organization")
          .select("organization_id")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "admin")
          .maybeSingle()
      ]);

      console.log('⏱️ Todas las queries completadas en:', performance.now() - startTime, 'ms');

      // Procesar organizaciones
      if (!membershipsResult.error && membershipsResult.data) {
        const orgs = membershipsResult.data.map((m: any) => ({
          id: m.organization_id,
          name: m.organizations.name,
          role: m.role,
        }));
        setOrganizations(orgs);
        console.log('✅ Organizaciones:', orgs.length);

        // Configurar organización activa
        if (!activeOrgResult.error && activeOrgResult.data) {
          setActiveOrganization(activeOrgResult.data.organization_id);
          console.log('✅ Org activa:', activeOrgResult.data.organization_id);
        } else if (orgs.length > 0) {
          setActiveOrganization(orgs[0].id);
          // Upsert en segundo plano, no bloquear el login
          supabase
            .from("user_active_organization")
            .upsert({ user_id: userId, organization_id: orgs[0].id })
            .then(() => console.log('✅ Primera org establecida como activa'));
        }
      }

      // Procesar rol admin
      setIsAdmin(!adminRoleResult.error && !!adminRoleResult.data);
      console.log('✅ Admin:', !adminRoleResult.error && !!adminRoleResult.data);

    } catch (error) {
      console.error("❌ Error cargando datos:", error);
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
