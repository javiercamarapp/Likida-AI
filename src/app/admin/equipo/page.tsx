import { getEquipo } from '@/lib/admin/negocio';
import { ROL_LABEL, type RolAppUser } from '@/lib/auth/provisionar';
import { Users } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { paginarRegistro } from '../../dashboard/paginar-registro';
import { FiltroRegistro } from '../../dashboard/registro-filtro';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

const ORDEN_ROL: RolAppUser[] = ['superadmin', 'vendedor', 'flota_admin', 'encargado', 'contador'];

function InsigniaRol({ rol }: { rol: string }) {
  const label = ROL_LABEL[rol as RolAppUser] ?? rol;
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-block"
      style={{ background: 'var(--canvas)', border: '1px solid var(--line2)', color: 'var(--ink)' }}>
      {label}
    </span>
  );
}

/**
 * Equipo / RBAC — roster completo de `app_user` (`getEquipo`), datos 100%
 * reales. Los 5 roles vienen del dominio real de la base (RolAppUser), no
 * de una lista inventada. Se ordena por rol siguiendo la jerarquía
 * operativa del negocio (los de Likida primero: superadmin → vendedor;
 * luego la flota: dueño → encargado → contador), no alfabético.
 *
 * Anatomía de página (14-ago): BarraPagina + tarjetas sobre el lienzo tenue
 * (--g1); el subtítulo que vivía en el header viejo ahora abre la tarjeta.
 */
export default async function EquipoPage({
  searchParams,
}: {
  /** FE-12: `?q=` busca por nombre/correo/flota y `?p=` pagina. El roster
   *  cruza TODOS los tenants: a 50 flotas con su dueño, su contador y su
   *  encargado, la tabla se vuelve una lista por la que nadie puede navegar. */
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const [equipo, sp] = await Promise.all([getEquipo(), searchParams]);
  const ordenados = [...equipo].sort((a, b) => {
    const ia = ORDEN_ROL.indexOf(a.rol as RolAppUser);
    const ib = ORDEN_ROL.indexOf(b.rol as RolAppUser);
    return (ia === -1 ? ORDEN_ROL.length : ia) - (ib === -1 ? ORDEN_ROL.length : ib);
  });
  const pag = paginarRegistro(
    ordenados,
    (u) => [u.nombre, u.email, u.rol, u.tenantNombre].filter(Boolean).join(' '),
    sp,
  );

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Users width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Equipo"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card overflow-hidden">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-3">
              <TituloSeccion>Cuentas dadas de alta — {ordenados.length}</TituloSeccion>
              <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>Roster real de cuentas y roles (RBAC)</span>
            </div>

            {ordenados.length > 0 && (
              <div className="px-4 pt-1">
                <FiltroRegistro ruta="/admin/equipo" sufijo="" pagina={pag} sustantivo="cuentas" />
              </div>
            )}

            {ordenados.length === 0 ? (
              <p className="px-4 pb-4 pt-2 text-sm" style={{ color: 'var(--muted)' }}>Sin usuarios dados de alta todavía.</p>
            ) : (
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-4 py-2 font-medium">Nombre</th>
                      <th className="px-4 py-2 font-medium">Rol</th>
                      <th className="px-4 py-2 font-medium">Flota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pag.filas.map((u) => (
                      <tr key={u.id} className="border-t transition-colors hover:bg-[var(--canvas)]" style={{ borderColor: 'var(--line2)' }}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{u.nombre ?? '(sin nombre)'}</div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{u.email}</div>
                        </td>
                        <td className="px-4 py-2.5"><InsigniaRol rol={u.rol} /></td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>
                          {u.tenantNombre ?? (u.rol === 'superadmin' ? '— (superadmin, sin flota)' : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pag.filas.length === 0 && (
                  <p className="px-4 py-3 text-sm" style={{ color: 'var(--muted)' }}>
                    Ninguna cuenta coincide con «{pag.q}».
                  </p>
                )}
              </div>
            )}

            {/* Los 5 del dominio real (0105 metió `vendedor`) — la versión
                anterior de este párrafo decía "los 4 roles" y omitía al
                vendedor: un rótulo que contradice el constraint de la base. */}
            <p className="text-xs px-4 pt-2 pb-3" style={{ color: 'var(--muted)' }}>
              Los 5 roles reales del sistema: <strong>superadmin</strong> (Javier, ve todas las flotas), <strong>vendedor</strong> (equipo de ventas de Likida, sin flota), <strong>flota_admin</strong> (dueño/contralor de una flota), <strong>encargado</strong> (asigna viajes, no factura ni invita usuarios) y <strong>contador</strong> (lectura fiscal). El chofer ya no tiene cuenta — solo WhatsApp.
            </p>
          </div>

          <EstadoVacio>
            2FA, última sesión, audit log de acciones/impersonations — no se registra hoy.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
