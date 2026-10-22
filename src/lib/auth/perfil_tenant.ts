// ═══════════════════════════════════════════════════════════════════════════
// PERFIL DE TENANT (mig. 0770) — la LECTURA y las PUERTAS del recorte.
//
// La LISTA de lo permitido vive en `visibilidad.ts` (RUTAS_PERFIL_CINCO_AGENTES
// y hermanas); aquí vive el dato (`tenant_perfil`) y los guardas que lo aplican
// en cada superficie del servidor:
//
//   · páginas y server actions → `exigirRutaDePerfil` (la llaman
//     `resolverTenantEfectivo` y `requireSessionTenant`),
//   · rutas de API de sesión   → `apiDenegadaPorPerfil` (la llama
//     `resolverTenantApi` y los endpoints de /api/dashboard),
//   · API /v1 por llave        → `apiDenegadaPorPerfil` (la llama `abrir`),
//   · chat y MCP               → `perfilRestringido`,
//   · crons                    → `tenantsSinPerfilParaCron` / `cronSaltaTenant`.
//
// CONTRATO: SIN FILA = comportamiento de siempre. CON FILA = lista cerrada.
// El perfil solo QUITA; nunca da.
//
// FALLA CERRADO EN LA LECTURA: si la tabla no se puede leer, NO se sabe si la
// flota tiene perfil; se usa el último valor conocido y, sin él, se asume el
// perfil restringido. Es la dirección segura: un bache de base oculta de más
// unos segundos, nunca enseña de más. Los errores no se cachean.
// ═══════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';
import {
  PERFILES_TENANT, rutaPermitidaEnPerfil, apiPermitidaEnPerfil, CRONS_PERFIL_CINCO_AGENTES,
  moduloProximamenteDeRuta, rutaProximamente, MODULOS_PROXIMAMENTE_PERFIL, inicioDe,
  type PerfilTenant, type ModuloPerfil,
} from './visibilidad';

export type { PerfilTenant };

/** Cuánto vive una lectura en memoria. Corto a propósito: aplicar o quitar un perfil debe notarse en un minuto. */
export const TTL_PERFIL_MS = 30_000;

/** Perfil que se asume cuando no se pudo leer y no hay valor previo: el restrictivo. */
const PERFIL_SI_NO_SE_PUDO_LEER: PerfilTenant = 'cinco_agentes';

interface Entrada { perfil: PerfilTenant | null; hasta: number }
const cache = new Map<string, Entrada>();
const ultimoConocido = new Map<string, PerfilTenant | null>();

/** El ÚNICO punto de acceso a la tabla (un solo acceso directo: ver el techo de frontera_datos_guardiana). */
const tablaPerfil = () => supabaseAdmin().from('tenant_perfil');

/** Solo para pruebas. */
export function reiniciarCachePerfil(): void {
  cache.clear();
  ultimoConocido.clear();
}

function comoPerfil(valor: unknown): PerfilTenant | null {
  if (valor == null) return null;
  // Un valor que el código no conoce (la base ya lo rechaza con CHECK) NO se
  // trata como "sin perfil": se trata como restringido.
  return (PERFILES_TENANT as readonly string[]).includes(String(valor))
    ? (valor as PerfilTenant)
    : PERFIL_SI_NO_SE_PUDO_LEER;
}

/**
 * El perfil de una flota, o `null` si no tiene (comportamiento de siempre).
 * Cacheado por tenant (`TTL_PERFIL_MS`). Nunca lanza.
 */
