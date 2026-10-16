// ═══════════════════════════════════════════════════════════════════════════
// CONVERTIDOR extracción → plantilla del TMS (normal o nueva) — T-A3-62.
//
// Los formatos C, D, E, F1–F3 y G (remisión, BOL, orden de agente, correos, JSON) se convierten a nuestro formato. Rara vez
// traen cliente interno, claves SAT de domicilio, distancia, régimen o el tramo mexicano: esto se completa aquí desde los
// catálogos y se entrega como BORRADOR PARA REVISIÓN. Nunca se envía solo.
//
// Reglas (la ficha manda):
//   · Cada valor que no salió del documento queda marcado «inferido» con su origen y NUNCA pasa por «leído».
//   · Lo que el documento sí trae no se sobrescribe (los catálogos solo llenan vacíos y avisan de diferencias).
//   · Sin catálogo aplicable el campo queda vacío y el borrador queda BLOQUEADO («falta dato»); no se inventa ningún valor.
//   · No timbra, no crea viaje ni carta porte, no toca el TMS: `puedeEnviarseAlTms` es siempre `false` y la aprobación de una
//     persona es un paso posterior (T-A3-63).
//
// Es PURO: no llama a ningún modelo ni toca la red. Reutiliza `validarEntradaPlantilla` (T-A3-64) para catálogo, distancias y
// faltantes, `elegirPlantillaPorContenido` (T-A3-44) para normal/nueva y `construirPlantilla` para el libro.
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoValor, Extraccion, Origen } from './campos';
import type { CatalogoCliente, ContextoCatalogo } from './catalogo_cliente';
import { elegirPlantillaPorContenido, type EleccionPorContenido, type NombrePlantilla } from './elegir_plantilla';
import { construirPlantilla, type PlantillaConstruida } from './plantilla_tms';
import { tipoOperacion, validarReglasGuia, type Hallazgo, type ReglasGuia, type TipoOperacion } from './validacion';
import { validarEntradaPlantilla, type AvisoEntrada, type DistanciaCat, type ResultadoValidacionEntrada } from './validacion_entrada_plantilla';

/** Los formatos de entrada que se CONVIERTEN (A y B ya son plantilla: se validan con T-A3-64). */
export const FORMATOS_CONVERTIBLES = ['C', 'D', 'E', 'F1', 'F2', 'F3', 'G'] as const;
export type FormatoConvertible = (typeof FORMATOS_CONVERTIBLES)[number];

export type EstadoMarca = 'leido' | 'inferido';
export type FuenteInferido = 'catalogo' | 'catalogo_distancias' | 'tipo_operacion' | 'tramo_mexicano';

/** Marca de un valor del borrador: lo que se leyó del documento o lo que se infirió, y de dónde. */
export interface MarcaCampo {
  campo: string;
  /** Índice de la mercancía o `null` si es del documento. */
  renglon: number | null;
  estado: EstadoMarca;
  /** Solo en los inferidos. */
  fuente: FuenteInferido | null;
  valor: string;
}

export type OrigenBloqueo = 'falta_dato' | 'plantilla' | 'guia';

export interface BloqueoBorrador {
  campo: string;
  renglon: number | null;
  origen: OrigenBloqueo;
  mensaje: string;
}

/**
 * Regla del tramo mexicano (T-A3-50, aún no construida): dado el documento y el tipo de operación, devuelve los valores del
 * extremo mexicano (patio, cruce) que el documento no trae. Opcional: sin ella, el extremo extranjero se deja como vino y se avisa.
 */
export interface ResultadoTramoMexicano {
  /** `campo` de la extracción → valor. Solo se aplican a campos VACÍOS; lo leído no se pisa. */
  cambios: Record<string, string>;
  evidencia: string;
}
export type ReglaTramoMexicano = (extraccion: Extraccion, operacion: TipoOperacion) => ResultadoTramoMexicano | null;

export interface EntradaConvertidor {
  formato: FormatoConvertible;
  /** La extracción común que dejó el lector del formato (lo leído del documento). No se modifica. */
  extraccion: Extraccion;
  catalogo: CatalogoCliente | null | undefined;
  contexto: ContextoCatalogo;
  distancias?: readonly DistanciaCat[] | null;
  /** Plantilla elegida a mano por una persona; se respeta sobre el criterio provisional. */
  plantillaManual?: NombrePlantilla | null;
  tramoMexicano?: ReglaTramoMexicano | null;
  reglasGuia?: Partial<ReglasGuia> | false;
}

