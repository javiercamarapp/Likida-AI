// ═══════════════════════════════════════════════════════════════════════════
// Compuerta del Vigía (T-A4-04): el lector + normalizador del programa de despacho
// reproducen el oráculo con datos REALES, solo en local.
//
//   LIKIDA_PROGRAMA_CSV=<csv crudo> LIKIDA_PROGRAMA_ORACULO=<csv limpio> \
//     npx tsx scripts/verificar-programa-despacho.ts
//   npx tsx scripts/verificar-programa-despacho.ts --csv <ruta> --oraculo <ruta> [--terminal GDL]
//
// Las rutas reales se pasan SIEMPRE por entorno o argumento; el repo es público y
// los archivos reales jamás se copian aquí. La salida son CONTEOS y NÚMEROS DE
// LÍNEA: nunca imprime un valor de celda (cliente, caja, unidad...), para poder
// pegarla tal cual en notas.
//
// Código de salida: 0 sin diferencias y conteos esperados; 1 hay discrepancias
// (se reportan, el oráculo NO se «arregla»); 2 uso o archivo ilegible.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { ResultadoLector } from '../src/lib/likida/vigia/programa/lector';
import type { FilaPrograma, ProgramaNormalizado } from '../src/lib/likida/vigia/programa/normalizar';

// ---------------------------------------------------------------------------
// CSV del oráculo (coma, comillas RFC 4180)

export function parsearCsv(texto: string): string[][] {
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entre = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (entre) {
      if (ch === '"') {
        if (t[i + 1] === '"') { celda += '"'; i++; } else entre = false;
      } else celda += ch;
    } else if (ch === '"') entre = true;
    else if (ch === ',') { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      filas.push(fila); fila = [];
    } else celda += ch;
  }
  if (celda !== '' || fila.length > 0) { fila.push(celda); filas.push(fila); }
  return filas;
}

export interface FilaOraculoCsv {
  lineaCsv: number;
  fecha: string;
  seccion: string;
  num: string;
  caja: string;
  unidad: string;
  transito: string;
  ccp: string;
}

const COLUMNAS_ORACULO = ['linea_csv', 'fecha', 'seccion', '#', 'CAJA', 'UNIDAD', 'TRANSITO', 'CCP'] as const;

