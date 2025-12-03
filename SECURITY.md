# 🔐 Guía de Seguridad - InvoiceFlow

## Resumen de Medidas Implementadas

### ✅ Row Level Security (RLS)

| Tabla | Estado | Políticas |
|-------|--------|-----------|
| organizations | ✅ Seguro | Solo miembros activos pueden ver |
| profiles | ✅ Seguro | Solo perfiles de misma organización |
| organization_members | ✅ Seguro | Requiere invitación o ser admin |
| processed_documents | ✅ Seguro | Por organization_id |
| sales_invoices | ✅ Seguro | Por organization_id |
| vendors | ✅ Seguro | Por organization_id |
| sync_logs | ✅ Seguro | Solo miembros de org pueden ver/insertar |
| alert_history | ✅ Seguro | Solo miembros pueden ver, admins eliminar |
| audit_log | ✅ Seguro | Solo admins pueden ver |
| user_active_organization | ✅ Seguro | Validación de membresía |

### ✅ Autenticación en Edge Functions

| Función | JWT Requerido | Validación Adicional |
|---------|--------------|---------------------|
| create-user | ✅ Sí | Verifica admin de org |
| publish-to-quickbooks | ✅ Sí | Valida organization_id |
| gmail-fetch-invoices | ✅ Sí | Valida usuario/service role |
| extract-invoice-data | ✅ Sí | - |
| process-document | ✅ Sí | - |
| process-document-xml | ✅ Sí | - |
| gti-webhook-receiver | ❌ No* | Validación de firma HMAC |

*Los webhooks no usan JWT pero validan firma criptográfica.

### ✅ Validación de Webhooks

El webhook de GTI implementa:
- **Verificación de firma HMAC-SHA256** usando `GTI_WEBHOOK_SECRET`
- **Protección contra replay attacks** con verificación de timestamp
- **Prevención de duplicados** almacenando request IDs

### ✅ Sistema de Auditoría

Nueva tabla `audit_log` que registra:
- Intentos de creación de usuarios
- Accesos no autorizados
- Cambios de permisos
- Cambios de organización activa

### ✅ Rate Limiting

Nueva tabla `rate_limits` para:
- Limitar llamadas por IP/usuario
- Proteger webhooks contra abuso
- Evitar ataques de fuerza bruta

### ✅ Validación de Inputs

Biblioteca `src/lib/security.ts` incluye:
- Esquemas Zod para validación
- Sanitización de texto contra XSS
- Validación de archivos XML/PDF
- Helpers de rate limiting cliente

---

## ⚠️ Acciones Pendientes (Requieren Configuración Manual)

### 1. Habilitar Protección de Contraseñas Filtradas

**Ubicación:** Supabase Dashboard → Authentication → Settings → Security

1. Navegar a Authentication > Settings
2. En la sección "Security", buscar "Leaked Password Protection"
3. Activar la opción
4. Esto verificará contraseñas contra bases de datos de breaches conocidos

### 2. Configurar Secret del Webhook GTI

```bash
# En Supabase Dashboard → Edge Functions → Secrets
GTI_WEBHOOK_SECRET=tu_secret_compartido_con_gti
```

### 3. Configurar 2FA para Administradores

**Ubicación:** Supabase Dashboard → Authentication → Settings → Multi-Factor Authentication

1. Habilitar MFA
2. Forzar MFA para usuarios con rol admin (configurar en aplicación)

### 4. Configurar Timeout de Sesión

**Ubicación:** Supabase Dashboard → Authentication → Settings → JWT Settings

- Reducir `JWT expiry` a 28800 (8 horas)
- Habilitar `Refresh Token Rotation`

### 5. Cifrar Datos Sensibles con Vault

Para migrar `oauth_credentials` y `integration_accounts` a Vault:

```sql
-- Habilitar extensión pgcrypto si no existe
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Crear función de cifrado
CREATE OR REPLACE FUNCTION encrypt_credentials(data jsonb, key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN encode(
    pgp_sym_encrypt(data::text, key),
    'base64'
  );
END;
$$;

-- Crear función de descifrado
CREATE OR REPLACE FUNCTION decrypt_credentials(encrypted_data text, key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN pgp_sym_decrypt(
    decode(encrypted_data, 'base64'),
    key
  )::jsonb;
END;
$$;
```

**Nota:** Requiere configurar `ENCRYPTION_KEY` como secret.

---

## 📋 Checklist de Seguridad para Nuevas Features

### Al Crear Nuevas Tablas

- [ ] ¿La tabla tiene `organization_id` si contiene datos por empresa?
- [ ] ¿RLS está habilitado (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)?
- [ ] ¿Existen políticas para SELECT, INSERT, UPDATE, DELETE?
- [ ] ¿Las políticas usan las funciones helper (`is_organization_member`, etc.)?
- [ ] ¿Hay índice en `organization_id`?

