import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SendBulkRequest {
  userIds?: string[]; // If empty, send to all users
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No se proporcionó token de autenticación" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify JWT token
    const jwtToken = authHeader.replace("Bearer ", "");
    const { data: { user: requestingUser }, error: authError } = await supabaseAdmin.auth.getUser(jwtToken);

    if (authError || !requestingUser) {
      return new Response(
        JSON.stringify({ error: "No autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify requesting user is admin
    const { data: userRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", requestingUser.id)
      .maybeSingle();

    if (userRole?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Solo administradores pueden enviar invitaciones masivas" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userIds }: SendBulkRequest = await req.json();

    // Get users to send emails to
    let query = supabaseAdmin
      .from("profiles")
      .select("id, email, full_name");

    if (userIds && userIds.length > 0) {
      query = query.in("id", userIds);
    }

    const { data: users, error: usersError } = await query;

    if (usersError) {
      throw usersError;
    }

    if (!users || users.length === 0) {
      return new Response(
        JSON.stringify({ error: "No se encontraron usuarios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Sending welcome emails to ${users.length} users`);

    // Get the base URL from the request
    const baseUrl = req.headers.get("origin") || "https://qbo-automator.lovable.app";
    const loginUrl = `${baseUrl}/auth`;

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const user of users) {
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: "ACL Sistema de Facturas <onboarding@resend.dev>",
            to: [user.email],
            subject: "Bienvenido al Sistema de Facturas ACL",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #1a365d; margin: 0;">Sistema de Facturas ACL</h1>
                </div>
                
                <h2 style="color: #333;">¡Hola${user.full_name ? ` ${user.full_name}` : ''}!</h2>
                
                <p style="color: #555; line-height: 1.6;">
                  Te damos la bienvenida al <strong>Sistema de Facturas de ACL</strong>. 
                  Esta plataforma te permite gestionar y procesar facturas electrónicas de manera eficiente.
                </p>
                
                <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 25px 0;">
                  <h3 style="color: #333; margin-top: 0;">¿Qué puedes hacer?</h3>
                  <ul style="color: #555; line-height: 1.8;">
                    <li>📄 Ver y gestionar facturas de tus empresas asignadas</li>
                    <li>🔄 Sincronizar facturas desde correo electrónico</li>
                    <li>📊 Publicar facturas a QuickBooks automáticamente</li>
                    <li>📁 Organizar documentos por proveedor y fecha</li>
                  </ul>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${loginUrl}" 
                     style="display: inline-block; background-color: #1a365d; color: white; 
                            padding: 14px 30px; text-decoration: none; border-radius: 6px;
                            font-weight: bold; font-size: 16px;">
                    Iniciar Sesión
                  </a>
                </div>
                
                <p style="color: #888; font-size: 14px; margin-top: 30px;">
                  Si tienes alguna pregunta, contacta al administrador del sistema.
                </p>
                
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                  Este correo fue enviado automáticamente desde el Sistema ACL.
                </p>
              </div>
            `,
          }),
        });

        if (!emailResponse.ok) {
          const errorData = await emailResponse.json();
          console.error(`Error sending to ${user.email}:`, errorData);
          errors.push(`${user.email}: ${errorData.message || 'Error desconocido'}`);
          errorCount++;
        } else {
          console.log(`Email sent to ${user.email}`);
          successCount++;
        }

        // Small delay between emails to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (err: any) {
        console.error(`Exception sending to ${user.email}:`, err);
        errors.push(`${user.email}: ${err.message}`);
        errorCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Emails enviados: ${successCount} exitosos, ${errorCount} fallidos`,
        successCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in send-bulk-welcome function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
