import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const { organization_id } = await req.json();
    if (!organization_id) {
      throw new Error("Missing organization_id");
    }

    // Verify user has access
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .single();

    if (!membership) {
      throw new Error("User not authorized for this organization");
    }

    // Get all processed documents
    const { data: documents } = await supabase
      .from("processed_documents")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("status", "published")
      .not("pdf_attachment_url", "is", null);

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ message: "No documents found to upload", uploaded: 0, failed: 0 }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    console.log(`Starting batch upload of ${documents.length} documents to Google Drive`);

    let uploaded = 0;
    let failed = 0;

    // Upload documents one by one
    for (const doc of documents) {
      try {
        const uploadResponse = await fetch(`${SUPABASE_URL}/functions/v1/upload-to-google-drive`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            document_id: doc.id,
            organization_id: organization_id,
          }),
        });

        if (uploadResponse.ok) {
          uploaded++;
        } else {
          failed++;
          console.error(`Failed to upload document ${doc.id}`);
        }
      } catch (error) {
        failed++;
        console.error(`Error uploading document ${doc.id}:`, error);
      }
    }

    console.log(`Batch upload completed: ${uploaded} uploaded, ${failed} failed`);

    return new Response(
      JSON.stringify({ 
        message: "Batch upload completed", 
        uploaded, 
        failed,
        total: documents.length 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in batch upload:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
