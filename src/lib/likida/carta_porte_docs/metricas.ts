// ═══════════════════════════════════════════════════════════════════════════
// MÉTRICAS DEL AGENTE — qué tan bien lee y cuánto tiempo ahorra.
//
// Regla de la casa: ninguna cifra inventada. Cada número dice de qué se calcula
// y, cuando necesita un supuesto, lo trae a la vista:
//
//   · «% sin corrección» = documentos APROBADOS en los que nadie cambió un solo
//     valor / documentos aprobados. Confirmar un dato dudoso NO es corregirlo.
//   · «tiempo de revisión» es MEDIDO: de que alguien abre el documento a que lo
//     aprueba. Un documento sin esa marca (aprobado antes de existir la medición,
//     o por API) no cuenta para el promedio y se reporta aparte.
//   · «tiempo ahorrado por embarque» = MINUTOS_CAPTURA_MANUAL_EMBARQUE − tiempo de
//     revisión medido. El primero es un SUPUESTO declarado (no una medición) y se
//     muestra con ese rótulo; si una flota mide el suyo, se cambia aquí, en un
//     solo lugar.
// ═══════════════════════════════════════════════════════════════════════════

import type { DocumentoFila, EnvioParaInsights } from './repo';

/**
 * SUPUESTO, no medición: minutos que toma capturar a mano un embarque en Likida
 * (origen y destino con RFC, CP y estado, 1 a 3 mercancías con clave SAT, unidad y
 * peso, operador y placas, y cotejarlos contra el documento del cliente). Estimación
 * de diseño del 1-oct-2026; se reemplaza por una medición cuando exista un piloto.
 */
export const MINUTOS_CAPTURA_MANUAL_EMBARQUE = 12;

