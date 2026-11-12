/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DATOS DE LA SUITE DE AVISOS (avisos.nav.ts y avisos-movil.nav.ts).
 *
 * Una lista de avisos es un CÁLCULO en vivo sobre datos del negocio: sin una escalación, un ARCO pendiente o un comprobante huérfano no
 * hay nada que leer, y una suite que solo viera la lista vacía pasaría en vacío. Aquí se siembran, con la llave de servicio del Supabase
 * LOCAL (`exigirUrlLocal` rehúsa cualquier otro host), las condiciones reales que producen avisos, y se limpian al terminar para no
 * contaminar las demás suites (que corren después en la misma base).
 *
 *  · Flota Demo (A): un viaje escalado (VJ-2026-0001) y DOS comprobantes huérfanos → «escalados» y «huerfanos:2».
 *  · Flota E2E B (la intrusa): UN comprobante huérfano → «huerfanos:1». Que A vea «2» y B vea «1» es lo que prueba el aislamiento.
 *  · Consola: una solicitud ARCO pendiente (plazo legal, no se puede marcar leída), un ticket con el SLA vencido (tampoco) y una
 *    factura de proveedor por aprobar (esa sí).
 *
 * Las fuentes del servidor guardan 45 s de caché: quien lee tras sembrar espera con `expect.poll` (ver `esperarAviso`).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { entornoLocalE2E, fetchLocalE2E } from '../../scripts/ci/e2e/entorno-local.mjs';

export const TENANT_A = '11111111-1111-1111-1111-111111111111';
export const TENANT_B = '22222222-eeee-4eee-8eee-222222222222';
const VIAJE_ESCALABLE = '44444444-0000-0000-0000-000000000001';
const OPERADOR_A = '33333333-0000-0000-0000-000000000001';
const OPERADOR_B = 'eeeeeeee-0020-4000-8000-0000000000b1';
const HUERFANOS = {
  a1: 'eeeeeeee-0020-4000-8000-0000000000a1',
  a2: 'eeeeeeee-0020-4000-8000-0000000000a2',
  b1: 'eeeeeeee-0020-4000-8000-0000000000b2',
};
const ARCO = 'eeeeeeee-0020-4000-8000-0000000000c1';
const TICKET = 'eeeeeeee-0020-4000-8000-0000000000d1';
const FACTURA = 'eeeeeeee-0020-4000-8000-0000000000e1';

let cliente: SupabaseClient | null = null;

/** El cliente de servicio del Supabase local. Falla con nombre si falta la llave (la suite no puede sembrar sin ella). */
export function servicio(): SupabaseClient {
  if (cliente) return cliente;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!llave) throw new Error('avisos.nav: falta SUPABASE_SERVICE_ROLE_KEY (la suite siembra condiciones reales de aviso en el Supabase local).');
  cliente = createClient(entornoLocalE2E().supabase, llave, { auth: { persistSession: false }, global: { fetch: fetchLocalE2E } });
  return cliente;
}

function exigir(error: { message: string } | null, paso: string): void {
  if (error) throw new Error(`avisos.nav: falló «${paso}»: ${error.message}`);
}

/** El id de auth de una identidad sembrada. */
export async function usuarioId(correo: string): Promise<string> {
  const { data, error } = await servicio().from('app_user').select('id').eq('email', correo).maybeSingle();
  exigir(error, `leer app_user(${correo})`);
  if (!data) throw new Error(`avisos.nav: no existe ${correo} — ¿corrió sembrar-e2e.mjs?`);
  return (data as { id: string }).id;
}

/** Borra el estado «leído», las preferencias y el horario de UNA persona: cada prueba parte de cero. */
export async function reiniciarEstado(userId: string): Promise<void> {
  const db = servicio();
  for (const tabla of ['aviso_leido', 'aviso_preferencia', 'aviso_silencio']) {
    const { error } = await db.from(tabla).delete().eq('usuario_id', userId);
    exigir(error, `limpiar ${tabla}`);
  }
}

/** Lo que hay guardado de una persona (para afirmar la persistencia contra la base, no contra la pantalla). */
export async function leidasEnBase(userId: string): Promise<string[]> {
  const { data, error } = await servicio().from('aviso_leido').select('clave').eq('usuario_id', userId);
  exigir(error, 'leer aviso_leido');
  return ((data ?? []) as Array<{ clave: string }>).map((f) => f.clave).sort();
}

export async function preferenciasEnBase(userId: string): Promise<Array<{ categoria: string; canal: string; activo: boolean }>> {
  const { data, error } = await servicio().from('aviso_preferencia').select('categoria, canal, activo').eq('usuario_id', userId);
  exigir(error, 'leer aviso_preferencia');
  return (data ?? []) as Array<{ categoria: string; canal: string; activo: boolean }>;
}

