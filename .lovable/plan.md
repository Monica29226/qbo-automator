

## Plan: Corregir la Carga de PDFs a QuickBooks

### Problema Identificado

Se detectó que los PDFs **no se están adjuntando correctamente a QuickBooks** debido a una incompatibilidad entre:
- **Bucket privado**: `company-documents` está configurado como privado (`public: false`)
- **URLs públicas**: El sistema guarda URLs públicas completas en `pdf_attachment_url` 
- **Fallo silencioso**: La función `attachPdfToQuickBooks` falla al descargar el PDF pero el error se ignora

### Análisis Técnico

El flujo actual:
```
Email → Extrae PDF → Guarda en storage → Genera URL pública → Almacena URL
                                                    ↓
                              Al publicar: fetch(URL pública) → FALLA ❌
```

La función `attachPdfToQuickBooks` ya tiene código para manejar paths relativos:
```typescript
if (pdfUrl.startsWith('http')) {
  fetch(pdfUrl)  // Falla con bucket privado
} else {
  supabase.storage.download(pdfUrl)  // Funcionaría con paths
}
```

---

### Solución Propuesta

#### Cambio 1: Modificar `hostinger-fetch-invoices` 
Guardar **path relativo** en lugar de URL pública:

```typescript
// ANTES (incorrecto)
pdf_attachment_url: `${publicUrl}/company-documents/${orgId}/${docNumber}.pdf`

// DESPUÉS (correcto)  
pdf_attachment_url: `${orgId}/${docNumber}.pdf`
```

#### Cambio 2: Verificar otras funciones de fetch
Aplicar el mismo cambio a:
- `gmail-fetch-invoices`
- `outlook-fetch-invoices`  
- `bluehost-fetch-invoices`

#### Cambio 3: Script de migración de datos existentes
Actualizar los registros existentes que tienen URLs públicas completas a paths relativos:

```sql
UPDATE processed_documents 
SET pdf_attachment_url = 
  REPLACE(pdf_attachment_url, 
    'https://lqirqvvkjpunhtsvebot.supabase.co/storage/v1/object/public/company-documents/', 
    '')
WHERE pdf_attachment_url LIKE '%supabase.co%company-documents%';
```

---

### Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `supabase/functions/hostinger-fetch-invoices/index.ts` | Guardar path relativo del PDF |
| `supabase/functions/gmail-fetch-invoices/index.ts` | Guardar path relativo del PDF |
| `supabase/functions/outlook-fetch-invoices/index.ts` | Guardar path relativo del PDF |
| `supabase/functions/bluehost-fetch-invoices/index.ts` | Guardar path relativo del PDF |
| Migración SQL | Corregir URLs existentes |

---

### Resultado Esperado

Después de implementar estos cambios:
1. Los nuevos PDFs se guardarán con paths relativos
2. La función `attachPdfToQuickBooks` usará `supabase.storage.download()` para obtener el PDF
3. Los PDFs se adjuntarán correctamente a los Bills en QuickBooks
4. Los PDFs existentes serán migrados al nuevo formato

