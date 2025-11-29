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

    console.log(`Processing user: ${email}`);

    let userId: string;
    let isNewUser = false;
    let shouldSendEmail = false;

    // First, check if user already exists by querying profiles
    const { data: existingProfile, error: profileQueryError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (profileQueryError) {
      console.error('Error checking for existing user:', profileQueryError);
    }

    if (existingProfile) {
      // User already exists
      userId = existingProfile.id;
      isNewUser = false;
      console.log(`✅ User ${email} already exists with ID: ${userId}`);
    } else {
      // User doesn't exist, create new user
      console.log(`📝 Creating new user: ${email}`);
      
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: full_name || '',
        }
      });

      if (authError) {
        // If we get "already registered" error, try to find the user
        if (authError.message?.includes('already been registered') || (authError as any).code === 'email_exists') {
          console.log(`⚠️ User creation failed (already exists), searching in auth.users...`);
          
          // Query again from profiles in case it was just created
          const { data: retryProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', email)
            .maybeSingle();
          
          if (retryProfile) {
            userId = retryProfile.id;
            console.log(`📋 Found user in profiles: ${userId}`);
          } else {
            throw new Error(`User ${email} exists but could not be retrieved. Please try again.`);
          }
        } else {
          console.error('Error creating user:', authError);
          throw authError;
        }
      } else {
        userId = authData.user.id;
        isNewUser = true;
        shouldSendEmail = true;
        console.log(`✨ New user created with ID: ${userId}`);

        // Note: Profile and role are created automatically by database triggers
        // Just verify they exist
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for trigger to complete
      }
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

      // Check if user is already a member of this organization
      const { data: existingMember } = await supabaseAdmin
        .from('organization_members')
        .select('id')
        .eq('user_id', userId)
        .eq('organization_id', organization_id)
        .maybeSingle();

      if (!existingMember) {
        console.log(`➕ Adding user to organization: ${orgName}`);
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
      } else {
        console.log(`✅ User already member of organization: ${orgName}`);
      }

      // Set active organization only if this is a new user
      if (isNewUser) {
        const { error: activeOrgError } = await supabaseAdmin
          .from('user_active_organization')
          .upsert({
            user_id: userId,
            organization_id: organization_id,
          });

        if (activeOrgError) {
          console.error('Error setting active organization:', activeOrgError);
        }
      }
    }

    // Send welcome email with credentials only for new users
    if (shouldSendEmail) {
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
        console.log("✅ Welcome email sent successfully:", emailData);
      }
    }

    console.log(`✅ User ${isNewUser ? 'created' : 'updated'} successfully: ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId: userId,
        isNewUser: isNewUser,
        organizationAdded: !!organization_id,
        message: isNewUser 
          ? `Usuario ${email} creado exitosamente. Se ha enviado un correo con las credenciales.`
          : `Usuario ${email} agregado a la organización${orgName ? ` ${orgName}` : ''}.`
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
