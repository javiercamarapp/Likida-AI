// ═══════════════════════════════════════════════════════════════════════════
// PERFIL POR CLIENTE-FORMATO — la memoria de «así es el documento de este cliente».
//
// Cada cliente grande manda SU formato. La primera vez, el modelo lo lee y un
// humano corrige/aprueba; de lo aprobado se infiere el MAPEO (qué columna, qué
// etiqueta, qué ruta XML es cada campo del complemento) y se guarda como la
// versión siguiente del perfil. La siguiente vez que llega un documento del
// mismo formato, el mapeo se reaplica SIN modelo (confianza alta, costo cero) y
// el modelo solo completa lo que falte.
//
// Reglas que no se negocian:
//   · se aprende SOLO de lo que un humano aprobó — nunca de la salida cruda del
//     modelo — y NUNCA de un documento con riesgo de inyección (un documento que
//     intenta darle órdenes al modelo no enseña nada);
//   · las versiones son inmutables: aprender es CREAR la siguiente, volver atrás
//     es apuntar a una anterior (la base lo hace cumplir con un trigger);
//   · el mapeo es declarativo (columna/etiqueta/ruta/constante): no hay código
//     ni expresiones que un perfil pueda ejecutar.
//
// Este archivo es PURO: no toca base ni red.
// ═══════════════════════════════════════════════════════════════════════════

import { CAMPOS_DOC, CAMPOS_MERCANCIA, campoDoc, campoMercancia, extraccionVacia, type CampoDoc, type CampoValor, type Extraccion } from './campos';
import { llaveTexto } from './catalogos';
import type { ContenidoDoc, FormatoDoc, Hoja } from './contenido';
import { normalizarNumero, normalizarValor } from './normalizar';
import { bajar } from './xml_ccp';

export type FuenteMapeo =
  | { tipo: 'columna'; encabezado: string }
  | { tipo: 'etiqueta'; etiqueta: string }
  | { tipo: 'ruta'; ruta: string }
  | { tipo: 'constante'; valor: string };

export interface Mapeo {
  campo: string;
  /** `true` = campo de CADA renglón de mercancía; `false` = campo del documento. */
  mercancia: boolean;
  fuente: FuenteMapeo;
  /** Cómo escribe ESTE cliente sus cifras: el carácter de miles (el otro es el decimal). Resuelve «1,200» y «1.500». */
  separadorMiles?: ',' | '.';
}

export interface EjemploPerfil {
  /** Líneas del documento donde aparecieron los valores (nunca el documento entero). */
  evidencias: Array<{ campo: string; linea: string }>;
  campos: Record<string, string>;
}

export interface FirmaPerfil {
  formato: FormatoDoc;
  encabezados?: string[];
  raizXml?: string;
  etiquetas?: string[];
  remitentes?: string[];
}

export interface PerfilVersion {
  version: number;
  mapeos: Mapeo[];
  ejemplos: EjemploPerfil[];
  nota?: string | null;
}

export interface Perfil {
  id: string;
  clave: string;
  nombre: string;
  clienteId: string | null;
  formato: FormatoDoc;
  firma: FirmaPerfil;
  versionActiva: number;
  /** La versión ACTIVA (la que se reaplica). */
  activa: PerfilVersion;
}

export const MAX_MAPEOS = 200;
export const MAX_EJEMPLOS = 5;
/** Con menos que esto un perfil NO se aplica solo: coincidencia dudosa = ninguna. */
export const UMBRAL_COINCIDENCIA = 0.75;
export const CONF_PERFIL = 0.97;
export const CONF_CONSTANTE = 0.9;

export const llaveColumna = (t: string): string =>
  llaveTexto(String(t)).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ── La cabecera de una tabla ────────────────────────────────────────────────

export interface TablaLeida { hoja: string; encabezados: string[]; llaves: string[]; filas: string[][] }

