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
  // Estímulos fiscales y topes de deducibilidad (LIF 2026 Art. 20 / LISR).
  estimulos: {
    peajeFactor: number;              // 0.5 = 50% del gasto de peaje (LIF 2026 Art. 20-A)
    viaticosTopeFiscalDiarioMxn: number; // $750/día alimentación nacional (LISR 28-V)
    efectivoTopeMxn: number;          // $2,000 (LISR 27-III) para gasto no-combustible en efectivo
    clavesDieselIeps: string[];       // el estímulo de IEPS (LIF Art. 20-A fr. IV) es SOLO diésel
    clavesPeaje: string[];            // c_ClaveProdServ de peaje → estímulo del 50% (LIF 2026 Art. 20-A)
  };
  // Catálogo de portales de facturación de gasolineras (capa 1: tabla + aviso).
  // Un ticket de estación NO es factura; el operador debe timbrarlo en el portal
  // de su marca dentro del plazo. NO hay automatización de portales — solo avisar.
  portales: PortalFacturacion[];
  // Validaciones de cordura.
  validacion: {
    fechaToleranciaDiasAntes: number; // la fecha del gasto no puede ser anterior a (inicio del viaje − N días)
  };
}

export interface PortalFacturacion {
  marca: string;        // etiqueta legible para el operador
  match: string[];      // palabras clave para reconocer el ticket (estación/emisor/URL)
  portal: string;       // URL de facturación
  plazoHoras: number;   // plazo para facturar el ticket
  campos: string[];     // datos que pide el portal (folio_norm, web_id, etc.)
}

// ── DEFAULTS DE DEMO (🔴 genéricos, NO de un cliente — reemplazables en la sala) ─
export const DEMO_CONFIG: CuadraConfig = {
  empresa: { rfc: 'XAXX010101000' },      // 🔴 demo: RFC genérico
  politica: [
    { concepto: 'diesel', topeMonto: 4000 },
    { concepto: 'caseta', topeMonto: 1500 },
    { concepto: 'alimentacion', topeMonto: 800 },
    { concepto: 'hospedaje', topeMonto: 2500 },
    { concepto: 'transporte', topeMonto: 800 },
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
    // Los tres conceptos que sustituyen a 'viaticos'. Comparten la 600-003 por
    // ahora: la cuenta contable la define el contador de cada flota, no nosotros.
    alimentacion: '600-003', hospedaje: '600-003', transporte: '600-003',
  },
  salida: 'csv',
  hidrocarburos: {
    // Claves SAT confirmadas: 15101505 diésel, 15101514 magna, 15101515 premium.
    claves: ['15101505', '15101514', '15101515'],
    unidad: 'LTR',
    vigenteDesde: '2026-04-24', // vigencia del complemento v1.0 (DOF, RMF 2.7.1.8)
  },
  estimulos: {
    peajeFactor: 0.5,                 // LIF 2026 Art. 20-A (ingresos < $300M)
    viaticosTopeFiscalDiarioMxn: 750, // LISR 28-V, alimentación nacional
    efectivoTopeMxn: 2000,            // LISR 27-III
    clavesDieselIeps: ['15101505'],   // solo diésel (la gasolina 15101514/15 NO tiene el estímulo IEPS)
    // Verificadas en la guía de sugerencias del SAT (Sugerencia_PyS/Peaje.pdf):
    // "Carretera o autopista o autopista de peaje interestatal", unidad C62.
    // 93151505 queda FUERA a propósito: es genérica ("organismos administrativos")
    // y acreditaría peaje sobre gastos que no lo son. Ver intake/concepto.ts.
    clavesPeaje: ['95111602', '95111603'],
  },
  // Portales de facturación por marca (capa 1). Plazos y URLs de los tickets reales.
  portales: [
    { marca: 'G500', match: ['g500'], portal: 'https://www.g500network.com', plazoHoras: 72, campos: ['folio_norm', 'web_id', 'rfc'] },
    { marca: 'Pemex (franquicia / FACTURAGAS)', match: ['la joya', 'cargogas', 'facturagas', 'hidrolitro'], portal: 'https://www.cargogas.com', plazoHoras: 72, campos: ['folio_norm', 'web_id', 'fecha', 'rfc'] },
    { marca: 'ARCO (Chihuahua)', match: ['arco', 'petrol.com'], portal: 'https://www.petrol.com.mx', plazoHoras: 72, campos: ['folio_norm', 'web_id', 'rfc'] },
    { marca: 'Petromax / Petro7', match: ['petromax', 'petro7', 'duropetro'], portal: 'https://petro7.com/facturacion', plazoHoras: 72, campos: ['estacion', 'folio_norm', 'web_id', 'rfc'] },
    { marca: 'ARCO (Sonora) / Buzón', match: ['bellas artes', 'buzonfacturas'], portal: 'https://www.buzonfacturas.com', plazoHoras: 48, campos: ['num_venta', 'rfc'] },
    { marca: 'Enerser', match: ['enerser'], portal: '', plazoHoras: 72, campos: [] },
    { marca: 'GORM / Brentec', match: ['gorm', 'brentec'], portal: '', plazoHoras: 72, campos: [] },
  ],
  validacion: { fechaToleranciaDiasAntes: 30 },
};

