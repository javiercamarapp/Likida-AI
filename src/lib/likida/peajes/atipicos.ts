import { normalizarNombre } from './formatos';
import { TZ_MX } from '@/lib/formato';
import { haversineM } from './geo';
import { resolverCaseta, type CasetaCatalogo } from './casetas';

// ═══════════════════════════════════════════════════════════════════════════
// DETECTOR PURO DE CRUCES ATÍPICOS POR UNIDAD (T-A2-11).
//
// Tres reglas, cada una apagable. Cada hallazgo es un patrón inusual para
// revisar, NUNCA una acusación ni un cobro indebido confirmado:
//   repeticion_caseta        ≥ N cruces de la MISMA caseta (físicamente) en H horas.
//   ida_y_vuelta_madrugada   ≥ M cruces de la misma caseta entre 00:00 y 05:00 (hora MX).
//   secuencia_imposible      dos casetas con coordenadas cuya distancia / tiempo
//                            supera `velocidadMaxKmh`. Sin coordenadas en ambas
//                            casetas la regla NO se aplica y se dice en `reglasNoAplicadas`.
//
// «Misma caseta físicamente»: con catálogo, por la caseta resuelta (nombre o alias);
// sin catálogo o si no se resuelve, por el nombre normalizado.
// Los umbrales son defaults configurables, no calibrados con datos del cliente.
// Fecha y hora vienen en reloj de México; los intervalos se miden en tiempo REAL
// (el cambio de horario no inventa ni pierde horas). Orden O(n log n) por unidad;
// PURO: sin base, sin red; el orden de las filas de entrada no cambia la salida.
// ═══════════════════════════════════════════════════════════════════════════

export type ReglaAtipica = 'repeticion_caseta' | 'ida_y_vuelta_madrugada' | 'secuencia_imposible';

export interface CruceEntrada {
  /** Unidad tal como la declara el archivo (`unidad_archivo`). */
  unidad_archivo: string | null;
  caseta: string | null;
  /** AAAA-MM-DD, reloj de México. */
  fecha: string | null;
  /** HH:MM o HH:MM:SS, reloj de México. */
  hora: string | null;
  monto: number;
}

export interface ConfigAtipicos {
  repeticion_caseta: { activa: boolean; minCruces: number; ventanaHoras: number };
  ida_y_vuelta_madrugada: { activa: boolean; minCruces: number };
  secuencia_imposible: { activa: boolean; velocidadMaxKmh: number };
}

export type ConfigAtipicosParcial = {
  [K in keyof ConfigAtipicos]?: Partial<ConfigAtipicos[K]>;
};

export const CONFIG_ATIPICOS_DEFAULT: ConfigAtipicos = {
  repeticion_caseta: { activa: true, minCruces: 4, ventanaHoras: 6 },
  // Apagada por defecto: solo se enciende si finanzas lo pide.
  ida_y_vuelta_madrugada: { activa: false, minCruces: 3 },
  secuencia_imposible: { activa: true, velocidadMaxKmh: 130 },
};

export interface HallazgoAtipico {
  regla: ReglaAtipica;
  /** Determinista: la misma situación produce la misma llave (idempotencia al guardar). */
  llave: string;
  unidad: string;
  casetas: string[];
  /** Instantes reales (UTC, ISO) del primer y último cruce. */
  desde: string;
  hasta: string;
  /** Texto de reloj MX «AAAA-MM-DD HH:MM» del primer y último cruce. */
  desdeLocal: string;
  hastaLocal: string;
  nCruces: number;
  monto: number;
  quePaso: string;
  queSignifica: string;
  queHacer: string;
}

export interface ReglaNoAplicada { regla: ReglaAtipica; motivo: string }

export interface ResultadoAtipicos {
  hallazgos: HallazgoAtipico[];
  reglasNoAplicadas: ReglaNoAplicada[];
  /** Filas sin unidad, caseta, fecha u hora válidas: no se pueden ubicar en el tiempo. */
  filasOmitidas: number;
}

const AVISO = 'Patrón inusual, no necesariamente error.';
const HACER_BASE = 'Pregunta al operador; si es una salida de servicio, justifícala.';
const MIN_MS = 60_000;
const HORA_MS = 3_600_000;
const ZONA = TZ_MX;

// ── Tiempo: reloj MX → instante real ─────────────────────────────────────────
const fmtZona = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const cacheOffset = new Map<number, number>();

