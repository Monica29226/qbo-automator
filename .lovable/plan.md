

# Plan: Visualizador de PDF inline en la Cola de Revisión

## Objetivo
Agregar un visor de PDF directamente en la fila expandida de cada factura en la Cola de Revisión, permitiendo cotejar visualmente los datos registrados contra el PDF original sin abrir diálogos separados.

## Cambio

**Archivo: `src/pages/ReviewQueue.tsx`**

En la sección expandida de cada fila (actualmente muestra info del documento, totales, líneas y clave), se reorganizará el layout para mostrar:

```text
┌─────────────────────────────────────────────────────────┐
│  [Info + Totales + Líneas]  │  [PDF Viewer inline]      │
│  (60% ancho)                │  (40% ancho, ~500px alto) │
│                             │                           │
│  Tipo documento: ...        │  ┌─────────────────────┐  │
│  Moneda: ...                │  │                     │  │
│  Cuenta asignada: ...       │  │   PDF renderizado   │  │
│                             │  │   con controles     │  │
│  Subtotal    ₡61,425        │  │   zoom/nav/descarga │  │
│  Descuento  -₡8,775         │  │                     │  │
│  Impuestos   ₡7,985         │  └─────────────────────┘  │
│  Total      ₡60,635         │                           │
│                             │  [Descargar desde Gmail]  │
│  Detalle de líneas...       │  (si no hay PDF)          │
│                             │                           │
│  Clave: 5060303260...       │                           │
└─────────────────────────────────────────────────────────┘
```

- El `PdfViewer` se renderiza inline con altura fija de ~500px
- Si no hay PDF (`pdf_attachment_url` ni `file_path`), se muestra un placeholder con opción de descargar desde Gmail
- Se mantiene el botón Eye en la fila para abrir el PDF en diálogo grande (pantalla completa), útil para inspección detallada
- El PDF se carga solo cuando la fila está expandida (lazy loading), evitando cargar todos los PDFs a la vez

## Detalle técnico
- Se modifica la sección expandida (líneas 493-608) para usar `grid grid-cols-5` donde la info ocupa `col-span-3` y el PDF `col-span-2`
- El componente `PdfViewer` ya maneja storage paths, URLs, fallbacks y descarga desde Gmail
- No se requieren cambios en BD ni edge functions

