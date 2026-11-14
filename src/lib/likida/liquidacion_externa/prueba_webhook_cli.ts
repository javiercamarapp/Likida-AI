// ═══════════════════════════════════════════════════════════════════════════
// NÚCLEO TESTEABLE de `scripts/probar-webhook-liquidaciones.mjs`: genera bitácoras SINTÉTICAS en el formato `muestra-tms`
// y las manda a `POST /api/v1/liquidaciones-externas/desgloses` para ensayar la conexión del cliente.
//
// Reglas de seguridad (todas con prueba):
//   · SIMULACIÓN POR OMISIÓN: manda `Likida-Simular: si`, que valida y responde sin escribir nada. Para escribir de verdad hacen
//     falta DOS banderas explícitas (`--real` y `--confirmo-escritura`).
//   · El token NUNCA viaja por argumento ni se imprime: llega por `deps.leerToken` (diálogo oculto) y cualquier mensaje de error
//     lo redacta. `--dry-run` no lo pide ni toca la red.
//   · Datos claramente ficticios (identificadores `PRB-…`); este repo es público.
// ═══════════════════════════════════════════════════════════════════════════

import { TIPOS_OPERADOR } from './desglose_contrato';

export const RUTA_DESGLOSES = '/api/v1/liquidaciones-externas/desgloses';
export const MAX_POR_PETICION = 100;
export const MAX_TOTAL = 500;
const POR_PETICION_DEFECTO = 35;
const TIEMPO_MAX_MS = 70_000;

export const USO = `Uso:
  node scripts/probar-webhook-liquidaciones.mjs --url <https://…> [--n 5] [--lote 35] [--semilla 1]
        [--padron archivo.json] [--sin-poliza-cada 10] [--reintento] [--dry-run]
        [--real --confirmo-escritura]

  --url        Base o URL completa del endpoint (se completa con ${RUTA_DESGLOSES}). Solo https (http solo en localhost).
  --n          Bitácoras sintéticas a generar (1 a ${MAX_TOTAL}, por omisión 5).
  --lote       Bitácoras por petición (1 a ${MAX_POR_PETICION}, por omisión ${POR_PETICION_DEFECTO}).
  --padron     JSON con [{ "numeroEmpleado": "…", "nombre": "…" }] para usar operadores que ya existen en la flota de prueba.
               Sin él se generan operadores ficticios que la flota no conoce: saldrán en revisión (es lo esperado).
  --reintento  Vuelve a mandar la primera petición para comprobar la idempotencia.
  --dry-run    Imprime el plan y una bitácora de ejemplo; no pide el token ni toca la red.
  Simulación (no escribe nada) es lo predeterminado. El token se pide en un diálogo oculto; no se acepta por argumento.`;

export interface ArgsPrueba {
  url: string;
  n: number;
  lote: number;
  semilla: number;
  simular: boolean;
  dryRun: boolean;
  reintento: boolean;
  padron: string | null;
  sinPolizaCada: number;
}

export type ParseoArgs = { ok: true; args: ArgsPrueba } | { ok: false; error: string };

function entero(v: string | undefined, nombre: string, min: number, max: number): number | string {
  if (v === undefined || !/^\d+$/.test(v)) return `${nombre} tiene que ser un entero.`;
  const n = Number(v);
  return n < min || n > max ? `${nombre} tiene que estar entre ${min} y ${max}.` : n;
}

