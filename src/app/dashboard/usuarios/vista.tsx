import { Users, ShieldCheck } from 'lucide-react';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import type { OpcionRol } from '@/lib/auth/invitar';
import { FormaInvitar, type AccionForma } from './forma';

/** Los cinco roles que la base admite (`app_user.rol`, check constraint) y
 *  qué puede cada uno — el texto sale de `lib/auth/permisos.ts` y
 *  `visibilidad.ts`, que son quienes de verdad deciden. `superadmin` y
 *  `operador` no se invitan, pero una fila vieja con esos roles se describe
 *  en vez de quedar como "rol sin descripción". */
const ROLES: Record<string, string> = {
  flota_admin: 'Todo el panel, incluidas finanzas y exportaciones',
  encargado: 'Operación y asignación de viajes — sin finanzas',
  contador: 'Solo lectura de lo fiscal, con exportaciones',
  operador: 'No entra a este panel: usa WhatsApp',
  superadmin: 'Personal de Likida — no pertenece a la flota',
};

export interface UsuarioRow {
  id: string;
  nombre: string | null;
  email: string;
  rol: string;
  /** Canónico (52 + 10 dígitos, forma de `destinatarioWhatsApp`) o null. */
  telefono: string | null;
}

/**
 * Usuarios & Roles — el equipo real de esta flota (`app_user`), pura props
 * para poder mirarla con fixtures sin sesión (vista.test.tsx).
 *
 * `usuarios === null` significa LECTURA CAÍDA, no equipo vacío: supabase-js
 * reporta errores por valor y confundir los dos afirmaría "no hay cuentas"
 * con la base ciega.
 */
export function VistaUsuarios({ usuarios, userId, puedeInvitar, roles, invitar }: {
  usuarios: UsuarioRow[] | null;
  /** El de la sesión, para marcar "(tú)" en la lista. */
  userId: string;
  puedeInvitar: boolean;
  roles: ReadonlyArray<OpcionRol>;
  invitar: AccionForma;
}) {
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
                <EstadoVacio icono={<Users width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
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
                      <th className="px-5 py-2.5 font-medium">WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.map((u) => (
                      <tr key={u.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-5 py-3 font-medium">
                          {/* Sin nombre cae al correo, no a "—": una persona
                              recién invitada sin nombre sería un renglón que
                              no se puede distinguir de otro. */}
                          {u.nombre ?? <span className="cifra-mono font-normal">{u.email}</span>}
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
                        <td className="px-5 py-3">
                          {u.telefono ? (
                            <span className="cifra-mono">{u.telefono}</span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--faint)' }}>
                              sin WhatsApp — el bot no lo reconoce
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {puedeInvitar ? (
              <section className="px-5 pb-5">
                <div className="card p-4">
                  {/* `<details>` nativo, como el Plegable de /dashboard/clientes:
                      sin JavaScript sigue abriendo. */}
                  <details className="group">
                    <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
                      style={{ color: 'var(--marca)' }}>
                      + Invitar a alguien de tu equipo
                    </summary>
                    <div className="pt-3">
                      <FormaInvitar accion={invitar} roles={roles} />
                    </div>
                  </details>
                </div>
              </section>
            ) : (
              <p className="px-5 pb-4 text-[11px] m-0" style={{ color: 'var(--faint)' }}>
                Tu rol ve el equipo pero no invita: dar acceso al panel es una
                decisión del dueño de la flota.
              </p>
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
                Cambiarle el rol a alguien o darlo de baja desde aquí todavía no existe — `app_user`
                no tiene cómo desactivar una cuenta sin borrarla. Tampoco hay bitácora de quién vio qué.
              </EstadoVacio>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
