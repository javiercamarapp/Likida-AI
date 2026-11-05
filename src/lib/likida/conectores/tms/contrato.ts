// ═══════════════════════════════════════════════════════════════════════════
// CONTRATO DEL ADAPTADOR TMS (F4, "listo para conectar"). TODO ES SUPUESTO.
//
// El contrato vive en UN archivo, `contrato.supuesto.json` (autenticación, detección de sesión caída, paginación
// por recurso, fecha de corte, modos api/archivos/push, texto) más los mapeos JSON que ese archivo nombra
// (`mapeos/*.supuesto.json`: rutas, nombres de campo, formatos de fecha). Este módulo solo LEE ese contrato y lo
// convierte en las piezas que ya existen (`SesionTms`, `ConfigPaginacion`, `MapeoTms`, los lectores): cuando el cliente
// entregue su especificación se corrigen el JSON y los mapeos, no el código.
//
// Lo que NO hace: no abre red por sí mismo (el transporte `Http` se inyecta), no escribe en el TMS (solo GET; el único
// POST es el login), no guarda credenciales y no afirma una conexión real. Mientras `estado` sea «SUPUESTO», cualquier
// salida que lo cite debe decirlo. El modo API viene apagado; el adaptador se construye igual para poder probarlo
// contra dobles.
//
// Piezas:
//  · `cargarContrato` / `validarContrato`  — el JSON, validado (falla cerrado con motivos en llano).
//  · `crearAdaptadorTms`                   — sesión + mapeos + paginación del contrato; `leer(recurso, ventana)`.
//  · `detectorSesionCaida`                 — 401 y también el 200 con HTML de login o con JSON de error de sesión.
//  · `repararMojibake` / `conTextoReparado` — «Ã³» → «ó» en respuestas, archivos y lotes empujados.
//  · fecha de corte                        — `ventanaConCorte`, `filtrarPorCorte`.
//  · modo archivos                         — `entradasDeArchivos` (mismos mapeos, texto reparado).
//  · modo push                             — `recibirPush` (HMAC, marca de tiempo, idempotencia, mismos mapeos).
// ═══════════════════════════════════════════════════════════════════════════
import { createHmac, timingSafeEqual } from 'node:crypto';
import { localAUtc, zonaValida, ZONA_POR_OMISION } from '../tabla_propia/tiempo';
import type { Http, RespuestaHttp } from '../tipos';
import { decodificarTexto } from '../../peajes/csv';
import type { EntradaExportacion, FormatoExportacion } from './archivo';
import contratoJson from './contrato.supuesto.json';
import { aplicarMapeo, leerRuta, validarMapeo, MAX_FILAS, type MapeoTms } from './mapeo';
import mapeoLiquidacionesJson from './mapeos/liquidaciones.supuesto.json';
import mapeoPeajesJson from './mapeos/peajes.supuesto.json';
import mapeoPosicionesJson from './mapeos/posiciones.supuesto.json';
import mapeoViajesJson from './mapeos/viajes.supuesto.json';
import { leerLiquidaciones, type MapeoLiquidacionesTms } from './liquidaciones';
import type { ConfigPaginacion, PuntoReanudo } from './paginar';
import { leerPeajes, type ReanudarPeajes } from './peajes';
import { leerPosiciones } from './posiciones';
import { SesionTms, type ConfigLoginTms, type CredencialTms } from './sesion';
import type { FilaRechazadaTms } from './tipos';
import { leerViajes } from './viajes';
import type { OpcionesLecturaPaginada } from '../posiciones_comun';

// ── Tipos del contrato ───────────────────────────────────────────────────

export const RECURSOS_CONTRATO = ['viajes', 'peajes', 'posiciones', 'liquidaciones'] as const;
export type RecursoContrato = (typeof RECURSOS_CONTRATO)[number];
export const MODOS_TMS = ['api', 'archivos', 'push'] as const;
export type ModoTms = (typeof MODOS_TMS)[number];

export interface ReglaJsonSesionCaida {
  /** Ruta puntuada dentro del JSON de respuesta («error», «data.mensaje»). */
  ruta: string;
  /** Fragmentos (sin mayúsculas ni acentos) que, si aparecen en ese texto, indican sesión caída. */
  contiene: string[];
}

