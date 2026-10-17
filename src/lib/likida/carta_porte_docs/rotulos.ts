// ═══════════════════════════════════════════════════════════════════════════
// RÓTULOS DE CORREO — la parte transversal de leer «correos en texto» y sus capturas (T-A3-53).
//
// Un cliente manda sus datos de carga pegados en un correo (o una captura de pantalla del correo) con
// rótulos que NO son los nuestros y, a veces, engañan:
//   · «Clave unidad de producto SAT» es la clave del PRODUCTO, no la de unidad;
//   · «Peso por embalaje» es el peso NETO total, no el bruto ni el de un bulto;
//   · «(20) CAJA» no es una clave: el paréntesis es la CANTIDAD (20) y «CAJA» el texto de la unidad.
// Además la captura trae la interfaz del correo (barra de asunto, «Resumir este correo», botones), puede venir
// de baja resolución y puede llegar CORTADA justo en un rótulo sin valor (antes de la fracción o el pedimento).
//
// Este archivo es PURO: lee el TEXTO ya transcrito (del correo, o de la captura por el modelo de visión) y devuelve una
// Extracción con sus avisos. No toca el modelo, la base ni la red. Los lectores por formato (F1 tabla, F2 bloque «Datos
// para CP:», F3 bloque de rótulos) de T-A3-61 se apoyan en este mapa y en esta detección de corte.
// ═══════════════════════════════════════════════════════════════════════════

import { campoDoc, campoMercancia, extraccionVacia, type CampoValor, type Extraccion, type Origen } from './campos';
import { llaveTexto } from './catalogos';
import { normalizarValor } from './normalizar';

/** Confianza de un valor leído por rótulo, en texto limpio (≥ UMBRAL_CRITICO: no obliga a confirmar). */
export const CONF_ROTULO = 0.93;
/** Un rótulo engañoso se lee bien, pero un poco menos seguro: lo confirma quien revisa. */
export const CONF_ROTULO_ENGANOSO = 0.88;
/** Un valor que sale de una captura de baja resolución nunca pasa de aquí (obliga a confirmar los críticos). */
export const CONF_BAJA_RESOLUCION = 0.55;
/** Una captura con menos píxeles que esto (ancho × alto) es de baja resolución (en las muestras: 337×526 sí; 763×420 no). */
export const AREA_MINIMA_PX = 250_000;

export interface Resolucion { ancho: number; alto: number }

export const esBajaResolucion = (r: Resolucion | null | undefined): boolean => !!r && r.ancho * r.alto < AREA_MINIMA_PX;

// ── El mapa de rótulos ──────────────────────────────────────────────────────

export type TipoPesoRotulo = 'bruto' | 'neto' | 'por embalaje';

export interface RotuloDef {
  /** Campo de la mercancía o del documento al que corresponde; `null` = se reconoce pero no tiene campo (no se lee, no es «corte»). */
  clave: string | null;
  mercancia: boolean;
  /** Si el rótulo dice una cosa y es otra: lo que en realidad es (se anota en el campo). */
  enganoso?: string;
  /** Qué peso es (para que `derivar` use el neto como bruto con su nota). */
  pesoTipo?: TipoPesoRotulo;
  /** Rótulo sin campo en el complemento (p. ej. «Documento: 1 Pedimento»): el valor se conserva en `adicionales` con esta clave. */
  adicional?: string;
}

const merc = (clave: string | null, extra: Partial<RotuloDef> = {}): RotuloDef => ({ clave, mercancia: true, ...extra });
const doc = (clave: string | null): RotuloDef => ({ clave, mercancia: false });

/** Quita asteriscos, puntuación y acentos: «*No. de Caja:» → «no de caja». */
export const llaveRotulo = (t: string): string => llaveTexto(String(t)).replace(/[^a-z0-9ñ]+/g, ' ').trim();