const NO_VACIAS = (f: string[]): number => f.filter((c) => c.trim() !== '').length;
const esNumerica = (c: string): boolean => c.trim() !== '' && normalizarNumero(c).valor !== null;

/** La fila de encabezados: la primera de las 10 primeras con ≥3 celdas, casi todas de texto. */
export function localizarEncabezado(h: Hoja): TablaLeida | null {
  for (let i = 0; i < Math.min(10, h.filas.length); i++) {
    const f = h.filas[i];
    const n = NO_VACIAS(f);
    if (n < 2) continue;
    const textuales = f.filter((c) => c.trim() !== '' && !esNumerica(c)).length;
    if (textuales / n >= 0.8) {
      return { hoja: h.nombre, encabezados: f, llaves: f.map(llaveColumna), filas: h.filas.slice(i + 1).filter((r) => NO_VACIAS(r) > 0) };
    }
  }
  return null;
}

export function tablasDe(contenido: ContenidoDoc): TablaLeida[] {
  return (contenido.tabla ?? []).map(localizarEncabezado).filter((t): t is TablaLeida => t !== null);
}

const FILA_TOTAL = /^\s*(total(es)?|subtotal|suma|gran total)\b/i;
const filasDeDatos = (t: TablaLeida): string[][] => t.filas.filter((r) => !FILA_TOTAL.test(r.find((c) => c.trim() !== '') ?? ''));

// ── La firma ────────────────────────────────────────────────────────────────

const ETIQUETA_LINEA = /^[\s|*•\-–]*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./#()°ºª_-]{1,40}?)\s*[:=]\s*\S/;

export function etiquetasDeTexto(texto: string, max = 12): string[] {
  const out = new Set<string>();
  for (const linea of texto.split(/\r?\n/).slice(0, 400)) {
    const m = ETIQUETA_LINEA.exec(linea.slice(0, 200));
    if (m) { const k = llaveColumna(m[1]); if (k.length >= 3 && k.length <= 40) out.add(k); }
    if (out.size >= max) break;
  }
  return [...out];
}

function raizDe(arbol: unknown): string | null {
  if (!arbol || typeof arbol !== 'object') return null;
  const k = Object.keys(arbol as Record<string, unknown>).find((x) => !x.startsWith('?') && !x.startsWith('@_'));
  return k ?? null;
}

export function dominioDe(remitente: string | null | undefined): string | null {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})\b/i.exec(remitente ?? '');
  return m ? m[1].toLowerCase() : null;
}

export function firmaDe(contenido: ContenidoDoc, remitente?: string | null): FirmaPerfil {
  const firma: FirmaPerfil = { formato: contenido.formato };
  const t = tablasDe(contenido)[0];
  if (t) firma.encabezados = [...new Set(t.llaves.filter(Boolean))].sort().slice(0, 40);
  if (contenido.xml) { const r = raizDe(contenido.xml); if (r) firma.raizXml = r; }
  if (contenido.texto && !contenido.tabla) firma.etiquetas = etiquetasDeTexto(contenido.texto);
  const d = dominioDe(remitente);
  if (d) firma.remitentes = [d];
  return firma;
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a); const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 0..1: cuánto se parece este documento al formato del perfil. Los formatos distintos puntúan 0. */
export function puntuarPerfil(p: Perfil, c: ContenidoDoc, remitente?: string | null): number {
  const grupo = (f: FormatoDoc): string => (f === 'excel' || f === 'csv' ? 'tabla' : f === 'pdf_texto' ? 'pdf' : f);
  if (grupo(p.firma.formato) !== grupo(c.formato)) return 0;
  const dominio = dominioDe(remitente);
  const delRemitente = dominio !== null && (p.firma.remitentes ?? []).includes(dominio);
  let base = 0;
  if (p.firma.encabezados && c.tabla) {
    base = Math.max(0, ...tablasDe(c).map((t) => jaccard(p.firma.encabezados!, t.llaves.filter(Boolean))));
  } else if (p.firma.raizXml && c.xml) {
    base = raizDe(c.xml) === p.firma.raizXml ? 0.9 : 0;
  } else if (p.firma.etiquetas && p.firma.etiquetas.length > 0 && c.texto) {
    const en = new Set(etiquetasDeTexto(c.texto, 40));
    base = p.firma.etiquetas.filter((e) => en.has(e)).length / p.firma.etiquetas.length;
  }
  // El remitente conocido suma, pero NO basta solo: un cliente manda formatos distintos.
  return Math.min(1, base + (delRemitente && base > 0 ? 0.05 : 0));
}

