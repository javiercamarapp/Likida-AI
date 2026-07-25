// ═══════════════════════════════════════════════════════════════════════════
// CONFIG PARAMETRIZABLE POR TENANT — nada hardcodeado a un cliente.
//
// Todo lo configurable (política, tabulador, rendimiento por unidad, catálogo
// de cuentas, formato de salida, RFC de la empresa) vive aquí con DEFAULTS DE
// DEMO realistas. El día del demo se captura la config real del cliente en la
// sala y se guarda como override del tenant (DB `tenant.config` jsonb). Si no
// hay override, se usa DEMO_CONFIG. Cero código nuevo para un cliente nuevo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PoliticaGasto } from './cuadre/engine';

export interface UnidadConfig {
  rendimientoBase: number;   // km/L en vacío
  capacidadTanque: number;   // litros
}

export interface CuadraConfig {
  empresa: { rfc: string; rfcsAdicionales?: string[] };
  politica: PoliticaGasto[];
  tabulador: {
    rendimientoPorDefecto: number;        // km/L si la placa no está en catálogo
    factorCarga: number;                  // 0-1: consumo cargado vs vacío (~0.78)
    precioDieselPorDefecto: number;       // MXN/L
    umbralDesviacion: number;             // % de alerta (0.15 = 15%)
  };
  unidades: Record<string, UnidadConfig>; // placa → params
  catalogoCuentas: Record<string, string>;// concepto → cuenta contable
  salida: 'csv' | 'contpaqi_txt' | 'aspel_xls';
  // Complemento de hidrocarburos (Bloque 1): claves de producto de combustible,
  // unidad esperada y fecha de entrada en vigor de la obligación.
  hidrocarburos: {
    claves: string[];       // c_ClaveProdServ de combustible (15101505/14/15) — lo ÚNICO que la regla 2.7.1.48 exige
    unidad: string;         // c_ClaveUnidad esperada (LTR) — consistencia, NO requisito legal
    vigenteDesde: string;   // ISO: obligación aplica a CFDI con Fecha >= este día (24-abr-2026)
  };
}

// ── DEFAULTS DE DEMO (🔴 genéricos, NO de un cliente — reemplazables en la sala) ─
export const DEMO_CONFIG: CuadraConfig = {
  empresa: { rfc: 'XAXX010101000' },      // 🔴 demo: RFC genérico
  politica: [
    { concepto: 'diesel', topeMonto: 4000 },
    { concepto: 'caseta', topeMonto: 1500 },
    { concepto: 'viaticos', topeMonto: 800 },
    { concepto: 'factura', requiereCfdi: true },
  ],
  tabulador: {
    rendimientoPorDefecto: 3.0,           // 🔴 demo: tractocamión ~3 km/L
    factorCarga: 0.78,
    precioDieselPorDefecto: 27.0,         // 🔴 demo: ~$27/L (Profeco jul-2026)
    umbralDesviacion: 0.15,
  },
  unidades: {},                            // 🔴 demo: sin catálogo → usa rendimientoPorDefecto
  catalogoCuentas: {
    diesel: '600-001', caseta: '600-002', viaticos: '600-003', factura: '600-004', otro: '600-099',
  },
  salida: 'csv',
  hidrocarburos: {
    // Claves SAT confirmadas: 15101505 diésel, 15101514 magna, 15101515 premium.
    claves: ['15101505', '15101514', '15101515'],
    unidad: 'LTR',
    vigenteDesde: '2026-04-24', // vigencia del complemento v1.0 (DOF, RMF 2.7.1.8)
  },
};

/** Devuelve la config del tenant (override en DB) o los defaults de demo. */
export async function getConfig(tenantId: string): Promise<CuadraConfig> {
  try {
    const { data } = await supabaseAdmin().from('tenant').select('rfc, config').eq('id', tenantId).maybeSingle();
    const override = (data?.config as Partial<CuadraConfig> | null) ?? null;
    const cfg: CuadraConfig = override ? { ...DEMO_CONFIG, ...override } : { ...DEMO_CONFIG };
    // El RFC de la empresa puede venir en la columna `tenant.rfc`.
    if (data?.rfc) cfg.empresa = { ...cfg.empresa, rfc: data.rfc as string };
    return cfg;
  } catch {
    return DEMO_CONFIG; // demo-safe: si la DB no está, usa defaults
  }
}
