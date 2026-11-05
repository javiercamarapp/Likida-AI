// Las capas del interruptor del resumen por correo. TODAS fallan cerradas y por omisión está APAGADO:
//   (a) el interruptor global y el del agente Vigía de la plataforma deben leerse «encendido» (ilegible = apagado);
//   (b) la bandera de la plataforma LIKIDA_VIGIA_SIN_ATENDER_CORREO debe valer «si» (ausente = apagado).
import { envPuesta } from '@/lib/env';
import { leerInterruptor, type LecturaInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';

export const BANDERA_RESUMEN = 'LIKIDA_VIGIA_SIN_ATENDER_CORREO';

export function banderaResumenEncendida(): boolean {
  return envPuesta('LIKIDA_VIGIA_SIN_ATENDER_CORREO') && String(process.env.LIKIDA_VIGIA_SIN_ATENDER_CORREO).trim().toLowerCase() === 'si';
}

export type EstadoResumen = { ok: true } | { ok: false; motivo: 'interruptor_apagado' | 'bandera_apagada' };

export interface DepsInterruptor {
  bandera: () => boolean;
  leer: (n: NombreInterruptor) => Promise<LecturaInterruptor>;
}
const reales: DepsInterruptor = { bandera: banderaResumenEncendida, leer: leerInterruptor };

export async function resumenHabilitado(d: DepsInterruptor = reales): Promise<EstadoResumen> {
  if (!d.bandera()) return { ok: false, motivo: 'bandera_apagada' };
  try {
    for (const n of ['global', 'agente:vigia'] as const) if ((await d.leer(n)) !== 'encendido') return { ok: false, motivo: 'interruptor_apagado' };
  } catch {
    return { ok: false, motivo: 'interruptor_apagado' };
  }
  return { ok: true };
}
