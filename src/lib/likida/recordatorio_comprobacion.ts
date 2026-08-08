import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { sendText } from '@/lib/meta/client';

// ═══════════════════════════════════════════════════════════════════════════
// EL OPERADOR QUE LLEVA DÍAS SIN MANDAR NADA.
//
// Un viaje sigue abierto/en_cuadre y su `fecha_inicio` ya pasó el plazo — el
// jefe de flota lo ve en "Requieren tu atención" (resumen-visual.tsx), pero
// hasta hoy nadie le insistía al CHOFER directamente. Javier decidió el
// 8-ago-2026 que este recordatorio sale SOLO, disparado por el propio
// motor, no por un botón que dependa de que el jefe de flota entre al
// panel y lo apriete.
//
// ── MISMO MECANISMO QUE escalar_viaje.ts, MISMA RAZÓN ────────────────────
//
// Vercel Cron entrega *at-least-once* — dos corridas pueden solaparse. El
// sello (`recordatorio_comprobacion_en`) se pone con un UPDATE condicional
// ANTES de mandar el mensaje, no después: así solo la corrida que de verdad
// ganó la fila manda el WhatsApp. Ver `reclamarRecordatorio` más abajo y el
// encabezado largo de `escalar_viaje.ts` para la carrera completa.
//
// ── UNA SOLA VEZ POR VIAJE, NO POR DÍA ────────────────────────────────────
//
// El recordatorio se manda UNA vez cuando el viaje cruza el plazo, no todos
// los días que siga abierto — la misma regla de `cierre_aviso.ts`: un canal
// que insiste todos los días se aprende a ignorar. Si hace falta escalar
// más fuerte después de esto, es un problema distinto (ver escalar_viaje.ts,
// que sí es del jefe, no del chofer).
// ═══════════════════════════════════════════════════════════════════════════

/** Días sin cerrar antes de recordarle al operador. Mismo umbral que
 *  "detenido" en `ViajesAtencion` (resumen-visual.tsx) — un viaje que ya se
 *  le enseña al jefe de flota como atorado es, por definición, uno que
 *  también amerita insistirle al chofer. */
export const DIAS_PARA_RECORDAR = 3;

export interface ViajeSinComprobar {
  id: string;
  tenantId: string;
  folio: string | null;
  operadorId: string | null;
  operadorNombre: string | null;
  operadorTelefono: string | null;
  fechaInicio: string;
}

/** Los viajes abiertos/en_cuadre, con fecha de inicio vieja, que nunca
 *  recibieron este recordatorio. `ahora` se inyecta para que la prueba no
 *  dependa del reloj de la máquina — mismo criterio que `viajesSinAceptar`. */
