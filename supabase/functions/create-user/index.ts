import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_MEMBER_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
type MemberRole = typeof VALID_MEMBER_ROLES[number];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ===== Auth =====
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ success: false, error: 'Autenticación requerida' }, 401);
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callingUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !callingUser) {
      return json({ success: false, error: 'Token inválido' }, 401);
    }

    // Global admin?
    const { data: globalRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', callingUser.id)
      .eq('role', 'admin')
      .maybeSingle();
    const isGlobalAdmin = !!globalRole;

    const body = await req.json();
    const {
      email,
      password,
      full_name,
      role = 'member',
      organization_id,
      organization_ids,
      tipo_persona,
      numero_cedula,
      nombre_comercial,
      nombre_representante,
      cedula_representante,
      telefono,
      direccion,
    } = body;

    // ===== Validate input =====
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return json({ success: false, error: 'Email inválido' }, 400);
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return json({ success: false, error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
    }

    const memberRole: MemberRole = (VALID_MEMBER_ROLES as readonly string[]).includes(role)
      ? (role as MemberRole)
      : 'member';

    // Normalize organization list
    const requestedOrgIds: string[] = Array.isArray(organization_ids) && organization_ids.length > 0
      ? organization_ids.filter((x) => typeof x === 'string')
      : organization_id ? [organization_id] : [];

    if (requestedOrgIds.length === 0) {
      return json({ success: false, error: 'Debe seleccionar al menos una empresa' }, 400);
    }

    // ===== Permission filter per org =====
    const allowedOrgIds: string[] = [];
    const skipped: { organization_id: string; reason: string }[] = [];

    if (isGlobalAdmin) {
      allowedOrgIds.push(...requestedOrgIds);
    } else {
      for (const orgId of requestedOrgIds) {
        const { data: isAdmin } = await supabaseAdmin
          .rpc('is_organization_admin', { _org_id: orgId, _user_id: callingUser.id });
        if (isAdmin) allowedOrgIds.push(orgId);
        else skipped.push({ organization_id: orgId, reason: 'No es admin de esta empresa' });
      }
    }

    if (allowedOrgIds.length === 0) {
      await supabaseAdmin.from('audit_log').insert({
        user_id: callingUser.id,
        action: 'unauthorized_user_creation',
        resource_type: 'user',
        details: { target_email: email, requested: requestedOrgIds },
      });
      return json({ success: false, error: 'Sin permisos para asignar a las empresas solicitadas' }, 403);
    }

    const validTipoPersona = tipo_persona === 'juridica' ? 'juridica' : 'fisica';
    const cleanCedula = numero_cedula ? String(numero_cedula).replace(/\D/g, '') : null;
    const cleanCedulaRep = cedula_representante ? String(cedula_representante).replace(/\D/g, '') : null;

    // ===== Duplicate cédula check =====
    if (cleanCedula) {
      const { data: existingCedula } = await supabaseAdmin
        .from('profiles')
        .select('id, email')
        .eq('numero_cedula', cleanCedula)
        .maybeSingle();
      if (existingCedula && existingCedula.email !== email) {
        return json({ success: false, error: 'Ya existe un usuario con esta cédula' }, 400);
      }
    }

    // ===== Find or create user =====
    let userId: string;
    let isNewUser = false;

    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      userId = existingProfile.id;
    } else {
      // Ensure email allowed (handle_new_user trigger uses it)
      await supabaseAdmin.from('allowed_emails').upsert({
        email: email.toLowerCase().trim(),
        default_role: memberRole === 'admin' || role === 'admin' ? 'admin' : 'user',
        note: 'Auto-added via create-user',
        added_by: callingUser.id,
      });

      const { data: authData, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || '' },
      });

      if (createAuthError) {
        if (createAuthError.message?.includes('already been registered') || (createAuthError as any).code === 'email_exists') {
          const { data: retry } = await supabaseAdmin
            .from('profiles').select('id').eq('email', email).maybeSingle();
          if (!retry) throw new Error(`Usuario ${email} existe pero no se pudo recuperar.`);
          userId = retry.id;
        } else {
          throw createAuthError;
        }
      } else {
        userId = authData.user.id;
        isNewUser = true;
        await new Promise((r) => setTimeout(r, 400)); // wait for handle_new_user trigger
      }
    }

    // ===== Upsert profile fields =====
    const profileUpdate: Record<string, unknown> = {
      tipo_persona: validTipoPersona,
      telefono: telefono ?? null,
      direccion: direccion ?? null,
    };
    if (full_name) profileUpdate.full_name = full_name;
    if (cleanCedula) profileUpdate.numero_cedula = cleanCedula;
    if (nombre_comercial !== undefined) profileUpdate.nombre_comercial = nombre_comercial;
    if (nombre_representante !== undefined) profileUpdate.nombre_representante = nombre_representante;
    if (cleanCedulaRep) profileUpdate.cedula_representante = cleanCedulaRep;

    await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', userId!);

    // ===== Global role: only persist 'admin' as global; everything else stays per-org =====
    if (role === 'admin' && isGlobalAdmin) {
      await supabaseAdmin.from('user_roles').upsert(
        { user_id: userId!, role: 'admin' },
        { onConflict: 'user_id,role' }
      );
    }

    // ===== Bulk assign organizations =====
    const added: string[] = [];
    const reactivated: string[] = [];
    const alreadyMember: string[] = [];
    const failed: { organization_id: string; reason: string }[] = [];

    for (const orgId of allowedOrgIds) {
      const { data: existingMember } = await supabaseAdmin
        .from('organization_members')
        .select('id, is_active, role')
        .eq('user_id', userId!)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (existingMember) {
        if (existingMember.is_active && existingMember.role === memberRole) {
          alreadyMember.push(orgId);
        } else {
          const { error } = await supabaseAdmin
            .from('organization_members')
            .update({ is_active: true, role: memberRole })
            .eq('id', existingMember.id);
          if (error) failed.push({ organization_id: orgId, reason: error.message });
          else reactivated.push(orgId);
        }
      } else {
        const { error } = await supabaseAdmin
          .from('organization_members')
          .insert({ user_id: userId!, organization_id: orgId, role: memberRole, is_active: true });
        if (error) failed.push({ organization_id: orgId, reason: error.message });
        else added.push(orgId);
      }
    }

    // Set active org for brand new users
    if (isNewUser && (added.length > 0 || reactivated.length > 0)) {
      const firstOrg = added[0] ?? reactivated[0];
      await supabaseAdmin
        .from('user_active_organization')
        .upsert({ user_id: userId!, organization_id: firstOrg });
    }

    // ===== Welcome email (only for new users) =====
    if (isNewUser && RESEND_API_KEY) {
      const loginUrl = "https://facturas.aclcostarica.com/auth";
      const logoUrl = "https://lqirqvvkjpunhtsvebot.supabase.co/storage/v1/object/public/email-assets/acl-logo.png";
      const displayName = full_name || email.split('@')[0];
      const year = new Date().getFullYear();
      const orgCount = added.length + reactivated.length;

      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: "ACL Costa Rica <noreply@aureoncr.com>",
            to: [email],
            subject: `Bienvenido a ACL Facturas — Tus credenciales de acceso`,
            html: `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1f36;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(38,49,77,0.08);">
<tr><td style="background:#26314D;padding:32px 24px;text-align:center;"><img src="${logoUrl}" alt="ACL" width="140" style="display:block;margin:0 auto;max-width:140px;height:auto;" /><p style="color:#EDE6D3;margin:16px 0 0;font-size:14px;letter-spacing:1px;text-transform:uppercase;">Sistema de Facturación Electrónica</p></td></tr>
<tr><td style="padding:40px 40px 16px;"><h1 style="margin:0 0 12px;color:#26314D;font-size:24px;font-weight:700;line-height:1.3;">¡Bienvenido(a), ${displayName}!</h1>
<p style="margin:0;color:#4a5165;font-size:15px;line-height:1.6;">Se ha creado tu cuenta con acceso a <strong>${orgCount}</strong> ${orgCount === 1 ? 'empresa' : 'empresas'} en ACL Facturas.</p></td></tr>
<tr><td style="padding:8px 40px 24px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f0;border-left:4px solid #26314D;border-radius:6px;"><tr><td style="padding:24px;"><p style="margin:0 0 16px;color:#26314D;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Tus credenciales</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:110px;">Correo:</td><td style="padding:6px 0;color:#1a1f36;font-size:14px;font-family:'Courier New',monospace;"><strong>${email}</strong></td></tr>
<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Contraseña:</td><td style="padding:6px 0;"><code style="background:#fff;border:1px solid #e5e7eb;padding:6px 10px;border-radius:4px;font-size:14px;color:#26314D;font-weight:700;display:inline-block;">${password}</code></td></tr></table></td></tr></table></td></tr>
<tr><td align="center" style="padding:8px 40px 40px;"><a href="${loginUrl}" style="display:inline-block;background:#26314D;border-radius:8px;padding:16px 40px;color:#EDE6D3;font-size:16px;font-weight:700;text-decoration:none;">Ingresar a ACL Facturas →</a></td></tr>
<tr><td style="background:#f8f6f0;padding:24px 40px;text-align:center;border-top:1px solid #ede6d3;"><p style="margin:0;color:#8b91a1;font-size:12px;">© ${year} ACL Costa Rica</p></td></tr>
</table></td></tr></table></body></html>`,
          }),
        });
      } catch (e) {
        console.error('Email error:', e);
      }
    }

    return json({
      success: true,
      userId: userId!,
      isNewUser,
      added,
      reactivated,
      alreadyMember,
      skipped,
      failed,
      message: isNewUser
        ? `Usuario creado y asignado a ${added.length + reactivated.length} empresa(s).`
        : `Usuario asignado a ${added.length + reactivated.length} empresa(s).`,
    }, 200);

  } catch (error) {
    console.error('create-user error:', error);
    return json({ success: false, error: error instanceof Error ? error.message : 'Error desconocido' }, 400);
  }
});

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
