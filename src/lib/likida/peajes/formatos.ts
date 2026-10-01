import { round2 } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LOS FORMATOS DE CELDA DEL DESGLOSE DE PEAJE — el lector tolerante.
//
// El archivo REAL de PASE no está en el repo (BLOQUEO declarado): estas
// funciones aceptan las formas que los desgloses mexicanos suelen traer
// (fechas dd/mm/aaaa con o sin hora, serial de Excel con fracción, meses en
// español, importes con coma decimal o con paréntesis) y rechazan, SIN adivinar,
// lo que no entienden. Una celda ilegible vuelve null; el llamador la cuenta y
// la avisa. Ninguna función de aquí lanza.
//
// Reglas que no se negocian (cada una evita mover pesos o días en silencio):
//   · dd/mm, nunca mm/dd: un «mes» > 12 es ilegible, no se voltea.
//   · una hora fuera de 00:00–23:59:59 es ilegible, no se recorta.
//   · «1,234» es mil doscientos treinta y cuatro; «189,50» es 189.50. Si la
//     coma no deja claro cuál de las dos cosas es, NO se lee.
// ═══════════════════════════════════════════════════════════════════════════

export type Celda = string | number | boolean | null | undefined;

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Minúsculas, sin acentos ni signos, espacios colapsados. La llave de comparación de nombres. */
export function normalizarNombre(v: Celda): string {
  return sinAcentos(String(v ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El TAG en su forma de comparación: mayúsculas y solo letras/dígitos.
 * «IMDM 12345678», «imdm-12345678» e «IMDM12345678» son el mismo dispositivo.
 * Devuelve null si no queda un identificador plausible (4–40 caracteres): un
 * «-» o un «N/A» en la columna del TAG no es un TAG.
 */
export function normalizarTag(v: Celda): string | null {
  const t = sinAcentos(String(v ?? '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (t.length < 4 || t.length > 40) return null;
  if (/^(NA|NULL|NINGUNO|SINTAG|NOAPLICA|NODISPONIBLE)$/.test(t)) return null;
  return t;
}

// ── Fechas y horas ──────────────────────────────────────────────────────────

const EPOCH_EXCEL_MS = Date.UTC(1899, 11, 30);

function validarYmd(a: number, m: number, d: number): string | null {
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

const MESES: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5,
  jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, set: 9,
  oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** «14:32», «14:32:05», «2:32 p. m.», «02:32 PM». null si no es una hora válida. */
export function horaDeTexto(texto: string): string | null {
  if (texto.length > 40) return null;
  // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (≤ 80 caracteres, validado arriba) y sin cuantificadores anidados sobre los mismos caracteres
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?$/i.exec(texto.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  const ampm = m[4]?.toLowerCase().replace(/[.\s]/g, '');
  if (mi > 59 || s > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return `${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
}

/** La hora de una celda de «hora»: texto, o fracción de día de Excel (0 < x < 1). */
export function horaDeCelda(v: Celda): string | null {
  if (typeof v === 'number') {
    if (!(v > 0 && v < 1)) return null;
    return horaDeFraccion(v);
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  return horaDeTexto(s);
}

function horaDeFraccion(frac: number): string | null {
  const seg = Math.round(frac * 86_400);
  if (seg < 0 || seg >= 86_400) return null;
  return `${pad2(Math.floor(seg / 3600))}:${pad2(Math.floor((seg % 3600) / 60))}:${pad2(seg % 60)}`;
}

export interface FechaHora {
  fecha: string | null;
  hora: string | null;
}

/**
 * Fecha y (si la trae) hora de UNA celda. Acepta ISO (con «T» o espacio),
 * dd/mm/aaaa, dd-mmm-aaaa y «5 de agosto de 2026» (meses en español), cada uno
 * con hora opcional, y el serial de Excel con su fracción. La hora solo se
 * devuelve si es válida; una fecha buena con hora mala devuelve la fecha y
 * `hora: null` (el llamador lo cuenta como hora ilegible).
 */
export function fechaHoraDeCelda(v: Celda): FechaHora {
  const nada: FechaHora = { fecha: null, hora: null };
  if (typeof v === 'number') {
    if (v < 20_000 || v > 60_000) return nada;
    const entero = Math.floor(v);
    const fecha = new Date(EPOCH_EXCEL_MS + entero * 86_400_000).toISOString().slice(0, 10);
    const frac = v - entero;
    // Una fracción de 0 es «sin hora» (celda solo de fecha), no medianoche.
    return { fecha, hora: frac > 1e-9 ? horaDeFraccion(frac) : null };
  }
  const s = String(v ?? '').trim();
  if (!s || s.length > 80) return nada;

  // Separa «fecha» y «resto» (la hora) por el primer espacio o «T» tras la fecha.
  let fecha: string | null = null;
  let resto = '';

  // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (≤ 80 caracteres, validado arriba) y sin cuantificadores anidados sobre los mismos caracteres
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(.*))?$/.exec(s);
  // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (≤ 80 caracteres, validado arriba) y sin cuantificadores anidados sobre los mismos caracteres
  const mx = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[\sT]+(.*))?$/.exec(s);
  // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (≤ 80 caracteres, validado arriba) y sin cuantificadores anidados sobre los mismos caracteres
  const textual = /^(\d{1,2})(?:\s+de)?[\s/\-.]*([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?(?:[\s/\-.]*(?:de)?[\s/\-.]*(\d{2,4}))(?:[\sT,]+(.*))?$/i.exec(s);
  if (iso) {
    fecha = validarYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    resto = iso[4] ?? '';
  } else if (mx) {
    let a = Number(mx[3]);
    if (a < 100) a += 2000;
    fecha = validarYmd(a, Number(mx[2]), Number(mx[1]));
    resto = mx[4] ?? '';
  } else if (textual) {
    const mes = MESES[sinAcentos(textual[2]).toLowerCase()];
    if (mes) {
      let a = Number(textual[3]);
      if (a < 100) a += 2000;
      fecha = validarYmd(a, mes, Number(textual[1]));
      resto = textual[4] ?? '';
    }
  }
  if (!fecha) return nada;
  // Quita zona/sufijos que no cambian el reloj local del archivo ("Z" o "-06:00"
  // se ignoran A PROPÓSITO: el archivo del proveedor es hora local de México y
  // reinterpretar un offset movería el cruce de día sin que nadie lo vea).
  resto = resto.replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, '').trim();
  const hora = resto ? horaDeTexto(resto) : null;
  return { fecha, hora };
}

/**
 * El instante (ISO UTC) de «fecha + hora» interpretadas como hora local de
 * America/Mexico_City. Calcula el offset real con Intl (no asume −6 fijo), así
 * que un archivo de antes del cambio de horario de 2022 también cuadra.
 * null si falta la fecha o la hora.
 */
export function aInstanteMx(fecha: string | null, hora: string | null): string | null {
  if (!fecha || !hora) return null;
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  const h = /^(\d{2}):(\d{2}):(\d{2})$/.exec(hora);
  if (!f || !h) return null;
  // Una fecha o una hora imposibles son null — Date.UTC las «recorrería» al día
  // siguiente y movería el cobro de día sin avisar.
  if (validarYmd(Number(f[1]), Number(f[2]), Number(f[3])) === null) return null;
  if (Number(h[1]) > 23 || Number(h[2]) > 59 || Number(h[3]) > 59) return null;
  const localComoUtc = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(h[1]), Number(h[2]), Number(h[3]));
  if (!Number.isFinite(localComoUtc)) return null;
  let off = offsetMxMinutos(localComoUtc + 6 * 3_600_000);
  let utc = localComoUtc - off * 60_000;
  const off2 = offsetMxMinutos(utc);
  if (off2 !== off) {
    off = off2;
    utc = localComoUtc - off * 60_000;
  }
  return new Date(utc).toISOString();
}

const FORMATO_MX = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Mexico_City', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Minutos que la hora de México va por delante (negativo) de UTC en ese instante. */
function offsetMxMinutos(utcMs: number): number {
  const p: Record<string, string> = {};
  for (const x of FORMATO_MX.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  const comoUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((comoUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

// ── Importes ────────────────────────────────────────────────────────────────

/**
 * El importe de una celda, o null: «$1,234.56», «MXN 189.00», «189,50» (coma
 * decimal), «1.234,56» (europeo), «(189.00)» (negativo contable), «-189».
 * «1,234» se lee como 1234 (agrupación de miles), no como 1.234: una coma con
 * exactamente tres dígitos detrás es miles. Ambigüedad real → null.
 */
export function montoDeCelda(v: Celda): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
  let s = String(v ?? '').replace(/mxn|mn|pesos?|\$|\s/gi, '');
  if (!s || s.length > 40) return null;
  let negativo = false;
  const par = /^\((.*)\)$/.exec(s);
  if (par) { negativo = true; s = par[1]; }
  if (s.startsWith('-')) { negativo = true; s = s.slice(1); }
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const comas = (s.match(/,/g) ?? []).length;
  const puntos = (s.match(/\./g) ?? []).length;
  let normal: string;
  if (comas > 0 && puntos > 0) {
    // El último separador es el decimal; el otro agrupa miles.
    const decimalEsComa = s.lastIndexOf(',') > s.lastIndexOf('.');
    const dec = decimalEsComa ? ',' : '.';
    const mil = decimalEsComa ? '.' : ',';
    if ((s.match(new RegExp(`\\${dec}`, 'g')) ?? []).length !== 1) return null;
    normal = s.split(mil).join('').replace(dec, '.');
  } else if (comas > 0) {
    if (comas === 1 && /^\d+,\d{1,2}$/.test(s)) {
      normal = s.replace(',', '.'); // «189,50»
    // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (≤ 80 caracteres, validado arriba) y sin cuantificadores anidados sobre los mismos caracteres
    } else if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      normal = s.replace(/,/g, ''); // «1,234» / «1,234,567»
    } else {
      return null;
    }
  } else if (puntos > 1) {
    // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (≤ 80 caracteres, validado arriba) y sin cuantificadores anidados sobre los mismos caracteres
    if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null; // «1.234.567» miles; otra cosa, ilegible
    normal = s.replace(/\./g, '');
  } else {
    normal = s;
  }
  // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (≤ 80 caracteres, validado arriba) y sin cuantificadores anidados sobre los mismos caracteres
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  return round2(negativo ? -n : n);
}
