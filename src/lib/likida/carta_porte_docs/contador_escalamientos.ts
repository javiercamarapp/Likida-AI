// Contador de ESCALAMIENTOS con su motivo (T-A3-68 h): para medir la tasa real de cada nivel cuando haya uso.
// Es del proceso (se reinicia al desplegar); el rastro durable por documento es el evento `escalada` de la bitácora
// (de, a, motivo, codigo) y `meta.escalamientos`. Nada aquí lleva contenido del documento.

import { logger } from '@/lib/logger';

export type CodigoEscalamiento = 'validador' | 'baja_confianza' | 'desacuerdo' | 'faltan_datos' | 'error_modelo';

const cuentas = new Map<string, number>();

export function registrarEscalamiento(e: { de: number; a: number; codigo: CodigoEscalamiento; motivo: string }): void {
  const clave = `${e.de}>${e.a}:${e.codigo}`;
  cuentas.set(clave, (cuentas.get(clave) ?? 0) + 1);
  logger.info('cartaporte.escalamiento', { de: e.de, a: e.a, codigo: e.codigo, motivo: e.motivo.slice(0, 160) });
}

/** `de>a:codigo` → veces. */
export const contadoresDeEscalamientos = (): Record<string, number> => Object.fromEntries(cuentas);
export const reiniciarEscalamientos = (): void => cuentas.clear();