export interface ContratoTms {
  estado: 'SUPUESTO' | 'CONFIRMADO';
  version: string;
  texto: { codificacion: string; reparar_mojibake: boolean };
  auth: {
    login: ConfigLoginTms;
    sesion_caida: {
      estados: number[];
      html_con_200: boolean;
      marcadores_html: string[];
      json: ReglaJsonSesionCaida[];
    };
  };
  corte: { fecha: string | null; zona: string; nota?: string };
  recursos: Record<RecursoContrato, {
    mapeo: string;
    paginacion: ConfigPaginacion;
    orden_estable: boolean;
    campo_corte?: string;
  }>;
  modos: {
    api: { activo: boolean; nota?: string };
    archivos: { activo: boolean; formatos: FormatoExportacion[]; nota?: string };
    push: {
      activo: boolean;
      encabezado_firma: string;
      encabezado_marca: string;
      encabezado_idempotencia: string;
      tolerancia_marca_s: number;
      max_bytes: number;
      nota?: string;
    };
  };
}

/** Los mapeos JSON que el contrato puede nombrar. Un nombre fuera de aquí invalida el contrato. */
export const MAPEOS_REGISTRADOS: Readonly<Record<string, unknown>> = {
  'mapeos/viajes.supuesto.json': mapeoViajesJson,
  'mapeos/peajes.supuesto.json': mapeoPeajesJson,
  'mapeos/posiciones.supuesto.json': mapeoPosicionesJson,
  'mapeos/liquidaciones.supuesto.json': mapeoLiquidacionesJson,
};

export const CONTRATO_TMS_SUPUESTO = contratoJson as unknown as ContratoTms;

// ── Validación ───────────────────────────────────────────────────────────

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const esTextos = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '');
const FECHA_CORTE = /^(\d{4})-(\d{2})-(\d{2})$/;

