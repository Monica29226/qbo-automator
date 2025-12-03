import { z } from "zod";

// ========== INPUT VALIDATION SCHEMAS ==========

export const emailSchema = z
  .string()
  .trim()
  .email({ message: "Email inválido" })
  .max(255, { message: "Email demasiado largo" });

export const passwordSchema = z
  .string()
  .min(8, { message: "Contraseña debe tener al menos 8 caracteres" })
  .max(72, { message: "Contraseña demasiado larga" })
  .regex(/[A-Z]/, { message: "Contraseña debe incluir una mayúscula" })
  .regex(/[a-z]/, { message: "Contraseña debe incluir una minúscula" })
  .regex(/[0-9]/, { message: "Contraseña debe incluir un número" });

export const vendorNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Nombre de proveedor requerido" })
  .max(200, { message: "Nombre demasiado largo" })
  .transform(sanitizeText);

export const taxIdSchema = z
  .string()
  .trim()
  .max(50, { message: "Cédula demasiado larga" })
  .regex(/^[0-9-]+$/, { message: "Cédula solo puede contener números y guiones" })
  .optional();

export const amountSchema = z
  .number()
  .min(0, { message: "Monto no puede ser negativo" })
  .max(999999999, { message: "Monto demasiado grande" });

export const uuidSchema = z
  .string()
  .uuid({ message: "ID inválido" });

export const accountRefSchema = z
  .string()
  .max(100, { message: "Referencia de cuenta demasiado larga" })
  .optional();

// ========== SANITIZATION FUNCTIONS ==========

/**
 * Sanitize text input to prevent XSS attacks
 */
export function sanitizeText(input: string): string {
  if (!input) return "";
  
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;")
    .trim();
}

/**
 * Sanitize HTML content - strip all tags
 */
export function stripHtml(input: string): string {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, "").trim();
}

/**
 * Validate and sanitize XML content
 */
export function validateXmlContent(xml: string): { valid: boolean; error?: string } {
  if (!xml || typeof xml !== "string") {
    return { valid: false, error: "XML vacío o inválido" };
  }

  // Check for XML injection patterns
  const dangerousPatterns = [
    /<!ENTITY/i,
    /<!DOCTYPE.*SYSTEM/i,
    /<!DOCTYPE.*PUBLIC/i,
    /<!\[CDATA\[.*<script/i,
    /javascript:/i,
    /data:text\/html/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(xml)) {
      return { valid: false, error: "XML contiene patrones peligrosos" };
    }
  }

  // Check for basic XML structure
  if (!xml.includes("<?xml") && !xml.includes("<FacturaElectronica") && !xml.includes("<NotaCreditoElectronica")) {
    return { valid: false, error: "No parece ser un XML de factura electrónica válido" };
  }

  // Max size check (10MB)
  if (xml.length > 10 * 1024 * 1024) {
    return { valid: false, error: "XML demasiado grande" };
  }

  return { valid: true };
}

/**
 * Validate PDF file
 */
export function validatePdfFile(file: File): { valid: boolean; error?: string } {
  // Check file type
  if (!file.type.includes("pdf")) {
    return { valid: false, error: "El archivo debe ser un PDF" };
  }

  // Max size check (50MB)
  if (file.size > 50 * 1024 * 1024) {
    return { valid: false, error: "PDF demasiado grande (máximo 50MB)" };
  }

  return { valid: true };
}

/**
 * Validate XML file
 */
export function validateXmlFile(file: File): { valid: boolean; error?: string } {
  // Check file type
  const isXml = file.type.includes("xml") || file.name.toLowerCase().endsWith(".xml");
  if (!isXml) {
    return { valid: false, error: "El archivo debe ser un XML" };
  }

  // Max size check (10MB)
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: "XML demasiado grande (máximo 10MB)" };
  }

  return { valid: true };
}

// ========== AUDIT LOGGING ==========

export interface AuditLogEntry {
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  organizationId?: string;
}

/**
 * Create audit log entry (client-side helper)
 */
export async function createAuditLog(
  supabase: any,
  userId: string,
  entry: AuditLogEntry
): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      user_id: userId,
      organization_id: entry.organizationId,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      details: entry.details || {},
    });
  } catch (error) {
    console.error("Failed to create audit log:", error);
    // Don't throw - audit logging should not break the main flow
  }
}

// ========== RATE LIMITING (CLIENT-SIDE) ==========

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function checkClientRateLimit(
  key: string,
  maxRequests: number = 10,
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  if (entry.count >= maxRequests) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetIn: entry.resetTime - now 
    };
  }

  entry.count++;
  return { 
    allowed: true, 
    remaining: maxRequests - entry.count, 
    resetIn: entry.resetTime - now 
  };
}

// ========== VENDOR FORM VALIDATION ==========

export const vendorFormSchema = z.object({
  vendor_name: vendorNameSchema,
  vendor_tax_id: taxIdSchema,
  vendor_email: z.string().email().optional().or(z.literal("")),
  qbo_vendor_ref: z.string().min(1, "Referencia de QuickBooks requerida"),
  default_account_ref: accountRefSchema,
  default_class_ref: accountRefSchema,
  tax_treatment: z.enum(["with_tax", "without_tax", "exempt"]),
  tax_rate: z.number().min(0).max(100),
});

export type VendorFormData = z.infer<typeof vendorFormSchema>;

// ========== INVOICE FORM VALIDATION ==========

export const invoiceUpdateSchema = z.object({
  default_account_ref: accountRefSchema,
  default_class_ref: accountRefSchema,
  observations: z.string().max(500).optional(),
});

export type InvoiceUpdateData = z.infer<typeof invoiceUpdateSchema>;
