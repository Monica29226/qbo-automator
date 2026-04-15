import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useBankImports() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  const configsQuery = useQuery({
    queryKey: ["bank-import-configs", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("bank_import_configs")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
  });

  const sourcesQuery = useQuery({
    queryKey: ["bank-import-sources", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("bank_import_sources")
        .select("*, bank_import_configs(bank_name)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
  });

  const jobsQuery = useQuery({
    queryKey: ["bank-import-jobs", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("bank_import_jobs")
        .select("*, bank_import_configs(bank_name, currency)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
  });

  const createConfig = useMutation({
    mutationFn: async (config: any) => {
      const { data, error } = await supabase
        .from("bank_import_configs")
        .insert({ ...config, organization_id: organizationId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-import-configs"] });
      toast.success("Configuración bancaria creada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateConfig = useMutation({
    mutationFn: async ({ id, ...updates }: any) => {
      const { error } = await supabase
        .from("bank_import_configs")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-import-configs"] });
      toast.success("Configuración actualizada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteConfig = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bank_import_configs")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-import-configs"] });
      toast.success("Configuración eliminada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createSource = useMutation({
    mutationFn: async (source: any) => {
      const { data, error } = await supabase
        .from("bank_import_sources")
        .insert({ ...source, organization_id: organizationId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-import-sources"] });
      toast.success("Fuente creada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createJob = useMutation({
    mutationFn: async (job: any) => {
      const { data, error } = await supabase
        .from("bank_import_jobs")
        .insert({ ...job, organization_id: organizationId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-import-jobs"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const processJob = useMutation({
    mutationFn: async ({ jobId, csvContent, configId }: { jobId: string; csvContent: string; configId: string }) => {
      const { data, error } = await supabase.functions.invoke("process-bank-statement", {
        body: {
          action: "process_csv_content",
          job_id: jobId,
          csv_content: csvContent,
          organization_id: organizationId,
          config_id: configId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bank-import-jobs"] });
      toast.success(`Procesado: ${data.valid} válidas, ${data.invalid} con errores`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const generateCsv = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke("process-bank-statement", {
        body: {
          action: "generate_qbo_csv",
          job_id: jobId,
          organization_id: organizationId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bank-import-jobs"] });
      toast.success(`CSV generado: ${data.rows_exported} transacciones`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const reprocessJob = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke("process-bank-statement", {
        body: { action: "reprocess_job", job_id: jobId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-import-jobs"] });
      toast.success("Job reseteado para reprocesar");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const getJobItems = useCallback(async (jobId: string) => {
    const { data, error } = await supabase
      .from("bank_import_job_items")
      .select("*")
      .eq("bank_import_job_id", jobId)
      .order("transaction_date", { ascending: true });
    if (error) throw error;
    return data || [];
  }, []);

  const downloadCsv = useCallback(async (csvPath: string) => {
    const { data, error } = await supabase.storage
      .from("company-documents")
      .createSignedUrl(csvPath, 300);
    if (error) throw error;
    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  }, []);

  return {
    configs: configsQuery.data || [],
    sources: sourcesQuery.data || [],
    jobs: jobsQuery.data || [],
    isLoading: configsQuery.isLoading || jobsQuery.isLoading,
    createConfig,
    updateConfig,
    deleteConfig,
    createSource,
    createJob,
    processJob,
    generateCsv,
    reprocessJob,
    getJobItems,
    downloadCsv,
    refetchJobs: jobsQuery.refetch,
  };
}
