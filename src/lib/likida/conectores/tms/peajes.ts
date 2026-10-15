// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE PEAJES POR FECHAS del conector TMS (T-TMS-08). SOLO LEE: no escribe en la base ni toca los
// archivos de A2 (`peajes/*`, `intake/desglose_peaje.ts`); entrega filas con la forma que A2 consume
// (tag, unidad = número económico, caseta, clase, importe, fecha + hora local) y la marca `origen:'tms'`.
//
// Requisito (crudo 33c4d51b 21:58): un API «a petición» donde se mandan unas fechas y el sistema regresa los
// peajes. NO se mezcla con la fuente IAVE: el reporte decenal (Excel) sigue siendo la entrada de A2; estas filas
// son una fuente aparte y por eso llevan `origen:'tms'`.
//
// SUPUESTO (BLOQUEO EXTERNO: la documentación del endpoint «por fechas» no existe aún): ruta, nombres de
// columna y formato de fecha viven en `mapeos/peajes.supuesto.json`. Zona de las fechas sin zona: la del mapeo
// (America/Mexico_City por decisión vigente); el instante se guarda en UTC (`cruce_en`) y se expone también el
// día y la hora LOCALES (`fecha`, `hora`) porque así los consume A2.
//
// Reglas: la ventana se parte en trozos de 10 días (el periodo del reporte); una fila sin caseta, unidad,
// importe o fecha se rechaza con motivo; un importe no positivo también; las filas repetidas (mismo cruce visto
// en el borde de dos trozos) se cuentan y se dejan una sola vez. Nada se descarta en silencio.
// ═══════════════════════════════════════════════════════════════════════════
import { utcALocal, ZONA_POR_OMISION } from '../tabla_propia/tiempo';
import { huella } from './huella';
import mapeoSupuesto from './mapeos/peajes.supuesto.json';
import type { MapeoTms } from './mapeo';
import { paginar, type OpcionesPaginar, type PuntoReanudo } from './paginar';
import type { SesionTms } from './sesion';
import type { FilaRechazadaTms, LectorTms, LecturaTms } from './tipos';

export const MAPEO_PEAJES_SUPUESTO = mapeoSupuesto as unknown as MapeoTms;

/** Largo de cada trozo de la ventana, en días (el periodo del reporte de peajes). */
export const DIAS_POR_TROZO = 10;
const DIA_MS = 86_400_000;

export interface FilaPeajeTms {
  origen: 'tms';
  /** TAG del cruce; `null` si el origen no lo trae. */
  tag: string | null;
  /** Número económico de la unidad. */
  unidad: string;
  caseta: string;
  clase: string | null;
  /** Pesos, redondeado a centavos. */
  importe: number;
  /** Instante del cruce, UTC ISO con segundos. */
  cruce_en: string;
  /** Día local del cruce, AAAA-MM-DD (zona del mapeo). */
  fecha: string;
  /** Hora local del cruce, HH:MM:SS (zona del mapeo). */
  hora: string;
  /** `Icident` del viaje si el origen lo trae; `null` si no (el cruce→viaje lo resuelve A2). */
  despacho_ref: string | null;
  /** Clave externa de idempotencia (la del mapeo). */
  clave: string;
  /** Huella de los campos estables; con `clave` decide nueva/omitida/actualizada (ver `estadoDeFila`). */
  huella: string;
}

export interface TrozoVentana { desde: string; hasta: string }

/** Punto donde seguir: trozo pendiente (su `desde` ISO UTC) y, dentro de él, el punto de paginación. */
export interface ReanudarPeajes { desde: string; punto?: PuntoReanudo }

export interface LecturaPeajes {
  filas: FilaPeajeTms[];
  rechazadas: FilaRechazadaTms[];
  /** Cruces repetidos entre trozos contiguos (borde inclusivo del origen) que se dejaron una sola vez. */
  duplicadas: number;
  /** Trozos de 10 días pedidos al origen en ESTA corrida. */
  trozos: number;
  avisos: string[];
  completa: boolean;
  backlog: boolean;
  reanudar?: ReanudarPeajes;
}

export type ResultadoPeajes =
  | ({ ok: true } & LecturaPeajes)
  | { ok: false; motivo: string; parcial: LecturaPeajes };

export interface OpcionesPeajes extends OpcionesPaginar {
  /** Mapeo del tenant; por omisión el supuesto. */
  mapeo?: MapeoTms;
}

interface Cruda {
  tag?: string; unidad: string; caseta: string; clase?: string; importe: number; cruce_en: string; despacho_ref?: string;
}

