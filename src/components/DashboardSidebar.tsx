import { Link, useLocation } from "react-router-dom";
import { useMemo } from "react";
import {
  Building2,
  Eye,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Clock,
  LogOut,
  Plug,
  Settings,
  Shield,
  Users,
  TrendingUp,
} from "lucide-react";
import calderonLogo from "@/assets/acl-logo-new.png";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

interface DashboardSidebarProps {
  isAdmin: boolean;
  reviewCount: number;
  onSignOut: () => void;
}

export function DashboardSidebar({ isAdmin, reviewCount, onSignOut }: DashboardSidebarProps) {
  const location = useLocation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const isActive = (path: string) => location.pathname === path;

  // Memoizar items para evitar recalculos en cada render
  const navigationItems = useMemo(() => [
    {
      title: "Todas las Facturas",
      icon: FileText,
      path: "/all-invoices",
      show: true,
    },
    {
      title: "Gastos Pendientes",
      icon: Clock,
      path: "/invoices-pending-log",
      badge: reviewCount > 0 ? reviewCount : undefined,
      show: true,
    },
    {
      title: "Facturas de Venta",
      icon: TrendingUp,
      path: "/sales-invoices",
      show: true,
    },
    {
      title: "Revisión",
      icon: Eye,
      path: "/review-queue",
      show: true,
    },
    {
      title: "Estado QuickBooks",
      icon: FileCheck,
      path: "/quickbooks-status",
      show: true,
    },
    {
      title: "Reporte Auditoría",
      icon: FileCheck,
      path: "/audit-report",
      show: true,
    },
    {
      title: "Reporte por Tasa IVA",
      icon: FileSpreadsheet,
      path: "/tax-rate-report",
      show: true,
    },
  ], [reviewCount]);

  const managementItems = useMemo(() => [
    {
      title: "Integraciones",
      icon: Plug,
      path: "/integrations",
      show: isAdmin,
    },
    {
      title: "Proveedores",
      icon: Users,
      path: "/vendors",
      show: isAdmin,
    },
    {
      title: "Usuarios ACL",
      icon: Shield,
      path: "/users-management",
      show: isAdmin,
    },
    {
      title: "Mi Empresa",
      icon: Building2,
      path: "/my-company",
      show: true,
    },
    {
      title: "Configuración",
      icon: Settings,
      path: "/settings",
      show: isAdmin,
    },
  ], [isAdmin]);

  const rulesItems = useMemo(() => [
    {
      title: "Reglas Proveedores",
      icon: FileSpreadsheet,
      path: "/vendor-rules",
      show: isAdmin,
    },
    {
      title: "Validaciones",
      icon: Shield,
      path: "/validation-rules",
      show: isAdmin,
    },
  ], [isAdmin]);

  const renderMenuItems = (items: typeof navigationItems) => {
    return items
      .filter((item) => item.show)
      .map((item, index) => (
        <SidebarMenuItem 
          key={item.path}
          style={{ animationDelay: `${index * 50}ms` }}
          className="animate-fade-in-subtle"
        >
          <SidebarMenuButton asChild isActive={isActive(item.path)}>
            <Link
              to={item.path}
              className="flex items-center gap-3 text-sidebar-foreground hover:bg-sidebar-accent/20 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent/30 data-[active=true]:text-sidebar-foreground transition-all duration-200 hover:translate-x-1"
            >
              <item.icon className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.title}</span>
                  {item.badge && (
                    <Badge variant="secondary" className="ml-auto bg-sidebar-accent/40 text-sidebar-foreground animate-scale-in">
                      {item.badge}
                    </Badge>
                  )}
                </>
              )}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ));
  };

  return (
    <Sidebar collapsible="icon" className="border-r bg-sidebar-background animate-slide-in-left">
      <SidebarContent>
        {/* Logo/Brand */}
        <SidebarGroup>
          <div className="flex items-center gap-3 px-4 py-6 border-b border-sidebar-accent/20">
            <div className="h-12 w-12 flex items-center justify-center flex-shrink-0 bg-card rounded-lg p-1.5 transition-transform duration-300 hover:scale-105">
              <img 
                src={calderonLogo} 
                alt="Calderón Logo" 
                className="w-full h-full object-contain"
              />
            </div>
            {!collapsed && (
              <div className="animate-fade-in-subtle">
                <h2 className="text-base font-heading font-bold text-sidebar-foreground">FacturaFlow CR</h2>
                <p className="text-xs text-sidebar-foreground/70">Sistema de Facturación</p>
              </div>
            )}
          </div>
        </SidebarGroup>

        {/* Navigation */}
        <SidebarGroup className="text-sidebar-foreground">
          <SidebarGroupLabel className="text-sidebar-foreground/60">Navegación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderMenuItems(navigationItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Management */}
        {isAdmin && (
          <SidebarGroup className="text-sidebar-foreground">
            <SidebarGroupLabel className="text-sidebar-foreground/60">Gestión</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderMenuItems(managementItems)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Rules */}
        {isAdmin && (
          <SidebarGroup className="text-sidebar-foreground">
            <SidebarGroupLabel className="text-sidebar-foreground/60">Reglas</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderMenuItems(rulesItems)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Sign Out */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  onClick={onSignOut} 
                  className="text-sidebar-foreground hover:bg-sidebar-accent/20 hover:text-sidebar-foreground transition-all duration-200 hover:translate-x-1"
                >
                  <LogOut className="h-4 w-4 transition-transform duration-200 hover:scale-110" />
                  {!collapsed && <span>Salir</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