function fechaCalendarioValida(f: string): boolean {
  const m = FECHA_CORTE.exec(f);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function problemasPaginacion(p: unknown, donde: string): string[] {
  if (!esObjeto(p)) return [`${donde}: la paginación debe ser un objeto`];
  const e: string[] = [];
  if (p.tipo === 'pagina') {
    if (!Number.isInteger(p.tamano) || (p.tamano as number) < 1) e.push(`${donde}: el tamaño de página debe ser un entero positivo`);
  } else if (p.tipo === 'cursor') {
    if (typeof p.ruta_siguiente !== 'string' || p.ruta_siguiente.trim() === '') e.push(`${donde}: la paginación por cursor necesita «ruta_siguiente»`);
  } else if (p.tipo === 'offset') {
    if (typeof p.param !== 'string' || p.param.trim() === '') e.push(`${donde}: la paginación por offset necesita «param»`);
    if (!Number.isInteger(p.tamano) || (p.tamano as number) < 1) e.push(`${donde}: el tamaño de página debe ser un entero positivo`);
  } else e.push(`${donde}: el tipo de paginación debe ser pagina, cursor u offset`);
  return e;
}

/** Problemas del contrato en lenguaje llano; lista vacía = válido. Nunca lanza. */
export function validarContrato(c: unknown, registro: Readonly<Record<string, unknown>> = MAPEOS_REGISTRADOS): string[] {
  if (!esObjeto(c)) return ['el contrato debe ser un objeto'];
  const e: string[] = [];
  if (c.estado !== 'SUPUESTO' && c.estado !== 'CONFIRMADO') e.push('«estado» debe ser SUPUESTO o CONFIRMADO');
  if (typeof c.version !== 'string' || c.version.trim() === '') e.push('falta «version»');

  const texto = c.texto;
  if (!esObjeto(texto) || typeof texto.reparar_mojibake !== 'boolean' || typeof texto.codificacion !== 'string') e.push('«texto» necesita codificacion y reparar_mojibake');

  const auth = c.auth;
  if (!esObjeto(auth) || !esObjeto(auth.login) || !esObjeto(auth.sesion_caida)) e.push('«auth» necesita login y sesion_caida');
  else {
    const l = auth.login;
    if (typeof l.ruta !== 'string' || !l.ruta.startsWith('/')) e.push('auth.login.ruta debe empezar con «/»');
    if (!esObjeto(l.cuerpo) || Object.values(l.cuerpo).some((v) => typeof v !== 'string')) e.push('auth.login.cuerpo debe ser un objeto de textos');
    if (typeof l.campo_token !== 'string' || l.campo_token.trim() === '') e.push('auth.login.campo_token no puede estar vacío');
    const s = auth.sesion_caida;
    if (!Array.isArray(s.estados) || s.estados.some((x) => !Number.isInteger(x) || x < 400 || x > 599)) e.push('auth.sesion_caida.estados debe ser una lista de códigos 4xx/5xx');
    else if (!(s.estados as number[]).includes(401)) e.push('auth.sesion_caida.estados debe incluir 401');
    if (typeof s.html_con_200 !== 'boolean') e.push('auth.sesion_caida.html_con_200 debe ser verdadero o falso');
    if (!esTextos(s.marcadores_html)) e.push('auth.sesion_caida.marcadores_html debe ser una lista de textos');
    if (!Array.isArray(s.json) || s.json.some((r) => !esObjeto(r) || typeof r.ruta !== 'string' || r.ruta.trim() === '' || !esTextos(r.contiene) || (r.contiene as string[]).length === 0)) {
      e.push('auth.sesion_caida.json debe ser una lista de {ruta, contiene[]}');
    }
  }

  const corte = c.corte;
  if (!esObjeto(corte)) e.push('falta «corte»');
  else {
    if (corte.fecha !== null && (typeof corte.fecha !== 'string' || !fechaCalendarioValida(corte.fecha))) e.push('corte.fecha debe ser null o una fecha aaaa-mm-dd real');
    if (typeof corte.zona !== 'string' || !zonaValida(corte.zona)) e.push('corte.zona no es una zona horaria conocida');
  }

  const recursos = c.recursos;
  if (!esObjeto(recursos)) e.push('falta «recursos»');
  else {
    for (const r of RECURSOS_CONTRATO) {
      const x = recursos[r];
      if (!esObjeto(x)) { e.push(`falta el recurso «${r}»`); continue; }
      e.push(...problemasPaginacion(x.paginacion, `recursos.${r}`));
      if (typeof x.orden_estable !== 'boolean') e.push(`recursos.${r}.orden_estable debe ser verdadero o falso`);
      const m = typeof x.mapeo === 'string' ? registro[x.mapeo] : undefined;
      if (m === undefined) { e.push(`recursos.${r}.mapeo «${String(x.mapeo)}» no es un mapeo registrado`); continue; }
      const mapeos: Array<[string, unknown]> = r === 'liquidaciones'
        ? (['nomina', 'operadores', 'conceptos'] as const).map((t) => [`${r}.${t}`, esObjeto(m) ? m[t] : undefined] as [string, unknown])
        : [[r, m]];
      for (const [nombre, mp] of mapeos) {
        const pr = validarMapeo(mp);
        if (pr.length > 0) e.push(`mapeo de ${nombre}: ${pr[0]}`);
        else if (x.campo_corte !== undefined && r !== 'liquidaciones' && !(x.campo_corte as string in (mp as MapeoTms).campos)) {
          e.push(`recursos.${r}.campo_corte «${String(x.campo_corte)}» no existe en el mapeo`);
        }
      }
    }
  }

  const modos = c.modos;
  if (!esObjeto(modos) || !esObjeto(modos.api) || !esObjeto(modos.archivos) || !esObjeto(modos.push)) e.push('«modos» necesita api, archivos y push');
  else {
    if (typeof modos.api.activo !== 'boolean' || typeof modos.archivos.activo !== 'boolean' || typeof modos.push.activo !== 'boolean') e.push('cada modo necesita «activo» verdadero o falso');
    const p = modos.push;
    for (const k of ['encabezado_firma', 'encabezado_marca', 'encabezado_idempotencia'] as const) {
      if (typeof p[k] !== 'string' || !/^[a-z0-9-]+$/.test(p[k] as string)) e.push(`modos.push.${k} debe ir en minúsculas, sin espacios`);
    }
    if (!Number.isInteger(p.tolerancia_marca_s) || (p.tolerancia_marca_s as number) < 1) e.push('modos.push.tolerancia_marca_s debe ser un entero positivo');
    if (!Number.isInteger(p.max_bytes) || (p.max_bytes as number) < 1) e.push('modos.push.max_bytes debe ser un entero positivo');
  }
  return e;
}

/** Valida y devuelve el contrato tipado, o los problemas. */
export function cargarContrato(c: unknown, registro: Readonly<Record<string, unknown>> = MAPEOS_REGISTRADOS): { ok: true; contrato: ContratoTms } | { ok: false; problemas: string[] } {
  const problemas = validarContrato(c, registro);
  return problemas.length === 0 ? { ok: true, contrato: c as ContratoTms } : { ok: false, problemas };
}

// ── Mapeos y piezas derivadas del contrato ───────────────────────────────

export function mapeoDe(c: ContratoTms, recurso: Exclude<RecursoContrato, 'liquidaciones'>, registro: Readonly<Record<string, unknown>> = MAPEOS_REGISTRADOS): MapeoTms {
  return registro[c.recursos[recurso].mapeo] as MapeoTms;
}
export function mapeoLiquidacionesDe(c: ContratoTms, registro: Readonly<Record<string, unknown>> = MAPEOS_REGISTRADOS): MapeoLiquidacionesTms {
  const m = registro[c.recursos.liquidaciones.mapeo] as Record<string, unknown>;
  return { nomina: m.nomina as MapeoTms, operadores: m.operadores as MapeoTms, conceptos: m.conceptos as MapeoTms };
}
export const loginDeContrato = (c: ContratoTms): ConfigLoginTms => ({ ...c.auth.login, cuerpo: { ...c.auth.login.cuerpo } });
export const paginacionDe = (c: ContratoTms, r: RecursoContrato): ConfigPaginacion => ({ ...c.recursos[r].paginacion });

// ── Detector de sesión caída (401, o 200 con HTML / JSON de error) ───────

const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** ¿La respuesta es una página HTML (por tipo de contenido o por el inicio del cuerpo)? */
export function esRespuestaHtml(r: RespuestaHttp): boolean {
  const tipo = (r.encabezados?.['content-type'] ?? '').toLowerCase();
  if (tipo.includes('text/html')) return true;
  const ini = r.cuerpo.trimStart().slice(0, 15).toLowerCase();
  return ini.startsWith('<!doctype html') || ini.startsWith('<html');
}

/**
 * Función para `SesionTms.detectaVencido`. El 401 lo maneja la sesión; aquí se reconoce lo que NO es 401:
 *  · un código listado en `estados` (p. ej. 419/440 de algunos frameworks);
 *  · un 2xx cuyo cuerpo es HTML con al menos dos de los marcadores del contrato (la página de login servida con 200);
 *  · un 2xx con JSON cuyo texto en `ruta` contiene alguno de los fragmentos (p. ej. {"error":"Token expirado"}).
 * Un HTML sin marcadores no se toma por sesión caída (es otro formato: lo rechaza el mapeo con su motivo).
 */
export function detectorSesionCaida(c: ContratoTms): (r: RespuestaHttp) => boolean {
  const s = c.auth.sesion_caida;
  const estados = new Set(s.estados);
  const marcadores = s.marcadores_html.map(normalizar);
  return (r) => {
    if (estados.has(r.estado)) return true;
    if (r.estado < 200 || r.estado >= 300) return false;
    if (s.html_con_200 && esRespuestaHtml(r)) {
      const cuerpo = normalizar(r.cuerpo.slice(0, 20_000));
      // Un solo marcador es demasiado genérico (cualquier formulario o menú con «login»): se exigen al menos dos.
      return marcadores.filter((m) => cuerpo.includes(m)).length >= Math.min(2, marcadores.length);
    }
    if (s.json.length === 0) return false;
    let j: unknown;
    try { j = JSON.parse(r.cuerpo); } catch { return false; }
    return s.json.some((regla) => {
      const v = leerRuta(j, regla.ruta);
      if (typeof v !== 'string') return false;
      const t = normalizar(v);
      return regla.contiene.some((f) => t.includes(normalizar(f)));
    });
  };
}

// ── Mojibake: «Ã³» → «ó» ─────────────────────────────────────────────────

const CP1252: Readonly<Record<number, number>> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
/** Un byte de arranque de UTF-8 (C2–F4) leído como Latin-1/Windows-1252, seguido de un byte de continuación leído igual. */
const SOSPECHA = /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/;

/**
 * Si el texto es UTF-8 que alguien leyó como Latin-1/Windows-1252 («DirecciÃ³n», «CamiÃ³n»), lo devuelve bien
 * escrito. Solo reemplaza cuando TODA la cadena vuelve a ser UTF-8 válido; si no, la deja tal cual (nunca inventa).
 */
export function repararMojibake(texto: string): string {
  if (!SOSPECHA.test(texto)) return texto;
  const bytes: number[] = [];
  for (const ch of texto) {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
    else return texto; // un carácter que no cabe en un byte: el texto es otra cosa, no mojibake
  }
  try {
    const arreglado = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return arreglado.length < texto.length ? arreglado : texto;
  } catch {
    return texto;
  }
}

/** Repara cada texto de un valor JSON (valores, no llaves). Devuelve el mismo objeto si nada cambió. */
export function repararJson(valor: unknown, nivel = 0): unknown {
  if (nivel > 12) return valor;
  if (typeof valor === 'string') return repararMojibake(valor);
  if (Array.isArray(valor)) {
    let cambio = false;
    const sal = valor.map((x) => { const y = repararJson(x, nivel + 1); if (y !== x) cambio = true; return y; });
    return cambio ? sal : valor;
  }
  if (esObjeto(valor)) {
    let cambio = false;
    const sal: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) { const y = repararJson(v, nivel + 1); if (y !== v) cambio = true; sal[k] = y; }
    return cambio ? sal : valor;
  }
  return valor;
}