/** Parte [desde, hasta] en trozos contiguos de `DIAS_POR_TROZO` días (el último, más corto). Fechas ISO UTC. */
export function partirVentana(desde: string, hasta: string, dias: number = DIAS_POR_TROZO): TrozoVentana[] | string {
  const a = Date.parse(desde); const b = Date.parse(hasta);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'la ventana de fechas no es válida';
  if (b < a) return 'la ventana de fechas termina antes de empezar';
  const paso = dias * DIA_MS;
  const trozos: TrozoVentana[] = [];
  for (let ini = a; ; ini += paso) {
    const fin = Math.min(ini + paso, b);
    trozos.push({ desde: new Date(ini).toISOString(), hasta: new Date(fin).toISOString() });
    if (fin >= b) break;
  }
  return trozos;
}

function zonaDe(mapeo: MapeoTms): string {
  const c = mapeo.campos.cruce_en;
  return (typeof c === 'object' && c.zona) || ZONA_POR_OMISION;
}

/** Lee los peajes de la ventana [desde, hasta] (ISO UTC) por trozos de 10 días. No escribe nada. */
export async function leerPeajes(
  sesion: SesionTms, ventana: { desde: string; hasta: string; reanudar?: ReanudarPeajes }, opciones: OpcionesPeajes = {},
): Promise<ResultadoPeajes> {
  const mapeo = opciones.mapeo ?? MAPEO_PEAJES_SUPUESTO;
  const zona = zonaDe(mapeo);
  const filas: FilaPeajeTms[] = [];
  const rechazadas: FilaRechazadaTms[] = [];
  const avisos: string[] = [];
  const claves = new Set<string>();
  let duplicadas = 0; let trozosPedidos = 0;
  const foto = (extra: Partial<LecturaPeajes> = {}): LecturaPeajes =>
    ({ filas, rechazadas, duplicadas, trozos: trozosPedidos, avisos, completa: false, backlog: false, ...extra });

  const trozos = partirVentana(ventana.desde, ventana.hasta);
  if (typeof trozos === 'string') return { ok: false, motivo: trozos, parcial: foto() };
  let primero = 0;
  if (ventana.reanudar) {
    primero = trozos.findIndex((t) => t.desde === ventana.reanudar?.desde);
    if (primero < 0) return { ok: false, motivo: 'el punto de reanudación no corresponde a esta ventana de fechas', parcial: foto() };
  }

  for (let i = primero; i < trozos.length; i += 1) {
    const t = trozos[i];
    const punto = i === primero ? ventana.reanudar?.punto : undefined;
    const r = await paginar<Cruda>(sesion, mapeo, { desde: t.desde, hasta: t.hasta, reanudar: punto }, opciones);
    trozosPedidos += 1;
    const base = r.ok ? r : r.parcial;
    for (const x of base.rechazadas) rechazadas.push({ indice: x.indice, motivo: `trozo ${t.desde.slice(0, 10)}: ${x.motivo}` });
    for (const a of base.avisos) avisos.push(`trozo ${t.desde.slice(0, 10)}: ${a}`);

    for (const m of base.filas) {
      const c = m.fila;
      if (!(c.importe > 0)) { rechazadas.push({ indice: m.indice, motivo: 'el importe del peaje no es positivo' }); continue; }
      if (claves.has(m.clave)) { duplicadas += 1; continue; }
      claves.add(m.clave);
      const importe = Math.round(c.importe * 100) / 100;
      const local = utcALocal(new Date(c.cruce_en), zona);
      const tag = c.tag ?? null; const clase = c.clase ?? null;
      filas.push({
        origen: 'tms', tag, unidad: c.unidad, caseta: c.caseta, clase, importe,
        cruce_en: c.cruce_en, fecha: local.slice(0, 10), hora: local.slice(11, 19),
        despacho_ref: c.despacho_ref ?? null, clave: m.clave,
        huella: huella('peajes', m.clave, { tag, unidad: c.unidad, caseta: c.caseta, clase, importe, cruce_en: c.cruce_en }),
      });
    }

    if (!r.ok) {
      return { ok: false, motivo: r.motivo, parcial: foto({ backlog: r.backlog === true, reanudar: { desde: t.desde, punto: r.parcial.reanudar } }) };
    }
    if (r.backlog) return { ok: true, ...foto({ backlog: true, reanudar: { desde: t.desde, punto: r.reanudar } }) };
    if (!r.completa) {
      // El origen se cerró en círculo en este trozo: no se salta a otro como si nada.
      return { ok: true, ...foto({ completa: false }) };
    }
  }
  return { ok: true, ...foto({ completa: true }) };
}

/** Adaptador al contrato `LectorTms`: lanza si la lectura falla (el sincronizador usa `leerPeajes` y conserva el parcial). */
export function lectorPeajes(sesion: SesionTms, opciones: OpcionesPeajes = {}): LectorTms<FilaPeajeTms> {
  return {
    recurso: 'peajes',
    async leer(desde, hasta): Promise<LecturaTms<FilaPeajeTms>> {
      const r = await leerPeajes(sesion, { desde, hasta }, opciones);
      if (!r.ok) throw new Error(r.motivo);
      return { filas: r.filas, rechazadas: r.rechazadas };
    },
  };
}
