import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();
    console.log('📝 Republishing document:', documentId);

    if (!documentId) {
      throw new Error('documentId is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get auth header to pass to publish function
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Clean the document record - remove QuickBooks references
    console.log('🧹 Cleaning document record...');
    const { error: cleanError } = await supabase
      .from('processed_documents')
      .update({
        qbo_entity_id: null,
        qbo_entity_type: null,
        error_message: null,
        status: 'processed',
        retry_count: 0
      })
      .eq('id', documentId);

    if (cleanError) {
      console.error('❌ Error cleaning document:', cleanError);
      throw cleanError;
    }

    console.log('✅ Document cleaned successfully');

    // Wait a moment for the database to update
    await new Promise(resolve => setTimeout(resolve, 500));

    // Now publish to QuickBooks
    console.log('📤 Publishing to QuickBooks...');
    const { data: publishData, error: publishError } = await supabase.functions.invoke(
      'publish-to-quickbooks',
      {
        body: { document_ids: [documentId] },
        headers: { Authorization: authHeader }
      }
    );

    if (publishError) {
      console.error('❌ Error publishing to QuickBooks:', publishError);
      throw publishError;
    }

    console.log('✅ Publish result:', publishData);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Documento republicado exitosamente',
        result: publishData
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('❌ Error in republish-single-document:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
