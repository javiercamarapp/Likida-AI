// ═══════════════════════════════════════════════════════════════════════════
// LECTOR D — BILL OF LADING EN INGLÉS — T-A3-60.
//
// Un BOL de un consignatario de EE. UU.: rótulos en inglés (BOL #, Ship Date, Shipper, Consignee, Pieces, Description,
// Weight en LIBRAS, columna HM) y una sección «Notes» con los datos fiscales en ESPAÑOL (RFC, fracción, régimen, clave SAT,
// unidad, embalaje). Se lee SIN modelo, por rótulo, sobre el texto del PDF (formato `pdf_texto`).
//
// Reglas:
//  · El peso va en libras: se deja como está escrito con `peso_unidad = lb` y `completarDerivados` lo pasa a kg con su nota.
//    Si el documento no escribe la unidad, se SUPONE libras (el formato D es «Weight (LBS)») y se avisa con confianza baja.
//  · En un documento en inglés la coma es separador de MILES («14,502 lb»): no queda «ambigua» a ciegas.
//  · Lo que está en «Notes» es de segunda mano (lo escribió un fiscal, no el remitente): confianza menor y nota. Un RFC de Notes
//    no se da por del remitente.
//  · La unidad «20» o el embalaje «1» de Notes no son claves del SAT: la unidad queda como TEXTO (la clave la pide el validador).
//  · Lo que el BOL no trae (cliente interno, distancia, claves SAT de domicilio, tramo mexicano) queda vacío para T-A3-62.
//  · Un renglón de la tabla que no encaja con el encabezado NO se adivina: se marca `renglon_no_leido`.
// ═══════════════════════════════════════════════════════════════════════════

import { extraccionVacia, type CampoValor, type Extraccion } from '../campos';
import type { ContenidoDoc } from '../contenido';
import {
  campoLeido, completarDerivados, detectarSeparadorMiles, leerRenglonPorColumnas, ordenDeColumnas, pendientesDeEnriquecimiento,
  type ClaveColumna, type IncidenciaLector, type ResultadoLector,
} from '../derivar';
import { FACTOR_A_KG } from '../catalogos';

/** Confianza de lo escrito junto a su rótulo. */
const CONF_ROTULO = 0.97;
/** Lo que sale de «Notes»: escrito por un tercero, a veces sin rótulo claro. */
const CONF_NOTES = 0.75;
const CONF_UNIDAD_SUPUESTA = 0.6;

const MESES_EN: Readonly<Record<string, string>> = { jan: 'ene', apr: 'abr', aug: 'ago', dec: 'dic' };

/** «12-Jan-2026» → «12-ene-2026» (el normalizador de fechas conoce los meses en español; oct, may, sep, feb… ya coinciden). */
function fechaEnEspanol(t: string): string {
  return t.replace(/\b(jan|apr|aug|dec)[a-z]*\b/gi, (m) => MESES_EN[m.slice(0, 3).toLowerCase()] ?? m);
}

