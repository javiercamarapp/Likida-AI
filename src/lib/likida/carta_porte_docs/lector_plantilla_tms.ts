// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DETERMINISTA DE LA PLANTILLA DEL TMS COMO ENTRADA (formatos A y B) — T-A3-47.
//
// El equipo del cliente manda libros con la plantilla del TMS ya llena. Hasta hoy pasaban por el
// modelo como texto `A | B | C` y `localizarEncabezado` (primeras 10 filas) no veía el encabezado de
// la fila 21. Aquí se lee SIN modelo: celdas fijas (B5..B8, remitente C11..C26) y las dos tablas por
// su encabezado real (mercancías ~fila 21, destinos ~fila 49), de la hoja original por coordenada
// (`ContenidoDoc.tabla` descarta las filas vacías y pierde el número de fila, por eso se relee el libro).
//
// · Inversa exacta de `construirPlantilla` (plantilla_tms.ts): exportar y releer da la misma extracción.
// · Cada campo sale con origen `perfil`; ningún dato se inventa (celda vacía = campo ausente).
// · Hojas `Error`, `Informacion Agente Aduanal` y la Guía de llenado se ignoran: no son datos y no
//   cuentan contra `MAX_HOJAS` (ver `hojasDeDatos`).
// · Un libro que no coincide con la plantilla «normal» devuelve `null`: el llamador sigue el flujo actual.
// · La plantilla «nueva» (hojas Datos/Origenes/Destinos) espera a T-A3-44: devuelve `null`.
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { campoDoc, campoMercancia, extraccionVacia, MAX_MERCANCIAS, type CampoDoc, type CampoValor, type Extraccion } from './campos';
import { ESTADOS_SAT } from './catalogos';
import { esHojaIgnorada, esLibroPlantillaTms, llaveHoja } from './contenido';
import { normalizarIdDestino, normalizarNumero, normalizarValor, limpiarTexto } from './normalizar';
import { campoDestino, MAX_DESTINOS } from './plantilla_tms';
import { LAYOUT_NORMAL, type TablaLayout } from './plantilla_tms.layout';

/** Confianza de un valor leído de celda fija (igual que un perfil, `CONF_PERFIL` en perfiles.ts). */
const CONF_PLANTILLA = 0.97;
const TOPE_FILAS = 2000;

const llave = llaveHoja;

const HOJA_REMITENTE = 'remintentedestinatario';
const HOJA_MERCANCIAS = 'mercancias';

/** ¿Es la plantilla «nueva» (varias razones sociales)? Pendiente de T-A3-44. */
export function esLibroPlantillaNueva(nombres: readonly string[]): boolean {
  const k = new Set(nombres.map(llaveHoja));
  return esLibroPlantillaTms(nombres) && ['datos', 'origenes', 'destinos'].some((h) => k.has(h));
}

export interface LecturaPlantillaTms {
  plantilla: 'normal';
  extraccion: Extraccion;
  avisos: string[];
  hojasIgnoradas: string[];
  /** Siempre 0: la lectura es determinista. */
  llamadasLlm: 0;
}

type Crudo = string | number;

function celda(ws: XLSX.WorkSheet | undefined, coord: string): Crudo | null {
  const c = ws?.[coord] as XLSX.CellObject | undefined;
  if (!c || c.v === undefined || c.v === null) return null;
  if (typeof c.v === 'number') return Number.isFinite(c.v) ? c.v : null;
  if (typeof c.v === 'boolean') return c.v ? 'SI' : 'NO';
  if (c.v instanceof Date) return null;
  const t = String(c.v).trim();
  return t === '' ? null : t;
}

function rangoFilas(ws: XLSX.WorkSheet): number {
  return ws['!ref'] ? Math.min(XLSX.utils.decode_range(ws['!ref']).e.r + 1, TOPE_FILAS) : 0;
}

const NOMBRE_A_CODIGO = new Map(ESTADOS_SAT.map((e) => [llave(e.nombre), e.codigo]));

function campoValor(def: CampoDoc | undefined, clave: string, crudo: Crudo, evidencia: string, avisos: string[], etiqueta: string): CampoValor | null {
  let valor: string | null; let notas: string[] = []; let pen = 0;
  if (def) {
    const n = normalizarValor(def, crudo);
    valor = n.valor; notas = n.notas; pen = n.penalizacion;
  } else {
    valor = limpiarTexto(crudo);
  }
  if (valor === null) return null;
  if (notas.length > 0) avisos.push(`${etiqueta}: ${notas.join(' ')}`);
  return { valor, confianza: Math.max(0, CONF_PLANTILLA - pen), evidencia: evidencia.slice(0, 200), origen: 'perfil', ...(notas.length > 0 ? { notas } : {}) };
}

