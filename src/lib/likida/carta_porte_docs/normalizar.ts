// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZACIÓN — de lo que dice el documento a la forma del complemento.
//
// Regla de la casa: se normaliza lo que es INEQUÍVOCO (mayúsculas del RFC, el
// «1,234.50» de un Excel, el 15/10/2026 de México) y lo que no, se deja tal cual
// con una NOTA para que el validador lo cace o el humano lo mire. Nunca se
// «arregla» adivinando: un peso de «1.500» puede ser una tonelada y media o 1.5 kg,
// y quien lo decide es quien tiene el documento enfrente, no una heurística.
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoDoc } from './campos';
import { codigoEstado, codigoEstadoEeuu, claveUnidadDeTexto, CLAVES_UNIDAD } from './catalogos';

export interface Normalizado {
  valor: string | null;
  notas: string[];
  /** Cuánto bajar la confianza por tener que interpretar (0 = nada). */
  penalizacion: number;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/** Texto libre: sin controles ni marcas bidireccionales, espacios colapsados, con tope. */
export function limpiarTexto(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (s === '' || /^(n\/?a|null|undefined|none|-+|s\/?d|sin dato)$/i.test(s)) return null;
  return s.length > max ? s.slice(0, max) : s;
}

const MESES: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
  jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, set: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

const dosD = (n: number): string => String(n).padStart(2, '0');

export function fechaValida(a: number, m: number, d: number): boolean {
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1) return false;
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return d <= dias;
}

function horaValida(h: number, mi: number, s: number): boolean {
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;
}

/** Un serial de Excel (días desde 1899-12-30) a `[a, m, d, h, mi, s]`. */
function deSerialExcel(n: number): [number, number, number, number, number, number] | null {
  if (!Number.isFinite(n) || n < 36526 || n > 73415) return null; // 2000-01-01 … 2100-12-31
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
}

function armarFecha(a: number, m: number, d: number, h?: number, mi?: number, s?: number): string | null {
  if (!fechaValida(a, m, d)) return null;
  if (h === undefined) return `${a}-${dosD(m)}-${dosD(d)}`;
  if (!horaValida(h, mi ?? 0, s ?? 0)) return null;
  return `${a}-${dosD(m)}-${dosD(d)}T${dosD(h)}:${dosD(mi ?? 0)}:${dosD(s ?? 0)}`;
}

/** Orden de las fechas numéricas `a/b/aaaa`: `dmy` = día/mes (México, por omisión); `mdy` = mes/día (formato EE. UU., p. ej. `10/14/2026`). */
export type OrdenFecha = 'dmy' | 'mdy';

