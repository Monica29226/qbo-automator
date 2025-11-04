import { create } from 'zustand';

export interface BillLine {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  gravado: boolean;
  tasaIVA: number;
  descuentoLinea?: number;
}

export interface BillPreview {
  tipo: 'FACTURA' | 'NOTA_CREDITO';
  proveedor: string;
  cedula: string;
  fecha: Date;
  moneda: string;
  subtotal: number;
  descuento: number;
  impuesto: number;
  total: number;
  lineas: BillLine[];
  mapping: {
    cuentaGasto?: string;
    cuentaIVA?: string;
    gravado?: boolean;
    tasaIVA?: number;
    descuentoDefault?: number;
  };
  estadoMapeo: 'PENDIENTE' | 'OK' | 'OBSERVACIONES';
  creadoEnQBO?: { id: string; fecha: Date };
  docKey?: string;
  consecutivo?: string;
}

export interface ProviderMapping {
  proveedor: string;
  cedula: string;
  cuentaGasto: string;
  cuentaIVA: string;
  gravado: boolean;
  tasaIVA: number;
  descuentoDefault: number;
}

export interface ProcessingLogEntry {
  ts: Date;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

interface AppState {
  // Estados de conexión
  gmailStatus: { connected: boolean; accountEmail: string };
  qboStatus: { connected: boolean; realmId: string; companyName: string };
  companyId: string;
  
  // Mapeo de proveedores
  excelMapping: { uploaded: boolean; fileName: string; lastUpdated: Date | null };
  providerMap: ProviderMapping[];
  
  // Logs y preview
  processingLog: ProcessingLogEntry[];
  previewItems: BillPreview[];
  selectedItems: string[]; // doc_keys seleccionados
  
  // Settings
  settings: {
    showHelp: boolean;
    queryGmail: string;
    labelToApply: string;
  };
  
  // Actions
  setGmailStatus: (status: { connected: boolean; accountEmail: string }) => void;
  setQboStatus: (status: { connected: boolean; realmId: string; companyName: string }) => void;
  setCompanyId: (id: string) => void;
  setExcelMapping: (mapping: { uploaded: boolean; fileName: string; lastUpdated: Date | null }) => void;
  setProviderMap: (map: ProviderMapping[]) => void;
  addToLog: (entry: Omit<ProcessingLogEntry, 'ts'>) => void;
  clearLog: () => void;
  setPreviewItems: (items: BillPreview[]) => void;
  addPreviewItem: (item: BillPreview) => void;
  updatePreviewItem: (docKey: string, updates: Partial<BillPreview>) => void;
  toggleItemSelection: (docKey: string) => void;
  clearSelection: () => void;
  setSettings: (settings: Partial<AppState['settings']>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial states
  gmailStatus: { connected: false, accountEmail: '' },
  qboStatus: { connected: false, realmId: '', companyName: '' },
  companyId: '',
  excelMapping: { uploaded: false, fileName: '', lastUpdated: null },
  providerMap: [],
  processingLog: [],
  previewItems: [],
  selectedItems: [],
  settings: {
    showHelp: false,
    queryGmail: 'has:attachment (filename:xml OR filename:pdf) newer_than:30d',
    labelToApply: 'Procesado',
  },

  // Actions
  setGmailStatus: (status) => set({ gmailStatus: status }),
  setQboStatus: (status) => set({ qboStatus: status }),
  setCompanyId: (id) => set({ companyId: id }),
  setExcelMapping: (mapping) => set({ excelMapping: mapping }),
  setProviderMap: (map) => set({ providerMap: map }),
  
  addToLog: (entry) =>
    set((state) => ({
      processingLog: [{ ...entry, ts: new Date() }, ...state.processingLog].slice(0, 100),
    })),
  
  clearLog: () => set({ processingLog: [] }),
  
  setPreviewItems: (items) => set({ previewItems: items }),
  
  addPreviewItem: (item) =>
    set((state) => ({
      previewItems: [...state.previewItems, item],
    })),
  
  updatePreviewItem: (docKey, updates) =>
    set((state) => ({
      previewItems: state.previewItems.map((item) =>
        item.docKey === docKey ? { ...item, ...updates } : item
      ),
    })),
  
  toggleItemSelection: (docKey) =>
    set((state) => ({
      selectedItems: state.selectedItems.includes(docKey)
        ? state.selectedItems.filter((id) => id !== docKey)
        : [...state.selectedItems, docKey],
    })),
  
  clearSelection: () => set({ selectedItems: [] }),
  
  setSettings: (settings) =>
    set((state) => ({
      settings: { ...state.settings, ...settings },
    })),
}));
