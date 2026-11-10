// ═══════════════════════════════════════════════════════════════════════════
// EL PRIMER LECTOR DE `bitacora_auditoria` (0053).
//
// La auditoría del 14-ago encontró la asimetría: SIETE escritores (altas,
// políticas, buzones, llaves API, credenciales, carta porte, facturación) y
// CERO lectores — un registro de auditoría que nadie puede abrir no audita
// nada, solo ocupa disco con la conciencia tranquila. Este módulo es la
// lectura: las últimas N entradas CRUZANDO todos los tenants, para la sección
// "Bitácora" de /admin/observabilidad.
//
// Vive en lib/admin (el barrio con permiso de cruzar tenants, ver negocio.ts
// y soporte.ts) y no en lib/likida: mezclar lecturas con y sin filtro de
// tenant en un mismo archivo es como se copia un patrón de superadmin a una
// consulta de cliente.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { inicioDiaMx, finDiaMx } from '@/lib/formato';

export interface EntradaBitacora {
  id: number;
  /** `null` cuando la acción es de plataforma (p. ej. un interruptor). */
  tenantId: string | null;
  tenantNombre: string | null;
  /** Quién: el nombre de la cuenta, su correo, o null si la acción no llevó
   *  actor (escritores viejos sin firma — se pinta "sistema", no se inventa). */
  actor: string | null;
  accion: string;
  entidad: string | null;
  entidadId: string | null;
  detalle: Record<string, unknown> | null;
  ocurrioEn: string;
}

/**
 * Las últimas `limite` entradas, cross-tenant, lo más reciente primero.
 *
 * `filtroAccion` filtra por substring de `accion` (p. ej. "interruptor" o
 * "flota.creada"). Se sanea a [a-z0-9._:-] ANTES de armar el ilike: `%` y `_`
 * son comodines de LIKE y un filtro con ellos consultaría otra cosa de la
 * que la pantalla dice.
 *
 * LANZA ante un error de lectura: una bitácora que pinta "sin entradas" sobre
 * una base caída afirmaría que nadie ha tocado nada — la mentira exacta que
 * un registro de auditoría existe para desmentir. Es una ventana (las últimas
 * N), no un export: se dice en la pantalla, y por eso no pagina con traerTodo.
 */