export const MAPA_ROTULOS: Readonly<Record<string, RotuloDef>> = {
  // Descripción y claves de producto
  'descripcion': merc('descripcion'),
  'descripcion de la mercancia': merc('descripcion'),
  'mercancia': merc('descripcion'),
  'bienes transportados': merc('descripcion'),
  'descripcion bienes transportados': merc('descripcion'),
  'descripcion del bien transportado': merc('descripcion'),
  'descripcion de los bienes transportados': merc('descripcion'),
  'bien transportado': merc('descripcion'),
  'clave de producto': merc('bienes_transp'),
  'clave producto': merc('bienes_transp'),
  'clave de producto sat': merc('bienes_transp'),
  'clave sat': merc('bienes_transp'),
  'clave prod serv': merc('bienes_transp'),
  // ENGAÑOSO: dice «unidad de producto» y es la clave del producto.
  'clave unidad de producto sat': merc('bienes_transp', { enganoso: 'es la clave de PRODUCTO (c_ClaveProdServCP), no la clave de unidad' }),
  'clave unidad de producto': merc('bienes_transp', { enganoso: 'es la clave de PRODUCTO (c_ClaveProdServCP), no la clave de unidad' }),
  'fraccion arancelaria': merc('fraccion_arancelaria'),
  'fraccion': merc('fraccion_arancelaria'),
  // Cantidad, unidad y embalaje
  'cantidad': merc('cantidad'),
  'cantidad embalaje': merc('cantidad'),
  'piezas': merc('cantidad'),
  'clave unidad sat': merc('clave_unidad'),
  'clave unidad': merc('clave_unidad'),
  'unidad': merc('clave_unidad'),
  'unidad de medida': merc('clave_unidad'),
  'embalaje': merc('embalaje'),
  'clave embalaje': merc('embalaje'),
  'clave de embalaje': merc('embalaje'),
  'descripcion embalaje': merc('embalaje_descripcion'),
  'descripcion del embalaje': merc('embalaje_descripcion'),
  // «CLABE» por «CLAVE»: el cliente lo escribe mal y es la clave de embalaje.
  'embalaje clabe sat': merc('embalaje'),
  'embalaje clave sat': merc('embalaje'),
  // Pesos
  'peso bruto': merc('peso_kg', { pesoTipo: 'bruto' }),
  'peso total bruto': merc('peso_kg', { pesoTipo: 'bruto' }),
  'peso bruto total': merc('peso_kg', { pesoTipo: 'bruto' }),
  'peso en kilos': merc('peso_kg'),
  'peso kg': merc('peso_kg'),
  'peso kilos': merc('peso_kg'),
  'peso': merc('peso_kg'),
  'peso neto': merc('peso_kg', { pesoTipo: 'neto' }),
  // ENGAÑOSO: «por embalaje» suena a peso de un bulto y es el neto total.
  'peso por embalaje': merc('peso_kg', { pesoTipo: 'por embalaje', enganoso: 'es el peso NETO total, no el bruto ni el de un bulto' }),
  'unidad de peso': merc('peso_unidad'),
  'clave unidad de peso': merc('peso_unidad'),
  'clave de unidad de peso': merc('peso_unidad'),
  'volumen': merc('volumen'),
  // Valor
  'valor': merc('valor_mercancia'),
  'valor mercancia': merc('valor_mercancia'),
  'moneda': merc('moneda'),
  // Aduana
  'pedimento': merc('pedimento'),
  'no de pedimento': merc('pedimento'),
  'regimen': merc('regimen_aduanero'),
  'regimen aduanero': merc('regimen_aduanero'),
  'tipo de materia': merc('tipo_materia'),
  'tipo de documento': merc(null, { adicional: 'tipo_documento' }),
  'documento': merc(null, { adicional: 'tipo_documento' }),
  'rfc importador': merc('rfc_importador'),
  'rfc del importador': merc('rfc_importador'),
  'material peligroso': merc('material_peligroso'),
  'clave material peligroso': merc('clave_material_peligroso'),
  'clave de material peligroso': merc('clave_material_peligroso'),
  // Documento
  'caja': doc('caja_numero'),
  'no de caja': doc('caja_numero'),
  'numero de caja': doc('caja_numero'),
};

export const rotuloDe = (texto: string): RotuloDef | null => MAPA_ROTULOS[llaveRotulo(texto)] ?? null;