/** Envuelve un transporte: las respuestas JSON salen con sus textos reparados. Lo que no es JSON pasa intacto. */
export function conTextoReparado(http: Http): Http {
  return async (p) => {
    const r = await http(p);
    if (r.estado < 200 || r.estado >= 300 || !SOSPECHA.test(r.cuerpo)) return r;
    let j: unknown;
    try { j = JSON.parse(r.cuerpo); } catch { return r; }
    const rep = repararJson(j);
    return rep === j ? r : { ...r, cuerpo: JSON.stringify(rep) };
  };
}

/** Bytes de un archivo/lote → bytes UTF-8 con el texto reparado (si el contrato lo pide y hay mojibake). */
export function repararBytes(bytes: Uint8Array): Uint8Array {
  const t = decodificarTexto(bytes);
  const r = repararMojibake(t);
  return r === t ? bytes : new TextEncoder().encode(r);
}

// ── Fecha de corte ───────────────────────────────────────────────────────

/** Instante UTC (ISO) en que empieza la fecha de corte (00:00:00 local), o `null` si no hay corte fijado. */
export function corteUtc(c: ContratoTms, fecha: string | null | undefined = c.corte.fecha): string | null {
  if (fecha === null || fecha === undefined) return null;
  if (!fechaCalendarioValida(fecha)) throw new Error('la fecha de corte debe ser aaaa-mm-dd');
  const zona = zonaValida(c.corte.zona) ? c.corte.zona : ZONA_POR_OMISION;
  return localAUtc(`${fecha} 00:00:00`, zona).toISOString();
}

