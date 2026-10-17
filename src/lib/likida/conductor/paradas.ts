// ═══════════════════════════════════════════════════════════════════════════
// LA PARADA QUE INICIA EL CHOFER (T-A5-38, migración 0806) — vocabulario, botones, decisión y mensajes. Sin I/O.
//
// Requisito del cliente (R10): el operador avisa «parada/detención» —con botón y MOTIVO (tráfico, descanso, pernocta…)— y avisa
// cuando continúa. Una parada NO es un hito del ciclo (la máquina de estados no la conoce) ni escala por sí sola: es un episodio
// con inicio, fin y motivo.
//
// Flujo:
//   «parada» (botón o texto) sin motivo ──► se le muestra la lista de motivos (un solo mensaje)
//   motivo (botón de la lista, o dicho en el texto: «parada por tráfico») ──► se abre la parada
//   «ya continúo» ──► se cierra la parada
//
// Tono: UNA pregunta por episodio y no se insiste (el exceso de mensajes se vive como vigilancia y se rechaza). Ningún texto de aquí pide más de un toque ni repite la pregunta.
// Una parada «pernocta» no dispara reaviso: esa regla vive en quien detecta detenciones (T-A5-39); aquí solo se guarda el motivo.
//
// Los botones de la parada NO van en `PREFIJO_BOTON` (tipos.ts es del núcleo del ciclo): tienen su propio lector, anclado y con
// el uuid validado. El llamador SIEMPRE comprueba que el viaje del botón sea del chofer (como con los demás botones).
// ═══════════════════════════════════════════════════════════════════════════

/** Vocabulario cerrado: el mismo del CHECK `viaje_parada_motivo_dominio` (0806). */
export const MOTIVOS_PARADA = ['trafico', 'descanso', 'pernocta', 'reten', 'averia', 'otro'] as const;
export type MotivoParada = typeof MOTIVOS_PARADA[number];

export function esMotivoParada(valor: unknown): valor is MotivoParada {
  return typeof valor === 'string' && (MOTIVOS_PARADA as readonly string[]).includes(valor);
}

/** Cómo se llama cada motivo en la lista (≤ 24 caracteres: tope del título de una fila de lista de WhatsApp). */
export const ETIQUETA_MOTIVO: Readonly<Record<MotivoParada, string>> = {
  trafico: 'Tráfico',
  descanso: 'Descanso',
  pernocta: 'Pernocta',
  reten: 'Retén',
  averia: 'Avería',
  otro: 'Otro',
};

/** Una fila de `viaje_parada`, ya en camelCase. `fin = null` = abierta. */
export interface ParadaFila {
  id: string;
  tenantId: string;
  viajeId: string;
  inicio: string;
  fin: string | null;
  motivo: MotivoParada;
  origen: 'chofer' | 'sistema';
}

// ── Los botones: <prefijo>:<viaje_id> ───────────────────────────────────────
export const PREFIJO_PARADA = {
  /** Botón «Parada»: abre la lista de motivos. */
  abrir: 'parada_abrir',
  /** Un motivo de la lista: `parada_motivo_<motivo>:<viaje>`. */
  motivo: 'parada_motivo_',
  /** Botón «Ya continúo». */
  continuo: 'parada_continuo',
} as const;

