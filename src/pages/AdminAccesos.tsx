import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Trash2, Plus } from "lucide-react";

interface AllowedEmail {
  email: string;
  default_role: "admin" | "moderator" | "user";
  note: string | null;
  added_by: string | null;
  created_at: string;
}

export default function AdminAccesos() {
  const [items, setItems] = useState<AllowedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "moderator" | "user">("user");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  const call = async (action: string, body: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("manage-allowed-emails", {
      body: { action, ...body },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await call("list");
      setItems(res.data ?? []);
    } catch (e: any) {
      toast.error(e.message || "Error cargando accesos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setAdding(true);
    try {
      await call("add", { email, default_role: role, note: note || null });
      toast.success("Correo agregado");
      setEmail("");
      setNote("");
      setRole("user");
      load();
    } catch (e: any) {
      toast.error(e.message || "Error agregando correo");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (em: string) => {
    if (!confirm(`¿Eliminar el acceso para ${em}?`)) return;
    try {
      await call("remove", { email: em });
      toast.success("Correo eliminado");
      load();
    } catch (e: any) {
      toast.error(e.message || "Error eliminando");
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Control de Accesos</h1>
      <p className="text-muted-foreground mb-6">
        Lista blanca de correos autorizados a iniciar sesión.
      </p>

      <Card className="p-4 mb-6">
        <form onSubmit={handleAdd} className="grid gap-4 md:grid-cols-[2fr_1fr_2fr_auto] items-end">
          <div className="space-y-2">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              placeholder="usuario@aclcostarica.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="moderator">moderator</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">Nota (opcional)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Quién/para qué"
            />
          </div>
          <Button type="submit" disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-2">Agregar</span>
          </Button>
        </form>
      </Card>

      <Card>
        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">Sin correos autorizados.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Nota</TableHead>
                <TableHead>Agregado</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.email}>
                  <TableCell className="font-mono text-sm">{it.email}</TableCell>
                  <TableCell>{it.default_role}</TableCell>
                  <TableCell className="text-muted-foreground">{it.note ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(it.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemove(it.email)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
