import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitationRequest {
  email: string;
  role: string;
  organizationId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No se proporcionó token de autenticación" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client for all operations
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify JWT token manually
    const jwtToken = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(jwtToken);

    console.log("Auth check - User:", user?.id, "Error:", authError?.message);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "No autenticado", details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, role, organizationId }: InvitationRequest = await req.json();

    console.log("Sending invitation to:", email, "for organization:", organizationId);

    // Validar que el usuario tiene permisos globales o es admin de la organización
    const { data: userRole } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const isGlobalAdmin = userRole?.role === "admin";

    if (!isGlobalAdmin) {
      // Si no es admin global, verificar que sea admin de la organización
      const { data: membership, error: memberError } = await supabaseClient
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .single();

      if (memberError || !membership || !["owner", "admin"].includes(membership.role)) {
        return new Response(
          JSON.stringify({ error: "No tiene permisos para invitar usuarios a esta organización" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Obtener nombre de la organización
    const { data: org, error: orgError } = await supabaseClient
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: "Organización no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar si ya existe una invitación pendiente
    const { data: existingInvitation } = await supabaseClient
      .from("organization_invitations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", email)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (existingInvitation) {
      return new Response(
        JSON.stringify({ error: "Ya existe una invitación pendiente para este correo" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generar token único
    const token = crypto.randomUUID();
    
    // Calcular fecha de expiración (7 días)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Crear invitación
    const { error: insertError } = await supabaseClient
      .from("organization_invitations")
      .insert({
        organization_id: organizationId,
        email: email,
        role: role,
        invited_by: user.id,
        token: token,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error("Error creating invitation:", insertError);
      return new Response(
        JSON.stringify({ error: "Error al crear invitación" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Construir URL de aceptación
    const baseUrl = req.headers.get("origin") || "http://localhost:5173";
    const acceptUrl = `${baseUrl}/accept-invitation?token=${token}`;

    // Enviar email con Resend API directamente
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "InvoiceFlow <onboarding@resend.dev>",
        to: [email],
        subject: `Invitación a ${org.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Invitación a ${org.name}</h1>
            <p>Has sido invitado a unirte a <strong>${org.name}</strong> como <strong>${role}</strong>.</p>
            <p>Para aceptar la invitación, haz clic en el siguiente botón:</p>
            <a href="${acceptUrl}" 
               style="display: inline-block; background-color: #0070f3; color: white; 
                      padding: 12px 24px; text-decoration: none; border-radius: 5px; 
                      margin: 20px 0;">
              Aceptar Invitación
            </a>
            <p style="color: #666; font-size: 14px;">
              Esta invitación expirará en 7 días.
            </p>
            <p style="color: #666; font-size: 14px;">
              Si no solicitaste esta invitación, puedes ignorar este correo.
            </p>
          </div>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error("Error sending email:", errorData);
      throw new Error(`Failed to send email: ${JSON.stringify(errorData)}`);
    }

    const emailData = await emailResponse.json();
    console.log("Email sent successfully:", emailData);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Invitación enviada exitosamente",
        emailId: emailData.id 
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error("Error in send-invitation function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Error interno del servidor" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
