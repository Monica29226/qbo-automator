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

    // ========== SECURITY: Validate JWT and admin permissions ==========
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Autenticación requerida' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callingUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !callingUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token de autenticación inválido' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Log audit entry for user creation attempt
    await supabaseAdmin.from('audit_log').insert({
      user_id: callingUser.id,
      action: 'create_user_attempt',
      resource_type: 'user',
      details: { caller_email: callingUser.email },
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip'),
      user_agent: req.headers.get('user-agent')
    });

    const { 
      email, password, full_name, role = 'user', organization_id,
      tipo_persona, numero_cedula, nombre_comercial, 
      nombre_representante, cedula_representante, telefono, direccion
    } = await req.json();

    // ========== SECURITY: Input validation ==========
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email inválido' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return new Response(
        JSON.stringify({ success: false, error: 'Contraseña debe tener al menos 8 caracteres' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Validate tipo_persona
    const validTipoPersona = tipo_persona === 'juridica' ? 'juridica' : 'fisica';

    // Validate cédula uniqueness if provided
    if (numero_cedula) {
      const cleanCedula = String(numero_cedula).replace(/\D/g, '');
      if (cleanCedula.length > 0) {
        const { data: existingCedula } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('numero_cedula', cleanCedula)
          .maybeSingle();
        
        if (existingCedula) {
          return new Response(
            JSON.stringify({ success: false, error: 'Ya existe un usuario con esta cédula' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          );
        }
      }
    }

    // Verify calling user is admin of the organization
    if (organization_id) {
      const { data: isAdmin } = await supabaseAdmin
        .rpc('is_organization_admin', { _org_id: organization_id, _user_id: callingUser.id });
      
      if (!isAdmin) {
        await supabaseAdmin.from('audit_log').insert({
          user_id: callingUser.id,
          organization_id: organization_id,
          action: 'unauthorized_user_creation',
          resource_type: 'user',
          details: { target_email: email, reason: 'not_admin' },
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip'),
          user_agent: req.headers.get('user-agent')
        });

        return new Response(
          JSON.stringify({ success: false, error: 'No tiene permisos para crear usuarios en esta organización' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
    }

    console.log(`Processing user: ${email}`);

    let userId: string;
    let isNewUser = false;
    let shouldSendEmail = false;

    // Check if user already exists
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      userId = existingProfile.id;
      isNewUser = false;
      console.log(`✅ User ${email} already exists with ID: ${userId}`);
      
      // Update profile with new fields if provided
      const profileUpdate: Record<string, unknown> = {};
      if (tipo_persona) profileUpdate.tipo_persona = validTipoPersona;
      if (numero_cedula) profileUpdate.numero_cedula = String(numero_cedula).replace(/\D/g, '');
      if (nombre_comercial !== undefined) profileUpdate.nombre_comercial = nombre_comercial;
      if (nombre_representante !== undefined) profileUpdate.nombre_representante = nombre_representante;
      if (cedula_representante) profileUpdate.cedula_representante = String(cedula_representante).replace(/\D/g, '');
      if (telefono !== undefined) profileUpdate.telefono = telefono;
      if (direccion !== undefined) profileUpdate.direccion = direccion;
      
      if (Object.keys(profileUpdate).length > 0) {
        await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', userId);
      }
    } else {
      console.log(`📝 Creating new user: ${email}`);

      // Pre-insert into allowed_emails so handle_new_user trigger accepts the signup
      await supabaseAdmin.from('allowed_emails').upsert({
        email: email.toLowerCase().trim(),
        default_role: role === 'admin' ? 'admin' : 'user',
        note: 'Auto-added via create-user',
        added_by: callingUser.id,
      });
      
      
      const { data: authData, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: full_name || '',
        }
      });

      if (createAuthError) {
        if (createAuthError.message?.includes('already been registered') || (createAuthError as any).code === 'email_exists') {
          const { data: retryProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', email)
            .maybeSingle();
          
          if (retryProfile) {
            userId = retryProfile.id;
          } else {
            throw new Error(`User ${email} exists but could not be retrieved.`);
          }
        } else {
          throw createAuthError;
        }
      } else {
        userId = authData.user.id;
        isNewUser = true;
        shouldSendEmail = true;
        console.log(`✨ New user created with ID: ${userId}`);

        // Wait for trigger to create profile
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Update profile with new fields
      const cleanCedula = numero_cedula ? String(numero_cedula).replace(/\D/g, '') : null;
      const cleanCedulaRep = cedula_representante ? String(cedula_representante).replace(/\D/g, '') : null;
      
      const { error: profileUpdateError } = await supabaseAdmin
        .from('profiles')
        .update({
          full_name: full_name || '',
          tipo_persona: validTipoPersona,
          numero_cedula: cleanCedula || null,
          nombre_comercial: nombre_comercial || null,
          nombre_representante: nombre_representante || null,
          cedula_representante: cleanCedulaRep || null,
          telefono: telefono || null,
          direccion: direccion || null,
        })
        .eq('id', userId!);

      if (profileUpdateError) {
        console.error('Error updating profile with new fields:', profileUpdateError);
      }
    }

    // Add user to organization
    let orgName = '';
    if (organization_id) {
      const { data: orgData } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', organization_id)
        .single();

      if (orgData) orgName = orgData.name;

      const { data: existingMember } = await supabaseAdmin
        .from('organization_members')
        .select('id')
        .eq('user_id', userId!)
        .eq('organization_id', organization_id)
        .maybeSingle();

      if (!existingMember) {
        const { error: memberError } = await supabaseAdmin
          .from('organization_members')
          .insert({
            user_id: userId!,
            organization_id: organization_id,
            role: 'member',
            is_active: true,
          });

        if (memberError) throw memberError;
      }

      if (isNewUser) {
        await supabaseAdmin
          .from('user_active_organization')
          .upsert({ user_id: userId!, organization_id });
      }
    }

    // Send welcome email
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
          from: "InvoiceFlow <noreply@aureoncr.com>",
          to: [email],
          subject: `Bienvenido a InvoiceFlow${orgName ? ` - ${orgName}` : ''}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #333;">¡Bienvenido a InvoiceFlow!</h1>
              ${orgName ? `<p>Se ha creado tu cuenta para acceder a <strong>${orgName}</strong>.</p>` : '<p>Se ha creado tu cuenta.</p>'}
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h2 style="color: #333; margin-top: 0;">Tus credenciales de acceso:</h2>
                <p><strong>Correo:</strong> ${email}</p>
                <p><strong>Contraseña temporal:</strong> <code style="background-color: #e0e0e0; padding: 4px 8px; border-radius: 4px;">${password}</code></p>
              </div>
              <p style="color: #d32f2f; font-size: 14px;"><strong>Importante:</strong> Cambia tu contraseña después del primer inicio de sesión.</p>
              <a href="${loginUrl}" style="display: inline-block; background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Iniciar Sesión</a>
            </div>
          `,
        }),
      });

      if (!emailResponse.ok) {
        const errorData = await emailResponse.json();
        console.error("Error sending welcome email:", errorData);
      } else {
        console.log("✅ Welcome email sent successfully");
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId: userId!,
        isNewUser,
        organizationAdded: !!organization_id,
        message: isNewUser 
          ? `Usuario ${email} creado exitosamente.`
          : `Usuario ${email} agregado a ${orgName || 'la organización'}.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error in create-user function:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
