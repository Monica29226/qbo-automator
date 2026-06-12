import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Save, PlayCircle, Wand2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AccountCombobox } from "@/components/AccountCombobox";
import { useAuth } from "@/hooks/useAuth";
import { useQBOAccounts } from "@/hooks/useQBOAccounts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LegacyRow {
  legacy_code: string;
  doc_count: number;
  qbo_account_id: string;
  mapping_id?: string;
}

export default function LegacyAccountMapping() {
  const { activeOrganization } = useAuth();
  const { accounts, isLoading: accountsLoading, refetch: refetchAccounts } = useQBOAccounts();
  const [rows, setRows] = useState<LegacyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = async () => {
    if (!activeOrganization) return;
    setLoading(true);

    // Get docs in error or needs_account_mapping with legacy code pattern
    const { data: docs } = await supabase
      .from("processed_documents")
      .select("error_message, default_account_ref, status")
      .eq("organization_id", activeOrganization)
      .in("status", ["error", "needs_account_mapping"]);

    const counts = new Map<string, number>();
    const LEGACY_RE = /1150040\d+/;
    for (const d of docs || []) {
      const msg = d.error_message || "";
      const fromRef = (d.default_account_ref || "").match(LEGACY_RE)?.[0];
      const fromMsg = msg.match(LEGACY_RE)?.[0];
      const code = fromRef || fromMsg;
      if (code) counts.set(code, (counts.get(code) || 0) + 1);
    }

    const { data: mappings } = await supabase
      .from("legacy_account_mapping")
      .select("id, legacy_account_code, qbo_account_id")
      .eq("organization_id", activeOrganization);

    const mappingByCode = new Map<string, { id: string; qbo: string }>();
    for (const m of mappings || []) {
      mappingByCode.set(m.legacy_account_code, { id: m.id, qbo: m.qbo_account_id || "" });
      if (!counts.has(m.legacy_account_code)) counts.set(m.legacy_account_code, 0);
    }

    const list: LegacyRow[] = Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, n]) => ({
        legacy_code: code,
        doc_count: n,
        qbo_account_id: mappingByCode.get(code)?.qbo || "",
        mapping_id: mappingByCode.get(code)?.id,
      }));
    setRows(list);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrganization]);

  const setRowAccount = (code: string, qboId: string) => {
    setRows((prev) => prev.map((r) => (r.legacy_code === code ? { ...r, qbo_account_id: qboId } : r)));
  };

  const saveRow = async (row: LegacyRow) => {
    if (!activeOrganization || !row.qbo_account_id) {
      toast.error("Selecciona una cuenta de QuickBooks");
      return;
    }
    setSaving(row.legacy_code);
    const acc = accounts.find((a) => a.id === row.qbo_account_id);
    const { error } = await supabase
      .from("legacy_account_mapping")
      .upsert(
        {
          organization_id: activeOrganization,
          legacy_account_code: row.legacy_code,
          qbo_account_id: row.qbo_account_id,
          qbo_account_name: acc ? `${acc.accountNumber || ""} ${acc.name}`.trim() : null,
        },
        { onConflict: "organization_id,legacy_account_code" }
      );
    if (error) {
      setSaving(null);
      toast.error(`Error guardando: ${error.message}`);
      return;
    }
    toast.success(`Mapeo guardado: ${row.legacy_code} → ${acc?.name || row.qbo_account_id}`);

    // Find affected docs (status error/needs_account_mapping referencing this legacy code)
    const { data: affected } = await supabase
      .from("processed_documents")
      .select("id")
      .eq("organization_id", activeOrganization)
      .in("status", ["error", "needs_account_mapping"])
      .or(`error_message.ilike.%${row.legacy_code}%,default_account_ref.ilike.%${row.legacy_code}%`);

    const affectedIds = (affected || []).map((d: any) => d.id);

    if (affectedIds.length > 0) {
      // CRITICAL: force default_account_ref to the legacy code so the resolver hits the
      // legacy_account_mapping branch in publish-to-quickbooks (docs whose original
      // default_account_ref was a non-legacy string like "652 Cuotas" would fail again).
      await supabase
        .from("processed_documents")
        .update({
          status: "processed",
          default_account_ref: row.legacy_code,
          error_message: null,
        })
        .in("id", affectedIds);

      // Clear stale tracking rows so audits reflect the re-queued state.
      await supabase
        .from("qbo_publish_tracking")
        .delete()
        .in("document_id", affectedIds)
        .eq("status", "needs_account_mapping");

      toast.success(`${affectedIds.length} factura(s) re-encoladas. Publicando en segundo plano…`);

      // Fire-and-forget republish (function may take >30 s for batches).
      supabase.functions
        .invoke("publish-to-quickbooks", { body: { organization_id: activeOrganization } })
        .then(({ data, error: pubErr }) => {
          if (pubErr) {
            toast.error(`Error republicando: ${pubErr.message}`);
          } else {
            toast.success(
              `Republicación completada. Publicadas: ${data?.published ?? 0}, fallidas: ${data?.failed ?? 0}`
            );
          }
          load();
        })
        .catch((e) => toast.error(`Error republicando: ${e?.message || e}`));
    }

    setSaving(null);
    load();
  };

  const retryAll = async () => {
    if (!activeOrganization) return;
    setRetrying(true);
    try {
      const { data, error } = await supabase.functions.invoke("publish-to-quickbooks", {
        body: { organization_id: activeOrganization },
      });
      if (error) throw error;
      toast.success(`Reintento iniciado. Publicadas: ${data?.published ?? 0}, fallidas: ${data?.failed ?? 0}`);
    } catch (e: any) {
      toast.error(`Error al reintentar: ${e?.message || e}`);
    } finally {
      setRetrying(false);
      load();
    }
  };

  const autoMap = () => {
    let suggested = 0;
    setRows((prev) =>
      prev.map((r) => {
        if (r.qbo_account_id) return r;
        const last4 = r.legacy_code.slice(-4);
        const last3 = r.legacy_code.slice(-3);
        const match = accounts.find((a) => {
          const n = (a.accountNumber || "").toString();
          const name = (a.name || "").toLowerCase();
          return n === last4 || n.startsWith(last4) || n === last3 || name.includes(last4);
        });
        if (match) { suggested++; return { ...r, qbo_account_id: match.id }; }
        return r;
      })
    );
    toast.success(`Sugeridas ${suggested} cuenta(s). Revisa y guarda las que apliquen.`);
  };

  const [expanded, setExpanded] = useState<Record<string, any[]>>({});
  const toggleExpand = async (code: string) => {
    if (expanded[code]) { setExpanded((p) => { const n = { ...p }; delete n[code]; return n; }); return; }
    const { data } = await supabase
      .from("processed_documents")
      .select("doc_number, supplier_name, total_amount, currency, issue_date")
      .eq("organization_id", activeOrganization!)
      .in("status", ["error", "needs_account_mapping"])
      .or(`error_message.ilike.%${code}%,default_account_ref.ilike.%${code}%`)
      .limit(20);
    setExpanded((p) => ({ ...p, [code]: data || [] }));
  };

  const totalDocs = useMemo(() => rows.reduce((s, r) => s + r.doc_count, 0), [rows]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
          </Button>
          <h1 className="text-2xl font-semibold">Mapeo de cuentas legacy</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={autoMap} disabled={accountsLoading || rows.length === 0}>
            <Wand2 className="h-4 w-4 mr-1" />Auto-mapear por patrones
          </Button>
          <Button variant="outline" size="sm" onClick={() => { refetchAccounts(); load(); }}>
            <RefreshCw className="h-4 w-4 mr-1" />Refrescar
          </Button>
          <Button size="sm" onClick={retryAll} disabled={retrying}>
            <PlayCircle className="h-4 w-4 mr-1" />Reintentar publicación
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Cuentas heredadas del sistema viejo (prefijo <code>1150040</code>) que aparecen en facturas con error.
          Asocia cada código a su cuenta real de QuickBooks; al guardar, las facturas afectadas vuelven a publicarse automáticamente.
        </p>
        <div className="mt-3 flex gap-2 text-sm">
          <Badge variant="secondary">{rows.length} código(s) detectado(s)</Badge>
          <Badge variant="secondary">{totalDocs} factura(s) afectada(s)</Badge>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Código legacy</TableHead>
              <TableHead>Facturas</TableHead>
              <TableHead>Cuenta QuickBooks</TableHead>
              <TableHead className="w-32">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Cargando…</TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sin cuentas legacy pendientes.</TableCell></TableRow>
            )}
            {rows.map((row) => (
              <React.Fragment key={row.legacy_code}>
                <TableRow>
                  <TableCell>
                    {row.doc_count > 0 && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleExpand(row.legacy_code)}>
                        {expanded[row.legacy_code] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">{row.legacy_code}</TableCell>
                  <TableCell>
                    <Badge variant={row.doc_count > 0 ? "destructive" : "secondary"}>{row.doc_count}</Badge>
                  </TableCell>
                  <TableCell>
                    <AccountCombobox
                      accounts={accounts}
                      value={row.qbo_account_id}
                      onValueChange={(v) => setRowAccount(row.legacy_code, v)}
                      placeholder={accountsLoading ? "Cargando cuentas…" : "Seleccionar cuenta QBO"}
                      className="w-full"
                    />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => saveRow(row)} disabled={saving === row.legacy_code || !row.qbo_account_id}>
                      <Save className="h-4 w-4 mr-1" />Guardar
                    </Button>
                  </TableCell>
                </TableRow>
                {expanded[row.legacy_code] && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/40">
                      <div className="text-xs space-y-1 max-h-64 overflow-auto">
                        {expanded[row.legacy_code].length === 0 && <span className="text-muted-foreground">Sin facturas asociadas.</span>}
                        {expanded[row.legacy_code].map((d: any, i: number) => (
                          <div key={i} className="flex gap-3 py-1 border-b last:border-0">
                            <span className="font-mono w-32 truncate">{d.doc_number}</span>
                            <span className="flex-1 truncate">{d.supplier_name}</span>
                            <span>{d.issue_date}</span>
                            <span className="font-mono">{d.currency} {Number(d.total_amount).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
