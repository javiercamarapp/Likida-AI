import { localAUtc, zonaValida, ZONA_POR_OMISION } from '../tabla_propia/tiempo';
import { RECURSOS_TMS, type FilaRechazadaTms, type RecursoTms } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// DSL DE MAPEO DECLARATIVO del conector TMS. Un mapeo es JSON serializable (se guarda por
// flota, igual que `mapeo_posiciones` de tabla_propia) que dice: a qué ruta se pide, dónde
// está la lista en la respuesta y de qué ruta sale cada campo destino. Sin `eval`, sin
// `Function`: las rutas puntuadas («a.b[0].c») las recorre un evaluador propio con topes y
// con los nombres peligrosos (`__proto__`, `constructor`, `prototype`) prohibidos.
// Lo que no cuadra NO se lee en silencio: la fila se rechaza y se dice por qué.
// ═══════════════════════════════════════════════════════════════════════════

export const TRANSFORMACIONES = ['numero', 'fecha_local', 'texto', 'booleano'] as const;
export type Transformacion = (typeof TRANSFORMACIONES)[number];

export interface CampoDetallado {
  fuente: string;
  transformar?: Transformacion;
  /** Solo `fecha_local`: zona IANA de la hora sin zona del origen. Por omisión, la de la plataforma. */
  zona?: string;
  /** Solo `fecha_local`: patrón con yyyy, MM, dd, H, HH, mm, ss (p. ej. 'dd/MM/yyyy H:mm'). */
  formato?: string;
  /** Solo `numero`: separador decimal que usa el origen ('.' o ','). Sin declararlo, «d.ddd» es ambiguo y se rechaza (A37-TRANSVERSAL-10). */
  decimal?: '.' | ',';
}
export type CampoMapeo = string | CampoDetallado;

export interface MapeoTms {
  recurso: RecursoTms;
  /** Ruta HTTP relativa al servidor del origen, con «/» inicial. */
  ruta: string;
  metodo: 'GET' | 'POST';
  /** Nombres de los parámetros que el origen espera; el lector los llena con el rango y la página. */
  params: { desde: string; hasta: string; pagina?: string; cursor?: string; tam?: string };
  /** Ruta, dentro de la respuesta, de la lista de filas. Vacío = la respuesta ya es la lista. */
  raiz: string;
  /** destino → ruta de origen (o ruta + transformación). El destino también puede ser anidado. */
  campos: Record<string, CampoMapeo>;
  /** Destinos que, juntos, identifican una fila de forma única (idempotencia). Nunca vacío. */
  clave_externa: string[];
  /** Destinos sin los cuales la fila no sirve. La clave externa es obligatoria aunque no se repita aquí. */
  obligatorios: string[];
}

// ── Topes ────────────────────────────────────────────────────────────────
export const MAX_PROFUNDIDAD = 8;
export const MAX_LARGO_RUTA = 120;
export const MAX_CAMPOS = 100;
export const MAX_FILAS = 10_000;
export const MAX_LARGO_TEXTO = 2_000;
const PROHIBIDOS = new Set(['__proto__', 'constructor', 'prototype']);

// ── Rutas puntuadas ──────────────────────────────────────────────────────
type Segmento = string | number;

/** «a.b[0].c» → ['a','b',0,'c']; string = error en lenguaje llano. */
export function parsearRuta(ruta: string): Segmento[] | string {
  if (typeof ruta !== 'string' || ruta.trim() === '') return 'la ruta está vacía';
  if (ruta.length > MAX_LARGO_RUTA) return `la ruta «${ruta.slice(0, 20)}…» es demasiado larga (máximo ${MAX_LARGO_RUTA} caracteres)`;
  const out: Segmento[] = [];
  const re = /([^.[\]]+)|\[(\d{1,6})\]/gy;
  let pos = 0;
  while (pos < ruta.length) {
    if (ruta[pos] === '.' && out.length > 0 && pos + 1 < ruta.length) pos++;
    re.lastIndex = pos;
    const m = re.exec(ruta);
    if (!m) return `la ruta «${ruta}» no se entiende (use el formato a.b[0].c)`;
    if (m[2] !== undefined) out.push(Number(m[2]));
    else {
      if (PROHIBIDOS.has(m[1])) return `la ruta «${ruta}» usa un nombre no permitido («${m[1]}»)`;
      out.push(m[1]);
    }
    pos = re.lastIndex;
    if (out.length > MAX_PROFUNDIDAD) return `la ruta «${ruta}» es demasiado profunda (máximo ${MAX_PROFUNDIDAD} niveles)`;
  }
  return out.length === 0 ? 'la ruta está vacía' : out;
}

