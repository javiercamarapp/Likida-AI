import type { OrigenSeguridad, TipoSeguridad } from './eventos';

// ═══════════════════════════════════════════════════════════════════════════
// LA COBERTURA REAL DE evento_seguridad (CT-SEG-11).
//
// /admin/trust-safety decía «los detectores están cableados, el silencio aquí es bueno de verdad» sin que nadie midiera qué
// fuentes escriben y cuáles no. Este registro es la declaración explícita, fuente por fuente, de QUÉ emite y QUÉ no; el panel la
// pinta con los conteos medidos en la base, y `cobertura.test.ts` la ata al código (una fuente declarada «emite» debe tener un
// emisor real en el árbol; una «no emite» no debe tenerlo: si alguien la cablea, la prueba obliga a actualizar este registro).
//
// `par` es el (origen, tipo) con que la fuente escribe en la tabla; null = la fuente no existe como evento, solo se declara que falta.
// ═══════════════════════════════════════════════════════════════════════════

export interface FuenteSeguridad {
  id: string;
  titulo: string;
  par: { origen: OrigenSeguridad; tipo: TipoSeguridad } | null;
  emite: boolean;
  /** Dónde vive el emisor (archivo) o, si no emite, qué falta. */
  donde: string;
}

export const FUENTES_SEGURIDAD: readonly FuenteSeguridad[] = [
  // ── Las que emiten ───────────────────────────────────────────────────────
  { id: 'wa_firma', titulo: 'Webhook de WhatsApp: firma inválida', par: { origen: 'wa_webhook', tipo: 'firma_invalida' }, emite: true, donde: 'src/app/api/webhook/whatsapp/route.ts' },
  { id: 'stripe_firma', titulo: 'Webhook de Stripe: firma inválida', par: { origen: 'stripe_webhook', tipo: 'firma_invalida' }, emite: true, donde: 'src/app/api/stripe/webhook/route.ts' },
  { id: 'stripe_anomalo', titulo: 'Webhook de Stripe: evento anómalo', par: { origen: 'stripe_webhook', tipo: 'otro' }, emite: true, donde: 'src/app/api/stripe/webhook/route.ts' },
  { id: 'copiloto_step_up', titulo: 'Copiloto: paso de confirmación rechazado', par: { origen: 'copiloto', tipo: 'step_up_rechazado' }, emite: true, donde: 'src/app/api/admin/copiloto/route.ts' },
  { id: 'copiloto_intent', titulo: 'Copiloto: intent inválido', par: { origen: 'copiloto', tipo: 'intent_invalido' }, emite: true, donde: 'src/app/api/admin/copiloto/route.ts' },
  { id: 'cuadre_cifra', titulo: 'Agente de Cuadre: cifra sin respaldo', par: { origen: 'chat', tipo: 'cifra_sin_respaldo' }, emite: true, donde: 'src/lib/likida/cuadre/guardia.ts' },
  { id: 'worker_llaves', titulo: 'Worker: llave ausente o inválida', par: { origen: 'auth', tipo: 'acceso_denegado' }, emite: true, donde: 'src/lib/worker/llaves.ts' },
  { id: 'mcp_denegado', titulo: 'Servidor MCP: acceso denegado', par: { origen: 'otro', tipo: 'acceso_denegado' }, emite: true, donde: 'src/app/api/mcp/route.ts' },
  { id: 'mcp_payload', titulo: 'Servidor MCP: payload excesivo', par: { origen: 'otro', tipo: 'payload_excesivo' }, emite: true, donde: 'src/app/api/mcp/route.ts' },
  { id: 'wa_admin_denegado', titulo: 'Comandos de admin por WhatsApp: remitente no autorizado', par: { origen: 'wa_webhook', tipo: 'acceso_denegado' }, emite: true, donde: 'src/lib/likida/admin_comandos_wa.ts' },
  // CT-SEG-11 (0954/0955):
  { id: 'login_fallido', titulo: 'Login fallido: límite por IP o por cuenta, error de Google, enlace que no abrió sesión', par: { origen: 'auth', tipo: 'login_fallido' }, emite: true, donde: 'src/app/login/page.tsx y src/app/auth/callback/route.ts (vía registro_acceso.ts)' },
  { id: 'llave_invalida', titulo: 'API v1: llave que no abre (401)', par: { origen: 'api_v1', tipo: 'llave_invalida' }, emite: true, donde: 'src/app/api/v1/_comun.ts (vía registro_acceso.ts)' },
  { id: 'api_negada', titulo: 'API negada por el perfil de la flota o por el área de la llave/rol', par: { origen: 'api_v1', tipo: 'api_negada' }, emite: true, donde: 'src/lib/auth/perfil_tenant.ts y src/app/api/v1/_comun.ts' },
  { id: 'exporte_dinero', titulo: 'Exporte de dinero autorizado (liquidaciones, póliza, facturas de proveedor, peajes)', par: { origen: 'export', tipo: 'exporte_dinero' }, emite: true, donde: 'src/lib/auth/tenant-api.ts (puerta común de /api/export; se anota al autorizar, no al terminar)' },
  { id: 'cambio_rol', titulo: 'Cambio de rol de un usuario del equipo', par: { origen: 'auth', tipo: 'cambio_rol' }, emite: true, donde: 'src/lib/auth/usuarios_escritura.ts' },

  // ── Las que NO emiten (y se dice) ─────────────────────────────────────────
  { id: 'correo_firma', titulo: 'Webhook de correo entrante: firma inválida', par: { origen: 'correo_webhook', tipo: 'firma_invalida' }, emite: false, donde: 'El tipo existe en la tabla pero ningún webhook de correo lo escribe.' },
  { id: 'rate_limit', titulo: 'Rate limits que bloquean (excepto el de /login)', par: { origen: 'ratelimit', tipo: 'rate_limit' }, emite: false, donde: 'src/lib/ratelimit.ts bloquea y no registra; el 429 de /v1 y de las demás rutas no deja evento.' },
  { id: 'inyeccion_prompt', titulo: 'Inyección de prompt detectada', par: { origen: 'chat', tipo: 'inyeccion_prompt' }, emite: false, donde: 'No hay detector que escriba este tipo: la mitigación vive en el prompt del Agente de Cuadre y en la guardia de cifras.' },
  { id: 'lectura_datos_personales', titulo: 'Lectura y exporte de datos personales (ARCO, conversaciones, "ver como" de superadmin)', par: null, emite: false, donde: 'Sin registro de acceso a datos personales (MX-013): solo se registran los exportes de dinero.' },
  { id: 'denegacion_de_pagina', titulo: 'Páginas del panel negadas por rol o perfil', par: null, emite: false, donde: 'src/lib/auth/guard.ts redirige sin registrar; solo las APIs (api_negada) dejan evento.' },
  { id: 'mfa_fallido', titulo: 'Segundo factor fallido o saltado', par: null, emite: false, donde: 'src/lib/auth/mfa.ts decide pero no registra.' },
  { id: 'mutaciones_sin_actor', titulo: 'Mutaciones de panel sin bitácora ni actor (MX-012)', par: null, emite: false, donde: 'Varias server actions escriben sin anotar quién; evento_seguridad no las cubre.' },
];

export interface CoberturaFuente extends FuenteSeguridad {
  /** Filas (señales ya agrupadas, no intentos) de los últimos 30 días; null si la fuente no tiene par. */
  filas30d: number | null;
}

/**
 * Los conteos de cobertura medidos en la base (count exacto con head, por par origen/tipo, 30 días). LANZA si la base falla:
 * un cero inventado sería una cobertura falsa.
 */
export async function coberturaEventosSeguridad(ahora: Date = new Date()): Promise<CoberturaFuente[]> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const desde = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return Promise.all(FUENTES_SEGURIDAD.map(async (f): Promise<CoberturaFuente> => {
    if (!f.par) return { ...f, filas30d: null };
    const r = await supabaseAdmin().from('evento_seguridad').select('id', { count: 'exact', head: true })
      .eq('origen', f.par.origen).eq('tipo', f.par.tipo).gte('creado_en', desde);
    if (r.error || typeof r.count !== 'number') throw new Error(`coberturaEventosSeguridad(${f.id}): ${r.error?.message ?? 'sin count'}`);
    return { ...f, filas30d: r.count };
  }));
}