### Al Crear Edge Functions

- [ ] ¿La función requiere autenticación (`verify_jwt = true` en config.toml)?
- [ ] ¿Se valida que el usuario pertenece a la organización?
- [ ] ¿Se validan todos los inputs?
- [ ] ¿Se registran eventos en `audit_log` para acciones sensibles?
- [ ] ¿Hay rate limiting si es pública?

### Al Crear Formularios

- [ ] ¿Se usa validación Zod en cliente Y servidor?
- [ ] ¿Los inputs de texto se sanitizan contra XSS?
- [ ] ¿Los archivos se validan (tipo, tamaño)?
- [ ] ¿Se muestra feedback de errores de validación?

### Al Crear Webhooks

- [ ] ¿Se valida firma criptográfica?
- [ ] ¿Hay protección contra replay attacks?
- [ ] ¿Se registran los requests para auditoría?
- [ ] ¿Se limitan los requests por IP?

---

## 🚨 Proceso de Respuesta a Incidentes

### Nivel 1: Alerta Menor
**Ejemplos:** Rate limit excedido, login fallido múltiple

1. Revisar logs en `audit_log`
2. Verificar si es comportamiento normal o ataque
3. Si es ataque, bloquear IP temporalmente

### Nivel 2: Brecha Potencial
**Ejemplos:** Acceso a datos de otra organización, JWT inválido con datos válidos

1. **INMEDIATO:** Revocar tokens del usuario afectado
2. Revisar `audit_log` del usuario
3. Identificar datos potencialmente comprometidos
4. Notificar a administradores de organizaciones afectadas
5. Documentar incidente

### Nivel 3: Brecha Confirmada
**Ejemplos:** Datos filtrados, acceso no autorizado confirmado

1. **INMEDIATO:** 
   - Desconectar integraciones afectadas (QuickBooks, Gmail)
   - Revocar todos los refresh tokens
2. Identificar alcance del compromiso
3. Notificar a usuarios afectados
4. Reportar a autoridades si aplica (GDPR, etc.)
5. Post-mortem y mejoras

### Contactos de Emergencia

| Rol | Responsabilidad |
|-----|-----------------|
| Admin Principal | Decisiones de negocio |
| DevOps | Acceso a infraestructura |
| Legal | Notificaciones regulatorias |

---

## 🔧 Configuración de Supabase Dashboard

### Authentication Settings Recomendadas

```
JWT Expiry: 28800 (8 horas)
Refresh Token Rotation: Enabled
Refresh Token Reuse Interval: 10 (segundos)
Leaked Password Protection: Enabled
Min Password Length: 8
Require Uppercase: Yes
Require Number: Yes
```

### Rate Limiting Recomendado

| Endpoint | Límite | Ventana |
|----------|--------|---------|
| /auth/signup | 5 | 1 hora |
| /auth/token | 10 | 1 minuto |
| Edge Functions | 100 | 1 minuto |
| Webhooks | 1000 | 1 minuto |

---

## 📊 Monitoreo Continuo

### Queries Útiles para Auditoría

```sql
-- Intentos de acceso no autorizado (últimas 24h)
SELECT * FROM audit_log 
WHERE action LIKE 'unauthorized%' 
AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;

-- Usuarios que cambiaron de organización frecuentemente
SELECT user_id, count(*) as switches
FROM audit_log 
WHERE action = 'switch_organization'
AND created_at > now() - interval '1 hour'
GROUP BY user_id
HAVING count(*) > 5;

-- Rate limits excedidos
SELECT identifier, endpoint, count(*) 
FROM rate_limits 
WHERE window_start > now() - interval '1 hour'
GROUP BY identifier, endpoint
HAVING count(*) > 50;
```

### Alertas Recomendadas

1. **Más de 5 logins fallidos** del mismo usuario en 10 minutos
2. **Más de 10 cambios de organización** del mismo usuario en 1 hora
3. **Cualquier acceso no autorizado** registrado en audit_log
4. **Token de QuickBooks/Gmail** próximo a expirar

---

## 📝 Historial de Cambios de Seguridad

| Fecha | Cambio | Responsable |
|-------|--------|-------------|
| 2024-12-03 | Implementación inicial de RLS corregido | Sistema |
| 2024-12-03 | JWT habilitado en edge functions críticas | Sistema |
| 2024-12-03 | Tabla audit_log creada | Sistema |
| 2024-12-03 | Validación de firma en webhook GTI | Sistema |
| 2024-12-03 | Biblioteca de validación de inputs | Sistema |
