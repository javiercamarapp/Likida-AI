import { getEquipo } from '@/lib/admin/negocio';
import type { RolAppUser } from '@/lib/auth/provisionar';
import { Users } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/** Los 4 roles reales del dominio (constraint `app_user_rol_dominio`,
 *  0044_rol_encargado.sql, retirado `operador` el 7-ago-2026 — el chofer ya
 *  no tiene login) — etiqueta legible para cada uno. Cualquier valor que no
 *  esté en este mapa (no debería pasar, la base ya lo restringe) se enseña
 *  tal cual en vez de esconderse. */
const ROL_LABEL: Record<RolAppUser, string> = {
  superadmin: 'Superadmin',
  flota_admin: 'Dueño / Admin de flota',
  encargado: 'Encargado',
  contador: 'Contador',
};

const ORDEN_ROL: RolAppUser[] = ['superadmin', 'flota_admin', 'encargado', 'contador'];

function InsigniaRol({ rol }: { rol: string }) {
  const label = ROL_LABEL[rol as RolAppUser] ?? rol;
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-block"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
      {label}
    </span>
  );
}

/**
 * Equipo / RBAC — la única de las siete con datos 100% reales: roster
 * completo de `app_user` (`getEquipo`, apéndice nuevo en negocio.ts). Los 4
 * roles vienen del dominio real de la base (RolAppUser), no de una lista
 * inventada. Se ordena por rol siguiendo la jerarquía operativa del
 * negocio (superadmin → dueño → encargado → contador), no alfabético.
 */
export default async function EquipoPage() {
  const equipo = await getEquipo();
  const ordenados = [...equipo].sort((a, b) => {
    const ia = ORDEN_ROL.indexOf(a.rol as RolAppUser);
    const ib = ORDEN_ROL.indexOf(b.rol as RolAppUser);
    return (ia === -1 ? ORDEN_ROL.length : ia) - (ib === -1 ? ORDEN_ROL.length : ib);
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Users width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Equipo</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Roster real de cuentas y roles (RBAC)</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Cuentas dadas de alta — {ordenados.length}
          </h2>

          {ordenados.length === 0 ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>Sin usuarios dados de alta todavía.</div>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-4 py-2.5 font-medium">Nombre</th>
                    <th className="px-4 py-2.5 font-medium">Rol</th>
                    <th className="px-4 py-2.5 font-medium">Flota</th>
                  </tr>
                </thead>
                <tbody className="card divide-y" style={{ borderColor: 'var(--line)' }}>
                  {ordenados.map((u) => (
                    <tr key={u.id} className="border-t transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{u.nombre ?? '(sin nombre)'}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{u.email}</div>
                      </td>
                      <td className="px-4 py-3"><InsigniaRol rol={u.rol} /></td>
                      <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>
                        {u.tenantNombre ?? (u.rol === 'superadmin' ? '— (superadmin, sin flota)' : '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            Los 4 roles reales del sistema: <strong>superadmin</strong> (Javier, ve todas las flotas), <strong>flota_admin</strong> (dueño/contralor de una flota), <strong>encargado</strong> (asigna viajes, no factura ni invita usuarios) y <strong>contador</strong> (lectura fiscal). El chofer ya no tiene cuenta — solo WhatsApp.
          </p>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            2FA, última sesión, audit log de acciones/impersonations — no se registra hoy.
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}
