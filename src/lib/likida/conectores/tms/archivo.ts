// ═══════════════════════════════════════════════════════════════════════════
// PLAN B DEL CONECTOR TMS (T-TMS-13): importar las EXPORTACIONES del cliente (CSV / JSON) con los MISMOS mapeos y
// los MISMOS lectores que la API. No hay un segundo camino de interpretación: el archivo se convierte en filas
// crudas y se sirve, página por página, desde un `Http` en memoria; los lectores existentes (`leerViajes`,
// `leerPeajes`, `leerLiquidaciones`, `leerPosiciones`) lo consumen como si fuera el origen. Así el resultado por
// archivo es, por construcción, el mismo que por API (hay una prueba de equivalencia).
//
// Lo que sí resuelve este archivo (y solo esto): decodificar (UTF-8 con o sin BOM, o Windows-1252), detectar el
// separador (`,` `;` tab `|`, mirando solo el encabezado: lo hace `peajes/csv.ts`, que además NO convierte
// «189,50» en 18950), formar filas por nombre de columna, localizar la lista en un JSON anidado con la `raiz`
// del mapeo y rechazar con motivo las filas corruptas. Decimales con coma y fechas dd/MM los resuelve el mapeo
// (`aNumero`, `fecha_local` con `formato`), igual que para la API.
//
// SOLO LEE y no escribe en la base ni toca archivos de A1/A2. Importar un archivo REAL del cliente se hace solo en
// local (T-DEM-04): nada de datos reales entra al repo; las pruebas usan datos sintéticos.
// ═══════════════════════════════════════════════════════════════════════════
import { decodificarTexto, matrizDeCsvTexto } from '../../peajes/csv';
import type { Http, PeticionHttp, RespuestaHttp } from '../tipos';
import { aFechaLocal, aplicarMapeo, leerRuta, MAX_FILAS, validarMapeo, type MapeoTms, type ResultadoMapeo } from './mapeo';
import { SesionTms } from './sesion';
import { ZONA_POR_OMISION } from '../tabla_propia/tiempo';
import type { FilaRechazadaTms } from './tipos';

export type FormatoExportacion = 'csv' | 'json';
export type FilaCruda = Record<string, unknown>;

/** Tamaño máximo del archivo que se acepta (evita agotar memoria con un archivo equivocado). */
export const MAX_BYTES_EXPORTACION = 25 * 1024 * 1024;

export interface ExportacionLeida {
  /** Filas crudas, en el orden del archivo, ya con nombre de columna. */
  filas: FilaCruda[];
  /** Filas que no se pudieron formar (corruptas); `indice` = posición base 0 entre las filas de datos del archivo. */
  rechazadas: FilaRechazadaTms[];
  avisos: string[];
  /** Problema global: el archivo no se pudo interpretar y no hay filas. */
  error?: string;
}

const vacia = (error: string): ExportacionLeida => ({ filas: [], rechazadas: [], avisos: [], error });

/** CSV → filas por nombre de columna. Una fila con distinto número de celdas que el encabezado es corrupta. */
function filasDeCsv(texto: string): ExportacionLeida {
  const matriz = matrizDeCsvTexto(texto);
  const iEnc = matriz.findIndex((f) => f.some((c) => String(c).trim() !== ''));
  if (iEnc < 0) return vacia('el archivo CSV está vacío');
  const encabezado = matriz[iEnc].map((c) => String(c).trim());
  if (encabezado.some((c) => c === '')) return vacia('el encabezado del CSV tiene una columna sin nombre');
  const avisos: string[] = [];
  const repetidas = encabezado.filter((c, i) => encabezado.indexOf(c) !== i);
  if (repetidas.length > 0) avisos.push(`El encabezado repite la columna «${repetidas[0].slice(0, 30)}»; se usa la primera.`);
  const filas: FilaCruda[] = [];
  const rechazadas: FilaRechazadaTms[] = [];
  let indice = 0;
  for (const celdas of matriz.slice(iEnc + 1)) {
    if (celdas.every((c) => String(c).trim() === '')) continue; // renglón en blanco
    const i = indice; indice += 1;
    // Celdas vacías de más al final (Excel las agrega) no cuentan como corrupción.
    let usadas = celdas.length;
    while (usadas > encabezado.length && String(celdas[usadas - 1]).trim() === '') usadas -= 1;
    if (usadas !== encabezado.length) {
      rechazadas.push({ indice: i, motivo: `la fila trae ${usadas} columnas y el encabezado ${encabezado.length}` });
      continue;
    }
    const fila: FilaCruda = {};
    encabezado.forEach((nombre, k) => { if (!(nombre in fila)) fila[nombre] = String(celdas[k]).trim(); });
    filas.push(fila);
  }
  if (filas.length + rechazadas.length > MAX_FILAS * 20) return vacia(`el archivo trae demasiadas filas (máximo ${MAX_FILAS * 20})`);
  return { filas, rechazadas, avisos };
}