export async function silencioEnBase(userId: string): Promise<{ activo: boolean; desde: string; hasta: string; permite_criticos: boolean } | null> {
  const { data, error } = await servicio().from('aviso_silencio').select('activo, desde, hasta, permite_criticos').eq('usuario_id', userId).maybeSingle();
  exigir(error, 'leer aviso_silencio');
  return (data as { activo: boolean; desde: string; hasta: string; permite_criticos: boolean } | null) ?? null;
}

/** Siembra las condiciones reales. Idempotente (ids fijos, upsert). */
export async function sembrarCondiciones(): Promise<void> {
  const db = servicio();
  const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString();

  // Flota A: un viaje que el agente escaló y nadie aceptó.
  exigir((await db.from('viaje').update({ escalado_en: hace(3), aceptado_en: null }).eq('id', VIAJE_ESCALABLE).eq('tenant_id', TENANT_A)).error, 'escalar VJ-2026-0001');

  // Flota B: su propio operador (los huérfanos cuelgan de un operador de SU flota).
  exigir((await db.from('operador').upsert({ id: OPERADOR_B, tenant_id: TENANT_B, nombre: 'Operador E2E B', telefono: '+520000000020' }, { onConflict: 'id' })).error, 'operador de la flota B');

  const huerfano = (id: string, tenant: string, operador: string, hash: string) => ({
    id, tenant_id: tenant, operador_id: operador, motivo: 'sin_viaje', resuelto_en: null, resolucion: null,
    gasto: { imgHash: hash, monto: 100, concepto: 'diesel' },
  });
  exigir((await db.from('comprobante_huerfano').upsert([
    huerfano(HUERFANOS.a1, TENANT_A, OPERADOR_A, 'e2e-avisos-a1'),
    huerfano(HUERFANOS.a2, TENANT_A, OPERADOR_A, 'e2e-avisos-a2'),
    huerfano(HUERFANOS.b1, TENANT_B, OPERADOR_B, 'e2e-avisos-b1'),
  ], { onConflict: 'id' })).error, 'comprobantes huérfanos');

  // Consola: ARCO pendiente (plazo legal) y un ticket con el SLA ya vencido.
  const vence = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  exigir((await db.from('solicitud_arco').upsert({ id: ARCO, tenant_id: TENANT_A, titular_ref: 'titular-e2e-avisos', tipo: 'acceso', estado: 'recibida', recibida_en: hace(48), vence_en: vence }, { onConflict: 'id' })).error, 'solicitud ARCO');
  exigir((await db.from('ticket_soporte').upsert({
    id: TICKET, tenant_id: TENANT_A, asunto: 'Ticket E2E con SLA vencido', categoria: 'otro', prioridad: 'alta', estado: 'abierto',
    sla_horas: 24, abierto_en: hace(120), vence_en: hace(96),
  }, { onConflict: 'id' })).error, 'ticket vencido');
  // Una factura de proveedor por aprobar: aviso de «escalaciones» que SÍ se puede marcar como leído (el ARCO, no).
  exigir((await db.from('factura_proveedor').upsert({ id: FACTURA, tenant_id: TENANT_A, cfdi_uuid: 'e2e-avisos-0001', total: 1160, xml_crudo: '<x/>', estado: 'pendiente' }, { onConflict: 'id' })).error, 'factura de proveedor');
}

/** Quita lo sembrado y deja el viaje como estaba. */
export async function limpiarCondiciones(): Promise<void> {
  const db = servicio();
  exigir((await db.from('viaje').update({ escalado_en: null }).eq('id', VIAJE_ESCALABLE)).error, 'desescalar VJ-2026-0001');
  exigir((await db.from('comprobante_huerfano').delete().in('id', Object.values(HUERFANOS))).error, 'borrar huérfanos');
  exigir((await db.from('operador').delete().eq('id', OPERADOR_B)).error, 'borrar operador B');
  exigir((await db.from('solicitud_arco').delete().eq('id', ARCO)).error, 'borrar ARCO');
  exigir((await db.from('ticket_soporte').delete().eq('id', TICKET)).error, 'borrar ticket');
  exigir((await db.from('factura_proveedor').delete().eq('id', FACTURA)).error, 'borrar factura');
}

/** La versión de interfaz de la flota A: la suite necesita v2 (el pie «Avisos» y los estilos de la lista solo existen ahí). Devuelve la anterior. */
export async function fijarVersionUi(tenant: string, version: 'v1' | 'v2'): Promise<'v1' | 'v2' | null> {
  const db = servicio();
  const { data, error } = await db.from('tenant_ui').select('version').eq('tenant_id', tenant).maybeSingle();
  exigir(error, 'leer tenant_ui');
  exigir((await db.from('tenant_ui').upsert({ tenant_id: tenant, version }, { onConflict: 'tenant_id' })).error, 'fijar tenant_ui');
  return ((data as { version?: 'v1' | 'v2' } | null)?.version) ?? null;
}
