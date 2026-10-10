// ═══════════════════════════════════════════════════════════════════════════
// RETENCIÓN DE LOS LEDGERS (Ola 9, seguridad; auditoría ola 1 #23) Y DE LA AUTOFACTURA (0542).
//
// Cuelga de `/api/cron/purgar` (que ya trae la puerta con secreto, el kill switch y el latido).
// Dos llamadas, cada una con SU plazo y su porqué (el detalle legal vive en la cabecera de la 0680):
//
//   · mantener_ledgers (0680)   evento_seguridad (90 / 180 / 365 días por severidad), evento_stripe
//                               (400), vigia_evento (365), cp_documento_evento (730), buzon_entrega_evento (365).
//   · purgar_autofactura (0542) lotes de emisión ya cerrados y cupos diarios viejos (180 días; sin datos
//                               personales, solo ids y montos).
//
// Una tabla que falla NO tumba a las demás ni a la corrida: sale con `ok:false` y su error dicho.
// `null`/error en el cuerpo = no se pudo, dicho; jamás un 0 inventado. Una respuesta que no se entiende
// no se lee como «cero filas».
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { correrPurgas, numero, type Llamada, type ResultadoPurgaAgente } from '@/lib/likida/retencion_agentes';

export const PLAZOS_LEDGERS = {
  stripeDias: 400,
  vigiaDias: 365,
  cpDocumentoDias: 730,
  buzonDias: 365,
  /** Autofactura (0542): el piso de la RPC es 30; el default de la migración, 180. */
  autofacturaDias: 180,
} as const;

/** Las cinco tablas que `mantener_ledgers` devuelve, en el orden en que las purga. */
export const TABLAS_LEDGERS = [
  'evento_seguridad', 'evento_stripe', 'vigia_evento', 'cp_documento_evento', 'buzon_entrega_evento',
] as const;

const NOMBRE_FALLO = /^([a-z_]+):\s*(.*)$/s;

/** Interpreta la respuesta de `mantener_ledgers`. Exportada para la prueba. */
export function leerLedgers(data: unknown): ResultadoPurgaAgente[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const salida: ResultadoPurgaAgente[] = [];
  const fallos = Array.isArray(d.fallos) ? d.fallos.map(String) : [];
  const fallo = new Map<string, string>();
  for (const f of fallos) {
    const m = NOMBRE_FALLO.exec(f);
    fallo.set(m ? m[1] : f, m ? m[2] : f);
  }
  for (const tabla of TABLAS_LEDGERS) {
    if (fallo.has(tabla)) {
      salida.push({ nombre: tabla, ok: false, filas: null, parcial: false, error: fallo.get(tabla) as string });
      continue;
    }
    const t = d[tabla] as { borradas?: unknown; parcial?: unknown } | undefined;
    const filas = numero(typeof t?.borradas === 'string' ? Number(t.borradas) : t?.borradas);
    if (filas === null) {
      // Ni resultado ni fallo dicho: no se asume cero.
      salida.push({ nombre: tabla, ok: false, filas: null, parcial: false, error: 'respuesta_invalida' });
      continue;
    }
    salida.push({ nombre: tabla, ok: true, filas, parcial: t?.parcial === true, error: null });
  }
  return salida;
}

/** Purga los ledgers y la autofactura. Nunca lanza. */
export async function mantenerLedgers(ahora: Date = new Date(), vence: Date | null = null): Promise<ResultadoPurgaAgente[]> {
  const salida: ResultadoPurgaAgente[] = [];
  try {
    const r = await supabaseAdmin().rpc('mantener_ledgers', {
      p_ahora: ahora.toISOString(),
      p_vence: vence ? vence.toISOString() : null,
      p_dias_stripe: PLAZOS_LEDGERS.stripeDias,
      p_dias_vigia: PLAZOS_LEDGERS.vigiaDias,
      p_dias_cp_documento: PLAZOS_LEDGERS.cpDocumentoDias,
      p_dias_buzon: PLAZOS_LEDGERS.buzonDias,
    });
    if (r.error) {
      logger.error('cron.purgar.ledgers_fallo', { err: r.error.message });
      salida.push({ nombre: 'ledgers', ok: false, filas: null, parcial: false, error: r.error.message });
    } else {
      const leidas = leerLedgers(r.data);
      if (leidas === null) salida.push({ nombre: 'ledgers', ok: false, filas: null, parcial: false, error: 'respuesta_invalida' });
      else {
        for (const l of leidas) if (!l.ok) logger.error('cron.purgar.ledgers_fallo', { purga: l.nombre, err: l.error });
        salida.push(...leidas);
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('cron.purgar.ledgers_excepcion', { err: error });
    salida.push({ nombre: 'ledgers', ok: false, filas: null, parcial: false, error });
  }

  const autofactura: Llamada = {
    nombre: 'autofactura', rpc: 'purgar_autofactura',
    args: { p_dias: PLAZOS_LEDGERS.autofacturaDias },
    leer: (d) => {
      const o = d as { lotes?: unknown; cupos?: unknown } | null;
      const lotes = numero(o?.lotes);
      const cupos = numero(o?.cupos);
      return { filas: lotes === null || cupos === null ? null : lotes + cupos, parcial: false };
    },
  };
  salida.push(...(await correrPurgas([autofactura], 'ledgers')));
  return salida;
}
