// ═══════════════════════════════════════════════════════════════════════════
// EL CONTRATO DEL LECTOR DE «TABLA PROPIA» — la forma del dato.
//
// Una flota que ya guarda las posiciones de todos sus GPS en sus propias tablas
// no necesita que le vendamos un proveedor: Likida las LEE (solo lectura) y las
// asienta por el MISMO asentador que Samsara/Wialon/push (`asentarLecturas`),
// de modo que el Conductor, los Peajes, el mapa y la jornada consumen lo mismo.
//
// ALINEACIÓN CON EL DEMO. Estos tipos son ESTRUCTURALMENTE IDÉNTICOS a los de
// `demo_<cliente>/contratos.ts` de la rama `loop/w3-demo` (PosicionTablaPropia,
// GeocercaTablaPropia, FilaRechazada, ResultadoLectura, OpcionesLecturaPaginada,
// LectorTablaPropia, ModoTablaPropia). TypeScript es estructural: una clase de
// aquí satisface `LectorTablaPropia` del demo y viceversa, sin importar entre
// ramas. Al integrar, el demo puede reexportar de este archivo y borrar su copia
// (o dejarla: no hay conflicto de nombres porque viven en módulos distintos).
// Lo que este módulo agrega y el demo no necesita: la zona horaria configurable
// por flota (el demo fija CDMX) y los tres modos con su validación y seguridad.
// ═══════════════════════════════════════════════════════════════════════════

/** Proveedor con el que quedan las posiciones en `public.posicion` y id del conector. */
export const PROVEEDOR_TABLA_PROPIA = 'tabla_propia';

export type ModoTablaPropia = 'sql_solo_lectura' | 'csv_sftp' | 'endpoint';
export const MODOS_TABLA_PROPIA: readonly ModoTablaPropia[] = ['sql_solo_lectura', 'csv_sftp', 'endpoint'];

/** Una fila de SU tabla de posiciones, ya con tipos (en SU zona y con SU nombre de unidad). */
export interface PosicionTablaPropia {
  /** Número económico tal como lo escribe su sistema (p. ej. «IN-001»). */
  unidad: string;
  lat: number;
  lon: number;
  /** «AAAA-MM-DD HH:MM:SS» en la hora local de la zona configurada, SIN zona. */
  fechaHoraLocal: string;
  velocidadKmh: number | null;
  ignicion: boolean | null;
}

/** Una geocerca de SU sistema: círculo (centro + radio) o polígono. */
export interface GeocercaTablaPropia {
  codigo: string;
  nombre: string;
  tipo: 'circulo' | 'poligono';
  centro: { lat: number; lon: number } | null;
  radioM: number | null;
  /** Vértices sin repetir el primero. Solo si tipo = poligono. */
  poligono: Array<{ lat: number; lon: number }> | null;
  cliente: string | null;
}

export interface FilaRechazada { fila: number; motivo: string }
export interface ResultadoLectura<T> { filas: T[]; rechazadas: FilaRechazada[] }

export interface OpcionesLecturaPosiciones {
  /** Solo posiciones con fecha ≥ esta (UTC): lectura incremental. */
  desdeUtc?: Date;
  /** Si se da, solo estas unidades (números económicos). */
  unidades?: readonly string[];
}

/** EL PUNTO DE ENGANCHE. El resto del producto solo conoce esta interfaz. */
export interface LectorTablaPropia {
  readonly modo: ModoTablaPropia;
  leerPosiciones(opciones?: OpcionesLecturaPosiciones): Promise<ResultadoLectura<PosicionTablaPropia>>;
  leerGeocercas(): Promise<ResultadoLectura<GeocercaTablaPropia>>;
}

/**
 * POR QUÉ falló una lectura (igual que `FallaLectura` de los lectores de proveedor,
 * para que el backoff de la 0500 funcione sin traducción):
 *  · credencial — usuario/clave/token rechazado;
 *  · proveedor  — su base/endpoint no contestó o tardó (transitorio);
 *  · formato    — contestó algo que no es lo configurado (vista sin la columna,
 *    columnas ilegibles, CSV sin encabezados): hay que corregir el mapeo.
 */
export type FallaTablaPropia = 'credencial' | 'proveedor' | 'formato';

/** Un lector que no puede leer lanza esto: lleva la clase de falla y un motivo apto para el panel. */
export class ErrorTablaPropia extends Error {
  constructor(message: string, readonly falla: FallaTablaPropia, readonly backlog = false) {
    super(message);
    this.name = 'ErrorTablaPropia';
  }
}