/** Valida y completa la URL; nunca acepta credenciales dentro de ella. */
export function normalizarUrl(crudo: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try { u = new URL(crudo); } catch { return { ok: false, error: '--url no es una URL válida.' }; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { ok: false, error: '--url tiene que ser https (http solo en localhost).' };
  if (u.username !== '' || u.password !== '') return { ok: false, error: '--url no puede llevar usuario ni contraseña.' };
  if (u.search !== '' || u.hash !== '') return { ok: false, error: '--url no lleva parámetros ni fragmento.' };
  const ruta = u.pathname.replace(/\/+$/, '');
  u.pathname = ruta.endsWith(RUTA_DESGLOSES) ? ruta : `${ruta}${RUTA_DESGLOSES}`;
  return { ok: true, url: u.toString() };
}

export function parsearArgumentos(argv: readonly string[]): ParseoArgs {
  const valores = new Map<string, string>();
  const banderas = new Set<string>();
  const CON_VALOR = ['--url', '--n', '--lote', '--semilla', '--padron', '--sin-poliza-cada'];
  const SIN_VALOR = ['--dry-run', '--reintento', '--real', '--confirmo-escritura'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (CON_VALOR.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { ok: false, error: `${a} necesita un valor.` };
      valores.set(a, v); i += 1;
    } else if (SIN_VALOR.includes(a)) banderas.add(a);
    else if (/token|clave|password|contrase/i.test(a)) return { ok: false, error: 'El token no se acepta por argumento: se pide en un diálogo oculto.' };
    else return { ok: false, error: `Argumento desconocido: ${a}.` };
  }
  const urlCruda = valores.get('--url');
  if (urlCruda === undefined) return { ok: false, error: '--url es obligatoria.' };
  const url = normalizarUrl(urlCruda);
  if (!url.ok) return url;
  const n = entero(valores.get('--n') ?? '5', '--n', 1, MAX_TOTAL);
  if (typeof n === 'string') return { ok: false, error: n };
  const lote = entero(valores.get('--lote') ?? String(POR_PETICION_DEFECTO), '--lote', 1, MAX_POR_PETICION);
  if (typeof lote === 'string') return { ok: false, error: lote };
  const semilla = entero(valores.get('--semilla') ?? '1', '--semilla', 0, 2_000_000_000);
  if (typeof semilla === 'string') return { ok: false, error: semilla };
  const cada = entero(valores.get('--sin-poliza-cada') ?? '10', '--sin-poliza-cada', 0, 1000);
  if (typeof cada === 'string') return { ok: false, error: cada };
  const real = banderas.has('--real');
  if (real !== banderas.has('--confirmo-escritura')) {
    return { ok: false, error: 'Escribir de verdad exige las dos banderas: --real y --confirmo-escritura.' };
  }
  if (real && banderas.has('--dry-run')) return { ok: false, error: '--dry-run no se combina con --real.' };
  return {
    ok: true,
    args: {
      url: url.url, n, lote, semilla, simular: !real, dryRun: banderas.has('--dry-run'), reintento: banderas.has('--reintento'),
      padron: valores.get('--padron') ?? null, sinPolizaCada: cada,
    },
  };
}

// ── Generación sintética ────────────────────────────────────────────────────

export interface OperadorPrueba { numeroEmpleado: string; nombre: string }

/** PRNG determinista (mulberry32): la misma semilla genera siempre el mismo lote. */
export function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Conceptos que el catálogo de la recepción ya reconoce, por lado (así la prueba no mete ruido de «concepto_desconocido»).
const PERCEPCIONES = ['Sueldo semanal', 'Bono de puntualidad', 'Estadía cliente', 'Recolección'] as const;
const DEDUCCIONES = ['Fonacot', 'Infonavit', 'Anticipo de viaje'] as const;

const dos = (n: number) => String(n).padStart(2, '0');
const fechaHora = (ms: number, hora: string) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())} ${hora}`;
};

export function operadoresFicticios(n: number): OperadorPrueba[] {
  return Array.from({ length: n }, (_, i) => ({ numeroEmpleado: String(9001 + i), nombre: `Operador Ficticio ${String(i + 1).padStart(3, '0')}` }));
}

export function validarPadron(crudo: unknown): { ok: true; padron: OperadorPrueba[] } | { ok: false; error: string } {
  if (!Array.isArray(crudo) || crudo.length === 0) return { ok: false, error: 'El padrón tiene que ser una lista no vacía.' };
  const salida: OperadorPrueba[] = [];
  for (const [i, e] of crudo.entries()) {
    const o = e as Record<string, unknown> | null;
    if (o === null || typeof o !== 'object' || typeof o.numeroEmpleado !== 'string' || typeof o.nombre !== 'string' || o.numeroEmpleado.trim() === '' || o.nombre.trim() === '') {
      return { ok: false, error: `Padrón[${i}] tiene que ser { numeroEmpleado, nombre } con texto.` };
    }
    salida.push({ numeroEmpleado: o.numeroEmpleado.trim(), nombre: o.nombre.trim() });
  }
  return { ok: true, padron: salida };
}

export interface OpcionesGeneracion { n: number; semilla: number; padron?: readonly OperadorPrueba[]; sinPolizaCada?: number }

/** Bitácoras sintéticas en formato `muestra-tms`, con montos de 2 decimales, `Neto` que cuadra y los seis tipos de operador en rotación. */
export function generarBitacoras(o: OpcionesGeneracion): Array<Record<string, unknown>> {
  const azar = prng(o.semilla);
  const padron = o.padron && o.padron.length > 0 ? o.padron : operadoresFicticios(Math.min(o.n, 40));
  const base = Date.UTC(2026, 10, 2, 6, 0, 0);
  const salida: Array<Record<string, unknown>> = [];
  for (let i = 0; i < o.n; i++) {
    const op = padron[i % padron.length];
    const nPer = 1 + Math.floor(azar() * PERCEPCIONES.length);
    const nDed = Math.floor(azar() * (DEDUCCIONES.length + 1));
    const monto = (min: number, max: number) => Math.round((min + azar() * (max - min)) * 100) / 100;
    const percepciones = PERCEPCIONES.slice(0, nPer).map((d) => ({ Descripcion: d, Monto: monto(150, 4500) }));
    const deducciones = DEDUCCIONES.slice(0, nDed).map((d) => ({ Descripcion: d, Monto: monto(50, 900) }));
    const cent = (x: number) => Math.round(x * 100);
    const neto = (percepciones.reduce((a, r) => a + cent(r.Monto), 0) - deducciones.reduce((a, r) => a + cent(r.Monto), 0)) / 100;
    const inicio = base + (i % 7) * 86_400_000;
    const id = `PRB-${o.semilla}-${String(i + 1).padStart(4, '0')}`;
    const sinPoliza = (o.sinPolizaCada ?? 10) > 0 && (i + 1) % (o.sinPolizaCada ?? 10) === 0;
    salida.push({
      BitacoraID: id,
      Folio: String(700000 + i),
      NumeroEmpleado: op.numeroEmpleado,
      Operador: op.nombre,
      TipoOperador: TIPOS_OPERADOR[i % TIPOS_OPERADOR.length],
      Unidad: String(100 + (i % 30)).padStart(4, '0'),
      Poliza: sinPoliza ? null : `PRB-POL-${String(i + 1).padStart(4, '0')}`,
      Fecha: { Inicia: fechaHora(inicio, '06:00:00'), Termina: fechaHora(inicio + 5 * 86_400_000, '20:00:00') },
      Percepciones: percepciones,
      Deducciones: deducciones,
      Neto: neto,
    });
  }
  return salida;
}

// ── Envío y resumen ─────────────────────────────────────────────────────────

export interface ResumenPrueba {
  modo: 'simulacion' | 'real';
  peticiones: number;
  enviadas: number;
  aceptadas: number;
  duplicadas: number;
  rechazadas: number;
  /** Rechazos agrupados por causa (código de motivo o `http_<status>`). */
  causas: Record<string, number>;
  estados: Record<string, number>;
  /** Peticiones que no obtuvieron una respuesta de datos (error HTTP o de red). */
  fallos: Array<{ peticion: number; status: number | null; codigo: string }>;
  reintentoIdempotente: boolean | null;
}

export interface DepsPrueba {
  leerToken: () => Promise<string>;
  fetch: typeof fetch;
  leerArchivo: (ruta: string) => Promise<string>;
  escribir: (linea: string) => void;
}

const ACEPTADAS = new Set(['recibida', 'retenida']);

export function redactar(texto: string, token: string): string {
  return token.length === 0 ? texto : texto.split(token).join('[token]');
}

function sumar(m: Record<string, number>, k: string) { m[k] = (m[k] ?? 0) + 1; }

async function enviarLote(
  url: string, token: string, cuerpo: unknown, simular: boolean, f: typeof fetch,
): Promise<{ status: number | null; json: Record<string, unknown> | null; codigo: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIEMPO_MAX_MS);
  try {
    const r = await f(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(simular ? { 'likida-simular': 'si' } : {}) },
      body: JSON.stringify(cuerpo),
    });
    let json: Record<string, unknown> | null = null;
    try { json = (await r.json()) as Record<string, unknown>; } catch { json = null; }
    const err = json && typeof json.error === 'object' && json.error !== null ? (json.error as Record<string, unknown>).codigo : undefined;
    return { status: r.status, json, codigo: typeof err === 'string' ? err : r.ok ? 'ok' : `http_${r.status}` };
  } catch (e) {
    return { status: null, json: null, codigo: (e as Error).name === 'AbortError' ? 'tiempo_agotado' : 'sin_conexion' };
  } finally { clearTimeout(t); }
}

export function formatearResumen(r: ResumenPrueba): string[] {
  const l = [
    `Modo: ${r.modo === 'simulacion' ? 'SIMULACIÓN (no se escribió nada)' : 'REAL (se escribió en la flota de prueba)'}`,
    `Peticiones: ${r.peticiones}  ·  bitácoras enviadas: ${r.enviadas}`,
    `Aceptadas: ${r.aceptadas}  ·  Duplicadas: ${r.duplicadas}  ·  Rechazadas: ${r.rechazadas}`,
    `Estados: ${Object.entries(r.estados).map(([k, v]) => `${k}=${v}`).join(', ') || 'ninguno'}`,
  ];
  if (Object.keys(r.causas).length > 0) l.push(`Causas de rechazo: ${Object.entries(r.causas).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  for (const f of r.fallos) l.push(`Petición ${f.peticion} sin datos: estado ${f.status ?? 'sin respuesta'} (${f.codigo})`);
  if (r.reintentoIdempotente !== null) l.push(`Reintento idempotente: ${r.reintentoIdempotente ? 'sí' : 'NO'}`);
  return l;
}