export interface EleccionPerfil { perfil: Perfil | null; puntaje: number; ambiguo: boolean }

/** El perfil que se aplica solo: el mejor ≥ umbral y SIN empate cercano. Si hay duda, ninguno. */
export function elegirPerfil(perfiles: Perfil[], c: ContenidoDoc, remitente?: string | null, clienteId?: string | null): EleccionPerfil {
  const candidatos = perfiles
    .filter((p) => !clienteId || p.clienteId === clienteId || p.clienteId === null)
    .map((p) => ({ p, s: puntuarPerfil(p, c, remitente) }))
    .filter((x) => x.s >= UMBRAL_COINCIDENCIA)
    .sort((a, b) => b.s - a.s);
  if (candidatos.length === 0) return { perfil: null, puntaje: 0, ambiguo: false };
  if (candidatos.length > 1 && candidatos[0].s - candidatos[1].s < 0.05) return { perfil: null, puntaje: candidatos[0].s, ambiguo: true };
  return { perfil: candidatos[0].p, puntaje: candidatos[0].s, ambiguo: false };
}

// ── Aplicar el mapeo ────────────────────────────────────────────────────────

function valor(campo: string, mercancia: boolean, crudo: string | null, evidencia: string, confianza: number, miles?: ',' | '.'): CampoValor | null {
  const def = mercancia ? campoMercancia(campo) : campoDoc(campo);
  if (!def || crudo === null || crudo.trim() === '') return null;
  const n = normalizarValor(def, crudo, { miles });
  if (n.valor === null) return null;
  return { valor: n.valor, confianza: Math.max(0, confianza - n.penalizacion), evidencia: evidencia.slice(0, 200), origen: 'perfil', ...(n.notas.length ? { notas: n.notas } : {}) };
}

export interface ResultadoPerfil { extraccion: Extraccion; avisos: string[]; camposAplicados: number }

