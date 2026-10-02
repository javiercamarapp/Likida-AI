// ═══════════════════════════════════════════════════════════════════════════
// ESCALAR A UNA PERSONA — la validación pura de la única herramienta del
// orquestador que deja algo escrito.
//
// La regla de producto: la IA NO decide temas delicados (una emergencia, una
// diferencia de liquidación, un cliente molesto, una falla de un agente). Los
// deriva. Por eso esta herramienta solo puede una cosa: abrir una TAREA para una
// persona (tabla `orquestador_escalacion`, 0650). No manda mensajes, no cambia un
// viaje, no toca dinero.
//
// El modelo elige de listas CERRADAS (destino, motivo); lo único libre es el
// `resumen`, que viaja a una persona y NUNCA a una consulta, y aun así se limpia:
// sin números largos (teléfonos, cuentas), sin correos ni URL, acotado.
// ═══════════════════════════════════════════════════════════════════════════

export const DESTINOS = ['mesa_de_control', 'liquidacion', 'jefe_de_trafico', 'contador'] as const;
export type Destino = (typeof DESTINOS)[number];

export const MOTIVOS = ['operador_sin_respuesta', 'posible_emergencia', 'diferencia_liquidacion', 'cliente_molesto', 'falla_de_agente', 'duda_fiscal', 'otro'] as const;
export type Motivo = (typeof MOTIVOS)[number];

export const ETIQUETA_DESTINO: Readonly<Record<Destino, string>> = {
  mesa_de_control: 'la mesa de control',
  liquidacion: 'el equipo de liquidación',
  jefe_de_trafico: 'el jefe de tráfico',
  contador: 'el contador',
};

export const MAX_RESUMEN = 300;
/** Un folio es un código corto; cualquier otra cosa no se manda a la base. */
export const PATRON_FOLIO = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,39}$/;

export interface EscalacionValida {
  destino: Destino;
  motivo: Motivo;
  viajeFolio: string | null;
  resumen: string;
}

/** Quita lo que una persona no necesita para actuar y el repo no debe guardar de más. */
export function limpiarResumen(crudo: string): string {
  return crudo
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[enlace]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    // Teléfonos, cuentas, CLABE, tarjetas: cualquier racha de 8+ dígitos (con separadores comunes).
    .replace(/\d(?:[\s.-]?\d){7,}/g, '[número]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RESUMEN);
}

export type ResultadoValidacionEscalar = { ok: true; valor: EscalacionValida } | { ok: false; error: string };

export function validarEscalacion(args: Record<string, unknown>): ResultadoValidacionEscalar {
  const destino = args.destino;
  if (typeof destino !== 'string' || !(DESTINOS as readonly string[]).includes(destino)) {
    return { ok: false, error: `destino inválido; usa uno de: ${DESTINOS.join(', ')}` };
  }
  const motivo = args.motivo;
  if (typeof motivo !== 'string' || !(MOTIVOS as readonly string[]).includes(motivo)) {
    return { ok: false, error: `motivo inválido; usa uno de: ${MOTIVOS.join(', ')}` };
  }
  let viajeFolio: string | null = null;
  const f = args.viaje_folio;
  if (f !== undefined && f !== null && f !== '') {
    if (typeof f !== 'string' || !PATRON_FOLIO.test(f.trim())) return { ok: false, error: 'viaje_folio inválido: es el folio tal cual aparece en el tablero' };
    viajeFolio = f.trim();
  }
  const resumen = typeof args.resumen === 'string' ? limpiarResumen(args.resumen) : '';
  if (!resumen) return { ok: false, error: 'resumen vacío: di en una frase qué pasa y qué necesita decidir la persona' };
  return { ok: true, valor: { destino: destino as Destino, motivo: motivo as Motivo, viajeFolio, resumen } };
}

/** Una abierta por (destino, motivo, viaje): preguntar tres veces lo mismo no abre tres tareas. */
export function llaveDedupe(v: Pick<EscalacionValida, 'destino' | 'motivo'>, viajeId: string | null): string {
  return `${v.destino}|${v.motivo}|${viajeId ?? '-'}`;
}

export interface TareaAbierta {
  id: string;
  creadaEn: string;
  destino: Destino;
  motivo: Motivo;
  viajeFolio: string | null;
  resumen: string;
  pedidaPorRol: string;
}
