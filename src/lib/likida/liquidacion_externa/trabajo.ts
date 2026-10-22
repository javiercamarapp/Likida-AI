// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — la lista de trabajo del cron.
//
// Vive aparte de `repo.ts` por una razón concreta: es la ÚNICA consulta de este
// módulo que cruza flotas, a propósito. El cron barre a todas en una pasada
// (igual que `wa-outbox`), y la prueba de aislamiento
// (`consultas_admin_filtran_tenant.test.ts`) exige que un archivo que cruza
// tenants lo declare. Mantenerla en su propio archivo permite exentar SOLO a
// esta consulta, y que `repo.ts` —que atiende a una flota por llamada— siga
// vigilado entero.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir } from '../pg';
import { COLUMNAS, aLiquidacionExterna, aAvisoDiscrepancia, type Fila, type LiquidacionExterna, type AvisoDiscrepancia } from './repo';

/** Las flotas con `canal='correo'` (0785). Sin la tabla (base sin esa migración): ninguna, y todo sigue por WhatsApp como antes.
 *  Cualquier otro error LANZA: leerlo como «ninguna» mandaría por WhatsApp lo que la flota pidió por correo. */
async function tenantsSoloCorreo(): Promise<string[]> {
  // orden-no-importa: la tabla tiene una fila por flota (llave tenant_id) y se lee completa para repartir por canal
  const res = await acotada(supabaseAdmin().from('liquidacion_correo_config')
    .select('tenant_id, canal').or('canal.eq.correo').limit(1000), 'liqext.trabajo_canal');
  if (res.error) {
    if (res.error.code === '42P01' || res.error.code === 'PGRST205' || /does not exist|schema cache/i.test(res.error.message ?? '')) return [];
    throw new Error(`liqext.trabajo_canal: ${res.error.message}`);
  }
  return ((res.data ?? []) as unknown as Array<{ tenant_id: string; canal: string }>)
    .filter((r) => r.canal === 'correo' && /^[0-9a-f-]{36}$/i.test(String(r.tenant_id))).map((r) => r.tenant_id);
}

/** Las que el cron tiene que mover: pendientes cuyo reintento ya toca y las que
 *  esperan al outbox. Acotado a un lote: lo demás es de la siguiente pasada.
 *  Cada fila trae su `tenant_id`, y todo lo que se haga con ella después va
 *  acotado a ESE tenant. */
export async function trabajoPendiente(limite: number, ahoraIso: string): Promise<LiquidacionExterna[]> {
  const soloCorreo = await tenantsSoloCorreo();
  let consulta = supabaseAdmin().from('liquidacion_externa')
    .select(COLUMNAS)
    .or(`estado.eq.en_cola,and(estado.eq.pendiente,proximo_intento_en.lte.${ahoraIso})`);
  // Gate por canal: las flotas que reciben el desglose por correo no entran al lote de WhatsApp. `ambos` y sin config, sí.
  if (soloCorreo.length > 0) consulta = consulta.not('tenant_id', 'in', `(${soloCorreo.join(',')})`);
  const res = await acotada(consulta.order('proximo_intento_en', { ascending: true }).order('id').limit(limite), 'liqext.trabajo');
  return ((exigir(res, 'liqext.trabajo') ?? []) as unknown as Fila[]).map(aLiquidacionExterna);
}

// ── HUÉRFANAS DE CORREO (hallazgo MEDIO, oct-2026) ──────────────────────────
//
// Si una liquidación de una flota con canal de entrega `correo` entra por el
// endpoint GENERAL (`POST /v1/liquidaciones-externas`, `recibirLiquidacionExterna`)
// en vez de `/desgloses`, `canalDeEntregaPorOmision` fuerza el canal a `correo`
// (fail-safe) y por lo tanto `intentarEntrega` NUNCA manda por WhatsApp — pero
// ninguna fila nace en `liquidacion_entrega_correo` (esa tabla SOLO la llenan
// `desglose_recibir.ts`, `liberar_envio.ts` y `reenvio_correo.ts`, las tres del
// camino `/desgloses`). La liquidación queda `pendiente` para siempre, sin
// alerta y sin forma de que una persona se entere.
//
// Esta consulta cruza flotas a propósito (igual que `trabajoPendiente`, arriba):
// barre TODAS las `pendiente` más viejas que el umbral y descarta las que SÍ
// tienen un encabezado de desglose (`liquidacion_desglose`) — esas vinieron por
// `/desgloses` y, si siguen sin entregas, es porque alguien las retuvo a
// propósito (neto negativo, tipo sin regla…) y ya son visibles en el panel
// como «retenidas». Lo que sobra son candidatas: `servicio.ts` todavía filtra
// por el CANAL REAL de cada tenant (perfil + config), porque esta tabla no lo sabe.

