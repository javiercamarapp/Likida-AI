// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE LA CONSULTA (PULL) DE DESGLOSES EN EL FORMATO «muestra-tms» (r13p, 8-nov-2026).
//
//   ⚠ TODO LO DE ESTE ARCHIVO ES SUPUESTO hasta tener la especificación oficial del API del cliente: ruta, nombres de los parámetros
//   de fechas, paginación, envoltorio, zona horaria de los parámetros y campo que ordena el cursor NO están confirmados. Los valores
//   por omisión de `CONFIG_PULL_MUESTRA_TMS` son una conjetura razonable, no un dato.
//
// Decisión del dueño (8-nov): el cliente NO empuja datos; NOSOTROS CONSULTAMOS (solo lectura, con cuenta de servicio) su API.
// Con este archivo, al llegar la URL y las credenciales reales NO hay que escribir código: se eligen el contrato y la forma de la
// consulta por configuración de plataforma (variables de entorno, un redeploy):
//
//   · LIKIDA_TMS_DESGLOSE_CONTRATO  = `supuesto` (por omisión) | `muestra-tms`   — qué forma tiene la respuesta del TMS
//   · LIKIDA_TMS_DESGLOSE_CONFIG    = JSON con SOLO lo que difiere de los valores por omisión (ver `ConfigPullMuestraTms`)
//   · LIKIDA_TMS_MUESTRA            = `si`   — la MISMA bandera que enciende el formato por empuje; sin ella no se consulta nada
//
// Pura (sin red, sin base, sin credenciales). Una configuración inválida NO se corrige ni se ignora: falla cerrado (ningún lector).
// ═══════════════════════════════════════════════════════════════════════════

import { hoyMx, instanteMx } from '../../formato';
import { CONTRATO_MUESTRA_TMS, CONTRATOS_DESGLOSE_TMS } from './desglose_muestra_tms';

export type NombreContratoDesglose = keyof typeof CONTRATOS_DESGLOSE_TMS;

/** Cómo se escriben las fechas de los parámetros `desde`/`hasta` de la consulta (SUPUESTO). */
export type FormatoFechaParam = 'iso' | 'fecha_hora_mx' | 'fecha_mx';

export interface ConfigPullMuestraTms {
  /** SUPUESTO: ruta GET del recurso (empieza con «/»; sin dirección completa ni consulta). */
  ruta: string;
  /** SUPUESTO: nombres de los parámetros. `pagina`/`tam` en `null` = el API no pagina (una sola petición). */
  params: { desde: string; hasta: string; pagina: string | null; tam: string | null };
  /** SUPUESTO: filas por página pedidas. */
  tamano: number;
  /** SUPUESTO: `arreglo` (el cuerpo ES la lista), `envuelto` (la lista vive en `rutaLista`) o `auto`. */
  envoltorio: 'auto' | 'arreglo' | 'envuelto';
  /** SUPUESTO: dónde vive la lista con `envuelto`/`auto`. */
  rutaLista: string;
  /** SUPUESTO: dónde viene el total de páginas; `null` = no viene (se sigue hasta una página corta o vacía). */
  rutaTotalPaginas: string | null;
  /** SUPUESTO: dónde viene el total de registros; `null` = no viene. Si viene y no coincide con lo leído, NO se recibe nada. */
  rutaTotalRegistros: string | null;
  /** SUPUESTO: campo de la muestra que ordena el cursor y por el que el origen filtra (`Fecha.Termina` = bitácora ya cerrada). */
  campoCursor: 'Fecha.Termina' | 'Fecha.Inicia';
  /** SUPUESTO: formato con que el TMS espera `desde`/`hasta`. `iso` = instante UTC; los `_mx` = hora de México. */
  formatoFechaParam: FormatoFechaParam;
  /** Tope defensivo de páginas por lectura; excederlo NO se da por completo: lanza. */
  maxPaginas: number;
  /** Primer arranque sin cursor: cuántos días atrás se lee (no se pide historial). */
  ventanaInicialDias: number;
}

