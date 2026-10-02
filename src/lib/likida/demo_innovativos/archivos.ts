// ═══════════════════════════════════════════════════════════════════════════
// VALIDADOR DE LOS ARCHIVOS DE INNOVATIVOS — el paso «validación» del kit de
// carga (docs/demo/innovativos.md). Se corre ANTES de cargar nada: dice si el
// archivo que llegó se puede leer, cuántas filas entran, cuáles se rechazan y
// por qué. NO escribe en ninguna base y no toca la red.
//
//   node scripts/demo/innovativos/validar-archivo.mjs <tipo> <ruta>
//   tipos: gps_posiciones | geocercas | pases | liquidaciones | convenios | whatsapp | carta_porte
//
// Donde el importador real YA existe (pases de peaje, sitios) se valida con SU
// lector, no con una copia. Donde no existe aún (tabla propia, liquidación CSV,
// convenios) se valida contra el contrato de este módulo.
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { parsearCsvSitios } from '../conductor/sitios';
import { matrizDeArchivoCatalogo } from '../peajes/archivo';
import { interpretarDesglose } from '../peajes/desglose';
import { TIPOS_ARCHIVO_KIT, type TipoArchivoKit } from './contratos';
import { leerConveniosCsv } from './convenios_csv';
import { geocercasASitiosCsv, leerGeocercasCsv, leerPosicionesCsv, localAUtc, partirCsv } from './lector_tabla_propia';
import { cuerposDeLiquidacionesCsv } from './liquidacion_csv';

export interface ResultadoValidacion {
  tipo: TipoArchivoKit;
  /** true = se puede cargar tal cual (sin filas rechazadas ni errores de estructura). */
  ok: boolean;
  resumen: string[];
  /** Lo que impide cargar (o filas rechazadas, con su motivo). */
  problemas: string[];
  /** Lo que se puede cargar pero conviene saber. */
  avisos: string[];
}

const MAX_LISTA = 8;
const decodificar = (b: Uint8Array): string => {
  let t = new TextDecoder('utf-8').decode(b);
  if (t.includes('�')) t = new TextDecoder('windows-1252').decode(b);
  return t.replace(/^﻿/, '');
};
const lista = (xs: string[]): string[] => (xs.length > MAX_LISTA ? [...xs.slice(0, MAX_LISTA), `… y ${xs.length - MAX_LISTA} más`] : xs);
const res = (tipo: TipoArchivoKit, resumen: string[], problemas: string[], avisos: string[] = []): ResultadoValidacion =>
  ({ tipo, ok: problemas.length === 0, resumen, problemas: lista(problemas), avisos });

// ── gps_posiciones ──────────────────────────────────────────────────────────
function validarPosiciones(texto: string): ResultadoValidacion {
  const r = leerPosicionesCsv(texto);
  if (r.error) return res('gps_posiciones', [], [r.error]);
  const unidades = new Set(r.filas.map((f) => f.unidad));
  const instantes = r.filas.map((f) => localAUtc(f.fechaHoraLocal).getTime());
  const ultimaPorUnidad = new Map<string, number>();
  r.filas.forEach((f, i) => ultimaPorUnidad.set(f.unidad, Math.max(ultimaPorUnidad.get(f.unidad) ?? 0, instantes[i])));
  const maximo = instantes.length ? Math.max(...instantes) : 0;
  const mudas = [...ultimaPorUnidad].filter(([, t]) => maximo - t > 30 * 60_000).map(([u]) => u);
  const resumen = [`${r.filas.length} posiciones legibles de ${unidades.size} unidades`];
  if (instantes.length) resumen.push(`de ${new Date(Math.min(...instantes)).toISOString()} a ${new Date(maximo).toISOString()} (UTC, ya convertidas desde hora local CDMX)`);
  const avisos: string[] = [];
  if (mudas.length) avisos.push(`${mudas.length} unidad(es) sin lectura en los últimos 30 min del archivo: ${mudas.slice(0, 5).join(', ')}`);
  if (!r.filas.some((f) => f.velocidadKmh !== null)) avisos.push('el archivo no trae velocidad: la conciliación de «en movimiento» no podrá usarla');
  if (!r.filas.some((f) => f.ignicion !== null)) avisos.push('el archivo no trae ignición');
  return res('gps_posiciones', resumen, r.rechazadas.map((x) => `fila ${x.fila}: ${x.motivo}`), avisos);
}