/** Interpreta una fecha (día primero salvo que el perfil diga `mdy`). `null` = no es una fecha reconocible. */
export function normalizarFecha(crudo: string, opciones: { orden?: OrdenFecha } = {}): { valor: string | null; nota?: string } {
  const mdy = opciones.orden === 'mdy';
  const t = crudo.trim().toLowerCase().replace(/\s+/g, ' ');
  // Hora opcional al final: 10:30 o 10:30:15 (sin cuantificadores anidados: se quita el sufijo «hrs» y luego se prueba cada forma).
  const base = t.replace(/\s+a las\s+/, ' ').replace(/\s*(hrs|hr|h)\.?$/, '');
  const conSeg = /[ t,]+(\d{1,2}):(\d{2}):(\d{2})$/.exec(base);
  const sinSeg = conSeg ? null : /[ t,]+(\d{1,2}):(\d{2})$/.exec(base);
  const hora = conSeg ?? sinSeg;
  const sinHora = (hora ? base.slice(0, hora.index) : base).trim().replace(/\s+de\s+/g, ' ');
  const h = hora ? Number(hora[1]) : undefined;
  const mi = hora ? Number(hora[2]) : undefined;
  const s = conSeg ? Number(conSeg[3]) : 0;

  let m: RegExpExecArray | null;
  // ISO: 2026-10-15
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(sinHora))) return { valor: armarFecha(+m[1], +m[2], +m[3], h, mi, s) };
  // 15/10/2026, 15-10-2026, 15.10.2026 (día primero: es México; con `orden: 'mdy'`, mes primero: 10/14/2026)
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(sinHora))) {
    if (mdy) return { valor: armarFecha(+m[3], +m[1], +m[2], h, mi, s) };
    const v = armarFecha(+m[3], +m[2], +m[1], h, mi, s);
    return { valor: v, nota: v && +m[1] <= 12 && +m[2] <= 12 && m[1] !== m[2] ? 'Se leyó como día/mes/año.' : undefined };
  }
  // 15/10/26 (año de dos dígitos → 20xx)
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/.exec(sinHora))) {
    return { valor: mdy ? armarFecha(2000 + +m[3], +m[1], +m[2], h, mi, s) : armarFecha(2000 + +m[3], +m[2], +m[1], h, mi, s), nota: 'Año de dos dígitos leído como 20' + m[3] + '.' };
  }
  // 15 de octubre de 2026 · 15-oct-2026 · 15 oct 2026
  if ((m = /^(\d{1,2})[\s-]+([a-záéíóú]+)\.?[\s-]+(\d{4})$/.exec(sinHora))) {
    const mes = MESES[m[2].normalize('NFD').replace(/[̀-ͯ]/g, '')];
    if (mes) return { valor: armarFecha(+m[3], mes, +m[1], h, mi, s) };
  }
  // 20261015 (compacto)
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(sinHora))) return { valor: armarFecha(+m[1], +m[2], +m[3], h, mi, s) };
  // Serial de Excel
  if (/^\d{5}$/.test(sinHora) || /^\d{5}\.\d+$/.test(sinHora)) {
    const p = deSerialExcel(Number(sinHora));
    if (p) {
      const conHora = p[3] !== 0 || p[4] !== 0 || p[5] !== 0;
      return { valor: conHora ? armarFecha(p[0], p[1], p[2], p[3], p[4], p[5]) : armarFecha(p[0], p[1], p[2]), nota: 'Fecha leída de un número de Excel.' };
    }
  }
  return { valor: null };
}

/** Lo que puede ir pegado a una cifra del documento y no es parte de ella. */
const SUFIJOS_NUMERO: ReadonlySet<string> = new Set(['kg', 'kgs', 'kilo', 'kilos', 'ton', 'tons', 'tonelada', 'toneladas', 'lb', 'lbs', 'pza', 'pzas', 'km', 'kms', 'mxn', 'usd', 'mn', 'm.n']);

/** `1,234,567` / `1.234.567`: un grupo de 1 a 3 dígitos y uno o más de EXACTAMENTE 3, separados por `sep`. */
function esMilesAgrupados(t: string, sep: ',' | '.'): boolean {
  const partes = t.replace(/^[+-]/, '').split(sep);
  return partes.length >= 2 && /^\d{1,3}$/.test(partes[0]) && partes.slice(1).every((p) => /^\d{3}$/.test(p));
}

/**
 * «1,234.50», «1.234,50», «1 234,5», «1234,5 kg» → `1234.5`. `null` si no es un número.
 * `ambiguo` = «1.500» o «1,500»: puede ser mil quinientos o uno punto cinco.
 */
