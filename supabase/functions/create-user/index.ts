import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const { email, password, full_name, role = 'user', organization_id } = await req.json();

    if (!email || !password) {
      throw new Error('Email y contraseña son requeridos');
    }

    console.log(`Creating user: ${email}`);

    // Create user with admin client
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name || '',
      }
    });

    if (authError) {
      console.error('Error creating user:', authError);
      throw authError;
    }

    const userId = authData.user.id;

    // Create profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: userId,
        email: email,
        full_name: full_name || null,
      });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      throw profileError;
    }

    // Create user role
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: userId,
        role: role,
      });

    if (roleError) {
      console.error('Error creating user role:', roleError);
      throw roleError;
    }

    // Add user to organization if organization_id is provided
    let orgName = '';
    if (organization_id) {
      // Get organization name
      const { data: orgData, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', organization_id)
        .single();

      if (orgError) {
        console.error('Error fetching organization:', orgError);
      } else {
        orgName = orgData.name;
      }

      const { error: memberError } = await supabaseAdmin
        .from('organization_members')
        .insert({
          user_id: userId,
          organization_id: organization_id,
          role: 'member',
          is_active: true,
        });

      if (memberError) {
        console.error('Error adding user to organization:', memberError);
        throw memberError;
      }

      // Set active organization
      const { error: activeOrgError } = await supabaseAdmin
        .from('user_active_organization')
        .insert({
          user_id: userId,
          organization_id: organization_id,
        });

      if (activeOrgError) {
        console.error('Error setting active organization:', activeOrgError);
      }
    }

    // Send welcome email with credentials
    const baseUrl = req.headers.get("origin") || "http://localhost:5173";
    const loginUrl = `${baseUrl}/auth`;

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "InvoiceFlow <onboarding@resend.dev>",
        to: [email],
        subject: `Bienvenido a InvoiceFlow${orgName ? ` - ${orgName}` : ''}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #333;">¡Bienvenido a InvoiceFlow!</h1>
            ${orgName ? `<p>Se ha creado tu cuenta para acceder a <strong>${orgName}</strong>.</p>` : '<p>Se ha creado tu cuenta.</p>'}
            
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="color: #333; margin-top: 0;">Tus credenciales de acceso:</h2>
              <p style="margin: 10px 0;">
                <strong>Correo electrónico:</strong> ${email}
              </p>
              <p style="margin: 10px 0;">
                <strong>Contraseña temporal:</strong> <code style="background-color: #e0e0e0; padding: 4px 8px; border-radius: 4px;">${password}</code>
              </p>
            </div>

            <p style="color: #d32f2f; font-size: 14px; margin: 20px 0;">
              <strong>Importante:</strong> Por seguridad, te recomendamos cambiar tu contraseña después del primer inicio de sesión.
            </p>

            <a href="${loginUrl}" 
               style="display: inline-block; background-color: #0070f3; color: white; 
                      padding: 12px 24px; text-decoration: none; border-radius: 5px; 
                      margin: 20px 0;">
              Iniciar Sesión
            </a>

            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              Si no solicitaste esta cuenta, puedes ignorar este correo.
            </p>
          </div>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error("Error sending welcome email:", errorData);
      // No lanzamos error aquí porque el usuario ya fue creado exitosamente
    } else {
      const emailData = await emailResponse.json();
      console.log("Welcome email sent successfully:", emailData);
    }

    console.log(`✅ User created successfully: ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: authData.user,
        message: `Usuario ${email} creado exitosamente. Se ha enviado un correo con las credenciales.`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in create-user function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