export interface CandidataHuerfanaCorreo { id: string; tenantId: string; claveExterna: string; creadaEn: string }

/** `pendiente`, creadas antes de `antesIso`, sin fila en `liquidacion_desglose`. Acotado a un lote.
 *  LANZA ante un error de lectura real: una candidata huérfana no detectada por un fallo silencioso es justo el
 *  modo de falla que esta consulta existe para cerrar. Sin la migración 0786 (tabla `liquidacion_desglose` ausente):
 *  NINGUNA liquidación pudo venir por `/desgloses`, así que todas las `pendiente` viejas son candidatas. */
export async function candidatasHuerfanaCorreo(limite: number, antesIso: string): Promise<CandidataHuerfanaCorreo[]> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa')
    .select('id, tenant_id, clave_externa, created_at')
    .eq('estado', 'pendiente').lte('created_at', antesIso)
    .order('created_at', { ascending: true }).order('id').limit(limite), 'liqext.huerfanas_candidatas');
  const filas = (exigir(res, 'liqext.huerfanas_candidatas') ?? []) as unknown as
    Array<{ id: string; tenant_id: string; clave_externa: string; created_at: string }>;
  if (filas.length === 0) return [];

  const ids = filas.map((f) => f.id);
  const desg = await acotada(supabaseAdmin().from('liquidacion_desglose')
    .select('liquidacion_externa_id').in('liquidacion_externa_id', ids), 'liqext.huerfanas_desgloses');
  let conDesglose = new Set<string>();
  if (desg.error) {
    const ausente = desg.error.code === '42P01' || desg.error.code === 'PGRST205'
      || /does not exist|schema cache/i.test(desg.error.message ?? '');
    if (!ausente) throw new Error(`liqext.huerfanas_desgloses: ${desg.error.message}`);
    // Tabla ausente ⇒ ninguna liquidación tiene desglose: todas las `pendiente` viejas quedan como candidatas.
  } else {
    conDesglose = new Set((desg.data ?? []).map((d) => String((d as { liquidacion_externa_id: unknown }).liquidacion_externa_id)));
  }
  return filas.filter((f) => !conDesglose.has(f.id))
    .map((f) => ({ id: f.id, tenantId: f.tenant_id, claveExterna: f.clave_externa, creadaEn: f.created_at }));
}

/** Los avisos de discrepancia que el cron tiene que mover (0643): pendientes cuyo reintento ya toca y los que quedaron
 *  `enviando` con el arriendo vencido (el proceso que los mandaba murió). Acotado a un lote. Sin la tabla (base sin 0643): nada. */
export async function avisosPendientes(limite: number, ahoraIso: string): Promise<AvisoDiscrepancia[]> {
  const res = await acotada(supabaseAdmin().from('liquidacion_aviso_discrepancia')
    .select('liquidacion_externa_id, tenant_id, ciclo, estado, intentos, proximo_intento_en, ultimo_error, telefonos_aceptados, tarea_id, enviado_en')
    .or(`and(estado.eq.pendiente,proximo_intento_en.lte.${ahoraIso}),and(estado.eq.enviando,claim_expira_en.lte.${ahoraIso})`)
    .order('proximo_intento_en', { ascending: true }).order('liquidacion_externa_id').order('ciclo').limit(limite), 'liqext.avisos_trabajo');
  if (res.error) {
    if (res.error.code === '42P01' || res.error.code === 'PGRST205' || /does not exist|schema cache/i.test(res.error.message ?? '')) return [];
    throw new Error(`liqext.avisos_trabajo: ${res.error.message}`);
  }
  return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map(aAvisoDiscrepancia);
}