const REGEX = {
  folio: /^(?:bol|b\/l)\s*(?:#|no\.?|number)\s*[:.]?\s*(.+)$/i,
  salida: /^ship(?:ping)?\s*date\s*:\s*(.+)$/i,
  llegada: /^(?:delivery|deliver|due)\s*date\s*:\s*(.+)$/i,
  shipper: /^shipper\s*:\s*(.+)$/i,
  consignee: /^consignee\s*:\s*(.+)$/i,
  piezas: /^(?:pieces|pcs|qty|quantity)\s*:\s*(.+)$/i,
  descripcion: /^(?:description(?:\s+of\s+(?:articles|goods))?|commodity)\s*:\s*(.+)$/i,
  peso: /^(?:gross\s+)?weight\s*(?:\(\s*lbs?\s*\))?\s*:\s*(.+)$/i,
  pesoTotal: /^total\s+(?:gross\s+)?weight\s*(?:\(\s*lbs?\s*\))?\s*:\s*(.+)$/i,
  hm: /^hm\s*:\s*(.+)$/i,
  notes: /^notes?\s*:\s*(.*)$/i,
} as const;

const SUFIJO_LEGAL = /^\s*(?:s\.?\s*a\.?|s\.?\s*de\s*r\.?\s*l\.?|c\.?\s*v\.?|de\s*c\.?\s*v\.?|inc\.?|llc|ltd\.?|l\.?p\.?|corp\.?|co\.?)(?=[\s,.]|$)/i;

/** «Fabrica Ejemplo SA de CV, Jalisco MX» → nombre y domicilio (la coma de «ACME, S.A.» no parte el nombre). */
export function partirNombreYDomicilio(t: string): { nombre: string; domicilio: string | null } {
  const partes = t.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (partes.length === 0) return { nombre: t.trim(), domicilio: null };
  let n = 1;
  while (n < partes.length && SUFIJO_LEGAL.test(partes[n])) n++;
  return { nombre: partes.slice(0, n).join(', '), domicilio: partes.slice(n).join(', ') || null };
}

/** El número y su unidad («14502 lb», «14,502 LBS», «6577 kg», «14502»). */
function pesoYUnidad(t: string): { numero: string; unidad: string | null } | null {
  const m = /^\s*([\d.,]+)\s*([a-z]{1,8}\.?)?\s*$/i.exec(t);
  return m ? { numero: m[1], unidad: m[2] ? m[2].replace(/\.$/, '') : null } : null;
}

const esUnidadKg = (u: string): boolean => /^(kg|kgs|kilo|kilos|kilogram|kilograms)$/i.test(u);
const esUnidadLb = (u: string): boolean => /^(lb|lbs|pound|pounds)$/i.test(u);

interface Tabla { orden: ClaveColumna[]; filas: Array<{ valores: Partial<Record<ClaveColumna, string>>; linea: string }>; sinEncaje: string[]; modo: 'celdas' | 'espacios' }

const COLUMNAS: ReadonlyArray<readonly [ClaveColumna, RegExp]> = [
  ['cantidad', /\b(pieces|pcs|qty|quantity)\b/i], ['tipo', /\b(type|pkg|package|packaging)\b/i],
  ['descripcion', /\b(description|commodity)\b/i], ['peso', /\bweight\b/i], ['hm', /\bhm\b/i],
];

/** Busca la tabla «Pieces … Weight (LBS) … HM»: el encabezado y los renglones hasta «Notes»/«Total»/línea vacía. */
function leerTabla(lineas: string[]): Tabla | null {
  const i = lineas.findIndex((l) => /\bpieces\b/i.test(l) && /\bweight\b/i.test(l) && !/:/.test(l));
  if (i < 0) return null;
  const orden = ordenDeColumnas(lineas[i], COLUMNAS);
  if (!orden.includes('cantidad') || !orden.includes('peso')) return null;
  const filas: Tabla['filas'] = []; const sinEncaje: string[] = []; let modo: Tabla['modo'] = 'celdas';
  for (const linea of lineas.slice(i + 1)) {
    if (linea.trim() === '' || REGEX.notes.test(linea.trim()) || /^total\b/i.test(linea.trim())) break;
    const r = leerRenglonPorColumnas(linea, orden);
    if (r) { filas.push({ valores: r.valores, linea }); if (r.modo === 'espacios') modo = 'espacios'; } else sinEncaje.push(linea);
  }
  return { orden, filas, sinEncaje, modo };
}

type Fila = Record<string, CampoValor>;

/** La sección «Notes»: datos fiscales en español escritos por un tercero. Cada dato, con su patrón; nada sin patrón. */
function leerNotes(texto: string, fila: Fila, campos: Record<string, CampoValor> | null, miles: ',' | '.' | undefined, soloEmbarque: boolean): void {
  const ev = texto;
  const poner = (clave: string, merc: boolean, crudo: string, notas: string[] = [], conf = CONF_NOTES): void => {
    const c = campoLeido(clave, merc, crudo, { confianza: conf, evidencia: ev, notas: ['Dato de la sección «Notes» del BOL: lo escribió un tercero; confírmalo.', ...notas], miles });
    if (!c) return;
    if (merc) fila[clave] = c; else if (campos) campos[clave] = c;
  };
  const rfc = /\bRFC(?:\s+(?:remitente|importador|emisor))?\s*[:.]?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/i.exec(texto);
  if (rfc && campos) poner('origen_rfc', false, rfc[1], ['Un RFC en «Notes» no se da por del remitente: puede ser del fiscal o del importador.'], 0.7);
  const fraccion = /\bFracci[oó]n(?:\s+arancelaria)?\s*[:.]?\s*(\d[\d .]{6,13}\d)/i.exec(texto);
  if (soloEmbarque) {
    // Con varios renglones las Notes no dicen a cuál pertenece cada dato: solo el régimen vale para todo el embarque.
    const reg = /\bR[eé]gimen(?:\s+aduanero)?\s*[:.]?\s*([A-Za-z]{3})\b/i.exec(texto);
    if (reg) poner('regimen_aduanero', true, reg[1]);
    return;
  }
  if (fraccion) poner('fraccion_arancelaria', true, fraccion[1]);
  const regimen = /\bR[eé]gimen(?:\s+aduanero)?\s*[:.]?\s*([A-Za-z]{3}|[A-Za-zÁÉÍÓÚáéíóú ]{6,40}?)(?=\s+(?:Unidad|Embalaje|RFC|Fracci|Clave)\b|\s*$|[,.;])/i.exec(texto);
  if (regimen) poner('regimen_aduanero', true, regimen[1].trim());
  const claveSat = /\bClave\s+(?:SAT|de\s+producto)\s*[:.]?\s*(\d{8})\b/i.exec(texto);
  if (claveSat) poner('bienes_transp', true, claveSat[1], [], 0.8);
  const unidad = /\bUnidad\s*[:.]?\s*([A-Za-z0-9]{1,6})\b/i.exec(texto);
  if (unidad) poner('unidad_texto', true, unidad[1], /^\d{1,2}$/.test(unidad[1]) ? [`«${unidad[1]}» no es una clave de unidad del SAT: se conserva como texto y la clave se confirma.`] : []);
  const embalaje = /\bEmbalaje\s*[:.]?\s*([A-Za-z0-9]{1,3})\b/i.exec(texto);
  if (embalaje) poner('embalaje', true, embalaje[1], ['El embalaje solo aplica a material peligroso; confirma si corresponde.'], 0.6);
}

export function leerBol(c: ContenidoDoc): ResultadoLector {
  const e: Extraccion = extraccionVacia();
  const avisos: string[] = [...c.avisos]; const incidencias: IncidenciaLector[] = [];
  const adicionales: Record<string, string> = {};
  const lineas = (c.texto ?? '').split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const vacia = (): ResultadoLector => ({ formato: 'D', leido: false, extraccion: e, avisos, incidencias, vacios: pendientesDeEnriquecimiento(e), adicionales });
  if (c.texto === null || c.formato !== 'pdf_texto') {
    avisos.push('El lector del Bill of Lading necesita el texto del PDF; este documento no lo trae. Sigue el flujo genérico y una persona lo confirma.');
    return vacia();
  }

  const buscar = (re: RegExp): { valor: string; linea: string } | null => {
    for (const l of lineas) { const m = re.exec(l.trim()); if (m && m[1].trim() !== '') return { valor: m[1].trim(), linea: l.trim() }; }
    return null;
  };
  const poner = (clave: string, r: { valor: string; linea: string } | null, extra: { fecha?: boolean; texto?: string } = {}): void => {
    if (!r) return;
    const cv = campoLeido(clave, false, extra.texto ?? (extra.fecha ? fechaEnEspanol(r.valor) : r.valor), { confianza: CONF_ROTULO, evidencia: r.linea });
    if (cv) e.campos[clave] = cv;
  };

  poner('folio_cliente', buscar(REGEX.folio));
  poner('fecha_salida', buscar(REGEX.salida), { fecha: true });
  poner('fecha_llegada', buscar(REGEX.llegada), { fecha: true });
  for (const [rotulo, nombre, dom] of [[REGEX.shipper, 'origen_nombre', 'origen_domicilio'], [REGEX.consignee, 'destino_nombre', 'destino_domicilio']] as const) {
    const r = buscar(rotulo);
    if (!r) continue;
    const p = partirNombreYDomicilio(r.valor);
    poner(nombre, { valor: p.nombre, linea: r.linea });
    if (p.domicilio) poner(dom, { valor: p.domicilio, linea: r.linea });
  }

  // Notes: todo lo que sigue al rótulo (la sección puede ocupar varias líneas).
  const iNotes = lineas.findIndex((l) => REGEX.notes.test(l.trim()));
  const notes = iNotes < 0 ? '' : [REGEX.notes.exec(lineas[iNotes].trim())?.[1] ?? '', ...lineas.slice(iNotes + 1)].join(' ').replace(/\s+/g, ' ').trim();

  // Renglones: la tabla si existe; si no, el bloque de rótulos (un solo renglón).
  const tabla = leerTabla(lineas);
  const filas: Array<{ piezas?: string; tipo?: string; descripcion?: string; peso?: string; hm?: string; linea: string }> = [];
  if (tabla) {
    for (const f of tabla.filas) filas.push({ piezas: f.valores.cantidad, tipo: f.valores.tipo, descripcion: f.valores.descripcion, peso: f.valores.peso, hm: f.valores.hm, linea: tabla.orden.map((k) => f.valores[k]).filter((v): v is string => !!v).join(' | ') });
    if (tabla.modo === 'espacios' && tabla.filas.length > 0) avisos.push('Las columnas de la tabla del BOL vienen separadas por espacios simples: la frontera entre columnas se dedujo por la forma de cada cifra. Revísala contra el documento.');
    for (const l of tabla.sinEncaje) {
      incidencias.push({ codigo: 'renglon_no_leido', campo: null, renglon: null, detalle: `Un renglón de la tabla no encaja con el encabezado y no se leyó (no se adivina): «${l.trim().slice(0, 80)}».` });
      avisos.push('Hay renglones de la tabla que no se pudieron leer: captúralos a mano.');
    }
  } else {
    const p = buscar(REGEX.piezas); const d = buscar(REGEX.descripcion); const w = buscar(REGEX.peso); const h = buscar(REGEX.hm);
    if (d || w || p) filas.push({ piezas: p?.valor, descripcion: d?.valor, peso: w?.valor, hm: h?.valor, linea: [p?.linea, d?.linea, w?.linea].filter(Boolean).join(' | ') });
  }

  const miles = detectarSeparadorMiles(filas.map((f) => pesoYUnidad(f.peso ?? '')?.numero ?? '')) ?? ',';
  const rotuloPeso = lineas.some((l) => /weight\s*\(\s*lbs?\s*\)/i.test(l));

  filas.forEach((f, i) => {
    const fila: Fila = {};
    const lin = f.linea;
    const put = (clave: string, crudo: string | undefined, conf = CONF_ROTULO, notas: string[] = []): void => {
      if (crudo === undefined || crudo.trim() === '') return;
      const cv = campoLeido(clave, true, crudo, { confianza: conf, evidencia: lin, notas, miles });
      if (cv) fila[clave] = cv;
    };
    put('descripcion', f.descripcion);
    put('cantidad', f.piezas);
    put('unidad_texto', f.tipo);
    const pu = f.peso ? pesoYUnidad(f.peso) : null;
    if (f.peso && !pu) {
      incidencias.push({ codigo: 'renglon_no_leido', campo: 'peso_kg', renglon: i, detalle: `El peso «${f.peso}» no se reconoce como cifra con unidad: se dejó vacío.` });
    } else if (pu) {
      // La unidad sale del propio valor («14502 lb»), o del rótulo «Weight (LBS)»; si no hay ninguna, se SUPONE libras y se avisa.
      const escrita = pu.unidad ?? (rotuloPeso ? 'lb' : null);
      const kg = escrita !== null && esUnidadKg(escrita);
      const lb = escrita !== null && esUnidadLb(escrita);
      const supuesta = escrita === null;
      if (escrita !== null && !kg && !lb) {
        incidencias.push({ codigo: 'renglon_no_leido', campo: 'peso_kg', renglon: i, detalle: `La unidad del peso «${escrita}» no es libra ni kilo: no se convirtió ni se supuso nada.` });
      } else {
        put('peso_kg', pu.numero, supuesta ? CONF_UNIDAD_SUPUESTA : CONF_ROTULO, supuesta ? ['El peso no trae unidad escrita; el formato de Bill of Lading usa libras: se tomó como libras. Confírmalo.'] : []);
        if (fila.peso_kg) {
          fila.peso_unidad = { valor: kg ? 'KGM' : 'lb', confianza: fila.peso_kg.confianza, evidencia: lin, origen: 'perfil' };
          if (!kg) incidencias.push({ codigo: supuesta ? 'peso_unidad_supuesta' : 'peso_en_libras', campo: 'peso_kg', renglon: i, detalle: supuesta ? 'Unidad del peso supuesta (libras).' : 'El peso está en libras: se convirtió a kilogramos.' });
        }
      }
    }
    // HM: solo se afirma lo que el documento marca. Casilla vacía = sin dato (no «no peligroso»).
    if (f.hm && f.hm.trim() !== '') put('material_peligroso', f.hm, CONF_ROTULO, ['Columna HM del BOL.']);
    // Las Notes valen para el embarque: el RFC se pone una sola vez y, con varios renglones, solo el régimen se reparte.
    if (notes !== '') leerNotes(notes, fila, i === 0 ? e.campos : null, miles, filas.length > 1);
    if (Object.keys(fila).length > 0) e.mercancias.push(fila);
  });

  // Peso total declarado: en libras → kg, con su nota; el validador lo cuadra contra la suma de renglones.
  const total = buscar(REGEX.pesoTotal) ?? (() => {
    const l = lineas.find((x) => /^total\b/i.test(x.trim()) && /\d/.test(x));
    const m = l ? /(\d[\d.,]*)\s*([a-z]{1,8})?\s*$/i.exec(l.trim()) : null;
    return l && m ? { valor: `${m[1]}${m[2] ? ` ${m[2]}` : ''}`, linea: l.trim() } : null;
  })();
  const pt = total ? pesoYUnidad(total.valor) : null;
  if (total && pt) {
    const escrita = pt.unidad ?? (rotuloPeso ? 'lb' : null);
    const kg = escrita !== null && esUnidadKg(escrita);
    const cv = campoLeido('peso_bruto_total', false, pt.numero, { confianza: escrita === null ? CONF_UNIDAD_SUPUESTA : CONF_ROTULO, evidencia: total.linea, miles });
    if (cv) {
      if (!kg) {
        const n = Number(cv.valor);
        cv.valor = String(Math.round(n * FACTOR_A_KG.LBR * 1000) / 1000);
        cv.notas = [...(cv.notas ?? []), escrita === null ? 'El total no trae unidad: se tomó como libras y se convirtió a kilogramos. Confírmalo.' : 'Convertido de libras a kilogramos (×0.45359237).'];
      }
      e.campos.peso_bruto_total = cv;
    }
  }

  completarDerivados(e);
  if (e.mercancias.length === 0) avisos.push('No se leyó ningún renglón de mercancía del Bill of Lading.');
  if (filas.length > 1 && notes !== '') avisos.push('Las «Notes» fiscales del BOL no indican a qué renglón pertenece cada dato (fracción, unidad, embalaje, clave SAT): solo el régimen se aplicó a todos. Captúralos por renglón.');
  return { formato: 'D', leido: e.mercancias.length > 0, extraccion: e, avisos, incidencias, vacios: pendientesDeEnriquecimiento(e), adicionales };
}
