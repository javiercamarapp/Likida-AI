// ═══════════════════════════════════════════════════════════════════════════
// RETENCIÓN DE LOS AGENTES 1 Y 2 — lo que tenía RPC de purga pero ningún cron.
//
// Cuelga de `/api/cron/purgar` (que ya trae la puerta con secreto, el kill switch
// y el latido). Cuatro purgas, cada una con SU plazo y su porqué:
//
//   · wa_ventana_contacto      7 días  — el teléfono y la hora del último mensaje
//                                         del chofer: la ventana de Meta dura 24 h.
//   · wa_envio_registro        90 días — por qué cada aviso salió por un canal u
//                                         otro (solo últimos 4 dígitos del teléfono).
//   · liquidacion_externa      60 meses — terminal solamente; el PDF se encola para
//                                         borrado de Storage (mig. 0562).
//   · peaje_ingesta_archivo    30 días — el CONTENIDO de los archivos de peajes que
//                                         fallaron (la fila queda de constancia).
//
// UNA purga que falla NO tumba a las demás ni a la corrida: cada una devuelve su
// propio `{ok:false,error}` y el cron lo grita y avisa. `null`/error en el cuerpo
// = no se pudo, dicho; jamás un 0 inventado.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export interface ResultadoPurgaAgente {
  nombre: string;
  ok: boolean;
  /** Cuántas filas se borraron o vaciaron (null si no se pudo saber). */
  filas: number | null;
  /** Quedó trabajo: la corrida de mañana lo levanta. */
  parcial: boolean;
  error: string | null;
}

export const PLAZOS_AGENTES = {
  waVentanaDias: 7,
  waEnvioRegistroDias: 90,
  liquidacionExternaMeses: 60,
  peajeFallidosDias: 30,
  /** Tope por purga y corrida. */
  limite: 5000,
} as const;

type Llamada = { nombre: string; rpc: string; args: Record<string, unknown>; leer: (d: unknown) => { filas: number | null; parcial: boolean } };

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

const LLAMADAS = (ahora: string): Llamada[] => [
  {
    nombre: 'wa_ventana_contacto', rpc: 'purgar_wa_ventana_contacto',
    args: { p_dias: PLAZOS_AGENTES.waVentanaDias, p_limite: PLAZOS_AGENTES.limite },
    leer: (d) => ({ filas: numero(d), parcial: numero(d) !== null && (numero(d) as number) >= PLAZOS_AGENTES.limite }),
  },
  {
    nombre: 'wa_envio_registro', rpc: 'purgar_wa_envio_registro',
    args: { p_dias: PLAZOS_AGENTES.waEnvioRegistroDias, p_limite: PLAZOS_AGENTES.limite },
    leer: (d) => ({ filas: numero(d), parcial: numero(d) !== null && (numero(d) as number) >= PLAZOS_AGENTES.limite }),
  },
  {
    nombre: 'liquidacion_externa', rpc: 'purgar_liquidacion_externa',
    args: { p_meses: PLAZOS_AGENTES.liquidacionExternaMeses, p_limite: 500, p_ahora: ahora },
    leer: (d) => ({ filas: numero((d as { borradas?: unknown } | null)?.borradas), parcial: (d as { parcial?: unknown } | null)?.parcial === true }),
  },
  {
    nombre: 'peaje_archivos_fallidos', rpc: 'purgar_peaje_archivos_fallidos',
    args: { p_dias: PLAZOS_AGENTES.peajeFallidosDias, p_limite: 500, p_ahora: ahora },
    leer: (d) => ({ filas: numero((d as { vaciados?: unknown } | null)?.vaciados), parcial: (d as { parcial?: unknown } | null)?.parcial === true }),
  },
];

/** Corre las cuatro purgas. Nunca lanza. */
export async function mantenerDatosAgentes(ahora: Date = new Date()): Promise<ResultadoPurgaAgente[]> {
  const salida: ResultadoPurgaAgente[] = [];
  for (const l of LLAMADAS(ahora.toISOString())) {
    try {
      const r = await supabaseAdmin().rpc(l.rpc, l.args);
      if (r.error) {
        logger.error('cron.purgar.agentes_fallo', { purga: l.nombre, err: r.error.message });
        salida.push({ nombre: l.nombre, ok: false, filas: null, parcial: false, error: r.error.message });
        continue;
      }
      const { filas, parcial } = l.leer(r.data);
      if (filas === null) {
        // Una respuesta que no se entiende NO se lee como «cero filas».
        salida.push({ nombre: l.nombre, ok: false, filas: null, parcial: false, error: 'respuesta_invalida' });
        continue;
      }
      salida.push({ nombre: l.nombre, ok: true, filas, parcial, error: null });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error('cron.purgar.agentes_excepcion', { purga: l.nombre, err: error });
      salida.push({ nombre: l.nombre, ok: false, filas: null, parcial: false, error });
    }
  }
  return salida;
}
