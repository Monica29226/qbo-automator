import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Cloud } from "lucide-react";

interface Org { id: string; name: string }
interface Doc { id: string; doc_number: string; supplier_name: string; issue_date: string; total_amount: number; organization_id: string }

const BATCH = 20;

export default function AdminSharePointBulkUpload() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("organizations").select("id, name").eq("is_active", true).order("name");
      setOrgs(data || []);
    })();
  }, []);

  const search = async () => {
    setLoading(true);
    setResult(null);
    let q = supabase
      .from("processed_documents")
      .select("id, doc_number, supplier_name, issue_date, total_amount, organization_id")
      .not("qbo_entity_id", "is", null)
      .is("sharepoint_uploaded_at", null)
      .order("issue_date", { ascending: false })
      .limit(500);
    if (orgId) q = q.eq("organization_id", orgId);
    if (from) q = q.gte("issue_date", from);
    if (to) q = q.lte("issue_date", to);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setDocs((data as any) || []);
  };

  const uploadAll = async () => {
    if (docs.length === 0) return;
    setRunning(true);
    setProgress(0);
    let ok = 0, failed = 0;
    for (let i = 0; i < docs.length; i += BATCH) {
      const slice = docs.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        slice.map((d) =>
          supabase.functions.invoke("upload-to-sharepoint", { body: { document_id: d.id } }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled" && !(r.value as any).error) ok++; else failed++;
      }
      setProgress(Math.round(((i + slice.length) / docs.length) * 100));
    }
    setRunning(false);
    setResult({ ok, failed });
    toast.success(`Hecho: ${ok} subidas, ${failed} fallidas`);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Cloud className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">SharePoint — Subida masiva</h1>
          <p className="text-muted-foreground">Subir facturas históricas publicadas en QBO a SharePoint.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>Empresa</Label>
              <select className="w-full border rounded h-10 px-2 bg-background" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">— Todas —</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div><Label>Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="flex items-end"><Button onClick={search} disabled={loading} className="w-full">{loading ? "Buscando…" : "Buscar"}</Button></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facturas pendientes ({docs.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {docs.length > 0 && (
            <Button onClick={uploadAll} disabled={running}>
              {running ? "Subiendo…" : `Subir ${docs.length} a SharePoint`}
            </Button>
          )}
          {running && <Progress value={progress} />}
          {result && (
            <div className="text-sm">✅ Subidas: <strong>{result.ok}</strong> · ❌ Fallidas: <strong>{result.failed}</strong></div>
          )}
          <div className="max-h-96 overflow-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr>
                <th className="text-left p-2">Fecha</th>
                <th className="text-left p-2">Número</th>
                <th className="text-left p-2">Proveedor</th>
                <th className="text-right p-2">Monto</th>
              </tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="p-2">{d.issue_date}</td>
                    <td className="p-2">{d.doc_number}</td>
                    <td className="p-2">{d.supplier_name}</td>
                    <td className="p-2 text-right">{Number(d.total_amount).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
