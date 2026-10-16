// ═══════════════════════════════════════════════════════════════════════════
// CONFIANZA COMPUESTA (T-A3-68 b, c, e) — lo que dice el modelo NO es la última palabra.
//
// La prueba con modelos reales mostró errores «seguros de sí mismos»: el total con punto de miles leído 1000× en 3 de 4
// modelos y el peso por embalaje en vez del bruto en los 4, ambos con confianza alta. La confianza declarada solo detecta lo
// que el modelo mismo duda, así que aquí se le suman validadores DETERMINISTAS:
//
//     confianza compuesta  =  confianza del modelo  ⊗  validadores por código  ⊗  acuerdo entre niveles
//
//   · validadores: cuadre del total contra la suma de las mercancías, regla de peso bruto vs neto/por embalaje, forma del
//     RFC/Tax ID, clave de producto y fracción (forma y catálogo SAT si está cargado), CP contra estado y fechas. Son los de
//     `validarExtraccion`, más el rótulo del peso.
//   · un campo CRÍTICO (y el total del peso y la fracción) que falla un validador queda con confianza ≤ 0.5 y ESCALA al
//     siguiente nivel aunque el modelo haya dicho 0.99;
//   · acuerdo entre niveles: lo hace `fusionar` (extractor.ts). Dos niveles de acuerdo no salvan un valor que un validador
//     rechaza: los modelos pueden equivocarse igual.
//   · si el último nivel tampoco cuadra, el campo va a REVISIÓN HUMANA con los valores en conflicto a la vista y nunca se
//     aprueba solo (la confianza queda bajo el umbral y la validación del documento lo vuelve «por confirmar»).
//
// Puro: sin red ni base. Los valores de los ejemplos y pruebas son sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

import { campoDoc, campoMercancia, type CampoValor, type Extraccion } from './campos';
import { limpiarTexto, normalizarNumero } from './normalizar';
import { CODIGOS_SUMA, validarExtraccion, type OpcionesValidacion } from './validacion';

/** Un validador determinista rechazó la lectura de un campo. */
export interface FalloValidador {
  campo: string;
  /** Renglón de mercancía, o `null` si es del documento. */
  renglon: number | null;
  codigo: string;
  mensaje: string;
  /** Los valores en conflicto (lo que leyó cada nivel, o lo que dice el texto), sin repetir. */
  valores: string[];
  /** Otros campos que entran en el conflicto (p. ej. el estado frente al código postal, los renglones frente al total). */
  relacionados?: Array<{ campo: string; renglon: number | null }>;
}

/** Un campo que ningún nivel logró dejar que cuadre: lo resuelve una persona viendo estos valores. */
export interface RevisionHumana {
  campo: string;
  renglon: number | null;
  codigo: string;
  motivo: string;
  valores: string[];
}

/** Confianza máxima de un campo que falla un validador: por debajo de UMBRAL_ESCALA y de UMBRAL_CRITICO. */
export const CONFIANZA_TOPE_FALLO = 0.5;

/** Campos que, además de los críticos, escalan cuando fallan: el total del peso y la fracción arancelaria. */
const ESCALABLES_EXTRA = new Set(['peso_bruto_total', 'fraccion_arancelaria']);
/**
 * Los hallazgos que delatan una LECTURA mala (forma de RFC/CP/clave/fracción, catálogo SAT, sumas, peso imposible, fechas…).
 * Quedan fuera los que no los arregla un modelo mejor: unidad del peso sin convertir, moneda, placas, avisos de contexto,
 * confianza baja o ausencia (esas las cubre la confianza declarada y `carencias`).
 */
const CODIGO_DE_LECTURA = /^(rfc_|taxid_|cp_|clave_(forma|segmento|servicio|no_catalogo)$|unidad_(no_sat|forma|no_catalogo)$|fraccion_(forma|no_catalogo)$|numero_|peso_(imposible|suma|factor_1000|fuentes_difieren)$|suma_|cantidad_peso$|fecha_(forma|orden)$|estado_no_catalogo$|valor_sospechoso$|embalaje_no_catalogo$|peligroso_no_catalogo$)/;
const CODIGOS_PESO_TOTAL = new Set<string>([...CODIGOS_SUMA, 'peso_suma', 'peso_factor_1000', 'peso_fuentes_difieren']);

