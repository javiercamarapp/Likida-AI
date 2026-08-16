// ═══════════════════════════════════════════════════════════════════════════
// ACCIONES del COPILOTO — el catálogo gateado (🟡/🔴) y su ejecutor
// determinista.
//
// EL MODELO PROPONE, EL HUMANO CONFIRMA, EL SERVIDOR EJECUTA SIN MODELO.
// El LLM solo arma el bloque de previsualización (tipo 'accion' en la
// respuesta); la ejecución llega por un POST aparte con `confirmado: true`
// que corre ESTE módulo — la misma función que ya usa el ⌘K
// (api/admin/palette), jamás una decisión del modelo. La bitácora la
// escribe la función real (apagar() anota interruptor.apagado en 0053).
//
// FASE 1 (diseño §10): solo `apagar_agente` está implementada. Las demás
// existen en el catálogo con `implementada: false` — el copiloto las
// declara con esas palabras en vez de fingir que puede.
// ═══════════════════════════════════════════════════════════════════════════

import { INTERRUPTORES, apagar, type NombreInterruptor } from '@/lib/likida/interruptores';
import { DatoInvalido } from '@/lib/likida/errores';

export type Gateo = 'confirma' | 'doble';

export interface AccionCatalogo {
  id: string;
  gateo: Gateo;
  implementada: boolean;
  /** Qué pasa si se ejecuta — el texto de la previsualización. */
  efecto: string;
  /** Cómo se deshace (o que no se puede). */
  revertir: string;
}

/** El catálogo completo del diseño §3c. Ninguna acción cambia de gateo sin
 *  decisión explícita — el nivel es parte del contrato, no un default. */
export const CATALOGO_ACCIONES: readonly AccionCatalogo[] = [
  {
    id: 'apagar_agente', gateo: 'confirma', implementada: true,
    efecto: 'Corta la corrida siguiente de ese agente en TODAS las flotas (la palanca es global por agente, no por tenant). Los crons responden 200 con "saltado".',
    revertir: 'Encender desde /admin/observabilidad o el ⌘K (encender exige doble confirmación).',
  },
  {
    id: 'encender_agente', gateo: 'doble', implementada: false,
    efecto: 'Vuelve a soltar al agente sobre clientes reales.',
    revertir: 'Apagar de nuevo.',
  },
  {
    id: 'correr_agente_ahora', gateo: 'confirma', implementada: false,
    efecto: 'Dispara la corrida de un agente para una flota sin esperar su cron.',
    revertir: 'No aplica — la corrida que ya corrió, corrió.',
  },
  {
    id: 'aprobar_pendiente', gateo: 'doble', implementada: false,
    efecto: 'Aprueba una factura de proveedor o talacha — es un acto con efecto legal.',
    revertir: 'No se deshace desde aquí.',
  },
  {
    id: 'rechazar_pendiente', gateo: 'doble', implementada: false,
    efecto: 'Rechaza un pendiente de la cola con motivo.',
    revertir: 'No se deshace desde aquí.',
  },
  {
    id: 'asignar_prospecto', gateo: 'confirma', implementada: false,
    efecto: 'Asigna un prospecto del censo a un vendedor.',
    revertir: 'Reasignar o devolver al pool desde /admin/vendedores.',
  },
  {
    id: 'cambiar_estado_prospecto', gateo: 'confirma', implementada: false,
    efecto: 'Mueve un prospecto en el embudo (cerrado es terminal).',
    revertir: 'Según la transición — cerrado no se reabre desde el tablero.',
  },
  {
    id: 'marcar_pago_conciliado', gateo: 'doble', implementada: false,
    efecto: 'Marca una factura SaaS como pagada contra una referencia bancaria. MUEVE DINERO.',
    revertir: 'No se deshace desde aquí.',
  },
  {
    id: 'reabrir_liquidacion', gateo: 'doble', implementada: false,
    efecto: 'Reabre una liquidación cerrada — solo por la vía del panel, jamás por SQL.',
    revertir: 'Volver a cerrar el viaje.',
  },
] as const;

export function accionDelCatalogo(id: string): AccionCatalogo | null {
  return CATALOGO_ACCIONES.find((a) => a.id === id) ?? null;
}

export interface ResultadoAccionCopiloto {
  ok: boolean;
  mensaje: string;
}

/**
 * Ejecuta una acción YA CONFIRMADA por Javier. Determinista: aquí no hay
 * modelo — el `userId` viene de la sesión superadmin del route, jamás del
 * cuerpo. LANZA `DatoInvalido` con texto para pantalla en todo rechazo.
 */
export async function ejecutarAccionCopiloto(
  accionId: string,
  params: { id?: string; motivo?: string },
  userId: string,
): Promise<ResultadoAccionCopiloto> {
  const accion = accionDelCatalogo(accionId);
  if (!accion) throw new DatoInvalido(`"${accionId}" no es una acción del catálogo del copiloto.`);
  if (!accion.implementada) {
    throw new DatoInvalido(`"${accionId}" está en el catálogo pero todavía no está implementada — se construye en una fase posterior.`);
  }

  if (accionId === 'apagar_agente') {
    const id = (params.id ?? '').trim();
    if (!(INTERRUPTORES as readonly string[]).includes(id)) {
      throw new DatoInvalido(`"${id}" no es un interruptor del catálogo.`);
    }
    // `apagar` valida el motivo no-vacío (lo rebota con su propio texto) y
    // anota interruptor.apagado en bitacora_auditoria — una sola bitácora,
    // el mismo mecanismo que /admin/observabilidad y el ⌘K.
    await apagar(id as NombreInterruptor, params.motivo ?? '', userId);
    return { ok: true, mensaje: `Listo: ${id} quedó apagado y el motivo en la bitácora. Se enciende desde Observabilidad (doble confirmación).` };
  }

  // Inalcanzable mientras solo apagar_agente esté implementada — el guard de
  // arriba ya rechazó las no implementadas. Queda como red por si el catálogo
  // marca implementada una acción sin rama.
  throw new DatoInvalido(`"${accionId}" no tiene ejecutor todavía.`);
}