const propio = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function leerSegmentos(origen: unknown, segs: Segmento[]): unknown {
  let cur: unknown = origen;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (typeof s === 'number') {
      if (!Array.isArray(cur) || s >= cur.length) return undefined;
      cur = cur[s];
    } else {
      if (Array.isArray(cur) || !propio(cur, s)) return undefined;
      cur = (cur as Record<string, unknown>)[s];
    }
  }
  return cur;
}

function escribirSegmentos(destino: Record<string, unknown>, segs: Segmento[], valor: unknown): void {
  let cur: Record<string, unknown> | unknown[] = destino;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const ultimo = i === segs.length - 1;
    const llave = s as string & number;
    if (ultimo) { (cur as Record<string | number, unknown>)[llave] = valor; return; }
    const sig = segs[i + 1];
    let hijo = (cur as Record<string | number, unknown>)[llave];
    if (hijo === undefined || hijo === null || typeof hijo !== 'object') {
      hijo = typeof sig === 'number' ? [] : {};
      (cur as Record<string | number, unknown>)[llave] = hijo;
    }
    cur = hijo as Record<string, unknown> | unknown[];
  }
}

/** Lee una ruta puntuada de un objeto. Ruta inválida o ausente → undefined (nunca lanza). */
export function leerRuta(origen: unknown, ruta: string): unknown {
  const segs = parsearRuta(ruta);
  return typeof segs === 'string' ? undefined : leerSegmentos(origen, segs);
}

// ── Transformaciones ─────────────────────────────────────────────────────
type Resultado = { ok: unknown } | { error: string };

/**
 * «189,50» → 189.5 · «1,234.50» → 1234.5 · «1.234,50» → 1234.5 · «1,234» → 1234 (la coma con tres dígitos
 * exactos y sin otro separador es de miles; con uno o dos dígitos es decimal). «$» y espacios se ignoran.
 */
export function aNumero(v: unknown, decimalDeclarado?: '.' | ','): Resultado {
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: v } : { error: 'número no finito' };
  if (typeof v !== 'string') return { error: 'se esperaba un número' };
  const t = v.trim().replace(/^\$\s*/, '').replace(/\s+/g, '');
  if (!/^-?\d[\d.,]*$/.test(t) && !/^-?[.,]\d+$/.test(t)) return { error: `«${v.slice(0, 30)}» no es un número` };
  const neg = t.startsWith('-');
  const s = neg ? t.slice(1) : t;
  const ultPunto = s.lastIndexOf('.');
  const ultComa = s.lastIndexOf(',');
  let normal: string;
  if (decimalDeclarado !== undefined) {
    // Formato declarado: el otro separador solo puede ser de miles (grupos de tres dígitos).
    const miles = decimalDeclarado === '.' ? ',' : '.';
    const partes = s.split(decimalDeclarado);
    if (partes.length > 2) return { error: `«${v.slice(0, 30)}» no es un número` };
    const grupos = partes[0].split(miles);
    if (grupos.length > 1 && (grupos[0].length < 1 || grupos[0].length > 3 || !grupos.slice(1).every((g) => g.length === 3))) return { error: `«${v.slice(0, 30)}» no es un número` };
    if (partes.length === 2 && partes[1].includes(miles)) return { error: `«${v.slice(0, 30)}» no es un número` };
    normal = grupos.join('') + (partes.length === 2 ? `.${partes[1]}` : '');
  } else if (ultPunto >= 0 && ultComa >= 0) {
    const decimal = ultPunto > ultComa ? '.' : ',';
    const miles = decimal === '.' ? ',' : '.';
    normal = s.split(miles).join('').replace(decimal, '.');
  } else if (ultComa >= 0 || ultPunto >= 0) {
    const sep = ultComa >= 0 ? ',' : '.';
    const partes = s.split(sep);
    const cola = partes[partes.length - 1];
    if (partes.length > 2) {
      if (!partes.slice(1).every((p) => p.length === 3)) return { error: `«${v.slice(0, 30)}» no es un número` };
      normal = partes.join('');
    } else if (sep === '.' && cola.length === 3 && /^[1-9]\d{0,2}$/.test(partes[0])) {
      // «1.234»: ¿mil doscientos treinta y cuatro o uno punto doscientos treinta y cuatro? No se adivina (dinero).
      return { error: `«${v.slice(0, 30)}» es ambiguo (¿miles o decimales?): declara «decimal» en el mapeo` };
    } else if (sep === ',' && cola.length === 3 && partes[0].length >= 1 && partes[0].length <= 3 && partes[0] !== '') normal = partes.join('');
    else normal = partes.join('.');
  } else normal = s;
  const n = Number(normal);
  return Number.isFinite(n) ? { ok: neg ? -n : n } : { error: `«${v.slice(0, 30)}» no es un número` };
}