export type BotonParada =
  | { accion: 'abrir'; viajeId: string }
  | { accion: 'motivo'; motivo: MotivoParada; viajeId: string }
  | { accion: 'continuo'; viajeId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿El texto es el payload de uno de los botones de la parada? Anclado, con el uuid validado y el motivo del vocabulario. */
export function leerBotonParada(texto: string | undefined): BotonParada | null {
  if (typeof texto !== 'string') return null;
  const t = texto.trim();
  if (t.length > 128) return null;
  const partes = t.split(':');
  if (partes.length !== 2) return null;
  const [prefijo, viajeId] = partes;
  if (!UUID.test(viajeId)) return null;
  const id = viajeId.toLowerCase();
  if (prefijo === PREFIJO_PARADA.abrir) return { accion: 'abrir', viajeId: id };
  if (prefijo === PREFIJO_PARADA.continuo) return { accion: 'continuo', viajeId: id };
  if (prefijo.startsWith(PREFIJO_PARADA.motivo)) {
    const motivo = prefijo.slice(PREFIJO_PARADA.motivo.length);
    return esMotivoParada(motivo) ? { accion: 'motivo', motivo, viajeId: id } : null;
  }
  return null;
}

// ── La decisión (pura) ──────────────────────────────────────────────────────

export type OrdenParada =
  /** «Parada»; `motivo` null = el chofer no lo dijo todavía. */
  | { tipo: 'abrir'; motivo: MotivoParada | null }
  | { tipo: 'continuo' };

export type DecisionParada =
  /** «Parada» a secas: se muestra la lista de motivos y no se escribe nada. */
  | { accion: 'pedir_motivo' }
  | { accion: 'abrir'; motivo: MotivoParada }
  /** Ya había una abierta: no se abre otra (idempotente); se le confirma la que hay. */
  | { accion: 'ya_abierta'; motivo: MotivoParada }
  | { accion: 'cerrar' }
  /** «Ya continúo» sin parada abierta: no hay nada que cerrar. */
  | { accion: 'sin_parada' };

/** Qué hacer con lo que dijo el chofer según la parada abierta del viaje (si hay). Pura. */
export function decidirParada(abierta: Pick<ParadaFila, 'motivo'> | null, orden: OrdenParada): DecisionParada {
  if (orden.tipo === 'continuo') return abierta ? { accion: 'cerrar' } : { accion: 'sin_parada' };
  if (abierta) return { accion: 'ya_abierta', motivo: abierta.motivo };
  return orden.motivo ? { accion: 'abrir', motivo: orden.motivo } : { accion: 'pedir_motivo' };
}

// ── Los mensajes ────────────────────────────────────────────────────────────

export interface OpcionLista { id: string; titulo: string }
export interface ListaMotivos { texto: string; opciones: OpcionLista[] }

/** La lista interactiva de motivos (una fila por motivo; el id lleva el viaje). Un solo mensaje, sin repetirse. */
export function armarListaMotivos(viajeId: string): ListaMotivos {
  return {
    texto: 'Anotado. ¿Cuál es el motivo de la parada? Toca una opción.',
    opciones: MOTIVOS_PARADA.map((m) => ({ id: `${PREFIJO_PARADA.motivo}${m}:${viajeId}`, titulo: ETIQUETA_MOTIVO[m] })),
  };
}

/** El botón «Ya continúo» que acompaña a la confirmación de una parada abierta. */
export function botonContinuo(viajeId: string): OpcionLista {
  return { id: `${PREFIJO_PARADA.continuo}:${viajeId}`, titulo: 'Ya continúo' };
}

export function textoParadaAbierta(motivo: MotivoParada): string {
  return `Listo, anoté tu parada (${ETIQUETA_MOTIVO[motivo].toLowerCase()}). Cuando sigas, avísame con «ya continúo».`;
}

export function textoParadaYaAbierta(motivo: MotivoParada): string {
  return `Ya tengo tu parada anotada (${ETIQUETA_MOTIVO[motivo].toLowerCase()}). Cuando sigas, avísame con «ya continúo».`;
}

export const TEXTO_PARADA_CERRADA = 'Gracias, anoté que ya sigues en camino. Buen viaje.';
export const TEXTO_SIN_PARADA = 'No tengo una parada abierta en tu viaje. Todo en orden.';
export const TEXTO_PARADA_FALLO = 'No pude anotarlo ahorita; mándamelo de nuevo en un momento.';

// ── Quien la ejecuta (con la base inyectada, como el resto del módulo) ──────

export interface DepsParada {
  leerAbierta: (tenantId: string, viajeId: string) => Promise<ParadaFila | null>;
  abrir: (tenantId: string, viajeId: string, motivo: MotivoParada, ahora: Date) => Promise<'ok' | 'duplicada' | 'sin_tabla' | 'fallo'>;
  cerrar: (tenantId: string, viajeId: string, fin: Date, origen: 'chofer' | 'sistema') => Promise<'cerrada' | 'sin_parada' | 'sin_tabla' | 'fallo'>;
}

export interface SalidaParada {
  texto: string;
  /** Presente solo al pedir el motivo. */
  lista?: ListaMotivos;
  /** Presente solo al confirmar una parada abierta. */
  botones?: OpcionLista[];
}

/**
 * Ejecuta una orden de parada de UN viaje que el llamador YA comprobó que es del chofer y no está liquidado. No toca hitos.
 * Un fallo de la base nunca se disfraza de «anotado».
 */
export async function ejecutarParada(
  e: { tenantId: string; viajeId: string; orden: OrdenParada; ahora?: Date }, deps: DepsParada,
): Promise<SalidaParada> {
  const ahora = e.ahora ?? new Date();
  const abierta = await deps.leerAbierta(e.tenantId, e.viajeId);
  const d = decidirParada(abierta, e.orden);
  switch (d.accion) {
    case 'pedir_motivo':
      return { texto: armarListaMotivos(e.viajeId).texto, lista: armarListaMotivos(e.viajeId) };
    case 'ya_abierta':
      return { texto: textoParadaYaAbierta(d.motivo), botones: [botonContinuo(e.viajeId)] };
    case 'abrir': {
      const r = await deps.abrir(e.tenantId, e.viajeId, d.motivo, ahora);
      // `duplicada` = otro mensaje la abrió primero (carrera): la parada existe, no se abre otra.
      if (r === 'ok' || r === 'duplicada') return { texto: textoParadaAbierta(d.motivo), botones: [botonContinuo(e.viajeId)] };
      return { texto: TEXTO_PARADA_FALLO };
    }
    case 'cerrar': {
      const r = await deps.cerrar(e.tenantId, e.viajeId, ahora, 'chofer');
      if (r === 'cerrada' || r === 'sin_parada') return { texto: TEXTO_PARADA_CERRADA };
      return { texto: TEXTO_PARADA_FALLO };
    }
    case 'sin_parada':
      return { texto: TEXTO_SIN_PARADA };
  }
}
