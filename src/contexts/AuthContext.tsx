import { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
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
  setActiveOrganizationLocal: (organizationId: string) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Cache keys para sessionStorage
const CACHE_KEYS = {
  ORGANIZATIONS: 'auth_orgs_cache',
  ACTIVE_ORG: 'auth_active_org_cache',
  IS_ADMIN: 'auth_is_admin_cache',
  CACHE_TIME: 'auth_cache_time'
};

// Tiempo de validez del cache: 5 minutos
const CACHE_TTL_MS = 5 * 60 * 1000;

const getCachedData = () => {
  try {
    const cacheTime = sessionStorage.getItem(CACHE_KEYS.CACHE_TIME);
    if (!cacheTime || Date.now() - parseInt(cacheTime) > CACHE_TTL_MS) {
      return null;
    }
    
    const orgs = sessionStorage.getItem(CACHE_KEYS.ORGANIZATIONS);
    const activeOrg = sessionStorage.getItem(CACHE_KEYS.ACTIVE_ORG);
    const isAdmin = sessionStorage.getItem(CACHE_KEYS.IS_ADMIN);
    
    if (orgs) {
      return {
        organizations: JSON.parse(orgs),
        activeOrganization: activeOrg || null,
        isAdmin: isAdmin === 'true'
      };
    }
  } catch {
    // Ignore cache errors
  }
  return null;
};

const setCachedData = (orgs: any[], activeOrg: string | null, isAdmin: boolean) => {
  try {
    sessionStorage.setItem(CACHE_KEYS.ORGANIZATIONS, JSON.stringify(orgs));
    sessionStorage.setItem(CACHE_KEYS.ACTIVE_ORG, activeOrg || '');
    sessionStorage.setItem(CACHE_KEYS.IS_ADMIN, isAdmin ? 'true' : 'false');
    sessionStorage.setItem(CACHE_KEYS.CACHE_TIME, Date.now().toString());
  } catch {
    // Ignore cache errors
  }
};

const clearCachedData = () => {
  try {
    Object.values(CACHE_KEYS).forEach(key => sessionStorage.removeItem(key));
  } catch {
    // Ignore cache errors
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeOrganization, setActiveOrganization] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const navigate = useNavigate();
  const loadingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    // Intentar cargar desde cache inmediatamente
    const cached = getCachedData();
    if (cached) {
      setOrganizations(cached.organizations);
      setActiveOrganization(cached.activeOrganization);
      setIsAdmin(cached.isAdmin);
    }

    // Configurar listener PRIMERO (sincrónico, no bloquea)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        
        setSession(session);
        setUser(session?.user ?? null);
        
        // Usar setTimeout para evitar deadlock con Supabase
        if (session?.user && !loadingRef.current) {
          loadingRef.current = true;
          setTimeout(() => {
            loadUserData(session.user.id).finally(() => {
              loadingRef.current = false;
              if (isMounted) setIsLoading(false);
            });
          }, 0);
        } else if (!session) {
          setIsAdmin(false);
          setActiveOrganization(null);
          setOrganizations([]);
          clearCachedData();
          setIsLoading(false);
        }
      }
    );

    // Verificar sesión existente
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user && !loadingRef.current) {
        loadingRef.current = true;
        loadUserData(session.user.id).finally(() => {
          loadingRef.current = false;
          if (isMounted) setIsLoading(false);
        });
      } else if (!session) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadUserData = async (userId: string) => {
    try {
      // Ejecutar todas las queries en paralelo
      const [membershipsResult, activeOrgResult, adminRoleResult] = await Promise.all([
        supabase
          .from("organization_members")
          .select("organization_id, role, organizations(id, name)")
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(50),
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
          .limit(1)
      ]);

      let orgs: any[] = [];
      let activeOrg: string | null = null;
      let admin = false;

      // Procesar organizaciones
      if (!membershipsResult.error && membershipsResult.data) {
        orgs = membershipsResult.data.map((m: any) => ({
          id: m.organization_id,
          name: m.organizations.name,
          role: m.role,
        }));
        setOrganizations(orgs);

        // Configurar organización activa
        if (!activeOrgResult.error && activeOrgResult.data) {
          activeOrg = activeOrgResult.data.organization_id;
          setActiveOrganization(activeOrg);
        } else if (orgs.length > 0) {
          activeOrg = orgs[0].id;
          setActiveOrganization(activeOrg);
          // Upsert en segundo plano
          supabase
            .from("user_active_organization")
            .upsert({ user_id: userId, organization_id: orgs[0].id })
            .then(() => {});
        }
      }

      // Procesar rol admin
      admin = !adminRoleResult.error && !!adminRoleResult.data;
      setIsAdmin(admin);

      // Guardar en cache
      setCachedData(orgs, activeOrg, admin);

    } catch (error) {
      console.error("❌ Error cargando datos:", error);
      setIsAdmin(false);
    }
  };

  const setActiveOrganizationLocal = (organizationId: string) => {
    setActiveOrganization(organizationId);
    // Actualizar cache
    setCachedData(organizations, organizationId, isAdmin);
  };

  const switchOrganization = async (organizationId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("user_active_organization")
        .upsert({ user_id: user.id, organization_id: organizationId });

      if (!error) {
        setActiveOrganization(organizationId);
        setCachedData(organizations, organizationId, isAdmin);
      }
    } catch (error) {
      console.error("Error switching organization:", error);
    }
  };

  const signOut = async () => {
    clearCachedData();
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
        setActiveOrganizationLocal,
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
