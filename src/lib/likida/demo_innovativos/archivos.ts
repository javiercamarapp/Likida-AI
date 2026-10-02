// ═══════════════════════════════════════════════════════════════════════════
// VALIDADOR DE LOS ARCHIVOS DEL CLIENTE DE DEMO — el paso «validación» del kit de
// carga (docs/demo/innovativos.md). Se corre ANTES de cargar nada: dice si el
// archivo que llegó se puede leer, cuántas filas entran, cuáles se rechazan y
// por qué. NO escribe en ninguna base y no toca la red.
//
//   node scripts/demo/innovativos/validar-archivo.mjs <tipo> <ruta>
//   tipos: gps_posiciones | geocercas | pases | tags | casetas | liquidaciones | convenios | whatsapp | carta_porte
//
// TODO se valida con el importador REAL del producto, no con una copia: posiciones y geocercas con el lector de tabla
// propia (conectores/tabla_propia), pases/TAG/casetas con los lectores de peajes, liquidaciones con su esquema, convenios
// con el importador de convenios y el histórico de WhatsApp con el lector del Vigía. Lo único propio de este módulo
// es la forma del informe. Si un importador cambia, el informe cambia con él (y la prueba de muestras lo delata).
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { ErrorTablaPropia } from '../conectores/tabla_propia/contrato';
import { leerGeocercasCsv, leerPosicionesCsv, partirCsv } from '../conectores/tabla_propia/csv';
import { geocercasASitios } from '../conectores/tabla_propia/importar_geocercas';
import { localAUtc } from '../conectores/tabla_propia/tiempo';
import { parsearMatrizConvenios } from '../convenios/importador';
import { cuerposDeLiquidacionesCsv } from '../liquidacion_externa/liquidacion_csv';
import { matrizDeArchivoCatalogo } from '../peajes/archivo';
import { parsearCasetasMatriz } from '../peajes/casetas';
import { interpretarDesglose } from '../peajes/desglose';
import { parsearTagsMatriz } from '../peajes/tags';
import { leerExportWhatsapp } from '../vigia/historial/export_whatsapp';
import { esZip, textoDeZip } from '../vigia/historial/zip_lector';
import { TIPOS_ARCHIVO_KIT, type TipoArchivoKit } from './contratos';

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

// ── gps_posiciones y geocercas (el lector de tabla propia: conectores/tabla_propia) ──────────────────────
/** Los lectores reales lanzan `ErrorTablaPropia` con un motivo apto para el panel: aquí es el problema del archivo. */
function leer<T>(tipo: TipoArchivoKit, f: () => T): T | ResultadoValidacion {
  try { return f(); } catch (e) {
    if (e instanceof ErrorTablaPropia) return res(tipo, [], [e.message]);
    throw e;
  }
}
const esResultado = (x: unknown): x is ResultadoValidacion => typeof x === 'object' && x !== null && 'problemas' in x && 'resumen' in x;

