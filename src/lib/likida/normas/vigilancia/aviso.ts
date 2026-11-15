// El correo de la vigilancia: UNO por corrida, con una línea por hallazgo. `alertarOperador` recorta cada valor a 300
// caracteres, por eso cada aviso es una llave propia (`aviso_01`…) y no un texto largo.

import type { Aviso } from './estado';

/** Cuántas líneas caben en UN correo; el resto sale en el siguiente (siguen en `pendientes`). */
export const AVISOS_POR_CORREO = 10;

export function detalleDeCorreo(avisos: Aviso[], fecha: string): Record<string, unknown> {
  const detalle: Record<string, unknown> = {
    codigo: 'vigilancia_hallazgos',
    resumen: `${avisos.length} publicación(es)/cambio(s) por leer; barrido hasta ${fecha}. Esta rutina NO tocó ninguna ficha: la lectura es humana.`,
  };
  avisos.slice(0, AVISOS_POR_CORREO).forEach((a, i) => { detalle[`aviso_${String(i + 1).padStart(2, '0')}`] = a.linea; });
  if (avisos.length > AVISOS_POR_CORREO) detalle.y_mas = `${avisos.length - AVISOS_POR_CORREO} más saldrán en el siguiente correo`;
  return detalle;
}

/** Los textos de respuesta de la ruta viven aquí y no en `src/app`: la deuda de i18n de `src/app` solo baja (ver i18n_deuda.test.ts). */
export const MENSAJES = {
  sinSecreto: 'La vigilancia normativa no corre sin él.',
  latidoIlegible: 'No se pudo leer el estado de la vigilancia (cron_latido): no se barre a ciegas.',
  interruptorIlegible: 'No se pudo leer el interruptor global: no se sale a la red sin saber si está apagado.',
  saltadoGlobal: 'interruptor global',
  fallosRepetidos: (corridas: number, fallos: Array<{ codigo: string; causa: string; dia?: string }>): string =>
    `La vigilancia normativa lleva ${corridas} corridas con fallo: ${fallos.map((f) => `${f.codigo}${f.dia ? ` (${f.dia})` : ''}: ${f.causa}`).join(' | ').slice(0, 600)}`,
} as const;