/**
 * Recorta la ventana para no pedir nada anterior al corte. Devuelve `null` si toda la ventana es anterior
 * (no hay nada que pedir). Sin corte, la ventana pasa igual.
 */
export function ventanaConCorte<V extends { desde: string; hasta: string }>(ventana: V, corte: string | null): { ventana: V | null; recortada: boolean } {
  if (corte === null) return { ventana, recortada: false };
  const c = Date.parse(corte); const d = Date.parse(ventana.desde); const h = Date.parse(ventana.hasta);
  if (!Number.isFinite(c) || !Number.isFinite(d) || !Number.isFinite(h)) return { ventana, recortada: false };
  if (h < c) return { ventana: null, recortada: true };
  if (d >= c) return { ventana, recortada: false };
  return { ventana: { ...ventana, desde: corte }, recortada: true };
}

/** Quita las filas anteriores al corte (aunque el origen las haya mandado de más). Una fila sin fecha legible se conserva. */
export function filtrarPorCorte<T>(filas: readonly T[], fechaDe: (f: T) => string | undefined, corte: string | null): { filas: T[]; anteriores: number } {
  if (corte === null) return { filas: [...filas], anteriores: 0 };
  const c = Date.parse(corte);
  const dentro: T[] = [];
  let anteriores = 0;
  for (const f of filas) {
    const t = Date.parse(fechaDe(f) ?? '');
    if (Number.isFinite(t) && t < c) anteriores += 1;
    else dentro.push(f);
  }
  return { filas: dentro, anteriores };
}

// ── Adaptador: sesión + mapeos + paginación del contrato ─────────────────

export interface DepsAdaptadorTms {
  /** Transporte. En producción, `httpsPublico`; en pruebas, un doble. Sin él no se abre red. */
  http: Http;
  /** URL base https del TMS de la flota (viene de la credencial del cofre, nunca del contrato). */
  base: string;
  credenciales: CredencialTms;
  reloj?: OpcionesLecturaPaginada;
  /** Fecha de corte de la flota (aaaa-mm-dd); por omisión, la del contrato. */
  fechaCorte?: string | null;
  /** Mapeos alternativos (los de una flota concreta); por omisión, los registrados. */
  registro?: Readonly<Record<string, unknown>>;
}

export interface VentanaAdaptador { desde: string; hasta: string; reanudar?: PuntoReanudo | ReanudarPeajes }