function aplicarTabla(m: Mapeo[], c: ContenidoDoc, e: Extraccion, avisos: string[]): void {
  const tablas = tablasDe(c);
  const delDoc = m.filter((x) => !x.mercancia && x.fuente.tipo === 'columna');
  const deMerc = m.filter((x) => x.mercancia && x.fuente.tipo === 'columna');
  // La tabla correcta: la que tiene más de las columnas mapeadas.
  const claves = [...delDoc, ...deMerc].map((x) => llaveColumna((x.fuente as { encabezado: string }).encabezado));
  const t = [...tablas].sort((a, b) => claves.filter((k) => b.llaves.includes(k)).length - claves.filter((k) => a.llaves.includes(k)).length)[0];
  if (!t) return;
  const datos = filasDeDatos(t);
  if (datos.length === 0) { avisos.push('La tabla no trae filas de datos.'); return; }
  const col = (x: Mapeo): number => t.llaves.indexOf(llaveColumna((x.fuente as { encabezado: string }).encabezado));
  // Los campos del documento salen de la primera fila con dato.
  for (const x of delDoc) {
    const i = col(x);
    if (i < 0) { avisos.push(`La columna «${(x.fuente as { encabezado: string }).encabezado}» (${x.campo}) ya no está en este archivo.`); continue; }
    const fila = datos.find((r) => (r[i] ?? '').trim() !== '');
    const v = fila ? valor(x.campo, false, fila[i], `${t.encabezados[i]}: ${fila[i]}`, CONF_PERFIL, x.separadorMiles) : null;
    if (v) e.campos[x.campo] = v;
    // Si la columna del folio trae varios folios distintos, es un archivo de VARIOS embarques.
    if (x.campo === 'folio_cliente') {
      const distintos = new Set(datos.map((r) => (r[i] ?? '').trim()).filter(Boolean));
      if (distintos.size > 1) avisos.push(`El archivo trae ${distintos.size} folios distintos (${[...distintos].slice(0, 3).join(', ')}…): un documento es UN embarque. Se leyó el primero; sube el resto por separado.`);
    }
  }
  if (deMerc.length > 0) {
    for (const r of datos) {
      const fila: Record<string, CampoValor> = {};
      for (const x of deMerc) {
        const i = col(x);
        if (i < 0) continue;
        const v = valor(x.campo, true, r[i] ?? null, `${t.encabezados[i]}: ${r[i] ?? ''}`, CONF_PERFIL, x.separadorMiles);
        if (v) fila[x.campo] = v;
      }
      if (Object.keys(fila).length > 0) e.mercancias.push(fila);
    }
  }
}

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** El valor que sigue a «Etiqueta:» en el texto (hasta el fin de línea o el siguiente separador). */
export function valorDeEtiqueta(texto: string, etiqueta: string): { valor: string; linea: string } | null {
  const lineas = texto.split(/\r?\n/);
  const objetivo = llaveColumna(etiqueta);
  for (const linea of lineas.slice(0, 600)) {
    const corta = linea.slice(0, 400);
    // «Etiqueta: valor», admitiendo varias parejas en la misma línea separadas por | o 2+ espacios.
    for (const trozo of corta.split(/\s{3,}|\s\|\s/)) {
      const m = /^[\s*•\-–]*([^:=]{2,40}?)\s*[:=]\s*(.{1,200})$/.exec(trozo);
      if (m && llaveColumna(m[1]) === objetivo) {
        const v = m[2].trim();
        if (v) return { valor: v, linea: trozo.trim() };
      }
    }
  }
  return null;
}

function aplicarTexto(m: Mapeo[], texto: string, e: Extraccion, avisos: string[]): void {
  const merc: Record<string, CampoValor> = {};
  for (const x of m) {
    if (x.fuente.tipo !== 'etiqueta') continue;
    const r = valorDeEtiqueta(texto, x.fuente.etiqueta);
    if (!r) { avisos.push(`La etiqueta «${x.fuente.etiqueta}» (${x.campo}) no aparece en este documento.`); continue; }
    const v = valor(x.campo, x.mercancia, r.valor, r.linea, CONF_PERFIL - 0.02, x.separadorMiles);
    if (!v) continue;
    if (x.mercancia) merc[x.campo] = v; else e.campos[x.campo] = v;
  }
  if (Object.keys(merc).length > 0) e.mercancias.push(merc);
}

