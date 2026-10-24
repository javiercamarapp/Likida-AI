// Política de envío del aviso de viaje: ¿lo confirma una persona o sale solo? (T-A4-20)
//
// Requisito: «con confirmación humana y luego autónomo» (plan 12 §F8, E5). Mismo patrón que `modoAprobacion` /
// `aprobacionesSinEditar` de la política del Vigía (`../politica.ts`): el modo autónomo se GANA con evidencia, por
// cliente, y no se enciende de golpe. Esto solo autoriza ESTE aviso estructurado (plantilla); el texto libre
// («contesta solo en cada chat») sigue en stand-by y no pasa por aquí.
//
// Reglas (cualquier duda → confirmar; equivocarse hacia pedir un toque cuesta segundos):
//  1. Flota apagada (aviso deshabilitado o kill switch de la flota) → `ninguna`: no sale ni se pide nada.
//  2. Modo `confirmar` (el default) → todo a `pendiente_confirmacion`.
//  3. Modo `autonomo` solo aplica POR CLIENTE: el cliente debe tener `autonomoMinConfirmaciones` confirmaciones
//     consecutivas SIN editar. Cualquier edición humana o fallo reinicia el contador (`contarConfirmacionesSinEditar`).
//  4. Kill switch del cliente → siempre confirmar.
//  5. Aviso incompleto (con campos pendientes) → nunca autónomo.
//  6. Reenvío por cambio de operador → exige confirmación durante la primera ventana de autonomía del cliente
//     (`diasCambioOperadorConfirma`, 7 por defecto, configurable). Sin fecha de inicio de autonomía se asume ventana abierta.
// Módulo puro y sin logs: no lee ni escribe nada.

export type ModoPolitica = 'confirmar' | 'autonomo';

export interface ConfigPolitica {
  modo: ModoPolitica;
  /** Confirmaciones sin editar que hacen falta por cliente (0797: `autonomo_min_confirmaciones`). */
  autonomoMinConfirmaciones: number;
  /** Aviso habilitado en la flota (0797: `habilitado`). */
  habilitado: boolean;
  /** Kill switch de la flota: apaga todo el aviso. */
  killFlota?: boolean;
  /** Días tras empezar la autonomía del cliente en que un cambio de operador aún pide confirmación. Defecto 7. */
  diasCambioOperadorConfirma?: number;
}

export interface ClientePolitica {
  /** Kill switch del cliente: con `true` este cliente siempre pasa por confirmación. */
  autonomoApagado?: boolean;
  /** Cuándo alcanzó el mínimo de confirmaciones (inicio de su autonomía). `null` = aún no / desconocido. */
  autonomoDesde?: Date | null;
}

export interface RiesgoAviso {
  /** `true` si el aviso no tiene campos pendientes. */
  completo: boolean;
  /** `true` si es un reenvío por cambio (versión > 1). */
  esReenvio?: boolean;
  /** `true` si el cambio incluye al operador. */
  cambioOperador?: boolean;
}

export interface EntradaPoliticaAviso {
  config: ConfigPolitica;
  cliente: ClientePolitica;
  /** Confirmaciones consecutivas de ESTE cliente sin editar (ver `contarConfirmacionesSinEditar`). */
  aprobacionesSinEditar: number;
  riesgo: RiesgoAviso;
  /** Instante de la decisión (para la ventana de cambios de operador). */
  ahora?: Date;
}

export type MotivoPolitica =
  | 'flota_apagada' | 'modo_confirmar' | 'cliente_apagado' | 'aviso_incompleto'
  | 'cambio_operador_primera_semana' | 'aun_no_validado' | 'autonomo_validado';

export type DecisionAviso =
  | { accion: 'autoaprobar'; motivo: MotivoPolitica }
  | { accion: 'confirmar'; motivo: MotivoPolitica }
  | { accion: 'ninguna'; motivo: MotivoPolitica };