export async function perfilDeTenant(
  tenantId: string | null | undefined,
  ahora: number = Date.now(),
  /** Qué asumir si la tabla no se puede leer y nunca se leyó: `restringir` (default: falla cerrado) o `permitir`
   *  (solo para el pipeline del chofer, cuya palanca es operativa y NO debe tumbarse por un bache — ver `interruptor_tenant.ts`). */
  siNoSePuedeLeer: 'restringir' | 'permitir' = 'restringir',
): Promise<PerfilTenant | null> {
  if (!tenantId) return null;
  const hit = cache.get(tenantId);
  if (hit && hit.hasta > ahora) return hit.perfil;
  try {
    const { data, error } = await tablaPerfil()
      .select('perfil')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    // La tabla todavía no existe (la 0770 no se ha aplicado en esa base): sin
    // tabla no puede haber perfil, así que es "sin perfil", no un error. Sin esta
    // rama, desplegar el código antes que la migración restringiría a TODAS las
    // flotas por una tabla ausente.
    if (error && (error.code === '42P01' || error.code === 'PGRST205')) {
      cache.set(tenantId, { perfil: null, hasta: ahora + TTL_PERFIL_MS });
      return null;
    }
    if (error) throw new Error(error.message);
    const perfil = comoPerfil(data?.perfil);
    cache.set(tenantId, { perfil, hasta: ahora + TTL_PERFIL_MS });
    ultimoConocido.set(tenantId, perfil);
    return perfil;
  } catch (e) {
    logger.warn('perfil_tenant.ilegible', { tenantId, err: e instanceof Error ? e.message : String(e) });
    // Sin caché del error: el siguiente request reintenta.
    if (ultimoConocido.has(tenantId)) return ultimoConocido.get(tenantId) ?? null;
    return siNoSePuedeLeer === 'permitir' ? null : PERFIL_SI_NO_SE_PUDO_LEER;
  }
}

/** ¿La flota tiene un perfil que la restringe? (chat, MCP y demás superficies de "todo o nada".) */
export async function perfilRestringido(tenantId: string | null | undefined): Promise<boolean> {
  return (await perfilDeTenant(tenantId)) !== null;
}

/**
 * ¿El módulo (`vigia` | `conductor`) está en «Próximamente» para esta flota? Es la puerta de las superficies que NO son
 * una ruta (el WhatsApp del chofer y del cliente): con perfil y módulo en fase 2, NADA se envía, se escribe ni se lee de
 * ese módulo. Sin perfil: `false` (comportamiento de siempre). Si el perfil no se puede leer, falla CERRADO (lo mismo
 * que `perfilDeTenant`: sin valor previo se asume el perfil restringido).
 */
export async function moduloEnStandBy(tenantId: string | null | undefined, modulo: ModuloPerfil): Promise<boolean> {
  if (!MODULOS_PROXIMAMENTE_PERFIL.includes(modulo)) return false;
  return (await perfilDeTenant(tenantId)) !== null;
}

/**
 * PÁGINAS Y SERVER ACTIONS: si la flota tiene perfil y la ruta no está en su
 * lista, rebota a `/dashboard` (el Resumen, que SIEMPRE está en la lista — por
 * eso no hay bucle). Para `/dashboard` mismo no hace nada. Si la ruta es de un
 * módulo «próximamente» (A4/A5 en fase 1) va a su pantalla «Próximamente».
 *
 * Una server action de una pantalla en stand-by llama a `resolverTenantEfectivo`
 * o a `requireSessionTenant` con la ruta de su pantalla: este rebote la corta
 * antes de que toque un dato.
 *
 * `rol`, cuando se conoce (ambos callers lo pasan), afina el rebote con
 * `inicioDe(rol, perfil)` en vez del `/dashboard` fijo: para un rol que no ve
 * `operacion` —el contador, que solo ve `dinero`— `/dashboard` NO es una
 * pantalla que abra (`resolverTenantEfectivo` lo rebotaría de vuelta a su
 * casa), así que el `/dashboard` fijo producía un bucle de redirecciones
 * entre esa casa y este rebote (T-PER-02, hallazgo del 21-oct-2026). Sin
 * `rol` (callers que no lo tienen a mano) el destino sigue siendo
 * `/dashboard`, igual que siempre.
 */
export async function exigirRutaDePerfil(tenantId: string | null | undefined, destino: string, rol?: string): Promise<void> {
  const perfil = await perfilDeTenant(tenantId);
  if (!perfil) return;
  if (rutaPermitidaEnPerfil(perfil, destino)) {
    // «Próximamente» (fase 1): el módulo se ve pero no se opera. La página real y sus server actions se cortan aquí,
    // antes de tocar un dato, y se sirve la pantalla única «Próximamente» (sin datos, sin acciones).
    const proximamente = moduloProximamenteDeRuta(perfil, destino);
    if (proximamente) {
      logger.info('perfil_tenant.ruta_proximamente', { tenantId, destino, modulo: proximamente });
      redirect(rutaProximamente(proximamente));
    }
    return;
  }
  logger.warn('perfil_tenant.ruta_negada', { tenantId, destino });
  redirect(rol ? inicioDe(rol, perfil) : '/dashboard');
}