export async function viajesSinComprobar(ahora: Date = new Date()): Promise<ViajeSinComprobar[]> {
  const limite = new Date(ahora.getTime() - DIAS_PARA_RECORDAR * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('id, tenant_id, folio, operador_id, fecha_inicio, operador(nombre, telefono)')
    .in('estatus', ['abierto', 'en_cuadre'])
    .is('recordatorio_comprobacion_en', null)
    .not('fecha_inicio', 'is', null)
    .lte('fecha_inicio', limite)
    .limit(100);

  if (error) throw new Error(`viajesSinComprobar: ${error.message}`);

  type Rel = { nombre?: string; telefono?: string };
  return (data ?? []).map((v) => {
    const rel = v.operador as Rel | Rel[] | null;
    const op = Array.isArray(rel) ? rel[0] : rel;
    return {
      id: v.id as string,
      tenantId: v.tenant_id as string,
      folio: (v.folio as string) ?? null,
      operadorId: (v.operador_id as string) ?? null,
      operadorNombre: op?.nombre ?? null,
      operadorTelefono: op?.telefono ?? null,
      fechaInicio: v.fecha_inicio as string,
    };
  });
}

/** El texto para el CHOFER. Dice cuánto lleva y qué mandar — no regaña: el
 *  viaje puede estar detenido por algo que no depende de él (un desglose
 *  que no le entregaron, una espera en terminal). */
export function armarRecordatorioComprobacion(v: ViajeSinComprobar, dias: number): string {
  const viaje = v.folio ? `tu viaje *${v.folio}*` : 'tu viaje abierto';
  return [
    `Llevas ${dias} días con ${viaje} sin mandarme comprobantes. 📋`,
    '',
    'Mándame las fotos de tus recibos (diésel, casetas, lo que traigas) para irlos anotando.',
    'Si el viaje ya terminó y falta cerrarlo, dime y seguimos con eso.',
  ].join('\n');
}

export interface ResultadoRecordatorio {
  revisados: number;
  recordados: number;
  fallos: string[];
}

/**
 * Corre el recordatorio sobre todos los viajes vencidos.
 *
 * MISMO CRITERIO QUE escalar_viaje.ts: el sello se pone AUNQUE el envío
 * falle (número mal capturado, Meta caído) — la alternativa es peor, cada
 * corrida reintentaría para siempre el mismo viaje roto. El fallo queda en
 * `fallos` y en el log; el viaje sigue visible en "Requieren tu atención"
 * del panel, que no depende de WhatsApp para mostrarlo.
 */
export async function enviarRecordatoriosComprobacion(ahora: Date = new Date()): Promise<ResultadoRecordatorio> {
  const viajes = await viajesSinComprobar(ahora);
  const r: ResultadoRecordatorio = { revisados: viajes.length, recordados: 0, fallos: [] };
  const admin = supabaseAdmin();
  const ahoraIso = ahora.toISOString();

  for (const v of viajes) {
    // RECLAMAR ANTES DE MANDAR NADA — ver el encabezado del archivo.
    const claim = await reclamarRecordatorio(admin, v, ahoraIso);
    if (claim.error) {
      r.fallos.push(`marcar ${v.folio ?? v.id}: ${claim.error}`);
      continue;
    }
    if (!claim.ganado) {
      logger.info('recordatorio_comprobacion.ya_en_proceso', { viaje: v.id });
      continue;
    }

    if (!v.operadorTelefono) {
      logger.error('recordatorio_comprobacion.sin_telefono', { tenantId: v.tenantId, viaje: v.id });
      r.fallos.push(`${v.folio ?? v.id}: el operador no tiene teléfono capturado`);
      continue;
    }

    try {
      const dias = Math.floor((ahora.getTime() - Date.parse(`${v.fechaInicio}T00:00:00Z`)) / 86_400_000);
      const enviado = await sendText(v.operadorTelefono, armarRecordatorioComprobacion(v, dias));
      if (enviado) r.recordados++;
      else r.fallos.push(`${v.folio ?? v.id}: WhatsApp rechazó el envío`);
    } catch (e) {
      r.fallos.push(`${v.folio ?? v.id}: ${e instanceof Error ? e.message : 'error inesperado al enviar'}`);
    }
  }

  logger.info('viaje.recordatorio_comprobacion', { revisados: r.revisados, recordados: r.recordados, fallos: r.fallos.length });
  return r;
}

/** Toma el viaje para ESTA corrida, ANTES de mandar el mensaje. Mismo
 *  mecanismo que `reclamarEscalacion` (escalar_viaje.ts): UPDATE
 *  condicional que devuelve filas — el primero en llegar deja a los demás
 *  sin fila que actualizar. Cero filas no es un error, es que otra corrida
 *  ya ganó. Se falla cerrado: si el UPDATE mismo revienta, no se manda
 *  ningún mensaje. */
async function reclamarRecordatorio(
  admin: ReturnType<typeof supabaseAdmin>,
  v: ViajeSinComprobar,
  ahora: string,
): Promise<{ ganado: boolean; error?: string }> {
  const { data, error } = await admin
    .from('viaje')
    .update({ recordatorio_comprobacion_en: ahora })
    .eq('id', v.id)
    .eq('tenant_id', v.tenantId)
    .is('recordatorio_comprobacion_en', null)
    .select('id');

  if (error) {
    logger.warn('recordatorio_comprobacion.claim_sin_guardar', { viaje: v.id, err: error.message });
    return { ganado: false, error: error.message };
  }
  return { ganado: (data ?? []).length > 0 };
}
