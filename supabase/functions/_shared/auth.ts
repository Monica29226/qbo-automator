// Shared authorization helpers for Supabase Edge Functions.
// deno-lint-ignore-file no-explicit-any

export interface AuthorizedCaller {
  userId: string | null;
  isServiceRole: boolean;
}

export function jsonError(
  message: string,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

export async function authorizeOrganizationAccess(
  req: Request,
  supabase: any,
  serviceRoleKey: string,
  organizationId: string,
  options: { allowedRoles?: string[] } = {},
): Promise<AuthorizedCaller | Response> {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "").trim();

  if (!token) {
    return jsonError("Unauthorized", 401, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    });
  }

  if (token === serviceRoleKey) {
    return { userId: null, isServiceRole: true };
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return jsonError("Unauthorized", 401, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    });
  }

  const query = supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  const { data: membership, error: membershipError } = await query;
  if (membershipError || !membership) {
    return jsonError("Forbidden", 403, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    });
  }

  if (options.allowedRoles?.length && !options.allowedRoles.includes(membership.role)) {
    return jsonError("Forbidden", 403, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    });
  }

  return { userId: user.id, isServiceRole: false };
}
