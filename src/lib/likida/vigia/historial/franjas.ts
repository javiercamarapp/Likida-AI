// ═══════════════════════════════════════════════════════════════════════════
// ESPERA POR FRANJA HORARIA — ¿a qué horas del día se queda sin respuesta lo que el cliente pide?
//
// Medido en 5 grupos reales: el p90 de respuesta sube en el cambio de turno (≈14 h; 6-8 h en dos grupos) y de madrugada (1-4 h),
// aunque la mediana sea de 3-5 min a toda hora. Una mediana global esconde esos huecos; este módulo da la espera POR HORA LOCAL para
// que el dueño decida con datos quién cubre cada franja. PURO y determinista; no manda ni cambia nada.
//
// «Petición» = mensaje del cliente que pide algo (prioridad ≥ 1 y `esPeticion`). La respuesta es el siguiente mensaje del equipo;
// con `soloRespuestaConDato` un acuse vacío («enterado») no cuenta (respuesta_vacia.ts).
// ═══════════════════════════════════════════════════════════════════════════
import { esPeticion } from '../peticion';
import { prioridadDe } from '../prioridad';
import { esRespuestaVacia } from '../respuesta_vacia';
import { horaLocal, ZONA_POR_OMISION } from '../turnos';
import type { MensajeHistorial } from './export_whatsapp';

export interface FranjaEspera {
  /** Hora local 0-23. */
  hora: number;
  peticiones: number;
  /** Con respuesta: mediana y p90 de minutos hasta ella. null si no hubo ninguna. */
  medianaMin: number | null;
  p90Min: number | null;
  /** Peticiones sin respuesta del equipo (hasta el final del archivo). */
  sinRespuesta: number;
  /** % de peticiones que esperaron más que el umbral o nunca se respondieron. */
  pctSobreUmbral: number;
}

export interface OpcionesFranjas {
  zona?: string;
  /** Umbral en minutos (por omisión 30, el mismo del motor «sin atender»). */
  umbralMin?: number;
  soloRespuestaConDato?: boolean;
}

const percentil = (orden: readonly number[], p: number): number | null => (orden.length === 0 ? null : orden[Math.min(orden.length - 1, Math.floor(p * orden.length))]);
const redondear = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

export function esperaPorFranja(
  entrada: ReadonlyArray<Pick<MensajeHistorial, 'enviadoEn' | 'rol' | 'texto'>>,
  opciones: OpcionesFranjas = {},
): FranjaEspera[] {
  const zona = opciones.zona ?? ZONA_POR_OMISION;
  const umbral = opciones.umbralMin ?? 30;
  const msgs = entrada
    .map((m) => ({ m, ms: Date.parse(m.enviadoEn) }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms);
  // Instante de la siguiente respuesta del equipo (la que cuenta) para cada posición.
  const siguiente: number[] = new Array(msgs.length);
  let proximo = Infinity;
  for (let k = msgs.length - 1; k >= 0; k -= 1) {
    siguiente[k] = proximo;
    const { m, ms } = msgs[k];
    if (m.rol === 'equipo' && !(opciones.soloRespuestaConDato && esRespuestaVacia(m.texto))) proximo = ms;
  }
  const esperas: number[][] = [...Array(24).keys()].map(() => []);
  const sin: number[] = new Array(24).fill(0);
  const total: number[] = new Array(24).fill(0);
  msgs.forEach(({ m, ms }, k) => {
    if (m.rol !== 'cliente' || prioridadDe(m.texto).nivel < 1 || !esPeticion(m.texto)) return;
    const h = horaLocal(new Date(ms), zona).hora;
    total[h] += 1;
    if (Number.isFinite(siguiente[k])) esperas[h].push((siguiente[k] - ms) / 60_000);
    else sin[h] += 1;
  });
  return esperas.map((lista, hora) => {
    const orden = [...lista].sort((a, b) => a - b);
    const sobre = lista.filter((x) => x > umbral).length + sin[hora];
    return {
      hora, peticiones: total[hora], medianaMin: redondear(percentil(orden, 0.5)), p90Min: redondear(percentil(orden, 0.9)), sinRespuesta: sin[hora],
      pctSobreUmbral: total[hora] === 0 ? 0 : Math.round((1000 * sobre) / total[hora]) / 10,
    };
  });
}

/**
 * Franjas con hueco: al menos `minPeticiones` y un % sobre el umbral igual o mayor a `pctMin` (por omisión 15 %, casi el doble del
 * promedio medido de 7-13 %). Ordenadas de peor a mejor. Una franja con pocas peticiones no se señala: sería ruido.
 */
export function franjasConHueco(franjas: readonly FranjaEspera[], opciones: { minPeticiones?: number; pctMin?: number } = {}): FranjaEspera[] {
  const minP = opciones.minPeticiones ?? 20;
  const pctMin = opciones.pctMin ?? 15;
  return franjas.filter((f) => f.peticiones >= minP && f.pctSobreUmbral >= pctMin).sort((a, b) => b.pctSobreUmbral - a.pctSobreUmbral || a.hora - b.hora);
}