/**
 * API (sesión o llave): ¿esta ruta está negada para la flota? `true` = negar.
 * Sin perfil siempre `false`. Con perfil, solo pasa lo que `apiPermitidaEnPerfil`
 * declara; una ruta nueva sin clasificar se niega.
 */
export async function apiDenegadaPorPerfil(tenantId: string | null | undefined, pathname: string): Promise<boolean> {
  const perfil = await perfilDeTenant(tenantId);
  if (!perfil) return false;
  if (apiPermitidaEnPerfil(perfil, pathname)) return false;
  logger.warn('perfil_tenant.api_negada', { tenantId, pathname });
  return true;
}

/** Respuesta estándar de una API negada por el perfil. */
export const MOTIVO_PERFIL_API = 'Esta parte del producto no está incluida en el plan de tu cuenta.';

/**
 * Para los endpoints que arman su propia respuesta (`/api/dashboard/*`, chat):
 * devuelve la 403 lista para regresar, o `null` si el perfil no niega la ruta.
 * `url` es la de la petición (`req.url`).
 */
export async function respuestaSiPerfilNiegaApi(tenantId: string | null | undefined, url: string): Promise<NextResponse | null> {
  if (!(await apiDenegadaPorPerfil(tenantId, new URL(url).pathname))) return null;
  return NextResponse.json({ error: MOTIVO_PERFIL_API }, { status: 403 });
}

// ── Crons ──────────────────────────────────────────────────────────────────

/** El nombre de un cron a partir de su ruta (`/api/cron/vigia` → `vigia`; `/api/cron/facturar/cola` → `facturar`). */
export function nombreDeCron(pathname: string): string {
  const m = /^\/api\/cron\/([^/?#]+)/.exec(pathname);
  return m ? m[1] : pathname;
}

/** ¿Este cron sigue corriendo para las flotas con perfil? (Los de A1–A3 y la plomería, sí; los de «próximamente», no.) */
export function cronAplicaAPerfil(nombreCron: string): boolean {
  return CRONS_PERFIL_CINCO_AGENTES.includes(nombreCron);
}

/**
 * Los tenants con perfil que el cron `nombreCron` debe SALTAR: vacío si el cron
 * es de los permitidos. Se lee UNA vez por corrida. Si la tabla no se puede
 * leer, el cron de stand-by NO corre para nadie esa vuelta (lanza): es un
 * barrido periódico y el siguiente tick reintenta; correr de más sería la
 * dirección insegura.
 */
export async function tenantsConPerfilASaltar(nombreCron: string): Promise<Set<string>> {
  if (cronAplicaAPerfil(nombreCron)) return new Set();
  return tenantsConPerfil();
}

/**
 * TODAS las flotas con perfil, sin mirar el nombre del cron: para los crons
 * MIXTOS (`escalar` corre la escalación del conductor, que sigue viva, y la
 * cobranza y las reglas, que no) — ahí cada sección de stand-by pide esta lista
 * y se salta a esas flotas. Lanza si no puede leer la tabla (falla cerrado). Una
 * tabla que aún no existe (0770 sin aplicar) es "ninguna flota con perfil".
 *
 * AUDITORÍA del orquestador (hallazgo medio): esta era la única consulta de
 * TODA la ruta `/api/cron/escalar` sin `acotada()` — la misma clase de bug que
 * colgó un cron entero (AUDITORÍA 8, ALTO REINCIDENTE, `presupuesto.ts:243-247`).
 * Sin el techo fino de 8 s, un cuelgue aquí solo lo paraba el backstop GLOBAL
 * de 25 s del cliente de Supabase — once segundos más de exposición que el
 * resto del cron, por una consulta que además se repite 3 veces por corrida
 * (ver el caché en `cron/escalar/route.ts`).
 */
export async function tenantsConPerfil(): Promise<Set<string>> {
  const { data, error } = await acotada(tablaPerfil().select('tenant_id'), 'perfil_tenant.tenants_con_perfil');
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return new Set();
  if (error) throw new Error(`perfil_tenant: no se pudo leer la lista de flotas con perfil (${error.message})`);
  return new Set((data ?? []).map((f) => String(f.tenant_id)));
}

/** Atajo para los crons que iteran flotas: `lista.filter(saltar.has…)`. */
export function sinTenantsDePerfil<T>(filas: readonly T[], saltar: ReadonlySet<string>, idDe: (f: T) => string): T[] {
  if (saltar.size === 0) return [...filas];
  return filas.filter((f) => !saltar.has(idDe(f)));
}
