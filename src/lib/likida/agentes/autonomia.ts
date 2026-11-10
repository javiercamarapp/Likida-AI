// ═══════════════════════════════════════════════════════════════════════════
// LA ESCALERA DE AUTONOMÍA POR AGENTE (L0 a L4) Y LA LISTA CERRADA DE LO QUE
// NUNCA SE AUTOMATIZA (F14-A, PLAN-MAESTRO §10.4).
//
// Vive como constantes en CÓDIGO VERSIONADO, a propósito: un agente no puede
// cambiar su propio nivel porque el nivel no es un dato que él pueda escribir
// (ascender = un cambio de código revisado por Javier). El único cambio de
// nivel sin humano es el DESCENSO por regla determinista del servidor.
//
// Esta tabla de niveles solo DECLARA el techo y el nivel de partida; no ejecuta
// nada y no enciende ningún agente. `autonomia.test.ts` falla si el catálogo
// contradice la lista cerrada (ver `validarCatalogo`).
//
// Agregar un elemento a `NUNCA_AUTOMATIZAR` lo decide el dueño; quitarlo exige
// al dueño y un PR.
// ═══════════════════════════════════════════════════════════════════════════

export const NIVELES = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type Nivel = (typeof NIVELES)[number];

export const NOMBRE_NIVEL: Readonly<Record<Nivel, string>> = {
  L0: 'Nada: lo hace una persona',
  L1: 'Sugerir',
  L2: 'Redactar',
  L3: 'Actuar con aprobación',
  L4: 'Automático acotado',
};

export const ordenNivel = (n: Nivel): number => NIVELES.indexOf(n);

export type ClaseAgente =
  | 'dinero_fiscal_datos'   // liquidación, facturas, cobranza, peajes, carta porte, datos de choferes
  | 'salida_cliente'        // emiten mensajes/correos hacia afuera
  | 'plataforma'            // reintentos, silenciar duplicados, apagar por tope de gasto
  | 'diagnostico'           // automejora, incidentes, calidad, auditor
  | 'interno'               // trabajo interno reversible
  | 'desconocida';          // agente no catalogado: lo más restrictivo

/** TECHO DURO por clase. Lo que toca dinero/fiscal/datos personales no pasa de
 *  L2; el diagnóstico no pasa de L2; lo desconocido no pasa de L1. */
export const TECHO_POR_CLASE: Readonly<Record<ClaseAgente, Nivel>> = {
  dinero_fiscal_datos: 'L2',
  salida_cliente: 'L3',
  plataforma: 'L4',
  diagnostico: 'L2',
  interno: 'L3',
  desconocida: 'L1',
};

export interface EntradaAutonomia { clase: ClaseAgente; nivel: Nivel }

const dfd = (nivel: Nivel = 'L0'): EntradaAutonomia => ({ clase: 'dinero_fiscal_datos', nivel });
const sal = (nivel: Nivel = 'L0'): EntradaAutonomia => ({ clase: 'salida_cliente', nivel });
const pla = (nivel: Nivel = 'L0'): EntradaAutonomia => ({ clase: 'plataforma', nivel });
const dia = (nivel: Nivel = 'L1'): EntradaAutonomia => ({ clase: 'diagnostico', nivel });
const int = (nivel: Nivel = 'L0'): EntradaAutonomia => ({ clase: 'interno', nivel });

/** Nivel ACTUAL por agente. Todos parten en L0 o L1. Un agente que no esté
 *  aquí se lee como `desconocida`/L0 (ver `autonomiaDe`). */
export const CATALOGO_AUTONOMIA: Readonly<Record<string, EntradaAutonomia>> = {
  // Dinero, fiscal y datos personales (tope L2).
  liquidacion: dfd(), facturas: dfd(), cobranza: dfd(), peajes: dfd(), carta_porte: dfd(),
  proveedores: dfd(), conductores: dfd(), cobranza_saas: dfd(), experto_fiscal: dfd(),
  legal_compliance: dfd(), talento: dfd(),
  // Salidas hacia afuera (la salida SIEMPRE pasa por revisión; ver lista cerrada).
  redactor: sal(), enviador: sal(), sdr: sal(), soporte: sal(), atencion_faq: sal(),
  vigia_cliente: sal(), onboarding_cliente: sal(), exito_cliente: sal(), retencion: sal(),
  propuestas: sal(), orquestador: sal(),
  // Plataforma.
  releases: pla(), pruebas: pla(), datos_instrumentacion: pla(),
  // Diagnóstico y mejora (inicial L1, tope L2).
  automejora: dia(), especialistas_incidente: dia(), vigilante_calidad: dia(), auditor_codigo: dia(),
  // Internos reversibles.
  cazador: int(), scorer: int(), enriquecedor: int(), dossier: int(), kpi_whatsapp: int(),
  desempeno_startup: int(), orquestador_semanal: int(), documentacion: int(),
};

