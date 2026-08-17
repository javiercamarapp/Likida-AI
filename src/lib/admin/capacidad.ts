import { supabaseAdmin } from '@/lib/supabase/admin';

// ═══════════════════════════════════════════════════════════════════════════
// EL MODELO DE CAPACIDAD (fase 7, auditoría 5 §35) — escenarios de escala
// con TODOS los supuestos declarados (regla de la casa: una estimación se
// muestra declarada y con su supuesto a la vista).
//
// Las UNIDADES salen de lo MEDIDO cuando hay muestra (costo de IA por viaje
// liquidado, comprobantes por viaje); sin muestra, se usa el supuesto de
// diseño y se dice. Los LÍMITES de proveedor son NOMINALES (documentación
// pública), no medidos — también se dice.
// ═══════════════════════════════════════════════════════════════════════════

/** Supuestos de diseño — visibles en la UI, jamás implícitos. */
export const SUPUESTOS_CAPACIDAD = {
  comprobantesPorViaje: 10,
  mensajesPorViaje: 16,       // comprobantes + hitos + consultas + cierre
  horasPicoDia: 8,            // la operación se concentra en la jornada
  llamadasLlmPorViaje: 4,     // OCR corre en pipeline; cuadre+conversación
  bytesPorComprobante: 350_000, // foto de ticket promedio (~350 KB)
} as const;

/** Límites NOMINALES de proveedor (documentación pública, no medidos). */
export const LIMITES_NOMINALES = [
  { recurso: 'WhatsApp Cloud API', limite: '80 msg/s por número (tier base)', fuente: 'Meta' },
  { recurso: 'Vercel Functions', limite: '300 s por invocación (default actual)', fuente: 'Vercel' },
  { recurso: 'Supabase (plan actual)', limite: 'pool de conexiones vía PostgREST — sin conexión directa desde la app', fuente: 'Supabase' },
] as const;

export interface UnidadesMedidas {
  /** USD de IA por viaje liquidado — null si no hay muestra. */
  costoIaPorViaje: number | null;
  muestraViajes: number;
  costoIa30d: number;
}

/** Lo MEDIDO: llm_costo 30d / liquidaciones 30d. Muestra chica se declara. */
export async function getUnidadesMedidas(ahoraMs: number): Promise<UnidadesMedidas> {
  const admin = supabaseAdmin();
  const hace30d = new Date(ahoraMs - 30 * 86_400_000).toISOString();
  const [rCosto, rLiq] = await Promise.all([
    admin.from('llm_costo').select('costo_usd').gte('creado_en', hace30d).limit(10000),
    admin.from('liquidacion').select('id', { count: 'exact', head: true }).gte('creada_en', hace30d),
  ]);
  if (rCosto.error) throw new Error(`unidades/llm_costo: ${rCosto.error.message}`);
  if (rLiq.error) throw new Error(`unidades/liquidacion: ${rLiq.error.message}`);
  const costoIa30d = (rCosto.data ?? []).reduce((s, f) => s + (Number(f.costo_usd) || 0), 0);
  const muestraViajes = rLiq.count ?? 0;
  return {
    costoIa30d,
    muestraViajes,
    costoIaPorViaje: muestraViajes > 0 ? costoIa30d / muestraViajes : null,
  };
}

export interface Escenario {
  viajesDia: number;
  mensajesDia: number;
  mensajesMinPico: number;
  llamadasLlmDia: number;
  costoIaDiaUsd: number | null;
  storageDiaMb: number;
}

/** PURA: escala los supuestos (y el costo medido, si existe) al escenario. */
export function escenarioDe(viajesDia: number, costoIaPorViaje: number | null): Escenario {
  const S = SUPUESTOS_CAPACIDAD;
  const mensajesDia = viajesDia * S.mensajesPorViaje;
  return {
    viajesDia,
    mensajesDia,
    mensajesMinPico: Math.ceil(mensajesDia / (S.horasPicoDia * 60)),
    llamadasLlmDia: viajesDia * S.llamadasLlmPorViaje,
    costoIaDiaUsd: costoIaPorViaje === null ? null : viajesDia * costoIaPorViaje,
    storageDiaMb: Math.round((viajesDia * S.comprobantesPorViaje * S.bytesPorComprobante) / 1_048_576),
  };
}

export const ESCENARIOS_VIAJES_DIA = [1_000, 10_000, 100_000] as const;
