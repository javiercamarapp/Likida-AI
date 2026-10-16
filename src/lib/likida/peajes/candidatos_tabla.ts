import { CATEGORIAS_COBRO, ETIQUETA_CATEGORIA_COBRO, type CandidatoCobro, type CategoriaCobro } from './reglas_cobro';
import { ETIQUETA_SENAL, type CruceAtipico, type SenalAtipica } from './cruces_atipicos';

// ═══════════════════════════════════════════════════════════════════════════
// LA TABLA DE CANDIDATOS (T-A2-28a) — PURA: filtra, ordena, pagina y suma.
//
// Un archivo del proveedor trae hasta ~60 000 cruces: el cliente NUNCA recibe todo.
// Esto arma las filas (candidatos de cobro + cruces atípicos), las cruza con lo que
// finanzas ya decidió (reclamado / descartado / justificado) y devuelve UNA página
// más los totales de TODO lo que cumple el filtro. El orden es estable (monto, y
// de desempate renglón y categoría): una página no cambia entre dos lecturas.
//
// Son CANDIDATOS a validar con el proveedor, no cobros indebidos confirmados.
// ═══════════════════════════════════════════════════════════════════════════

export const TAMANO_PAGINA = 50;

export const ACCIONES_CANDIDATO = ['reclamado', 'descartado', 'justificado'] as const;
export type AccionCandidato = (typeof ACCIONES_CANDIDATO)[number];
export type EstadoCandidato = 'pendiente' | AccionCandidato;
export const ESTADOS_CANDIDATO: readonly EstadoCandidato[] = ['pendiente', ...ACCIONES_CANDIDATO];

export const ETIQUETA_ESTADO_CANDIDATO: Record<EstadoCandidato, string> = {
  pendiente: 'Por revisar', reclamado: 'Reclamado', descartado: 'Descartado', justificado: 'Justificado',
};

/** Categoría de una fila: una de cobro o `atipico_<señal>`. */
export type CategoriaFila = CategoriaCobro | `atipico_${SenalAtipica}`;

export const categoriaDeAtipico = (s: SenalAtipica): CategoriaFila => `atipico_${s}`;
export const esCategoriaAtipica = (c: string): c is `atipico_${SenalAtipica}` => c.startsWith('atipico_');
const esCategoriaCobro = (c: string): c is CategoriaCobro => (CATEGORIAS_COBRO as readonly string[]).includes(c);

const CATEGORIAS_ATIPICAS = Object.keys(ETIQUETA_SENAL) as SenalAtipica[];
export const TODAS_LAS_CATEGORIAS: readonly CategoriaFila[] = [...CATEGORIAS_COBRO, ...CATEGORIAS_ATIPICAS.map(categoriaDeAtipico)];

export function etiquetaCategoriaFila(c: string): string {
  if (esCategoriaCobro(c)) return ETIQUETA_CATEGORIA_COBRO[c];
  if (esCategoriaAtipica(c)) return `Atípico · ${ETIQUETA_SENAL[c.slice('atipico_'.length) as SenalAtipica] ?? c}`;
  return c;
}

/** Lo que finanzas ya decidió sobre un renglón y categoría (viene de `peaje_candidato_accion`). */
export interface DecisionGuardada { indice: number; categoria: string; accion: AccionCandidato; motivo: string | null; actor: string; creadoEn: string }

export const claveFila = (indice: number, categoria: string) => `${indice}|${categoria}`;

export interface FilaCandidato {
  clave: string;
  /** Renglón del archivo; en un atípico, el primero de sus renglones. */
  indice: number;
  /** Todos los renglones que la fila cubre (un atípico cubre varios). */
  indices: number[];
  categoria: CategoriaFila;
  etiquetaCategoria: string;
  fecha: string | null;
  hora: string | null;
  caseta: string | null;
  tag: string | null;
  unidad: string | null;
  clase: number | null;
  monto: number;
  quePaso: string;
  queSignifica: string;
  queHacer: string;
  critica: boolean;
  estado: EstadoCandidato;
  motivo: string | null;
  actor: string | null;
  decididoEn: string | null;
}

/**
 * Las filas de la tabla: los candidatos de cobro y los cruces atípicos, cada uno con su estado.
 * Un candidato de «caseta que no debe cruzarse» que ya trae su justificación (la que se guarda en
 * `peaje_cruce_justificado`) se muestra justificado aunque no tenga fila de decisión.
 */
