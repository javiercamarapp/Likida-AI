// ═══════════════════════════════════════════════════════════════════════════
// SEGUNDA CAPA DE AUTORIZACIÓN — la que no depende de un regex.
//
// Mismo criterio que la versión anterior (passcode): el proxy es la primera
// capa (barata, por matcher de ruta); esta es la segunda, y viaja CON la
// página en vez de con la configuración de rutas. Las dos tienen que fallar a
// la vez para que una página del panel se sirva sin autorización.
//
// Ahora la fuente de verdad es `app_user` vía `getSessionTenant()`, no un
// passcode compartido: sin sesión de Supabase, a /login; con sesión pero sin
// fila en `app_user` (alta pendiente), a /sin-acceso — nunca se sirve el
// panel sin un tenantId real.
//
// SUPERADMIN ES EL CASO APARTE. `app_user.tenant_id` nulo es AMBIGUO por
// diseño (0001_init.sql:17): puede ser "sin alta" o puede ser "superadmin,
// no pertenece a ningún tenant". Hoy el panel no tiene selector de flota, así
// que un superadmin ve el tenant de la demo — el mismo que veía todo el mundo
// antes de que existiera login por usuario. El día que haga falta elegir
// entre varias flotas, esto se reemplaza por un selector; construirlo hoy
// sería una pantalla para un caso de uso que todavía no existe.
// ═══════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import { getSessionTenant, type SessionTenant } from './session';

const TENANT_DEMO = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

export async function requireSessionTenant(
  destino: string,
): Promise<SessionTenant & { tenantId: string }> {
  const s = await getSessionTenant();
  if (!s) redirect(`/login?next=${encodeURIComponent(destino)}`);
  if (!s.tenantId) {
    if (s.rol === 'superadmin') return { ...s, tenantId: TENANT_DEMO() };
    redirect('/sin-acceso');
  }
  return s as SessionTenant & { tenantId: string };
}

/**
 * Puerta de /mis-viajes — el reverso de `requireSessionTenant`.
 *
 * Un rol≠operador no va a /sin-acceso (SÍ tiene acceso, solo que a OTRO
 * panel): va a /dashboard, que es el suyo. Y un operador sin `operador_id`
 * ligado (alta a medias — se creó la cuenta de Auth pero no se completó la
 * liga con `operador`) sí va a /sin-acceso: no hay panel del que rebotarlo,
 * de verdad no puede entrar a nada todavía.
 */
export async function requireOperador(): Promise<SessionTenant & { operadorId: string }> {
  const s = await getSessionTenant();
  if (!s) redirect('/login?next=%2Fmis-viajes');
  if (s.rol !== 'operador') redirect('/dashboard');
  if (!s.operadorId) redirect('/sin-acceso');
  return s as SessionTenant & { operadorId: string };
}
