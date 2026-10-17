// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE VIAJES E HITOS del conector TMS (T-TMS-09). SOLO LEE: no escribe en la base (eso lo hace el
// sincronizador con `importarViajes`, T-TMS-12) y no toca `aceptado_en` (campo y compuerta de A5).
//
// Entrega, por viaje, la forma de `FilaViajeImportada` más `despacho_ref` (el `Icident` del origen, que liga
// el viaje con sus posiciones y peajes) y los hitos `salida_en` / `llegada_en` (UTC, con segundos).
//
// SUPUESTO (BLOQUEO EXTERNO: los endpoints de viajes/hitos NO están acordados con el área de sistemas del
// cliente): ruta, nombres de columna y formato de fecha viven en `mapeos/viajes.supuesto.json`. El crudo solo
// confirma que existen «Fecha Salida/Llegada» con segundos y un campo `Icident`. La zona horaria de las fechas
// sin zona la declara el mapeo (por omisión, la de la plataforma).
//
// Reglas: un viaje sin unidad o sin salida se rechaza con motivo; uno cancelado se ignora (se cuenta, no se
// importa); un `Icident` repetido en dos viajes distintos se lee pero se ADVIERTE (el dedup de importación es
// por folio: el segundo no entraría). Nada se descarta en silencio.
// ═══════════════════════════════════════════════════════════════════════════
import type { FilaViajeImportada } from '../../importar_viajes';
import { utcALocal, ZONA_POR_OMISION } from '../tabla_propia/tiempo';
import mapeoSupuesto from './mapeos/viajes.supuesto.json';
import type { MapeoTms } from './mapeo';
import { paginar, type OpcionesPaginar, type PuntoReanudo } from './paginar';
import type { SesionTms } from './sesion';
import type { FilaRechazadaTms, LectorTms, LecturaTms } from './tipos';

export const MAPEO_VIAJES_SUPUESTO = mapeoSupuesto as unknown as MapeoTms;

export interface FilaViajeTms extends FilaViajeImportada {
  /** `Icident` del origen: liga el viaje con posiciones y peajes. */
  despacho_ref: string;
  /** Hito de salida, instante UTC ISO (con segundos). */
  salida_en: string;
  /** Hito de llegada, UTC ISO; `null` si el viaje sigue en curso. */
  llegada_en: string | null;
}

export interface LecturaViajes {
  filas: FilaViajeTms[];
  rechazadas: FilaRechazadaTms[];
  /** Viajes cancelados que se ignoraron. */
  canceladas: number;
  /** Avisos de datos dudosos (p. ej. `Icident` repetido). */
  advertencias: string[];
  /** Avisos de la paginación (tope, cursor repetido…). */
  avisos: string[];
  completa: boolean;
  backlog: boolean;
  reanudar?: PuntoReanudo;
}

export type ResultadoViajes =
  | ({ ok: true } & LecturaViajes)
  | { ok: false; motivo: string; parcial: LecturaViajes };

export interface OpcionesViajes extends OpcionesPaginar {
  /** Mapeo del tenant; por omisión el supuesto. */
  mapeo?: MapeoTms;
  /** Valores de `estatus` (sin mayúsculas ni acentos) que significan «cancelado». */
  estatusCancelado?: readonly string[];
}

const CANCELADO_POR_OMISION = ['cancelado', 'cancelada', 'cancelled', 'anulado', 'anulada'];
const sinAcentos = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

interface Cruda {
  folio: string; despacho_ref: string; unidadEco: string; salida_en: string; llegada_en?: string;
  origen?: string; destino?: string; estatus?: string;
}

function zonaDe(mapeo: MapeoTms): string {
  const c = mapeo.campos.salida_en;
  return (typeof c === 'object' && c.zona) || ZONA_POR_OMISION;
}

/** Lee los viajes de la ventana [desde, hasta] (ISO UTC). No escribe nada. */
export async function leerViajes(
  sesion: SesionTms, ventana: { desde: string; hasta: string; reanudar?: PuntoReanudo }, opciones: OpcionesViajes = {},
): Promise<ResultadoViajes> {
  const mapeo = opciones.mapeo ?? MAPEO_VIAJES_SUPUESTO;
  const zona = zonaDe(mapeo);
  const cancelados = new Set((opciones.estatusCancelado ?? CANCELADO_POR_OMISION).map(sinAcentos));
  const r = await paginar<Cruda>(sesion, mapeo, ventana, opciones);
  const base = r.ok ? r : r.parcial;

  const filas: FilaViajeTms[] = [];
  const rechazadas: FilaRechazadaTms[] = [...base.rechazadas];
  const advertencias: string[] = [];
  let canceladas = 0;
  const porRef = new Map<string, number>();

  for (const m of base.filas) {
    const c = m.fila;
    if (c.estatus !== undefined && cancelados.has(sinAcentos(c.estatus))) { canceladas += 1; continue; }
    if (c.unidadEco.trim() === '') { rechazadas.push({ indice: m.indice, motivo: 'el viaje no trae unidad' }); continue; }
    if (c.llegada_en !== undefined && Date.parse(c.llegada_en) < Date.parse(c.salida_en)) {
      rechazadas.push({ indice: m.indice, motivo: 'la llegada es anterior a la salida' }); continue;
    }
    porRef.set(c.despacho_ref, (porRef.get(c.despacho_ref) ?? 0) + 1);
    filas.push({
      folio: c.folio, origen: c.origen ?? null, destino: c.destino ?? null,
      fechaInicio: utcALocal(new Date(c.salida_en), zona).slice(0, 10),
      anticipo: null, operadorNombre: null, unidadEco: c.unidadEco, clienteNombre: null, ingresoFlete: null, kmRecorridos: null,
      despacho_ref: c.despacho_ref, salida_en: c.salida_en, llegada_en: c.llegada_en ?? null,
    });
  }
  for (const [ref, n] of porRef) {
    if (n > 1) advertencias.push(`El Icident «${ref}» aparece en ${n} viajes distintos; solo el primero entraría al importar (el folio es único).`);
  }

  const lectura: LecturaViajes = {
    filas, rechazadas, canceladas, advertencias, avisos: base.avisos,
    completa: base.completa, backlog: base.backlog, reanudar: base.reanudar,
  };
  return r.ok ? { ok: true, ...lectura } : { ok: false, motivo: r.motivo, parcial: lectura };
}

/** Adaptador al contrato `LectorTms`: lanza si la lectura falla (el sincronizador usa `leerViajes` y conserva el parcial). */
export function lectorViajes(sesion: SesionTms, opciones: OpcionesViajes = {}): LectorTms<FilaViajeTms> {
  return {
    recurso: 'viajes',
    async leer(desde, hasta): Promise<LecturaTms<FilaViajeTms>> {
      const r = await leerViajes(sesion, { desde, hasta }, opciones);
      if (!r.ok) throw new Error(r.motivo);
      return { filas: r.filas, rechazadas: r.rechazadas };
    },
  };
}
