// ═══════════════════════════════════════════════════════════════════════════
// ACCIONES del COPILOTO — el catálogo gateado (🟡/🔴) y su ejecutor
// determinista.
//
// EL MODELO PROPONE, EL HUMANO CONFIRMA, EL SERVIDOR EJECUTA SIN MODELO.
// El LLM solo arma el bloque de previsualización (tipo 'accion' en la
// respuesta); al proponer, el route crea un AdminActionIntent
// (copiloto-intents.ts) y la ejecución llega por un POST aparte que presenta
// ese `intentId` — validado y gastado por el servidor— y corre ESTE módulo,
// la misma función que ya usa el ⌘K (api/admin/palette), jamás una decisión
// del modelo. La bitácora la escribe la función real (apagar() anota
// interruptor.apagado en 0053).
//
// FASE 1 (diseño §10): solo `apagar_agente` está implementada. Las demás
// existen en el catálogo con `implementada: false` — el copiloto las
// declara con esas palabras en vez de fingir que puede.
// ═══════════════════════════════════════════════════════════════════════════

import { INTERRUPTORES, apagar, type NombreInterruptor } from '@/lib/likida/interruptores';
import { correrRunner } from '@/lib/likida/agentes/runner';
import { DatoInvalido } from '@/lib/likida/errores';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';

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
  {
    id: 'correr_runner', gateo: 'confirma', implementada: true,
    efecto: 'Dispara UNA vuelta del runner nivel 2 sin esperar su cron: despacha los agentes autónomos habilitados con sus cuatro candados (kill switch, opt-in, techo de dinero del día, backpressure de la bandeja). Gasta modelo del rol barato y fabrica borradores hacia Aprobaciones — jamás envía nada.',
    revertir: 'Lo fabricado espera en la bandeja: se rechaza pieza por pieza. La corrida que corrió, corrió.',
  },
] as const;

/**
 * Qué agente nombra el `objetivo` de `correr_runner`, o `undefined` para la
 * vuelta completa. Acepta `redactor` y `agente:redactor` (la forma que usa el
 * catálogo de interruptores); `runner`, `todos`, `cron` o vacío = todos.
 */
export function objetivoDelRunner(objetivo: string | undefined): string | undefined {
  const o = (objetivo ?? '').trim().toLowerCase().replace(/^agente:/, '');
  if (!o || o === 'runner' || o === 'todos' || o === 'cron' || o === 'all') return undefined;
  return o;
}

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

  if (accionId === 'correr_runner') {
    // El motivo es la nota de POR QUÉ se adelantó el cron — a la bitácora
    // (la escribe `anotarCorridaEnBitacora`, abajo; exigir el motivo sin
    // anotarlo era un contrato declarado que no se cumplía).
    const motivo = (params.motivo ?? '').trim();
    if (!motivo) throw new DatoInvalido('El motivo es obligatorio: por qué se adelanta la vuelta del runner.');
    // M30 (auditoría 18): el objetivo que la tarjeta ENSEÑÓ es el que corre.
    // La previsualización decía "Voy a ejecutar `redactor`" y esta rama
    // ignoraba `params.id` y despachaba a TODOS los habilitados: Javier
    // autorizaba una corrida y obtenía N. Un objetivo que nombra un agente
    // acota la vuelta a ese agente; "runner"/"todos" (o vacío) es la vuelta
    // completa, que es lo que describe `efecto`.
    const soloAgente = objetivoDelRunner(params.id);
    const r = await correrRunner(soloAgente);
    // Se firma TAMBIÉN la vuelta que el kill switch dejó en nada: la acción
    // confirmada fue "correr el runner", y eso es lo que la bitácora audita.
    await anotarCorridaEnBitacora(userId, motivo, {
      apagado_global: r.apagadoGlobal === true,
      objetivo: soloAgente ?? 'todos',
      agentes: r.agentes.map((a) => ({ agente: a.agente, resultado: a.resultado })),
    });
    if (r.apagadoGlobal) {
      return { ok: true, mensaje: 'El runner no corrió: el kill switch GLOBAL está abajo. Se enciende desde Observabilidad.' };
    }
    if (soloAgente && r.agentes.length === 0) {
      return { ok: true, mensaje: `Vuelta del runner: "${soloAgente}" no está habilitado para el runner (estado vivo + runner_habilitado + disparador cron), así que no se despachó nada.` };
    }
    const partes = r.agentes.map((a) => a.resultado === 'corrio'
      ? `${a.agente}: ${a.piezas ?? 0} pieza${(a.piezas ?? 0) === 1 ? '' : 's'} a la bandeja (${a.saltados ?? 0} saltados, $${(a.costoUsd ?? 0).toFixed(4)} USD)`
      : `${a.agente}: saltado — ${a.motivo}`);
    return { ok: true, mensaje: partes.length > 0 ? `Vuelta del runner: ${partes.join(' · ')}. Lo fabricado espera en Aprobaciones.` : 'Vuelta del runner: ningún agente habilitado que despachar.' };
  }

  // Inalcanzable mientras el catálogo y las ramas coincidan. Queda como red
  // por si el catálogo marca implementada una acción sin rama.
  throw new DatoInvalido(`"${accionId}" no tiene ejecutor todavía.`);
}

/**
 * La corrida manual del runner queda en `bitacora_auditoria` (0053) con su
 * motivo — el porqué de adelantar el cron es exactamente lo que en tres
 * semanas nadie recuerda. Best-effort A PROPÓSITO (mismo criterio que
 * `anotarEnBitacora` en interruptores.ts): la vuelta YA corrió; contestarle
 * un error a Javier porque la bitácora no pudo escribir mentiría sobre un
 * runner que sí despachó. El fallo se loguea para que no muera en silencio.
 */
async function anotarCorridaEnBitacora(
  userId: string,
  motivo: string,
  detalle: Record<string, unknown>,
): Promise<void> {
  try {
    await anotarBitacora(
      { tenantId: null, // el runner barre TODAS las flotas: acción de plataforma
        actor: { id: userId }, accion: 'runner.corrida_manual', entidad: 'runner', entidadId: 'nivel2',
        detalle: { motivo, ...detalle } },
      { evento: 'copiloto.bitacora_no_escribio' },
    );
  } catch (e) {
    logger.warn('copiloto.bitacora_no_escribio', {
      accion: 'runner.corrida_manual',
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