export interface BorradorConversion {
  estado: 'borrador_para_revision';
  formato: FormatoConvertible;
  eleccion: EleccionPorContenido;
  /** Extracción completada; cada valor inferido lleva origen distinto de llm/perfil/xml y la nota «Inferido». */
  extraccion: Extraccion;
  libro: PlantillaConstruida;
  marcas: MarcaCampo[];
  inferidos: MarcaCampo[];
  bloqueos: BloqueoBorrador[];
  /** `true` si falta algún dato o la Guía bloquea: la persona debe resolverlo antes de aprobar. */
  bloqueado: boolean;
  avisos: string[];
  detalle: ResultadoValidacionEntrada;
  /** Siempre `false`: nada llega al TMS sin aprobación humana. */
  puedeEnviarseAlTms: false;
  aprobadoPorPersona: false;
}

/** Orígenes que significan «salió del documento» (o lo escribió una persona). Todo lo demás es inferido. */
const ORIGENES_LEIDOS: readonly Origen[] = ['xml', 'perfil', 'llm', 'humano'];

export const REGIMEN_EXPORTACION = 'EXD';
export const REGIMEN_IMPORTACION = 'IMD';

const texto = (c: CampoValor | undefined): string => (c?.valor ?? '').toString().trim();
const hay = (c: CampoValor | undefined): boolean => texto(c) !== '';
const esLeidoCampo = (c: CampoValor | undefined): boolean => hay(c) && ORIGENES_LEIDOS.includes((c as CampoValor).origen);
const esMexico = (p: string): boolean => /^(MEX|MX)/.test(p.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[\s.]/g, ''));

const llaveMarca = (campo: string, renglon: number | null): string => `${renglon ?? '-'}|${campo}`;

const notaInferido = (fuente: FuenteInferido): string => {
  const de: Record<FuenteInferido, string> = {
    catalogo: 'el catálogo del cliente',
    catalogo_distancias: 'el catálogo de distancias',
    tipo_operacion: 'el tipo de operación (de los países de origen y destino)',
    tramo_mexicano: 'la regla del tramo mexicano',
  };
  return `Inferido desde ${de[fuente]}: el documento no lo traía. Confírmalo.`;
};

/** Régimen por tipo de operación: solo si el documento no trae régimen y los países son inequívocos. */
function inferirRegimen(e: Extraccion): { valor: string; evidencia: string } | null {
  if (hay(e.campos.regimen_aduanero)) return null;
  if (e.mercancias.some((m) => hay(m.regimen_aduanero))) return null;
  const o = texto(e.campos.origen_pais);
  const d = texto(e.campos.destino_pais);
  if (o === '' || d === '') return null;
  if (esMexico(o) && !esMexico(d)) return { valor: REGIMEN_EXPORTACION, evidencia: `Origen ${o}, destino ${d}: exportación` };
  if (!esMexico(o) && esMexico(d)) return { valor: REGIMEN_IMPORTACION, evidencia: `Origen ${o}, destino ${d}: importación` };
  return null;
}

/** Operación del documento: del régimen si lo trae; si no, de los países de origen y destino. */
function operacionDe(e: Extraccion): TipoOperacion {
  const t = tipoOperacion(e);
  if (t !== 'desconocida') return t;
  const o = texto(e.campos.origen_pais);
  const d = texto(e.campos.destino_pais);
  if (o !== '' && d !== '' && esMexico(o) && !esMexico(d)) return 'exportacion';
  if (o !== '' && d !== '' && !esMexico(o) && esMexico(d)) return 'importacion';
  return 'desconocida';
}

function agregarNota(c: CampoValor, nota: string): CampoValor {
  return { ...c, notas: [...(c.notas ?? []).filter((n) => n !== nota), nota] };
}