/** Un identificador fiscal extranjero NO es un RFC mexicano: no se le quitan los guiones (T-A3-49 afina el resto). */
function idFiscal(crudo: Crudo, evidencia: string): CampoValor | null {
  const t = limpiarTexto(crudo, 40);
  return t === null ? null : { valor: t.toUpperCase(), confianza: CONF_PLANTILLA, evidencia, origen: 'perfil' };
}

/** Localiza la fila de encabezado: A = «IdDestino/Id Destino» y B empieza con el rótulo dado. */
function filaEncabezado(ws: XLSX.WorkSheet, rotuloB: string, esperada: number): number | null {
  const n = rangoFilas(ws);
  const coincide = (f: number): boolean => llave(celda(ws, `A${f}`)) === 'iddestino' && llave(celda(ws, `B${f}`)).startsWith(rotuloB);
  if (coincide(esperada)) return esperada;
  for (let f = 1; f <= n; f++) if (coincide(f)) return f;
  return null;
}

function tabla(id: TablaLayout['id']): TablaLayout {
  const t = LAYOUT_NORMAL.hojas.flatMap((h) => h.tablas).find((x) => x.id === id);
  if (!t) throw new Error(`El layout no declara la tabla ${id}.`);
  return t;
}

const vaciaDesde = (ws: XLSX.WorkSheet, fila: number, columnas: string[]): boolean => columnas.every((c) => celda(ws, `${c}${fila}`) === null);

/**
 * Lee un libro con la plantilla «normal» ya llena. `null` si el libro no es esa plantilla (sin lanzar): el llamador
 * cae al flujo de siempre. Nunca llama a un modelo.
 */
