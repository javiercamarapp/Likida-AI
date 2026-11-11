import { CADENCIA_MS, esApagadoPorInterruptor, esHuecoDeConfiguracion, type CronId, type EstadoLatido } from '@/lib/admin/salud';
import type { EntradaFuente, IdFuente } from './estado';

// ═══════════════════════════════════════════════════════════════════════════
// LA MISMA PIEZA, VISTA DESDE EL SISTEMA (admin). El cliente mide la señal de
// SUS datos; la Salud del admin y la campana miden el RELOJ que lee cada
// fuente, con la misma función de estado (`evaluarFuente`). Pura.
// ═══════════════════════════════════════════════════════════════════════════

/** Qué reloj lee cada fuente. */
export const RELOJ_DE_FUENTE: Record<IdFuente, CronId> = {
  whatsapp: 'wa-pendientes',
  tms: 'tms',
  gps: 'gps',
  peajes: 'peajes',
  correo: 'buzon-entrega',
  sat: 'descarga-sat',
};

/** Piso de la cadencia de un reloj para juzgarlo: `vercel.json` corre algunos cada minuto, pero un latido tarda en asentarse. SUPUESTO. */
export const PISO_CADENCIA_RELOJ_MS = 15 * 60_000;

export interface LatidoParaFuente {
  ultimoLatido: string | null;
  ultimoEstado: EstadoLatido | null;
  detalle: Record<string, unknown>;
}

export function entradasDeLatidos(latidos: Readonly<Partial<Record<CronId, LatidoParaFuente>>> | null): EntradaFuente[] {
  return (Object.keys(RELOJ_DE_FUENTE) as IdFuente[]).map((id): EntradaFuente => {
    const cron = RELOJ_DE_FUENTE[id];
    const cadenciaMs = Math.max(CADENCIA_MS[cron], PISO_CADENCIA_RELOJ_MS);
    const l = latidos?.[cron];
    if (!latidos || !l) return { id, lectura: 'caida', configurada: false, ultimaSenalMs: null, cadenciaMs };
    // Apagado a propósito por palanca, o hueco de configuración declarado: es «sin conectar», no una falla.
    if (esApagadoPorInterruptor(l.ultimoEstado, l.detalle) || esHuecoDeConfiguracion(l.detalle)) {
      return { id, lectura: 'medida', configurada: false, ultimaSenalMs: null, cadenciaMs };
    }
    const ms = l.ultimoLatido === null ? NaN : Date.parse(l.ultimoLatido);
    return {
      id, lectura: 'medida', configurada: true,
      ultimaSenalMs: Number.isFinite(ms) ? ms : null,
      falla: l.ultimoEstado === 'fallo' ? (typeof l.detalle.error === 'string' ? l.detalle.error.slice(0, 160) : 'fallo') : null,
      cadenciaMs,
    };
  });
}
