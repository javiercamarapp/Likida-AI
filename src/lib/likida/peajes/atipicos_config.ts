import { z } from 'zod';
import { CONFIG_ATIPICOS_DEFAULT, type ConfigAtipicos } from './atipicos';
import type { UmbralesAtipicos, ResultadoAtipicos, SenalAtipica } from './cruces_atipicos';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONFIGURACIÓN DE LOS CRUCES ATÍPICOS, validada (T-A2-12). PURO: sin base ni red.
//
// Los umbrales son defaults configurables, no calibrados con datos del cliente
// (`CONFIG_ATIPICOS_DEFAULT`). Lo que llega de la pantalla o de la base se valida
// aquí y se completa con los defaults: una regla o un campo ausente toma su valor
// por omisión; uno inválido se RECHAZA con un mensaje llano (no se "arregla").
// El detector corre solo si la flota lo activó (`activo`, apagado de origen).
// ═══════════════════════════════════════════════════════════════════════════

export const VENTANA_HORAS_MAX = 72;
export const MIN_CRUCES_MIN = 2;
export const MIN_CRUCES_MAX = 50;
export const VELOCIDAD_MIN_KMH = 30;
export const VELOCIDAD_MAX_KMH = 400;

const activa = z.boolean({ error: 'Indica si la regla está activa (sí o no).' });

const minCruces = z.number({ error: 'El mínimo de cruces debe ser un número.' })
  .int('El mínimo de cruces debe ser un número entero.')
  .min(MIN_CRUCES_MIN, `El mínimo de cruces va de ${MIN_CRUCES_MIN} a ${MIN_CRUCES_MAX}.`)
  .max(MIN_CRUCES_MAX, `El mínimo de cruces va de ${MIN_CRUCES_MIN} a ${MIN_CRUCES_MAX}.`);

const ventanaHoras = z.number({ error: 'La ventana debe ser un número de horas.' })
  .gt(0, 'La ventana debe ser mayor que 0 horas.')
  .max(VENTANA_HORAS_MAX, `La ventana admite hasta ${VENTANA_HORAS_MAX} horas.`);

const velocidadMaxKmh = z.number({ error: 'La velocidad máxima debe ser un número.' })
  .min(VELOCIDAD_MIN_KMH, `La velocidad máxima no puede ser menor a ${VELOCIDAD_MIN_KMH} km/h.`)
  .max(VELOCIDAD_MAX_KMH, `La velocidad máxima no puede pasar de ${VELOCIDAD_MAX_KMH} km/h.`);

const D = CONFIG_ATIPICOS_DEFAULT;

export const configAtipicosSchema = z.object({
  repeticion_caseta: z.object({
    activa: activa.default(D.repeticion_caseta.activa),
    minCruces: minCruces.default(D.repeticion_caseta.minCruces),
    ventanaHoras: ventanaHoras.default(D.repeticion_caseta.ventanaHoras),
  }).default(D.repeticion_caseta),
  ida_y_vuelta_madrugada: z.object({
    activa: activa.default(D.ida_y_vuelta_madrugada.activa),
    minCruces: minCruces.default(D.ida_y_vuelta_madrugada.minCruces),
  }).default(D.ida_y_vuelta_madrugada),
  secuencia_imposible: z.object({
    activa: activa.default(D.secuencia_imposible.activa),
    velocidadMaxKmh: velocidadMaxKmh.default(D.secuencia_imposible.velocidadMaxKmh),
  }).default(D.secuencia_imposible),
});

export type ValidadoAtipicos = { ok: true; valor: ConfigAtipicos } | { ok: false; motivo: string };

/** Valida (y completa con los defaults) los umbrales. `null`/`undefined` = todo por omisión. */
export function validarConfigAtipicos(entrada: unknown): ValidadoAtipicos {
  const r = configAtipicosSchema.safeParse(entrada ?? {});
  if (!r.success) return { ok: false, motivo: r.error.issues[0]?.message ?? 'Los umbrales no son válidos.' };
  return { ok: true, valor: r.data };
}

/** La configuración que usa la flota: la guardada y válida, o los defaults. Una fila corrupta no apaga ni inventa nada: cae a defaults. */
export function configAtipicosEfectiva(guardada: unknown): ConfigAtipicos {
  const v = validarConfigAtipicos(guardada);
  return v.ok ? v.valor : structuredClone(CONFIG_ATIPICOS_DEFAULT);
}

// ── Estado del hallazgo ─────────────────────────────────────────────────────
export const ESTADOS_ATIPICO = ['nuevo', 'avisado', 'revisado', 'justificado'] as const;
export type EstadoAtipico = (typeof ESTADOS_ATIPICO)[number];

const RANGO: Record<EstadoAtipico, number> = { nuevo: 0, avisado: 1, revisado: 2, justificado: 3 };

export const esEstadoAtipico = (x: unknown): x is EstadoAtipico =>
  typeof x === 'string' && (ESTADOS_ATIPICO as readonly string[]).includes(x);

/** El estado solo avanza: nuevo → avisado → revisado → justificado. Quedarse igual es válido (actualiza la nota). */
export function puedeCambiarEstado(de: EstadoAtipico, a: EstadoAtipico): boolean {
  return RANGO[a] >= RANGO[de];
}

/** Estados que exigen saber quién y cuándo revisó. */
export const exigeRevisor = (e: EstadoAtipico): boolean => e === 'revisado' || e === 'justificado';

/** El estado resultante de volver a guardar un hallazgo que ya existía: nunca retrocede. */
export function estadoTrasReguardar(previo: EstadoAtipico, propuesto: EstadoAtipico = 'nuevo'): EstadoAtipico {
  return puedeCambiarEstado(previo, propuesto) ? propuesto : previo;
}

// ── La misma configuración, para el detector de la pantalla de candidatos (A37-A2-17) ──
/**
 * Los umbrales que la flota guardó en Configuración, traducidos al detector de la pantalla (`cruces_atipicos.ts`):
 * repetición (mínimo de cruces y ventana) y velocidad máxima. «Madrugada» no tiene equivalente (la pantalla usa una franja
 * de horario, no un mínimo de cruces) y el interruptor general `activo` lo decide el producto: aquí no se tocan.
 */
export function umbralesDePantalla(c: ConfigAtipicos): { umbrales: Partial<UmbralesAtipicos>; apagadas: SenalAtipica[] } {
  const apagadas: SenalAtipica[] = [];
  if (!c.repeticion_caseta.activa) apagadas.push('repeticion_caseta');
  if (!c.secuencia_imposible.activa) apagadas.push('salto_imposible');
  return {
    umbrales: { repeticiones: c.repeticion_caseta.minCruces, ventanaHoras: c.repeticion_caseta.ventanaHoras, velocidadMaxKmh: c.secuencia_imposible.velocidadMaxKmh },
    apagadas,
  };
}

/** Quita lo de las señales que la flota apagó y lo dice en «no aplicadas» (no se presenta como «no hubo»). */
export function sinSenalesApagadas(r: ResultadoAtipicos, apagadas: readonly SenalAtipica[]): ResultadoAtipicos {
  if (apagadas.length === 0) return r;
  return {
    atipicos: r.atipicos.filter((a) => !apagadas.includes(a.senal)),
    noAplicadas: [
      ...r.noAplicadas,
      ...apagadas.map((senal) => ({ senal, motivo: 'La regla está apagada en la configuración de cruces atípicos de la flota.' })),
    ],
  };
}