export interface MetricasAgente {
  /** Documentos que llegaron en el periodo. */
  recibidos: number;
  porRevisar: number;
  aprobados: number;
  rechazados: number;
  fallidos: number;
  /** `null` = no hay aprobados todavía: no se pinta un 0 % que parezca medición. */
  pctSinCorreccion: number | null;
  sinCorreccion: number;
  conCorreccion: number;
  /** Aprobados sin ninguna lectura de modelo (XML, perfil): costo cero. */
  sinModelo: number;
  /** Promedio MEDIDO de minutos de revisión, o `null` si ningún aprobado trae la marca. */
  minutosRevisionPromedio: number | null;
  aprobadosMedidos: number;
  aprobadosSinMedir: number;
  /** Minutos ahorrados (suma) sobre los aprobados MEDIDOS, y por embarque. */
  minutosAhorradosTotal: number | null;
  minutosAhorradosPorEmbarque: number | null;
  supuestoMinutosManual: number;
  costoUsdTotal: number;
  costoUsdPorDocumento: number | null;
  porOrigen: Record<string, { documentos: number; sinCorreccion: number }>;
  /**
   * A37-A3-14: presente SOLO si la ventana tiene más documentos que los que se leyeron (tope de la consulta): todas las cifras de
   * arriba son de los `leidos` más recientes, no de los `total`. La vista lo dice; jamás rotula «90 días» sobre una muestra.
   */
  parcial?: { leidos: number; total: number };
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Cómo se leyó el documento, SIN abrir la extracción (la lista liviana no la trae): sale de las columnas. */
export function origenDeLectura(d: Pick<DocumentoFila, 'nivelModelo' | 'perfilId'>): 'xml' | 'perfil' | 'perfil+llm' | 'llm' {
  if (d.nivelModelo === 0) return d.perfilId === null ? 'xml' : 'perfil';
  return d.perfilId === null ? 'llm' : 'perfil+llm';
}

export function calcularMetricas(todos: DocumentoFila[], correcciones: Map<string, number>, totalVentana?: number): MetricasAgente {
  // Un archivo que se partió en embarques (0670) es la constancia de lo que llegó, no un documento por revisar ni un
  // embarque: lo que se mide es cada embarque (sus hijos). Contarlo inflaría «recibidos» y diluiría el costo por documento.
  const docs = todos.filter((d) => d.estado !== 'dividido');
  const por = (e: DocumentoFila['estado']) => docs.filter((d) => d.estado === e);
  const aprobados = por('aprobado');
  const sin = aprobados.filter((d) => (correcciones.get(d.id) ?? 0) === 0);
  const medidos = aprobados.filter((d) => d.tiempoRevisionSeg !== null);
  const minutos = medidos.map((d) => (d.tiempoRevisionSeg as number) / 60);
  const ahorros = minutos.map((m) => Math.max(0, MINUTOS_CAPTURA_MANUAL_EMBARQUE - m));
  const costo = docs.reduce((s, d) => s + d.costoUsd, 0);

  const porOrigen: MetricasAgente['porOrigen'] = {};
  for (const d of aprobados) {
    const o = origenDeLectura(d);
    porOrigen[o] ??= { documentos: 0, sinCorreccion: 0 };
    porOrigen[o].documentos++;
    if ((correcciones.get(d.id) ?? 0) === 0) porOrigen[o].sinCorreccion++;
  }

  return {
    recibidos: docs.length,
    porRevisar: por('por_revisar').length,
    aprobados: aprobados.length,
    rechazados: por('rechazado').length,
    fallidos: por('fallido').length,
    pctSinCorreccion: aprobados.length === 0 ? null : r1((sin.length / aprobados.length) * 100),
    sinCorreccion: sin.length,
    conCorreccion: aprobados.length - sin.length,
    sinModelo: aprobados.filter((d) => d.nivelModelo === null || d.nivelModelo === 0).length,
    minutosRevisionPromedio: minutos.length === 0 ? null : r1(minutos.reduce((s, m) => s + m, 0) / minutos.length),
    aprobadosMedidos: medidos.length,
    aprobadosSinMedir: aprobados.length - medidos.length,
    minutosAhorradosTotal: ahorros.length === 0 ? null : r1(ahorros.reduce((s, m) => s + m, 0)),
    minutosAhorradosPorEmbarque: ahorros.length === 0 ? null : r1(ahorros.reduce((s, m) => s + m, 0) / ahorros.length),
    supuestoMinutosManual: MINUTOS_CAPTURA_MANUAL_EMBARQUE,
    costoUsdTotal: Math.round(costo * 1e6) / 1e6,
    costoUsdPorDocumento: docs.length === 0 ? null : Math.round((costo / docs.length) * 1e6) / 1e6,
    porOrigen,
    ...(totalVentana !== undefined && totalVentana > todos.length ? { parcial: { leidos: todos.length, total: totalVentana } } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS DEL AGENTE (T-A3-37) — % sin tocar, causa de rechazo, calidad por
// formato/cliente y estado de los envíos al sistema del cliente.
//
// Todo es conteo sobre claves de perfil (formato, cliente) y nombres de campo:
// nunca un valor de un documento. Donde no hay base se devuelve `null`, nunca
// un 0 % que parezca medición. Las tarjetas «qué pasó / qué significa / qué
// hacer» salen de reglas deterministas (sin modelo).
// ═══════════════════════════════════════════════════════════════════════════

/** Dominio cerrado de `cp_documento.rechazo_causa` (0791) con su rótulo para la persona. */
export const CAUSAS_RECHAZO = {
  suma_no_cuadra: 'La suma no cuadra',
  falta_dato_critico: 'Falta un dato crítico',
  formato_ilegible: 'Formato ilegible',
  no_es_embarque: 'No es un embarque',
  duplicado: 'Duplicado',
  cliente_desconocido: 'Cliente desconocido',
  tms_rechazo: 'Lo rechazó el sistema del cliente',
  otra: 'Otra causa',
} as const;
export type CausaRechazo = keyof typeof CAUSAS_RECHAZO;

export const esCausaRechazo = (v: unknown): v is CausaRechazo => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CAUSAS_RECHAZO, v);

/** Horas que un envío puede esperar su requerimiento antes de pedir acción. */
export const HORAS_REQUE_ATENCION = 24;
/** Aprobados mínimos de un formato/cliente para opinar sobre su calidad. */
export const MINIMO_PARA_OPINAR = 5;
/** Debajo de este % sin tocar, un formato o cliente pide revisar su perfil. */
export const PCT_SIN_TOCAR_BAJO = 50;

export interface CalidadGrupo { clave: string; documentos: number; sinTocar: number; pctSinTocar: number }

export interface TarjetaInsight {
  id: string;
  tono: 'bad' | 'warn' | 'info';
  quePaso: string;
  queSignifica: string;
  queHacer: string;
}

export interface InsightsAgente {
  /** Aprobados de la ventana; con 0 todos los porcentajes son `null`. */
  aprobados: number;
  pctSinTocar: number | null;
  /** La suma de `documentos` de cada lista es `aprobados`. */
  porFormato: CalidadGrupo[];
  /** `clave` = id del cliente, o `sin_cliente`. */
  porCliente: CalidadGrupo[];
  /** Los 3 campos más corregidos (solo el NOMBRE del campo). */
  topCamposCorregidos: Array<{ campo: string; correcciones: number }>;
  /** `null` = no se pudo leer la causa (columna ausente), distinto de «ningún rechazo». */
  causasRechazo: Array<{ causa: CausaRechazo; rotulo: string; documentos: number }> | null;
  rechazadosSinCausa: number | null;
  envios: {
    enviados: number;
    subidosAMano: number;
    rechazadosTms: number;
    pendientesReque: number;
    pendientesRequeMasDe24h: number;
    /** Antigüedad del pendiente más viejo, en horas; `null` si no hay. */
    pendienteMasViejoHoras: number | null;
    /** Mediana de minutos de aprobado a enviado; `null` si no hay enviados medibles. */
    medianaAprobadoAEnviadoMin: number | null;
    /** Por qué no se ligó el envío. cliente y caja devuelven el documento a revisión: ese motivo aún no se guarda clasificado. */
    causasNoLiga: { reque: number; cliente: number | null; caja: number | null; otra: number };
  };
  tarjetas: TarjetaInsight[];
  /** A37-A3-14: la ventana tiene más documentos que los leídos; las cifras son de los `leidos` más recientes. */
  parcial?: { leidos: number; total: number };
}

export interface EntradaInsights {
  docs: DocumentoFila[];
  /** Correcciones por documento (cuenta). */
  correcciones: Map<string, number>;
  /** Correcciones por NOMBRE de campo. */
  camposCorregidos: Map<string, number>;
  /** Cuenta por `rechazo_causa` (clave `''` = sin causa); `null` = no se pudo leer. */
  causasRechazo: Record<string, number> | null;
  envios: EnvioParaInsights[];
  /** id de cliente → nombre, solo para redactar las tarjetas. */
  nombresCliente?: Map<string, string>;
  ahora: Date;
  /** Documentos que de verdad hay en la ventana (conteo exacto). Mayor que `docs.length` = la lectura se topó (A37-A3-14). */
  totalVentana?: number;
}

const SIN_CLIENTE = 'sin_cliente';
const pct = (a: number, b: number): number => r1((a / b) * 100);

function agrupar(aprobados: DocumentoFila[], clave: (d: DocumentoFila) => string, correcciones: Map<string, number>): CalidadGrupo[] {
  const m = new Map<string, { documentos: number; sinTocar: number }>();
  for (const d of aprobados) {
    const g = m.get(clave(d)) ?? { documentos: 0, sinTocar: 0 };
    g.documentos++;
    if ((correcciones.get(d.id) ?? 0) === 0) g.sinTocar++;
    m.set(clave(d), g);
  }
  return [...m].map(([k, g]) => ({ clave: k, ...g, pctSinTocar: pct(g.sinTocar, g.documentos) }))
    .sort((a, b) => b.documentos - a.documentos || a.clave.localeCompare(b.clave));
}

const mediana = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return r1(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2);
};

/** Clasifica el texto de `causa_pendiente` (lo escribe el pre-chequeo, T-A3-25) en cliente / caja / reque. */
export function clasificarCausaNoLiga(texto: string | null): 'reque' | 'cliente' | 'caja' | 'otra' {
  const t = (texto ?? '').toLowerCase();
  if (t.includes('requerimiento')) return 'reque';
  if (t.includes('caja')) return 'caja';
  if (t.includes('cliente')) return 'cliente';
  return 'otra';
}

export function calcularInsights(e: EntradaInsights): InsightsAgente {
  const docs = e.docs.filter((d) => d.estado !== 'dividido');
  const aprobados = docs.filter((d) => d.estado === 'aprobado');
  const sin = aprobados.filter((d) => (e.correcciones.get(d.id) ?? 0) === 0).length;
  const porFormato = agrupar(aprobados, (d) => d.formato, e.correcciones);
  const porCliente = agrupar(aprobados, (d) => d.clienteId ?? SIN_CLIENTE, e.correcciones);
  const topCamposCorregidos = [...e.camposCorregidos].filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([campo, correcciones]) => ({ campo, correcciones }));

  let causasRechazo: InsightsAgente['causasRechazo'] = null;
  let rechazadosSinCausa: number | null = null;
  if (e.causasRechazo !== null) {
    causasRechazo = [];
    rechazadosSinCausa = 0;
    for (const [k, n] of Object.entries(e.causasRechazo)) {
      if (esCausaRechazo(k)) causasRechazo.push({ causa: k, rotulo: CAUSAS_RECHAZO[k], documentos: n });
      else rechazadosSinCausa += n;
    }
    causasRechazo.sort((a, b) => b.documentos - a.documentos || a.causa.localeCompare(b.causa));
  }

  const porDoc = new Map(docs.map((d) => [d.id, d]));
  const ahoraMs = e.ahora.getTime();
  const activos = e.envios.filter((x) => x.estado !== 'descartado');
  const cuenta = (est: EnvioParaInsights['estado']) => activos.filter((x) => x.estado === est);
  const pend = cuenta('pendiente_reque');
  const horas = (iso: string) => Math.max(0, (ahoraMs - Date.parse(iso)) / 3_600_000);
  const edades = pend.map((x) => horas(x.createdAt)).filter(Number.isFinite);
  const minutos: number[] = [];
  for (const x of cuenta('enviado')) {
    const ap = porDoc.get(x.documentoId)?.aprobadoEn;
    if (!ap || !x.enviadoEn) continue;
    const dt = (Date.parse(x.enviadoEn) - Date.parse(ap)) / 60_000;
    if (Number.isFinite(dt) && dt >= 0) minutos.push(dt);
  }
  const causasNoLiga = { reque: 0, cliente: null as number | null, caja: null as number | null, otra: 0 };
  for (const x of pend) {
    const c = clasificarCausaNoLiga(x.causaPendiente);
    if (c === 'reque' || c === 'otra') causasNoLiga[c]++;
    else causasNoLiga[c] = (causasNoLiga[c] ?? 0) + 1;
  }
  const envios: InsightsAgente['envios'] = {
    enviados: cuenta('enviado').length,
    subidosAMano: cuenta('subido_a_mano').length,
    rechazadosTms: cuenta('rechazado_tms').length,
    pendientesReque: pend.length,
    pendientesRequeMasDe24h: edades.filter((h) => h > HORAS_REQUE_ATENCION).length,
    pendienteMasViejoHoras: edades.length === 0 ? null : r1(Math.max(...edades)),
    medianaAprobadoAEnviadoMin: mediana(minutos),
    causasNoLiga,
  };

  const out: InsightsAgente = {
    aprobados: aprobados.length,
    pctSinTocar: aprobados.length === 0 ? null : pct(sin, aprobados.length),
    porFormato, porCliente, topCamposCorregidos, causasRechazo, rechazadosSinCausa, envios, tarjetas: [],
    ...(e.totalVentana !== undefined && e.totalVentana > e.docs.length ? { parcial: { leidos: e.docs.length, total: e.totalVentana } } : {}),
  };
  out.tarjetas = tarjetasDe(out, e, pend);
  return out;
}

function tarjetasDe(i: InsightsAgente, e: EntradaInsights, pend: EnvioParaInsights[]): TarjetaInsight[] {
  const t: TarjetaInsight[] = [];
  const nombre = (id: string | null | undefined): string => (id ? e.nombresCliente?.get(id) : undefined) ?? 'un cliente sin identificar';
  const docCliente = new Map(e.docs.map((d) => [d.id, d.clienteId]));

  // 1) Requerimientos que no aparecen: por cliente, solo los de más de 24 h.
  const viejos = new Map<string, number>();
  for (const x of pend) {
    if (horas24(x.createdAt, e.ahora)) {
      const c = docCliente.get(x.documentoId) ?? SIN_CLIENTE;
      viejos.set(c, (viejos.get(c) ?? 0) + 1);
    }
  }
  for (const [c, n] of [...viejos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    t.push({
      id: `reque_${c}`, tono: 'warn',
      quePaso: `${n} ${n === 1 ? 'documento' : 'documentos'} de ${nombre(c === SIN_CLIENTE ? null : c)} ${n === 1 ? 'espera' : 'esperan'} requerimiento hace más de ${HORAS_REQUE_ATENCION} h.`,
      queSignifica: 'El sistema del cliente todavía no tiene el requerimiento al que se debe ligar el embarque, y el envío no sale sin él.',
      queHacer: 'Crea los requerimientos en el sistema del cliente o ajusta la frecuencia de reintento en la configuración de la salida.',
    });
  }
  // 2) Rechazos del sistema del cliente.
  if (i.envios.rechazadosTms > 0) {
    const n = i.envios.rechazadosTms;
    t.push({
      id: 'rechazo_tms', tono: 'bad',
      quePaso: `El sistema del cliente rechazó ${n} ${n === 1 ? 'envío' : 'envíos'}.`,
      queSignifica: 'El archivo llegó pero no cumplió una validación del lado del cliente; el documento vuelve a revisión con la ubicación del error.',
      queHacer: 'Abre cada documento marcado, corrige el campo señalado y vuelve a aprobar.',
    });
  }
  // 3) Causa de rechazo dominante (solo con al menos 3 rechazos clasificados de la misma causa).
  const top = i.causasRechazo?.[0];
  if (top && top.documentos >= 3 && top.causa !== 'tms_rechazo') {
    t.push({
      id: `causa_${top.causa}`, tono: 'info',
      quePaso: `${top.documentos} documentos se rechazaron por «${top.rotulo.toLowerCase()}».`,
      queSignifica: 'Es la causa de rechazo más frecuente de la ventana.',
      queHacer: top.causa === 'duplicado' ? 'Pide al cliente que deje de reenviar el mismo archivo.'
        : top.causa === 'cliente_desconocido' ? 'Da de alta al cliente o carga su catálogo para que el agente lo reconozca.'
        : top.causa === 'formato_ilegible' ? 'Pide el archivo original (Excel o XML) en lugar de la foto o el escaneo.'
        : 'Revisa con el cliente por qué llegan documentos así.',
    });
  }
  // 4) Formatos con poca calidad.
  for (const g of i.porFormato) {
    if (g.documentos >= MINIMO_PARA_OPINAR && g.pctSinTocar < PCT_SIN_TOCAR_BAJO) {
      t.push({
        id: `formato_${g.clave}`, tono: 'warn',
        quePaso: `Solo ${g.pctSinTocar} % de los documentos «${g.clave}» se aprobó sin tocar (${g.sinTocar} de ${g.documentos}).`,
        queSignifica: 'El agente lee mal ese formato y cada documento cuesta tiempo de corrección.',
        queHacer: 'Revisa el perfil de ese formato: los campos más corregidos dicen dónde falla el mapeo.',
      });
    }
  }
  // 5) Clientes con poca calidad.
  for (const g of i.porCliente) {
    if (g.documentos >= MINIMO_PARA_OPINAR && g.pctSinTocar < PCT_SIN_TOCAR_BAJO) {
      t.push({
        id: `cliente_${g.clave}`, tono: 'warn',
        quePaso: `Solo ${g.pctSinTocar} % de los documentos de ${nombre(g.clave === SIN_CLIENTE ? null : g.clave)} se aprobó sin tocar (${g.sinTocar} de ${g.documentos}).`,
        queSignifica: 'Los documentos de este cliente se siguen corrigiendo a mano.',
        queHacer: 'Revisa el perfil y el catálogo de ese cliente.',
      });
    }
  }
  // 6) El campo que más se corrige.
  const c0 = i.topCamposCorregidos[0];
  if (c0 && c0.correcciones >= 3) {
    t.push({
      id: `campo_${c0.campo}`, tono: 'info',
      quePaso: `El campo «${c0.campo}» se corrigió ${c0.correcciones} veces.`,
      queSignifica: 'Es el dato que el agente más falla al leer.',
      queHacer: 'Revisa cómo se mapea ese campo en el perfil del formato.',
    });
  }
  return t;
}

function horas24(iso: string, ahora: Date): boolean {
  return (ahora.getTime() - Date.parse(iso)) / 3_600_000 > HORAS_REQUE_ATENCION;
}