export interface AutonomiaDeAgente { agente: string; clase: ClaseAgente; nivel: Nivel; techo: Nivel; catalogado: boolean }

export function autonomiaDe(agente: string): AutonomiaDeAgente {
  const e = Object.prototype.hasOwnProperty.call(CATALOGO_AUTONOMIA, agente) ? CATALOGO_AUTONOMIA[agente] : undefined;
  const clase = e?.clase ?? 'desconocida';
  return { agente, clase, nivel: e?.nivel ?? 'L0', techo: TECHO_POR_CLASE[clase], catalogado: !!e };
}

/** Las ÚNICAS acciones que pueden llegar a L4 (reversibles, bajo riesgo, con
 *  circuit breaker). Cualquier otra acción no pasa de L3. */
export const ACCIONES_L4: readonly string[] = [
  'reintentar_lote',
  'silenciar_alerta_duplicada',
  'marcar_ruido',
  'apagar_agente_por_tope_de_gasto',
];

// ── La lista cerrada ───────────────────────────────────────────────────────

export interface ProhibicionAutomatizacion {
  id: 'dinero' | 'datos_personales_arco' | 'fiscal' | 'salidas_sin_revision' | 'autonomia_propia' | 'produccion';
  titulo: string;
  /** Acciones del catálogo del Copiloto que ya están en esta categoría. */
  acciones: readonly string[];
  /** Patrones sobre ids de acción para atrapar acciones FUTURAS. */
  patrones: readonly RegExp[];
}

export const NUNCA_AUTOMATIZAR: readonly ProhibicionAutomatizacion[] = [
  {
    id: 'dinero', titulo: 'Dinero: cobros, reembolsos, pagos, conciliar pagos, saldos, precios o plan, mensualidades',
    acciones: ['marcar_pago_conciliado', 'aprobar_pendiente'],
    patrones: [/cobr(ar|o)/, /reembols/, /(^|_)pag(o|ar|os)(_|$)/, /concili/, /saldo/, /precio/, /(^|_)plan(_|$)/, /mensualidad/, /factur(ar|a_saas)/],
  },
  {
    id: 'datos_personales_arco', titulo: 'Datos personales y ARCO: exportar, borrar, anonimizar, responder, tocar datos de choferes',
    acciones: [],
    patrones: [/arco/, /exportar/, /borrar/, /eliminar/, /anonimiz/, /(^|_)chofer/, /datos_personales/],
  },
  {
    id: 'fiscal', titulo: 'Fiscal: timbrar, cancelar o corregir CFDI o Carta Porte, interpretar una norma como definitiva',
    acciones: [],
    patrones: [/timbr/, /cfdi/, /carta_porte/, /norma_definitiva/],
  },
  {
    id: 'salidas_sin_revision', titulo: 'Correos y WhatsApp a clientes o titulares, y publicación de marca, sin revisión',
    acciones: [],
    patrones: [/enviar_(correo|whatsapp|mensaje)/, /publicar_(marca|post)/, /envio_sin_revision/],
  },
  {
    id: 'autonomia_propia', titulo: 'Que un agente cambie su propia autonomía, umbrales, presupuestos de error o interruptores (o los de otro)',
    acciones: [],
    patrones: [/(cambiar|subir|ascender|promover)_(autonomia|nivel)/, /umbral/, /presupuesto_de_error/, /(cambiar|editar)_interruptor/],
  },
  {
    id: 'produccion', titulo: 'Fusionar o desplegar a producción: merge, despliegue, migraciones, Vercel, Stripe, Meta',
    acciones: [],
    patrones: [/merge/, /fusionar/, /desplegar/, /deploy/, /migrac/, /vercel/, /stripe/, /(^|_)meta(_|$)/, /push/],
  },
];

/** La categoría de la lista cerrada que cubre una acción, o `null`. */
export function prohibicionDe(idAccion: string): ProhibicionAutomatizacion['id'] | null {
  const id = idAccion.trim().toLowerCase();
  for (const p of NUNCA_AUTOMATIZAR) {
    if (p.acciones.includes(id) || p.patrones.some((r) => r.test(id))) return p.id;
  }
  return null;
}

// ── Validación del catálogo (la usa la prueba que debe FALLAR si se contradice) ──

export interface Violacion { donde: string; motivo: string }