const TOKENS_FECHA = /yyyy|MM|dd|HH|H|mm|ss/g;

export function aFechaLocal(v: unknown, formato: string | undefined, zona: string): Resultado {
  if (typeof v !== 'string' || v.trim() === '') return { error: 'se esperaba una fecha en texto' };
  const t = v.trim();
  if (formato === undefined) {
    // Sin patrón: ISO «AAAA-MM-DD[ T]HH:mm[:ss]» (hora local de la zona) o ISO con zona explícita (Z / ±hh:mm).
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) {
      const ms = Date.parse(t);
      return Number.isFinite(ms) ? { ok: new Date(ms).toISOString() } : { error: `fecha «${t.slice(0, 30)}» ilegible` };
    }
    formato = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(t) ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd HH:mm';
    if (/T/.test(t)) return aFechaLocal(t.replace('T', ' '), formato, zona);
  }
  const orden: string[] = [];
  const fuente = formato
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(TOKENS_FECHA, (tk) => { orden.push(tk); return tk === 'yyyy' ? '(\\d{4})' : tk === 'H' ? '(\\d{1,2})' : '(\\d{2})'; });
  const m = new RegExp(`^${fuente}$`).exec(t);
  if (!m) return { error: `fecha «${t.slice(0, 30)}» no sigue el formato ${formato}` };
  const p: Record<string, number> = { yyyy: 0, MM: 1, dd: 1, HH: 0, H: 0, mm: 0, ss: 0 };
  orden.forEach((tk, i) => { p[tk] = Number(m[i + 1]); });
  const h = orden.includes('HH') ? p.HH : p.H;
  const f = new Date(Date.UTC(p.yyyy, p.MM - 1, p.dd));
  if (f.getUTCFullYear() !== p.yyyy || f.getUTCMonth() !== p.MM - 1 || f.getUTCDate() !== p.dd || h > 23 || p.mm > 59 || p.ss > 59) {
    return { error: `fecha «${t.slice(0, 30)}» no existe` };
  }
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return { ok: localAUtc(`${pad(p.yyyy, 4)}-${pad(p.MM)}-${pad(p.dd)} ${pad(h)}:${pad(p.mm)}:${pad(p.ss)}`, zona).toISOString() };
}

const VERDAD = new Set(['true', '1', 'si', 'sí', 's', 'yes', 'y']);
const FALSO = new Set(['false', '0', 'no', 'n']);
export function aBooleano(v: unknown): Resultado {
  if (typeof v === 'boolean') return { ok: v };
  if (typeof v === 'number' && (v === 0 || v === 1)) return { ok: v === 1 };
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (VERDAD.has(t)) return { ok: true };
    if (FALSO.has(t)) return { ok: false };
  }
  return { error: 'se esperaba sí/no' };
}

function aTexto(v: unknown): Resultado {
  if (typeof v === 'string') return { ok: v.trim().slice(0, MAX_LARGO_TEXTO) };
  if (typeof v === 'number' && Number.isFinite(v)) return { ok: String(v) };
  if (typeof v === 'boolean') return { ok: String(v) };
  return { error: 'se esperaba texto' };
}

// ── Validación del mapeo ─────────────────────────────────────────────────
/** Destinos de dinero de liquidaciones y peajes: deben convertirse a número. */
const CAMPOS_DINERO: ReadonlySet<string> = new Set(['cargo', 'abono', 'importe']);
const NOMBRE_PARAM = /^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/;