export function normalizarNumero(crudo: string | number, miles?: ',' | '.'): { valor: number | null; ambiguo: boolean } {
  if (typeof crudo === 'number') return { valor: Number.isFinite(crudo) ? Math.round(crudo * 1000) / 1000 : null, ambiguo: false };
  let t = crudo.replace(CONTROL, ' ').trim().replace(/^\$/, '').trim();
  // Una unidad o moneda pegada al número («30 ton», «1,250 MXN»): se quita la última palabra si es una de las conocidas.
  const sufijo = /\s+([a-z.]{1,12})$/i.exec(t);
  if (sufijo && SUFIJOS_NUMERO.has(sufijo[1].toLowerCase().replace(/\.+$/, ''))) t = t.slice(0, sufijo.index).trim();
  t = t.replace(/\s+/g, '');
  if (t === '' || !/^[+-]?[\d.,]+$/.test(t)) return { valor: null, ambiguo: false };
  let ambiguo = false;
  const puntos = (t.match(/\./g) ?? []).length;
  const comas = (t.match(/,/g) ?? []).length;
  let limpio: string;
  // Un perfil que ya aprendió cómo escribe SUS cifras este cliente resuelve la ambigüedad:
  // `miles` es el carácter que usa como separador de miles (el otro es el decimal).
  if (miles && ((comas === 1 && puntos === 0 && /^[+-]?\d{1,3},\d{3}$/.test(t)) || (puntos === 1 && comas === 0 && /^[+-]?\d{1,3}\.\d{3}$/.test(t)))) {
    const n = Number(miles === ',' ? t.replace(',', '') : t.replace('.', '').replace(',', '.'));
    return { valor: Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null, ambiguo: false };
  }
  if (puntos > 0 && comas > 0) {
    // El último separador es el decimal.
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    const mil = dec === '.' ? ',' : '.';
    limpio = t.split(mil).join('').replace(dec, '.');
  } else if (comas > 0) {
    if (comas === 1 && /^[+-]?\d{1,3},\d{3}$/.test(t)) { ambiguo = true; limpio = t.replace(',', ''); }
    else if (comas > 1 && esMilesAgrupados(t, ',')) limpio = t.replace(/,/g, '');
    else if (comas === 1) limpio = t.replace(',', '.');
    else return { valor: null, ambiguo: false };
  } else if (puntos > 1) {
    if (esMilesAgrupados(t, '.')) limpio = t.replace(/\./g, '');
    else return { valor: null, ambiguo: false };
  } else if (puntos === 1 && /^[+-]?\d{1,3}\.\d{3}$/.test(t)) {
    // En México el punto es decimal: «1.500» se lee 1.5 — y se marca ambiguo.
    ambiguo = true; limpio = t;
  } else limpio = t;
  const n = Number(limpio);
  if (!Number.isFinite(n)) return { valor: null, ambiguo: false };
  return { valor: Math.round(n * 1000) / 1000, ambiguo };
}

/**
 * Peso: `normalizarNumero` más la regla explícita de los separadores y sus notas (T-A3-52). Nada ambiguo pasa sin nota.
 *   · `3,002.00` → 3002 (coma de miles + punto decimal: inequívoco, sin nota).
 *   · `1999.350` → 1999.35 (el grupo previo tiene más de 3 dígitos: el punto NO puede ser de miles; se anota).
 *   · `14.029` / `6,578` → ambiguo: se lee con la regla de México (punto decimal; coma de miles) y la nota trae la OTRA
 *     lectura para que quien tiene el documento decida. `alternativa` es esa otra lectura.
 * Si el perfil del cliente ya fijó su separador de miles (`miles`), no hay ambigüedad.
 */
export function normalizarPeso(crudo: string | number, miles?: ',' | '.'): { valor: number | null; ambiguo: boolean; alternativa: number | null; notas: string[] } {
  const n = normalizarNumero(crudo, miles);
  const notas: string[] = [];
  if (n.valor === null || typeof crudo === 'number') return { valor: n.valor, ambiguo: n.ambiguo, alternativa: null, notas };
  const m = /([+-]?\d[\d.,]*)\s*[a-z.]{0,12}$/i.exec(crudo.trim());
  const t = m ? m[1] : '';
  let alternativa: number | null = null;
  if (n.ambiguo && /^[+-]?\d{1,3}[.,]\d{3}$/.test(t)) {
    const enteros = Number(t.replace(/^[+-]/, '').replace(/[.,]/, ''));
    const decimal = Number(t.replace(',', '.'));
    alternativa = n.valor === decimal ? enteros : decimal;
    const como = t.includes('.') ? 'punto decimal' : 'coma de miles';
    notas.push(`«${t}» es ambiguo: se leyó ${n.valor} kg (${como}); si fuera la otra lectura serían ${alternativa} kg. Confírmalo: confirma la cifra contra el documento.`);
  } else if (!miles && /^[+-]?\d{4,}\.\d{3}$/.test(t)) {
    notas.push(`«${t}»: el punto se leyó como decimal (${n.valor} kg) porque el grupo previo tiene más de 3 dígitos y no puede ser un separador de miles.`);
  }
  return { valor: n.valor, ambiguo: n.ambiguo, alternativa, notas };
}