export function leerPlantillaTms(bytes: Uint8Array): LecturaPlantillaTms | null {
  let libro: XLSX.WorkBook;
  try { libro = XLSX.read(bytes, { type: 'array', cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false, sheetRows: TOPE_FILAS + 1 }); }
  catch { return null; }
  const nombres = libro.SheetNames;
  if (!esLibroPlantillaTms(nombres) || esLibroPlantillaNueva(nombres)) return null;
  const hojaDe = (k: string): XLSX.WorkSheet | undefined => libro.Sheets[nombres.find((n) => llave(n) === k) as string];
  const rd = hojaDe(HOJA_REMITENTE); const me = hojaDe(HOJA_MERCANCIAS);
  if (!rd || !me) return null;

  const tDest = tabla('destinos'); const tMerc = tabla('mercancias');
  const filaDest = filaEncabezado(rd, 'distancia', tDest.filaEncabezado);
  const filaMerc = filaEncabezado(me, 'bienes', tMerc.filaEncabezado);
  if (filaDest === null || filaMerc === null) return null; // sin los dos encabezados reales no es esta plantilla

  const avisos: string[] = [];
  const ext: Extraccion = extraccionVacia();
  const ignoradas = nombres.filter(esHojaIgnorada);

  // ── Celdas fijas (B5..B8 y remitente C11..C26) ────────────────────────────
  const fijas = LAYOUT_NORMAL.hojas.find((h) => llave(h.hoja) === HOJA_REMITENTE)?.celdas ?? [];
  for (const e of fijas) {
    const crudo = celda(rd, e.celda);
    if (crudo === null) continue;
    const esEstadoNombre = e.transformacion === 'nombre_estado';
    // La clave del estado va en C24; el nombre (C25) solo sirve si la clave está vacía.
    if (esEstadoNombre && ext.campos[e.campo]) continue;
    let clave = e.campo === 'ctx.clienteInterno' ? 'numero_cliente_interno' : e.campo;
    let dato: Crudo = crudo;
    if (esEstadoNombre) dato = NOMBRE_A_CODIGO.get(llave(crudo)) ?? crudo;
    if (e.celda === 'B5') clave = 'regimen_aduanero';
    if (ext.campos[clave]) continue;
    const v = campoValor(campoDoc(clave), clave, dato, `RemintenteDestinatario!${e.celda}`, avisos, `${e.celda}`);
    if (v) ext.campos[clave] = v;
  }
  // La clave de estado de C24 gana sobre su nombre: el orden del layout (C24 antes de C25) ya lo garantiza.

  // ── Destinos (tabla del remitente, hasta 4) ───────────────────────────────
  const colsDest = tDest.columnas.filter((c) => c.campo);
  const letrasDest = tDest.columnas.map((c) => c.columna).filter((l) => l !== 'A');
  let nDestinos = 0;
  for (let i = 0; i < MAX_DESTINOS; i++) {
    const fila = filaDest + 1 + i;
    if (vaciaDesde(rd, fila, letrasDest)) continue;
    nDestinos = i + 1;
    for (const col of colsDest) {
      const crudo = celda(rd, `${col.columna}${fila}`);
      if (crudo === null) continue;
      const base = col.campo as string;
      const esNombreEstado = col.transformacion === 'nombre_estado';
      const clave = campoDestino(base, i + 1);
      if (esNombreEstado && ext.campos[clave]) continue;
      const evidencia = `RemintenteDestinatario!${col.columna}${fila}`;
      const dato: Crudo = esNombreEstado ? (NOMBRE_A_CODIGO.get(llave(crudo)) ?? crudo) : crudo;
      let v: CampoValor | null;
      if (base === 'destino_rfc') v = idFiscalODestino(rd, fila, i, crudo, evidencia, avisos);
      else {
        // Los campos `destino_N_*` no están en CAMPOS_DOC: se normalizan con la definición del destino 1.
        const def = campoDoc(base);
        v = campoValor(def, clave, base === 'distancia_km' ? distancia(crudo) : dato, evidencia, avisos, `${col.columna}${fila}`);
      }
      if (v) ext.campos[clave] = v;
    }
  }
  // Más allá de la fila 4 hay más destinos de los que caben: no se pierden en silencio.
  for (let f = filaDest + 1 + MAX_DESTINOS; f <= filaDest + MAX_DESTINOS + 10; f++) {
    if (!vaciaDesde(rd, f, letrasDest)) { avisos.push(`La tabla de destinos trae datos después de la fila ${filaDest + MAX_DESTINOS}: la plantilla admite ${MAX_DESTINOS} destinos y se ignoraron.`); break; }
  }

  // ── Mercancías (encabezado real, normalmente fila 21) ─────────────────────
  const colsMerc = tMerc.columnas.filter((c) => c.campo || c.columna === 'O');
  const letrasMerc = tMerc.columnas.map((c) => c.columna).filter((l) => l !== 'A');
  const ultima = rangoFilas(me);
  let omitidas = 0;
  for (let fila = filaMerc + 1; fila <= ultima; fila++) {
    if (vaciaDesde(me, fila, letrasMerc)) continue;
    if (ext.mercancias.length >= Math.min(tMerc.maxFilas, MAX_MERCANCIAS)) { omitidas++; continue; }
    const m: Record<string, CampoValor> = {};
    for (const col of colsMerc) {
      const crudo = celda(me, `${col.columna}${fila}`);
      if (crudo === null) continue;
      const base = col.columna === 'O' ? 'mercancia.rfc_importador' : (col.campo as string);
      const clave = base.slice('mercancia.'.length);
      const v = campoValor(campoMercancia(clave), clave, crudo, `Mercancias!${col.columna}${fila}`, avisos, `Mercancía ${ext.mercancias.length + 1} · ${col.columna}${fila}`);
      if (v) m[clave] = v;
    }
    // El peligroso «NO» sin clave: la plantilla pone `N/A`, que `limpiarTexto` ya descarta (campo ausente, no «N/A»).
    if (nDestinos > 1) {
      const id = normalizarIdDestino(celda(me, `A${fila}`));
      if (id !== null) m.id_destino = { valor: id, confianza: CONF_PLANTILLA, evidencia: `Mercancias!A${fila}`, origen: 'perfil' };
    }
    const regimen = ext.campos.regimen_aduanero;
    if (regimen && !m.regimen_aduanero) m.regimen_aduanero = { ...regimen };
    ext.mercancias.push(m);
  }
  if (omitidas > 0) avisos.push(`El libro trae ${omitidas} mercancías más de las ${Math.min(tMerc.maxFilas, MAX_MERCANCIAS)} que se leen: se omitieron.`);
  if (ext.mercancias.length === 0) avisos.push('La plantilla no trae mercancías en la tabla de la hoja Mercancias.');
  if (ignoradas.length > 0) avisos.push(`Hojas ignoradas (no son datos): ${ignoradas.join(', ')}.`);

  return { plantilla: 'normal', extraccion: ext, avisos, hojasIgnoradas: ignoradas, llamadasLlm: 0 };
}

/** «874,11 km», «874.11» o 874.11 → «874.11». Si no es un número se deja el texto para que lo vea una persona. */
function distancia(crudo: Crudo): Crudo {
  const n = normalizarNumero(crudo).valor;
  return n === null ? crudo : String(n);
}

/** RFC del destino: con país distinto de MEX es un Tax ID (conserva el guion); con MEX se normaliza como RFC. */
function idFiscalODestino(rd: XLSX.WorkSheet, fila: number, i: number, crudo: Crudo, evidencia: string, avisos: string[]): CampoValor | null {
  const pais = String(celda(rd, `Q${fila}`) ?? '').trim().toUpperCase();
  const clave = campoDestino('destino_rfc', i + 1);
  if (pais !== '' && pais !== 'MEX') return idFiscal(crudo, evidencia);
  return campoValor(campoDoc('destino_rfc'), clave, crudo, evidencia, avisos, `D${fila}`);
}
