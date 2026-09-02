import { Users, ShieldCheck } from 'lucide-react';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { fechaMx } from '@/lib/formato';
import type { OpcionRol } from '@/lib/auth/invitar';
import { nombreDeRol, detalleDeRol } from '@/lib/auth/roles';
import {
  FormaInvitar, FormaCambiarRol, FormaDarDeBaja, FormaReactivar, FormaReenviarAcceso, type AccionForma,
} from './forma';

export interface UsuarioRow {
  id: string;
  nombre: string | null;
  email: string;
  rol: string;
  /** Canónico (52 + 10 dígitos, forma de `destinatarioWhatsApp`) o null. */
  telefono: string | null;
  /** `false` = dada de baja (0294). Sigue en la lista: es el rastro. */
  activo: boolean;
  /** ISO de la baja, o null. */
  desactivadoEn: string | null;
}

/** Las acciones por renglón. Todas re-comprueban rol y tenant ADENTRO. */
export interface AccionesEquipo {
  invitar: AccionForma;
  cambiarRol: AccionForma;
  darDeBaja: AccionForma;
  reactivar: AccionForma;
  reenviarAcceso: AccionForma;
}

/**
 * Usuarios & Roles — el equipo real de esta flota (`app_user`), pura props
 * para poder mirarla con fixtures sin sesión (vista.test.tsx).
 *
 * `usuarios === null` significa LECTURA CAÍDA, no equipo vacío: supabase-js
 * reporta errores por valor y confundir los dos afirmaría "no hay cuentas"
 * con la base ciega.
 *
 * Los rótulos de los roles salen de `lib/auth/roles.ts` (auditoría 24, H18):
 * la MISMA fuente que la forma de invitar, /admin/usuarios/nuevo y la cinta
 * de «ver como». `superadmin` y `operador` no se invitan ni se asignan, pero
 * una fila vieja con esos roles se describe en vez de quedar como «rol sin
 * descripción».
 */
export function VistaUsuarios({ usuarios, userId, puedeInvitar, roles, acciones }: {
  usuarios: UsuarioRow[] | null;
  /** El de la sesión, para marcar "(tú)" en la lista y no ofrecerle baja. */
  userId: string;
  /** `puedeAdministrar(rol)`: invitar, cambiar rol, dar de baja, reenviar. */
  puedeInvitar: boolean;
  roles: ReadonlyArray<OpcionRol>;
  acciones: AccionesEquipo;
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
                      {puedeInvitar && <th className="px-5 py-2.5 font-medium">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.map((u) => (
                      <Renglon key={u.id} u={u} esYo={u.id === userId} puedeInvitar={puedeInvitar} roles={roles} acciones={acciones} />
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
                      <FormaInvitar accion={acciones.invitar} roles={roles} />
                    </div>
                  </details>
                </div>
              </section>
            ) : (
              <p className="px-5 pb-4 text-[11px] m-0" style={{ color: 'var(--faint)' }}>
                Tu rol ve el equipo pero no lo administra: dar acceso al panel, cambiar
                un rol o dar de baja es una decisión del dueño de la flota.
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
                    alguien pidiera datos de otra flota a mano, Postgres no se los devuelve. Una cuenta dada de baja
                    deja de entrar en su siguiente clic y su sesión se revoca; cada cambio de rol, baja y reactivación
                    queda en la bitácora de auditoría con quién lo hizo.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Renglon({ u, esYo, puedeInvitar, roles, acciones }: {
  u: UsuarioRow; esYo: boolean; puedeInvitar: boolean;
  roles: ReadonlyArray<OpcionRol>; acciones: AccionesEquipo;
}) {
  // Tachada pero VISIBLE: ocultar una cuenta de baja borraría de la pantalla
  // la evidencia de quién tuvo acceso y desde cuándo no.
  const tachado = u.activo ? undefined : { color: 'var(--faint)' as const };
  // Un superadmin en la lista es personal de Likida: no se administra aquí
  // (el motor lo rechaza igual — esto solo evita ofrecer un botón que rebota).
  const administrable = puedeInvitar && !esYo && u.rol !== 'superadmin';
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--line)' }}>
      <td className="px-5 py-3 font-medium" style={tachado}>
        {/* Sin nombre cae al correo, no a "—": una persona recién invitada
            sin nombre sería un renglón que no se puede distinguir de otro. */}
        {u.nombre ?? <span className="cifra-mono font-normal">{u.email}</span>}
        {esYo && (
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--muted)' }}>(tú)</span>
        )}
        {u.nombre && (
          <div className="cifra-mono text-[11px] font-normal" style={{ color: 'var(--faint)' }}>{u.email}</div>
        )}
        {!u.activo && (
          <div className="mt-1">
            <StatusPill estado="bad">
              dada de baja{u.desactivadoEn ? ` el ${fechaMx(u.desactivadoEn)}` : ''}
            </StatusPill>
          </div>
        )}
      </td>
      <td className="px-5 py-3">
        <StatusPill estado={u.activo ? (u.rol === 'flota_admin' ? 'ok' : 'neutral') : 'neutral'}>{nombreDeRol(u.rol)}</StatusPill>
      </td>
      <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
        {detalleDeRol(u.rol)}
      </td>
      <td className="px-5 py-3">
        {u.telefono ? (
          <span className="cifra-mono" style={tachado}>{u.telefono}</span>
        ) : (
          <span className="text-xs" style={{ color: 'var(--faint)' }}>
            sin WhatsApp — el bot no lo reconoce
          </span>
        )}
      </td>
      {puedeInvitar && (
        <td className="px-5 py-3">
          {!administrable ? (
            <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
              {esYo ? 'Tu propia cuenta la administra otro dueño.' : 'Cuenta de Likida.'}
            </span>
          ) : u.activo ? (
            <div className="flex flex-col gap-2">
              <FormaCambiarRol accion={acciones.cambiarRol} id={u.id} rolActual={u.rol} roles={roles} />
              <div className="flex items-start gap-3 flex-wrap">
                <FormaReenviarAcceso accion={acciones.reenviarAcceso} id={u.id} />
                <FormaDarDeBaja accion={acciones.darDeBaja} id={u.id} nombre={u.nombre ?? u.email} />
              </div>
            </div>
          ) : (
            <FormaReactivar accion={acciones.reactivar} id={u.id} />
          )}
        </td>
      )}
    </tr>
  );
}