/** Ancho fijo de las claves SAT numéricas de domicilio y aduana (colonia 4, localidad 2, municipio 3, tipo de materia 2). */
function anchoClaveNumerica(clave: string): number | undefined {
  if (/_colonia_clave$/.test(clave)) return 4;
  if (/_localidad_clave$/.test(clave)) return 2;
  if (/_municipio_clave$/.test(clave)) return 3;
  if (clave === 'tipo_materia') return 2;
  return undefined;
}

/**
 * Completa con ceros a la izquierda una clave que llegó como celda numérica (`6`, `876`, `3`, `'6.0'`).
 * `null` si ya está bien, si no son solo dígitos o si es más larga que el ancho (no se adivina).
 */
function completarCeros(crudo: string | number, ancho: number): { valor: string; original: string } | null {
  const t = typeof crudo === 'number' ? (Number.isInteger(crudo) && crudo >= 0 ? String(crudo) : '') : crudo.trim().replace(/^(\d+)\.0+$/, '$1');
  if (!/^\d+$/.test(t) || t.length >= ancho) return null;
  return { valor: t.padStart(ancho, '0'), original: String(crudo).trim() };
}

interface ParcialNorm { valor: string; notas: string[]; penalizacion: number }

/** Pedimento completo: 15 dígitos `AA AD PPPP NNNNNNN` (año, aduana, patente, consecutivo). */
export const PEDIMENTO_COMPLETO = /^\d{2} \d{2} \d{4} \d{7}$/;
/** Pedimento incompleto como lo escribe un agente aduanal: `patente-consecutivo`. */
export const PEDIMENTO_PARCIAL = /^\d{4}-\d{7}$/;

/**
 * Pedimento al formato de 15 dígitos con espacios. Si solo trae `patente-consecutivo` (11 dígitos) se deja así y se
 * avisa: el año y la aduana los completa `completarDerivados` con los del perfil, o los captura una persona.
 */