/** JSON (arreglo en la raíz, o anidado hasta `raiz` del mapeo) → filas. Las filas que no son objeto las rechaza el mapeo. */
function filasDeJson(texto: string, raiz: string): ExportacionLeida {
  let json: unknown;
  try { json = JSON.parse(texto); } catch { return vacia('el archivo JSON no se puede leer (formato inválido)'); }
  let lista: unknown = json;
  if (!Array.isArray(lista)) {
    lista = raiz === '' ? undefined : leerRuta(json, raiz);
    if (lista === undefined) return vacia(raiz === '' ? 'el JSON no es una lista de filas' : `el JSON no trae la lista en «${raiz}»`);
  }
  if (!Array.isArray(lista)) return vacia(`«${raiz || 'el JSON'}» no es una lista`);
  return { filas: lista as FilaCruda[], rechazadas: [], avisos: [] };
}

/** Archivo → filas crudas. Nunca lanza por datos malos. */
export function leerFilasExportacion(buffer: Uint8Array, formato: FormatoExportacion, raiz = ''): ExportacionLeida {
  if (buffer.byteLength === 0) return vacia('el archivo está vacío');
  if (buffer.byteLength > MAX_BYTES_EXPORTACION) return vacia(`el archivo pesa más de ${MAX_BYTES_EXPORTACION / 1024 / 1024} MB`);
  const texto = decodificarTexto(buffer);
  if (formato === 'csv') return filasDeCsv(texto);
  if (formato === 'json') return filasDeJson(texto, raiz);
  return vacia('formato no soportado (use csv o json)');
}

/**
 * `leerExportacion(buffer, formato, mapeo)`: el archivo pasado por el mismo `aplicarMapeo` que las respuestas de la
 * API. Devuelve las mismas estructuras (`filas` con `clave`, `rechazadas` con motivo, `error` global), con las filas
 * corruptas del archivo incluidas entre las rechazadas.
 */
export function leerExportacion<T = Record<string, unknown>>(
  buffer: Uint8Array, formato: FormatoExportacion, mapeo: MapeoTms,
): ResultadoMapeo<T> & { avisos: string[] } {
  const problemas = validarMapeo(mapeo);
  if (problemas.length > 0) return { filas: [], rechazadas: [], avisos: [], error: `mapeo inválido: ${problemas[0]}` };
  const a = leerFilasExportacion(buffer, formato, mapeo.raiz);
  if (a.error) return { filas: [], rechazadas: a.rechazadas, avisos: a.avisos, error: a.error };
  const m = aplicarMapeo<T>(mapeo, envolver(a.filas, mapeo.raiz));
  return { ...m, rechazadas: [...a.rechazadas, ...m.rechazadas], avisos: a.avisos };
}

// ── Servidor en memoria: el archivo hace de origen para los lectores ─────────────────────────────

/** Una exportación asociada al mapeo (y por tanto a la ruta) que la API habría servido. */
export interface EntradaExportacion {
  mapeo: MapeoTms;
  buffer: Uint8Array;
  formato: FormatoExportacion;
}

export interface ExportacionesTms {
  /** Sesión lista para pasar a `leerViajes`, `leerPeajes`, `leerLiquidaciones` o `leerPosiciones`. */
  sesion: SesionTms;
  /** Filas corruptas de los archivos y problemas globales, por ruta. Los lectores no las ven: se informan aquí. */
  rechazadas: Array<{ ruta: string; indice: number; motivo: string }>;
  avisos: string[];
}

const BASE = 'https://exportacion.local';
const LOGIN = { ruta: '/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' };
const json = (estado: number, cuerpo: unknown): RespuestaHttp => ({ estado, encabezados: { 'content-type': 'application/json' }, cuerpo: JSON.stringify(cuerpo) });

/** Pone la lista bajo la ruta `raiz` («data.items») como la daría la API. Raíces con índices no se soportan (mapeo.raiz las acepta en la lectura, no aquí). */
function envolver(filas: unknown[], raiz: string): unknown {
  if (raiz === '') return filas;
  const partes = raiz.split('.');
  let cuerpo: unknown = filas;
  for (let i = partes.length - 1; i >= 0; i -= 1) cuerpo = { [partes[i]]: cuerpo };
  return cuerpo;
}