const esEscalable = (campo: string, renglon: number | null): boolean => {
  if (ESCALABLES_EXTRA.has(campo)) return true;
  return (renglon === null ? campoDoc(campo) : campoMercancia(campo))?.critico === true;
};

const presente = (c: CampoValor | undefined): c is CampoValor => !!c && c.valor !== null && c.valor !== '';
const num = (c: CampoValor | undefined): number | null => (presente(c) ? normalizarNumero(c.valor as string).valor : null);
const unicos = (xs: Array<string | null | undefined>): string[] => [...new Set(xs.filter((x): x is string => typeof x === 'string' && x !== ''))];

// ── (b) Montos y pesos con separadores ambiguos ─────────────────────────────

/**
 * Las lecturas posibles de UNA cifra escrita con separadores. «1.234.567» y «1,234,567.89» no son ambiguas (una sola
 * lectura); «14.029» y «6,578» sí: pueden ser decimales o miles. La primera lectura es la que usa México por defecto.
 */
export function lecturasPosibles(token: string): number[] {
  const t = token.trim().replace(/\s+/g, '');
  const base = normalizarNumero(t);
  if (base.valor === null) return [];
  if (!/^[+-]?\d{1,3}[.,]\d{3}$/.test(t)) return [base.valor];
  const miles = Number(t.replace(/^[+-]/, '').replace(/[.,]/, ''));
  const decimal = Number(t.replace(',', '.'));
  const otra = base.valor === decimal ? miles : decimal;
  return [base.valor, otra];
}

const TOKEN_AMBIGUO = /(?<![\d.,])\d{1,3}[.,]\d{3}(?![.,]?\d)/g;
const dentro = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

export interface ResolucionAmbiguos { extraccion: Extraccion; notas: string[] }

/**
 * El total del peso que el modelo leyó con un número ambiguo («14.029»: ¿catorce con veintinueve o catorce mil veintinueve?)
 * se resuelve CON EL CUADRE contra la suma de los renglones: si la otra lectura es la que cuadra, se corrige (con nota y sin
 * subir la confianza por encima de 0.9); si ninguna cuadra, no se toca (el validador de sumas bloquea). Nunca se adivina sin
 * una suma contra qué comparar.
 */
export function resolverAmbiguosPorCuadre(e: Extraccion): ResolucionAmbiguos {
  const notas: string[] = [];
  const total = e.campos.peso_bruto_total;
  if (!presente(total) || total.origen === 'derivado' || total.origen === 'humano' || e.mercancias.length === 0) return { extraccion: e, notas };
  const pesos = e.mercancias.map((f) => num(f.peso_kg));
  if (!pesos.every((p): p is number => p !== null)) return { extraccion: e, notas };
  const suma = pesos.reduce((s, p) => s + p, 0);
  const actual = num(total) as number;
  if (dentro(actual, suma)) return { extraccion: e, notas };
  const fuente = `${total.evidencia ?? ''} ${total.valor ?? ''}`;
  for (const m of fuente.matchAll(TOKEN_AMBIGUO)) {
    const lecturas = lecturasPosibles(m[0]);
    if (lecturas.length < 2 || !dentro(lecturas[0], actual)) continue;
    const otra = lecturas[1];
    if (!dentro(otra, suma)) continue;
    const nota = `«${m[0]}» era ambiguo (${lecturas[0]} o ${otra}): se tomó ${otra} porque es la que cuadra con la suma de las mercancías (${Math.round(suma * 1000) / 1000} kg).`;
    notas.push(nota);
    const corregido: CampoValor = { ...total, valor: String(otra), confianza: Math.min(0.9, Math.max(total.confianza, 0.85)), notas: [...(total.notas ?? []).filter((n) => !/Confírmalo|confirma la cifra/i.test(n)), nota] };
    return { extraccion: { ...e, campos: { ...e.campos, peso_bruto_total: corregido } }, notas };
  }
  return { extraccion: e, notas };
}

// ── (c) Peso bruto vs peso por embalaje ─────────────────────────────────────