export async function ejecutarPrueba(args: ArgsPrueba, d: DepsPrueba): Promise<{ codigo: number; resumen: ResumenPrueba | null }> {
  let padron: OperadorPrueba[] | undefined;
  if (args.padron !== null) {
    let crudo: unknown;
    try { crudo = JSON.parse(await d.leerArchivo(args.padron)); } catch { d.escribir('ERROR: no se pudo leer el padrón (JSON inválido o archivo ausente).'); return { codigo: 1, resumen: null }; }
    const v = validarPadron(crudo);
    if (!v.ok) { d.escribir(`ERROR: ${v.error}`); return { codigo: 1, resumen: null }; }
    padron = v.padron;
  }
  const bitacoras = generarBitacoras({ n: args.n, semilla: args.semilla, sinPolizaCada: args.sinPolizaCada, ...(padron ? { padron } : {}) });
  const lotes: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < bitacoras.length; i += args.lote) lotes.push(bitacoras.slice(i, i + args.lote));

  if (args.dryRun) {
    d.escribir(`DRY-RUN: ${bitacoras.length} bitácoras en ${lotes.length} petición(es) a ${args.url}`);
    d.escribir(`Modo: ${args.simular ? 'simulación' : 'real'}. No se pidió token ni se tocó la red. Ejemplo:`);
    d.escribir(JSON.stringify(bitacoras[0], null, 2));
    return { codigo: 0, resumen: null };
  }

  const token = (await d.leerToken()).trim();
  if (token.length === 0) { d.escribir('ERROR: token vacío.'); return { codigo: 1, resumen: null }; }

  const resumen: ResumenPrueba = {
    modo: args.simular ? 'simulacion' : 'real', peticiones: 0, enviadas: 0, aceptadas: 0, duplicadas: 0, rechazadas: 0,
    causas: {}, estados: {}, fallos: [], reintentoIdempotente: null,
  };
  const mandar = async (lote: Array<Record<string, unknown>>, nPeticion: number) => {
    resumen.peticiones += 1;
    const r = await enviarLote(args.url, token, { formato: 'muestra-tms', version: 1, bitacoras: lote }, args.simular, d.fetch);
    const res = r.json && typeof r.json.datos === 'object' && r.json.datos !== null ? ((r.json.datos as Record<string, unknown>).resultados as unknown) : undefined;
    if (r.status === null || r.status >= 300 || !Array.isArray(res)) {
      resumen.fallos.push({ peticion: nPeticion, status: r.status, codigo: redactar(r.codigo, token) });
      resumen.rechazadas += lote.length;
      for (let k = 0; k < lote.length; k++) sumar(resumen.causas, redactar(r.codigo, token));
      return null;
    }
    resumen.enviadas += lote.length;
    for (const x of res as Array<{ estado?: string; motivos?: Array<{ codigo?: string }> }>) {
      const estado = typeof x.estado === 'string' ? x.estado : 'desconocido';
      sumar(resumen.estados, estado);
      if (ACEPTADAS.has(estado)) resumen.aceptadas += 1;
      else if (estado === 'idempotente' || estado === 'correccion_pendiente') resumen.duplicadas += 1;
      else { resumen.rechazadas += 1; sumar(resumen.causas, x.motivos?.[0]?.codigo ?? estado); }
    }
    return res as Array<{ estado?: string }>;
  };
  let primera: Array<{ estado?: string }> | null = null;
  for (const [i, lote] of lotes.entries()) {
    const r = await mandar(lote, i + 1);
    if (i === 0) primera = r;
  }
  if (args.reintento && lotes.length > 0 && primera !== null) {
    // El reintento no se suma a los conteos del lote: se comprueba aparte.
    const copia = structuredClone(resumen);
    const rep = await mandar(lotes[0], lotes.length + 1);
    Object.assign(resumen, copia);
    // Con simulación nada se guardó: repetir da lo mismo que la primera vez. Con envío real todo tiene que volver idempotente
    // salvo lo que nunca se guardó (revisión / no guardada).
    resumen.reintentoIdempotente = rep !== null && (args.simular
      ? JSON.stringify(rep.map((x) => x.estado)) === JSON.stringify(primera.map((x) => x.estado))
      : rep.every((x, i) => x.estado === 'idempotente' || x.estado === primera![i].estado && (x.estado === 'en_revision' || x.estado === 'no_guardada')));
  }
  for (const linea of formatearResumen(resumen)) d.escribir(redactar(linea, token));
  return { codigo: resumen.fallos.length > 0 ? 2 : 0, resumen };
}