// ── La interfaz del correo ──────────────────────────────────────────────────

/** Botones y avisos de la interfaz de correo que la captura arrastra. */
const CHROME_LINEA = /^(?:[\W_]*)(resumir este correo|resumir|responder(?: a todos)?|reenviar|archivar|eliminar|mover(?: a)?|marcar como (?:le[ií]do|no le[ií]do)|etiquetas?|m[aá]s|ver (?:todo|mensaje|original)|descargar|imprimir|traducir|enviado desde mi \w+|bandeja de entrada|mensaje (?:de|para)|resumen generado por ia|\d+ de \d+)(?:[\W_]*)$/i;
/** Encabezados del correo que no son datos de carga. */
const CABECERA_CORREO = /^[\s|*•-]*(de|para|cc|cco|bcc|enviado|enviado el|fecha|from|to|sent|date)\s*:/i;
const LINEA_ASUNTO = /^[\s|*•-]*(?:asunto|subject|re|rv|fwd)\s*:\s*(.*)$/i;

/** «CAJA 53-AB» / «caja no. 53AB» / «caja: ABC123» en el asunto (que además trae referencias internas DN/TRL/LFH que se ignoran). */
export function cajaDelAsunto(asunto: string | null | undefined): string | null {
  const resto = (asunto ?? '').split(/\bcaja\b/i)[1] ?? '';
  const m = /^[\s:#.]*(?:(?:no|n[uú]m|n[uú]mero)\b[\s:#.]*)?([A-Z0-9][A-Z0-9-]{2,13})\b/i.exec(resto.slice(0, 40));
  // Una caja lleva al menos un dígito: «caja aquí» no es la caja «AQU».
  return m && /\d/.test(m[1]) ? m[1].toUpperCase() : null;
}

// ── La lectura ──────────────────────────────────────────────────────────────

export interface Par { rotulo: string; valor: string | null; def: RotuloDef | null }

export interface LecturaRotulos {
  extraccion: Extraccion;
  /** Cuántos rótulos (campos con valor) se reconocieron y mapearon a un campo. */
  reconocidos: number;
  /** Líneas de la interfaz del correo que se descartaron. */
  chrome: string[];
  asunto: string | null;
  /** El texto termina en un rótulo sin valor: la captura llegó cortada. */
  capturaIncompleta: { ultimoRotulo: string } | null;
  bajaResolucion: boolean;
  /** Datos leídos sin campo en el complemento (tipo de documento, peso neto que no se usó…). */
  adicionales: Record<string, string>;
  /** El valor de la fila de título de una tabla vertical («DATOS DE LA MERCANCÍA | 20205»), si la hay. */
  tituloTabla: string | null;
  /**
   * Trae la firma de uno de los formatos de correo conocidos: la tabla «DATOS DE LA MERCANCÍA», el encabezado «Datos para CP:»,
   * el bloque «BIENES TRANSPORTADOS…» o un rótulo engañoso. Sin firma, unas líneas «Cantidad: 10» sueltas no son un bloque.
   */
  firma: boolean;
  avisos: string[];
}

const NO_VACIAS = (f: string[]): number => f.filter((c) => c.trim() !== '').length;
const FILA_TOTAL = /^\s*(total(es)?|subtotal|suma|gran total)\b/i;
const ES_TITULO_TABLA = (l: string): boolean => /\bdatos de la mercancia\b/.test(llaveRotulo(l)) && !/:\s*\S/.test(l);

/** ¿La línea es, ella misma, un rótulo reconocido («Rótulo: v», «Rótulo | v» o el rótulo solo)? Distingue el valor de la línea siguiente. */
export function rotuloDeLinea(l: string): RotuloDef | null {
  const t = l.trim();
  if (/[|\t]/.test(t)) { const c = celdasDe(t).filter((x) => x !== ''); if (c.length >= 2 && rotuloDe(c[0])) return rotuloDe(c[0]); }
  const m = /^[\s|*•-]*([^:]{2,60}?)\s*:/.exec(t);
  return rotuloDe(m ? m[1] : t);
}

function celdasDe(linea: string): string[] {
  const l = linea.trim();
  if (l.includes('|')) return l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  if (l.includes('\t')) return l.split('\t').map((c) => c.trim());
  return l.split(/\s{2,}/).map((c) => c.trim());
}

/** Un «(20) CAJA» no es una clave: es cantidad 20 de «CAJA». */
const PARENTESIS_CANTIDAD = /^\(\s*(\d[\d.,]*)\s*\)\s*(.+)$/;

interface Fila { [clave: string]: CampoValor }

/** Convierte un valor leído bajo UN rótulo en campos (puede dar varios: «(20) CAJA» → cantidad + unidad). */
function aplicarPar(par: Par, valor: string, fila: Fila, docCampos: Record<string, CampoValor>, conf: number, avisos: string[], evidencia: string, origen: Origen = 'llm', adicionales: Record<string, string> = {}): void {
  const def = par.def as RotuloDef;
  const clave = def.clave as string;
  const poner = (destino: Fila | Record<string, CampoValor>, k: string, v: string, c: number, notas: string[] = []): boolean => {
    const d = destino === docCampos ? campoDoc(k) : campoMercancia(k);
    if (!d) return false;
    const n = normalizarValor(d, v);
    if (n.valor === null) return false;
    const todas = [...notas, ...n.notas];
    destino[k] = { valor: n.valor, confianza: Math.max(0, Math.round((c - n.penalizacion) * 1000) / 1000), evidencia: evidencia.slice(0, 200), origen, ...(todas.length ? { notas: todas } : {}) };
    return true;
  };
  if (def.adicional) { adicionales[def.adicional] = valor; return; }
  const destino = def.mercancia ? fila : docCampos;
  const notaEnganoso = def.enganoso ? [`El rótulo «${par.rotulo}» engaña: ${def.enganoso}.`] : [];
  const conf2 = def.enganoso ? Math.min(conf, CONF_ROTULO_ENGANOSO) : conf;

  if (def.mercancia && (clave === 'clave_unidad' || clave === 'embalaje' || clave === 'cantidad')) {
    const p = PARENTESIS_CANTIDAD.exec(valor);
    if (p) {
      // «(20) CAJA»: 20 es la cantidad y CAJA el texto de la unidad (no una clave del SAT).
      if (!fila.cantidad) poner(fila, 'cantidad', p[1], Math.min(conf2, 0.9), [`«${valor}»: el número entre paréntesis es la cantidad.`]);
      poner(fila, clave === 'embalaje' ? 'embalaje_descripcion' : 'unidad_texto', p[2], conf2);
      avisos.push(`«${valor}» (rótulo «${par.rotulo}») se leyó como cantidad ${p[1]} de «${p[2]}», no como una clave.`);
      return;
    }
    if (clave === 'clave_unidad' && !/^[A-Za-z0-9]{2,3}$/.test(valor.trim())) { poner(fila, 'unidad_texto', valor, conf2); return; }
    if (clave === 'embalaje' && !/^[A-Za-z0-9]{1,3}$/.test(valor.trim())) { poner(fila, 'embalaje_descripcion', valor, conf2); return; }
  }
  if (def.mercancia && (clave === 'cantidad' || clave === 'peso_kg')) {
    // «1175 CAJAS DE RASTRILLO», «11385.75KILOS DE RASTRILLO»: la cifra y, pegado, el texto de su unidad.
    const m = /^(\d[\d.,]*)\s*([A-Za-zÁ-ú][^\d]*)$/.exec(valor.trim());
    if (m) {
      if (clave === 'peso_kg') {
        const unidad = m[2].trim().split(/\s+/)[0];
        if (/^(kg|kgs|kgm|kilos?|kilogramos?|ton|tons|tne|toneladas?|lbs?|lbr|libras?|g|gramos?)$/i.test(unidad)) { poner(fila, 'peso_unidad', unidad, conf2); valor = m[1]; }
      } else {
        if (!fila.unidad_texto) poner(fila, 'unidad_texto', m[2].trim(), conf2);
        valor = m[1];
      }
    }
  }
  if (def.mercancia && par.def?.clave === 'descripcion') {
    // «RASTRILLOS 27112003»: la descripción y, al final, la clave de producto de 8 dígitos.
    const f = /^(.*\S)\s+(\d{8})$/.exec(valor);
    if (f && !/^\d{8}\b/.test(valor)) { poner(fila, 'bienes_transp', f[2], conf2); poner(fila, 'descripcion', f[1], conf2); return; }
    // «BIENES TRANSPORTADOS»: a veces antepone la clave de 8 dígitos a la descripción.
    const m = /^(\d{8})\s*[-–:]?\s*(.+)$/.exec(valor);
    if (m) { poner(fila, 'bienes_transp', m[1], conf2); poner(fila, 'descripcion', m[2], conf2); return; }
  }
  if (clave === 'tipo_materia') {
    // «3 producto terminado»: la clave es el número; el texto es su descripción.
    const t = /^(\d{1,2})\s+\S/.exec(valor.trim());
    if (t) { poner(fila, 'tipo_materia', t[1], conf2, [`«${valor.trim()}»: la clave de tipo de materia es ${t[1]}.`]); return; }
  }
  if (clave === 'peso_kg' && def.pesoTipo) {
    // Un renglón puede traer el peso bruto Y el «peso por embalaje» (el neto): el complemento pide el bruto; el otro se conserva aparte.
    const previo = fila.peso_tipo?.valor;
    if (previo === 'bruto' && def.pesoTipo !== 'bruto') {
      adicionales.peso_neto = valor;
      avisos.push(`El documento trae también «${par.rotulo}» (${valor}): es el peso neto y no se usó; el peso es el bruto.`);
      return;
    }
    if (previo && previo !== 'bruto' && def.pesoTipo === 'bruto' && fila.peso_kg?.valor) adicionales.peso_neto = fila.peso_kg.valor;
    poner(fila, 'peso_kg', valor, conf2, notaEnganoso);
    poner(fila, 'peso_tipo', def.pesoTipo, conf2);
    return;
  }
  poner(destino, clave, valor, conf2, notaEnganoso);
}

/**
 * Lee el TEXTO de un correo o de la transcripción de su captura. Devuelve `null` si no hay nada que se parezca a rótulos de
 * carga (el llamador sigue su camino de siempre). Nunca inventa: un rótulo sin valor es un campo vacío, y si es el ÚLTIMO
 * renglón del texto, la captura se declara incompleta.
 */
/** La barra de asunto de una captura trae el asunto y, pegado, el botón de resumen: «ASUNTO   Resumir este correo electrónico». */
const ASUNTO_ANTES_DEL_BOTON = /^(.*?\S)\s*(?:✨\s*)?resumir este correo(?: electr[oó]nico)?\s*$/i;

export interface InterfazSeparada { asunto: string | null; chrome: string[]; lineas: string[] }

/** Separa lo que es de la interfaz del correo (asunto, botones, cabeceras) de las líneas del cuerpo. */
export function separarInterfaz(texto: string): InterfazSeparada {
  const lineasCrudas = texto.replace(/\r/g, '').split('\n');
  const chrome: string[] = [];
  let asunto: string | null = null;
  const lineas: string[] = [];
  let previaNoVacia: string | null = null;
  for (const l of lineasCrudas) {
    const t = l.trim();
    if (t === '') { lineas.push(''); continue; }
    const a = LINEA_ASUNTO.exec(t);
    if (a && asunto === null) { asunto = a[1].trim(); chrome.push(t); previaNoVacia = null; continue; }
    const b = ASUNTO_ANTES_DEL_BOTON.exec(t);
    if (b && asunto === null) { asunto = b[1].replace(/^\[external\]\s*/i, '').trim(); chrome.push(t); previaNoVacia = null; continue; }
    if (CHROME_LINEA.test(t) || CABECERA_CORREO.test(t) || /^[\s|_\-=.·•*]+$/.test(t)) {
      // El botón solo en su línea: el asunto es la línea anterior (la barra de la captura), si aún no hay uno.
      if (asunto === null && /^[\W_]*resumir este correo/i.test(t) && previaNoVacia !== null && lineas.length > 0 && lineas[lineas.length - 1] === previaNoVacia) {
        asunto = previaNoVacia.trim().replace(/^\[external\]\s*/i, ''); lineas.pop();
      }
      chrome.push(t); previaNoVacia = null; continue;
    }
    lineas.push(l); previaNoVacia = l;
  }
  // Líneas del cuerpo, sin las vacías al final.
  while (lineas.length > 0 && lineas[lineas.length - 1].trim() === '') lineas.pop();
  return { asunto, chrome, lineas };
}

export function leerRotulosCorreo(texto: string | null | undefined, opciones: { resolucion?: Resolucion | null; origen?: Origen } = {}): LecturaRotulos | null {
  if (!texto || texto.trim() === '') return null;
  const { asunto, chrome, lineas } = separarInterfaz(texto);
  const origen: Origen = opciones.origen ?? 'llm';
  const adicionales: Record<string, string> = {};
  let tituloTabla: string | null = null;

  const avisos: string[] = [];
  const docCampos: Record<string, CampoValor> = {};
  const filasTabla: Fila[] = [];
  const bloque: Fila = {};
  let reconocidos = 0;
  let ultimo: { rotulo: string; vacio: boolean; def: RotuloDef | null } | null = null;
  let cortadoEnTabla: string | null = null;
  let firma = false;
  const bajaRes = esBajaResolucion(opciones.resolucion);
  const conf = bajaRes ? CONF_BAJA_RESOLUCION : CONF_ROTULO;

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (l.trim() === '') continue;

    // Tabla «DATOS DE LA MERCANCÍA»: el título, la cabecera de rótulos y N filas.
    if (ES_TITULO_TABLA(l) || (celdasDe(l).length >= 3 && celdasDe(l).filter((c) => rotuloDe(c)).length >= 2)) {
      let h = i + (ES_TITULO_TABLA(l) ? 1 : 0);
      while (h < lineas.length && lineas[h].trim() === '') h++;
      const cab = h < lineas.length ? celdasDe(lineas[h]) : [];
      const defs = cab.map((c) => rotuloDe(c));
      if (cab.length >= 2 && defs.filter(Boolean).length >= 2) {
        const filas: string[][] = [];
        let j = h + 1;
        for (; j < lineas.length && lineas[j].trim() !== ''; j++) {
          const c = celdasDe(lineas[j]);
          if (!FILA_TOTAL.test(c.find((x) => x !== '') ?? '')) filas.push(c);
        }
        filas.forEach((c, n) => {
          const fila: Fila = {};
          cab.forEach((rot, k) => {
            const def = defs[k];
            const v = (c[k] ?? '').trim();
            if (!def?.clave || v === '') return;
            aplicarPar({ rotulo: rot, valor: v, def }, v, fila, docCampos, conf, avisos, `${rot}: ${v}`, origen, adicionales);
            reconocidos++;
          });
          // La última fila con menos celdas que la cabecera: la captura se cortó dentro de la tabla.
          if (n === filas.length - 1 && n > 0 && NO_VACIAS(c) < NO_VACIAS(filas[0]) && NO_VACIAS(c) < cab.filter((x) => x.trim() !== '').length) {
            const primeraFaltante = cab.findIndex((_, k) => (c[k] ?? '').trim() === '');
            if (primeraFaltante >= 0) cortadoEnTabla = cab[primeraFaltante];
          }
          if (Object.keys(fila).length > 0) filasTabla.push(fila);
        });
        i = j;
        ultimo = null;
        firma = true;
        continue;
      }
    }

    // Bloque de rótulos: «Rótulo: valor», «Rótulo | valor» (fila de una tabla vertical), «Rótulo:» sin valor o el rótulo solo en su línea
    // con su valor en la línea de abajo.
    const celdas = /[|\t]/.test(l) ? celdasDe(l).filter((c) => c !== '') : [];
    if (celdas.length >= 1 && ES_TITULO_TABLA(celdas[0])) { firma = true; tituloTabla = celdas[1] ?? null; ultimo = null; continue; }
    let rotulo: string; let valor: string;
    if (celdas.length >= 2 && rotuloDe(celdas[0])) { rotulo = celdas[0]; valor = celdas.slice(1).join(' ').trim(); }
    else {
      const m = /^[\s|*•-]*([^:]{2,60}?)\s*:\s*(.*)$/.exec(l);
      rotulo = (m ? m[1] : l).trim();
      valor = m ? m[2].trim() : '';
    }
    const def = rotuloDe(rotulo);
    if (llaveRotulo(rotulo) === 'datos para cp') firma = true;
    if (!def) { ultimo = null; continue; }
    if (def.enganoso || llaveRotulo(rotulo) === 'bienes transportados') firma = true; // «Datos para CP:», saludos, firma: no son rótulos de carga.
    if (valor === '') {
      const sig = lineas[i + 1];
      if (sig !== undefined && sig.trim() !== '' && !rotuloDeLinea(sig) && !ES_TITULO_TABLA(sig)) { valor = sig.trim(); i++; }
    }
    ultimo = { rotulo, vacio: valor === '', def };
    if (valor === '' || (!def.clave && !def.adicional)) continue;
    aplicarPar({ rotulo, valor, def }, valor, bloque, docCampos, conf, avisos, `${rotulo}: ${valor}`, origen, adicionales);
    if (!def.adicional) reconocidos++;
  }

  if (reconocidos === 0 && !ultimo) return null;

  // Lo que está fuera de la tabla (régimen, pedimento, tipo de materia…) aplica a todas sus filas si la fila no lo trae.
  const mercancias: Fila[] = filasTabla.length > 0
    ? filasTabla.map((f) => ({ ...Object.fromEntries(Object.entries(bloque).filter(([k]) => !f[k])), ...f }))
    : (Object.keys(bloque).length > 0 ? [bloque] : []);

  // La caja del asunto, solo si el cuerpo no la trae (pista: confirmarla).
  const caja = cajaDelAsunto(asunto);
  if (!docCampos.caja_numero && caja) {
    docCampos.caja_numero = { valor: caja, confianza: Math.min(0.6, conf), evidencia: `caja ${caja}`, origen: 'derivado', notas: ['La caja salió del asunto del correo: confírmala contra el documento.'] };
  }

  // Captura cortada: el texto TERMINA en un rótulo reconocido sin valor (o la tabla se corta a media fila).
  const termina = ultimo && ultimo.vacio && ultimo.def ? ultimo.rotulo : null;
  const corte = termina ?? cortadoEnTabla;
  const capturaIncompleta = corte ? { ultimoRotulo: corte } : null;
  if (capturaIncompleta) {
    avisos.push(`La captura llegó cortada: termina en «${capturaIncompleta.ultimoRotulo}» sin valor. Pide el texto copiado del correo o una captura completa.`);
  }
  if (bajaRes) {
    avisos.push(`La captura es de baja resolución (${opciones.resolucion!.ancho}×${opciones.resolucion!.alto} px): lo leído quedó con confianza baja y hay que confirmarlo contra el correo.`);
  }
  if (chrome.length > 0) avisos.push(`Se ignoró la interfaz del correo (${chrome.length} línea${chrome.length === 1 ? '' : 's'}: asunto, botones).`);

  const extraccion = extraccionVacia();
  extraccion.campos = docCampos;
  extraccion.mercancias = mercancias;
  return { extraccion, reconocidos, chrome, asunto, capturaIncompleta, bajaResolucion: bajaRes, adicionales, tituloTabla, firma, avisos };
}

/**
 * ¿Es lo bastante claro como para usarlo como base? Evita que un correo común con un «Cantidad: 10» suelto se tome por un
 * bloque de rótulos: pide la firma de un formato conocido, una mercancía y al menos 3 rótulos con valor.
 */
export const lecturaConfiable = (l: LecturaRotulos | null): boolean =>
  !!l && l.firma && l.reconocidos >= 3 && l.extraccion.mercancias.length > 0;
