import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, organizationId } = await req.json();
    
    if (!documentId || !organizationId) {
      throw new Error("documentId and organizationId are required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Retrying failed bill for document ${documentId}`);

    // Get the document with error
    const { data: doc, error: docError } = await supabase
      .from("processed_documents")
      .select("*")
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .eq("status", "error")
      .single();

    if (docError || !doc) {
      throw new Error("Document not found or not in error status");
    }

    // Re-extract data from XML if available
    if (doc.xml_data && doc.xml_content) {
      console.log("Re-extracting invoice data from XML...");
      
      const { data: extractResult, error: extractError } = await supabase.functions.invoke(
        "extract-invoice-data",
        {
          body: { 
            xmlContent: doc.xml_content,
            categories: [] 
          }
        }
      );

      if (extractError) {
        console.error("Re-extraction failed:", extractError);
        throw new Error(`Failed to re-extract invoice data: ${extractError.message}`);
      }

      // Update document with new extracted data
      const updateData: any = {
        xml_data: extractResult,
        status: "processed",
        error_message: null,
        updated_at: new Date().toISOString(),
      };

      // Update specific fields from extraction
      if (extractResult.numeroConsecutivo) updateData.doc_number = extractResult.numeroConsecutivo;
      if (extractResult.emisor?.nombre) updateData.supplier_name = extractResult.emisor.nombre;
      if (extractResult.fechaEmision) updateData.issue_date = extractResult.fechaEmision;
      if (extractResult.totalComprobante) updateData.total_amount = extractResult.totalComprobante;
      if (extractResult.detalle) updateData.detalle = extractResult.detalle;

      const { error: updateError } = await supabase
        .from("processed_documents")
        .update(updateData)
        .eq("id", documentId);

      if (updateError) {
        throw new Error(`Failed to update document: ${updateError.message}`);
      }

      console.log("Document re-extracted successfully");
    } else {
      // Just reset status to retry with existing data
      const { error: resetError } = await supabase
        .from("processed_documents")
        .update({
          status: "processed",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      if (resetError) {
        throw new Error(`Failed to reset document status: ${resetError.message}`);
      }

      console.log("Document status reset to processed");
    }

    // Now try to publish to QuickBooks
    console.log("Publishing to QuickBooks...");
    const { data: publishResult, error: publishError } = await supabase.functions.invoke(
      "publish-to-quickbooks",
      {
        body: { organization_id: organizationId }
      }
    );

    if (publishError) {
      console.error("Publish failed:", publishError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: publishError.message,
          message: "Document re-extracted but publish failed. Check QuickBooks connection."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Document re-processed and published successfully",
        result: publishResult
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: any) {
    console.error("Error in retry-failed-bills:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});