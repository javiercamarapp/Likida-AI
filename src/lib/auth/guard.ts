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
import { tenantDemo } from './tenant-demo';
import { getSessionTenant, type SessionTenant } from './session';


export async function requireSessionTenant(
  destino: string,
): Promise<SessionTenant & { tenantId: string }> {
  const s = await getSessionTenant();
  if (!s) redirect(`/login?next=${encodeURIComponent(destino)}`);
  if (!s.tenantId) {
    if (s.rol === 'superadmin') return { ...s, tenantId: tenantDemo() };
    redirect('/sin-acceso');
  }
  return s as SessionTenant & { tenantId: string };
}

/**
 * Puerta del panel del chofer (/chofer y la vieja /mis-viajes) — el reverso
 * de `requireSessionTenant`.
 *
 * Un rol≠operador no va a /sin-acceso (SÍ tiene acceso, solo que a OTRO
 * panel): va a `inicioDe(rol)`, que es el suyo. Y un operador sin
 * `operador_id` ligado (alta a medias — se creó la cuenta de Auth pero no se
 * completó la liga con `operador`) sí va a /sin-acceso: no hay panel del que
 * rebotarlo, de verdad no puede entrar a nada todavía.
 *
 * ── EL DESTINO SE RECIBE, YA NO SE ESCRIBE A MANO ────────────────────────
 *
 * Antes el rebote era `/login?next=%2Fmis-viajes` fijo. El chofer llega por un
 * enlace de WhatsApp que apunta a una pantalla CONCRETA ("mira tu saldo",
 * /chofer/liquidacion), así que con la constante escrita a mano toda liga
 * profunda aterrizaba, tras iniciar sesión, en la pantalla vieja de solo
 * lectura — la ruta de vuelta es justamente lo que no se podía perder. Cada
 * página pasa la suya, igual que `requireSessionTenant(destino)` en
 * /dashboard. El default conserva el comportamiento de /mis-viajes.
 *
 * El `next` PRECISO de una liga profunda con query string lo pone el proxy
 * (src/proxy.ts), que sí ve la URL completa y ahora también gatea /chofer.
 * Esto es la segunda capa: el destino que pasa la página basta para volver a
 * la sección correcta, y las dos tienen que fallar a la vez.
 */
export async function requireOperador(
  destino: string = '/mis-viajes',
): Promise<SessionTenant & { operadorId: string }> {
  const { inicioDe } = await import('./visibilidad');
  const s = await getSessionTenant();
  if (!s) redirect(`/login?next=${encodeURIComponent(destino)}`);
  // `inicioDe` en vez de '/dashboard' fijo: al contador `/dashboard` es de
  // operación y lo rebotaría otra vez — el mismo bucle que `exigirVerRuta`
  // ya evitaba, que aquí estaba abierto por escribir la ruta a mano.
  if (s.rol !== 'operador') redirect(inicioDe(s.rol));
  if (!s.operadorId) redirect('/sin-acceso');
  return s as SessionTenant & { operadorId: string };
}

/**
 * Puerta de /admin — la consola de negocio de Likida. Ningún otro rol la ve,
 * ni flota_admin: lo que vive aquí (cuántos tenants, cuánto gasta Likida en
 * IA) es de Javier, no de un cliente. Un rol≠superadmin va a /dashboard —
 * SÍ tiene panel, es otro.
 */
export async function requireSuperadmin(): Promise<SessionTenant> {
  const s = await getSessionTenant();
  if (!s) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (s.rol !== 'superadmin') redirect('/dashboard');
  return s;
}

/**
 * Gate de PANTALLA por rol, para las páginas que no pasan por
 * `resolverTenantEfectivo` — los stubs sin datos.
 *
 * Existe porque un stub también filtra: "Cobranza" y "Rentabilidad", aunque
 * estén vacías, le anuncian a un jefe de tráfico qué mira su patrón. Y el día
 * que dejen de ser stubs, el gate ya está puesto en vez de ser algo que
 * alguien tenga que acordarse de agregar.
 */
export async function exigirVerRuta(destino: string): Promise<SessionTenant> {
  const { puedeVerRuta, inicioDe } = await import('./visibilidad');
  const s = await requireSessionTenant(destino);
  if (!puedeVerRuta(s.rol, destino)) redirect(inicioDe(s.rol));
  return s;
}
