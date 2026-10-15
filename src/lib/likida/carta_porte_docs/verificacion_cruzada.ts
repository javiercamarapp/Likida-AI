// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN CRUZADA ENTRE DOCUMENTOS DEL MISMO EMBARQUE (T-A3-56).
//
// Un embarque llega a veces en dos documentos (el correo y el libro de Excel; la remisión y el libro; el BOL y el libro).
// Si los dos dicen cosas distintas, uno de los dos está mal o es OTRA carga: lo ambiguo no se adivina. Esta función PURA
// (sin base, sin red, sin modelo) compara las dos extracciones en cinco dimensiones y devuelve:
//
//   · `marca`  ✔ coinciden · ◐ coinciden pero una persona debe mirar (caja distinta, fracción genérica, algo que no se pudo
//              comparar) · ✗ difieren en piezas, peso, fracción o pedimento (otra carga o una corrección);
//   · `hallazgos`  `fuentes_en_conflicto` (bloqueo si es ✗; confirmar si es ◐ por una diferencia) con las dimensiones.
//
// Lo que NO hace, a propósito: elegir un lado, promediar ni mezclar valores de los dos documentos. Los dos quedan como
// están y la persona decide cuál es el bueno.
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoValor, Extraccion } from './campos';
import { normalizarNumero } from './normalizar';
import { tipoOperacion, type Hallazgo } from './validacion';
import type { MetadatosNombre } from './nombre_archivo';

/** Diferencia máxima entre los pesos (o las piezas) de dos documentos antes de considerarlos distintos: 1 %. */
export const TOLERANCIA_CRUCE_PCT = 0.01;
const TOLERANCIA_CRUCE_MIN_KG = 1;
const TOLERANCIA_CRUCE_MIN_PIEZAS = 0.5;

export type DimensionCruce = 'piezas' | 'peso' | 'fraccion' | 'pedimento' | 'caja';
export type Marca = '✔' | '◐' | '✗';

export interface FuenteEmbarque {
  /** Cómo se llama esta fuente en los mensajes («el correo», «el libro de Excel»). */
  etiqueta: string;
  extraccion: Extraccion;
  /** Metadatos del nombre del archivo: la caja del nombre sirve de respaldo si el contenido no la trae. */
  nombre?: MetadatosNombre | null;
}

export interface DiferenciaCruce {
  dimension: DimensionCruce;
  a: string;
  b: string;
  /** `conflicto`: otra carga o corrección (bloquea). `revisar`: probablemente explicable, la persona confirma. */
  gravedad: 'conflicto' | 'revisar';
  nota: string;
}

export interface ResultadoCruce {
  marca: Marca;
  /** Dimensiones que los dos documentos traen y se pudieron comparar. */
  comparadas: DimensionCruce[];
  /** Dimensiones donde algún documento no trae el dato (no se compara; no se inventa). */
  sinDato: DimensionCruce[];
  diferencias: DiferenciaCruce[];
  hallazgos: Hallazgo[];
}

const num = (c: CampoValor | undefined): number | null => (c?.valor ? normalizarNumero(c.valor).valor : null);

function piezasDe(e: Extraccion): number | null {
  if (e.mercancias.length === 0) return null;
  const v = e.mercancias.map((m) => num(m.cantidad));
  return v.every((x): x is number => x !== null) ? v.reduce((s, x) => s + x, 0) : null;
}

function pesoDe(e: Extraccion): number | null {
  const total = e.campos.peso_bruto_total;
  if (total && total.origen !== 'derivado') {
    const t = num(total);
    if (t !== null && t > 0) return t;
  }
  if (e.mercancias.length === 0) return null;
  const v = e.mercancias.map((m) => num(m.peso_kg));
  return v.every((x): x is number => x !== null) ? v.reduce((s, x) => s + x, 0) : null;
}

/** Solo dígitos: «AA AD PPPP NNNNNNN» y «AAADPPPPNNNNNNN» son el mismo pedimento. */
const soloDigitos = (t: string): string => t.replace(/\D/g, '');

function conjuntoDe(e: Extraccion, clave: string): Set<string> | null {
  const s = new Set<string>();
  for (const m of e.mercancias) {
    const v = m[clave]?.valor;
    if (v) { const d = soloDigitos(v); if (d !== '') s.add(d); }
  }
  return s.size > 0 ? s : null;
}

const cajaDe = (f: FuenteEmbarque): string | null => {
  const v = f.extraccion.campos.caja_numero?.valor;
  const limpio = v ? v.replace(/\s+/g, '').toUpperCase() : '';
  if (limpio !== '') return limpio;
  return f.nombre?.caja?.valor ? f.nombre.caja.valor.replace(/\s+/g, '').toUpperCase() : null;
};

const iguales = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && Array.from(a).every((x) => b.has(x));
const lista = (s: Set<string>): string => Array.from(s).sort().join(', ');
/** Fracción genérica (grupo 98xx): el libro la usa cuando el documento da otra; no es una carga distinta (T-A3-57). */
const esGenerica = (s: Set<string>): boolean => Array.from(s).every((x) => x.startsWith('98'));

function difiereCantidad(a: number, b: number, minimo: number): boolean {
  return Math.abs(a - b) > Math.max(minimo, Math.max(Math.abs(a), Math.abs(b)) * TOLERANCIA_CRUCE_PCT);
}

const redondeo = (n: number): string => String(Math.round(n * 1000) / 1000);

