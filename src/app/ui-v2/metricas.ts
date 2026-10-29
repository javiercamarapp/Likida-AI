// ═══════════════════════════════════════════════════════════════════════════
// MÉTRICAS DE LOGÍSTICA · identidad de color y clase epistémica (ESTILO-LIKIDA §2).
//
// El color es la identidad de la MÉTRICA: fijo, jamás por ranking ni por agente.
// Cada métrica tiene UN matiz de la paleta de datos 8 × 3 (sólido / tinte / tinta)
// y una clase epistémica por defecto (observado / estimado / inferido / sin dato)
// que las pantallas pueden endurecer pero no suavizar: un dato inferido jamás se
// presenta como observado.
//
// Los valores de color NO viven aquí: viven en `tokens.css` (`--chart-N`,
// `--soft-N`, `--ink-N`, claro y oscuro). Este módulo solo apunta a ellos, así
// el tema se resuelve por CSS y no hay un segundo juego de hexadecimales.
// Puro (sin React) y sin datos de cliente.
// ═══════════════════════════════════════════════════════════════════════════

export type Matiz = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type ClaseEpistemica = 'observado' | 'estimado' | 'inferido' | 'sin_dato';

/** Nombre del matiz (documentación y `aria`; el color NUNCA es la única señal). */
export const NOMBRE_MATIZ: Record<Matiz, string> = {
  1: 'azul', 2: 'naranja', 3: 'verde', 4: 'ocre', 5: 'petróleo', 6: 'burdeos', 7: 'violeta', 8: 'tinta',
};

export interface Metrica {
  /** Identificador estable (snake_case); es la llave del registro. */
  id: string;
  /** Nombre corto en español, el que se ve en etiquetas de KPI y leyendas. */
  nombre: string;
  matiz: Matiz;
  /** Clase epistémica por defecto. */
  clase: ClaseEpistemica;
}

const M = (id: string, nombre: string, matiz: Matiz, clase: ClaseEpistemica): Metrica => ({ id, nombre, matiz, clase });

/** Registro de métricas de logística. Agregar una métrica = una fila; el matiz sale de su familia. */
export const METRICAS = [
  // 1 · azul — dinero comprobado, liquidado, facturación
  M('dinero_comprobado', 'Monto comprobado', 1, 'observado'),
  M('dinero_liquidado', 'Liquidado', 1, 'observado'),
  M('facturacion', 'Facturación', 1, 'observado'),
  // 2 · naranja — gasto de ruta
  M('gasto_diesel', 'Diésel', 2, 'observado'),
  M('gasto_casetas', 'Casetas', 2, 'observado'),
  M('gasto_peajes', 'Peajes del periodo', 2, 'observado'),
  // 3 · verde — cumplimiento
  M('cumplimiento_carta_porte', 'Carta Porte completas', 3, 'observado'),
  M('cfdi_timbrados', 'CFDI timbrados', 3, 'observado'),
  // 4 · ocre — pendiente, dinero atorado
  M('pendiente', 'Pendiente', 4, 'estimado'),
  M('anticipos_abiertos', 'Anticipos abiertos', 4, 'observado'),
  M('en_espera', 'En espera', 4, 'observado'),
  // 5 · petróleo — servicio
  M('servicio_a_tiempo', 'A tiempo', 5, 'estimado'),
  M('servicio_sla', 'Cumplimiento de SLA', 5, 'estimado'),
  // 6 · burdeos — requiere acción
  M('requiere_accion', 'Requiere acción', 6, 'observado'),
  M('diferencias_por_cuadrar', 'Diferencias por cuadrar', 6, 'estimado'),
  M('candidatos_reclamo', 'Candidatos a reclamo', 6, 'inferido'),
  // 7 · violeta — incidencias, servicio al cliente
  M('incidencias', 'Incidencias', 7, 'observado'),
  M('servicio_cliente', 'Servicio al cliente', 7, 'observado'),
  // 8 · tinta — volumen, totales, neutro
  M('volumen_viajes', 'Viajes', 8, 'observado'),
  M('totales', 'Totales', 8, 'observado'),
] as const satisfies readonly Metrica[];

export type MetricaId = (typeof METRICAS)[number]['id'];

const POR_ID: ReadonlyMap<string, Metrica> = new Map(METRICAS.map((m) => [m.id, m]));

export function metrica(id: MetricaId): Metrica {
  const m = POR_ID.get(id);
  if (!m) throw new Error(`Métrica desconocida: ${id}`); // jamás un color por omisión silencioso
  return m;
}

/** Tokens CSS del matiz: sólido (filete, trazo, barra), tinte (fondo de chip) y tinta (texto sobre tinte). */
export function tokensDeMatiz(matiz: Matiz): { solido: string; tinte: string; tinta: string } {
  return { solido: `var(--chart-${matiz})`, tinte: `var(--soft-${matiz})`, tinta: `var(--ink-${matiz})` };
}

export function tokensDeMetrica(id: MetricaId): { solido: string; tinte: string; tinta: string } {
  return tokensDeMatiz(metrica(id).matiz);
}

const ORDEN: Record<ClaseEpistemica, number> = { observado: 0, estimado: 1, inferido: 2, sin_dato: 3 };

/** La clase de una cifra compuesta es la MÁS débil de sus insumos (nunca se promueve). */
export function claseMasDebil(clases: readonly ClaseEpistemica[]): ClaseEpistemica {
  if (clases.length === 0) return 'sin_dato';
  return clases.reduce((a, b) => (ORDEN[b] > ORDEN[a] ? b : a));
}

/** Clase efectiva de una métrica para un valor concreto: `null`/`undefined` ⇒ sin dato, nunca la del registro. */
export function claseEfectiva(id: MetricaId, valor: number | string | null | undefined, sobrescribe?: ClaseEpistemica): ClaseEpistemica {
  if (valor === null || valor === undefined || valor === '') return 'sin_dato';
  const base = metrica(id).clase;
  return sobrescribe ? claseMasDebil([base, sobrescribe]) : base;
}

/** Tonos de un solo matiz (de 100 % a 34 %), para gráficas de UN matiz con varias categorías (dona, barra apilada). */
export const TONOS_DE_MATIZ = [100, 76, 58, 44, 34] as const;