export function validarCatalogo(
  catalogo: Readonly<Record<string, EntradaAutonomia>> = CATALOGO_AUTONOMIA,
  accionesL4: readonly string[] = ACCIONES_L4,
): Violacion[] {
  const v: Violacion[] = [];
  for (const [agente, e] of Object.entries(catalogo)) {
    const techo = TECHO_POR_CLASE[e.clase];
    if (ordenNivel(e.nivel) > ordenNivel(techo)) {
      v.push({ donde: agente, motivo: `nivel ${e.nivel} supera el techo ${techo} de la clase ${e.clase}` });
    }
    if (ordenNivel(e.nivel) > ordenNivel('L1')) {
      v.push({ donde: agente, motivo: `nivel inicial ${e.nivel}: todos parten en L0 o L1` });
    }
    if (e.nivel === 'L4' && e.clase !== 'plataforma') {
      v.push({ donde: agente, motivo: 'L4 solo existe para agentes de plataforma' });
    }
  }
  for (const a of accionesL4) {
    const p = prohibicionDe(a);
    if (p) v.push({ donde: `accion_l4:${a}`, motivo: `contradice la lista cerrada (${p})` });
  }
  return v;
}

// ── Cambios de nivel ───────────────────────────────────────────────────────

export type ActorCambio =
  | { tipo: 'humano'; usuario: string; motivo: string }
  | { tipo: 'regla_servidor'; regla: string }
  | { tipo: 'agente'; agente: string }
  | { tipo: 'cron' };

export interface SolicitudCambioNivel {
  agente: string;
  a: Nivel;
  actor: ActorCambio;
  /** Se agotó el presupuesto de error del agente en los últimos 30 días. */
  presupuestoAgotado?: boolean;
  /** Hay un S1 abierto sobre el agente. */
  s1Abierto?: boolean;
  /** Falló el último examen dorado. */
  examenFallido?: boolean;
}

export type ResultadoCambio = { permitido: true } | { permitido: false; motivo: string };

/** PURA. Decide si un cambio de nivel es válido. Un agente o un cron JAMÁS
 *  cambian niveles; el servidor solo baja; subir exige humano con motivo, un
 *  escalón a la vez, bajo el techo de la clase y sin presupuesto agotado. */
export function evaluarCambioDeNivel(s: SolicitudCambioNivel): ResultadoCambio {
  const act = autonomiaDe(s.agente);
  if (s.actor.tipo === 'agente') return { permitido: false, motivo: 'un agente no puede cambiar autonomía (ni la suya ni la de otro)' };
  if (s.actor.tipo === 'cron') return { permitido: false, motivo: 'un cron no cambia autonomía' };
  const delta = ordenNivel(s.a) - ordenNivel(act.nivel);
  if (delta === 0) return { permitido: false, motivo: 'el agente ya está en ese nivel' };
  if (delta < 0) {
    if (s.actor.tipo === 'humano' && s.actor.motivo.trim() === '') return { permitido: false, motivo: 'bajar de nivel exige motivo' };
    return { permitido: true };
  }
  if (s.actor.tipo !== 'humano') return { permitido: false, motivo: 'el servidor solo puede bajar de nivel; subir lo decide Javier' };
  if (s.actor.motivo.trim() === '') return { permitido: false, motivo: 'subir de nivel exige motivo en bitácora' };
  if (!act.catalogado) return { permitido: false, motivo: 'agente no catalogado: primero se declara su clase en código' };
  if (ordenNivel(s.a) > ordenNivel(act.techo)) return { permitido: false, motivo: `techo de la clase ${act.clase}: ${act.techo}` };
  if (delta > 1) return { permitido: false, motivo: 'se sube un escalón a la vez' };
  if (s.presupuestoAgotado) return { permitido: false, motivo: 'presupuesto de error agotado: no se promueve autonomía' };
  if (s.s1Abierto) return { permitido: false, motivo: 'hay un S1 abierto sobre el agente' };
  if (s.examenFallido) return { permitido: false, motivo: 'falló el examen dorado' };
  return { permitido: true };
}

/** PURA. El nivel tras un descenso automático: un escalón, nunca bajo L0. */
export function nivelTrasDescenso(n: Nivel): Nivel {
  return NIVELES[Math.max(0, ordenNivel(n) - 1)];
}

/** PURA. ¿Debe la regla del servidor bajar al agente un nivel? */
export function debeDescender(e: { presupuestoAgotado?: boolean; s1Abierto?: boolean; examenFallido?: boolean }): boolean {
  return !!(e.presupuestoAgotado || e.s1Abierto || e.examenFallido);
}

/** Máximo nivel permitido para ejecutar una ACCIÓN concreta. Lo prohibido por
 *  la lista cerrada es L0 (la hace una persona); solo la lista de acciones L4
 *  llega a L4; todo lo demás, a L3 con aprobación. */
export function nivelMaximoDeAccion(idAccion: string): Nivel {
  if (prohibicionDe(idAccion)) return 'L0';
  return ACCIONES_L4.includes(idAccion) ? 'L4' : 'L3';
}
