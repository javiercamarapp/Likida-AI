import { logger } from '@/lib/logger';
import { redactarActor, redactarDetalle, type RedEvento } from './evento_red';

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
  | 'api_v1' | 'chat' | 'ratelimit' | 'auth' | 'otro'
  // 0954:
  | 'export';

export type TipoSeguridad =
  | 'firma_invalida' | 'intent_invalido' | 'step_up_rechazado' | 'rate_limit'
  | 'inyeccion_prompt' | 'acceso_denegado' | 'cifra_sin_respaldo'
  | 'payload_excesivo' | 'otro'
  // 0954:
  | 'login_fallido' | 'llave_invalida' | 'api_negada' | 'exporte_dinero' | 'cambio_rol'
  // 0971:
  | 'pagina_negada' | 'mfa_fallido';

/** Los tipos y orígenes que nacen en la 0954 (y, para `pagina_negada` y `mfa_fallido`, en la 0971): contra una base sin migrar rebotan por el check y se degradan a `otro`. */
const TIPOS_0954: ReadonlySet<string> = new Set(['login_fallido', 'llave_invalida', 'api_negada', 'exporte_dinero', 'cambio_rol', 'pagina_negada', 'mfa_fallido']);
const ORIGENES_0954: ReadonlySet<string> = new Set(['export']);

export interface EventoSeguridad {
  origen: OrigenSeguridad;
  tipo: TipoSeguridad;
  severidad?: 'info' | 'media' | 'alta';
  tenantId?: string | null;
  /** Quién — userId, teléfono, prefijo de llave… JAMÁS un secreto completo. */
  actor?: string | null;
  detalle?: Record<string, unknown>;
  /** Huella de red y user-agent (0954/0955). Ver `redDeCabeceras`. */
  red?: RedEvento;
}

/**
 * FLOOD (0681, auditoría ola 1 #20): el registro pasa por la RPC `registrar_evento_seguridad`, que AGRUPA
 * por ventana (misma señal = una fila con `repeticiones`) y acota las filas distintas por (origen, tipo,
 * severidad); el excedente se cuenta en una fila de desborde. Lo `alta` jamás se descarta: se agrupa o se
 * cuenta. Si la base aún no trae la 0681 (rollout con código adelante), cae al insert directo de siempre.
 */