/** Una ruta tipo `Embarque/Origen/@CP` sobre el árbol (los atributos van como `@_CP`). */
export function valorDeRuta(arbol: unknown, ruta: string): string | null {
  const partes = ruta.split('/').filter(Boolean).map((p) => (p.startsWith('@') ? `@_${p.slice(1)}` : p));
  if (partes.length === 0 || partes.length > 12) return null;
  const v = bajar(arbol, ...partes);
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function aplicarXml(m: Mapeo[], arbol: unknown, e: Extraccion, avisos: string[]): void {
  const merc: Record<string, CampoValor> = {};
  for (const x of m) {
    if (x.fuente.tipo !== 'ruta') continue;
    const v0 = valorDeRuta(arbol, x.fuente.ruta);
    if (v0 === null) { avisos.push(`La ruta «${x.fuente.ruta}» (${x.campo}) no existe en este XML.`); continue; }
    const v = valor(x.campo, x.mercancia, v0, `${x.fuente.ruta} = ${v0}`, CONF_PERFIL);
    if (!v) continue;
    if (x.mercancia) merc[x.campo] = v; else e.campos[x.campo] = v;
  }
  if (Object.keys(merc).length > 0) e.mercancias.push(merc);
}

/** Reaplica la versión ACTIVA del perfil. No llama al modelo. */
export function aplicarPerfil(p: Perfil, c: ContenidoDoc): ResultadoPerfil {
  const e = extraccionVacia();
  const avisos: string[] = [];
  const m = p.activa.mapeos;
  if (c.tabla) aplicarTabla(m, c, e, avisos);
  else if (c.xml) aplicarXml(m, c.xml, e, avisos);
  else if (c.texto) aplicarTexto(m, c.texto, e, avisos);
  for (const x of m) {
    if (x.fuente.tipo !== 'constante') continue;
    const v = valor(x.campo, x.mercancia, x.fuente.valor, `Constante del perfil «${p.nombre}»`, CONF_CONSTANTE);
    if (!v) continue;
    if (x.mercancia) {
      if (e.mercancias.length === 0) e.mercancias.push({});
      for (const fila of e.mercancias) if (!fila[x.campo]) fila[x.campo] = v;
    } else if (!e.campos[x.campo]) e.campos[x.campo] = v;
  }
  const n = Object.keys(e.campos).length + e.mercancias.reduce((s, f) => s + Object.keys(f).length, 0);
  return { extraccion: e, avisos, camposAplicados: n };
}

// ── Aprender de lo que un humano aprobó ─────────────────────────────────────

type Igualdad = (celda: string) => boolean;

/** ¿Esta celda del documento ES el valor aprobado? Literal, numérica, o tras normalizarla como el campo. */
function igualdadDe(def: CampoDoc | undefined, final: string): Igualdad {
  return (celda) => {
    const A = celda.trim().toLowerCase(); const B = final.trim().toLowerCase();
    if (A === B) return true;
    const na = normalizarNumero(celda).valor; const nb = normalizarNumero(final).valor;
    if (na !== null && nb !== null && na === nb) return true;
    // «15/10/2026» → 2026-10-15, «Jalisco» → JAL, «Cajas» → XBX: comparar ya NORMALIZADO.
    return !!def && def.tipo !== 'texto' && normalizarValor(def, celda).valor === final;
  };
}

/** Si la cifra es ambigua («1,200», «1.500»), ¿qué separador de miles usa este cliente, dado el valor aprobado? */
function inferirMiles(celda: string, final: string): ',' | '.' | undefined {
  const n = normalizarNumero(celda);
  const f = normalizarNumero(final).valor;
  if (!n.ambiguo || f === null) return undefined;
  const sinComa = Number(celda.replace(/\s/g, '').replace(',', '')); // «1,200» → 1200 (coma = miles)
  const sinPunto = Number(celda.replace(/\s/g, '').replace('.', '')); // «1.500» → 1500 (punto = miles)
  if (celda.includes(',') && sinComa === f) return ',';
  if (celda.includes('.') && sinPunto === f) return '.';
  if (celda.includes('.') && Number(celda) === f) return ','; // el punto es el decimal ⇒ la coma sería miles
  return undefined;
}

function inferirColumna(t: TablaLeida, filas: string[][], final: string, igual: Igualdad): { encabezado: string; miles?: ',' | '.' } | null {
  const candidatas: number[] = [];
  for (let i = 0; i < t.encabezados.length; i++) {
    if (filas.some((r) => (r[i] ?? '').trim() !== '' && igual(r[i]))) candidatas.push(i);
  }
  // Si dos columnas valen lo mismo (peso bruto y peso neto iguales) no se adivina cuál es.
  if (candidatas.length !== 1) return null;
  const i = candidatas[0];
  const fila = filas.find((r) => (r[i] ?? '').trim() !== '' && igual(r[i]));
  return { encabezado: t.encabezados[i], miles: fila ? inferirMiles(fila[i], final) : undefined };
}

function inferirEtiqueta(texto: string, final: string, igual: Igualdad): { etiqueta: string; linea: string; miles?: ',' | '.' } | null {
  const hallazgos: Array<{ etiqueta: string; linea: string; miles?: ',' | '.' }> = [];
  for (const linea of texto.split(/\r?\n/).slice(0, 600)) {
    for (const trozo of linea.slice(0, 400).split(/\s{3,}|\s\|\s/)) {
      const m = /^[\s*•\-–]*([^:=]{2,40}?)\s*[:=]\s*(.{1,200})$/.exec(trozo);
      if (m && igual(m[2])) hallazgos.push({ etiqueta: m[1].trim(), linea: trozo.trim(), miles: inferirMiles(m[2], final) });
    }
  }
  const unicos = new Map(hallazgos.map((h) => [llaveColumna(h.etiqueta), h]));
  return unicos.size === 1 ? [...unicos.values()][0] : null;
}

function inferirRuta(arbol: unknown, final: string, igual: Igualdad): string | null {
  const rutas: string[] = [];
  const caminar = (n: unknown, ruta: string[], prof: number): void => {
    if (prof > 8 || rutas.length > 5) return;
    if (typeof n === 'string') { if (igual(n)) rutas.push(ruta.join('/')); return; }
    if (Array.isArray(n)) { n.slice(0, 1).forEach((x) => caminar(x, ruta, prof + 1)); return; }
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) caminar(v, [...ruta, k.startsWith('@_') ? `@${k.slice(2)}` : k], prof + 1);
    }
  };
  caminar(arbol, [], 0);
  return rutas.length === 1 ? rutas[0] : null;
}

