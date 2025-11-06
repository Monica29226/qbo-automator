# Sistema de Roles y Permisos por Organización

## Roles Disponibles

El sistema maneja 4 niveles de roles para miembros de organizaciones:

### 1. **Owner** (Dueño)
- Control total de la organización
- Puede eliminar la organización
- Puede gestionar todos los miembros (agregar, remover, cambiar roles)
- Puede modificar toda la configuración de la organización
- Puede crear, editar y eliminar todo el contenido
- Acceso completo a integraciones y configuraciones

### 2. **Admin** (Administrador)
- Puede gestionar miembros (agregar, remover, cambiar roles)
- Puede modificar configuración de la organización
- Puede crear, editar y eliminar contenido
- Acceso completo a integraciones y configuraciones
- **NO puede eliminar la organización**

### 3. **Member** (Miembro)
- Puede crear y editar documentos
- Puede ver toda la información de la organización
- Puede ver vendors, settings y reglas de clasificación
- **NO puede eliminar documentos**
- **NO puede modificar vendors o configuración**
- **NO puede gestionar miembros**

### 4. **Viewer** (Visualizador)
- Solo puede ver información
- Acceso de lectura a documentos, vendors y configuración
- **NO puede crear, editar o eliminar nada**
- **NO puede gestionar miembros**

## Matriz de Permisos

| Acción | Owner | Admin | Member | Viewer |
|--------|-------|-------|--------|--------|
| **Organización** |
| Ver organización | ✅ | ✅ | ✅ | ✅ |
| Editar organización | ✅ | ✅ | ❌ | ❌ |
| Eliminar organización | ✅ | ❌ | ❌ | ❌ |
| **Miembros** |
| Ver miembros | ✅ | ✅ | ✅ | ✅ |
| Agregar miembros | ✅ | ✅ | ❌ | ❌ |
| Eliminar miembros | ✅ | ✅ | ❌ | ❌ |
| Cambiar roles | ✅ | ✅ | ❌ | ❌ |
| **Documentos** |
| Ver documentos | ✅ | ✅ | ✅ | ✅ |
| Crear documentos | ✅ | ✅ | ✅ | ❌ |
| Editar documentos | ✅ | ✅ | ✅ | ❌ |
| Eliminar documentos | ✅ | ✅ | ❌ | ❌ |
| **Vendors** |
| Ver vendors | ✅ | ✅ | ✅ | ✅ |
| Crear vendors | ✅ | ✅ | ❌ | ❌ |
| Editar vendors | ✅ | ✅ | ❌ | ❌ |
| Eliminar vendors | ✅ | ✅ | ❌ | ❌ |
| **Configuración** |
| Ver settings | ✅ | ✅ | ✅ | ✅ |
| Modificar settings | ✅ | ✅ | ❌ | ❌ |
| **Integraciones** |
| Ver integraciones | ✅ | ✅ | ✅ | ✅ |
| Configurar integraciones | ✅ | ✅ | ❌ | ❌ |

## Funciones de Seguridad

El sistema utiliza tres funciones principales para verificar permisos:

1. **`is_organization_owner(user_id, org_id)`**
   - Verifica si el usuario es owner de la organización
   - Usado para acciones críticas como eliminar organización

2. **`is_organization_admin(user_id, org_id)`**
   - Verifica si el usuario es owner O admin
   - Usado para gestión de contenido y configuración

3. **`can_edit_organization_content(user_id, org_id)`**
   - Verifica si el usuario es owner, admin O member
   - Usado para crear y editar contenido

## Implementación Técnica

- Los roles se validan mediante un CHECK constraint en la base de datos
- Las políticas RLS (Row Level Security) implementan los permisos a nivel de base de datos
- Los roles válidos son: 'owner', 'admin', 'member', 'viewer'
- Cada usuario puede tener diferentes roles en diferentes organizaciones
