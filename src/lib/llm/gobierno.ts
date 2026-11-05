// ═══════════════════════════════════════════════════════════════════════════
// GOBIERNO DE IA EN LA GUARDIA (CT-IA-01 + CT-IA-05, F5).
//
// Cada 15 minutos, colgado de la guardia (que corre cada 5): (1) la sonda de la
// llave del proveedor y (2) el barrido de topes al 80 y al 100 %. No agrega un
// cron ni un componente al health: mismo patrón que el barrido de seguridad.
//
// APAGADO por omisión (IA_GOBIERNO=encendido): el barrido necesita la migración
// 0990 aplicada, y encenderlo antes llenaría el log de errores. Apagado no toca
// la red ni la base. NUNCA lanza.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';

export const CADA_MINUTOS_GOBIERNO_IA = 15;

export type EstadoGobiernoIa = 'apagado' | 'omitido' | 'ok' | 'error';
export interface ResultadoGobiernoIa {
  estado: EstadoGobiernoIa;
  llave?: string;
  flotas?: number;
  avisos?: number;
  error?: string;
}

/** PURA. ¿Toca correr en esta pasada de la guardia (cada 5 min)? Una de cada tres: la que cae en el minuto 0-4 de cada cuarto. */
export function tocaGobiernoIa(ahoraMs: number): boolean {
  return new Date(ahoraMs).getUTCMinutes() % CADA_MINUTOS_GOBIERNO_IA < 5;
}

export function gobiernoIaEncendido(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.IA_GOBIERNO === 'encendido';
}

export async function correrGobiernoIa(ahoraMs: number = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<ResultadoGobiernoIa> {
  if (!gobiernoIaEncendido(env)) return { estado: 'apagado' };
  if (!tocaGobiernoIa(ahoraMs)) return { estado: 'omitido' };
  try {
    const { sondearLlave } = await import('./credencial');
    const { revisarTopesIa } = await import('./alerta_tope');
    const sonda = await sondearLlave();
    const barrido = await revisarTopesIa();
    if (barrido.error) return { estado: 'error', llave: sonda.estado, error: barrido.error.slice(0, 160) };
    return { estado: 'ok', llave: sonda.estado, flotas: barrido.flotas, avisos: barrido.avisos.length };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    logger.error('cron.guardia.gobierno_ia_fallo', { err: error });
    return { estado: 'error', error };
  }
}
