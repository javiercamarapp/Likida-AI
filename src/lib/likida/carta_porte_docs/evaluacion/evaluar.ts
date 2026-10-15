// ═══════════════════════════════════════════════════════════════════════════
// EVALUAR — comparar lo que el módulo extrajo contra lo esperado, campo por campo.
//
// Función PURA (sin E/S, sin modelo). Marca cada campo con:
//
//   ✔  el valor es el esperado, la confianza llega al umbral de los críticos, la
//      validación no levantó nada sobre ese campo y el valor no es una conversión
//      de lo escrito (libras, coma decimal, mes/día…): puede pasar sin que nadie lo mire.
//   ◐  el valor es el esperado PERO una persona debe mirarlo: confianza baja, un
//      hallazgo `confirmar`/`bloqueo` sobre ese campo, o una conversión que el
//      módulo hizo por su cuenta.
//   ✗  falta, o es distinto de lo esperado (el error silencioso: lo peor).
//
// Los valores esperados son SINTÉTICOS con la forma de las muestras; aquí no hay
// datos reales (el repo es público).
// ═══════════════════════════════════════════════════════════════════════════

import { UMBRAL_CRITICO, campoDoc, campoMercancia, type CampoDoc, type CampoValor, type Extraccion } from '../campos';
import { normalizarNumero } from '../normalizar';
import { validarExtraccion, type Hallazgo } from '../validacion';

export type EstadoEsperado = 'ok' | 'revisar' | 'falta';
export type Marca = '✔' | '◐' | '✗';

export const MARCA_DE: Readonly<Record<EstadoEsperado, Marca>> = { ok: '✔', revisar: '◐', falta: '✗' };

/**
 * Un campo de la matriz campo × muestra.
 * `campo`: clave del documento (`origen_rfc`) o `mercancias[0].peso_kg` (renglón 0), o la pseudo-clave `n_mercancias`.
 * `valor`: lo que traería el CCP verdadero (inventado, con la misma forma). `estado`: lo que ESTA forma de documento da.
 * `brecha`: la discrepancia conocida con `08 §2` (lo que el análisis marcaba y el módulo todavía no distingue).
 */
export interface CampoEsperado {
  campo: string;
  valor: string | null;
  estado: EstadoEsperado;
  brecha?: string;
}

export interface Evaluacion { estado: Marca; motivo: string }
export type EvaluacionCampos = Record<string, Evaluacion>;

export interface Resumen {
  total: number;
  ok: number;
  revisar: number;
  falta: number;
  pctOk: number;
  pctRevisar: number;
  pctFalta: number;
  /** Campos que la forma del documento trae LIMPIOS (esperado `ok`). */
  traidos: number;
  /** ✔ entre esos: si baja, el módulo dejó de leer algo que la forma sí trae. */
  pctOkDeTraidos: number;
  /** Campos CRÍTICOS que quedaron en ✗ (ausentes o distintos). */
  criticosFallidos: string[];
}

export interface OpcionesEvaluar {
  /** Reloj fijo para la validación (la prueba no depende de la fecha de hoy). */
  ahora?: Date;
  riesgoInyeccion?: boolean;
}

export const AHORA_FIJO = new Date('2026-10-15T12:00:00Z');

const REGEX_CONVERSION = /convertid|convirti|se tradujo|día\/mes|ambigu|se completó/i;

interface Ubicado { def: CampoDoc | undefined; valor: CampoValor | undefined; renglon: number | null; clave: string }

function ubicar(e: Extraccion, campo: string): Ubicado {
  const m = /^mercancias\[(\d+)\]\.(.+)$/.exec(campo);
  if (m) {
    const i = Number(m[1]);
    return { def: campoMercancia(m[2]), valor: e.mercancias[i]?.[m[2]], renglon: i, clave: m[2] };
  }
  return { def: campoDoc(campo), valor: e.campos[campo], renglon: null, clave: campo };
}

const vacio = (c: CampoValor | undefined): boolean => !c || c.valor === null || c.valor === '';

function mismoValor(def: CampoDoc | undefined, obtenido: string, esperado: string): boolean {
  if (def?.tipo === 'numero') {
    const a = normalizarNumero(obtenido).valor; const b = normalizarNumero(esperado).valor;
    return a !== null && b !== null && Math.abs(a - b) < 0.0005;
  }
  return obtenido.trim().toUpperCase() === esperado.trim().toUpperCase();
}

/** ¿El número que quedó NO es ninguno de los números literales de la evidencia? (coma decimal, miles, libras → kg…). */
export function esConversionNumerica(def: CampoDoc | undefined, c: CampoValor): boolean {
  if (def?.tipo !== 'numero' || !c.evidencia || c.origen === 'derivado' || c.origen === 'catalogo') return false;
  const tokens = [...c.evidencia.matchAll(/\d[\d.,\s]*\d|\d/g)].map((x) => x[0].replace(/\s/g, ''));
  if (tokens.length === 0) return false;
  const final = Number(c.valor);
  return !tokens.some((t) => Number(t) === final);
}

function hallazgosDe(hs: Hallazgo[], u: Ubicado): Hallazgo[] {
  return hs.filter((h) => (h.severidad === 'confirmar' || h.severidad === 'bloqueo') && h.campo === u.clave && h.renglon === u.renglon);
}

