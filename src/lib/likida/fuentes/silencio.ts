// ═══════════════════════════════════════════════════════════════════════════
// REGLA DE SILENCIO DEL CANAL (F19, adaptada de ATIENDE A6 a volumen bajo).
//
// Si el webhook de WhatsApp —que debería hablar mientras haya viajes abiertos—
// no recibe NINGÚN evento (entrante ni de estado) en N horas HÁBILES, se avisa
// UNA vez, agrupado. Dos matices que evitan el falso rojo de una flota de ~24
// viajes al mes:
//   · el silencio solo cuenta con viajes abiertos (sin viajes nadie tiene por
//     qué escribir) y solo en horas hábiles (la noche y el domingo no corren);
//   · lo no leído NO es silencio: `viajesAbiertos === null` o un último evento
//     sin leer dan «sin dato», jamás una alerta inventada ni un «todo bien».
// Pura: la lectura va en `leer.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** Horas hábiles sin ningún evento del webhook a partir de las cuales se avisa. SUPUESTO declarado. */
export const HORAS_HABILES_SILENCIO = 10;

/** Horario hábil: lunes a sábado, de 8:00 a 20:00, hora de la Ciudad de México (sin horario de verano desde 2022: UTC-6). */
export const HORA_HABIL_DESDE = 8;
export const HORA_HABIL_HASTA = 20;
const UTC_OFFSET_H = -6;
const HORA_MS = 3_600_000;
/** Tope del barrido: pasado este lapso el resultado ya es «mucho» y no hace falta contar más. */
const TOPE_BARRIDO_H = 24 * 14;

function esHoraHabil(msInicioHora: number): boolean {
  const local = new Date(msInicioHora + UTC_OFFSET_H * HORA_MS);
  const dia = local.getUTCDay(); // 0 = domingo
  const hora = local.getUTCHours();
  return dia !== 0 && hora >= HORA_HABIL_DESDE && hora < HORA_HABIL_HASTA;
}

/** Horas hábiles transcurridas entre dos instantes (fracción incluida, a granularidad de minuto). */
export function horasHabilesEntre(desdeMs: number, hastaMs: number): number {
  if (!(hastaMs > desdeMs)) return 0;
  const fin = Math.min(hastaMs, desdeMs + TOPE_BARRIDO_H * HORA_MS);
  let habilesMs = 0;
  let cursor = desdeMs;
  while (cursor < fin) {
    const sigHora = (Math.floor(cursor / HORA_MS) + 1) * HORA_MS;
    const tramoFin = Math.min(sigHora, fin);
    if (esHoraHabil(Math.floor(cursor / HORA_MS) * HORA_MS)) habilesMs += tramoFin - cursor;
    cursor = tramoFin;
  }
  return habilesMs / HORA_MS;
}

export type EstadoSilencio = 'silencio' | 'ok' | 'sin_viajes' | 'sin_dato' | 'sin_conectar';

export interface EntradaSilencio {
  /** Viajes abiertos (sistema o flota); `null` = no se pudo leer. */
  viajesAbiertos: number | null;
  /** Último evento del webhook: `leido: false` = no se pudo leer; `ms: null` = leído y no hay ninguno. */
  ultimoEvento: { leido: false } | { leido: true; ms: number | null };
  ahoraMs: number;
  horasHabiles?: number;
}

export interface ResultadoSilencio {
  estado: EstadoSilencio;
  /** `true` produce UNA alerta agrupada. */
  hayAlerta: boolean;
  viajesAbiertos: number | null;
  horasHabilesSinEvento: number | null;
  umbralHoras: number;
}

export function evaluarSilencio(e: EntradaSilencio): ResultadoSilencio {
  const umbralHoras = e.horasHabiles ?? HORAS_HABILES_SILENCIO;
  const base = { viajesAbiertos: e.viajesAbiertos, umbralHoras };
  if (e.viajesAbiertos === null || !e.ultimoEvento.leido) {
    return { ...base, estado: 'sin_dato', hayAlerta: false, horasHabilesSinEvento: null };
  }
  if (e.viajesAbiertos <= 0) return { ...base, estado: 'sin_viajes', hayAlerta: false, horasHabilesSinEvento: null };
  // Leído y SIN NINGÚN evento jamás: la fuente no está conectada todavía (flota nueva). Eso no es silencio: alarmar aquí contradice
  // la fila «Sin conectar · No es una falla» y le saldría a toda flota nueva con viajes abiertos (ronda visual 5).
  if (e.ultimoEvento.ms === null) return { ...base, estado: 'sin_conectar', hayAlerta: false, horasHabilesSinEvento: null };
  const horas = horasHabilesEntre(e.ultimoEvento.ms, e.ahoraMs);
  return horas >= umbralHoras
    ? { ...base, estado: 'silencio', hayAlerta: true, horasHabilesSinEvento: horas }
    : { ...base, estado: 'ok', hayAlerta: false, horasHabilesSinEvento: horas };
}
