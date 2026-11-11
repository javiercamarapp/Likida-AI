import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { conteo, traerTodo } from '@/lib/likida/pg';

// ═══════════════════════════════════════════════════════════════════════════
// LAS PERSONAS DE TODAS LAS FLOTAS (y el personal de Likida) para /admin/equipo: `app_user` + el último acceso de Auth.
//
// Cruza flotas a propósito (es la consola interna), igual que `getEquipo`. Cada fuente cae por su lado:
//  · `app_user` es la lista; si no se puede leer, LANZA (la página dice "no disponible", no "sin personas").
//  · El acceso viene de `auth.users` (`last_sign_in_at`, `banned_until`). Si esa lectura falla, `accesoLegible = false` y el último
//    acceso se pinta "sin dato": NUNCA "nunca entró", que sería afirmar algo que no se midió.
//  · "Sin cuenta de acceso" = fila de `app_user` sin usuario en Auth (cuenta fantasma): nunca podrá entrar. Solo se afirma con la
//    lectura de Auth completa.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoPersona = 'activa' | 'baja' | 'sin_acceso';

export interface Persona {
  id: string;
  email: string;
  nombre: string | null;
  rol: string;
  tenantId: string | null;
  tenantNombre: string | null;
  activa: boolean;
  desactivadoEn: string | null;
  /** ISO del último inicio de sesión; `null` = nunca entró (solo si `accesoLegible`) o sin dato. */
  ultimoAcceso: string | null;
  /** `true` = nunca inició sesión, medido. */
  nuncaEntro: boolean;
  /** No existe usuario en Auth para esta fila (solo cuando la lectura de Auth fue completa). */
  sinCuentaAuth: boolean;
  estado: EstadoPersona;
  /** Es personal de Likida (superadmin o vendedor, sin flota). */
  esLikida: boolean;
}

export interface FilaAppUser {
  id: string; email: string; nombre: string | null; rol: string; tenant_id: string | null; activo: boolean | null;
  desactivado_en: string | null; tenant: { nombre?: string } | null;
}
export interface AccesoAuth { lastSignInAt: string | null }

/** Pura: une las filas con el mapa de Auth (`null` = la lectura de Auth falló). */
export function armarPersonas(filas: FilaAppUser[], auth: Map<string, AccesoAuth> | null): Persona[] {
  return filas.map((u) => {
    const activa = u.activo !== false;
    const a = auth?.get(u.id);
    const sinCuentaAuth = auth !== null && !a;
    const nuncaEntro = auth !== null && !!a && !a.lastSignInAt;
    const estado: EstadoPersona = sinCuentaAuth ? 'sin_acceso' : activa ? 'activa' : 'baja';
    return {
      id: u.id, email: u.email, nombre: u.nombre ?? null, rol: u.rol, tenantId: u.tenant_id ?? null,
      tenantNombre: u.tenant?.nombre ?? null, activa, desactivadoEn: u.desactivado_en ?? null,
      ultimoAcceso: a?.lastSignInAt ?? null, nuncaEntro, sinCuentaAuth, estado,
      esLikida: !u.tenant_id && (u.rol === 'superadmin' || u.rol === 'vendedor'),
    };
  });
}

/** Lee a todos los usuarios de Auth (páginas de 1,000). `null` si CUALQUIER página falla: una lectura a medias no sirve para afirmar "sin cuenta". */
async function leerAccesos(): Promise<Map<string, AccesoAuth> | null> {
  try {
    const mapa = new Map<string, AccesoAuth>();
    for (let pagina = 1; pagina <= 50; pagina++) {
      const { data, error } = await supabaseAdmin().auth.admin.listUsers({ page: pagina, perPage: 1000 });
      if (error) return null;
      const usuarios = data?.users ?? [];
      for (const u of usuarios) mapa.set(u.id, { lastSignInAt: u.last_sign_in_at ?? null });
      if (usuarios.length < 1000) return mapa;
    }
    return null; // más de 50,000 cuentas: no se afirma nada
  } catch {
    return null;
  }
}

export interface ResultadoPersonas { personas: Persona[]; accesoLegible: boolean }

export async function getPersonas(): Promise<ResultadoPersonas> {
  const admin = supabaseAdmin();
  const [filas, auth] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('app_user')
        .select('id, tenant_id, rol, nombre, email, activo, desactivado_en, tenant:tenant_id(nombre)', conteo(d))
        .order('rol', { ascending: true }).order('id').range(d, h), 'getPersonas'),
      'getPersonas',
    ),
    leerAccesos(),
  ]);
  return { personas: armarPersonas(filas as unknown as FilaAppUser[], auth), accesoLegible: auth !== null };
}

const ORDEN_ROL = ['superadmin', 'vendedor', 'flota_admin', 'encargado', 'contador', 'nomina'];
/** Jerarquía operativa (Likida primero, luego la flota), no alfabética. Un rol desconocido va al final. */
export function ordenarPorJerarquia<T extends { rol: string }>(xs: readonly T[]): T[] {
  const pos = (r: string) => { const i = ORDEN_ROL.indexOf(r); return i === -1 ? ORDEN_ROL.length : i; };
  return [...xs].sort((a, b) => pos(a.rol) - pos(b.rol));
}
