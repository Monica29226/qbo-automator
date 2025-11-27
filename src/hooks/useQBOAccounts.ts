import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface QBOAccount {
  id: string;
  name: string;
  accountNumber: string;
  accountType: string;
}

const fetchQBOAccountsFromAPI = async (organizationId: string): Promise<QBOAccount[]> => {
  // Verificar conexión QuickBooks primero
  const { data: qbIntegration } = await supabase
    .from("integration_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("service_type", "quickbooks")
    .eq("is_active", true)
    .maybeSingle();

  if (!qbIntegration) {
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
    staleTime: 5 * 60 * 1000, // 5 minutos - NO refetch si datos son recientes
    gcTime: 30 * 60 * 1000, // 30 minutos en cache
    refetchOnWindowFocus: false, // NO refetch al enfocar ventana
    refetchOnMount: false, // NO refetch al montar si hay datos en cache
    retry: 2,
  });

  // Crear mapas memoizados para búsquedas rápidas O(1)
  const accountsMap = new Map<string, QBOAccount>();
  const accountsByCode = new Map<string, string>();
  
  if (query.data) {
    query.data.forEach(acc => {
      accountsMap.set(acc.id, acc);
      if (acc.accountNumber) {
        accountsByCode.set(acc.accountNumber, acc.id);
        accountsByCode.set(acc.accountNumber.split(' ')[0], acc.id);
      }
      const match = acc.name.match(/^(\d+[\-\d]*)/);
      if (match) {
        accountsByCode.set(match[1], acc.id);
      }
    });
  }

  const getAccountIdFromCode = (accountCode: string | undefined): string => {
    if (!accountCode) return "";
    const cleanCode = accountCode.split(' ')[0].trim();
    const accountId = accountsByCode.get(cleanCode);
    if (accountId) return accountId;
    
    if (cleanCode.includes('-')) {
      const baseCode = cleanCode.split('-')[0];
      return accountsByCode.get(baseCode) || "";
    }
    return "";
  };

  const getAccountById = (id: string): QBOAccount | undefined => {
    return accountsMap.get(id);
  };

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