/** Marca de «leído» o «inferido» para cada valor presente de la extracción final. */
function calcularMarcas(
  entrada: Extraccion, final: Extraccion, fuentes: Map<string, FuenteInferido>,
): MarcaCampo[] {
  const marcas: MarcaCampo[] = [];
  const poner = (campo: string, renglon: number | null, antes: CampoValor | undefined, ahora: CampoValor): void => {
    const valor = texto(ahora);
    if (valor === '') return;
    const leido = esLeidoCampo(antes) && texto(antes) === valor;
    if (leido) { marcas.push({ campo, renglon, estado: 'leido', fuente: null, valor }); return; }
    const fuente = fuentes.get(llaveMarca(campo, renglon)) ?? (ahora.origen === 'derivado' ? 'tipo_operacion' : 'catalogo');
    marcas.push({ campo, renglon, estado: 'inferido', fuente, valor });
  };
  for (const [k, v] of Object.entries(final.campos)) poner(k, null, entrada.campos[k], v);
  final.mercancias.forEach((fila, i) => {
    for (const [k, v] of Object.entries(fila)) poner(k, i, entrada.mercancias[i]?.[k], v);
  });
  return marcas;
}

function mensajeAviso(a: AvisoEntrada): string { return a.mensaje; }

const CLAVE_FALTANTE_LIBRO = (campo: string): string => (campo === 'ctx.clienteInterno' ? 'numero_cliente_interno' : campo.replace(/^mercancia\./, ''));

export function convertirExtraccion(entrada: EntradaConvertidor): BorradorConversion {
  const original = entrada.extraccion;
  const trabajo: Extraccion = structuredClone(original);
  const fuentes = new Map<string, FuenteInferido>();
  const avisos: string[] = [];

  // ── 1. Plantilla normal o nueva (criterio provisional de T-A3-44; lo manual se respeta) ────────────────────────────
  const eleccion = elegirPlantillaPorContenido(trabajo, entrada.plantillaManual);
  avisos.push(...eleccion.avisos);

  // ── 2. Tramo mexicano (T-A3-50): solo llena vacíos; sin regla, se avisa ───────────────────────────────────────────
  const operacion = operacionDe(trabajo);
  if (entrada.tramoMexicano) {
    const r = entrada.tramoMexicano(structuredClone(trabajo), operacion);
    if (r) {
      for (const [campo, valor] of Object.entries(r.cambios)) {
        const actual = trabajo.campos[campo];
        if (hay(actual)) {
          if (texto(actual) !== valor.trim()) avisos.push(`Tramo mexicano: la regla propone «${valor}» para ${campo} y el documento dice «${texto(actual)}». Se conservó lo del documento.`);
          continue;
        }
        trabajo.campos[campo] = { valor, confianza: 0.7, evidencia: r.evidencia.slice(0, 200), origen: 'derivado', notas: [notaInferido('tramo_mexicano')] };
        fuentes.set(llaveMarca(campo, null), 'tramo_mexicano');
      }
    }
  }

  // ── 3. Catálogo del cliente, distancias y faltantes (T-A3-64): A = plantilla normal, B = nueva ────────────────────
  const detalle = validarEntradaPlantilla({
    formato: eleccion.plantilla === 'nueva' ? 'B' : 'A',
    extraccion: trabajo, catalogo: entrada.catalogo, contexto: entrada.contexto, distancias: entrada.distancias,
  });
  for (const c of detalle.completados) fuentes.set(llaveMarca(c.campo, c.renglon), c.fuente);
  const final = detalle.extraccion;

  // Sin regla del tramo mexicano: si, ya con los países del catálogo, un extremo cae fuera de México, se avisa.
  if (!entrada.tramoMexicano) {
    const op = operacionDe(final);
    const fuera = (lado: 'origen' | 'destino'): boolean => { const p = texto(final.campos[`${lado}_pais`]); return p !== '' && !esMexico(p); };
    if ((op === 'exportacion' && fuera('destino')) || (op === 'importacion' && fuera('origen'))) {
      avisos.push('El documento trae un extremo fuera de México y aún no hay regla del tramo mexicano (T-A3-50): se dejó tal como vino. Confirma que el origen y el destino del libro sean los del tramo mexicano.');
    }
  }

  // ── 4. Régimen por tipo de operación (solo si el documento no trae régimen; los países ya pueden venir del catálogo) ──
  const regimen = inferirRegimen(final);
  if (regimen) {
    final.campos.regimen_aduanero = {
      valor: regimen.valor, confianza: 0.6, evidencia: regimen.evidencia, origen: 'derivado', notas: [],
    };
    fuentes.set(llaveMarca('regimen_aduanero', null), 'tipo_operacion');
  }
  // Los avisos de la Guía se recalculan con el régimen ya inferido (el pedimento y el embalaje dependen de él).
  avisos.push(...detalle.avisos.filter((a) => a.tipo !== 'guia').map(mensajeAviso));
  avisos.push(...validarReglasGuia(final, entrada.reglasGuia).map((h) => h.mensaje));

  // ── 5. Marcas «leído / inferido» y nota «Inferido» en cada valor que no vino del documento ────────────────────────
  const marcas = calcularMarcas(original, final, fuentes);
  for (const m of marcas) {
    if (m.estado !== 'inferido') continue;
    const fuente = m.fuente as FuenteInferido;
    if (m.renglon === null) final.campos[m.campo] = agregarNota(final.campos[m.campo], notaInferido(fuente));
    else final.mercancias[m.renglon][m.campo] = agregarNota(final.mercancias[m.renglon][m.campo], notaInferido(fuente));
  }
  const inferidos = marcas.filter((m) => m.estado === 'inferido');

  // ── 6. El libro (borrador): solo descarga/revisión, nunca envío ───────────────────────────────────────────────────
  const libro = construirPlantilla(final, {
    clienteInterno: null, plantilla: eleccion.plantilla, uso: 'descarga', avisos: [], reglasGuia: entrada.reglasGuia,
  });
  for (const a of libro.avisos) if (!avisos.includes(a)) avisos.push(a);

  // ── 7. Bloqueos: falta dato (catálogo no resolvió), celdas obligatorias vacías, bloqueos de la Guía ───────────────
  const bloqueos: BloqueoBorrador[] = [];
  const vistos = new Set<string>();
  const agregar = (b: BloqueoBorrador): void => {
    const k = `${b.renglon ?? '-'}|${b.campo}`;
    if (vistos.has(k)) return;
    vistos.add(k); bloqueos.push(b);
  };
  for (const f of detalle.faltantes) agregar({ campo: f.campo, renglon: f.renglon, origen: 'falta_dato', mensaje: f.mensaje });
  for (const f of libro.faltantes) {
    const campo = CLAVE_FALTANTE_LIBRO(f.campo);
    agregar({
      campo, renglon: null, origen: 'plantilla',
      mensaje: f.mensaje ?? `Falta ${campo.replace(/_/g, ' ')} (celda ${f.celda}): el documento no lo trae y ningún catálogo lo resuelve. Captúralo a mano.`,
    });
  }
  const guia: Hallazgo[] = validarReglasGuia(final, entrada.reglasGuia);
  for (const h of guia) if (h.severidad === 'bloqueo') agregar({ campo: h.campo, renglon: h.renglon, origen: 'guia', mensaje: h.mensaje });

  return {
    estado: 'borrador_para_revision', formato: entrada.formato, eleccion, extraccion: final, libro, marcas, inferidos,
    bloqueos, bloqueado: bloqueos.length > 0, avisos, detalle, puedeEnviarseAlTms: false, aprobadoPorPersona: false,
  };
}

