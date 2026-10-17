import { z } from 'zod';
import { UMBRALES_AVISO_DIAS } from './plazo_reclamo';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONFIGURACIÓN DE PLAZO, AVISOS E INTERRUPTORES del agente de peajes (T-A2-29b).
// PURO: sin base ni red.
//
// Lo que la pantalla de configuración guarda además de los umbrales de atípicos:
//   · el PLAZO de reclamo en meses y los DÍAS de aviso antes de que venza,
//   · el recordatorio del archivo decenal faltante (días de gracia),
//   · un INTERRUPTOR por capacidad. TODOS NACEN APAGADOS: ninguna flota recibe un
//     aviso que no pidió.
//
// El plazo es una regla del proveedor que el cliente refirió de palabra y que NO está
// confirmada por escrito ni se sabe desde qué fecha cuenta: por eso es configurable.
// Lo que llega de la pantalla se VALIDA y se rechaza con un mensaje llano (no se
// "arregla"); lo que sale de la base y está corrupto cae a los valores por omisión.
// ═══════════════════════════════════════════════════════════════════════════

export const PLAZO_MESES_DEFAULT = 3;
export const PLAZO_MESES_MIN = 1;
export const PLAZO_MESES_MAX = 24;
export const AVISO_DIAS_MIN = 1;
export const AVISO_DIAS_MAX = 365;
export const AVISO_DIAS_CANTIDAD_MAX = 5;
export const DIAS_GRACIA_DEFAULT = 2;
export const DIAS_GRACIA_MIN = 0;
export const DIAS_GRACIA_MAX = 10;

/** Las capacidades que se encienden o apagan por separado (las de atípicos viven en su propia configuración). */
export const INTERRUPTORES = ['aviso_plazo', 'recordatorio_archivo'] as const;
export type Interruptor = (typeof INTERRUPTORES)[number];

export interface ConfigAvisos {
  plazo: { meses: number; avisoDias: number[] };
  recordatorio: { diasGracia: number };
  interruptores: Record<Interruptor, boolean>;
}

export const CONFIG_AVISOS_DEFAULT: ConfigAvisos = {
  plazo: { meses: PLAZO_MESES_DEFAULT, avisoDias: [...UMBRALES_AVISO_DIAS] },
  recordatorio: { diasGracia: DIAS_GRACIA_DEFAULT },
  interruptores: { aviso_plazo: false, recordatorio_archivo: false },
};

const meses = z.number({ error: 'El plazo debe ser un número de meses.' })
  .int('El plazo debe ser un número entero de meses.')
  .min(PLAZO_MESES_MIN, `El plazo va de ${PLAZO_MESES_MIN} a ${PLAZO_MESES_MAX} meses.`)
  .max(PLAZO_MESES_MAX, `El plazo va de ${PLAZO_MESES_MIN} a ${PLAZO_MESES_MAX} meses.`);

const unDiaDeAviso = z.number({ error: 'Los días de aviso deben ser números.' })
  .int('Los días de aviso deben ser números enteros.')
  .min(AVISO_DIAS_MIN, `Cada aviso va de ${AVISO_DIAS_MIN} a ${AVISO_DIAS_MAX} días antes del vencimiento.`)
  .max(AVISO_DIAS_MAX, `Cada aviso va de ${AVISO_DIAS_MIN} a ${AVISO_DIAS_MAX} días antes del vencimiento.`);

const avisoDias = z.array(unDiaDeAviso, { error: 'Los días de aviso deben ser una lista de números.' })
  .min(1, 'Indica al menos un día de aviso (por ejemplo 30, 7).')
  .max(AVISO_DIAS_CANTIDAD_MAX, `Máximo ${AVISO_DIAS_CANTIDAD_MAX} avisos por plazo.`)
  .refine((xs) => new Set(xs).size === xs.length, 'Hay un día de aviso repetido.');

const diasGracia = z.number({ error: 'Los días de gracia deben ser un número.' })
  .int('Los días de gracia deben ser un número entero.')
  .min(DIAS_GRACIA_MIN, `Los días de gracia van de ${DIAS_GRACIA_MIN} a ${DIAS_GRACIA_MAX}.`)
  .max(DIAS_GRACIA_MAX, `Los días de gracia van de ${DIAS_GRACIA_MIN} a ${DIAS_GRACIA_MAX}.`);

const interruptor = z.boolean({ error: 'Indica si la capacidad está encendida (sí o no).' });

const D = CONFIG_AVISOS_DEFAULT;

export const configAvisosSchema = z.object({
  plazo: z.object({
    meses: meses.default(D.plazo.meses),
    avisoDias: avisoDias.default(D.plazo.avisoDias),
  }).default(D.plazo),
  recordatorio: z.object({
    diasGracia: diasGracia.default(D.recordatorio.diasGracia),
  }).default(D.recordatorio),
  interruptores: z.object({
    aviso_plazo: interruptor.default(false),
    recordatorio_archivo: interruptor.default(false),
  }).default(D.interruptores),
});

export type ValidadoAvisos = { ok: true; valor: ConfigAvisos } | { ok: false; motivo: string };

/** El orden en que se avisa: del más lejano al más cercano al vencimiento. */
const ordenados = (c: ConfigAvisos): ConfigAvisos => ({ ...c, plazo: { ...c.plazo, avisoDias: [...c.plazo.avisoDias].sort((a, b) => b - a) } });

/** Valida (y completa con los defaults) la configuración. `null`/`undefined` = todo por omisión. */
export function validarConfigAvisos(entrada: unknown): ValidadoAvisos {
  const r = configAvisosSchema.safeParse(entrada ?? {});
  if (!r.success) return { ok: false, motivo: r.error.issues[0]?.message ?? 'La configuración no es válida.' };
  return { ok: true, valor: ordenados(r.data) };
}

/** La configuración que usa la flota: la guardada y válida, o los defaults (todo apagado). Una fila corrupta no enciende nada. */
export function configAvisosEfectiva(guardada: unknown): ConfigAvisos {
  const v = validarConfigAvisos(guardada);
  return v.ok ? v.valor : structuredClone(CONFIG_AVISOS_DEFAULT);
}

/**
 * «30, 7» / «30 7» / «30;7» → `[30, 7]`. Un pedazo que no es número entero positivo
 * (p. ej. «3x», «2.5») devuelve `null`: no se adivina qué quiso decir la persona.
 */
export function parsearDiasAviso(texto: string): number[] | null {
  const pedazos = texto.split(/[\s,;]+/).filter(Boolean);
  if (pedazos.length === 0) return null;
  const dias: number[] = [];
  for (const p of pedazos) {
    if (!/^\d{1,4}$/.test(p)) return null;
    dias.push(Number(p));
  }
  return dias;
}
