import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface AuditLogEntry {
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
}

export const useAuditLog = () => {
  const { user, activeOrganization } = useAuth();

  const logAction = useCallback(
    async (entry: AuditLogEntry) => {
      if (!user) return;

      try {
        const logEntry = {
          user_id: user.id,
          organization_id: activeOrganization || undefined,
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId || undefined,
          details: entry.details || {},
        };
        
        await supabase.from("audit_log").insert(logEntry as any);
      } catch (error) {
        // Don't throw - audit logging should not break main flow
        console.error("Audit log failed:", error);
      }
    },
    [user, activeOrganization]
  );

  const logSensitiveAccess = useCallback(
    (resourceType: string, resourceId?: string) => {
      return logAction({
        action: "sensitive_access",
        resourceType,
        resourceId,
      });
    },
    [logAction]
  );

  const logDataExport = useCallback(
    (resourceType: string, details?: Record<string, unknown>) => {
      return logAction({
        action: "data_export",
        resourceType,
        details,
      });
    },
    [logAction]
  );

  const logConfigChange = useCallback(
    (resourceType: string, resourceId: string, details?: Record<string, unknown>) => {
      return logAction({
        action: "config_change",
        resourceType,
        resourceId,
        details,
      });
    },
    [logAction]
  );

  const logPermissionChange = useCallback(
    (resourceType: string, resourceId: string, details?: Record<string, unknown>) => {
      return logAction({
        action: "permission_change",
        resourceType,
        resourceId,
        details,
      });
    },
    [logAction]
  );

  return {
    logAction,
    logSensitiveAccess,
    logDataExport,
    logConfigChange,
    logPermissionChange,
  };
};