/** Mismo valor tras releer el libro: ignora espacios y el formato «874,11 km» de la distancia. */
function mismoValor(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  const plano = (v: string): string => v.replace(/\s+/g, '');
  if (plano(a) === plano(b)) return true;
  const num = (v: string): number => Number(v.replace(/km/i, '').replace(',', '.').trim());
  const x = num(a); const y = num(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

/**
 * Relectura con marcas: toma la extracción que devolvió `leerPlantillaTms` sobre el libro del borrador (donde todo sale como
 * «perfil», porque una celda no sabe de dónde vino) y le devuelve el origen y la nota «Inferido» a cada valor marcado así en
 * el borrador. Un valor releído que ya no coincide con el del borrador se deja como leído, sin marca.
 */
export function reaplicarMarcas(releida: Extraccion, borrador: BorradorConversion): Extraccion {
  const salida: Extraccion = structuredClone(releida);
  const origenDe = (renglon: number | null, campo: string): CampoValor | undefined =>
    renglon === null ? borrador.extraccion.campos[campo] : borrador.extraccion.mercancias[renglon]?.[campo];
  for (const m of borrador.inferidos) {
    const fila = m.renglon === null ? salida.campos : salida.mercancias[m.renglon];
    const actual = fila?.[m.campo];
    const base = origenDe(m.renglon, m.campo);
    if (!actual || !base || !mismoValor(texto(actual), m.valor)) continue;
    fila[m.campo] = { ...actual, origen: base.origen, confianza: base.confianza, evidencia: base.evidencia, notas: [...(actual.notas ?? []), ...(base.notas ?? [])] };
  }
  return salida;
}
