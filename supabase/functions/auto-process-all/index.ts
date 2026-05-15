import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_ACCOUNT_CODE = "5105"; // Costo de Ventas - cuenta por defecto

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // SECURITY: require service-role (cron) or authenticated user JWT
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    const isServiceRole = !!token && token === supabaseKey;
    let callerUserId: string | null = null;
    if (!isServiceRole) {
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: userData, error: userErr } = await anon.auth.getUser(token);
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerUserId = userData.user.id;
    }

    const { organization_id } = await req.json();

    if (!organization_id) {
      throw new Error("organization_id is required");
    }

    // If the caller is a user (not service role), enforce org membership
    if (callerUserId) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("id")
        .eq("user_id", callerUserId)
        .eq("organization_id", organization_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log(`🚀 Auto-processing all pending documents for: ${organization_id}`);

    const results = {
      review_processed: 0,
      errors_fixed: 0,
      vendors_created: 0,
      rules_created: 0,
      published: 0,
      failed: 0,
    };

    // 1. PROCESAR COLA DE REVISIÓN AUTOMÁTICAMENTE
    console.log("\n📋 Step 1: Processing review queue...");
    const { data: reviewDocs, error: reviewError } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("status", "review");

    if (reviewError) throw reviewError;

    if (reviewDocs && reviewDocs.length > 0) {
      console.log(`Found ${reviewDocs.length} documents in review queue`);

      for (const doc of reviewDocs) {
        console.log(`\n🔍 Processing review doc: ${doc.doc_number} - ${doc.supplier_name}`);

        // Buscar vendor existente por tax_id
        let { data: existingVendor } = await supabase
          .from("vendors")
          .select("*")
          .eq("organization_id", organization_id)
          .eq("vendor_tax_id", doc.supplier_tax_id)
          .eq("is_active", true)
          .maybeSingle();

        if (!existingVendor) {
          // Buscar vendor existente por nombre similar
          const { data: similarVendors } = await supabase
            .from("vendors")
            .select("*")
            .eq("organization_id", organization_id)
            .ilike("vendor_name", `%${doc.supplier_name.substring(0, 10)}%`)
            .eq("is_active", true)
            .limit(1);

          if (similarVendors && similarVendors.length > 0) {
            existingVendor = similarVendors[0];
            console.log(`✓ Found similar vendor: ${existingVendor.vendor_name}`);
          }
        }

        if (existingVendor) {
          console.log(`✓ Using existing vendor: ${existingVendor.vendor_name}`);
          
          // Actualizar documento para usar el vendor existente
          await supabase
            .from("processed_documents")
            .update({
              vendor_id: existingVendor.id,
              status: "pending",
              retry_count: (doc.retry_count || 0) + 1,
            })
            .eq("id", doc.id);

          results.review_processed++;
        } else {
          console.log(`⚠️ No vendor found, marking as pending_config`);
          
          // NO crear regla automática - requerir configuración manual
          // Marcar como pending_config para que el usuario configure la cuenta
          await supabase
            .from("processed_documents")
            .update({
              status: "pending_config",
              retry_count: (doc.retry_count || 0) + 1,
            })
            .eq("id", doc.id);

          results.review_processed++;
        }
      }
    }

    // 2. RESOLVER DOCUMENTOS CON ERROR DE CUENTA CONTABLE
    console.log("\n🔧 Step 2: Fixing account classification errors...");
    const { data: errorDocs, error: errorDocsError } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("status", "error")
      .ilike("error_message", "%cuenta contable%");

    if (errorDocsError) throw errorDocsError;

    if (errorDocs && errorDocs.length > 0) {
      console.log(`Found ${errorDocs.length} documents with account errors`);

      for (const doc of errorDocs) {
        console.log(`\n🔧 Fixing: ${doc.doc_number} - ${doc.supplier_name}`);

        // Buscar configuración exitosa previa del mismo proveedor
        const { data: successfulDoc } = await supabase
          .from("processed_documents")
          .select("vendor_id")
          .eq("organization_id", organization_id)
          .eq("supplier_tax_id", doc.supplier_tax_id)
          .eq("status", "published")
          .not("qbo_entity_id", "is", null)
          .limit(1)
          .maybeSingle();

        if (successfulDoc?.vendor_id) {
          console.log(`✓ Found successful vendor configuration`);
          
          // Usar la configuración exitosa
          await supabase
            .from("processed_documents")
            .update({
              vendor_id: successfulDoc.vendor_id,
              status: "pending",
              error_message: null,
              retry_count: (doc.retry_count || 0) + 1,
            })
            .eq("id", doc.id);

          results.errors_fixed++;
        } else {
          console.log(`⚠️ No previous success, marking as pending_config`);
          
          // NO asignar cuenta por defecto - requerir configuración manual
          await supabase
            .from("processed_documents")
            .update({
              status: "pending_config",
              error_message: "Proveedor sin cuenta contable configurada. Configure la cuenta para continuar.",
              retry_count: (doc.retry_count || 0) + 1,
            })
            .eq("id", doc.id);

          results.errors_fixed++;
        }
      }
    }

    // 3. PUBLICAR TODOS LOS DOCUMENTOS PENDIENTES
    console.log("\n📤 Step 3: Publishing all pending documents...");
    
    const { data: publishResult, error: publishError } = await supabase.functions.invoke(
      "publish-to-quickbooks",
      {
        body: { organization_id },
      }
    );

    if (publishError) {
      console.error("Error publishing:", publishError);
    } else {
      results.published = publishResult.published || 0;
      results.failed = publishResult.failed || 0;
      console.log(`✅ Published: ${results.published}, Failed: ${results.failed}`);
    }

    const summary = {
      success: true,
      ...results,
      message: `Processed ${results.review_processed + results.errors_fixed} documents, published ${results.published}`,
    };

    console.log("\n📊 Auto-Process Summary:", summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Auto-process error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