const ROTULO_NO_BRUTO = /(peso\s+por\s+embalaje|por\s+embalaje|peso\s+neto|net\s*w(?:eigh)?t|\bneto\b|\bnet\b)/i;
const ROTULO_BRUTO = /(bruto|gross)/i;
/** «Peso total bruto: 1,234.5», «Gross weight 1.234,5 kg»: el número que sigue al rótulo de bruto. */
const BRUTO_EN_TEXTO = /(?:peso\s+(?:total\s+)?bruto|total\s+gross\s+weight|gross\s+weight)[^\d\n]{0,30}(\d[\d.,]*\d|\d)/gi;

/** Los números que el texto del documento da como peso BRUTO (lo que manda en F1). */
export function brutosEnTexto(texto: string): number[] {
  return [...texto.matchAll(BRUTO_EN_TEXTO)].map((m) => normalizarNumero(m[1]).valor).filter((n): n is number => n !== null && n > 0);
}

/**
 * Regla de peso (T-A3-52/68 c): manda el peso BRUTO; el neto o «por embalaje» no es el peso del complemento.
 *   · si el texto trae un «peso total bruto» y la lectura no lo es → falla, con los dos valores;
 *   · si la evidencia de la lectura es un rótulo de neto/por embalaje (y no de bruto) → falla.
 * Sin texto (visión) solo actúa la evidencia que citó el modelo.
 */
export function validarRotuloPeso(e: Extraccion, texto: string | null): FalloValidador[] {
  const fallos: FalloValidador[] = [];
  const total = e.campos.peso_bruto_total;
  const pesos = e.mercancias.map((f) => num(f.peso_kg));
  const suma = pesos.length > 0 && pesos.every((p): p is number => p !== null) ? pesos.reduce((s, p) => s + p, 0) : null;
  const propio = presente(total) && total.origen !== 'derivado' ? num(total) : suma;
  const brutos = texto ? brutosEnTexto(texto) : [];
  if (propio !== null && brutos.length > 0 && !brutos.some((b) => dentro(propio, b))) {
    const objetivo = presente(total) && total.origen !== 'derivado' ? { campo: 'peso_bruto_total', renglon: null } : { campo: 'peso_kg', renglon: e.mercancias.length === 1 ? 0 : null };
    const valores = unicos([String(propio), ...brutos.map(String)]);
    fallos.push({ ...objetivo, codigo: 'peso_no_es_bruto', mensaje: `El documento trae un «peso total bruto» (${brutos.join(' / ')} kg) y la lectura (${propio} kg) no coincide: se tomó otro peso (neto o por embalaje).`, valores });
  } else {
    e.mercancias.forEach((f, i) => {
      const c = f.peso_kg;
      if (!presente(c) || c.origen !== 'llm') return;
      const ev = c.evidencia ?? '';
      if (ROTULO_NO_BRUTO.test(ev) && !ROTULO_BRUTO.test(ev) && (f.peso_tipo?.valor ?? '').toLowerCase() !== 'bruto') {
        fallos.push({ campo: 'peso_kg', renglon: i, codigo: 'peso_rotulo_no_bruto', mensaje: `El peso se leyó de un rótulo de peso neto o por embalaje («${limpiarTexto(ev, 80) ?? ''}»); el complemento pide el peso bruto.`, valores: unicos([c.valor]) });
      }
    });
  }
  return fallos;
}

// ── (e) Los validadores y la confianza compuesta ────────────────────────────

export interface OpcionesCompuesta {
  /** El texto del documento, si lo hay (visión: `null`): permite leer el «peso total bruto» por código. */
  texto?: string | null;
  /** Catálogos SAT precargados (clave de producto, unidad): sin ellos solo se valida la forma. */
  catalogosSat?: OpcionesValidacion['catalogosSat'];
  ahora?: Date;
}