export async function registrarEventoSeguridad(ev: EventoSeguridad): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const sb = supabaseAdmin();
    const severidad = ev.severidad ?? 'media';
    const actor = redactarActor(ev.actor);
    const detalle = redactarDetalle(ev.detalle) ?? null;
    const base = {
      p_origen: ev.origen as string,
      p_tipo: ev.tipo as string,
      p_severidad: severidad,
      p_tenant: ev.tenantId ?? null,
      p_actor: actor,
      p_detalle: detalle as Record<string, unknown> | null,
    };
    const conRed = !!(ev.red && (ev.red.ipHash || ev.red.ua));

    // 0955: con huella/ua se intenta primero el registro con red. Sin la función cae al registro de siempre (sin red).
    let r: { error: { message: string; code?: string } | null } | null = null;
    if (conRed) {
      r = await sb.rpc('registrar_evento_seguridad_red', { ...base, p_ip_hash: ev.red!.ipHash, p_ua: ev.red!.ua });
      if (!r.error) return;
      if (!rpcAusente(r.error, 'registrar_evento_seguridad_red')) return rebote(ev, r.error);
    }
    r = await sb.rpc('registrar_evento_seguridad', base);
    if (!r.error) return;
    if (!rpcAusente(r.error, 'registrar_evento_seguridad')) return rebote(ev, r.error);

    const { error } = await sb.from('evento_seguridad').insert({
      origen: ev.origen,
      tipo: ev.tipo,
      severidad,
      tenant_id: ev.tenantId ?? null,
      actor,
      detalle,
    });
    if (error) await rebote(ev, error);
  } catch (e) {
    logger.warn('seguridad.registro_fallo', { tipo: ev.tipo, err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Un registro rechazado. Si el rechazo es el check de la 0133 porque la base aún no trae la 0954 (tipo/origen nuevo), el evento NO se
 * pierde: se registra como `otro` con el tipo real en el detalle. Cualquier otro rechazo (o un tipo viejo) se dice en el log y no
 * se reintenta: no se esquiva el tope ni el check.
 */
async function rebote(ev: EventoSeguridad, e: { message: string; code?: string }): Promise<void> {
  const esCheck = e.code === '23514' || /check constraint|evento_seguridad_(tipo|origen)_check/i.test(e.message);
  if (esCheck && (TIPOS_0954.has(ev.tipo) || ORIGENES_0954.has(ev.origen))) {
    try {
      const { supabaseAdmin } = await import('@/lib/supabase/admin');
      const r = await supabaseAdmin().rpc('registrar_evento_seguridad', {
        p_origen: 'otro',
        p_tipo: 'otro',
        p_severidad: ev.severidad ?? 'media',
        p_tenant: ev.tenantId ?? null,
        p_actor: redactarActor(ev.actor),
        p_detalle: { ...(redactarDetalle(ev.detalle) ?? {}), tipo_real: ev.tipo, origen_real: ev.origen },
      });
      if (!r.error) return;
      logger.warn('seguridad.registro_fallo', { tipo: ev.tipo, err: r.error.message });
      return;
    } catch (e2) {
      logger.warn('seguridad.registro_fallo', { tipo: ev.tipo, err: e2 instanceof Error ? e2.message : String(e2) });
      return;
    }
  }
  logger.warn('seguridad.registro_fallo', { tipo: ev.tipo, err: e.message });
}

/** ¿La RPC no existe todavía en la base (0681 sin aplicar)? PostgREST: PGRST202; Postgres: 42883. */
function rpcAusente(e: { message?: string; code?: string }, nombre: string): boolean {
  return e.code === 'PGRST202' || e.code === '42883' || (e.message ?? '').includes(nombre) && /could not find|does not exist|no existe/i.test(e.message ?? '');
}

export interface FilaSeguridad {
  id: string; origen: string; tipo: string; severidad: string;
  tenantId: string | null; actor: string | null;
  detalle: Record<string, unknown> | null; creadoEn: string;
  /** Cuántas veces se vio la misma señal en la ventana (0681). 1 = una sola. */
  repeticiones: number;
}

export interface ResumenSeguridad {
  /** Total histórico EXACTO — es la M de «mostrando N de M» del panel. */
  total: number;
  /** Conteos de los últimos 30 días, por severidad. Medidos en la base
   *  (count exacto con head), jamás contando una rebanada traída al server. */
  d30: { alta: number; media: number; info: number };
}

/** Los conteos del panel de Trust & Safety. LANZA en error — un panel de
 *  seguridad que no puede leer su tabla tiene que decirlo, no pintar ceros
 *  (tableros al día, 28-ago-2026: cero medido y «no se pudo medir» son
 *  afirmaciones opuestas). */
export async function resumenEventosSeguridad(ahora: Date = new Date()): Promise<ResumenSeguridad> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const desde30 = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const exigir = (r: { count: number | null; error: { message: string } | null }, cual: string): number => {
    if (r.error || typeof r.count !== 'number') {
      throw new Error(`resumenEventosSeguridad(${cual}): ${r.error?.message ?? 'sin count'}`);
    }
    return r.count;
  };
  const base = () => supabaseAdmin().from('evento_seguridad').select('id', { count: 'exact', head: true });
  const [rTotal, rAlta, rMedia, rInfo] = await Promise.all([
    base(),
    base().eq('severidad', 'alta').gte('creado_en', desde30),
    base().eq('severidad', 'media').gte('creado_en', desde30),
    base().eq('severidad', 'info').gte('creado_en', desde30),
  ]);
  return {
    total: exigir(rTotal, 'total'),
    d30: { alta: exigir(rAlta, 'alta'), media: exigir(rMedia, 'media'), info: exigir(rInfo, 'info') },
  };
}

/** Los últimos eventos, para el panel. LANZA en error (el panel enseña su
 *  estado de fallo — cero eventos ≠ no se pudo leer). */
export async function getEventosSeguridad(limite = 50): Promise<FilaSeguridad[]> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const { data, error } = await supabaseAdmin()
    .from('evento_seguridad')
    // `*` y no la lista: `repeticiones` nace en la 0681 y el panel no debe caer en un rollout con código adelante.
    .select('*')
    .order('creado_en', { ascending: false })
    .limit(limite);
  if (error) throw new Error(`getEventosSeguridad: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id, origen: f.origen, tipo: f.tipo, severidad: f.severidad,
    tenantId: f.tenant_id, actor: f.actor, detalle: f.detalle, creadoEn: f.creado_en,
    repeticiones: typeof f.repeticiones === 'number' && f.repeticiones >= 1 ? f.repeticiones : 1,
  }));
}