/** Devuelve los problemas del mapeo en lenguaje llano; lista vacía = válido. */
export function validarMapeo(m: unknown): string[] {
  const e: string[] = [];
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return ['el mapeo debe ser un objeto'];
  const x = m as Partial<MapeoTms>;
  if (!x.recurso || !(RECURSOS_TMS as readonly string[]).includes(x.recurso)) e.push(`el recurso debe ser uno de: ${RECURSOS_TMS.join(', ')}`);
  if (typeof x.ruta !== 'string' || !/^\/[A-Za-z0-9_\-./{}]*$/.test(x.ruta) || x.ruta.includes('..') || x.ruta.includes('//') || x.ruta.length > 200) {
    e.push('la ruta del servicio debe empezar con «/», sin «..», sin «//», sin dirección completa ni parámetros (los parámetros van en «params»)');
  }
  if (x.metodo !== 'GET' && x.metodo !== 'POST') e.push('el método debe ser GET o POST');
  const p = x.params;
  if (!p || typeof p !== 'object') e.push('faltan los «params» (nombres de los parámetros desde y hasta)');
  else {
    for (const k of ['desde', 'hasta'] as const) if (typeof p[k] !== 'string' || !NOMBRE_PARAM.test(p[k])) e.push(`el parámetro «${k}» necesita un nombre válido`);
    for (const k of ['pagina', 'cursor', 'tam'] as const) if (p[k] !== undefined && (typeof p[k] !== 'string' || !NOMBRE_PARAM.test(p[k] as string))) e.push(`el parámetro «${k}» necesita un nombre válido`);
    if (p.pagina !== undefined && p.cursor !== undefined) e.push('use paginación por página o por cursor, no ambas');
  }
  if (typeof x.raiz !== 'string') e.push('falta «raiz» (use cadena vacía si la respuesta ya es la lista)');
  else if (x.raiz !== '') { const r = parsearRuta(x.raiz); if (typeof r === 'string') e.push(`raiz: ${r}`); }
  const campos = x.campos;
  const destinos: string[] = [];
  if (!campos || typeof campos !== 'object' || Array.isArray(campos) || Object.keys(campos).length === 0) e.push('el mapeo necesita al menos un campo en «campos»');
  else if (Object.keys(campos).length > MAX_CAMPOS) e.push(`demasiados campos (máximo ${MAX_CAMPOS})`);
  else {
    for (const [dest, spec] of Object.entries(campos)) {
      destinos.push(dest);
      const d = parsearRuta(dest);
      if (typeof d === 'string') e.push(`campo «${dest.slice(0, 30)}»: ${d}`);
      const det: CampoDetallado | null = typeof spec === 'string' ? { fuente: spec } : spec && typeof spec === 'object' ? spec : null;
      if (!det) { e.push(`campo «${dest}»: debe ser una ruta o un objeto con «fuente»`); continue; }
      const f = parsearRuta(det.fuente);
      if (typeof f === 'string') e.push(`campo «${dest}»: ${f}`);
      if (det.transformar !== undefined && !(TRANSFORMACIONES as readonly string[]).includes(det.transformar)) e.push(`campo «${dest}»: transformación desconocida «${String(det.transformar).slice(0, 20)}»`);
      // A37-TRANSVERSAL-04: sin «numero», un «1,234.50» llega como texto y el renglón se omitía sin aviso (NaN > 0 es falso).
      if ((x.recurso === 'liquidaciones' || x.recurso === 'peajes') && CAMPOS_DINERO.has(dest) && det.transformar !== 'numero') {
        e.push(`campo «${dest}»: en ${x.recurso} un importe debe llevar transformar «numero» (con separador de miles llegaría como texto y se omitiría)`);
      }
      if (det.transformar !== 'fecha_local' && (det.zona !== undefined || det.formato !== undefined)) e.push(`campo «${dest}»: «zona» y «formato» solo aplican a fecha_local`);
      if (det.decimal !== undefined && (det.transformar !== 'numero' || (det.decimal !== '.' && det.decimal !== ','))) e.push(`campo «${dest}»: «decimal» solo aplica a numero y vale «.» o «,»`);
      if (det.zona !== undefined && (typeof det.zona !== 'string' || !zonaValida(det.zona))) e.push(`campo «${dest}»: zona horaria desconocida`);
      if (det.formato !== undefined) {
        if (typeof det.formato !== 'string' || det.formato.length > 40) e.push(`campo «${dest}»: formato de fecha inválido`);
        else {
          const toks: string[] = det.formato.match(TOKENS_FECHA) ?? [];
          if (!toks.includes('yyyy') || !toks.includes('MM') || !toks.includes('dd')) e.push(`campo «${dest}»: el formato de fecha necesita yyyy, MM y dd`);
        }
      }
    }
  }
  if (!Array.isArray(x.clave_externa) || x.clave_externa.length === 0) e.push('falta la «clave_externa»: sin ella no se puede evitar duplicados');
  else for (const c of x.clave_externa) if (!destinos.includes(c)) e.push(`la clave externa «${String(c).slice(0, 30)}» no es un campo del mapeo`);
  if (!Array.isArray(x.obligatorios)) e.push('falta «obligatorios» (puede ir vacío)');
  else for (const c of x.obligatorios) if (!destinos.includes(c)) e.push(`el obligatorio «${String(c).slice(0, 30)}» no es un campo del mapeo`);
  return e;
}