export interface LecturaAdaptador {
  recurso: RecursoContrato;
  /** Mapeado y con el corte aplicado. Para liquidaciones, los cuerpos armados. */
  filas: unknown[];
  rechazadas: FilaRechazadaTms[];
  avisos: string[];
  completa: boolean;
  backlog: boolean;
  reanudar?: PuntoReanudo | ReanudarPeajes;
  /** Filas que el origen mandó con fecha anterior al corte y se descartaron. */
  anterioresAlCorte: number;
  /** La ventana entera quedaba antes del corte: no se pidió nada. */
  sinPeticion: boolean;
  /** Falla (credencial, red, formato): lo leído hasta ahí NO se pierde. */
  motivo?: string;
}

export interface AdaptadorTms {
  readonly contrato: ContratoTms;
  readonly sesion: SesionTms;
  /** Instante UTC del corte, o null. */
  readonly corte: string | null;
  mapeo(recurso: Exclude<RecursoContrato, 'liquidaciones'>): MapeoTms;
  leer(recurso: RecursoContrato, ventana: VentanaAdaptador): Promise<LecturaAdaptador>;
}

const FECHA_DE: Record<Exclude<RecursoContrato, 'liquidaciones'>, string> = { viajes: 'salida_en', peajes: 'cruce_en', posiciones: 'medidaEn' };

/**
 * Arma el adaptador a partir del contrato. Falla (lanza) si el contrato no es válido: un contrato roto no se usa.
 * Solo GET (más el login). No escribe en el TMS ni guarda credenciales.
 */
export function crearAdaptadorTms(contrato: ContratoTms, deps: DepsAdaptadorTms): AdaptadorTms {
  const registro = deps.registro ?? MAPEOS_REGISTRADOS;
  const problemas = validarContrato(contrato, registro);
  if (problemas.length > 0) throw new Error(`contrato TMS inválido: ${problemas[0]}`);
  const http = contrato.texto.reparar_mojibake ? conTextoReparado(deps.http) : deps.http;
  const sesion = new SesionTms({
    http, base: deps.base, login: loginDeContrato(contrato), credenciales: deps.credenciales,
    reloj: deps.reloj, detectaVencido: detectorSesionCaida(contrato),
  });
  const corte = corteUtc(contrato, deps.fechaCorte === undefined ? contrato.corte.fecha : deps.fechaCorte);
  const reloj = deps.reloj ?? {};
  const base = (r: RecursoContrato) => ({ paginacion: paginacionDe(contrato, r), venceEn: reloj.venceEn, ahora: reloj.ahora });

  const vacia = (recurso: RecursoContrato, extra: Partial<LecturaAdaptador>): LecturaAdaptador =>
    ({ recurso, filas: [], rechazadas: [], avisos: [], completa: false, backlog: false, anterioresAlCorte: 0, sinPeticion: false, ...extra });

  return {
    contrato, sesion, corte,
    mapeo: (r) => mapeoDe(contrato, r, registro),
    async leer(recurso, ventanaPedida) {
      const { ventana, recortada } = ventanaConCorte(ventanaPedida, corte);
      const avisos: string[] = [];
      if (corte === null) avisos.push('SUPUESTO: no hay fecha de corte fijada; no se filtra nada por fecha.');
      if (ventana === null) {
        return vacia(recurso, { avisos: [...avisos, 'La ventana pedida es anterior a la fecha de corte; no se pidió nada.'], completa: true, sinPeticion: true });
      }
      if (recortada) avisos.push('La ventana se recortó a la fecha de corte.');

      if (recurso === 'liquidaciones') {
        const r = await leerLiquidaciones(sesion, mapeoLiquidacionesDe(contrato, registro), { desde: ventana.desde, hasta: ventana.hasta, reanudar: ventana.reanudar as PuntoReanudo | undefined }, base(recurso));
        const l = r.ok ? r : r.parcial;
        return vacia(recurso, {
          filas: l.cuerpos, avisos: [...avisos, ...l.avisos], completa: l.completa, backlog: l.backlog, reanudar: l.reanudar,
          rechazadas: l.rechazadas.map((x, i) => ({ indice: i, motivo: `${x.tabla} ${x.ref}: ${x.motivo}` })),
          ...(r.ok ? {} : { motivo: r.motivo }),
        });
      }

      const mapeo = mapeoDe(contrato, recurso, registro);
      const opciones = { ...base(recurso), mapeo };
      let filas: unknown[]; let rechazadas: FilaRechazadaTms[]; let av: string[]; let completa: boolean; let backlog: boolean;
      let reanudar: PuntoReanudo | ReanudarPeajes | undefined; let motivo: string | undefined;
      if (recurso === 'viajes') {
        const r = await leerViajes(sesion, { desde: ventana.desde, hasta: ventana.hasta, reanudar: ventana.reanudar as PuntoReanudo | undefined }, opciones);
        const l = r.ok ? r : r.parcial;
        ({ filas, rechazadas, completa, backlog, reanudar } = l); av = [...l.avisos, ...l.advertencias]; motivo = r.ok ? undefined : r.motivo;
      } else if (recurso === 'peajes') {
        const r = await leerPeajes(sesion, { desde: ventana.desde, hasta: ventana.hasta, reanudar: ventana.reanudar as ReanudarPeajes | undefined }, opciones);
        const l = r.ok ? r : r.parcial;
        ({ filas, rechazadas, completa, backlog, reanudar } = l); av = l.avisos; motivo = r.ok ? undefined : r.motivo;
      } else {
        const r = await leerPosiciones(sesion, { desde: ventana.desde, hasta: ventana.hasta, reanudar: ventana.reanudar as PuntoReanudo | undefined }, opciones);
        const l = r.ok ? r : r.parcial;
        ({ filas, rechazadas, completa, backlog, reanudar } = l); av = l.avisos; motivo = r.ok ? undefined : r.motivo;
      }
      const campo = FECHA_DE[recurso];
      const f = filtrarPorCorte(filas, (x) => (x as Record<string, string | undefined>)[campo], corte);
      if (f.anteriores > 0) avisos.push(`El origen mandó ${f.anteriores} fila(s) anteriores a la fecha de corte; se descartaron.`);
      return vacia(recurso, { filas: f.filas, rechazadas, avisos: [...avisos, ...av], completa, backlog, reanudar, anterioresAlCorte: f.anteriores, ...(motivo ? { motivo } : {}) });
    },
  };
}

