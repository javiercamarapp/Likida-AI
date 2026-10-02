import { logger } from '@/lib/logger';
import { avisarEscalacionesPendientes, type DepsAvisoEscalacion, type ResumenAvisos } from './aviso_escalacion';
import { barrerSaludDeFlota, type DepsBarrido } from './barrido_salud';

// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO VIVO DEL ORQUESTADOR DENTRO DEL CRON `escalar` (sin cron nuevo):
//
//   1. BARRIDO DE SALUD: el claim (0652) entrega las flotas a las que ya les toca (≤ 25 por corrida, una vez cada 30 min);
//      cada una se barre con `barrerSaludDeFlota` (abre/cierra su tarea `falla_de_agente`) y se registra el resultado.
//      Un error en UNA flota no frena a las demás y acorta su reintento (10 min).
//   2. AVISOS: las tareas abiertas con el aviso pendiente (las que acaba de abrir el barrido y las que el asistente dejó y
//      no alcanzaron a avisar en caliente), con tope por flota y por corrida.
//
// Respeta el reloj (`venceEn`): no empieza una flota ni manda un correo con el tiempo vencido. Nunca lanza: devuelve el parte
// y `fallos` (un barrido que no pudo leer, o un puerto roto) para que el cron pinte la corrida como fallida.
// ═══════════════════════════════════════════════════════════════════════════

export const FLOTAS_POR_CORRIDA = 25;
export const VENTANA_BARRIDO_MIN = 30;
export const PENDIENTES_POR_CORRIDA = 40;

export interface PuertoCicloVivo {
  /** Las flotas reclamadas para esta corrida; `null` = la RPC no existe (base sin migrar). */
  reclamarFlotas(limite: number, ventanaMin: number): Promise<string[] | null>;
  registrarBarrido(tenantId: string, r: { ok: boolean; abiertas: number; cerradas: number; error: string | null }): Promise<void>;
  /** Tareas abiertas con aviso pendiente (más viejas primero); `null` = columnas inexistentes (base sin migrar). */
  pendientesDeAviso(limite: number): Promise<Array<{ tenantId: string; id: string }> | null>;
}

export interface ResultadoCicloVivo {
  barrido: 'no_disponible' | { flotas: number; abiertas: number; cerradas: number; fallos: number; cortadoPorReloj: boolean };
  avisos: ResumenAvisos | 'no_disponible';
  fallos: number;
}

export async function correrCicloVivo(
  puerto: PuertoCicloVivo, barrido: DepsBarrido, aviso: DepsAvisoEscalacion, opciones: { venceEn?: number; ahora?: Date } = {},
): Promise<ResultadoCicloVivo> {
  const ahora = opciones.ahora ?? new Date();
  const vencido = (): boolean => opciones.venceEn !== undefined && Date.now() >= opciones.venceEn;
  const salida: ResultadoCicloVivo = { barrido: 'no_disponible', avisos: 'no_disponible', fallos: 0 };

  try {
    const flotas = await puerto.reclamarFlotas(FLOTAS_POR_CORRIDA, VENTANA_BARRIDO_MIN);
    if (flotas !== null) {
      const b = { flotas: 0, abiertas: 0, cerradas: 0, fallos: 0, cortadoPorReloj: false };
      for (const tenantId of flotas) {
        if (vencido()) { b.cortadoPorReloj = true; break; }
        b.flotas++;
        try {
          const r = await barrerSaludDeFlota(tenantId, ahora, barrido);
          b.abiertas += r.abiertas; b.cerradas += r.cerradas;
          await puerto.registrarBarrido(tenantId, { ok: true, abiertas: r.abiertas, cerradas: r.cerradas, error: null });
        } catch (e) {
          b.fallos++;
          const error = e instanceof Error ? e.message : String(e);
          logger.warn('orquestador.barrido_fallo', { tenantId, err: error });
          await puerto.registrarBarrido(tenantId, { ok: false, abiertas: 0, cerradas: 0, error }).catch(() => undefined);
        }
      }
      salida.barrido = b;
      salida.fallos += b.fallos;
    }
  } catch (e) {
    salida.fallos++;
    logger.error('orquestador.barrido_roto', { err: e instanceof Error ? e.message : String(e) });
  }

  try {
    const pendientes = await puerto.pendientesDeAviso(PENDIENTES_POR_CORRIDA);
    if (pendientes !== null) salida.avisos = await avisarEscalacionesPendientes(pendientes, aviso, { venceEn: opciones.venceEn });
  } catch (e) {
    salida.fallos++;
    logger.error('orquestador.avisos_roto', { err: e instanceof Error ? e.message : String(e) });
  }
  return salida;
}
