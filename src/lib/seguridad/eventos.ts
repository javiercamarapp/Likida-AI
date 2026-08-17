import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// TRUST & SAFETY (0133) — el registro consultable de los detectores.
//
// REGLA ÚNICA: registrar es BEST-EFFORT TOTAL. Este módulo vigila caminos de
// seguridad (webhooks, intents, guardias) y un fallo suyo jamás puede tumbar
// lo vigilado — atrapa TODO, incluida la construcción del cliente, y lo dice
// en el log. Por eso también importa supabase adentro y no arriba.
// ═══════════════════════════════════════════════════════════════════════════

export type OrigenSeguridad =
  | 'wa_webhook' | 'stripe_webhook' | 'correo_webhook' | 'copiloto'
  | 'api_v1' | 'chat' | 'ratelimit' | 'auth' | 'otro';

export type TipoSeguridad =
  | 'firma_invalida' | 'intent_invalido' | 'step_up_rechazado' | 'rate_limit'
  | 'inyeccion_prompt' | 'acceso_denegado' | 'cifra_sin_respaldo'
  | 'payload_excesivo' | 'otro';

export interface EventoSeguridad {
  origen: OrigenSeguridad;
  tipo: TipoSeguridad;
  severidad?: 'info' | 'media' | 'alta';
  tenantId?: string | null;
  /** Quién — userId, teléfono, prefijo de llave… JAMÁS un secreto completo. */
  actor?: string | null;
  detalle?: Record<string, unknown>;
}

export async function registrarEventoSeguridad(ev: EventoSeguridad): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const { error } = await supabaseAdmin().from('evento_seguridad').insert({
      origen: ev.origen,
      tipo: ev.tipo,
      severidad: ev.severidad ?? 'media',
      tenant_id: ev.tenantId ?? null,
      actor: ev.actor?.slice(0, 120) ?? null,
      detalle: ev.detalle ?? null,
    });
    if (error) logger.warn('seguridad.registro_fallo', { tipo: ev.tipo, err: error.message });
  } catch (e) {
    logger.warn('seguridad.registro_fallo', { tipo: ev.tipo, err: e instanceof Error ? e.message : String(e) });
  }
}

export interface FilaSeguridad {
  id: string; origen: string; tipo: string; severidad: string;
  tenantId: string | null; actor: string | null;
  detalle: Record<string, unknown> | null; creadoEn: string;
}

/** Los últimos eventos, para el panel. LANZA en error (el panel enseña su
 *  estado de fallo — cero eventos ≠ no se pudo leer). */
export async function getEventosSeguridad(limite = 50): Promise<FilaSeguridad[]> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const { data, error } = await supabaseAdmin()
    .from('evento_seguridad')
    .select('id, origen, tipo, severidad, tenant_id, actor, detalle, creado_en')
    .order('creado_en', { ascending: false })
    .limit(limite);
  if (error) throw new Error(`getEventosSeguridad: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id, origen: f.origen, tipo: f.tipo, severidad: f.severidad,
    tenantId: f.tenant_id, actor: f.actor, detalle: f.detalle, creadoEn: f.creado_en,
  }));
}