// ── Aplicación ───────────────────────────────────────────────────────────
export interface FilaMapeada<T = Record<string, unknown>> { fila: T; clave: string; indice: number }
export interface ResultadoMapeo<T = Record<string, unknown>> {
  filas: FilaMapeada<T>[];
  rechazadas: FilaRechazadaTms[];
  /** Problema global (mapeo inválido, raíz que no es lista, demasiadas filas): no se leyó ninguna fila. */
  error?: string;
}

/** Aplica el mapeo a la respuesta JSON del origen. Nunca lanza por datos malos: rechaza fila por fila. */
export function aplicarMapeo<T = Record<string, unknown>>(mapeo: MapeoTms, respuesta: unknown): ResultadoMapeo<T> {
  const vacio = (error: string): ResultadoMapeo<T> => ({ filas: [], rechazadas: [], error });
  const problemas = validarMapeo(mapeo);
  if (problemas.length > 0) return vacio(`mapeo inválido: ${problemas[0]}`);
  let lista: unknown = respuesta;
  if (mapeo.raiz !== '') {
    lista = leerRuta(respuesta, mapeo.raiz);
    if (lista === undefined) return vacio(`la respuesta no trae «${mapeo.raiz}»`);
  }
  if (!Array.isArray(lista)) return vacio(`«${mapeo.raiz || 'la respuesta'}» no es una lista`);
  if (lista.length > MAX_FILAS) return vacio(`la respuesta trae ${lista.length} filas (máximo ${MAX_FILAS} por lectura)`);

  const plan = Object.entries(mapeo.campos).map(([dest, spec]) => {
    const det: CampoDetallado = typeof spec === 'string' ? { fuente: spec } : spec;
    return { dest, destSegs: parsearRuta(dest) as Segmento[], fuenteSegs: parsearRuta(det.fuente) as Segmento[], det, fuente: det.fuente };
  });
  const obligatorios = new Set([...mapeo.obligatorios, ...mapeo.clave_externa]);
  const filas: FilaMapeada<T>[] = [];
  const rechazadas: FilaRechazadaTms[] = [];
  const vistas = new Set<string>();

  lista.forEach((item, indice) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) { rechazadas.push({ indice, motivo: 'la fila no es un objeto' }); return; }
    const salida: Record<string, unknown> = {};
    const planos: Record<string, unknown> = {};
    for (const c of plan) {
      const crudo = leerSegmentos(item, c.fuenteSegs);
      if (crudo === undefined || crudo === null || (typeof crudo === 'string' && crudo.trim() === '')) {
        if (obligatorios.has(c.dest)) { rechazadas.push({ indice, motivo: `falta «${c.fuente}» (obligatorio para «${c.dest}»)` }); return; }
        continue;
      }
      let r: Resultado;
      switch (c.det.transformar) {
        case 'numero': r = aNumero(crudo, c.det.decimal); break;
        case 'fecha_local': r = aFechaLocal(crudo, c.det.formato, c.det.zona ?? ZONA_POR_OMISION); break;
        case 'booleano': r = aBooleano(crudo); break;
        case 'texto': r = aTexto(crudo); break;
        default: r = typeof crudo === 'string' || typeof crudo === 'number' || typeof crudo === 'boolean'
          ? { ok: typeof crudo === 'string' ? crudo.slice(0, MAX_LARGO_TEXTO) : crudo }
          : { error: 'se esperaba un valor simple (texto, número o sí/no)' };
      }
      if ('error' in r) { rechazadas.push({ indice, motivo: `«${c.fuente}»: ${r.error}` }); return; }
      escribirSegmentos(salida, c.destSegs, r.ok);
      planos[c.dest] = r.ok;
    }
    const clave = JSON.stringify(mapeo.clave_externa.map((k) => planos[k]));
    if (vistas.has(clave)) { rechazadas.push({ indice, motivo: 'clave externa repetida en la misma respuesta' }); return; }
    vistas.add(clave);
    filas.push({ fila: salida as T, clave, indice });
  });
  return { filas, rechazadas };
}
