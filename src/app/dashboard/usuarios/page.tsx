import { Users, ShieldCheck } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';

export const dynamic = 'force-dynamic';

/** Los cinco roles que la base admite (`app_user.rol`, check constraint) y
 *  qué puede cada uno — el texto sale de `lib/auth/permisos.ts`, que es
 *  quien de verdad decide. `superadmin` no se lista: es de Likida, no de la
 *  flota, y ningún cliente puede darlo de alta. */
const ROLES: Record<string, string> = {
  flota_admin: 'Todo el panel, incluidas finanzas y exportaciones',
  encargado: 'Operación y asignación de viajes — sin finanzas',
  contador: 'Solo lectura de lo fiscal, con exportaciones',
  operador: 'No entra a este panel: usa WhatsApp y /mis-viajes',
  superadmin: 'Personal de Likida — no pertenece a la flota',
};

interface UsuarioRow { id: string; nombre: string | null; rol: string; operadorId: string | null }

async function getUsuarios(tenantId: string): Promise<UsuarioRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('app_user')
    .select('id, nombre, rol, operador_id')
    .eq('tenant_id', tenantId)
    .order('rol');
  if (error) throw new Error(`getUsuarios: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id as string,
    nombre: (u.nombre as string) || null,
    rol: u.rol as string,
    operadorId: (u.operador_id as string) || null,
  }));
}

/**
 * Usuarios & Roles (PASO 22) — el equipo real de esta flota (`app_user`).
 *
 * El correo NO se muestra: vive en `auth.users` (el esquema de Auth), no en
 * `app_user`, y traerlo aquí obligaría a leer con service-role una tabla de
 * credenciales para pintar una columna de cortesía. El nombre y el rol
 * bastan para lo que esta pantalla contesta.
 */
export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, userId } = await resolverTenantEfectivo('/dashboard/usuarios', sp);

  let usuarios: UsuarioRow[] | null;
  try {
    usuarios = await getUsuarios(tenantId);
  } catch {
    usuarios = null;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Users width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Usuarios & Roles</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Quién entra a este panel y qué puede ver</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        {usuarios === null ? (
          <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el equipo.</div>
        ) : (
          <>
            <div className="pt-5 pb-2 px-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Tu equipo
              </h2>
            </div>
            {usuarios.length === 0 ? (
              <div className="px-5 pb-5">
                <EstadoVacio icono={<Users width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
                  No hay cuentas dadas de alta en esta flota todavía.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-5 py-2.5 font-medium">Nombre</th>
                      <th className="px-5 py-2.5 font-medium">Rol</th>
                      <th className="px-5 py-2.5 font-medium">Qué puede hacer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.map((u) => (
                      <tr key={u.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-5 py-3 font-medium">
                          {u.nombre ?? '—'}
                          {u.id === userId && (
                            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--muted)' }}>(tú)</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <StatusPill estado={u.rol === 'flota_admin' ? 'ok' : 'neutral'}>{u.rol}</StatusPill>
                        </td>
                        <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
                          {ROLES[u.rol] ?? 'Rol sin descripción'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <div className="card p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--okbg)' }}>
                  <ShieldCheck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ok)' }} />
                </div>
                <div>
                  <p className="text-sm font-medium m-0">El aislamiento no depende de esconder botones</p>
                  <p className="text-xs mt-1 m-0" style={{ color: 'var(--muted)' }}>
                    Cada consulta de este panel va filtrada por tu flota, y la base tiene RLS por tenant encima: aunque
                    alguien pidiera datos de otra flota a mano, Postgres no se los devuelve.
                  </p>
                </div>
              </div>
            </section>

            <div className="px-5 pt-1 pb-5">
              <EstadoVacio>
                Invitar a alguien nuevo, cambiarle el rol o darlo de baja desde aquí todavía no existe — hoy las
                altas las hace Likida. Tampoco hay bitácora de quién vio qué.
              </EstadoVacio>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
