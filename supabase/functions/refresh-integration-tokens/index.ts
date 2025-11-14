import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("🔄 Iniciando verificación de tokens de integración...");

    // Obtener todas las cuentas activas de Gmail y QuickBooks
    const { data: accounts, error: fetchError } = await supabase
      .from("integration_accounts")
      .select("*")
      .in("service_type", ["gmail", "quickbooks"])
      .eq("is_active", true);

    if (fetchError) throw fetchError;
    if (!accounts || accounts.length === 0) {
      console.log("No hay cuentas activas para verificar");
      return new Response(
        JSON.stringify({ success: true, message: "No active accounts" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = {
      gmail: { checked: 0, refreshed: 0, warned: 0, failed: 0 },
      quickbooks: { checked: 0, refreshed: 0, warned: 0, failed: 0 },
    };

    for (const account of accounts) {
      const credentials = account.credentials as any;
      const now = Date.now();

      if (account.service_type === "gmail") {
        results.gmail.checked++;
        
        // Parse expires_at (puede ser timestamp o ISO string)
        const expiresAt = typeof credentials.expires_at === "string"
          ? new Date(credentials.expires_at).getTime()
          : credentials.expires_at;

        const hoursUntilExpiration = (expiresAt - now) / (1000 * 60 * 60);

        // Si expira en menos de 12 horas, renovar
        if (hoursUntilExpiration < 12) {
          console.log(`⚠️ Gmail token expirando en ${Math.floor(hoursUntilExpiration)} horas, renovando...`);
          
          try {
            const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
            const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

            const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: credentials.refresh_token,
                grant_type: "refresh_token",
              }),
            });

            if (!refreshResponse.ok) {
              const errorText = await refreshResponse.text();
              console.error("❌ Gmail token refresh failed:", errorText);
              results.gmail.failed++;
              
              // Registrar alerta crítica
              await supabase.from("alert_history").insert({
                organization_id: account.organization_id,
                alert_type: "critical",
                issues_count: 1,
                issues_data: [{
                  type: "critical",
                  title: "Fallo al renovar token de Gmail",
                  description: `No se pudo renovar el token de Gmail automáticamente. Reconecte su cuenta.`,
                  actionRequired: "Reconectar Gmail en Configuración > Integraciones",
                  data: { account_email: account.account_email, error: errorText }
                }]
              });
              continue;
            }

            const newTokens = await refreshResponse.json();
            
            await supabase
              .from("integration_accounts")
              .update({
                credentials: {
                  ...credentials,
                  access_token: newTokens.access_token,
                  expires_at: now + (newTokens.expires_in * 1000),
                },
              })
              .eq("id", account.id);

            console.log(`✅ Gmail token renovado para ${account.account_email}`);
            results.gmail.refreshed++;
          } catch (error) {
            console.error("❌ Error renovando Gmail token:", error);
            results.gmail.failed++;
          }
        } else if (hoursUntilExpiration < 24) {
          results.gmail.warned++;
        }
      }

      if (account.service_type === "quickbooks") {
        results.quickbooks.checked++;
        
        // Parse expires_at (QuickBooks usa ISO string)
        const expiresAt = typeof credentials.expires_at === "string"
          ? new Date(credentials.expires_at).getTime()
          : credentials.expires_at;

        const hoursUntilExpiration = (expiresAt - now) / (1000 * 60 * 60);

        // Si expira en menos de 24 horas o ya expiró, renovar
        if (hoursUntilExpiration < 24) {
          console.log(`⚠️ QuickBooks token expirando en ${Math.floor(hoursUntilExpiration)} horas, renovando...`);
          
          try {
            const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
            const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;

            const refreshResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`,
              },
              body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: credentials.refresh_token,
              }),
            });

            if (!refreshResponse.ok) {
              const errorText = await refreshResponse.text();
              console.error("❌ QuickBooks token refresh failed:", errorText);
              results.quickbooks.failed++;
              
              // Registrar alerta crítica
              await supabase.from("alert_history").insert({
                organization_id: account.organization_id,
                alert_type: "critical",
                issues_count: 1,
                issues_data: [{
                  type: "critical",
                  title: "Fallo al renovar token de QuickBooks",
                  description: `No se pudo renovar el token de QuickBooks automáticamente. Reconecte su cuenta.`,
                  actionRequired: "Reconectar QuickBooks en Configuración > Integraciones",
                  data: { realm_id: credentials.realm_id, error: errorText }
                }]
              });
              continue;
            }

            const newTokens = await refreshResponse.json();
            const newExpiresAt = now + (newTokens.expires_in * 1000);
            
            await supabase
              .from("integration_accounts")
              .update({
                credentials: {
                  ...credentials,
                  access_token: newTokens.access_token,
                  refresh_token: newTokens.refresh_token,
                  expires_at: newExpiresAt, // Guardar como timestamp numérico
                },
              })
              .eq("id", account.id);

            console.log(`✅ QuickBooks token renovado (expira en ${Math.floor(newTokens.expires_in / 3600)} horas)`);
            results.quickbooks.refreshed++;
          } catch (error) {
            console.error("❌ Error renovando QuickBooks token:", error);
            results.quickbooks.failed++;
          }
        } else if (hoursUntilExpiration < 48) {
          results.quickbooks.warned++;
        }
      }
    }

    console.log("✅ Verificación completada:", results);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error en refresh-integration-tokens:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
