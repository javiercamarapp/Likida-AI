import { TZ_MX, diaEnZona } from '@/lib/formato';
import type { Servicio } from './ciclo_servicio';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPOSITORIO DE RUTAS AUTORIZADAS (T-A5-48, migración 0808) — del CSV a filas validadas y la búsqueda de la ruta de un viaje.
// Puro, sin I/O: la escritura es `importarRutas` (repo.ts).
//
// ── NO SE INVENTA NINGUNA RUTA ─────────────────────────────────────────────
// El link que recibe el chofer sale SOLO de esta base (rutas hechas con anticipación y revisadas por la flota). Aquí no se arma,
// no se acorta ni se «corrige» un link: o pasa la validación tal cual o se rechaza la fila diciendo por qué. Una ruta vencida se
// trata como AUSENTE (`buscarRuta` no la devuelve): mandar una ruta vieja es peor que decir «consulta con tu supervisor».
//
// Columnas del CSV (cabecera obligatoria, sin distinguir mayúsculas ni acentos):
//   corredor*  url*  sitio_origen  sitio_destino  vigente_hasta  revisada_en
// `sitio_origen` / `sitio_destino`: CÓDIGO del sitio del catálogo; ambos vacíos = la ruta del corredor completo.
// `vigente_hasta` / `revisada_en`: AAAA-MM-DD (fecha en la zona de la flota). Si la columna NO viene en el archivo, lo ya guardado
// no se toca; si viene y la celda está vacía, se borra (nulo = sin vencimiento / sin revisión).
// Separador: coma, punto y coma o tabulador (se detecta).
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_FILAS_RUTAS = 2000;
export const MAX_BYTES_CSV_RUTAS = 1_000_000;
export const MAX_LARGO_URL_RUTA = 2048;
const MAX_LARGO_CLAVE = 80;

export interface RutaAutorizada {
  corredor: string;
  sitioOrigen: string | null;
  sitioDestino: string | null;
  url: string;
  /** AAAA-MM-DD inclusive; nulo = sin vencimiento. */
  vigenteHasta: string | null;
  revisadaEn: string | null;
}

export interface RutaCsv {
  linea: number;
  corredor: string;
  sitioOrigen: string | null;
  sitioDestino: string | null;
  url: string;
  /** `undefined` = la columna no venía en el archivo: no tocar lo guardado. */
  vigenteHasta: string | null | undefined;
  revisadaEn: string | null | undefined;
}

export interface ErrorCsvRuta { linea: number; mensaje: string }
export interface ResultadoCsvRutas { filas: RutaCsv[]; errores: ErrorCsvRuta[] }

const sinAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Forma guardada de un corredor o de un código de sitio: minúsculas, sin acentos, espacios simples. */
export const normalizarClaveRuta = (t: string): string => sinAcentos(t).toLowerCase().replace(/\s+/g, ' ').trim();
const claveColumna = (t: string): string => sinAcentos(t).toLowerCase().trim().replace(/[\s-]+/g, '_');

// ── La URL ──────────────────────────────────────────────────────────────────

/** El mismo patrón que `ruta_autorizada_url_mapas` (0808): la base y el código dicen lo mismo. */
const PREFIJO_CORTO = 'https://maps.app.goo.gl/';
const PREFIJOS_GOOGLE = ['https://google.com/maps', 'https://www.google.com/maps'];
const esUrlDeMapas = (u: string): boolean => {
  if (u.startsWith(PREFIJO_CORTO)) return u.length > PREFIJO_CORTO.length;
  return PREFIJOS_GOOGLE.some((p) => u.startsWith(p) && (u.length === p.length || '/?#'.includes(u[p.length])));
};