export function normalizarPedimento(crudo: string): ParcialNorm {
  const t = crudo.trim();
  const notas: string[] = [];
  if (/[^\d\s\-./]/.test(t)) return { valor: t, notas: ['No tiene forma de pedimento (solo dígitos): confírmalo contra el documento.'], penalizacion: 0.3 };
  const d = t.replace(/\D/g, '');
  if (d.length === 15) {
    const v = `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;
    if (v !== t) notas.push('Se le dio el formato AA AD PPPP NNNNNNN al pedimento.');
    return { valor: v, notas, penalizacion: 0 };
  }
  if (d.length === 11) {
    notas.push('Pedimento incompleto (patente-consecutivo): faltan el año y la aduana. Confírmalo.');
    return { valor: `${d.slice(0, 4)}-${d.slice(4)}`, notas, penalizacion: 0.3 };
  }
  return { valor: t, notas: [`El pedimento trae ${d.length} dígitos y debería traer 15 (AA AD PPPP NNNNNNN): confírmalo.`], penalizacion: 0.3 };
}

const REGIMEN_POR_NOMBRE: Record<string, string> = {
  'importacion definitiva': 'IMD',
  'exportacion definitiva': 'EXD',
};

/** Régimen aduanero: la clave de 3 letras en mayúsculas; el nombre solo se traduce cuando es inequívoco. */
export function normalizarRegimen(crudo: string): ParcialNorm {
  const t = crudo.trim();
  const llave = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const porNombre = REGIMEN_POR_NOMBRE[llave];
  if (porNombre) return { valor: porNombre, notas: [`«${t}» se tradujo a la clave ${porNombre}.`], penalizacion: 0 };
  return { valor: t.toUpperCase(), notas: [], penalizacion: 0 };
}

/** Clave ONU del material peligroso: 4 dígitos («UN 1203», «1203», «203» → 1203 / 0203). `N/A` y otros textos quedan igual. */
export function normalizarClavePeligroso(crudo: string): ParcialNorm {
  const t = crudo.trim().replace(/\s+/g, ' ');
  const m = /^(?:UN ?)?(\d{3,4})$/i.exec(t);
  if (!m) return { valor: t, notas: [], penalizacion: 0 };
  const v = m[1].padStart(4, '0');
  return { valor: v, notas: v !== t ? [`La clave de material peligroso se escribió ${v} (era «${t}»).`] : [], penalizacion: 0 };
}

/** Id de destino de la plantilla del TMS: texto («1», « 2 ») o número (1, 2.0) → entero en texto. `null` si no es un entero positivo. */
export function normalizarIdDestino(crudo: unknown): string | null {
  const t = typeof crudo === 'number' ? (Number.isInteger(crudo) ? String(crudo) : '') : String(crudo ?? '').trim().replace(/^(\d+)\.0+$/, '$1');
  return /^\d+$/.test(t) && Number(t) > 0 ? String(Number(t)) : null;
}

const aTexto = (n: number): string => String(n);

export function normalizarBooleano(v: unknown): 'true' | 'false' | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['si', 's', 'true', 'yes', 'y', '1', 'x', 'verdadero'].includes(t)) return 'true';
  if (['no', 'n', 'false', '0', 'falso'].includes(t)) return 'false';
  return null;
}

const MONEDAS: Record<string, string> = {
  mxn: 'MXN', mn: 'MXN', 'm.n.': 'MXN', peso: 'MXN', pesos: 'MXN', 'peso mexicano': 'MXN', 'pesos mexicanos': 'MXN', '$': 'MXN',
  usd: 'USD', dls: 'USD', dlls: 'USD', dolar: 'USD', dolares: 'USD', 'dolar americano': 'USD', 'dolares americanos': 'USD', 'us$': 'USD',
};

/** Normaliza el valor CRUDO de un campo a su forma de guardado. Nunca lanza. */
export function normalizarValor(campo: CampoDoc, crudo: unknown, opciones: { miles?: ',' | '.'; ordenFecha?: OrdenFecha } = {}): Normalizado {
  const notas: string[] = [];
  let penalizacion = 0;
  const vacio: Normalizado = { valor: null, notas, penalizacion };
  if (crudo === null || crudo === undefined) return vacio;
  const texto = typeof crudo === 'number' ? crudo : limpiarTexto(crudo, 600);
  if (texto === null) return vacio;
  const out = (valor: string | null): Normalizado => ({ valor: valor === null ? null : valor.slice(0, campo.max), notas, penalizacion });

  switch (campo.tipo) {
    case 'rfc': {
      // Un Tax ID de EE. UU. (EIN `NN-NNNNNNN`) conserva su guion: ningún RFC mexicano tiene esa forma (T-A3-49).
      const bruto = String(texto).trim().toUpperCase();
      if (/^\d{2}-\d{7}$/.test(bruto)) {
        if (bruto !== String(texto)) notas.push('Tax ID normalizado (mayúsculas, sin espacios); se conserva el guion.');
        return out(bruto);
      }
      const r = String(texto).toUpperCase().replace(/[\s.\-_]/g, '');
      if (r !== String(texto)) notas.push('RFC normalizado (mayúsculas, sin espacios ni guiones).');
      return out(r);
    }
    case 'cp': {
      const d = String(texto).replace(/\s+/g, '').replace(/^c\.?p\.?:?/i, '');
      if (/^\d{1,4}$/.test(d)) {
        notas.push(`El CP traía ${d.length} dígito${d.length === 1 ? '' : 's'} (probable cero inicial perdido en Excel): se completó a 5. Confírmalo.`);
        penalizacion = 0.25;
        return out(d.padStart(5, '0'));
      }
      return out(d);
    }
    case 'fecha': {
      const f = normalizarFecha(String(texto), { orden: opciones.ordenFecha });
      if (f.valor === null) { notas.push('No se reconoció como fecha.'); penalizacion = 0.3; return out(String(texto)); }
      if (f.nota) { notas.push(f.nota); penalizacion = 0.05; }
      return out(f.valor);
    }
    case 'numero': {
      if (campo.clave === 'peso_kg' || campo.clave === 'peso_bruto_total') {
        const p = normalizarPeso(texto, opciones.miles);
        if (p.valor === null) { notas.push('No se reconoció como número.'); penalizacion = 0.3; return out(String(texto)); }
        notas.push(...p.notas);
        if (p.ambiguo) penalizacion = 0.2;
        return out(aTexto(p.valor));
      }
      const n = normalizarNumero(texto, opciones.miles);
      if (n.valor === null) { notas.push('No se reconoció como número.'); penalizacion = 0.3; return out(String(texto)); }
      if (n.ambiguo) { notas.push('Número ambiguo (punto/coma de miles o decimal): confirma la cifra.'); penalizacion = 0.2; }
      return out(aTexto(n.valor));
    }
    case 'clave_prod': {
      const m = /(?<!\d)(\d{8})(?!\d)/.exec(String(texto).replace(/[\s.\-]/g, ''));
      if (m) {
        if (String(texto).trim() !== m[1]) notas.push('La clave se extrajo de un texto más largo.');
        return out(m[1]);
      }
      return out(String(texto));
    }
    case 'clave_unidad': {
      const t = String(texto).trim();
      const mayus = t.toUpperCase();
      if (CLAVES_UNIDAD.has(mayus)) return out(mayus);
      const alias = claveUnidadDeTexto(t);
      if (alias) { notas.push(`«${t}» se tradujo a la clave ${alias}.`); return out(alias); }
      return out(mayus);
    }
    case 'fraccion': {
      const d = String(texto).replace(/[\s.\-]/g, '');
      return out(d);
    }
    case 'estado': {
      const t = String(texto).trim();
      const c = codigoEstado(t);
      if (c) { if (c !== t.toUpperCase()) notas.push(`«${t}» se tradujo a la clave de estado ${c}.`); return out(c); }
      const us = codigoEstadoEeuu(t);
      if (us) { if (us !== t.toUpperCase()) notas.push(`«${t}» se tradujo a la clave de estado de EE. UU. ${us}.`); return out(us); }
      return out(t.toUpperCase());
    }
    case 'booleano': {
      const b = normalizarBooleano(texto);
      if (b === null) { notas.push('No se reconoció como sí/no.'); penalizacion = 0.3; return out(null); }
      return out(b);
    }
    case 'moneda': {
      const t = String(texto).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const m = MONEDAS[t] ?? (/^[a-z]{3}$/.test(t) ? t.toUpperCase() : null);
      return out(m ?? String(texto).toUpperCase());
    }
    case 'embalaje':
      return out(String(texto).toUpperCase().replace(/\s+/g, ''));
    case 'placa':
      return out(String(texto).toUpperCase().replace(/[^A-Z0-9]/g, ''));
    case 'texto':
    default: {
      // Campos aduaneros (T-A3-46): forma propia, sin adivinar lo que el documento no dice.
      if (campo.clave === 'pedimento') {
        const p = normalizarPedimento(String(texto));
        notas.push(...p.notas); penalizacion = p.penalizacion;
        return out(p.valor);
      }
      if (campo.clave === 'regimen_aduanero') {
        const r = normalizarRegimen(String(texto));
        notas.push(...r.notas);
        return out(r.valor);
      }
      if (campo.clave === 'clave_material_peligroso') {
        const k = normalizarClavePeligroso(String(texto));
        notas.push(...k.notas);
        return out(k.valor);
      }
      // Claves del SAT que Excel guarda como número y pierde el cero inicial.
      const ancho = anchoClaveNumerica(campo.clave);
      if (ancho !== undefined) {
        const c = completarCeros(texto, ancho);
        if (c) {
          notas.push(`Se completó el cero a la izquierda (${c.original} → ${c.valor}). Confírmalo.`);
          penalizacion = 0.1;
          return out(c.valor);
        }
      }
      return out(limpiarTexto(texto, campo.max));
    }
  }
}