export function filasDeCandidatos(
  candidatos: readonly (CandidatoCobro & { justificacion?: string | null })[],
  atipicos: readonly CruceAtipico[],
  decisiones: readonly DecisionGuardada[],
): FilaCandidato[] {
  const porClave = new Map(decisiones.map((d) => [claveFila(d.indice, d.categoria), d]));
  const filas: FilaCandidato[] = [];
  for (const c of candidatos) {
    const d = porClave.get(claveFila(c.indice, c.categoria));
    const justificadaAntes = c.categoria === 'caseta_no_debe_cruzarse' && typeof c.justificacion === 'string' && c.justificacion !== '';
    filas.push({
      clave: claveFila(c.indice, c.categoria), indice: c.indice, indices: [c.indice], categoria: c.categoria,
      etiquetaCategoria: etiquetaCategoriaFila(c.categoria),
      fecha: c.fecha, hora: c.hora, caseta: c.caseta, tag: c.tag, unidad: c.unidad, clase: c.clase, monto: c.monto,
      quePaso: c.quePaso, queSignifica: c.queSignifica, queHacer: c.queHacer, critica: c.severidad === 'critica',
      estado: d ? d.accion : justificadaAntes ? 'justificado' : 'pendiente',
      motivo: d ? d.motivo : justificadaAntes ? (c.justificacion ?? null) : null,
      actor: d?.actor ?? null, decididoEn: d?.creadoEn ?? null,
    });
  }
  for (const a of atipicos) {
    if (a.indices.length === 0) continue;
    const categoria = categoriaDeAtipico(a.senal);
    const primero = Math.min(...a.indices);
    const d = porClave.get(claveFila(primero, categoria));
    filas.push({
      clave: claveFila(primero, categoria), indice: primero, indices: [...a.indices].sort((x, y) => x - y), categoria,
      etiquetaCategoria: etiquetaCategoriaFila(categoria),
      fecha: a.fecha, hora: null, caseta: a.caseta, tag: null, unidad: a.unidad, clase: null, monto: a.monto,
      quePaso: a.quePaso, queSignifica: a.queSignifica, queHacer: a.queHacer, critica: false,
      estado: d ? d.accion : 'pendiente', motivo: d?.motivo ?? null, actor: d?.actor ?? null, decididoEn: d?.creadoEn ?? null,
    });
  }
  return filas;
}

// ── Filtros ─────────────────────────────────────────────────────────────────

export const ORDENES = ['monto_desc', 'monto_asc', 'fecha'] as const;
export type OrdenTabla = (typeof ORDENES)[number];

