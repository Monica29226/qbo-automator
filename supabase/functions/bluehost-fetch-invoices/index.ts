import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple IMAP client usando conexión TCP nativa de Deno
async function fetchEmailsViaIMAP(
  host: string,
  port: number,
  email: string,
  password: string,
  sinceDateStr: string
): Promise<{ rawEmails: string[]; error?: string }> {
  const rawEmails: string[] = [];
  
  try {
    // Conectar usando TLS
    const conn = await Deno.connectTls({
      hostname: host,
      port: port,
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(65536);

    // Función para leer respuesta
    const readResponse = async (): Promise<string> => {
      let response = "";
      let attempts = 0;
      
      while (attempts < 50) {
        const n = await conn.read(buffer);
        if (n === null) break;
        
        response += decoder.decode(buffer.subarray(0, n));
        
        // Verificar si la respuesta está completa
        if (response.includes("\r\n") && 
            (response.includes("OK") || response.includes("NO") || response.includes("BAD") || response.includes("* "))) {
          // Para comandos que devuelven múltiples líneas, esperar a que termine
          if (!response.endsWith("\r\n")) {
            attempts++;
            await new Promise(r => setTimeout(r, 100));
            continue;
          }
          break;
        }
        attempts++;
        await new Promise(r => setTimeout(r, 100));
      }
      
      return response;
    };

    // Función para enviar comando
    const sendCommand = async (tag: string, command: string): Promise<string> => {
      const fullCommand = `${tag} ${command}\r\n`;
      await conn.write(encoder.encode(fullCommand));
      return await readResponse();
    };

    // Leer greeting
    const greeting = await readResponse();
    console.log("[IMAP] Greeting:", greeting.substring(0, 100));

    if (!greeting.includes("OK")) {
      conn.close();
      return { rawEmails: [], error: "Server did not send OK greeting" };
    }

    // Login
    const loginResp = await sendCommand("A001", `LOGIN "${email}" "${password}"`);
    console.log("[IMAP] Login response:", loginResp.substring(0, 100));
    
    if (!loginResp.includes("OK")) {
      conn.close();
      return { rawEmails: [], error: "Login failed: " + loginResp.substring(0, 200) };
    }

    // Select INBOX
    const selectResp = await sendCommand("A002", "SELECT INBOX");
    console.log("[IMAP] SELECT response:", selectResp.substring(0, 200));

    // Extraer número de mensajes
    const existsMatch = selectResp.match(/\* (\d+) EXISTS/);
    const totalMessages = existsMatch ? parseInt(existsMatch[1]) : 0;
    console.log(`[IMAP] INBOX has ${totalMessages} messages`);

    if (totalMessages === 0) {
      await sendCommand("A999", "LOGOUT");
      conn.close();
      return { rawEmails: [] };
    }

    // Search por fecha - usar formato IMAP: DD-Mon-YYYY
    const searchResp = await sendCommand("A003", `SEARCH SINCE ${sinceDateStr}`);
    console.log("[IMAP] SEARCH response:", searchResp.substring(0, 300));

    // Extraer UIDs de la respuesta
    const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
    if (!searchLine || searchLine.trim() === "* SEARCH") {
      console.log("[IMAP] No messages found");
      await sendCommand("A999", "LOGOUT");
      conn.close();
      return { rawEmails: [] };
    }

    const messageIds = searchLine.replace("* SEARCH ", "").trim().split(" ").map(Number).filter(n => n > 0);
    console.log(`[IMAP] Found ${messageIds.length} messages`);

    // Limitar a últimos 30 mensajes para evitar timeouts
    const messagesToFetch = messageIds.slice(-30);
    console.log(`[IMAP] Fetching last ${messagesToFetch.length} messages`);

    // Fetch cada mensaje
    for (let i = 0; i < messagesToFetch.length; i++) {
      const msgId = messagesToFetch[i];
      
      try {
        // Fetch solo el body structure primero para ver si tiene adjuntos XML
        const structCmd = `A1${i}0 FETCH ${msgId} BODYSTRUCTURE`;
        await conn.write(encoder.encode(structCmd + "\r\n"));
        
        let structResp = "";
        let structAttempts = 0;
        while (structAttempts < 20) {
          const n = await conn.read(buffer);
          if (n === null) break;
          structResp += decoder.decode(buffer.subarray(0, n));
          if (structResp.includes(`A1${i}0 OK`)) break;
          structAttempts++;
          await new Promise(r => setTimeout(r, 50));
        }

        // Verificar si tiene XML adjunto
        const hasXml = structResp.toLowerCase().includes('"xml"') || 
                       structResp.toLowerCase().includes('application/xml') ||
                       structResp.toLowerCase().includes('.xml');

        if (!hasXml) {
          continue;
        }

        console.log(`[IMAP] Message ${msgId} has XML attachment, fetching full...`);

        // Fetch mensaje completo
        const fetchCmd = `A1${i}1 FETCH ${msgId} BODY[]`;
        await conn.write(encoder.encode(fetchCmd + "\r\n"));
        
        let emailContent = "";
        let fetchAttempts = 0;
        const maxFetchTime = Date.now() + 30000; // 30 segundos max por mensaje
        
        while (Date.now() < maxFetchTime && fetchAttempts < 500) {
          const n = await conn.read(buffer);
          if (n === null) break;
          emailContent += decoder.decode(buffer.subarray(0, n));
          
          // Verificar si terminó
          if (emailContent.includes(`A1${i}1 OK`)) break;
          if (emailContent.includes(`A1${i}1 NO`) || emailContent.includes(`A1${i}1 BAD`)) break;
          
          fetchAttempts++;
        }

        if (emailContent.length > 0) {
          rawEmails.push(emailContent);
        }
      } catch (msgErr) {
        console.error(`[IMAP] Error fetching message ${msgId}:`, msgErr);
      }
    }

    // Logout
    await sendCommand("A999", "LOGOUT");
    conn.close();

    return { rawEmails };
  } catch (error) {
    console.error("[IMAP] Connection error:", error);
    return { rawEmails: [], error: String(error) };
  }
}

// Función para extraer adjuntos XML de un email raw
function extractXmlAttachments(rawEmail: string): Array<{ filename: string; content: string }> {
  const attachments: Array<{ filename: string; content: string }> = [];
  
  // Buscar boundary
  const boundaryMatch = rawEmail.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    return attachments;
  }

  const boundary = boundaryMatch[1];
  const parts = rawEmail.split("--" + boundary);

  for (const part of parts) {
    // Verificar si es un adjunto XML
    const filenameMatch = part.match(/filename="?([^"\r\n]+\.xml)"?/i);
    if (!filenameMatch) continue;

    const filename = filenameMatch[1].trim();
    
    // Filtrar respuestas de Hacienda
    const upperFilename = filename.toUpperCase();
    if (upperFilename.startsWith("AHC-") || upperFilename.startsWith("RMH-") ||
        upperFilename.includes("-RESPUESTA") || upperFilename.includes("_RESPUESTA")) {
      console.log(`[Bluehost] Skipping Hacienda response: ${filename}`);
      continue;
    }

    // Verificar encoding
    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = encodingMatch ? encodingMatch[1].toUpperCase() : "7BIT";

    // Extraer contenido (después de línea vacía)
    const contentStart = part.indexOf("\r\n\r\n");
    if (contentStart === -1) continue;

    let content = part.substring(contentStart + 4);
    
    // Limpiar el final
    const endIdx = content.indexOf("--" + boundary);
    if (endIdx !== -1) {
      content = content.substring(0, endIdx);
    }
    content = content.trim();

    // Decodificar según encoding
    let decodedContent: string;
    
    if (encoding === "BASE64") {
      try {
        // Limpiar y decodificar base64
        const cleanBase64 = content.replace(/[\r\n\s]/g, "");
        const binaryStr = atob(cleanBase64);
        // Intentar decodificar como UTF-8
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        decodedContent = new TextDecoder("utf-8").decode(bytes);
      } catch (e) {
        console.error(`[Bluehost] Error decoding base64 for ${filename}:`, e);
        continue;
      }
    } else if (encoding === "QUOTED-PRINTABLE") {
      decodedContent = content
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } else {
      decodedContent = content;
    }

    // Verificar que sea XML válido con Clave
    if (decodedContent.includes("<Clave>")) {
      attachments.push({ filename, content: decodedContent });
    }
  }

  return attachments;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organization_id, month, year, force_resync } = await req.json();
    if (!organization_id) throw new Error("organization_id required");
    
    console.log(`[Bluehost] Fetching invoices for organization ${organization_id}`);

    // Verificar autorización
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;
    
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) throw new Error("Invalid authorization");
    }

    // Obtener cuenta de Bluehost activa
    const { data: bluehostAccount, error: accountError } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("service_type", "bluehost")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (accountError || !bluehostAccount) {
      throw new Error("No active Bluehost account found");
    }

    const credentials = bluehostAccount.credentials as any;
    if (!credentials?.email || !credentials?.password) {
      throw new Error("Bluehost credentials incomplete");
    }

    const imapHost = credentials.imap_host || "mail.bluehost.com";
    const imapPort = credentials.imap_port || 993;
    
    console.log(`[Bluehost] Connecting to ${imapHost}:${imapPort} for ${credentials.email}`);

    // Obtener settings de búsqueda
    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("organization_id", organization_id)
      .in("key", ["mail_query", "start_date"]);

    const startDateSetting = settings?.find(s => s.key === "start_date")?.value;
    let startDate: Date;
    
    if (month && year) {
      startDate = new Date(year, month - 1, 1);
    } else if (startDateSetting) {
      startDate = new Date(startDateSetting);
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }

    // Formatear fecha para IMAP: DD-Mon-YYYY
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const sinceDateStr = `${startDate.getDate()}-${months[startDate.getMonth()]}-${startDate.getFullYear()}`;
    
    console.log(`[Bluehost] Searching for emails since ${sinceDateStr}`);

    // Fetch emails via IMAP
    const { rawEmails, error: imapError } = await fetchEmailsViaIMAP(
      imapHost,
      imapPort,
      credentials.email,
      credentials.password,
      sinceDateStr
    );

    if (imapError) {
      throw new Error(`IMAP error: ${imapError}`);
    }

    console.log(`[Bluehost] Retrieved ${rawEmails.length} raw emails`);

    const processedInvoices: any[] = [];
    const skippedInvoices: any[] = [];
    const errors: any[] = [];

    // Procesar cada email
    for (const rawEmail of rawEmails) {
      try {
        const xmlAttachments = extractXmlAttachments(rawEmail);
        
        for (const attachment of xmlAttachments) {
          // Extraer clave del XML
          const claveMatch = attachment.content.match(/<Clave>(\d{50})<\/Clave>/);
          if (!claveMatch) continue;

          const docKey = claveMatch[1];

          // Verificar si ya existe
          const { data: existing } = await supabase
            .from("processed_documents")
            .select("id, status")
            .eq("doc_key", docKey)
            .eq("organization_id", organization_id)
            .maybeSingle();

          if (existing) {
            skippedInvoices.push({ doc_key: docKey, reason: "Already exists" });
            continue;
          }

          // Procesar el XML
          const { data: processResult, error: processError } = await supabase.functions.invoke(
            "process-document-xml",
            {
              body: {
                organization_id,
                xml_content: attachment.content,
                source: "bluehost",
              },
            }
          );

          if (processError) {
            console.error(`[Bluehost] Error processing ${attachment.filename}:`, processError);
            errors.push({ filename: attachment.filename, error: processError.message });
          } else if (processResult?.success) {
            processedInvoices.push({
              doc_key: docKey,
              supplier_name: processResult.document?.supplier_name,
              total_amount: processResult.document?.total_amount,
            });
            console.log(`[Bluehost] ✅ Processed: ${attachment.filename}`);
          } else {
            skippedInvoices.push({ 
              filename: attachment.filename, 
              reason: processResult?.message || "Unknown" 
            });
          }
        }
      } catch (emailErr) {
        console.error("[Bluehost] Error processing email:", emailErr);
        errors.push({ error: String(emailErr) });
      }
    }

    console.log(`[Bluehost] Complete: ${processedInvoices.length} processed, ${skippedInvoices.length} skipped, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        messages_found: rawEmails.length,
        invoices_processed: processedInvoices.length,
        invoices_skipped: skippedInvoices.length,
        invoices_failed: errors.length,
        processed: processedInvoices,
        skipped: skippedInvoices,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[Bluehost] Error:", error);
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
