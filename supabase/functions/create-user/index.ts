import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

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
    if (organization_id) {
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

    console.log(`✅ User created successfully: ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: authData.user,
        message: `Usuario ${email} creado exitosamente`
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