export interface FiltrosTabla {
  categoria: CategoriaFila | '';
  estado: EstadoCandidato | '';
  unidad: string;
  caseta: string;
  desde: string;
  hasta: string;
  orden: OrdenTabla;
  pagina: number;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

/** Lo que llega por la URL, saneado: un valor inválido se ignora (nunca rompe ni filtra de más). */
export function normalizarFiltros(entrada: Record<string, string | string[] | undefined>): FiltrosTabla {
  const v = (k: string): string => { const x = entrada[k]; return Array.isArray(x) ? (x[0] ?? '') : (x ?? ''); };
  const cat = v('cat').trim();
  const est = v('estado').trim();
  const orden = v('orden').trim();
  const pag = Number.parseInt(v('pag'), 10);
  return {
    categoria: (TODAS_LAS_CATEGORIAS as readonly string[]).includes(cat) ? (cat as CategoriaFila) : '',
    estado: (ESTADOS_CANDIDATO as readonly string[]).includes(est) ? (est as EstadoCandidato) : '',
    unidad: texto(v('unidad')),
    caseta: texto(v('caseta')),
    desde: FECHA.test(v('desde').trim()) ? v('desde').trim() : '',
    hasta: FECHA.test(v('hasta').trim()) ? v('hasta').trim() : '',
    orden: (ORDENES as readonly string[]).includes(orden) ? (orden as OrdenTabla) : 'monto_desc',
    pagina: Number.isFinite(pag) && pag >= 1 ? Math.min(pag, 100_000) : 1,
  };
}

/** Los filtros como query string (sin la página y sin valores vacíos): para links y para el retorno tras una acción. */
export function filtrosAQuery(f: FiltrosTabla, conPagina = true): string {
  const q = new URLSearchParams();
  if (f.categoria) q.set('cat', f.categoria);
  if (f.estado) q.set('estado', f.estado);
  if (f.unidad) q.set('unidad', f.unidad);
  if (f.caseta) q.set('caseta', f.caseta);
  if (f.desde) q.set('desde', f.desde);
  if (f.hasta) q.set('hasta', f.hasta);
  if (f.orden !== 'monto_desc') q.set('orden', f.orden);
  if (conPagina && f.pagina > 1) q.set('pag', String(f.pagina));
  return q.toString();
}

const minusculas = (s: string | null) => (s ?? '').toLocaleLowerCase('es-MX');

export function cumpleFiltro(f: FilaCandidato, filtros: FiltrosTabla): boolean {
  if (filtros.categoria && f.categoria !== filtros.categoria) return false;
  if (filtros.estado && f.estado !== filtros.estado) return false;
  if (filtros.unidad && !minusculas(f.unidad).includes(minusculas(filtros.unidad))) return false;
  if (filtros.caseta && !minusculas(f.caseta).includes(minusculas(filtros.caseta))) return false;
  if (filtros.desde && (f.fecha === null || f.fecha < filtros.desde)) return false;
  if (filtros.hasta && (f.fecha === null || f.fecha > filtros.hasta)) return false;
  return true;
}

function comparar(orden: OrdenTabla) {
  return (a: FilaCandidato, b: FilaCandidato): number => {
    let c = 0;
    if (orden === 'monto_desc') c = b.monto - a.monto;
    else if (orden === 'monto_asc') c = a.monto - b.monto;
    else c = (a.fecha ?? '9999-99-99').localeCompare(b.fecha ?? '9999-99-99') || (a.hora ?? '').localeCompare(b.hora ?? '');
    return c || a.indice - b.indice || a.categoria.localeCompare(b.categoria);
  };
}

/** TODAS las filas que cumplen el filtro, en orden estable (el lote por filtro actúa sobre esto, no sobre la página). */
export function filasFiltradas(filas: readonly FilaCandidato[], filtros: FiltrosTabla): FilaCandidato[] {
  return filas.filter((f) => cumpleFiltro(f, filtros)).sort(comparar(filtros.orden));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface TablaCandidatos {
  filtros: FiltrosTabla;
  /** La página pedida (a lo más `TAMANO_PAGINA` filas). */
  filas: FilaCandidato[];
  /** Cuántas filas cumplen el filtro (todas las páginas). */
  total: number;
  monto: number;
  porEstado: Record<EstadoCandidato, { n: number; monto: number }>;
  pagina: number;
  paginas: number;
}

export function tablaDeCandidatos(todas: readonly FilaCandidato[], filtrosEntrada: FiltrosTabla): TablaCandidatos {
  const ordenadas = filasFiltradas(todas, filtrosEntrada);
  const paginas = Math.max(1, Math.ceil(ordenadas.length / TAMANO_PAGINA));
  const pagina = Math.min(filtrosEntrada.pagina, paginas);
  const porEstado = Object.fromEntries(ESTADOS_CANDIDATO.map((e) => [e, { n: 0, monto: 0 }])) as TablaCandidatos['porEstado'];
  let monto = 0;
  for (const f of ordenadas) { monto += f.monto; porEstado[f.estado].n++; porEstado[f.estado].monto += f.monto; }
  for (const e of ESTADOS_CANDIDATO) porEstado[e].monto = r2(porEstado[e].monto);
  return {
    filtros: { ...filtrosEntrada, pagina }, filas: ordenadas.slice((pagina - 1) * TAMANO_PAGINA, pagina * TAMANO_PAGINA),
    total: ordenadas.length, monto: r2(monto), porEstado, pagina, paginas,
  };
}

// ── Qué se puede hacer con una fila ─────────────────────────────────────────

export type MotivoNoAplica = 'ya_decidido' | 'no_reclamable' | 'sin_fecha';

/**
 * ¿Aplica `accion` a la fila? Solo lo pendiente se decide (una decisión no se pisa: doble clic = un efecto).
 * Reclamar es solo para candidatos de cobro con fecha (un atípico es un aviso para el despacho, no un cobro, y
 * sin fecha no hay de dónde contar el plazo de 3 meses).
 */
export function aplicaAccion(f: FilaCandidato, accion: AccionCandidato): { ok: true } | { ok: false; motivo: MotivoNoAplica } {
  if (f.estado !== 'pendiente') return { ok: false, motivo: 'ya_decidido' };
  if (accion === 'reclamado') {
    if (!esCategoriaCobro(f.categoria)) return { ok: false, motivo: 'no_reclamable' };
    if (f.fecha === null) return { ok: false, motivo: 'sin_fecha' };
  }
  return { ok: true };
}

export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 300;

/** El motivo de descartar o justificar: obligatorio, 3 a 300 caracteres. */
export function validarMotivoAccion(accion: AccionCandidato, motivo: unknown): { ok: true; motivo: string | null } | { ok: false; error: string } {
  if (accion === 'reclamado') return { ok: true, motivo: null };
  const m = typeof motivo === 'string' ? motivo.trim() : '';
  const verbo = accion === 'descartado' ? 'descartar' : 'justificar';
  if (m.length === 0) return { ok: false, error: `Escribe el motivo: no se puede ${verbo} sin decir por qué.` };
  if (m.length < MOTIVO_MIN) return { ok: false, error: `El motivo es muy corto (mínimo ${MOTIVO_MIN} caracteres).` };
  if (m.length > MOTIVO_MAX) return { ok: false, error: `El motivo pasa de ${MOTIVO_MAX} caracteres.` };
  return { ok: true, motivo: m };
}