/** Evalúa cada campo esperado contra la extracción. Pura y determinista. */
export function evaluar(extraccion: Extraccion, esperado: ReadonlyArray<CampoEsperado>, op: OpcionesEvaluar = {}): EvaluacionCampos {
  const hs = validarExtraccion(extraccion, { ahora: op.ahora ?? AHORA_FIJO, riesgoInyeccion: op.riesgoInyeccion }).hallazgos;
  const out: EvaluacionCampos = {};
  for (const esp of esperado) {
    if (esp.campo === 'n_mercancias') {
      const n = extraccion.mercancias.length;
      out[esp.campo] = String(n) === esp.valor ? { estado: '✔', motivo: `${n} renglones` } : { estado: '✗', motivo: `distinto: ${n} renglones, esperaba ${esp.valor}` };
      continue;
    }
    const u = ubicar(extraccion, esp.campo);
    if (vacio(u.valor) || esp.valor === null) {
      out[esp.campo] = esp.valor === null && vacio(u.valor)
        ? { estado: '✗', motivo: 'ausente' }
        : { estado: '✗', motivo: vacio(u.valor) ? 'ausente' : `distinto: leí «${u.valor?.valor}», no se esperaba valor` };
      continue;
    }
    const c = u.valor as CampoValor;
    if (!mismoValor(u.def, c.valor as string, esp.valor)) {
      out[esp.campo] = { estado: '✗', motivo: `distinto: leí «${c.valor}», esperaba «${esp.valor}»` };
      continue;
    }
    const razones: string[] = [];
    if (c.confianza < UMBRAL_CRITICO) razones.push(`confianza ${Math.round(c.confianza * 100)} %`);
    for (const h of hallazgosDe(hs, u)) razones.push(`${h.severidad}: ${h.codigo}`);
    if (esConversionNumerica(u.def, c)) razones.push(`conversión: «${c.evidencia}» → ${c.valor}`);
    const nota = (c.notas ?? []).find((n) => REGEX_CONVERSION.test(n));
    if (nota) razones.push(`nota: ${nota}`);
    out[esp.campo] = razones.length > 0 ? { estado: '◐', motivo: razones.join('; ') } : { estado: '✔', motivo: 'igual al esperado' };
  }
  return out;
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

export function resumir(ev: EvaluacionCampos, esperado: ReadonlyArray<CampoEsperado>): Resumen {
  const campos = esperado.filter((x) => x.campo !== 'n_mercancias');
  const marca = (k: string): Marca => ev[k].estado;
  const ok = campos.filter((x) => marca(x.campo) === '✔').length;
  const revisar = campos.filter((x) => marca(x.campo) === '◐').length;
  const falta = campos.filter((x) => marca(x.campo) === '✗').length;
  const traidos = campos.filter((x) => x.estado === 'ok');
  const okTraidos = traidos.filter((x) => marca(x.campo) === '✔').length;
  const criticosFallidos = campos.filter((x) => {
    if (marca(x.campo) !== '✗') return false;
    const u = ubicar({ campos: {}, mercancias: [] }, x.campo);
    return u.def?.critico === true;
  }).map((x) => x.campo);
  return {
    total: campos.length, ok, revisar, falta,
    pctOk: pct(ok, campos.length), pctRevisar: pct(revisar, campos.length), pctFalta: pct(falta, campos.length),
    traidos: traidos.length, pctOkDeTraidos: pct(okTraidos, traidos.length),
    criticosFallidos,
  };
}

/** ¿Qué campos NO coinciden con la matriz congelada? (`[]` = coincide exactamente). */
export function diferenciasConMatriz(ev: EvaluacionCampos, esperado: ReadonlyArray<CampoEsperado>): string[] {
  return esperado
    .filter((x) => ev[x.campo].estado !== (x.campo === 'n_mercancias' ? '✔' : MARCA_DE[x.estado]))
    .map((x) => `${x.campo}: esperaba ${x.campo === 'n_mercancias' ? '✔' : MARCA_DE[x.estado]}, salió ${ev[x.campo].estado} (${ev[x.campo].motivo})`);
}

/** La tabla de resumen por muestra, lista para imprimir (reporte de F5). */
export function tablaResumen(filas: ReadonlyArray<{ id: string; resumen: Resumen }>): string {
  const cab = ['Muestra', '✔', '◐', '✗', '% ✔', '% ◐', '% ✗', '% ✔ de lo que trae', 'Críticos fallidos'];
  const cuerpo = filas.map(({ id, resumen: r }) => [
    id, String(r.ok), String(r.revisar), String(r.falta), `${r.pctOk}`, `${r.pctRevisar}`, `${r.pctFalta}`, `${r.pctOkDeTraidos}`,
    r.criticosFallidos.length > 0 ? r.criticosFallidos.join(', ') : '—',
  ]);
  const anchos = cab.map((h, i) => Math.max(h.length, ...cuerpo.map((f) => f[i].length)));
  const linea = (f: string[]): string => `| ${f.map((x, i) => x.padEnd(anchos[i])).join(' | ')} |`;
  return [linea(cab), `|${anchos.map((a) => '-'.repeat(a + 2)).join('|')}|`, ...cuerpo.map(linea)].join('\n');
}