/** SUPUESTO en cada campo (ver cabecera). */
export const CONFIG_PULL_MUESTRA_TMS: ConfigPullMuestraTms = {
  ruta: '/api/liquidaciones',
  params: { desde: 'desde', hasta: 'hasta', pagina: 'pagina', tam: 'tam' },
  tamano: 100,
  envoltorio: 'auto',
  rutaLista: 'data',
  rutaTotalPaginas: null,
  rutaTotalRegistros: null,
  campoCursor: 'Fecha.Termina',
  formatoFechaParam: 'iso',
  maxPaginas: 50,
  ventanaInicialDias: 2,
};

// ── Validación estricta de lo que llega por configuración ───────────────────

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const NOMBRE_PARAM = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
const SEGMENTO_CAMPO = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const rutaCampoValida = (v: string): boolean => { const p = v.split('.'); return p.length <= 6 && p.every((x) => SEGMENTO_CAMPO.test(x)); };
const RUTA_RECURSO = /^\/[A-Za-z0-9_\-./]{0,199}$/;

export type ResultadoConfigPull = { ok: true; config: ConfigPullMuestraTms } | { ok: false; motivo: string };

const entero = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
const rutaOpc = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' && rutaCampoValida(v) ? v : undefined);

/**
 * Mezcla `ajustes` (JSON parcial) sobre los valores por omisión. Estricta: llave desconocida o valor fuera de rango ⇒ `ok: false`
 * (el motivo nombra la llave, jamás el valor). Nunca lanza.
 */
export function validarConfigPullMuestra(ajustes: unknown): ResultadoConfigPull {
  if (ajustes === undefined) return { ok: true, config: CONFIG_PULL_MUESTRA_TMS };
  if (!esObjeto(ajustes)) return { ok: false, motivo: 'la configuración tiene que ser un objeto' };
  const permitidas = new Set(Object.keys(CONFIG_PULL_MUESTRA_TMS));
  for (const k of Object.keys(ajustes)) if (!permitidas.has(k)) return { ok: false, motivo: `llave desconocida «${k.slice(0, 40)}»` };
  const c: ConfigPullMuestraTms = { ...CONFIG_PULL_MUESTRA_TMS, params: { ...CONFIG_PULL_MUESTRA_TMS.params } };
  const malo = (llave: string) => ({ ok: false as const, motivo: `valor inválido en «${llave}»` });

  if ('ruta' in ajustes) {
    const r = ajustes.ruta;
    if (typeof r !== 'string' || !RUTA_RECURSO.test(r) || r.includes('..') || r.includes('//')) return malo('ruta');
    c.ruta = r;
  }
  if ('params' in ajustes) {
    const p = ajustes.params;
    if (!esObjeto(p)) return malo('params');
    for (const k of Object.keys(p)) if (!['desde', 'hasta', 'pagina', 'tam'].includes(k)) return malo('params');
    for (const k of ['desde', 'hasta'] as const) {
      if (k in p) { if (typeof p[k] !== 'string' || !NOMBRE_PARAM.test(p[k] as string)) return malo(`params.${k}`); c.params[k] = p[k] as string; }
    }
    for (const k of ['pagina', 'tam'] as const) {
      if (k in p) { if (p[k] !== null && (typeof p[k] !== 'string' || !NOMBRE_PARAM.test(p[k] as string))) return malo(`params.${k}`); c.params[k] = p[k] as string | null; }
    }
    if ((c.params.pagina === null) !== (c.params.tam === null)) return { ok: false, motivo: 'params.pagina y params.tam van juntos o ninguno' };
    const nombres = [c.params.desde, c.params.hasta, c.params.pagina, c.params.tam].filter((n): n is string => n !== null);
    if (new Set(nombres).size !== nombres.length) return { ok: false, motivo: 'los nombres de params no pueden repetirse' };
  }
  if ('tamano' in ajustes) { const n = entero(ajustes.tamano, 1, 500); if (n === null) return malo('tamano'); c.tamano = n; }
  if ('maxPaginas' in ajustes) { const n = entero(ajustes.maxPaginas, 1, 200); if (n === null) return malo('maxPaginas'); c.maxPaginas = n; }
  if ('ventanaInicialDias' in ajustes) { const n = entero(ajustes.ventanaInicialDias, 1, 30); if (n === null) return malo('ventanaInicialDias'); c.ventanaInicialDias = n; }
  if ('envoltorio' in ajustes) {
    if (ajustes.envoltorio !== 'auto' && ajustes.envoltorio !== 'arreglo' && ajustes.envoltorio !== 'envuelto') return malo('envoltorio');
    c.envoltorio = ajustes.envoltorio;
  }
  if ('rutaLista' in ajustes) { const r = rutaOpc(ajustes.rutaLista); if (typeof r !== 'string') return malo('rutaLista'); c.rutaLista = r; }
  for (const k of ['rutaTotalPaginas', 'rutaTotalRegistros'] as const) {
    if (k in ajustes) { const r = rutaOpc(ajustes[k]); if (r === undefined) return malo(k); c[k] = r; }
  }
  if ('campoCursor' in ajustes) {
    if (ajustes.campoCursor !== 'Fecha.Termina' && ajustes.campoCursor !== 'Fecha.Inicia') return malo('campoCursor');
    c.campoCursor = ajustes.campoCursor;
  }
  if ('formatoFechaParam' in ajustes) {
    const f = ajustes.formatoFechaParam;
    if (f !== 'iso' && f !== 'fecha_hora_mx' && f !== 'fecha_mx') return malo('formatoFechaParam');
    c.formatoFechaParam = f;
  }
  if (c.envoltorio === 'arreglo' && (c.rutaTotalPaginas !== null || c.rutaTotalRegistros !== null)) {
    return { ok: false, motivo: 'con un arreglo directo no hay dónde leer los totales: quita rutaTotalPaginas/rutaTotalRegistros o usa envoltorio' };
  }
  return { ok: true, config: c };
}