// ── geocercas ───────────────────────────────────────────────────────────────
function validarGeocercas(texto: string): ResultadoValidacion {
  const r = leerGeocercasCsv(texto);
  if (r.error) return res('geocercas', [], [r.error]);
  const poligonos = r.filas.filter((g) => g.tipo === 'poligono').length;
  const s = geocercasASitiosCsv(r.filas);
  const sitios = parsearCsvSitios(s.csv);
  const resumen = [`${r.filas.length} geocercas (${r.filas.length - poligonos} círculos, ${poligonos} polígonos)`, `${sitios.filas.length} entrarían al catálogo de sitios del Conductor`];
  const avisos = s.aproximadas.length
    ? [`${s.aproximadas.length} polígono(s) se aproximan a un círculo que los envuelve (${s.aproximadas.map((a) => `${a.codigo}: ${a.radioM} m`).join(', ')}); el catálogo de sitios solo guarda centro + radio`]
    : [];
  return res('geocercas', resumen, [...r.rechazadas.map((x) => `fila ${x.fila}: ${x.motivo}`), ...sitios.errores.map((e) => `al pasar a sitios, línea ${e.linea}: ${e.mensaje}`)], avisos);
}

// ── pases (SU lector: peajes/desglose.ts) ───────────────────────────────────
function validarPases(nombre: string, bytes: Uint8Array): ResultadoValidacion {
  const m = matrizDeArchivoCatalogo(nombre, bytes);
  if (!m.ok) return res('pases', [], [m.motivo]);
  const l = interpretarDesglose(m.matriz);
  if (l.error) return res('pases', [], [l.error]);
  const tags = new Set(l.lineas.map((x) => x.tag).filter(Boolean));
  const fechas = l.lineas.map((x) => x.fecha).filter((x): x is string => !!x).sort();
  const total = l.lineas.reduce((s, x) => s + x.monto, 0);
  const resumen = [`${l.lineas.length} cruces legibles, ${tags.size} TAG distintos, importe total ${total.toFixed(2)}`];
  if (fechas.length) resumen.push(`del ${fechas[0]} al ${fechas[fechas.length - 1]}`);
  const avisos: string[] = [];
  if (l.lineas.some((x) => !x.tag)) avisos.push(`${l.lineas.filter((x) => !x.tag).length} cruce(s) sin TAG: no se podrán cruzar con una unidad`);
  return res('pases', resumen, l.descartadas.map((x) => `fila ${x.fila}: ${x.motivo}`), avisos);
}

// ── liquidaciones ───────────────────────────────────────────────────────────
function validarLiquidaciones(texto: string): ResultadoValidacion {
  const r = cuerposDeLiquidacionesCsv(texto);
  const resumen = [`${r.cuerpos.length} liquidación(es) listas para POST /v1/liquidaciones-externas`];
  if (r.cuerpos.length) resumen.push(`${r.cuerpos.reduce((s, c) => s + c.conceptos.length, 0)} renglones; ${new Set(r.cuerpos.map((c) => c.operador.numeroEmpleado)).size} operadores`);
  return res('liquidaciones', resumen, r.problemas.map((p) => `${p.clave ?? 'archivo'}${p.fila ? ` (fila ${p.fila})` : ''}: ${p.motivo}`),
    ['el endpoint repite la validación estricta (campos desconocidos, decimales, operador existente); este paso solo adelanta lo que fallaría']);
}

// ── convenios ───────────────────────────────────────────────────────────────
function validarConvenios(texto: string): ResultadoValidacion {
  const r = leerConveniosCsv(texto);
  const instr = r.convenios.reduce((s, c) => s + c.instrucciones.length, 0);
  const sin = r.convenios.filter((c) => !c.instrucciones.some((i) => i.categoria === 'reportarse')).length;
  return res('convenios', [`${r.convenios.length} convenios con ${instr} instrucciones de operación`],
    r.problemas.map((p) => `${p.fila ? `fila ${p.fila}: ` : ''}${p.motivo}`),
    sin ? [`${sin} convenio(s) sin instrucción «reportarse» (con quién): el operador no sabrá a quién buscar`] : []);
}