// ── Modo archivos: las exportaciones del cliente por los MISMOS mapeos ───

export interface ArchivoExportado { recurso: Exclude<RecursoContrato, 'liquidaciones'>; buffer: Uint8Array; formato: FormatoExportacion }

/**
 * Convierte archivos en entradas para `sesionDeExportaciones` (que los sirve a los mismos lectores). Con
 * `reparar_mojibake`, el texto se repara antes de leerlo. Rechaza el formato que el contrato no admite.
 */
export function entradasDeArchivos(c: ContratoTms, archivos: readonly ArchivoExportado[], registro: Readonly<Record<string, unknown>> = MAPEOS_REGISTRADOS): { entradas: EntradaExportacion[]; rechazados: string[] } {
  const entradas: EntradaExportacion[] = []; const rechazados: string[] = [];
  for (const a of archivos) {
    if (!c.modos.archivos.activo) { rechazados.push(`${a.recurso}: el modo archivos está apagado en el contrato`); continue; }
    if (!c.modos.archivos.formatos.includes(a.formato)) { rechazados.push(`${a.recurso}: el formato ${a.formato} no está admitido por el contrato`); continue; }
    entradas.push({ mapeo: mapeoDe(c, a.recurso, registro), formato: a.formato, buffer: c.texto.reparar_mojibake ? repararBytes(a.buffer) : a.buffer });
  }
  return { entradas, rechazados };
}

// ── Modo push: el cliente empuja lotes firmados ──────────────────────────

export interface SolicitudPush {
  recurso: Exclude<RecursoContrato, 'liquidaciones'>;
  /** Cuerpo tal como llegó (texto). */
  cuerpo: string;
  /** Encabezados con nombres en minúsculas. */
  encabezados: Record<string, string>;
  /** Secreto compartido del cofre; nunca viaja en el contrato. */
  secreto: string;
  /** Reloj en ms (inyectable). */
  ahora: number;
  /** Almacén de llaves de idempotencia ya vistas (el que llama lo persiste). */
  vistas: ReadonlySet<string>;
  registro?: Readonly<Record<string, unknown>>;
  /** Fecha de corte propia de la flota (aaaa-mm-dd); sin ella rige la del contrato, igual que en el modo API. */
  fechaCorte?: string | null;
}

export type ResultadoPush =
  | { ok: true; estado: 200; filas: unknown[]; rechazadas: FilaRechazadaTms[]; llave: string; avisos: string[]; anterioresAlCorte: number }
  | { ok: false; estado: 400 | 401 | 403 | 409 | 413 | 422 | 503; motivo: string };

/** Firma esperada: HMAC-SHA256 hexadecimal de «marca.llave.cuerpo» (la llave de idempotencia va firmada: no se puede repetir un lote con otra llave). La usa el emisor del cliente y las pruebas. */
export function firmarPush(secreto: string, marca: string, llave: string, cuerpo: string): string {
  return createHmac('sha256', secreto).update(`${marca}.${llave}.${cuerpo}`).digest('hex');
}

