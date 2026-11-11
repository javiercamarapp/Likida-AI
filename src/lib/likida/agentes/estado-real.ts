// «Estado real» de un agente en el catálogo (F5): lo que de verdad pasa, no lo que el catálogo promete. Pura.
// Un agente `vivo` con la palanca arriba pero parado por la bandeja NO se pinta como «Corriendo».

export type EstadoReal = 'corriendo' | 'bloqueado_bandeja' | 'parado' | 'sin_palanca' | 'sin_presupuesto' | 'apagado' | 'fuera_del_runner' | 'no_vivo' | 'sin_dato';

export const ROTULO_ESTADO_REAL: Readonly<Record<EstadoReal, string>> = {
  corriendo: 'Corriendo',
  bloqueado_bandeja: 'Bloqueado por bandeja',
  parado: 'Parado',
  sin_palanca: 'Sin palanca',
  sin_presupuesto: 'Sin presupuesto',
  apagado: 'Apagado',
  fuera_del_runner: 'Corre por su cron',
  no_vivo: 'No corre en el producto',
  sin_dato: 'Sin dato',
};

export const TONO_ESTADO_REAL: Readonly<Record<EstadoReal, 'ok' | 'warn' | 'bad' | 'neutral' | 'muted'>> = {
  corriendo: 'ok', bloqueado_bandeja: 'warn', parado: 'warn', sin_palanca: 'neutral', sin_presupuesto: 'warn',
  apagado: 'bad', fuera_del_runner: 'neutral', no_vivo: 'muted', sin_dato: 'muted',
};

export interface EntradaEstadoReal {
  estado: string;
  runnerHabilitado: boolean;
  presupuestoDiaUsd: number | null;
  /** `undefined` = el interruptor no existe para este agente; `null` = no se pudo leer. */
  apagado: boolean | null | undefined;
  /** Horas desde su última corrida; `null` = nunca corrió; `undefined` = no se pudo leer. */
  horasSinCorrer: number | null | undefined;
  /** Motivo del último salto del runner (de `agentes-parados`), o `null`. */
  motivoSalto: string | null;
  umbralHoras?: number;
}

const HORAS_PARADO = 72;

export function estadoRealDeAgente(e: EntradaEstadoReal): EstadoReal {
  if (e.estado !== 'vivo') return 'no_vivo';
  if (e.apagado === true) return 'apagado';
  if (e.apagado === null) return 'sin_dato';
  if (!e.runnerHabilitado) return e.apagado === undefined ? 'sin_palanca' : 'fuera_del_runner';
  if (e.presupuestoDiaUsd === null) return 'sin_presupuesto';
  const umbral = e.umbralHoras ?? HORAS_PARADO;
  const parado = e.horasSinCorrer === null || (typeof e.horasSinCorrer === 'number' && e.horasSinCorrer >= umbral);
  if (e.horasSinCorrer === undefined) return 'sin_dato';
  if (parado) return e.motivoSalto && /bandeja|contrapresi|backpressure/i.test(e.motivoSalto) ? 'bloqueado_bandeja' : 'parado';
  return e.apagado === undefined ? 'sin_palanca' : 'corriendo';
}