export function leerOraculo(texto: string): FilaOraculoCsv[] {
  const tabla = parsearCsv(texto);
  if (tabla.length === 0) throw new Error('El oráculo está vacío.');
  const enc = tabla[0].map((c) => c.trim());
  const idx: Record<string, number> = {};
  for (const col of COLUMNAS_ORACULO) {
    const i = enc.indexOf(col);
    if (i < 0) throw new Error(`Al oráculo le falta la columna «${col}».`);
    idx[col] = i;
  }
  const salida: FilaOraculoCsv[] = [];
  for (const celdas of tabla.slice(1)) {
    if (celdas.every((c) => c.trim() === '')) continue;
    const v = (col: string) => (celdas[idx[col]] ?? '').trim();
    salida.push({
      lineaCsv: Number(v('linea_csv')), fecha: v('fecha'), seccion: v('seccion'), num: v('#'),
      caja: v('CAJA'), unidad: v('UNIDAD'), transito: v('TRANSITO'), ccp: v('CCP'),
    });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Comparación

const TRANSITO_TEXTO: Record<string, string> = {
  patio_nld: 'PATIO NLD', en_ruta: 'EN RUTA', pend_cruce: 'PEND CRUCE', ok: 'OK', na: 'N/A', vacio: '',
};
const CCP_TEXTO: Record<string, string> = {
  listo: 'LISTO', despachado: 'DESPACHADO', pend_reque: 'PEND REQUE CCP', pend_ccp: 'PEND CCP',
  falta_complemento: 'FALTA DE COMPLEMENTO', vacio: '',
};

const mayus = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** Texto del oráculo → lo que debe valer el valor normalizado (sin pasar por el normalizador). */
function esperadoTransito(texto: string): (f: FilaPrograma) => boolean {
  const k = mayus(texto);
  if (k === '') return (f) => f.transito === 'vacio';
  const conocido = Object.entries(TRANSITO_TEXTO).find(([, t]) => t === k);
  if (conocido) return (f) => f.transito === conocido[0];
  if (/^PATIO\b/.test(k)) return (f) => f.transito === 'patio_otro';
  return (f) => f.transito === 'desconocido';
}

function esperadoCcp(texto: string): (f: FilaPrograma) => boolean {
  const k = mayus(texto);
  if (k === '') return (f) => f.ccp === 'vacio';
  const conocido = Object.entries(CCP_TEXTO).find(([, t]) => t === k);
  if (conocido) return (f) => f.ccp === conocido[0];
  return (f) => f.ccp === 'desconocido';
}

/** Sección del oráculo («DOMESTICO MTY-GDL») → tipo del lector. */
function tipoDeSeccion(seccion: string): string {
  const k = mayus(seccion);
  if (k.startsWith('DOMESTICO')) return 'DOMESTICO';
  if (k.startsWith('MOV')) return 'MOV_VACIO';
  return k;
}

export type CampoComparado = 'fecha' | 'seccion' | '#' | 'CAJA' | 'UNIDAD' | 'TRANSITO' | 'CCP';

export interface Diferencias {
  oraculo: number;
  normalizadas: number;
  /** Líneas del oráculo que el normalizador no entregó (o descartó). */
  faltantes: number[];
  /** Líneas entregadas que el oráculo no trae. */
  sobrantes: number[];
  /** Por campo, las líneas cuyo valor no coincide. Solo números de línea. */
  porCampo: Record<CampoComparado, number[]>;
  total: number;
}

export function compararConOraculo(filas: FilaPrograma[], oraculo: FilaOraculoCsv[]): Diferencias {
  const porLinea = new Map<number, FilaPrograma>();
  for (const f of filas) porLinea.set(f.lineaCsv, f);
  const enOraculo = new Set<number>();
  const d: Diferencias = {
    oraculo: oraculo.length, normalizadas: filas.length, faltantes: [], sobrantes: [],
    porCampo: { fecha: [], seccion: [], '#': [], CAJA: [], UNIDAD: [], TRANSITO: [], CCP: [] },
    total: 0,
  };
  for (const o of oraculo) {
    enOraculo.add(o.lineaCsv);
    const f = porLinea.get(o.lineaCsv);
    if (!f) { d.faltantes.push(o.lineaCsv); continue; }
    if ((f.fecha ?? '') !== o.fecha) d.porCampo.fecha.push(o.lineaCsv);
    if (f.tipo !== tipoDeSeccion(o.seccion)) d.porCampo.seccion.push(o.lineaCsv);
    if ((f.num === null ? '' : String(f.num)) !== o.num) d.porCampo['#'].push(o.lineaCsv);
    if ((f.caja ?? '') !== mayus(o.caja)) d.porCampo.CAJA.push(o.lineaCsv);
    if ((f.unidad ?? '') !== mayus(o.unidad)) d.porCampo.UNIDAD.push(o.lineaCsv);
    if (!esperadoTransito(o.transito)(f)) d.porCampo.TRANSITO.push(o.lineaCsv);
    if (!esperadoCcp(o.ccp)(f)) d.porCampo.CCP.push(o.lineaCsv);
  }
  for (const f of filas) if (!enOraculo.has(f.lineaCsv)) d.sobrantes.push(f.lineaCsv);
  d.total = d.faltantes.length + d.sobrantes.length
    + Object.values(d.porCampo).reduce((s, l) => s + l.length, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Conteos esperados (ficha T-A4-04; coinciden con el reporte del levantamiento)

export interface Conteos {
  filas: number;
  dias: number;
  secciones: Record<string, number>;
  cajaLlena: Record<string, number>;
  unidadLlena: Record<string, number>;
  proxy: Record<string, number>;
  transitoImportacion: Record<string, number>;
  ccpListoImportacion: number;
  ccpPendRequeImportacion: number;
}

export const CONTEOS_ESPERADOS: Conteos = {
  filas: 1087,
  dias: 26,
  secciones: { EXPORTACION: 470, IMPORTACION: 460, CANCELACIONES: 106, DOMESTICO: 51 },
  cajaLlena: { EXPORTACION: 352, IMPORTACION: 460 },
  unidadLlena: { EXPORTACION: 345, IMPORTACION: 311 },
  proxy: { EXPORTACION: 292, IMPORTACION: 307 },
  transitoImportacion: { patio_nld: 209, en_ruta: 176, pend_cruce: 68 },
  ccpListoImportacion: 410,
  ccpPendRequeImportacion: 44,
};

function contar<T>(items: T[], clave: (x: T) => string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const x of items) { const k = clave(x); r[k] = (r[k] ?? 0) + 1; }
  return r;
}

export function medirConteos(filas: FilaPrograma[]): Conteos {
  const imp = filas.filter((f) => f.tipo === 'IMPORTACION');
  const tr = contar(imp, (f) => f.transito);
  const proxy = filas.filter((f) =>
    f.caja !== null && f.unidad !== null && (f.ccp === 'listo' || f.ccp === 'despachado'));
  return {
    filas: filas.length,
    dias: new Set(filas.map((f) => f.fecha).filter((x) => x !== null)).size,
    secciones: contar(filas, (f) => f.tipo),
    cajaLlena: contar(filas.filter((f) => f.caja !== null), (f) => f.tipo),
    unidadLlena: contar(filas.filter((f) => f.unidad !== null), (f) => f.tipo),
    proxy: contar(proxy, (f) => f.tipo),
    transitoImportacion: { patio_nld: tr.patio_nld ?? 0, en_ruta: tr.en_ruta ?? 0, pend_cruce: tr.pend_cruce ?? 0 },
    ccpListoImportacion: imp.filter((f) => f.ccp === 'listo').length,
    ccpPendRequeImportacion: imp.filter((f) => f.ccp === 'pend_reque').length,
  };
}

/** Compara los conteos medidos con los esperados; devuelve una línea por desvío (sin valores de celda). */
export function desviosDeConteos(medido: Conteos, esperado: Conteos = CONTEOS_ESPERADOS): string[] {
  const out: string[] = [];
  const cmp = (nombre: string, a: number, b: number) => {
    if (a !== b) out.push(`${nombre}: medido ${a}, esperado ${b}`);
  };
  cmp('filas', medido.filas, esperado.filas);
  cmp('días', medido.dias, esperado.dias);
  const grupos: [string, Record<string, number>, Record<string, number>][] = [
    ['sección', medido.secciones, esperado.secciones],
    ['caja llena', medido.cajaLlena, esperado.cajaLlena],
    ['unidad llena', medido.unidadLlena, esperado.unidadLlena],
    ['proxy listo', medido.proxy, esperado.proxy],
    ['tránsito importación', medido.transitoImportacion, esperado.transitoImportacion],
  ];
  for (const [nombre, m, e] of grupos) {
    for (const k of Object.keys(e)) cmp(`${nombre} ${k}`, m[k] ?? 0, e[k]);
  }
  cmp('CCP LISTO importación', medido.ccpListoImportacion, esperado.ccpListoImportacion);
  cmp('CCP PEND REQUE importación', medido.ccpPendRequeImportacion, esperado.ccpPendRequeImportacion);
  return out;
}

// ---------------------------------------------------------------------------
// Informe (solo conteos y números de línea)

function listaLineas(l: number[], tope = 20): string {
  if (l.length === 0) return 'ninguna';
  const parte = l.slice(0, tope).join(', ');
  return l.length > tope ? `${parte} … (+${l.length - tope})` : parte;
}

export function formatearInforme(
  lector: Pick<ResultadoLector, 'resumen' | 'avisos'>,
  programa: ProgramaNormalizado,
  dif: Diferencias,
  conteos: Conteos,
  desvios: string[],
): string {
  const L: string[] = [];
  L.push('== Compuerta del programa de despacho (solo conteos y líneas) ==');
  L.push(`Líneas del archivo: ${lector.resumen.lineas} · filas leídas: ${lector.resumen.filasLeidas} · avisos del lector: ${lector.avisos.length}`);
  L.push(`Normalizador: ${programa.calidad.leidas} leídas, ${programa.calidad.validas} válidas, ${programa.calidad.descartadas.length} descartadas`);
  L.push(`Oráculo: ${dif.oraculo} filas · normalizadas: ${dif.normalizadas}`);
  L.push(`Conteos: filas ${conteos.filas}, días ${conteos.dias}`);
  L.push(`  secciones ${JSON.stringify(conteos.secciones)}`);
  L.push(`  caja llena ${JSON.stringify(conteos.cajaLlena)} · unidad llena ${JSON.stringify(conteos.unidadLlena)}`);
  L.push(`  proxy (CAJA+UNIDAD+CCP LISTO/DESPACHADO) ${JSON.stringify(conteos.proxy)}`);
  L.push(`  tránsito importación ${JSON.stringify(conteos.transitoImportacion)}`);
  L.push(`  CCP importación: LISTO ${conteos.ccpListoImportacion}, PEND REQUE CCP ${conteos.ccpPendRequeImportacion}`);
  L.push(`Diferencias con el oráculo: ${dif.total}`);
  L.push(`  líneas del oráculo no entregadas: ${dif.faltantes.length} (${listaLineas(dif.faltantes)})`);
  L.push(`  líneas entregadas fuera del oráculo: ${dif.sobrantes.length} (${listaLineas(dif.sobrantes)})`);
  for (const [campo, lineas] of Object.entries(dif.porCampo)) {
    L.push(`  ${campo}: ${lineas.length} (${listaLineas(lineas)})`);
  }
  L.push(`Desvíos de conteo: ${desvios.length}`);
  for (const x of desvios) L.push(`  ${x}`);
  L.push(dif.total === 0 && desvios.length === 0 ? 'RESULTADO: OK (0 diferencias)' : 'RESULTADO: DISCREPANCIA (reportar; no editar el oráculo)');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// CLI

function argumento(argv: string[], nombre: string): string | undefined {
  const i = argv.indexOf(nombre);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: string[], entorno: Record<string, string | undefined> = process.env): Promise<number> {
  const rutaCsv = argumento(argv, '--csv') ?? entorno.LIKIDA_PROGRAMA_CSV;
  const rutaOraculo = argumento(argv, '--oraculo') ?? entorno.LIKIDA_PROGRAMA_ORACULO;
  const terminal = argumento(argv, '--terminal') ?? 'GDL';
  if (!rutaCsv || !rutaOraculo) {
    console.error('Uso: --csv <ruta> --oraculo <ruta> (o LIKIDA_PROGRAMA_CSV y LIKIDA_PROGRAMA_ORACULO).');
    return 2;
  }
  let textoCsv: string;
  let textoOraculo: string;
  try {
    textoCsv = readFileSync(rutaCsv, 'utf8');
    textoOraculo = readFileSync(rutaOraculo, 'utf8');
  } catch (e) {
    console.error(`No se pudo leer un archivo: ${(e as NodeJS.ErrnoException).code ?? 'error'}.`);
    return 2;
  }
  // Alias «@/» del repo para Node puro (sin tsx): un hook de resolución mínimo. Con tsx el alias ya
  // lo resuelve tsconfig y este registro no estorba.
  const raizSrc = pathToFileURL(new URL('../src/', import.meta.url).pathname).href;
  const hook =
    `export async function resolve(s, c, n) {` +
    ` if (s.startsWith('@/')) { const b = ${JSON.stringify(raizSrc)} + s.slice(2);` +
    ` for (const e of ['.ts', '/index.ts']) { try { return await n(b + e, c); } catch {} } }` +
    ` return n(s, c); }`;
  register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);
  // Import dinámico con extensión: corre igual con tsx y con Node (type-stripping); tipos arriba.
  const rutaLector = '../src/lib/likida/vigia/programa/lector.ts';
  const rutaNormalizar = '../src/lib/likida/vigia/programa/normalizar.ts';
  const { leerProgramaCsv } = (await import(rutaLector)) as typeof import('../src/lib/likida/vigia/programa/lector');
  const { normalizarPrograma } = (await import(rutaNormalizar)) as typeof import('../src/lib/likida/vigia/programa/normalizar');

  const lectura = leerProgramaCsv(textoCsv, { terminal });
  const programa = normalizarPrograma(lectura);
  const dif = compararConOraculo(programa.filas, leerOraculo(textoOraculo));
  const conteos = medirConteos(programa.filas);
  const desvios = desviosDeConteos(conteos);
  console.log(formatearInforme(lectura, programa, dif, conteos, desvios));
  return dif.total === 0 && desvios.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    console.error(`Fallo inesperado: ${e instanceof Error ? e.message : 'error'}`);
    process.exit(2);
  });
}
