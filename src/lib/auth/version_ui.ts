// ═══════════════════════════════════════════════════════════════════════════
// VERSIÓN DE INTERFAZ (`v1` | `v2`) — la RESOLUCIÓN, sin tocar la base.
//
// Orden de precedencia (el primero que aplica gana):
//   1. `LIKIDA_UI_V2_FORZAR=1`  → v2. Es la palanca de las pruebas e2e (segunda pasada de la suite) y de
//      desarrollo local. SE IGNORA si `VERCEL_ENV === 'production'`: un valor puesto por error en producción no
//      puede encender el rediseño para todas las flotas.
//   2. cookie `likida-ui=v2|v1`  → SOLO para el superadmin (revisar el rediseño con datos reales antes de
//      encenderlo para un cliente). Cualquier otro rol ignora la cookie: nadie se auto-activa una interfaz.
//   3. la fila de `tenant_ui` (leída en `perfil_tenant.ts`, con su caché de 30 s). Sin fila = v1.
//
// Este archivo NO consulta la base: la única consulta vive en `perfil_tenant.ts` (techo de frontera_datos_guardiana).
// ═══════════════════════════════════════════════════════════════════════════
import { versionUiDeTenant, type VersionUiTenant } from './perfil_tenant';

export type VersionUi = VersionUiTenant;

/** Nombre de la cookie con la que el superadmin elige su versión. */
export const COOKIE_UI = 'likida-ui';

/** Lo mínimo que se necesita de `cookies()` de `next/headers` (también lo cumple un Map envuelto en una prueba). */
export interface LectorCookies {
  get(nombre: string): { value: string } | undefined;
}

type Entorno = Readonly<Record<string, string | undefined>>;

function forzadoPorEntorno(env: Entorno): boolean {
  return env.LIKIDA_UI_V2_FORZAR === '1' && env.VERCEL_ENV !== 'production';
}

function dePreferenciaSuperadmin(rol: string, cookies: LectorCookies | null | undefined): VersionUi | null {
  if (rol !== 'superadmin' || !cookies) return null;
  const valor = cookies.get(COOKIE_UI)?.value;
  return valor === 'v2' || valor === 'v1' ? valor : null;
}

/**
 * La versión de interfaz con la que se pinta el panel de esta sesión. Nunca lanza (la lectura de la base falla
 * hacia v1).
 *
 * Con `LIKIDA_UI_V2_FORZAR` o con la cookie del superadmin NO se consulta la base: la respuesta ya está decidida.
 */
export async function versionUi(
  tenantId: string | null | undefined,
  rol: string,
  cookies?: LectorCookies | null,
  env: Entorno = process.env,
): Promise<VersionUi> {
  if (forzadoPorEntorno(env)) return 'v2';
  const preferida = dePreferenciaSuperadmin(rol, cookies);
  if (preferida) return preferida;
  return versionUiDeTenant(tenantId);
}