export const DIAS_CAMBIO_OPERADOR_DEFECTO = 7;
const MS_DIA = 86_400_000;

export function decidirEnvioAviso(e: EntradaPoliticaAviso): DecisionAviso {
  if (!e.config.habilitado || e.config.killFlota === true) return { accion: 'ninguna', motivo: 'flota_apagada' };
  if (e.config.modo !== 'autonomo') return { accion: 'confirmar', motivo: 'modo_confirmar' };
  if (e.cliente.autonomoApagado === true) return { accion: 'confirmar', motivo: 'cliente_apagado' };
  if (!e.riesgo.completo) return { accion: 'confirmar', motivo: 'aviso_incompleto' };

  if (e.riesgo.esReenvio === true && e.riesgo.cambioOperador === true) {
    const dias = e.config.diasCambioOperadorConfirma ?? DIAS_CAMBIO_OPERADOR_DEFECTO;
    const desde = e.cliente.autonomoDesde;
    const ahora = (e.ahora ?? new Date()).getTime();
    if (!desde || ahora - desde.getTime() < dias * MS_DIA) {
      return { accion: 'confirmar', motivo: 'cambio_operador_primera_semana' };
    }
  }

  // A37-S58-08: el mínimo efectivo es 1 — jamás se autoaprueba sin al menos una confirmación humana, aunque la base traiga 0.
  const minimo = Number.isFinite(e.config.autonomoMinConfirmaciones) ? Math.max(1, e.config.autonomoMinConfirmaciones) : Infinity;
  if (!(e.aprobacionesSinEditar >= minimo)) return { accion: 'confirmar', motivo: 'aun_no_validado' };
  return { accion: 'autoaprobar', motivo: 'autonomo_validado' };
}

export type ResultadoConfirmacion = 'confirmado_sin_editar' | 'editado' | 'fallido';

/**
 * Cuenta las confirmaciones consecutivas sin editar, de la más reciente hacia atrás: una edición humana o un fallo
 * corta la cuenta (el contador vuelve a cero). `historial` va de la más antigua a la más reciente.
 */
export function contarConfirmacionesSinEditar(historial: readonly ResultadoConfirmacion[]): number {
  let n = 0;
  for (let i = historial.length - 1; i >= 0; i--) {
    if (historial[i] !== 'confirmado_sin_editar') break;
    n++;
  }
  return n;
}

/** Lo que `generarAvisos` sabe del aviso al decidir su estado. */
export interface ContextoAutonomia {
  clienteId: string | null;
  completo: boolean;
  esReenvio?: boolean;
  cambioOperador?: boolean;
}

export interface LecturasAutonomia {
  config: ConfigPolitica;
  /** Estado del cliente y su historial; implementada sobre el repo real o un doble. */
  cliente(tenantId: string, clienteId: string): Promise<{ cliente: ClientePolitica; historial: readonly ResultadoConfirmacion[] }>;
  ahora?: () => Date;
}

/**
 * Adaptador para `DepsGenerar.autonomoPermitido`. Falla cerrado: sin contexto (quien llama no dice si el aviso está
 * completo ni de qué cliente es) o sin cliente, no hay autonomía.
 */
export function crearAutonomoPermitido(l: LecturasAutonomia): (tenantId: string, ctx?: ContextoAutonomia) => Promise<boolean> {
  return async (tenantId, ctx) => {
    if (!ctx || !ctx.clienteId) return false;
    const { cliente, historial } = await l.cliente(tenantId, ctx.clienteId);
    const d = decidirEnvioAviso({
      config: l.config, cliente, aprobacionesSinEditar: contarConfirmacionesSinEditar(historial),
      riesgo: { completo: ctx.completo, esReenvio: ctx.esReenvio, cambioOperador: ctx.cambioOperador },
      ahora: l.ahora?.(),
    });
    return d.accion === 'autoaprobar';
  };
}
