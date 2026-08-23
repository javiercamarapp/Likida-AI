import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { costoIaDesde } from './negocio';

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

/**
 * Lo MEDIDO: llm_costo 30d / liquidaciones 30d. Muestra chica se declara.
 *
 * CORREGIDO EL 22-AGO-2026 (escala 50k). Dos cosas estaban mal:
 *   1. Las columnas NO EXISTÍAN: filtraba `llm_costo.creado_en` y
 *      `liquidacion.creada_en`, y las dos tablas se llaman `created_at`
 *      (0003, 0001). PostgREST respondía 400 en cada carga, la página lo
 *      atrapaba (`catch { unidades = null }`) y /admin/capacidad-forecast
 *      llevaba desde su estreno diciendo "sin muestra" con muestra real.
 *   2. `llm_costo` venía a JS con `.limit(10000)` para sumar: con ~2,000
 *      llamadas al modelo diarias, 30 días son 60,000 filas — la suma se
 *      recortaba en silencio a la sexta parte. Ahora suma la MISMA
 *      agregación de la consola (`resumen_costo_ia`, 0062) con `p_desde`.
 * El conteo de liquidaciones sigue por `head` (cero filas cruzan la red) y
 * se exige como número: `count: null` no es 0, es "no se pudo contar".
 */
export async function getUnidadesMedidas(ahoraMs: number): Promise<UnidadesMedidas> {
  const hace30d = new Date(ahoraMs - 30 * 86_400_000).toISOString();
  const [costo, rLiq] = await Promise.all([
    costoIaDesde(hace30d),
    acotada(supabaseAdmin()
      .from('liquidacion').select('id', { count: 'exact', head: true }).gte('created_at', hace30d), 'unidades/liquidacion'),
  ]);
  if (rLiq.error) throw new Error(`unidades/liquidacion: ${rLiq.error.message}`);
  if (typeof rLiq.count !== 'number') {
    throw new Error('unidades/liquidacion: PostgREST no devolvió el conteo — no se afirma una muestra de 0.');
  }
  const costoIa30d = costo.costoUsd;
  const muestraViajes = rLiq.count;
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
