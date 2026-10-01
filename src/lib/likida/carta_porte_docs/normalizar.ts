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
import { codigoEstado, claveUnidadDeTexto, CLAVES_UNIDAD } from './catalogos';

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

/** Interpreta una fecha mexicana (día primero). `null` = no es una fecha reconocible. */
export function normalizarFecha(crudo: string): { valor: string | null; nota?: string } {
  const t = crudo.trim().toLowerCase().replace(/\s+/g, ' ');
  // Hora opcional al final: 10:30 o 10:30:15 (con a. m. / p. m. no se interpreta).
  const hora = /(?:[ t,]+(?:a las )?)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:hrs?\.?|h)?$/.exec(t);
  const sinHora = hora ? t.slice(0, hora.index).trim() : t;
  const h = hora ? Number(hora[1]) : undefined;
  const mi = hora ? Number(hora[2]) : undefined;
  const s = hora?.[3] ? Number(hora[3]) : 0;

  let m: RegExpExecArray | null;
  // ISO: 2026-10-15
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(sinHora))) return { valor: armarFecha(+m[1], +m[2], +m[3], h, mi, s) };
  // 15/10/2026, 15-10-2026, 15.10.2026 (día primero: es México)
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(sinHora))) {
    const v = armarFecha(+m[3], +m[2], +m[1], h, mi, s);
    return { valor: v, nota: v && +m[1] <= 12 && +m[2] <= 12 && m[1] !== m[2] ? 'Se leyó como día/mes/año.' : undefined };
  }
  // 15/10/26 (año de dos dígitos → 20xx)
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/.exec(sinHora))) {
    return { valor: armarFecha(2000 + +m[3], +m[2], +m[1], h, mi, s), nota: 'Año de dos dígitos leído como 20' + m[3] + '.' };
  }
  // 15 de octubre de 2026 · 15-oct-2026 · 15 oct 2026
  if ((m = /^(\d{1,2})(?:\s+de)?[\s-]+([a-záéíóú]+)\.?(?:\s+de)?[\s-]+(\d{4})$/.exec(sinHora))) {
    const mes = MESES[m[2].normalize('NFD').replace(/[̀-ͯ]/g, '')];
    if (mes) return { valor: armarFecha(+m[3], mes, +m[1], h, mi, s) };
  }
  // 20261015 (compacto)
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(sinHora))) return { valor: armarFecha(+m[1], +m[2], +m[3], h, mi, s) };
  // Serial de Excel
  if (/^\d{5}(\.\d+)?$/.test(sinHora)) {
    const p = deSerialExcel(Number(sinHora));
    if (p) {
      const conHora = p[3] !== 0 || p[4] !== 0 || p[5] !== 0;
      return { valor: conHora ? armarFecha(p[0], p[1], p[2], p[3], p[4], p[5]) : armarFecha(p[0], p[1], p[2]), nota: 'Fecha leída de un número de Excel.' };
    }
  }
  return { valor: null };
}

/**
 * «1,234.50», «1.234,50», «1 234,5», «1234,5 kg» → `1234.5`. `null` si no es un número.
 * `ambiguo` = «1.500» o «1,500»: puede ser mil quinientos o uno punto cinco.
 */
export function normalizarNumero(crudo: string | number, miles?: ',' | '.'): { valor: number | null; ambiguo: boolean } {
  if (typeof crudo === 'number') return { valor: Number.isFinite(crudo) ? Math.round(crudo * 1000) / 1000 : null, ambiguo: false };
  let t = crudo.replace(CONTROL, ' ').trim().replace(/^\$/, '').replace(/\s*(kgs?|kilos?|ton(?:s|eladas?)?|lbs?|pzas?|mxn|usd|m\.?n\.?)\.?$/i, '').trim();
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
    else if (comas > 1 && /^[+-]?\d{1,3}(,\d{3})+$/.test(t)) limpio = t.replace(/,/g, '');
    else if (comas === 1) limpio = t.replace(',', '.');
    else return { valor: null, ambiguo: false };
  } else if (puntos > 1) {
    if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(t)) limpio = t.replace(/\./g, '');
    else return { valor: null, ambiguo: false };
  } else if (puntos === 1 && /^[+-]?\d{1,3}\.\d{3}$/.test(t)) {
    // En México el punto es decimal: «1.500» se lee 1.5 — y se marca ambiguo.
    ambiguo = true; limpio = t;
  } else limpio = t;
  const n = Number(limpio);
  if (!Number.isFinite(n)) return { valor: null, ambiguo: false };
  return { valor: Math.round(n * 1000) / 1000, ambiguo };
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
export function normalizarValor(campo: CampoDoc, crudo: unknown, opciones: { miles?: ',' | '.' } = {}): Normalizado {
  const notas: string[] = [];
  let penalizacion = 0;
  const vacio: Normalizado = { valor: null, notas, penalizacion };
  if (crudo === null || crudo === undefined) return vacio;
  const texto = typeof crudo === 'number' ? crudo : limpiarTexto(crudo, 600);
  if (texto === null) return vacio;
  const out = (valor: string | null): Normalizado => ({ valor: valor === null ? null : valor.slice(0, campo.max), notas, penalizacion });

  switch (campo.tipo) {
    case 'rfc': {
      const r = String(texto).toUpperCase().replace(/[\s.\-_]/g, '');
      if (r !== String(texto)) notas.push('RFC normalizado (mayúsculas, sin espacios ni guiones).');
      return out(r);
    }
    case 'cp': {
      const d = String(texto).replace(/\s+/g, '').replace(/^c\.?p\.?:?/i, '');
      if (/^\d{4}$/.test(d)) {
        notas.push('El CP traía 4 dígitos (probable cero inicial perdido en Excel): se completó a 5. Confírmalo.');
        penalizacion = 0.25;
        return out(`0${d}`);
      }
      return out(d);
    }
    case 'fecha': {
      const f = normalizarFecha(String(texto));
      if (f.valor === null) { notas.push('No se reconoció como fecha.'); penalizacion = 0.3; return out(String(texto)); }
      if (f.nota) { notas.push(f.nota); penalizacion = 0.05; }
      return out(f.valor);
    }
    case 'numero': {
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
    default:
      return out(limpiarTexto(texto, campo.max));
  }
}
