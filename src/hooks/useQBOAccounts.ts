import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMemo } from "react";

export interface QBOAccount {
  id: string;
  name: string;
  accountNumber: string;
  accountType: string;
}

const fetchQBOAccountsFromAPI = async (organizationId: string): Promise<QBOAccount[]> => {
  // Verificar conexión QuickBooks vía RPC seguro (RLS bloquea SELECT directo a integration_accounts)
  const { data: isConnected, error: rpcError } = await supabase.rpc("has_active_integration", {
    _org_id: organizationId,
    _service_type: "quickbooks",
  });

  if (rpcError) {
    console.warn("⚠️ Error checking QuickBooks connection:", rpcError);
  }

  if (!isConnected) {
    console.log("⚠️ QuickBooks not connected");
    return [];
  }

  const { data, error } = await supabase.functions.invoke(
    "list-quickbooks-accounts",
    { body: { organization_id: organizationId } }
  );

  if (error) throw error;
  
  return data?.accounts || [];
};

export const useQBOAccounts = () => {
  const { activeOrganization } = useAuth();

  const query = useQuery({
    queryKey: ["qbo-accounts", activeOrganization],
    queryFn: () => fetchQBOAccountsFromAPI(activeOrganization!),
    enabled: !!activeOrganization,
    staleTime: 5 * 60 * 1000, // 5 minutos - refrescar más seguido para detectar nuevas cuentas
    gcTime: 30 * 60 * 1000, // 30 minutos en cache
    refetchOnWindowFocus: true, // Refetch al enfocar ventana para detectar cambios
    refetchOnMount: "always", // Siempre verificar al montar
    retry: 2,
  });

  // Memoizar mapas para búsquedas O(1) - SOLO recalcular si query.data cambia
  const { accountsMap, accountsByCode } = useMemo(() => {
    const aMap = new Map<string, QBOAccount>();
    const cMap = new Map<string, string>();
    
    if (query.data) {
      query.data.forEach(acc => {
        aMap.set(acc.id, acc);
        if (acc.accountNumber) {
          cMap.set(acc.accountNumber, acc.id);
          cMap.set(acc.accountNumber.split(' ')[0], acc.id);
        }
        const match = acc.name.match(/^(\d+[\-\d]*)/);
        if (match) {
          cMap.set(match[1], acc.id);
        }
      });
    }
    
    return { accountsMap: aMap, accountsByCode: cMap };
  }, [query.data]);

  const getAccountIdFromCode = useMemo(() => (accountCode: string | undefined): string => {
    if (!accountCode) return "";
    const cleanCode = accountCode.split(' ')[0].trim();
    const accountId = accountsByCode.get(cleanCode);
    if (accountId) return accountId;
    
    if (cleanCode.includes('-')) {
      const baseCode = cleanCode.split('-')[0];
      return accountsByCode.get(baseCode) || "";
    }
    return "";
  }, [accountsByCode]);

  const getAccountById = useMemo(() => (id: string): QBOAccount | undefined => {
    return accountsMap.get(id);
  }, [accountsMap]);

  return {
    accounts: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isConnected: (query.data?.length || 0) > 0,
    accountsMap,
    accountsByCode,
    getAccountIdFromCode,
    getAccountById,
  };
};