// ── whatsapp (histórico exportado) ──────────────────────────────────────────
const INVISIBLES = /[‎‏‪-‮﻿]/g;
const ENC_IOS = /^\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]\s*(.*)$/i;
const ENC_ANDROID = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\s+-\s+(.*)$/i;

/** Nombres de las entradas de un .zip leyendo el directorio central (no descomprime). */
export function entradasDeZip(b: Uint8Array): string[] | null {
  if (b.length < 22 || b[0] !== 0x50 || b[1] !== 0x4b) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) return null;
  const n = v.getUint16(fin + 10, true); let o = v.getUint32(fin + 16, true); const nombres: string[] = [];
  for (let k = 0; k < n; k++) {
    if (o + 46 > b.length || v.getUint32(o, true) !== 0x02014b50) return null;
    const ln = v.getUint16(o + 28, true); const lx = v.getUint16(o + 30, true); const lc = v.getUint16(o + 32, true);
    nombres.push(new TextDecoder().decode(b.slice(o + 46, o + 46 + ln))); o += 46 + ln + lx + lc;
  }
  return nombres;
}

export function inspeccionarExportWhatsapp(texto: string): { formato: 'ios' | 'android' | 'desconocido'; encabezados: number; autores: number; sistema: number; ilegibles: number; primera: string | null; ultima: string | null } {
  const autores = new Set<string>(); let ios = 0; let android = 0; let sistema = 0; let ilegibles = 0; const fechas: string[] = [];
  let hayEncabezado = false;
  for (const crudo of texto.replace(INVISIBLES, '').split(/\r?\n/)) {
    const l = crudo.trim(); if (!l) continue;
    const mi = ENC_IOS.exec(l); const ma = mi ? null : ENC_ANDROID.exec(l); const m = mi ?? ma;
    if (!m) { if (!hayEncabezado) ilegibles++; continue; } // las siguientes líneas sin encabezado son continuación de un mensaje
    hayEncabezado = true; if (mi) ios++; else android++;
    const a = +m[3] < 100 ? 2000 + +m[3] : +m[3]; fechas.push(`${a}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`);
    const d = /^([^:]{1,80}):\s/.exec(m[4]);
    if (d) autores.add(d[1].trim()); else sistema++;
  }
  fechas.sort();
  return { formato: ios && ios >= android ? 'ios' : android ? 'android' : 'desconocido', encabezados: ios + android, autores: autores.size, sistema, ilegibles, primera: fechas[0] ?? null, ultima: fechas[fechas.length - 1] ?? null };
}

function validarWhatsapp(nombre: string, bytes: Uint8Array): ResultadoValidacion {
  const zip = entradasDeZip(bytes);
  if (zip) {
    const txt = zip.filter((n) => /\.txt$/i.test(n));
    if (!txt.length) return res('whatsapp', [], ['el .zip no trae ningún .txt (la exportación de WhatsApp debe incluir el chat como texto)']);
    return res('whatsapp', [`.zip válido con ${txt.length} chat(s): ${txt.join(', ')}`], [], ['el importador lo descomprime; para ver el detalle de mensajes, sube el .txt o usa la pantalla «Grupos e histórico»']);
  }
  if (/\.zip$/i.test(nombre)) return res('whatsapp', [], ['dice ser .zip pero no se pudo leer como zip']);
  const i = inspeccionarExportWhatsapp(decodificar(bytes));
  if (i.formato === 'desconocido' || i.encabezados === 0) {
    return res('whatsapp', [], ['no se reconoce la exportación de WhatsApp (se esperaba «[dd/mm/aaaa, hh:mm:ss] Nombre: texto» de iOS o «dd/mm/aa hh:mm - Nombre: texto» de Android)']);
  }
  const avisos: string[] = [];
  if (i.autores < 2) avisos.push('solo hay un autor: ¿es el chat completo del grupo?');
  return res('whatsapp', [`formato ${i.formato}: ${i.encabezados} mensajes, ${i.autores} autores, ${i.sistema} líneas de sistema`, `del ${i.primera} al ${i.ultima}`], [], avisos);
}