export interface EntradaAprendizaje {
  contenido: ContenidoDoc;
  /** Lo que el humano dejó aprobado (valores finales). */
  final: Extraccion;
  /** La versión activa del perfil (o `null` si es la primera vez). */
  previa: PerfilVersion | null;
  /** El documento intentó darle órdenes al modelo: no se aprende de él. */
  riesgoInyeccion: boolean;
}

export interface ResultadoAprendizaje {
  mapeos: Mapeo[];
  ejemplos: EjemploPerfil[];
  /** Qué cambió, en español (vacío = no hay versión nueva que crear). */
  cambios: string[];
  omitido?: string;
}

const claveMapeo = (m: Pick<Mapeo, 'campo' | 'mercancia'>): string => `${m.mercancia ? 'm' : 'd'}:${m.campo}`;
const mapeoIgual = (a: Mapeo, b: Mapeo): boolean => JSON.stringify(a.fuente) === JSON.stringify(b.fuente) && a.separadorMiles === b.separadorMiles;

export function aprender(inp: EntradaAprendizaje): ResultadoAprendizaje {
  const previos = inp.previa?.mapeos ?? [];
  const ejemplosPrevios = inp.previa?.ejemplos ?? [];
  if (inp.riesgoInyeccion) {
    return { mapeos: previos, ejemplos: ejemplosPrevios, cambios: [], omitido: 'El documento traía texto con forma de instrucción: no se aprende de él.' };
  }
  const c = inp.contenido;
  const nuevos = new Map<string, Mapeo>();
  const evidencias: EjemploPerfil['evidencias'] = [];
  const camposFinales: Record<string, string> = {};
  const tablas = tablasDe(c);

  const intentar = (campo: string, mercancia: boolean, finalV: string, filaIdx: number | null): void => {
    let fuente: FuenteMapeo | null = null;
    let linea = '';
    let miles: ',' | '.' | undefined;
    const igual = igualdadDe(mercancia ? campoMercancia(campo) : campoDoc(campo), finalV);
    if (c.tabla) {
      for (const t of tablas) {
        const datos = filasDeDatos(t);
        // El peso bruto total del documento NO es «la primera fila» si hay varias mercancías: no se aprende.
        if (campo === 'peso_bruto_total' && datos.length > 1) continue;
        const filas = mercancia && filaIdx !== null ? [datos[filaIdx]].filter(Boolean) : datos.slice(0, 1);
        const enc = inferirColumna(t, filas, finalV, igual);
        if (enc) { fuente = { tipo: 'columna', encabezado: enc.encabezado }; miles = enc.miles; linea = `${enc.encabezado}: ${finalV}`; break; }
      }
    } else if (c.xml) {
      const r = inferirRuta(c.xml, finalV, igual);
      if (r) { fuente = { tipo: 'ruta', ruta: r }; linea = `${r} = ${finalV}`; }
    } else if (c.texto) {
      const r = inferirEtiqueta(c.texto, finalV, igual);
      if (r) { fuente = { tipo: 'etiqueta', etiqueta: r.etiqueta }; miles = r.miles; linea = r.linea; }
    }
    if (!fuente) return;
    nuevos.set(claveMapeo({ campo, mercancia }), { campo, mercancia, fuente, ...(miles ? { separadorMiles: miles } : {}) });
    evidencias.push({ campo: mercancia ? `mercancia.${campo}` : campo, linea: linea.slice(0, 200) });
  };

  for (const def of CAMPOS_DOC) {
    const v = inp.final.campos[def.clave]?.valor;
    if (typeof v === 'string' && v !== '') { camposFinales[def.clave] = v; intentar(def.clave, false, v, null); }
  }
  inp.final.mercancias.forEach((fila, idx) => {
    for (const def of CAMPOS_MERCANCIA) {
      const v = fila[def.clave]?.valor;
      if (typeof v !== 'string' || v === '') continue;
      if (idx === 0) camposFinales[`mercancia.${def.clave}`] = v;
      // Para texto/XML solo el primer renglón puede enseñar la etiqueta (el resto repite).
      if (c.tabla || idx === 0) intentar(def.clave, true, v, idx);
    }
  });

  // Mezcla: lo inferido reemplaza lo previo del mismo campo; lo no tocado se conserva.
  const mezcla = new Map<string, Mapeo>(previos.map((m) => [claveMapeo(m), m]));
  const cambios: string[] = [];
  for (const [k, m] of nuevos) {
    const antes = mezcla.get(k);
    if (!antes) cambios.push(`Nuevo: ${m.mercancia ? 'mercancía · ' : ''}${m.campo} ← ${describir(m.fuente)}`);
    else if (!mapeoIgual(antes, m) && antes.fuente.tipo !== 'constante') cambios.push(`Corregido: ${m.mercancia ? 'mercancía · ' : ''}${m.campo} ← ${describir(m.fuente)} (antes ${describir(antes.fuente)})`);
    else continue;
    mezcla.set(k, m);
  }
  const mapeos = [...mezcla.values()].slice(0, MAX_MAPEOS);

  // El ejemplo se guarda solo si enseñó algo (hubo cambios) — no se llena de repeticiones.
  let ejemplos = ejemplosPrevios;
  if (cambios.length > 0 && evidencias.length > 0) {
    ejemplos = [...ejemplosPrevios, { evidencias: evidencias.slice(0, 20), campos: camposFinales }].slice(-MAX_EJEMPLOS);
  }
  return { mapeos, ejemplos, cambios };
}

export function describir(f: FuenteMapeo): string {
  switch (f.tipo) {
    case 'columna': return `columna «${f.encabezado}»`;
    case 'etiqueta': return `etiqueta «${f.etiqueta}»`;
    case 'ruta': return `ruta ${f.ruta}`;
    case 'constante': return `constante «${f.valor}»`;
  }
}

/** Un slug válido para la clave del perfil (`^[a-z0-9][a-z0-9_-]{0,59}$`). */
export function claveDePerfil(texto: string): string {
  const s = llaveTexto(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s === '' ? 'perfil' : s;
}