export async function ultimasEntradasBitacora(
  opts: { limite?: number; filtroAccion?: string } = {},
): Promise<EntradaBitacora[]> {
  const limite = opts.limite ?? 50;
  const filtro = (opts.filtroAccion ?? '').toLowerCase().replace(/[^a-z0-9._:-]/g, '');

  const base = supabaseAdmin()
    .from('bitacora_auditoria')
    .select('id, tenant_id, actor_id, actor_email, accion, entidad, entidad_id, detalle, ocurrio_en, tenant:tenant_id(nombre), actor:actor_id(nombre, email)');
  // El filtro ANTES de order/limit: sobre el builder ya transformado el
  // `.ilike` no existe (y filtrar las 50 recortadas mentiría sobre el resto).
  //
  // ADM-12 (auditoría 24, menor): esta lectura era la única de lib/admin sin
  // `acotada` — un socket que Supabase acepta y no contesta colgaba hasta el
  // default de undici en vez de fallar rápido con su propio tope.
  const { data, error } = await acotada(
    (filtro ? base.ilike('accion', `%${filtro}%`) : base)
      .order('ocurrio_en', { ascending: false })
      .limit(limite),
    'ultimasEntradasBitacora',
  );
  if (error) throw new Error(`ultimasEntradasBitacora: ${error.message}`);

  return ((data ?? []) as Array<Record<string, unknown>>).map((f): EntradaBitacora => {
    const actorJoin = f.actor as { nombre?: string | null; email?: string | null } | null;
    return {
      id: Number(f.id),
      tenantId: (f.tenant_id as string | null) ?? null,
      // El join sin nombre se pinta null y la pantalla dice "plataforma" o
      // '—' — visible, no inventado (criterio de soporte.ts).
      tenantNombre: ((f.tenant as { nombre?: string } | null)?.nombre) ?? null,
      actor: actorJoin?.nombre ?? actorJoin?.email ?? (f.actor_email as string | null) ?? null,
      accion: String(f.accion),
      entidad: (f.entidad as string | null) ?? null,
      entidadId: (f.entidad_id as string | null) ?? null,
      detalle: (f.detalle as Record<string, unknown> | null) ?? null,
      ocurrioEn: String(f.ocurrio_en),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA CONSULTABLE (/admin/bitacora, plan maestro F7).
//
// Hasta aquí el único lector era una VENTANA de 50 en Observabilidad. Esto es
// la lectura con filtros (acción, persona, flota, fechas) y páginas con total
// real: SOLO LECTURA, y lo que llega a pantalla NO trae el `detalle` crudo ni
// correos (la tabla se conserva mucho tiempo y su `detalle` puede traer
// referencias a terceros). El filtro por persona va por `actor_id`, no por
// texto: un nombre no es una llave.
// ═══════════════════════════════════════════════════════════════════════════

/** Filas por página de la Bitácora. */
export const FILAS_BITACORA = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface FiltroBitacora {
  /** Subcadena de la acción (se sanea a [a-z0-9._:-]). */
  accion?: string;
  /** `app_user.id` de quien hizo la acción. */
  actorId?: string;
  /** `tenant.id` de la flota, o `'plataforma'` para lo que no es de ninguna flota. */
  tenantId?: string;
  /** Día AAAA-MM-DD (hora de México), inclusivo. */
  desde?: string;
  hasta?: string;
}

/** Normaliza lo que llega de la URL: lo inválido se descarta (nunca se arma una consulta con basura). Pura. */
export function normalizarFiltroBitacora(crudo: Partial<Record<keyof FiltroBitacora, string | undefined>>): FiltroBitacora {
  const f: FiltroBitacora = {};
  const accion = (crudo.accion ?? '').toLowerCase().replace(/[^a-z0-9._:-]/g, '');
  if (accion) f.accion = accion;
  const actor = (crudo.actorId ?? '').trim();
  if (UUID_RE.test(actor)) f.actorId = actor;
  const flota = (crudo.tenantId ?? '').trim();
  if (flota === 'plataforma' || UUID_RE.test(flota)) f.tenantId = flota;
  const desde = (crudo.desde ?? '').trim();
  if (DIA_RE.test(desde)) f.desde = desde;
  const hasta = (crudo.hasta ?? '').trim();
  if (DIA_RE.test(hasta)) f.hasta = hasta;
  return f;
}

export interface PaginaBitacora {
  filas: EntradaBitacora[];
  total: number;
  pagina: number;
  paginas: number;
}

/**
 * Una página de la bitácora con el total REAL de lo filtrado. LANZA si la base falla (una bitácora vacía sobre una base caída
 * afirmaría que nadie tocó nada). El orden es por fecha y, de desempate, por id: dos páginas nunca repiten ni se saltan una fila.
 */
export async function leerPaginaBitacora(filtro: FiltroBitacora, pagina: number, tamano: number = FILAS_BITACORA): Promise<PaginaBitacora> {
  const p = Math.max(1, Math.floor(pagina) || 1);
  const desdeFila = (p - 1) * tamano;
  let q = supabaseAdmin()
    .from('bitacora_auditoria')
    .select('id, tenant_id, actor_id, actor_email, accion, entidad, entidad_id, detalle, ocurrio_en, tenant:tenant_id(nombre), actor:actor_id(nombre, email)', { count: 'exact' });
  if (filtro.accion) q = q.ilike('accion', `%${filtro.accion}%`);
  if (filtro.actorId) q = q.eq('actor_id', filtro.actorId);
  if (filtro.tenantId === 'plataforma') q = q.is('tenant_id', null);
  else if (filtro.tenantId) q = q.eq('tenant_id', filtro.tenantId);
  if (filtro.desde) q = q.gte('ocurrio_en', inicioDiaMx(filtro.desde));
  if (filtro.hasta) q = q.lte('ocurrio_en', finDiaMx(filtro.hasta));
  const { data, error, count } = await acotada(
    q.order('ocurrio_en', { ascending: false }).order('id', { ascending: false }).range(desdeFila, desdeFila + tamano - 1),
    'leerPaginaBitacora',
  );
  if (error) throw new Error(`leerPaginaBitacora: ${error.message}`);
  const filas = ((data ?? []) as Array<Record<string, unknown>>).map((f): EntradaBitacora => {
    const actorJoin = f.actor as { nombre?: string | null; email?: string | null } | null;
    return {
      id: Number(f.id),
      tenantId: (f.tenant_id as string | null) ?? null,
      tenantNombre: ((f.tenant as { nombre?: string } | null)?.nombre) ?? null,
      actor: actorJoin?.nombre ?? actorJoin?.email ?? (f.actor_email as string | null) ?? null,
      accion: String(f.accion),
      entidad: (f.entidad as string | null) ?? null,
      entidadId: (f.entidad_id as string | null) ?? null,
      detalle: (f.detalle as Record<string, unknown> | null) ?? null,
      ocurrioEn: String(f.ocurrio_en),
    };
  });
  const total = typeof count === 'number' ? count : filas.length;
  return { filas, total, pagina: p, paginas: Math.max(1, Math.ceil(total / tamano)) };
}

export interface OpcionesBitacora {
  flotas: Array<{ id: string; nombre: string }>;
  personas: Array<{ id: string; nombre: string }>;
}

/** Las flotas y las personas de Likida para los filtros. Cada lista falla sola: `null` = no se pudo leer (el filtro se oculta, no se vacía). */
export async function opcionesBitacora(): Promise<{ flotas: OpcionesBitacora['flotas'] | null; personas: OpcionesBitacora['personas'] | null }> {
  const [flotas, personas] = await Promise.all([
    acotada(supabaseAdmin().from('tenant').select('id, nombre').order('nombre').limit(500), 'opcionesBitacora.flotas')
      .then(({ data, error }) => (error ? null : ((data ?? []) as Array<{ id: string; nombre: string }>)))
      .catch(() => null),
    acotada(supabaseAdmin().from('app_user').select('id, nombre').in('rol', ['superadmin', 'vendedor']).order('nombre').limit(200), 'opcionesBitacora.personas')
      .then(({ data, error }) => (error ? null : ((data ?? []) as Array<{ id: string; nombre: string | null }>).map((u) => ({ id: u.id, nombre: u.nombre ?? 'Sin nombre' }))))
      .catch(() => null),
  ]);
  return { flotas, personas };
}

// ── Accesos del superadmin (superadmin_acceso, 0997) ────────────────────────

export interface AccesoSuperadmin {
  id: number;
  creadoEn: string;
  actor: string | null;
  tenantNombre: string | null;
  tipo: 'lectura' | 'descarga' | 'ver_como';
  ruta: string;
}

export interface PaginaAccesos {
  /** `false` = la tabla no existe todavía en esta base (la migración aún no se aplica): no es un error. */
  existe: boolean;
  filas: AccesoSuperadmin[];
  total: number;
  pagina: number;
  paginas: number;
}

/** ¿El error de PostgREST/Postgres dice que la tabla no existe? (migración sin aplicar) */
function tablaNoExiste(e: { message?: string; code?: string }): boolean {
  return e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? '');
}

/**
 * Los accesos (lecturas, descargas y «ver como») de un superadmin sobre una flota, de la tabla de solo agregar. Tolera que la
 * tabla no exista. LANZA ante cualquier otro error. Solo la ruta: el `detalle` de la tabla no sale de aquí.
 */
export async function leerPaginaAccesos(filtro: Pick<FiltroBitacora, 'actorId' | 'tenantId' | 'desde' | 'hasta'>, pagina: number, tamano: number = FILAS_BITACORA): Promise<PaginaAccesos> {
  const p = Math.max(1, Math.floor(pagina) || 1);
  const desdeFila = (p - 1) * tamano;
  let q = supabaseAdmin().from('superadmin_acceso').select('id, creado_en, actor, tenant_id, tipo, ruta', { count: 'exact' });
  if (filtro.actorId) q = q.eq('actor', filtro.actorId);
  if (filtro.tenantId === 'plataforma') q = q.is('tenant_id', null);
  else if (filtro.tenantId) q = q.eq('tenant_id', filtro.tenantId);
  if (filtro.desde) q = q.gte('creado_en', inicioDiaMx(filtro.desde));
  if (filtro.hasta) q = q.lte('creado_en', finDiaMx(filtro.hasta));
  const { data, error, count } = await acotada(
    q.order('creado_en', { ascending: false }).order('id', { ascending: false }).range(desdeFila, desdeFila + tamano - 1),
    'leerPaginaAccesos',
  );
  if (error) {
    if (tablaNoExiste(error)) return { existe: false, filas: [], total: 0, pagina: p, paginas: 1 };
    throw new Error(`leerPaginaAccesos: ${error.message}`);
  }
  const crudas = (data ?? []) as Array<Record<string, unknown>>;
  const actores = [...new Set(crudas.map((f) => String(f.actor)))];
  const tenants = [...new Set(crudas.map((f) => f.tenant_id).filter((x): x is string => typeof x === 'string'))];
  // Los nombres se resuelven aparte (la tabla no declara llaves foráneas); si no se pueden leer, se dice «—», no se inventan.
  const [nombresActor, nombresTenant] = await Promise.all([
    actores.length === 0 ? Promise.resolve(new Map<string, string>()) : acotada(supabaseAdmin().from('app_user').select('id, nombre').in('id', actores), 'leerPaginaAccesos.actores')
      .then(({ data: d, error: e }) => new Map((e ? [] : ((d ?? []) as Array<{ id: string; nombre: string | null }>)).map((u) => [u.id, u.nombre ?? ''] as const))).catch(() => new Map<string, string>()),
    tenants.length === 0 ? Promise.resolve(new Map<string, string>()) : acotada(supabaseAdmin().from('tenant').select('id, nombre').in('id', tenants), 'leerPaginaAccesos.flotas')
      .then(({ data: d, error: e }) => new Map((e ? [] : ((d ?? []) as Array<{ id: string; nombre: string }>)).map((t) => [t.id, t.nombre] as const))).catch(() => new Map<string, string>()),
  ]);
  const filas = crudas.map((f): AccesoSuperadmin => ({
    id: Number(f.id),
    creadoEn: String(f.creado_en),
    actor: nombresActor.get(String(f.actor)) || null,
    tenantNombre: typeof f.tenant_id === 'string' ? (nombresTenant.get(f.tenant_id) ?? null) : null,
    tipo: f.tipo as AccesoSuperadmin['tipo'],
    ruta: String(f.ruta),
  }));
  const total = typeof count === 'number' ? count : filas.length;
  return { existe: true, filas, total, pagina: p, paginas: Math.max(1, Math.ceil(total / tamano)) };
}