// ── carta_porte (el documento del cliente, tal cual) ────────────────────────
const MAX_BYTES_CP = 12_582_912; // cp_documento_bytes_rango (0420)
const MARCAS_ACTIVAS = ['/JavaScript', '/JS', '/Launch', '/OpenAction', '/EmbeddedFile'];

function validarCartaPorte(nombre: string, bytes: Uint8Array): ResultadoValidacion {
  if (bytes.length === 0) return res('carta_porte', [], ['el archivo está vacío']);
  if (bytes.length > MAX_BYTES_CP) return res('carta_porte', [], [`pesa más de ${MAX_BYTES_CP} bytes (tope de la bandeja)`]);
  const ext = (/\.([a-z0-9]+)$/i.exec(nombre)?.[1] ?? '').toLowerCase();
  if (ext === 'pdf') {
    if (new TextDecoder('latin1').decode(bytes.slice(0, 5)) !== '%PDF-') return res('carta_porte', [], ['no empieza con %PDF-']);
    const cuerpo = new TextDecoder('latin1').decode(bytes);
    const activa = MARCAS_ACTIVAS.find((x) => cuerpo.includes(x));
    return res('carta_porte', [`PDF de ${bytes.length} bytes`], activa ? [`contenido activo (${activa}): la bandeja lo marca como riesgo`] : [],
      /\/Type\s*\/Font/.test(cuerpo) ? [] : ['no se ven fuentes de texto: probablemente es un escaneo; se leerá con visión (más lento y de menor confianza)']);
  }
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const libro = XLSX.read(bytes, { type: 'array' });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const filas = hoja ? XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: '' }).filter((f) => f.some((c) => String(c).trim() !== '')) : [];
      if (filas.length < 2) return res('carta_porte', [], ['la primera hoja no trae encabezados y al menos una fila']);
      return res('carta_porte', [`Excel con ${libro.SheetNames.length} hoja(s); la primera: ${filas.length - 1} fila(s) de datos; encabezados: ${(filas[0] as unknown[]).join(' | ')}`], []);
    } catch { return res('carta_porte', [], ['no se pudo abrir el Excel (¿dañado o con contraseña?)']); }
  }
  if (ext === 'csv') {
    const m = partirCsv(decodificar(bytes));
    if (m.length < 2) return res('carta_porte', [], ['el CSV no trae encabezados y al menos una fila']);
    return res('carta_porte', [`CSV con ${m.length - 1} fila(s); encabezados: ${m[0].join(' | ')}`], []);
  }
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    const ok = (bytes[0] === 0x89 && bytes[1] === 0x50) || (bytes[0] === 0xff && bytes[1] === 0xd8);
    return res('carta_porte', [`imagen de ${bytes.length} bytes`], ok ? [] : ['la extensión no corresponde al contenido'], ['una foto/escaneo se lee con visión: pedir el PDF original si existe']);
  }
  if (ext === 'xml') return res('carta_porte', [`XML de ${bytes.length} bytes`], /<\?xml|<cfdi:|<cartaporte/i.test(decodificar(bytes).slice(0, 2000)) ? [] : ['no parece un XML de CFDI / Carta Porte']);
  return res('carta_porte', [], [`formato .${ext || '?'} no soportado (PDF, Excel, CSV, XML, imagen)`]);
}

// ── entrada única ───────────────────────────────────────────────────────────
export function validarArchivo(tipo: string, nombre: string, bytes: Uint8Array): ResultadoValidacion {
  if (!(TIPOS_ARCHIVO_KIT as readonly string[]).includes(tipo)) {
    return { tipo: 'gps_posiciones', ok: false, resumen: [], problemas: [`tipo «${tipo}» desconocido; válidos: ${TIPOS_ARCHIVO_KIT.join(', ')}`], avisos: [] };
  }
  switch (tipo as TipoArchivoKit) {
    case 'gps_posiciones': return validarPosiciones(decodificar(bytes));
    case 'geocercas': return validarGeocercas(decodificar(bytes));
    case 'pases': return validarPases(nombre, bytes);
    case 'liquidaciones': return validarLiquidaciones(decodificar(bytes));
    case 'convenios': return validarConvenios(decodificar(bytes));
    case 'whatsapp': return validarWhatsapp(nombre, bytes);
    case 'carta_porte': return validarCartaPorte(nombre, bytes);
  }
}
