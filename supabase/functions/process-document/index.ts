import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProcessDocumentRequest {
  xml_content: string;
  doc_key?: string;
  organization_id: string;
  pdf_path?: string;
  xml_path?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { xml_content, doc_key, organization_id, pdf_path, xml_path }: ProcessDocumentRequest = await req.json();

    if (!organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "organization_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Obtener reglas de validación configuradas
    const { data: validationSettings } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("organization_id", organization_id)
      .in("key", [
        "validation_min_date",
        "validation_accept_invoices",
        "validation_accept_credit_notes",
        "validation_accept_debit_notes",
        "validation_reject_tickets",
        "validation_duplicate_window_days",
      ]);

    // Convertir a objeto para fácil acceso con valores por defecto
    const validationRules = {
      minDate: "2025-11-01",
      acceptInvoices: true,
      acceptCreditNotes: true,
      acceptDebitNotes: true,
      rejectTickets: true,
      duplicateWindowDays: 30,
    };

    if (validationSettings) {
      validationSettings.forEach((setting) => {
        switch (setting.key) {
          case "validation_min_date":
            validationRules.minDate = setting.value;
            break;
          case "validation_accept_invoices":
            validationRules.acceptInvoices = setting.value === "true";
            break;
          case "validation_accept_credit_notes":
            validationRules.acceptCreditNotes = setting.value === "true";
            break;
          case "validation_accept_debit_notes":
            validationRules.acceptDebitNotes = setting.value === "true";
            break;
          case "validation_reject_tickets":
            validationRules.rejectTickets = setting.value === "true";
            break;
          case "validation_duplicate_window_days":
            validationRules.duplicateWindowDays = parseInt(setting.value) || 30;
            break;
        }
      });
    }

    console.log("Validation rules loaded:", validationRules);

    // Parsear XML (simplificado - en producción usar un parser XML real)
    const parseXMLValue = (xml: string, tag: string): string => {
      const regex = new RegExp(`<${tag}>(.*?)<\/${tag}>`, "s");
      const match = xml.match(regex);
      return match ? match[1].trim() : "";
    };

    // Determinar tipo de documento y validar según reglas
    let docType = "FacturaElectronica";
    
    // Rechazar tiquetes electrónicos si está configurado
    if (xml_content.includes("<TiqueteElectronico")) {
      if (validationRules.rejectTickets) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Los tiquetes electrónicos no son aceptados según las reglas de validación configuradas.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      docType = "TiqueteElectronico";
    } else if (xml_content.includes("<NotaCreditoElectronica")) {
      docType = "NotaCreditoElectronica";
      if (!validationRules.acceptCreditNotes) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Las notas de crédito no están habilitadas según las reglas de validación configuradas.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else if (xml_content.includes("<NotaDebitoElectronica")) {
      docType = "NotaDebitoElectronica";
      if (!validationRules.acceptDebitNotes) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Las notas de débito no están habilitadas según las reglas de validación configuradas.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else if (!validationRules.acceptInvoices) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Las facturas electrónicas no están habilitadas según las reglas de validación configuradas.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Extraer datos clave
    const extractedData = {
      doc_key: doc_key || parseXMLValue(xml_content, "Clave"),
      doc_type: docType,
      doc_number: parseXMLValue(xml_content, "NumeroConsecutivo"),
      issue_date: parseXMLValue(xml_content, "FechaEmision").split("T")[0],
      supplier_name: parseXMLValue(xml_content, "Nombre"),
      supplier_tax_id: parseXMLValue(xml_content, "Numero"),
      supplier_email: parseXMLValue(xml_content, "CorreoElectronico"),
      currency: parseXMLValue(xml_content, "CodigoMoneda") || "CRC",
      total_amount: parseFloat(parseXMLValue(xml_content, "TotalComprobante") || "0"),
      total_tax: parseFloat(parseXMLValue(xml_content, "TotalImpuesto") || "0"),
      total_discount: parseFloat(parseXMLValue(xml_content, "TotalDescuentos") || "0"),
    };

    console.log("Extracted data:", extractedData);

    // Validar fecha según configuración
    const issueDate = new Date(extractedData.issue_date);
    const cutoffDate = new Date(validationRules.minDate);

    if (issueDate < cutoffDate) {
      const dateStr = issueDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
      const cutoffStr = cutoffDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
      return new Response(
        JSON.stringify({
          success: false,
          error: `Solo se aceptan documentos desde el ${cutoffStr} en adelante. Este documento es del ${dateStr}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verificar duplicados según configuración
    const duplicateWindowDays = validationRules.duplicateWindowDays;
    const windowDate = new Date();
    windowDate.setDate(windowDate.getDate() - duplicateWindowDays);

    const { data: existingDoc, error: duplicateError } = await supabase
      .from("processed_documents")
      .select("id, status")
      .eq("doc_key", extractedData.doc_key)
      .eq("organization_id", organization_id)
      .gte("created_at", windowDate.toISOString())
      .maybeSingle();

    if (duplicateError) {
      console.error("Error checking duplicates:", duplicateError);
    }

    if (existingDoc) {
      return new Response(
        JSON.stringify({
          success: false,
          status: "duplicate",
          message: "Document already processed",
          doc_id: existingDoc.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Clasificar proveedor usando Lovable AI
    let vendorId = null;
    let classificationReason = "No classification attempted";

    try {
      const classifyResponse = await fetch(
        `${supabaseUrl}/functions/v1/classify-vendor`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            supplier_name: extractedData.supplier_name,
            supplier_tax_id: extractedData.supplier_tax_id,
            supplier_email: extractedData.supplier_email,
            xml_data: extractedData,
            organization_id: organization_id,
          }),
        }
      );

      if (classifyResponse.ok) {
        const classification = await classifyResponse.json();
        console.log("Classification result:", classification);
        
        if (classification.vendor_id && classification.confidence >= 70) {
          vendorId = classification.vendor_id;
          classificationReason = classification.reason;
        } else {
          classificationReason = `Low confidence (${classification.confidence}%): ${classification.reason}`;
        }
      }
    } catch (classifyError) {
      console.error("Error classifying vendor:", classifyError);
      classificationReason = "Classification service unavailable";
    }

    // Determinar estado
    let status = "processed";
    if (!vendorId) {
      status = "review";
    }

    // Guardar documento
    const { data: savedDoc, error: saveError } = await supabase
      .from("processed_documents")
      .insert([
        {
          doc_key: extractedData.doc_key,
          doc_type: extractedData.doc_type,
          doc_number: extractedData.doc_number,
          issue_date: extractedData.issue_date,
          supplier_name: extractedData.supplier_name,
          supplier_tax_id: extractedData.supplier_tax_id,
          supplier_email: extractedData.supplier_email,
          vendor_id: vendorId,
          currency: extractedData.currency,
          total_amount: extractedData.total_amount,
          total_tax: extractedData.total_tax,
          total_discount: extractedData.total_discount,
          status: status,
          xml_data: extractedData,
          error_message: !vendorId ? classificationReason : null,
          organization_id: organization_id,
          file_path: pdf_path || xml_path,
          pdf_attachment_url: pdf_path,
          xml_attachment_url: xml_path,
        },
      ])
      .select()
      .single();

    if (saveError) {
      console.error("Error saving document:", saveError);
      throw new Error("Failed to save document");
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: status,
        message: vendorId ? "Document processed successfully" : "Document needs manual review",
        doc_id: savedDoc.id,
        vendor_id: vendorId,
        classification_reason: classificationReason,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in process-document:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