function validarPosiciones(texto: string): ResultadoValidacion {
  const r = leer('gps_posiciones', () => leerPosicionesCsv(texto));
  if (esResultado(r)) return r;
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

function validarGeocercas(texto: string): ResultadoValidacion {
  const r = leer('geocercas', () => leerGeocercasCsv(texto));
  if (esResultado(r)) return r;
  const poligonos = r.filas.filter((g) => g.tipo === 'poligono').length;
  const s = geocercasASitios(r.filas);
  const resumen = [
    `${r.filas.length} geocercas (${r.filas.length - poligonos} círculos, ${poligonos} polígonos)`,
    `${s.filas.length} entrarían al catálogo de sitios del Conductor (${s.poligonos} con su polígono nativo)`,
  ];
  const avisos = s.aproximadas.length
    ? [`${s.aproximadas.length} polígono(s) no se pueden guardar nativos (más de 500 vértices o sin área) y entran solo como el círculo que los contiene, marcados aproximados: ${s.aproximadas.map((a) => `${a.codigo}: ${a.radioM} m`).join(', ')}`]
    : [];
  return res('geocercas', resumen, [...r.rechazadas, ...s.rechazadas].map((x) => `fila ${x.fila}: ${x.motivo}`), avisos);
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

// ── tags y casetas (SUS lectores: peajes/tags.ts y peajes/casetas.ts) ───────
function validarTags(nombre: string, bytes: Uint8Array): ResultadoValidacion {
  const m = matrizDeArchivoCatalogo(nombre, bytes);
  if (!m.ok) return res('tags', [], [m.motivo]);
  const l = parsearTagsMatriz(m.matriz);
  if (l.error) return res('tags', [], [l.error]);
  const unidades = new Set(l.tags.map((t) => t.unidadRef));
  return res('tags', [`${l.tags.length} TAG legibles de ${unidades.size} unidades`], l.rechazadas.map((x) => `fila ${x.fila}: ${x.motivo}`),
    ['la unidad de cada TAG se resuelve contra el catálogo de unidades al cargar: las que no existan se rechazan ahí, con su fila']);
}

function validarCasetas(nombre: string, bytes: Uint8Array): ResultadoValidacion {
  const m = matrizDeArchivoCatalogo(nombre, bytes);
  if (!m.ok) return res('casetas', [], [m.motivo]);
  const l = parsearCasetasMatriz(m.matriz);
  if (l.error) return res('casetas', [], [l.error]);
  return res('casetas', [`${l.casetas.length} casetas con coordenadas dentro de México`], l.rechazadas.map((x) => `fila ${x.fila}: ${x.motivo}`));
}

// ── liquidaciones ───────────────────────────────────────────────────────────
function validarLiquidaciones(texto: string): ResultadoValidacion {
  const r = cuerposDeLiquidacionesCsv(texto);
  const resumen = [`${r.cuerpos.length} liquidación(es) listas para POST /v1/liquidaciones-externas`];
  if (r.cuerpos.length) resumen.push(`${r.cuerpos.reduce((s, c) => s + c.conceptos.length, 0)} renglones; ${new Set(r.cuerpos.map((c) => c.operador.numeroEmpleado)).size} operadores`);
  return res('liquidaciones', resumen, r.problemas.map((p) => `${p.clave ?? 'archivo'}${p.fila ? ` (fila ${p.fila})` : ''}: ${p.motivo}`),
    ['el endpoint repite la validación estricta (campos desconocidos, decimales, operador existente); este paso solo adelanta lo que fallaría']);
}

// ── convenios (el importador de convenios: convenios/importador.ts) ─────────────────────────────────────
function validarConvenios(texto: string): ResultadoValidacion {
  const r = parsearMatrizConvenios(partirCsv(texto), { puedeVerFinanzas: true });
  const instr = r.convenios.reduce((s, c) => s + c.instrucciones.length, 0);
  const sin = r.convenios.filter((c) => !c.instrucciones.some((i) => i.categoria === 'reportarse')).length;
  return res('convenios', [`${r.convenios.length} convenios con ${instr} instrucciones de operación`],
    r.errores.map((e) => `${e.fila ? `fila ${e.fila}: ` : ''}${e.motivo}`),
    sin ? [`${sin} convenio(s) sin instrucción «reportarse» (con quién): el operador no sabrá a quién buscar`] : []);
}

// ── whatsapp (el histórico exportado del Vigía: vigia/historial) ────────────────────────────────────────
function validarWhatsapp(nombre: string, bytes: Uint8Array): ResultadoValidacion {
  let texto: string;
  if (esZip(bytes)) {
    const z = textoDeZip(bytes);
    if (!z.ok) return res('whatsapp', [], [z.error]);
    texto = z.texto;
  } else if (/\.zip$/i.test(nombre)) {
    return res('whatsapp', [], ['dice ser .zip pero no se pudo leer como zip']);
  } else texto = decodificar(bytes);
  // Sin los nombres del equipo (los declara la persona en la pantalla «Grupos e histórico») no se separa quién contestó.
  const l = leerExportWhatsapp(texto, { equipo: [], sal: 'validacion' });
  if (l.formato === 'desconocido' || l.mensajes.length === 0) {
    return res('whatsapp', [], ['no se reconoce la exportación de WhatsApp (se esperaba «[dd/mm/aaaa, hh:mm:ss] Nombre: texto» de iOS o «dd/mm/aa hh:mm - Nombre: texto» de Android)']);
  }
  const fechas = l.mensajes.map((m) => m.enviadoEn).sort();
  const avisos = ['para ver tiempos de respuesta, FAQs y tendencias hay que declarar los nombres de tu equipo tal como salen en el chat al importarlo (pantalla «Grupos e histórico»)'];
  if (l.autores < 2) avisos.push('solo hay un autor: ¿es el chat completo del grupo?');
  if (l.fechasInvalidas > 0) avisos.push(`${l.fechasInvalidas} mensaje(s) con una fecha que no se pudo leer`);
  return res('whatsapp', [`formato ${l.formato}: ${l.mensajes.length} mensajes de texto, ${l.autores} autores, ${l.descartados} líneas de sistema o multimedia descartadas`, `del ${fechas[0].slice(0, 10)} al ${fechas[fechas.length - 1].slice(0, 10)}`], [], avisos);
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
    case 'tags': return validarTags(nombre, bytes);
    case 'casetas': return validarCasetas(nombre, bytes);
    case 'liquidaciones': return validarLiquidaciones(decodificar(bytes));
    case 'convenios': return validarConvenios(decodificar(bytes));
    case 'whatsapp': return validarWhatsapp(nombre, bytes);
    case 'carta_porte': return validarCartaPorte(nombre, bytes);
  }
}
