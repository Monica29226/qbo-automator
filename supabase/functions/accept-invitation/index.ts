import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AcceptInvitationRequest {
  token: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Verificar autenticación
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "No autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { token }: AcceptInvitationRequest = await req.json();

    console.log("Processing invitation acceptance for token:", token);

    // Buscar invitación
    const { data: invitation, error: inviteError } = await supabaseClient
      .from("organization_invitations")
      .select("*")
      .eq("token", token)
      .is("accepted_at", null)
      .single();

    if (inviteError || !invitation) {
      console.error("Invitation not found:", inviteError);
      return new Response(
        JSON.stringify({ error: "Invitación no encontrada o ya utilizada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar que el email coincide con el usuario autenticado
    if (invitation.email !== user.email) {
      return new Response(
        JSON.stringify({ error: "Esta invitación no es para tu correo" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar que no haya expirado
    if (new Date(invitation.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Esta invitación ha expirado" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar si el usuario ya es miembro
    const { data: existingMember } = await supabaseClient
      .from("organization_members")
      .select("id")
      .eq("organization_id", invitation.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingMember) {
      // Marcar invitación como aceptada aunque ya sea miembro
      await supabaseClient
        .from("organization_invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invitation.id);

      return new Response(
        JSON.stringify({ error: "Ya eres miembro de esta organización" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Agregar como miembro
    const { error: memberError } = await supabaseClient
      .from("organization_members")
      .insert({
        organization_id: invitation.organization_id,
        user_id: user.id,
        role: invitation.role,
      });

    if (memberError) {
      console.error("Error adding member:", memberError);
      return new Response(
        JSON.stringify({ error: "Error al agregar miembro" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Marcar invitación como aceptada
    const { error: updateError } = await supabaseClient
      .from("organization_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);

    if (updateError) {
      console.error("Error updating invitation:", updateError);
    }

    // Establecer como organización activa si el usuario no tiene ninguna
    const { data: activeOrg } = await supabaseClient
      .from("user_active_organization")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!activeOrg) {
      await supabaseClient
        .from("user_active_organization")
        .insert({
          user_id: user.id,
          organization_id: invitation.organization_id,
        });
    }

    console.log("Invitation accepted successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Invitación aceptada exitosamente",
        organizationId: invitation.organization_id
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
    console.error("Error in accept-invitation function:", error);
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