/** Las fechas de los parámetros según el formato configurado (las `_mx` son hora de México, la zona del TMS). */
export function fechaDeParametro(iso: string, formato: FormatoFechaParam): string {
  if (formato === 'iso') return iso;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new RangeError('instante inválido');
  const fecha = new Date(ms);
  return formato === 'fecha_mx' ? hoyMx(fecha) : instanteMx(fecha);
}

// ── Selección por nombre (entorno) ──────────────────────────────────────────

export type SeleccionContrato =
  | { contrato: 'supuesto' }
  | { contrato: typeof CONTRATO_MUESTRA_TMS; config: ConfigPullMuestraTms }
  /** Configuración ilegible o contrato desconocido: ningún lector (falla cerrado). `motivo` no lleva valores. */
  | { contrato: 'invalido'; motivo: string };

/**
 * Qué contrato de desglose usa el pull y con qué forma de consulta. Por omisión `supuesto` (el comportamiento de siempre).
 * `muestra-tms` exige además la bandera `LIKIDA_TMS_MUESTRA=si` (la revisa el cableado, junto con los interruptores de la flota).
 */
export function seleccionarContratoDesglose(env: Readonly<Record<string, string | undefined>> = process.env): SeleccionContrato {
  const nombre = (env.LIKIDA_TMS_DESGLOSE_CONTRATO ?? '').trim();
  if (nombre === '' || nombre === 'supuesto') return { contrato: 'supuesto' };
  if (nombre !== CONTRATO_MUESTRA_TMS) return { contrato: 'invalido', motivo: 'contrato de desglose desconocido' };
  const crudo = (env.LIKIDA_TMS_DESGLOSE_CONFIG ?? '').trim();
  let ajustes: unknown;
  if (crudo !== '') {
    try { ajustes = JSON.parse(crudo) as unknown; } catch { return { contrato: 'invalido', motivo: 'LIKIDA_TMS_DESGLOSE_CONFIG no es JSON' }; }
  }
  const r = validarConfigPullMuestra(ajustes);
  return r.ok ? { contrato: CONTRATO_MUESTRA_TMS, config: r.config } : { contrato: 'invalido', motivo: r.motivo };
}
