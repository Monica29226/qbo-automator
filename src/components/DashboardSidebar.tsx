import { Link, useLocation } from "react-router-dom";
import {
  Building2,
  Database,
  Eye,
  FileCheck,
  FileSpreadsheet,
  FileText,
  LogOut,
  Plug,
  Settings,
  Shield,
  Users,
} from "lucide-react";
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

  const navigationItems = [
    {
      title: "Revisión",
      icon: Eye,
      path: "/review-queue",
      badge: reviewCount > 0 ? reviewCount : undefined,
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
  ];

  const managementItems = [
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
      title: "Configuración",
      icon: Settings,
      path: "/settings",
      show: isAdmin,
    },
    {
      title: "Mi Empresa",
      icon: Building2,
      path: "/organization",
      show: isAdmin,
    },
  ];

  const rulesItems = [
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
  ];

  const renderMenuItems = (items: typeof navigationItems) => {
    return items
      .filter((item) => item.show)
      .map((item) => (
        <SidebarMenuItem key={item.path}>
          <SidebarMenuButton asChild isActive={isActive(item.path)}>
            <Link
              to={item.path}
              className="flex items-center gap-3 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <item.icon className="h-4 w-4" />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.title}</span>
                  {item.badge && (
                    <Badge variant="secondary" className="ml-auto">
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
    <Sidebar collapsible="icon" className="border-r">
      <SidebarContent>
        {/* Logo/Brand */}
        <SidebarGroup>
          <div className="flex items-center gap-3 px-4 py-6">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <FileText className="h-6 w-6 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div>
                <h2 className="text-lg font-bold text-foreground">FacturaFlow CR</h2>
                <p className="text-xs text-muted-foreground">ACL Automation</p>
              </div>
            )}
          </div>
        </SidebarGroup>

        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navegación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderMenuItems(navigationItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Management */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Gestión</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderMenuItems(managementItems)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Rules */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Reglas</SidebarGroupLabel>
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
                <SidebarMenuButton onClick={onSignOut}>
                  <LogOut className="h-4 w-4" />
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
