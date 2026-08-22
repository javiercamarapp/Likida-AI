import type { SupabaseClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════════════════════════
// MFA (TOTP) + STEP-UP — fase 7 enterprise (17-ago-2026).
//
// Supabase Auth trae TOTP nativo y funciona server-side con la sesión de la
// cookie (supabaseServer) — cero JS de cliente, mismo patrón de server
// actions del resto del panel. El login sigue siendo magic link (decisión
// 4-ago, NO se reabre): el magic link te deja en AAL1, y el factor sube la
// SESIÓN a AAL2 cuando una acción sensible lo exige.
//
// LA POLÍTICA DE STEP-UP (incremental y honesta):
//  · usuario SIN factor inscrito → las acciones 'doble' pasan como hoy (no
//    se puede exigir lo que no existe), y el panel lo invita a inscribirlo.
//  · usuario CON factor verificado → las acciones 'doble' EXIGEN AAL2: si la
//    sesión sigue en AAL1, se rechaza con la instrucción de verificar el
//    código en Mi perfil. Inscribir el factor es OPTAR por la protección.
// ═══════════════════════════════════════════════════════════════════════════

export interface EstadoMfa {
  /** ¿Se PUDO preguntar? `false` = Supabase no contestó la lista de factores
   *  o el AAL: no se sabe si tiene factor, y "no sé" NO es "no tiene". */
  legible: boolean;
  /** ¿Tiene al menos un factor TOTP VERIFICADO? (`false` también cuando no
   *  fue legible — mira `legible` antes de tratarlo como "sin inscribir"). */
  inscrito: boolean;
  /** El id del factor verificado (para retar) o null. */
  factorId: string | null;
  /** AAL actual de la sesión ('aal1' | 'aal2') — null si no se pudo leer. */
  aal: string | null;
  /** Factores sin verificar que estorban un enroll nuevo. */
  sinVerificar: string[];
}

export async function estadoMfa(sb: SupabaseClient): Promise<EstadoMfa> {
  let factores: Awaited<ReturnType<typeof sb.auth.mfa.listFactors>> | null = null;
  let nivel: Awaited<ReturnType<typeof sb.auth.mfa.getAuthenticatorAssuranceLevel>> | null = null;
  try {
    [factores, nivel] = await Promise.all([
      sb.auth.mfa.listFactors(),
      sb.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
  } catch {
    // Un reventón del SDK es tan "no sé" como un `error` por valor.
  }
  // AUDITORÍA 18, B14: aquí decía «fallar cerrado hacia "sin inscribir"» y
  // hacía lo contrario — `factores.data?.totp ?? []` convertía un
  // `listFactors()` con error en "no tiene factores", y la guarda de abajo
  // dejaba pasar una acción 'doble' sin AAL2 mientras /auth/v1/factors
  // estuviera caído dos segundos. "¿Tiene factor?" y "¿pude preguntarlo?" son
  // dos preguntas; la segunda viaja en `legible`.
  const legible = !!factores && !factores.error && !!factores.data && !!nivel && !nivel.error && !!nivel.data;
  const totp = legible ? (factores!.data!.totp ?? []) : [];
  const verificado = totp.find((f) => f.status === 'verified') ?? null;
  return {
    legible,
    inscrito: verificado !== null,
    factorId: verificado?.id ?? null,
    aal: nivel?.data?.currentLevel ?? null,
    sinVerificar: totp.filter((f) => f.status !== 'verified').map((f) => f.id),
  };
}

export type VeredictoStepUp =
  | { ok: true }
  /** Tiene factor y la sesión sigue en AAL1: hay que verificar el código. */
  | { ok: false; motivo: 'verificar' }
  /** No se pudo saber si tiene factor: se rechaza (fallar CERRADO). */
  | { ok: false; motivo: 'no_verificable' };

/**
 * La guarda de las acciones 'doble' (y de lo que el futuro quiera proteger).
 * Solo exige lo que el usuario ya optó por tener — ver la política de arriba.
 * Y si no pudo saber qué optó, NO pasa: una acción que mueve dinero no se
 * autoriza a ciegas porque Supabase Auth tuvo un hipo.
 */
export async function exigirAal2SiHayFactor(sb: SupabaseClient): Promise<VeredictoStepUp> {
  const e = await estadoMfa(sb);
  if (!e.legible) return { ok: false, motivo: 'no_verificable' };
  if (!e.inscrito) return { ok: true };
  if (e.aal === 'aal2') return { ok: true };
  return { ok: false, motivo: 'verificar' };
}

export const MSG_STEP_UP =
  'Esta acción exige tu segundo factor: entra a Mi perfil → Seguridad, escribe el código de tu app y vuelve a intentarlo. Tu sesión queda verificada un rato.';

export const MSG_MFA_NO_VERIFICABLE =
  'No pude comprobar tu segundo factor en este momento (el servicio de autenticación no contestó). Por seguridad la acción no se ejecuta; inténtalo de nuevo en un minuto.';