/** Hexadecimal → bytes, o null si no es hexadecimal válido (sin `Buffer.from`). */
function hexABytes(h: string): Uint8Array | null {
  if (h.length === 0 || h.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(h)) return null;
  const sal = new Uint8Array(h.length / 2);
  for (let i = 0; i < sal.length; i += 1) sal[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return sal;
}

/**
 * Recibe UN lote empujado: verifica el modo, el tamaño, la firma (tiempo constante), la marca (anti-replay) y la
 * llave de idempotencia; luego lo pasa por el MISMO mapeo y por el corte. Pura: no persiste nada (quien llama guarda
 * `llave` y las filas). Mientras el modo push esté apagado en el contrato responde 503 y no procesa nada.
 */
export function recibirPush(c: ContratoTms, s: SolicitudPush): ResultadoPush {
  const p = c.modos.push;
  if (!p.activo) return { ok: false, estado: 503, motivo: 'La recepción por push está apagada.' };
  if (s.secreto === '') return { ok: false, estado: 503, motivo: 'No hay secreto de firma configurado para esta flota.' };
  if (Buffer.byteLength(s.cuerpo, 'utf8') > p.max_bytes) return { ok: false, estado: 413, motivo: `El lote pesa más de ${p.max_bytes} bytes.` };

  const marca = s.encabezados[p.encabezado_marca] ?? '';
  const firma = s.encabezados[p.encabezado_firma] ?? '';
  const llave = (s.encabezados[p.encabezado_idempotencia] ?? '').trim();
  if (marca === '' || firma === '') return { ok: false, estado: 401, motivo: 'Faltan la firma o la marca de tiempo.' };
  const esperada = hexABytes(firmarPush(s.secreto, marca, llave, s.cuerpo)) as Uint8Array;
  const recibida = hexABytes(firma);
  if (recibida === null || recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return { ok: false, estado: 401, motivo: 'La firma no es válida.' };

  const marcaMs = /^\d{1,13}$/.test(marca) ? Number(marca) * (marca.length <= 10 ? 1000 : 1) : NaN;
  if (!Number.isFinite(marcaMs) || Math.abs(s.ahora - marcaMs) > p.tolerancia_marca_s * 1000) {
    return { ok: false, estado: 403, motivo: 'La marca de tiempo está fuera de tolerancia (posible repetición).' };
  }
  if (llave === '' || llave.length > 128) return { ok: false, estado: 400, motivo: 'Falta la llave de idempotencia (o es demasiado larga).' };
  if (s.vistas.has(llave)) return { ok: false, estado: 409, motivo: 'Ese lote ya se recibió (llave de idempotencia repetida).' };

  let crudo: unknown;
  try { crudo = JSON.parse(c.texto.reparar_mojibake ? repararMojibake(s.cuerpo) : s.cuerpo); } catch { return { ok: false, estado: 422, motivo: 'El cuerpo no es JSON.' }; }
  const mapeo = mapeoDe(c, s.recurso, s.registro);
  const lista = Array.isArray(crudo) ? crudo : leerRuta(crudo, mapeo.raiz);
  if (!Array.isArray(lista)) return { ok: false, estado: 422, motivo: `El lote no trae la lista de filas en «${mapeo.raiz || 'la raíz'}».` };
  if (lista.length > MAX_FILAS) return { ok: false, estado: 422, motivo: `El lote trae más de ${MAX_FILAS} filas.` };

  const m = aplicarMapeo(mapeo, Array.isArray(crudo) && mapeo.raiz !== '' ? envolverEnRaiz(crudo, mapeo.raiz) : crudo);
  if (m.error) return { ok: false, estado: 422, motivo: m.error };
  const campo = FECHA_DE[s.recurso];
  const corte = corteUtc(c, s.fechaCorte === undefined ? c.corte.fecha : s.fechaCorte);
  const f = filtrarPorCorte(m.filas.map((x) => x.fila), (x) => (x as Record<string, string | undefined>)[campo], corte);
  const avisos = corte === null ? ['SUPUESTO: no hay fecha de corte fijada; no se filtra nada por fecha.'] : [];
  return { ok: true, estado: 200, filas: f.filas, rechazadas: m.rechazadas, llave, avisos, anterioresAlCorte: f.anteriores };
}

function envolverEnRaiz(filas: unknown[], raiz: string): unknown {
  let cuerpo: unknown = filas;
  const partes = raiz.split('.');
  for (let i = partes.length - 1; i >= 0; i -= 1) cuerpo = { [partes[i]]: cuerpo };
  return cuerpo;
}
