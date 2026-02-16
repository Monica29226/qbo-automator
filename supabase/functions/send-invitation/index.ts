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

// Genera una contraseña temporal segura
function generateTempPassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*";
  const all = upper + lower + digits + special;
  
  // Asegurar al menos uno de cada tipo
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  
  let password = "";
  password += upper[arr[0] % upper.length];
  password += lower[arr[1] % lower.length];
  password += digits[arr[2] % digits.length];
  password += special[arr[3] % special.length];
  
  for (let i = 4; i < length; i++) {
    password += all[arr[i] % all.length];
  }
  
  // Mezclar caracteres
  return password.split("").sort(() => Math.random() - 0.5).join("");
}

// Template HTML profesional para el email de invitación
function buildInvitationHtml(params: {
  orgName: string;
  role: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
}): string {
  const { orgName, role, email, tempPassword, loginUrl } = params;
  
  const roleLabel = role === "admin" ? "Administrador" : role === "owner" ? "Propietario" : "Usuario";
  
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          
          <!-- Header con logo -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%); padding: 32px 40px; text-align: center;">
              <img src="https://lqirqvvkjpunhtsvebot.supabase.co/storage/v1/object/public/email-assets/acl-logo.png" 
                   alt="ACL Logo" 
                   width="180" 
                   style="max-width: 180px; height: auto;" />
              <p style="color: #e2e8f0; font-size: 14px; margin: 12px 0 0 0; letter-spacing: 0.5px;">
                Sistema de Facturación Electrónica
              </p>
            </td>
          </tr>
          
          <!-- Contenido principal -->
          <tr>
            <td style="padding: 40px;">
              <h1 style="color: #1a365d; font-size: 24px; margin: 0 0 8px 0; font-weight: 600;">
                ¡Bienvenido al equipo!
              </h1>
              <p style="color: #4a5568; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Has sido invitado a unirte a <strong style="color: #1a365d;">${orgName}</strong> 
                como <strong style="color: #2c5282;">${roleLabel}</strong>.
              </p>
              
              <!-- Credenciales -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ebf4ff; border-radius: 8px; border-left: 4px solid #3182ce; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <p style="color: #2c5282; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px 0;">
                      🔐 Credenciales de acceso
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0" style="width: 100%;">
                      <tr>
                        <td style="padding: 4px 0; color: #4a5568; font-size: 14px; width: 120px;">Correo:</td>
                        <td style="padding: 4px 0; color: #1a365d; font-size: 14px; font-weight: 600;">${email}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #4a5568; font-size: 14px;">Contraseña:</td>
                        <td style="padding: 4px 0;">
                          <code style="background-color: #fff; padding: 4px 12px; border-radius: 4px; font-size: 15px; font-weight: 700; color: #c53030; border: 1px solid #e2e8f0; letter-spacing: 1px;">${tempPassword}</code>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Botón de acceso -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 8px 0 24px 0;">
                    <a href="${loginUrl}" 
                       style="display: inline-block; background: linear-gradient(135deg, #2c5282 0%, #3182ce 100%); color: #ffffff; 
                              padding: 14px 40px; text-decoration: none; border-radius: 8px; 
                              font-size: 16px; font-weight: 600; letter-spacing: 0.3px;
                              box-shadow: 0 4px 12px rgba(49, 130, 206, 0.4);">
                      Ingresar a la Plataforma →
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Instrucciones -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f7fafc; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <p style="color: #2d3748; font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">
                      📋 Instrucciones de primer acceso:
                    </p>
                    <ol style="color: #4a5568; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                      <li>Haga clic en <strong>"Ingresar a la Plataforma"</strong></li>
                      <li>Ingrese su correo electrónico y la contraseña temporal</li>
                      <li>Una vez dentro, le recomendamos cambiar su contraseña en <strong>Configuración</strong></li>
                      <li>Explore el dashboard para familiarizarse con el sistema</li>
                    </ol>
                  </td>
                </tr>
              </table>
              
              <!-- Nota de seguridad -->
              <p style="color: #a0aec0; font-size: 12px; line-height: 1.6; margin: 0; border-top: 1px solid #e2e8f0; padding-top: 16px;">
                ⚠️ Por seguridad, le recomendamos cambiar su contraseña temporal al ingresar por primera vez.
                Si usted no solicitó esta invitación, puede ignorar este correo.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #1a365d; padding: 20px 40px; text-align: center;">
              <p style="color: #a0c4e8; font-size: 12px; margin: 0; line-height: 1.6;">
                © ${new Date().getFullYear()} ACL Calderón — Sistema de Facturación Electrónica<br/>
                Este es un correo automático, por favor no responda a este mensaje.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const jwtToken = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(jwtToken);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "No autenticado", details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, role, organizationId }: InvitationRequest = await req.json();
    console.log("Sending invitation to:", email, "for organization:", organizationId);

    // Verificar permisos
    const { data: userRole } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const isGlobalAdmin = userRole?.role === "admin";

    if (!isGlobalAdmin) {
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

    // Generar contraseña temporal
    const tempPassword = generateTempPassword(12);

    // Verificar si el usuario ya existe
    const { data: existingProfile } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    let userId: string;

    if (existingProfile) {
      // Usuario ya existe, solo agregarlo a la organización
      userId = existingProfile.id;
      console.log("User already exists, adding to organization:", userId);
    } else {
      // Crear usuario nuevo con contraseña temporal
      const { data: newUser, error: createError } = await supabaseClient.auth.admin.createUser({
        email: email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: email.split("@")[0] },
      });

      if (createError) {
        console.error("Error creating user:", createError);
        return new Response(
          JSON.stringify({ error: `Error al crear usuario: ${createError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      userId = newUser.user.id;
      console.log("New user created:", userId);

      // Crear perfil
      await supabaseClient.from("profiles").upsert({
        id: userId,
        email: email,
        full_name: email.split("@")[0],
      });

      // Asignar rol
      await supabaseClient.from("user_roles").upsert({
        user_id: userId,
        role: role === "admin" ? "admin" : "user",
      });
    }

    // Agregar como miembro de la organización si no existe
    const { data: existingMember } = await supabaseClient
      .from("organization_members")
      .select("id, is_active")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingMember) {
      if (!existingMember.is_active) {
        await supabaseClient
          .from("organization_members")
          .update({ is_active: true, role: role })
          .eq("id", existingMember.id);
      }
    } else {
      await supabaseClient.from("organization_members").insert({
        organization_id: organizationId,
        user_id: userId,
        role: role,
        is_active: true,
      });
    }

    // Registrar invitación
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Eliminar invitaciones previas pendientes
    await supabaseClient
      .from("organization_invitations")
      .delete()
      .eq("organization_id", organizationId)
      .eq("email", email)
      .is("accepted_at", null);

    await supabaseClient.from("organization_invitations").insert({
      organization_id: organizationId,
      email: email,
      role: role,
      invited_by: user.id,
      token: token,
      expires_at: expiresAt.toISOString(),
    });

    // Construir URL de login
    const baseUrl = req.headers.get("origin") || "https://facturas.aureoncr.com";
    const loginUrl = `${baseUrl}/auth`;

    // Enviar email profesional con Resend
    const fromAddress = "ACL Facturación <noreply@calderon.cr>";
    
    const emailHtml = buildInvitationHtml({
      orgName: org.name,
      role: role,
      email: email,
      tempPassword: existingProfile ? "(usa tu contraseña actual)" : tempPassword,
      loginUrl: loginUrl,
    });

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        subject: `Invitación a ${org.name} — ACL Facturación Electrónica`,
        html: emailHtml,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error("Error sending email:", errorData);
      // No fallar si el email no se envía - el usuario ya fue creado
      return new Response(
        JSON.stringify({
          success: true,
          warning: "Usuario creado pero el email no se pudo enviar",
          emailError: errorData,
          tempPassword: existingProfile ? null : tempPassword,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailData = await emailResponse.json();
    console.log("Email sent successfully:", emailData);

    return new Response(
      JSON.stringify({
        success: true,
        message: existingProfile 
          ? "Usuario existente agregado a la organización y notificado por email"
          : "Usuario creado e invitación enviada exitosamente",
        emailId: emailData.id,
        isNewUser: !existingProfile,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-invitation function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Error interno del servidor" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