/** Todos los validadores deterministas sobre una lectura. Solo cuentan los campos escalables (críticos, total del peso, fracción). */
export function validadoresDeterministas(e: Extraccion, op: OpcionesCompuesta = {}): FalloValidador[] {
  const fallos: FalloValidador[] = [];
  const llave = (f: { campo: string; renglon: number | null; codigo: string }) => `${f.campo}#${f.renglon ?? 'doc'}#${f.codigo}`;
  const vistos = new Set<string>();
  const sumar = (f: FalloValidador) => { if (!vistos.has(llave(f))) { vistos.add(llave(f)); fallos.push(f); } };
  const r = validarExtraccion(e, { ahora: op.ahora ?? new Date('2026-01-01T00:00:00Z'), catalogosSat: op.catalogosSat, reglasGuia: false });
  for (const h of r.hallazgos) {
    if (h.severidad === 'aviso' || !CODIGO_DE_LECTURA.test(h.codigo) || h.origen === 'tms') continue;
    const afectados = [{ campo: h.campo, renglon: h.renglon }, ...(h.relacionados ?? [])];
    // Un desajuste del total del peso afecta también al peso de cada renglón (no se sabe cuál de los dos leyó mal).
    if (CODIGOS_PESO_TOTAL.has(h.codigo)) e.mercancias.forEach((_, i) => afectados.push({ campo: 'peso_kg', renglon: i }));
    for (const a of afectados) {
      if (!esEscalable(a.campo, a.renglon)) continue;
      const c = a.renglon === null ? e.campos[a.campo] : e.mercancias[a.renglon]?.[a.campo];
      if (!presente(c) || c.origen === 'humano') continue;
      const hermanos = afectados.filter((x) => x !== a).map((x) => (x.renglon === null ? e.campos[x.campo] : e.mercancias[x.renglon]?.[x.campo])?.valor);
      sumar({ campo: a.campo, renglon: a.renglon, codigo: h.codigo, mensaje: h.mensaje, valores: unicos([c.valor, ...hermanos]), relacionados: afectados.filter((x) => x !== a) });
    }
  }
  for (const f of validarRotuloPeso(e, op.texto ?? null)) sumar(f);
  return fallos;
}

/** Baja a ≤ 0.5 la confianza de cada campo que falló un validador y le deja el motivo (sin duplicar la nota). */
export function aplicarConfianzaCompuesta(e: Extraccion, fallos: ReadonlyArray<FalloValidador>): Extraccion {
  if (fallos.length === 0) return e;
  const por = new Map<string, FalloValidador[]>();
  for (const f of fallos) { const k = `${f.renglon ?? 'doc'}|${f.campo}`; por.set(k, [...(por.get(k) ?? []), f]); }
  const marca = (c: CampoValor, lista: FalloValidador[]): CampoValor => {
    const nuevas = lista.map((f) => `Validador: ${f.mensaje}`).filter((n) => !(c.notas ?? []).includes(n));
    return { ...c, confianza: Math.min(c.confianza, CONFIANZA_TOPE_FALLO), notas: [...(c.notas ?? []), ...nuevas] };
  };
  const campos = { ...e.campos };
  for (const k of Object.keys(campos)) { const l = por.get(`doc|${k}`); if (l && presente(campos[k])) campos[k] = marca(campos[k], l); }
  const mercancias = e.mercancias.map((fila, i) => {
    const copia = { ...fila };
    for (const k of Object.keys(copia)) { const l = por.get(`${i}|${k}`); if (l && presente(copia[k])) copia[k] = marca(copia[k], l); }
    return copia;
  });
  return { campos, mercancias };
}

/**
 * Los campos que siguen fallando tras el último nivel, con los valores que leyó CADA nivel (los valores en conflicto).
 * `lecturas` son las extracciones de cada nivel, en orden.
 */
export function revisionHumanaDe(fallos: ReadonlyArray<FalloValidador>, lecturas: ReadonlyArray<Extraccion>): RevisionHumana[] {
  const salida = new Map<string, RevisionHumana>();
  for (const f of fallos) {
    const k = `${f.renglon ?? 'doc'}|${f.campo}`;
    const de = (l: Extraccion, x: { campo: string; renglon: number | null }) => (x.renglon === null ? l.campos[x.campo] : l.mercancias[x.renglon]?.[x.campo])?.valor;
    const delNivel = lecturas.flatMap((l) => [de(l, f), ...(f.relacionados ?? []).map((x) => de(l, x))]);
    const previo = salida.get(k);
    salida.set(k, {
      campo: f.campo, renglon: f.renglon,
      codigo: previo && previo.codigo !== f.codigo ? `${previo.codigo}+${f.codigo}` : f.codigo,
      motivo: previo && previo.motivo !== f.mensaje ? `${previo.motivo} ${f.mensaje}` : f.mensaje,
      valores: unicos([...(previo?.valores ?? []), ...delNivel, ...f.valores]),
    });
  }
  return [...salida.values()];
}
