import type { SupabaseClient } from '@supabase/supabase-js';
import { estadoMfa, type VeredictoMfaSuperadmin } from './mfa';

// ═══════════════════════════════════════════════════════════════════════════
// TOTP ESCALONADO PARA ACCIONES DE RIESGO — F9, CT-SEG-05 / CT-ENT-01.
//
// DECISIÓN PENDIENTE DE JAVIER: D8 («TOTP para dueño y contador», fila 10 de
// TAREAS-JAVIER.md). Hasta que la apruebe, TODO este módulo está APAGADO por
// omisión: con la palanca apagada no hace ninguna llamada a Supabase y ninguna
// acción cambia de comportamiento (la política incremental de `mfa.ts` sigue
// siendo la única vigente). Se enciende con `LIKIDA_TOTP_ESCALONADO=obligatorio`.
//
// QUÉ HACE ENCENDIDO. Para el dueño (`flota_admin`) y el contador:
//   · las cuatro acciones de riesgo —emitir CFDI, llaves de API, cambio de
//     roles y exportes de dinero— exigen: factor TOTP inscrito, sesión en AAL2
//     y que ese AAL2 sea RECIENTE (tope de sesión);
//   · el panel entero (`requireSessionTenant`) exige lo mismo con el mismo
//     tope, salvo Mi perfil (donde se inscribe/verifica el factor).
// El tope vive en `LIKIDA_MFA_TOPE_SESION_MIN` (minutos; por omisión 720, el
// valor propuesto —12 h— es parte de la decisión D8, no un hecho). La cookie de
// sesión sigue durando 400 días: el tope no la acorta, obliga a REPETIR el
// código; con eso un robo de cookie caduca a las horas, no a los 400 días.
//
// POR QUÉ NO SE APOYA EN `exigirAal2SiHayFactor`: esa guarda es incremental
// («solo exige lo que ya optaste por tener»). Aquí, encendida la palanca, no
// tener factor TAMBIÉN bloquea: para eso es obligatorio.
//
// FALLAR CERRADO: si no se pudo preguntar (Supabase Auth caído), no pasa.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionRiesgo = 'emitir_cfdi' | 'llave_api' | 'cambio_rol' | 'exporte_dinero';

export const ACCIONES_RIESGO: readonly AccionRiesgo[] = ['emitir_cfdi', 'llave_api', 'cambio_rol', 'exporte_dinero'];

/** Roles a los que alcanza el escalonado. El superadmin tiene su propia puerta (`mfaSuperadminObligatorio`). */
const ROLES_ESCALONADOS: ReadonlySet<string> = new Set(['flota_admin', 'contador']);

export const TOPE_SESION_MIN_POR_OMISION = 720;
const TOPE_MIN = 15;
const TOPE_MAX = 1440;

/** ¿Está encendido el escalonado? Apagado por omisión (decisión D8 pendiente). */
export function totpEscalonadoActivo(env: Record<string, string | undefined> = process.env): boolean {
  return (env.LIKIDA_TOTP_ESCALONADO ?? '').trim().toLowerCase() === 'obligatorio';
}

/** Minutos que vale un AAL2 antes de pedir el código otra vez. Un valor ilegible cae a la omisión; se acota a 15–1440. */
export function topeSesionMfaMin(env: Record<string, string | undefined> = process.env): number {
  const crudo = Number((env.LIKIDA_MFA_TOPE_SESION_MIN ?? '').trim());
  if (!Number.isFinite(crudo) || crudo <= 0) return TOPE_SESION_MIN_POR_OMISION;
  return Math.min(TOPE_MAX, Math.max(TOPE_MIN, Math.round(crudo)));
}

export function rolConStepUp(rol: string | null | undefined): boolean {
  return !!rol && ROLES_ESCALONADOS.has(rol);
}

/**
 * Roles cuya ASIGNACIÓN (invitar con ese rol) es una escalada de privilegio: dueño y contador ven y mueven dinero. Un encargado o
 * `nomina` no. Cambiar el rol de alguien y reactivar una cuenta (que recupera el rol que tenía) exigen el paso sin mirar el rol.
 */
export function rolAsignableExigeStepUp(rolDestino: string | null | undefined): boolean {
  return rolDestino === 'flota_admin' || rolDestino === 'contador';
}

export interface InstantaneaMfa {
  legible: boolean;
  inscrito: boolean;
  aal: string | null;
  /** Epoch en segundos de la última verificación TOTP de esta sesión; null si no hay o no se pudo leer. */
  totpVerificadoEn: number | null;
}

/**
 * PURA. El veredicto de la sesión frente al escalonado. Reutiliza el vocabulario de `VeredictoMfaSuperadmin` para que Mi perfil
 * (`?exige=`) muestre lo que falta sin tablas nuevas de mensajes: `retar` cubre «falta el código» y «el código ya venció».
 */
