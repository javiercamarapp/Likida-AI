// ═══════════════════════════════════════════════════════════════════════════
// EMISOR DE MACROS DEL PROVEEDOR DE TELEMETRÍA (T-A5-55) — spike, sin red ni credenciales.
//
// Requisito del cliente (R11/R12): que el MISMO mensaje de WhatsApp del chofer («detención») dispare además la macro en el sistema
// de telemetría del proveedor, «dos pájaros de un tiro», y así se «omitan» las macros manuales. Si la dirección decide
// reemplazarlas por WhatsApp (D-2), este puente sobra: el diseño recomendado es el reemplazo, sin puente. Mientras no haya decisión
// ni acceso a la API del proveedor, esto es SOLO el contrato: el PUERTO `EmisorMacro` (qué necesita el Conductor para emitir una
// macro), su validación y un doble de pruebas. Qué hay que preguntar y qué decidir: `docs/operacion/puente-macros.md`.
//
// Garantías: nace apagado (perilla `habilitado` falsa por omisión y `emisorMacroApagado` no entrega nada); no hace red; idempotente
// por `clave` (viaje|tipo|evento): reintentar el mismo evento nunca duplica la macro; lo dudoso (sin id, sin viaje, tipo
// desconocido, hora inválida o futura) se descarta y no se inventa; un fallo del proveedor jamás lanza hacia el llamador. No se
// comunica como promoción: la capacitación al operador es presencial, no una plantilla. El adaptador real NO existe (bloqueo
// externo: D-2 y acceso a la API) y nadie lo invoca aún desde el flujo del chofer.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoMacro = 'detencion' | 'llegada' | 'salida';
const TIPOS_MACRO: readonly TipoMacro[] = ['detencion', 'llegada', 'salida'];

/** Un evento que el chofer reportó por WhatsApp y que el proveedor espera como macro. */
export interface EventoMacro {
  /** Id estable del evento en el Conductor (el mismo evento reintentado trae el mismo id). */
  eventoId: string;
  /** Referencia del viaje en el sistema del proveedor (no se asume que coincida con nuestro folio). */
  viajeRef: string;
  tipo: TipoMacro;
  ocurridoEn: Date;
  /** Texto breve opcional (p. ej. motivo de la detención). Sin datos personales. */
  motivo?: string;
}

/** Lo que recibe el puerto: el evento ya limpio más su clave de idempotencia. */
export interface MacroSaliente extends Omit<EventoMacro, 'eventoId'> {
  clave: string;
}

export interface EmisorMacro {
  /** `'enviada'` si el proveedor la aceptó; `'duplicada'` si ya tenía esa `clave`; `'apagado'` si no hay proveedor conectado. Cualquier otra cosa o un lanzamiento es fallo. */
  emitir(macro: MacroSaliente): Promise<'enviada' | 'duplicada' | 'apagado'>;
}

export type EstadoEmision = 'apagado' | 'invalida' | 'enviada' | 'duplicada' | 'fallo';
export interface ResultadoEmision { estado: EstadoEmision; clave?: string }

/** Una hora más adelantada que esto respecto al reloj es de un reloj descompuesto y no prueba nada. */
export const FUTURO_TOLERADO_MACRO_MIN = 2;

/** Clave de idempotencia: viaje | tipo | evento. */
export const claveMacro = (e: Pick<EventoMacro, 'viajeRef' | 'tipo' | 'eventoId'>): string => `${e.viajeRef}|${e.tipo}|${e.eventoId}`;

/** Copia limpia del evento, o `null` si no vale. Devuelve estructuras nuevas (la fuente no se muta). */
export function normalizarEventoMacro(e: EventoMacro | null | undefined, ahora: Date): EventoMacro | null {
  if (!e || typeof e.eventoId !== 'string' || typeof e.viajeRef !== 'string') return null;
  const eventoId = e.eventoId.trim();
  const viajeRef = e.viajeRef.trim();
  if (eventoId === '' || viajeRef === '' || !TIPOS_MACRO.includes(e.tipo)) return null;
  if (!(e.ocurridoEn instanceof Date)) return null;
  const t = e.ocurridoEn.getTime();
  if (!Number.isFinite(t) || t > ahora.getTime() + FUTURO_TOLERADO_MACRO_MIN * 60_000) return null;
  const motivo = typeof e.motivo === 'string' && e.motivo.trim() !== '' ? e.motivo.trim() : undefined;
  return { eventoId, viajeRef, tipo: e.tipo, ocurridoEn: new Date(t), motivo };
}

/**
 * Emite la macro de un evento por el puerto, sin lanzar nunca. Apagado por omisión: sin `habilitado` (o sin puerto) no sale nada.
 * Un evento dudoso es `invalida`; un fallo del proveedor o una respuesta inesperada es `fallo`.
 */
export async function emitirMacro(
  puerto: EmisorMacro | null | undefined, evento: EventoMacro | null | undefined, ahora: Date, opciones: { habilitado?: boolean } = {},
): Promise<ResultadoEmision> {
  if (opciones.habilitado !== true || !puerto) return { estado: 'apagado' };
  const limpio = normalizarEventoMacro(evento, ahora);
  if (!limpio) return { estado: 'invalida' };
  const clave = claveMacro(limpio);
  const { eventoId: _id, ...resto } = limpio;
  try {
    const r = await puerto.emitir({ ...resto, clave });
    return r === 'enviada' || r === 'duplicada' || r === 'apagado' ? { estado: r, clave } : { estado: 'fallo', clave };
  } catch {
    return { estado: 'fallo', clave };
  }
}

/** Puerto por omisión (nace apagado): ningún proveedor conectado → no se emite nada. */
export const emisorMacroApagado: EmisorMacro = { emitir: async () => 'apagado' };

/** Doble de prueba: guarda cada macro recibida una sola vez por `clave`; repetir la clave devuelve `duplicada`. */
export function crearDobleEmisorMacro(): EmisorMacro & { readonly recibidas: MacroSaliente[] } {
  const recibidas: MacroSaliente[] = [];
  return {
    recibidas,
    emitir: async (macro) => {
      if (recibidas.some((m) => m.clave === macro.clave)) return 'duplicada';
      recibidas.push({ ...macro, ocurridoEn: new Date(macro.ocurridoEn.getTime()) });
      return 'enviada';
    },
  };
}