/** Desfase (ms) de la zona MX respecto a UTC en ese instante. Los cambios de horario caen en hora entera: se cachea por hora. */
function offsetZonaMs(utc: number): number {
  const hora = Math.floor(utc / HORA_MS);
  const hit = cacheOffset.get(hora);
  if (hit !== undefined) return hit;
  const p: Record<string, number> = {};
  for (const x of fmtZona.formatToParts(new Date(hora * HORA_MS))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - hora * HORA_MS;
  cacheOffset.set(hora, off);
  return off;
}

/** Instante UTC (ms) de una fecha/hora de reloj MX, o null si no es una fecha/hora válida. */
export function instanteMx(fecha: string | null, hora: string | null): number | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec((fecha ?? '').trim());
  // eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
  const h = /^(\d{1,2}):(\d{2}):?(\d{2})?/.exec((hora ?? '').trim());
  if (!f || !h) return null;
  const [y, mo, d, hh, mi, ss] = [Number(f[1]), Number(f[2]), Number(f[3]), Number(h[1]), Number(h[2]), Number(h[3] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  const pared = Date.UTC(y, mo - 1, d, hh, mi, ss);
  if (new Date(pared).getUTCDate() !== d) return null;
  // Dos pasadas: el offset depende del instante buscado.
  let t = pared - offsetZonaMs(pared);
  t = pared - offsetZonaMs(t);
  return t;
}

function textoLocal(fecha: string, hora: string): string {
  return `${fecha.trim()} ${hora.trim().slice(0, 5)}`;
}

// ── Preparación ──────────────────────────────────────────────────────────────
interface Cruce {
  unidad: string;
  casetaKey: string;
  casetaNombre: string;
  coord: { lat: number; lng: number } | null;
  t: number;
  fecha: string;
  hora: string;
  monto: number;
}

function cmp(a: Cruce, b: Cruce): number {
  return a.t - b.t
    || (a.casetaKey < b.casetaKey ? -1 : a.casetaKey > b.casetaKey ? 1 : 0)
    || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)
    || (a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0)
    || a.monto - b.monto;
}

const redondear = (n: number) => Math.round(n * 100) / 100;
const iso = (t: number) => new Date(t).toISOString();

function mezclar(base: ConfigAtipicos, p: ConfigAtipicosParcial): ConfigAtipicos {
  return {
    repeticion_caseta: { ...base.repeticion_caseta, ...p.repeticion_caseta },
    ida_y_vuelta_madrugada: { ...base.ida_y_vuelta_madrugada, ...p.ida_y_vuelta_madrugada },
    secuencia_imposible: { ...base.secuencia_imposible, ...p.secuencia_imposible },
  };
}

/** Texto de por qué una configuración es inválida, o null si está bien. */
/** Límites de la velocidad máxima: UNA sola fuente para la pantalla (`atipicos_config`) y el detector (A37-A2-27). */
export const VELOCIDAD_MIN_KMH = 60;
export const VELOCIDAD_MAX_KMH = 300;

export function validarConfigAtipicos(c: ConfigAtipicos): string | null {
  const r = c.repeticion_caseta;
  if (!Number.isInteger(r.minCruces) || r.minCruces < 2) return 'repeticion_caseta.minCruces debe ser un entero de 2 o más.';
  if (!(r.ventanaHoras > 0 && r.ventanaHoras <= 72)) return 'repeticion_caseta.ventanaHoras debe estar entre 0 y 72.';
  const m = c.ida_y_vuelta_madrugada;
  if (!Number.isInteger(m.minCruces) || m.minCruces < 2) return 'ida_y_vuelta_madrugada.minCruces debe ser un entero de 2 o más.';
  const s = c.secuencia_imposible;
  if (!(s.velocidadMaxKmh >= VELOCIDAD_MIN_KMH && s.velocidadMaxKmh <= VELOCIDAD_MAX_KMH)) return `secuencia_imposible.velocidadMaxKmh debe estar entre ${VELOCIDAD_MIN_KMH} y ${VELOCIDAD_MAX_KMH}.`;
  return null;
}

// ── Detector ─────────────────────────────────────────────────────────────────
export function detectarAtipicos(
  cruces: readonly CruceEntrada[],
  configParcial: ConfigAtipicosParcial = {},
  catalogo?: readonly CasetaCatalogo[],
): ResultadoAtipicos {
  const reglasNoAplicadas: ReglaNoAplicada[] = [];
  let config = mezclar(CONFIG_ATIPICOS_DEFAULT, configParcial);
  const invalida = validarConfigAtipicos(config);
  if (invalida) {
    reglasNoAplicadas.push({ regla: 'repeticion_caseta', motivo: `Configuración inválida (${invalida}): se usaron los valores de partida.` });
    config = CONFIG_ATIPICOS_DEFAULT;
  }

  const cache = new Map<string, { key: string; nombre: string; coord: { lat: number; lng: number } | null }>();
  const resolver = (crudo: string) => {
    const hit = cache.get(crudo);
    if (hit) return hit;
    let r = { key: normalizarNombre(crudo), nombre: crudo.trim(), coord: null as { lat: number; lng: number } | null };
    if (catalogo && catalogo.length > 0) {
      const res = resolverCaseta(crudo, catalogo);
      if (res.tipo === 'unica') {
        const c = res.caseta;
        r = { key: `cat:${c.id}`, nombre: c.nombre, coord: c.lat !== null && c.lng !== null && Number.isFinite(c.lat) && Number.isFinite(c.lng) ? { lat: c.lat, lng: c.lng } : null };
      }
    }
    cache.set(crudo, r);
    return r;
  };

  const porUnidad = new Map<string, Cruce[]>();
  let filasOmitidas = 0;
  for (const c of cruces) {
    const unidad = (c.unidad_archivo ?? '').trim();
    const t = instanteMx(c.fecha, c.hora);
    const crudo = (c.caseta ?? '').trim();
    if (!unidad || t === null || !crudo || !Number.isFinite(c.monto)) { filasOmitidas++; continue; }
    const r = resolver(crudo);
    if (!r.key) { filasOmitidas++; continue; }
    const a = porUnidad.get(unidad) ?? [];
    a.push({ unidad, casetaKey: r.key, casetaNombre: r.nombre, coord: r.coord, t, fecha: (c.fecha as string).trim(), hora: (c.hora as string).trim(), monto: c.monto });
    porUnidad.set(unidad, a);
  }

  const hallazgos: HallazgoAtipico[] = [];
  const nombreDe = (g: Cruce[]) => [...new Set(g.map((x) => x.casetaNombre))].sort();
  const armar = (regla: ReglaAtipica, llaveExtra: string, g: Cruce[], textos: { quePaso: string; queSignifica: string; queHacer?: string }): HallazgoAtipico => ({
    regla,
    llave: `${regla}|${g[0].unidad}|${llaveExtra}`,
    unidad: g[0].unidad,
    casetas: nombreDe(g),
    desde: iso(g[0].t),
    hasta: iso(g[g.length - 1].t),
    desdeLocal: textoLocal(g[0].fecha, g[0].hora),
    hastaLocal: textoLocal(g[g.length - 1].fecha, g[g.length - 1].hora),
    nCruces: g.length,
    monto: redondear(g.reduce((s, x) => s + x.monto, 0)),
    quePaso: textos.quePaso,
    queSignifica: `${textos.queSignifica} ${AVISO}`,
    queHacer: textos.queHacer ?? HACER_BASE,
  });

  const rep = config.repeticion_caseta;
  const mad = config.ida_y_vuelta_madrugada;
  const sec = config.secuencia_imposible;
  let paresSinCoordenadas = 0;
  let paresEvaluados = 0;
  let sinCatalogoUtil = false;

  for (const lista of porUnidad.values()) {
    lista.sort(cmp);

    const porCaseta = new Map<string, Cruce[]>();
    for (const c of lista) {
      const a = porCaseta.get(c.casetaKey) ?? [];
      a.push(c);
      porCaseta.set(c.casetaKey, a);
    }

    for (const a of porCaseta.values()) {
      // ── repeticion_caseta: ventana deslizante; las ventanas solapadas forman UN hallazgo.
      if (rep.activa) {
        const ventana = rep.ventanaHoras * HORA_MS;
        let i = 0;
        let racha: { desde: number; hasta: number } | null = null;
        const cerrar = () => {
          if (!racha) return;
          const g = a.slice(racha.desde, racha.hasta + 1);
          const horas = ((g[g.length - 1].t - g[0].t) / HORA_MS).toFixed(1);
          hallazgos.push(armar('repeticion_caseta', `${g[0].casetaKey}|${iso(g[0].t)}`, g, {
            quePaso: `${g[0].unidad} cruzó ${g[0].casetaNombre} ${g.length} veces en ${horas} horas (desde ${textoLocal(g[0].fecha, g[0].hora)}).`,
            queSignifica: 'Cruzar la misma caseta tantas veces en pocas horas es poco común: puede ser una ruta de ida y vuelta legítima, un desvío o un TAG usado por otra unidad.',
          }));
          racha = null;
        };
        for (let j = 0; j < a.length; j++) {
          while (a[j].t - a[i].t > ventana) i++;
          if (j - i + 1 >= rep.minCruces) racha = racha ? { desde: racha.desde, hasta: j } : { desde: i, hasta: j };
          else cerrar();
        }
        cerrar();
      }

      // ── ida_y_vuelta_madrugada: cruces de la misma caseta entre 00:00 y 04:59 de una misma noche.
      if (mad.activa) {
        const porNoche = new Map<string, Cruce[]>();
        for (const c of a) {
          if (Number(c.hora.slice(0, 2)) >= 5) continue;
          const k = c.fecha;
          const g = porNoche.get(k) ?? [];
          g.push(c);
          porNoche.set(k, g);
        }
        for (const [noche, g] of porNoche) {
          if (g.length < mad.minCruces) continue;
          hallazgos.push(armar('ida_y_vuelta_madrugada', `${g[0].casetaKey}|${noche}`, g, {
            quePaso: `${g[0].unidad} cruzó ${g[0].casetaNombre} ${g.length} veces de madrugada (00:00–05:00) el ${noche}.`,
            queSignifica: 'Varios cruces de la misma caseta de madrugada pueden ser un rescate o una salida de servicio, o un TAG usado por otra unidad.',
          }));
        }
      }
    }

    // ── secuencia_imposible: cruces consecutivos de la unidad en casetas distintas.
    if (sec.activa) {
      for (let i = 1; i < lista.length; i++) {
        const p = lista[i - 1];
        const q = lista[i];
        if (p.casetaKey === q.casetaKey) continue;
        if (!p.coord || !q.coord) { paresSinCoordenadas++; continue; }
        paresEvaluados++;
        const km = haversineM(p.coord, q.coord) / 1000;
        if (!Number.isFinite(km)) { paresSinCoordenadas++; continue; }
        // Mínimo de 1 min: las horas del archivo no traen segundos y evita dividir por cero.
        const minutos = Math.max((q.t - p.t) / MIN_MS, 1);
        const kmh = km / (minutos / 60);
        if (kmh > sec.velocidadMaxKmh) {
          hallazgos.push(armar('secuencia_imposible', `${p.casetaKey}>${q.casetaKey}|${iso(q.t)}`, [p, q], {
            quePaso: `${p.unidad} pasó por ${p.casetaNombre} y ${Math.round(minutos)} min después por ${q.casetaNombre}, a ${km.toFixed(0)} km en línea recta: tendría que ir a ${kmh.toFixed(0)} km/h.`,
            queSignifica: 'Una misma unidad no puede estar en dos casetas tan lejanas en tan poco tiempo: el TAG podría traerlo otro vehículo, la unidad del archivo estar mal asignada o una hora estar mal registrada.',
            queHacer: `${HACER_BASE} Si no, revisa a qué unidades corresponde ese TAG.`,
          }));
        }
      }
    }
  }

  if (sec.activa) {
    sinCatalogoUtil = !catalogo || catalogo.length === 0;
    if (sinCatalogoUtil) {
      reglasNoAplicadas.push({ regla: 'secuencia_imposible', motivo: 'catálogo sin coordenadas: no se entregó catálogo de casetas, no se puede medir la distancia entre cruces.' });
    } else if (paresSinCoordenadas > 0) {
      reglasNoAplicadas.push({
        regla: 'secuencia_imposible',
        motivo: `catálogo sin coordenadas para ${paresSinCoordenadas} par(es) de cruces consecutivos (${paresEvaluados} sí se midieron): esos pares no se evaluaron.`,
      });
    }
  }

  const rango: Record<ReglaAtipica, number> = { repeticion_caseta: 0, ida_y_vuelta_madrugada: 1, secuencia_imposible: 2 };
  hallazgos.sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0)
    || (a.unidad < b.unidad ? -1 : a.unidad > b.unidad ? 1 : 0)
    || rango[a.regla] - rango[b.regla]
    || (a.llave < b.llave ? -1 : a.llave > b.llave ? 1 : 0));
  reglasNoAplicadas.sort((a, b) => rango[a.regla] - rango[b.regla]);
  return { hallazgos, reglasNoAplicadas, filasOmitidas };
}
