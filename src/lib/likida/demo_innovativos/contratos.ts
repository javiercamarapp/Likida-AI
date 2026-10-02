// ═══════════════════════════════════════════════════════════════════════════
// DEMO INNOVATIVOS — LOS CONTRATOS DE LOS PUNTOS DE ENGANCHE.
//
// Este archivo solo trae TIPOS y constantes (sin lógica, sin base, sin red).
// Es lo que el stream de GPS (`w3-gps-jornada`), el de convenios, el de Vigía y el
// de liquidación implementan o consumen. Se dejó como contrato porque esos
// streams construyen en paralelo en otras ramas: aquí se fija la forma del dato
// y la prueba (`lector_tabla_propia.test.ts`, `archivos.test.ts`) corre contra
// dobles y contra los archivos de muestra, no contra sus módulos.
//
// ── EL LECTOR DE «TABLA PROPIA» (el contrato más importante) ────────────────
// Innovativos dijo: «tenemos en nuestras tablas las posiciones de todos los GPS
// al momento». Likida las lee con un usuario de SOLO LECTURA sobre una vista o
// réplica (nunca producción). Tres modos de entrega, el mismo contrato:
//   · sql_solo_lectura  SELECT sobre una vista que Innovativos nos habilita;
//   · csv_sftp          un CSV que ellos dejan cada N minutos;
//   · endpoint          un GET que ellos exponen.
// Las dos rarezas que el demo siembra a propósito, porque lo real las traerá:
//   1) `fecha_hora` es hora LOCAL de CDMX SIN zona (el lector la pasa a UTC);
//   2) la unidad se llama por su NÚMERO ECONÓMICO («IN-001»), no por un uuid de
//      Likida (el lector la resuelve contra `unidad.numero_economico`; si no
//      existe, la fila se CUENTA como «sin unidad», jamás se inventa una).
// ═══════════════════════════════════════════════════════════════════════════

import { TZ_MX } from '@/lib/formato';

/** La zona de «su» fecha_hora. El nombre de la zona vive solo en `formato.ts` (hay una prueba que lo exige). */
export const ZONA_INNOVATIVOS = TZ_MX;
/** Proveedor con el que quedan las posiciones en `public.posicion`. */
export const PROVEEDOR_TABLA_PROPIA = 'tabla_propia';

export type ModoTablaPropia = 'sql_solo_lectura' | 'csv_sftp' | 'endpoint';

/** Una fila de SU tabla de posiciones, ya con tipos (aún en SU zona horaria y SU nombre de unidad). */
export interface PosicionTablaPropia {
  /** Número económico tal como lo escribe su sistema (p. ej. «IN-001»). */
  unidad: string;
  lat: number;
  lon: number;
  /** «AAAA-MM-DD HH:MM:SS» en hora local de CDMX, SIN zona. */
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
  /** Vértices (el último repite al primero en WKT; aquí ya sin repetir). Solo si tipo = poligono. */
  poligono: Array<{ lat: number; lon: number }> | null;
  cliente: string | null;
}

export interface FilaRechazada { fila: number; motivo: string }
export interface ResultadoLectura<T> { filas: T[]; rechazadas: FilaRechazada[] }

export interface OpcionesLecturaPosiciones {
  /** Solo posiciones con fecha_hora local ≥ esta (UTC); para leer incrementalmente. */
  desdeUtc?: Date;
  /** Si se da, solo estas unidades (números económicos). */
  unidades?: readonly string[];
}

/**
 * EL PUNTO DE ENGANCHE. Quien construya el lector real (SQL, SFTP o endpoint)
 * implementa esto; el resto del producto (conciliación del Conductor, cruce de
 * peajes, mapa) solo conoce la interfaz.
 */
export interface LectorTablaPropia {
  readonly modo: ModoTablaPropia;
  leerPosiciones(opciones?: OpcionesLecturaPosiciones): Promise<ResultadoLectura<PosicionTablaPropia>>;
  leerGeocercas(): Promise<ResultadoLectura<GeocercaTablaPropia>>;
}

/** Lo que se escribe en `public.posicion` (ya en UTC y con el uuid de la unidad). */
export interface PosicionLikida {
  unidadId: string;
  lat: number;
  lng: number;
  velocidad: number | null;
  ignicion: boolean | null;
  /** ISO 8601 UTC. */
  medidaEn: string;
  proveedor: typeof PROVEEDOR_TABLA_PROPIA;
}

// ── El resto de los importadores del kit (ver docs/demo/innovativos.md) ─────

/** Un importador del kit: recibe los bytes del archivo del cliente y dice qué pasó. */
export interface ImportadorKit<R> {
  importar(archivo: { nombre: string; bytes: Uint8Array }): Promise<R>;
}

/** Convenios + instrucciones de operación («calle de instrucciones»). Lo implementa w3-convenios (0580). */
export interface FilaConvenioCsv {
  clave: string;
  cliente: string;
  convenio: string;
  origen: string;
  destino: string;
  categoria: CategoriaInstruccion;
  momento: MomentoInstruccion;
  orden: number;
  texto: string;
  tarifaModo: 'por_viaje' | 'por_km' | 'por_tonelada' | null;
  tarifaPrecio: number | null;
  requisitosCobro: string[];
}
/** Dominios cerrados de la 0580 (convenio_instruccion). Si la 0580 los cambia, la prueba de archivos lo delata. */
export const CATEGORIAS_INSTRUCCION = ['puerta', 'reportarse', 'peculiaridad', 'documentos', 'horario', 'seguridad', 'otro'] as const;
export type CategoriaInstruccion = (typeof CATEGORIAS_INSTRUCCION)[number];
export const MOMENTOS_INSTRUCCION = ['despacho', 'acercamiento', 'ambos'] as const;
export type MomentoInstruccion = (typeof MOMENTOS_INSTRUCCION)[number];
export const MAX_TEXTO_INSTRUCCION = 400;

/** Los 9 tipos de archivo que Innovativos entrega y que el kit sabe validar. `tags` y `casetas` acompañan a `pases`: sin ellos no hay cruce con GPS. */
export const TIPOS_ARCHIVO_KIT = ['gps_posiciones', 'geocercas', 'pases', 'tags', 'casetas', 'liquidaciones', 'convenios', 'whatsapp', 'carta_porte'] as const;
export type TipoArchivoKit = (typeof TIPOS_ARCHIVO_KIT)[number];