/** Reconoce el portal de facturación de un ticket por palabras clave (estación/
 *  emisor/URL leídos por OCR). Devuelve null si no hay match. Capa 1: solo aviso. */
export function portalParaTicket(texto: string, cfg: CuadraConfig): PortalFacturacion | null {
  const t = texto.toLowerCase();
  return cfg.portales.find((p) => p.match.some((m) => t.includes(m))) ?? null;
}

/**
 * Mezcla el override del tenant sobre la config base, RECURSIVAMENTE.
 *
 * `{ ...base, ...override }` era shallow, y eso borraba hermanos: un tenant que
 * guardaba `config: { estimulos: { efectivoTopeMxn: 3000 } }` se llevaba por
 * delante el tope de alimentación, el factor de peaje y las claves del IEPS de
 * diésel — todo el objeto `estimulos` se reemplazaba.
 *
 * Y no tronaba. El motor lee el tope con `if (topeAlimentacion != null)`, así
 * que al quedar undefined el bloque se SALTABA: el tope de $750/día de LISR 28-V
 * dejaba de aplicarse sin un error en el log, y la liquidación salía diciendo
 * que todo era deducible. Personalizar un tope tiraba los otros tres.
 *
 * Reglas:
 *  - objetos → se mezclan por llave, a cualquier profundidad;
 *  - arrays → REEMPLAZAN. Si la flota define su política de gastos quiere la
 *    suya; concatenarla con la de demo le dejaría topes que nadie autorizó, y un
 *    array vacío es una decisión, no un hueco;
 *  - primitivos y null → reemplazan.
 *
 * No muta nada: `DEMO_CONFIG` es un módulo compartido, y mutarlo le aplicaría el
 * override de un tenant al siguiente que pida config.
 */
export function fusionarConfig<T>(base: T, override: unknown): T {
  if (override == null) return base;
  if (Array.isArray(override) || Array.isArray(base)) return override as T;
  if (typeof override !== 'object' || typeof base !== 'object' || base === null) return override as T;

  const salida: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const previo = (base as Record<string, unknown>)[k];
    salida[k] =
      previo !== null && typeof previo === 'object' && !Array.isArray(previo) &&
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? fusionarConfig(previo, v)
        : v;
  }
  return salida as T;
}

/** Devuelve la config del tenant (override en DB) o los defaults de demo. */
export async function getConfig(tenantId: string): Promise<CuadraConfig> {
  try {
    const { data } = await supabaseAdmin().from('tenant').select('rfc, config').eq('id', tenantId).maybeSingle();
    const override = (data?.config as Partial<CuadraConfig> | null) ?? null;
    const cfg: CuadraConfig = fusionarConfig(DEMO_CONFIG, override);
    // El RFC de la empresa puede venir en la columna `tenant.rfc`.
    if (data?.rfc) cfg.empresa = { ...cfg.empresa, rfc: data.rfc as string };
    return cfg;
  } catch {
    return DEMO_CONFIG; // demo-safe: si la DB no está, usa defaults
  }
}