/** `null` si el link es https y de Google Maps; si no, el motivo en palabras. */
export function motivoUrlInvalida(url: string): string | null {
  if (typeof url !== 'string' || url === '') return 'Falta el link de la ruta.';
  if (url.length > MAX_LARGO_URL_RUTA) return `El link pasa de ${MAX_LARGO_URL_RUTA} caracteres.`;
  if (/\s/.test(url)) return 'El link no puede traer espacios.';
  if (/^http:\/\//i.test(url)) return 'El link tiene que ser https (no http).';
  if (!/^https:\/\//.test(url)) return 'El link tiene que empezar con https://.';
  if (esUrlDeMapas(url)) return null;
  return 'El link tiene que ser de Google Maps: maps.app.goo.gl/… o google.com/maps…';
}

// ── Fechas ──────────────────────────────────────────────────────────────────

export function fechaIsoValida(t: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** «Hoy» como AAAA-MM-DD en la zona de la flota (por omisión America/Mexico_City): el vencimiento es del día de la flota, no del servidor. */
export function hoyDeLaFlota(ahora: Date, zona: string = TZ_MX): string {
  return diaEnZona(ahora, zona);
}

/** Vigente = sin vencimiento, o con vencimiento de hoy o posterior (la fecha es inclusive). `hoy` en AAAA-MM-DD. */
export function rutaVigente(r: Pick<RutaAutorizada, 'vigenteHasta'>, hoy: string): boolean {
  return r.vigenteHasta === null || r.vigenteHasta >= hoy;
}

// ── El CSV ──────────────────────────────────────────────────────────────────

/** Parte el texto en registros y campos respetando comillas (`""` = comilla). */
function partir(texto: string, sep: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"' && campo === '') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      filas.push(fila); fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas;
}

function detectarSeparador(primeraLinea: string): string {
  const cuenta = (s: string) => primeraLinea.split(s).length - 1;
  const candidatos: Array<[string, number]> = [[',', cuenta(',')], [';', cuenta(';')], ['\t', cuenta('\t')]];
  candidatos.sort((a, b) => b[1] - a[1]);
  return candidatos[0][1] > 0 ? candidatos[0][0] : ',';
}

const ALIAS_COLUMNA: Record<string, string> = {
  corredor: 'corredor', ruta: 'corredor',
  url: 'url', link: 'url', enlace: 'url',
  sitio_origen: 'sitio_origen', origen: 'sitio_origen',
  sitio_destino: 'sitio_destino', destino: 'sitio_destino',
  vigente_hasta: 'vigente_hasta', vigencia: 'vigente_hasta', vence: 'vigente_hasta',
  revisada_en: 'revisada_en', revisada: 'revisada_en', revision: 'revisada_en',
};

export function parsearCsvRutas(texto: string): ResultadoCsvRutas {
  const errores: ErrorCsvRuta[] = [];
  if (typeof texto !== 'string' || texto.trim() === '') return { filas: [], errores: [{ linea: 0, mensaje: 'El archivo está vacío.' }] };
  if (texto.length > MAX_BYTES_CSV_RUTAS) return { filas: [], errores: [{ linea: 0, mensaje: 'El archivo pesa más de 1 MB; divídelo en partes.' }] };
  const limpio = texto.replace(/^﻿/, '');
  const sep = detectarSeparador(limpio.split(/\r?\n/, 1)[0] ?? '');
  const registros = partir(limpio, sep);
  const cabecera = (registros[0] ?? []).map((c) => ALIAS_COLUMNA[claveColumna(c)] ?? `__${claveColumna(c)}`);
  for (const obligatoria of ['corredor', 'url']) {
    if (!cabecera.includes(obligatoria)) errores.push({ linea: 1, mensaje: `Falta la columna «${obligatoria}» en la cabecera.` });
  }
  if (errores.length > 0) return { filas: [], errores };

  const cuerpo = registros.slice(1).map((r, i) => ({ linea: i + 2, celdas: r })).filter((r) => r.celdas.some((c) => c.trim() !== ''));
  if (cuerpo.length === 0) return { filas: [], errores: [{ linea: 0, mensaje: 'El archivo no trae filas debajo de la cabecera.' }] };
  if (cuerpo.length > MAX_FILAS_RUTAS) {
    return { filas: [], errores: [{ linea: 0, mensaje: `El archivo trae ${cuerpo.length} filas; el máximo por importación es ${MAX_FILAS_RUTAS}.` }] };
  }
  const traeVigencia = cabecera.includes('vigente_hasta');
  const traeRevision = cabecera.includes('revisada_en');

  const filas: RutaCsv[] = [];
  const vistas = new Map<string, number>();
  for (const { linea, celdas } of cuerpo) {
    const v: Record<string, string> = {};
    cabecera.forEach((col, i) => { if (!col.startsWith('__')) v[col] = (celdas[i] ?? '').trim(); });
    const falla = (mensaje: string) => errores.push({ linea, mensaje });

    const corredor = normalizarClaveRuta(v.corredor ?? '');
    if (!corredor || corredor.length > MAX_LARGO_CLAVE) { falla(`El corredor es obligatorio y de hasta ${MAX_LARGO_CLAVE} caracteres.`); continue; }
    const sitioOrigen = v.sitio_origen ? normalizarClaveRuta(v.sitio_origen) : null;
    const sitioDestino = v.sitio_destino ? normalizarClaveRuta(v.sitio_destino) : null;
    if ((sitioOrigen && sitioOrigen.length > MAX_LARGO_CLAVE) || (sitioDestino && sitioDestino.length > MAX_LARGO_CLAVE)) {
      falla(`Los códigos de sitio admiten hasta ${MAX_LARGO_CLAVE} caracteres.`); continue;
    }
    const motivoUrl = motivoUrlInvalida(v.url ?? '');
    if (motivoUrl) { falla(motivoUrl); continue; }

    let vigenteHasta: string | null | undefined;
    if (traeVigencia) {
      vigenteHasta = v.vigente_hasta || null;
      if (vigenteHasta !== null && !fechaIsoValida(vigenteHasta)) { falla('«vigente_hasta» tiene que ser una fecha AAAA-MM-DD real.'); continue; }
    }
    let revisadaEn: string | null | undefined;
    if (traeRevision) {
      revisadaEn = v.revisada_en || null;
      if (revisadaEn !== null && !fechaIsoValida(revisadaEn)) { falla('«revisada_en» tiene que ser una fecha AAAA-MM-DD real.'); continue; }
    }

    const llave = `${corredor}|${sitioOrigen ?? ''}|${sitioDestino ?? ''}`;
    const previa = vistas.get(llave);
    if (previa !== undefined) { falla(`Esa combinación de corredor y sitios ya aparece en la línea ${previa}.`); continue; }
    vistas.set(llave, linea);
    filas.push({ linea, corredor, sitioOrigen, sitioDestino, url: v.url, vigenteHasta, revisadaEn });
  }
  errores.sort((a, b) => a.linea - b.linea);
  return { filas, errores };
}

/** La plantilla que se descarga: cabecera + una fila de EJEMPLO con un link ficticio marcado como tal (no es una ruta real). */
export const PLANTILLA_CSV_RUTAS =
  'corredor,sitio_origen,sitio_destino,url,vigente_hasta,revisada_en\n'
  + 'EJEMPLO-corredor,,,REEMPLAZA: link de Google Maps,,\n';

// ── Lo que el importador hace con las filas (puro; la escritura la hace el repo) ──────────────────────────────

const llaveDe = (r: { corredor: string; sitioOrigen: string | null; sitioDestino: string | null }): string =>
  `${r.corredor}|${r.sitioOrigen ?? ''}|${r.sitioDestino ?? ''}`;

export interface RutaExistente extends RutaAutorizada { id: string }

export interface PlanRutas {
  nuevas: RutaAutorizada[];
  cambios: Array<{ id: string; url: string; vigenteHasta: string | null; revisadaEn: string | null }>;
  sinCambios: number;
}

/** Compara el archivo contra lo guardado: reimportar lo mismo = 0 nuevas y 0 cambios. */
export function planificarRutas(filas: readonly RutaCsv[], existentes: readonly RutaExistente[]): PlanRutas {
  const porLlave = new Map(existentes.map((e) => [llaveDe(e), e]));
  const plan: PlanRutas = { nuevas: [], cambios: [], sinCambios: 0 };
  for (const f of filas) {
    const previa = porLlave.get(llaveDe(f));
    if (!previa) {
      plan.nuevas.push({
        corredor: f.corredor, sitioOrigen: f.sitioOrigen, sitioDestino: f.sitioDestino, url: f.url,
        vigenteHasta: f.vigenteHasta ?? null, revisadaEn: f.revisadaEn ?? null,
      });
      continue;
    }
    const vigenteHasta = f.vigenteHasta === undefined ? previa.vigenteHasta : f.vigenteHasta;
    const revisadaEn = f.revisadaEn === undefined ? previa.revisadaEn : f.revisadaEn;
    if (previa.url === f.url && previa.vigenteHasta === vigenteHasta && previa.revisadaEn === revisadaEn) plan.sinCambios++;
    else plan.cambios.push({ id: previa.id, url: f.url, vigenteHasta, revisadaEn });
  }
  return plan;
}

// ── La búsqueda de la ruta de un viaje ──────────────────────────────────────

export interface ConsultaRuta {
  corredor: string;
  sitioOrigen?: string | null;
  sitioDestino?: string | null;
}

/**
 * La ruta VIGENTE que mejor le queda a la consulta, o `null` (= no hay: el mensaje dirá «consulta con tu supervisor», nunca una
 * ruta inventada). Una fila sirve si es del corredor y su sitio de origen/destino, cuando lo trae, es el de la consulta; gana la
 * más específica (con origen > con destino > la del corredor completo). Las vencidas no cuentan. `hoy` en AAAA-MM-DD de la flota.
 */
export function buscarRuta<T extends RutaAutorizada>(rutas: readonly T[], consulta: ConsultaRuta, hoy: string): T | null {
  const corredor = normalizarClaveRuta(consulta.corredor ?? '');
  if (!corredor) return null;
  const origen = consulta.sitioOrigen ? normalizarClaveRuta(consulta.sitioOrigen) : null;
  const destino = consulta.sitioDestino ? normalizarClaveRuta(consulta.sitioDestino) : null;
  let mejor: T | null = null;
  let mejorPuntos = -1;
  for (const r of rutas) {
    if (r.corredor !== corredor || !rutaVigente(r, hoy)) continue;
    if (r.sitioOrigen !== null && r.sitioOrigen !== origen) continue;
    if (r.sitioDestino !== null && r.sitioDestino !== destino) continue;
    const puntos = (r.sitioOrigen !== null ? 2 : 0) + (r.sitioDestino !== null ? 1 : 0);
    if (puntos > mejorPuntos) { mejor = r; mejorPuntos = puntos; }
  }
  return mejor;
}

// ── Las rutas de UN viaje (T-A5-49) ─────────────────────────────────────────

export interface ViajeParaRuta {
  /** El corredor del viaje, si algún campo lo trae. `viaje` no tiene esa columna hoy (BLOQUEO EXTERNO): sin él se prueba con el texto del destino y del origen. */
  corredor?: string | null;
  origen: string | null;
  destino: string | null;
  /** CÓDIGO del sitio de origen/destino (catálogo de sitios), si el viaje ya está ligado a uno. */
  sitioOrigenCodigo: string | null;
  sitioDestinoCodigo: string | null;
  servicio?: Servicio;
}

export interface RutasDelViaje {
  /** Link de Google Maps al punto de origen/carga; `null` = no hay ruta autorizada vigente. */
  carga: string | null;
  /** Link al destino/patio de entrega. Importación: nunca (solo se manda el de origen). */
  patio: string | null;
  /** Lo que el mensaje no pudo llevar y el tablero debe mostrar. El origen siempre cuenta; el destino solo en exportación. */
  faltan: Array<'origen' | 'destino'>;
}

/**
 * Los links que lleva el mensaje de asignación (R04): importación = el de origen; exportación = el de origen y el de destino. Solo sale
 * de la base de rutas autorizadas y vigentes (`buscarRuta`): sin ruta o vencida es ausencia, nunca una ruta inventada.
 *
 * Ruling: el origen se busca con su código de sitio (o la ruta del corredor completo); el destino solo con una fila que nombre ese sitio
 * de destino (la del corredor completo ya es el link de origen y no se repite). Sin `servicio` conocido el destino se manda si existe,
 * pero su falta no se reclama. Costo si me equivoco: cambiar `corredoresCandidatos` cuando el cliente diga qué campo es el corredor.
 */
export function rutasDelViaje(rutas: readonly RutaAutorizada[], v: ViajeParaRuta, hoy: string): RutasDelViaje {
  const corredores = v.corredor
    ? [v.corredor]
    : [v.destino, v.origen].filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  const unicos = [...new Set(corredores.map(normalizarClaveRuta).filter((c) => c !== ''))];
  const buscar = (consulta: Omit<ConsultaRuta, 'corredor'>, exigeSitioDestino: boolean): string | null => {
    for (const corredor of unicos) {
      const hallada = buscarRuta(rutas, { corredor, ...consulta }, hoy);
      if (hallada && (!exigeSitioDestino || hallada.sitioDestino !== null)) return hallada.url;
    }
    return null;
  };
  const carga = buscar({ sitioOrigen: v.sitioOrigenCodigo, sitioDestino: null }, false);
  const patioHallado = v.sitioDestinoCodigo ? buscar({ sitioOrigen: null, sitioDestino: v.sitioDestinoCodigo }, true) : null;
  const patio = v.servicio === 'importacion' ? null : patioHallado;
  const faltan: RutasDelViaje['faltan'] = [];
  if (carga === null) faltan.push('origen');
  if (v.servicio === 'exportacion' && patio === null) faltan.push('destino');
  return { carga, patio, faltan };
}