/** Compara dos documentos del mismo cliente y embarque. No mezcla ni elige: solo dice si cuadran. */
export function compararFuentes(a: FuenteEmbarque, b: FuenteEmbarque): ResultadoCruce {
  const comparadas: DimensionCruce[] = [];
  const sinDato: DimensionCruce[] = [];
  const diferencias: DiferenciaCruce[] = [];

  const pa = piezasDe(a.extraccion); const pb = piezasDe(b.extraccion);
  if (pa === null || pb === null) sinDato.push('piezas');
  else {
    comparadas.push('piezas');
    if (difiereCantidad(pa, pb, TOLERANCIA_CRUCE_MIN_PIEZAS)) diferencias.push({ dimension: 'piezas', a: redondeo(pa), b: redondeo(pb), gravedad: 'conflicto', nota: `Piezas: ${a.etiqueta} dice ${redondeo(pa)} y ${b.etiqueta} dice ${redondeo(pb)}.` });
  }

  const ka = pesoDe(a.extraccion); const kb = pesoDe(b.extraccion);
  if (ka === null || kb === null) sinDato.push('peso');
  else {
    comparadas.push('peso');
    if (difiereCantidad(ka, kb, TOLERANCIA_CRUCE_MIN_KG)) diferencias.push({ dimension: 'peso', a: redondeo(ka), b: redondeo(kb), gravedad: 'conflicto', nota: `Peso: ${a.etiqueta} dice ${redondeo(ka)} kg y ${b.etiqueta} dice ${redondeo(kb)} kg.` });
  }

  const fa = conjuntoDe(a.extraccion, 'fraccion_arancelaria'); const fb = conjuntoDe(b.extraccion, 'fraccion_arancelaria');
  if (fa === null || fb === null) sinDato.push('fraccion');
  else {
    comparadas.push('fraccion');
    if (!iguales(fa, fb)) {
      const generica = esGenerica(fa) !== esGenerica(fb);
      diferencias.push({ dimension: 'fraccion', a: lista(fa), b: lista(fb), gravedad: generica ? 'revisar' : 'conflicto', nota: generica ? `Fracción: uno de los dos documentos trae la genérica (98xx) y el otro una específica (${a.etiqueta}: ${lista(fa)}; ${b.etiqueta}: ${lista(fb)}); confirma cuál va.` : `Fracción: ${a.etiqueta} dice ${lista(fa)} y ${b.etiqueta} dice ${lista(fb)}.` });
    }
  }

  const da = conjuntoDe(a.extraccion, 'pedimento'); const db = conjuntoDe(b.extraccion, 'pedimento');
  if (da === null || db === null) sinDato.push('pedimento');
  else {
    comparadas.push('pedimento');
    if (!iguales(da, db)) diferencias.push({ dimension: 'pedimento', a: lista(da), b: lista(db), gravedad: 'conflicto', nota: `Pedimento: ${a.etiqueta} dice ${lista(da)} y ${b.etiqueta} dice ${lista(db)}.` });
  }

  const ca = cajaDe(a); const cb = cajaDe(b);
  if (ca === null || cb === null) sinDato.push('caja');
  else {
    comparadas.push('caja');
    if (ca !== cb) diferencias.push({ dimension: 'caja', a: ca, b: cb, gravedad: 'revisar', nota: `Caja: ${a.etiqueta} dice ${ca} y ${b.etiqueta} dice ${cb}; ¿otra caja del mismo embarque o un error de captura?` });
  }

  const conflicto = diferencias.some((d) => d.gravedad === 'conflicto');
  // Sin piezas o sin peso en alguno de los dos no hay con qué asegurar que cuadran: ◐, no ✔.
  const incompleto = sinDato.includes('piezas') || sinDato.includes('peso');
  const marca: Marca = conflicto ? '✗' : diferencias.length > 0 || incompleto ? '◐' : '✔';

  const hallazgos: Hallazgo[] = [];
  if (diferencias.length > 0) {
    hallazgos.push({
      campo: 'documento',
      renglon: null,
      severidad: conflicto ? 'bloqueo' : 'confirmar',
      codigo: 'fuentes_en_conflicto',
      mensaje: `${a.etiqueta[0].toUpperCase()}${a.etiqueta.slice(1)} y ${b.etiqueta} no dicen lo mismo del embarque. ${diferencias.map((d) => d.nota).join(' ')} No se mezclaron los datos: decide cuál documento es el bueno.`,
    });
  }
  return { marca, comparadas, sinDato, diferencias, hallazgos };
}

/**
 * El nombre del archivo como pista (nunca como dato): avisa cuando contradice al contenido.
 *   · IMPO/EXPO del nombre contra el régimen del documento (IMD… importan; EXD… exportan);
 *   · la caja del nombre contra el número de caja del contenido.
 * Sin pista o sin dato en el contenido no se dice nada.
 */
export function contrastarNombreConContenido(meta: MetadatosNombre, e: Extraccion): Hallazgo[] {
  const h: Hallazgo[] = [];
  const op = tipoOperacion(e);
  if (meta.tipo && (op === 'importacion' || op === 'exportacion')) {
    const delNombre = meta.tipo.valor === 'IMPO' ? 'importacion' : 'exportacion';
    if (delNombre !== op) {
      h.push({ campo: 'regimen_aduanero', renglon: null, severidad: 'confirmar', codigo: 'nombre_contradice_contenido', mensaje: `El nombre del archivo dice «${meta.tipo.evidencia}» pero el régimen del documento es de ${op === 'importacion' ? 'importación' : 'exportación'}. Confirma cuál es.` });
    }
  }
  const caja = e.campos.caja_numero?.valor?.replace(/\s+/g, '').toUpperCase();
  if (meta.caja && caja && caja !== meta.caja.valor) {
    h.push({ campo: 'caja_numero', renglon: null, severidad: 'confirmar', codigo: 'nombre_contradice_contenido', mensaje: `El nombre del archivo dice la caja «${meta.caja.evidencia}» pero el documento dice «${caja}». Confirma cuál es.` });
  }
  return h;
}