/** `desde`/`hasta` llegan en ISO UTC o como «AAAA-MM-DD HH:mm:ss» (UTC): ambas se leen como UTC. */
const aMs = (v: string): number => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : (v.includes('T') ? v : v.replace(' ', 'T')) + 'Z');

/** El campo por el que se acota la ventana: el primer campo de fecha obligatorio del mapeo (en el orden del mapeo). */
function campoDeVentana(mapeo: MapeoTms): { fuente: string; formato?: string; zona: string } | undefined {
  for (const [dest, spec] of Object.entries(mapeo.campos)) {
    if (typeof spec === 'object' && spec.transformar === 'fecha_local' && mapeo.obligatorios.includes(dest)) {
      return { fuente: spec.fuente, formato: spec.formato, zona: spec.zona ?? ZONA_POR_OMISION };
    }
  }
  return undefined;
}

/**
 * Convierte las exportaciones en una `SesionTms` que responde como la API: login con token ficticio, paginación por
 * `params.pagina`/`params.tam` y ventana `desde`/`hasta` aplicada al campo de fecha obligatorio del mapeo (las
 * tablas sin fecha, como catálogos, se entregan completas). Un archivo ilegible responde 200 con la lista vacía y
 * queda anotado en `rechazadas`.
 */
export function sesionDeExportaciones(entradas: readonly EntradaExportacion[]): ExportacionesTms {
  const rechazadas: ExportacionesTms['rechazadas'] = [];
  const avisos: string[] = [];
  const porRuta = new Map<string, { mapeo: MapeoTms; filas: FilaCruda[] }>();
  for (const e of entradas) {
    const a = leerFilasExportacion(e.buffer, e.formato, e.mapeo.raiz);
    for (const r of a.rechazadas) rechazadas.push({ ruta: e.mapeo.ruta, ...r });
    for (const v of a.avisos) avisos.push(`${e.mapeo.ruta}: ${v}`);
    if (a.error) rechazadas.push({ ruta: e.mapeo.ruta, indice: -1, motivo: a.error });
    if (porRuta.has(e.mapeo.ruta)) avisos.push(`${e.mapeo.ruta}: hay dos exportaciones para la misma ruta; se usa la última.`);
    porRuta.set(e.mapeo.ruta, { mapeo: e.mapeo, filas: a.filas });
  }

  const http: Http = async (p: PeticionHttp) => {
    const u = new URL(p.url);
    if (p.metodo === 'POST' && u.pathname === LOGIN.ruta) return json(200, { token: 'token-de-exportacion' });
    const t = porRuta.get(u.pathname);
    if (!t) return json(404, { error: 'ruta sin exportación' });
    const { mapeo } = t;
    // Con POST el lector manda los parámetros en el cuerpo.
    const q = new Map<string, string>(u.searchParams);
    if (p.metodo === 'POST' && p.cuerpo) {
      try { for (const [k, v] of Object.entries(JSON.parse(p.cuerpo) as Record<string, unknown>)) if (v !== undefined) q.set(k, String(v)); } catch { /* sin cuerpo útil */ }
    }
    let filas = t.filas;
    const campo = campoDeVentana(mapeo);
    const desde = q.get(mapeo.params.desde); const hasta = q.get(mapeo.params.hasta);
    if (campo && desde !== undefined && hasta !== undefined) {
      const d = aMs(desde); const h = aMs(hasta);
      filas = filas.filter((f) => {
        const r = aFechaLocal(f[campo.fuente], campo.formato, campo.zona);
        if ('error' in r) return true; // fecha ilegible: la rechaza el mapeo con su motivo, no se oculta aquí
        const ms = Date.parse(String(r.ok));
        return ms >= d && ms <= h;
      });
    }
    if (mapeo.params.pagina !== undefined) {
      const tam = Math.max(1, Number(q.get(mapeo.params.tam ?? 'tam') ?? 100) || 100);
      const pagina = Math.max(1, Number(q.get(mapeo.params.pagina)) || 1);
      filas = filas.slice((pagina - 1) * tam, pagina * tam);
    }
    return json(200, envolver(filas, mapeo.raiz));
  };

  const sesion = new SesionTms({
    http, base: BASE, login: LOGIN, credenciales: { usuario: 'exportacion', clave: 'exportacion' },
    reloj: { ahora: () => 0, dormir: async () => undefined },
  });
  return { sesion, rechazadas, avisos };
}