export function veredictoEscalonado(
  i: InstantaneaMfa,
  ahoraMs: number,
  topeMin: number,
): VeredictoMfaSuperadmin {
  if (!i.legible) return 'no_verificable';
  if (!i.inscrito) return 'inscribir';
  if (i.aal !== 'aal2') return 'retar';
  // AAL2 sin marca de tiempo legible: no se puede probar que sea reciente. Cerrado.
  if (i.totpVerificadoEn === null) return 'retar';
  const edadMs = ahoraMs - i.totpVerificadoEn * 1000;
  // Un reloj adelantado del lado de Auth (marca futura) no es «reciente de sobra»: tolerancia de un minuto, más allá se cierra.
  if (edadMs < -60_000) return 'retar';
  return edadMs <= topeMin * 60_000 ? 'ok' : 'retar';
}

/** Lee la verificación TOTP más reciente de la sesión (`amr` del JWT, que Supabase expone en el nivel de aseguramiento). */
export async function leerInstantanea(sb: SupabaseClient): Promise<InstantaneaMfa> {
  const e = await estadoMfa(sb);
  let totpVerificadoEn: number | null = null;
  if (e.legible && e.aal === 'aal2') {
    try {
      const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      const metodos = (data as { currentAuthenticationMethods?: Array<{ method?: string; timestamp?: number }> } | null)
        ?.currentAuthenticationMethods ?? [];
      const marcas = metodos
        .filter((m) => m.method === 'totp' && typeof m.timestamp === 'number' && Number.isFinite(m.timestamp))
        .map((m) => m.timestamp as number);
      totpVerificadoEn = marcas.length > 0 ? Math.max(...marcas) : null;
    } catch {
      totpVerificadoEn = null;
    }
  }
  return { legible: e.legible, inscrito: e.inscrito, aal: e.aal, totpVerificadoEn };
}

export const MSG_STEP_UP_ESCALONADO: Record<AccionRiesgo, string> = {
  emitir_cfdi: 'Emitir o cancelar un CFDI exige tu segundo factor.',
  llave_api: 'Emitir o revocar llaves de API exige tu segundo factor.',
  cambio_rol: 'Cambiar roles del equipo exige tu segundo factor.',
  exporte_dinero: 'Descargar exportes de dinero exige tu segundo factor.',
};

const COLA: Record<Exclude<VeredictoMfaSuperadmin, 'ok'>, string> = {
  inscribir: ' Inscríbelo en Mi perfil → Seguridad y vuelve a intentarlo.',
  retar: ' Escribe el código de tu app en Mi perfil → Seguridad (la verificación vale unas horas) y vuelve a intentarlo.',
  no_verificable: ' No pude comprobarlo ahora (el servicio de autenticación no contestó); por seguridad no se ejecuta. Inténtalo en un minuto.',
};

export function mensajeStepUp(accion: AccionRiesgo, veredicto: Exclude<VeredictoMfaSuperadmin, 'ok'>): string {
  return MSG_STEP_UP_ESCALONADO[accion] + COLA[veredicto];
}

/**
 * Veredicto de la sesión actual para un rol. `ok` sin tocar Supabase cuando la palanca está apagada o el rol no está alcanzado.
 * `sbDe` se inyecta para las pruebas; en producción es el cliente de la cookie.
 */
export async function veredictoStepUp(
  rol: string | null | undefined,
  opts: { env?: Record<string, string | undefined>; ahoraMs?: number; sbDe?: () => Promise<SupabaseClient> } = {},
): Promise<VeredictoMfaSuperadmin> {
  const env = opts.env ?? process.env;
  if (!totpEscalonadoActivo(env) || !rolConStepUp(rol)) return 'ok';
  const sbDe = opts.sbDe ?? (async () => (await import('@/lib/supabase/server')).supabaseServer());
  let instantanea: InstantaneaMfa;
  try {
    instantanea = await leerInstantanea(await sbDe());
  } catch {
    return 'no_verificable';
  }
  return veredictoEscalonado(instantanea, opts.ahoraMs ?? Date.now(), topeSesionMfaMin(env));
}

/**
 * La guarda de una acción de riesgo: `null` si pasa, o el texto para la pantalla si no. Deja huella `step_up_rechazado`
 * (best-effort, sin esperar) para que el rechazo sea visible en Trust & Safety.
 */
export async function exigirStepUpAccion(
  rol: string | null | undefined,
  accion: AccionRiesgo,
  ctx: { tenantId?: string | null; userId?: string | null } = {},
  opts: Parameters<typeof veredictoStepUp>[1] = {},
): Promise<string | null> {
  const v = await veredictoStepUp(rol, opts);
  if (v === 'ok') return null;
  void (async () => {
    try {
      const { registrarEventoSeguridad } = await import('@/lib/seguridad/eventos');
      await registrarEventoSeguridad({
        origen: 'auth', tipo: 'step_up_rechazado', severidad: 'media',
        tenantId: ctx.tenantId ?? null, actor: ctx.userId ?? null,
        detalle: { accion, veredicto: v },
      });
    } catch { /* best-effort total */ }
  })();
  return mensajeStepUp(accion, v);
}
