import { Users } from 'lucide-react';
import { fechaMx } from '@/lib/formato';
import type { OpcionRol } from '@/lib/auth/invitar';
import { nombreDeRol, detalleDeRol } from '@/lib/auth/roles';
import {
  FormaInvitar, FormaCambiarRol, FormaDarDeBaja, FormaReactivar, FormaReenviarAcceso, FormaCerrarSesiones, type AccionForma,
} from './forma';
import { BotonEnlace, Disclosure, EstadoError, EstadoVacio, MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import './usuarios.css';

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
  /** FASE 1 · SEG-SESIONES: cerrar TODAS sus sesiones sin darlo de baja. */
  cerrarSesiones: AccionForma;
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
export function VistaUsuarios({ usuarios, userId, puedeInvitar, roles, rolesInvitar, acciones }: {
  usuarios: UsuarioRow[] | null;
  /** El de la sesión, para marcar "(tú)" en la lista y no ofrecerle baja. */
  userId: string;
  /** `puedeAdministrar(rol)`: invitar, cambiar rol, dar de baja, reenviar. */
  puedeInvitar: boolean;
  roles: ReadonlyArray<OpcionRol>;
  /** Los roles que ofrece SOLO el formulario de invitar (con `nomina` si aplica). Sin él, los mismos de `roles`. */
  rolesInvitar?: ReadonlyArray<OpcionRol>;
  acciones: AccionesEquipo;
}) {
  const columnas: ColumnaBase<UsuarioRow>[] = [
    {
      id: 'nombre', titulo: 'Nombre', principal: true,
      celda: (u) => (
        <span className="rv-usu__nombre" data-baja={u.activo ? undefined : true}>
          {/* Sin nombre cae al correo, no a "—": una persona recién invitada sin nombre sería un renglón que no se puede distinguir de otro. */}
          {u.nombre ?? <span className="cifra-mono">{u.email}</span>}
          {u.id === userId && <span className="rv-usu__yo">(tú)</span>}
          {u.nombre && <span className="rv-usu__correo cifra-mono">{u.email}</span>}
          {!u.activo && (
            <span className="rv-usu__correo">
              <StatusChip tono="bad">dada de baja{u.desactivadoEn ? ` el ${fechaMx(u.desactivadoEn)}` : ''}</StatusChip>
            </span>
          )}
        </span>
      ),
    },
    { id: 'rol', titulo: 'Rol', celda: (u) => <StatusChip tono={u.activo && u.rol === 'flota_admin' ? 'ok' : 'neutral'}>{nombreDeRol(u.rol)}</StatusChip> },
    { id: 'que', titulo: 'Qué puede hacer', celda: (u) => <span className="rv-usu__tenue">{detalleDeRol(u.rol)}</span> },
    {
      id: 'wa', titulo: 'WhatsApp',
      celda: (u) => (u.telefono
        ? <span className="cifra-mono rv-usu__nombre" data-baja={u.activo ? undefined : true}>{u.telefono}</span>
        : <span className="rv-usu__sin">sin WhatsApp — el bot no lo reconoce</span>),
    },
    ...(puedeInvitar ? [{
      id: 'acciones', titulo: 'Acciones',
      celda: (u: UsuarioRow) => <Acciones u={u} esYo={u.id === userId} roles={roles} acciones={acciones} />,
    }] : []),
  ];

  return (
    <MarcoPagina titulo="Usuarios del equipo" apoyo="Quién entra a este panel y qué puede ver.">
      {usuarios === null ? (
        <EstadoError accion={<BotonEnlace href="" tamano="sm">Reintentar</BotonEnlace>}>No se pudo cargar el equipo. No es que no haya cuentas: la consulta no respondió.</EstadoError>
      ) : (
        <>
          <Tarjeta titulo="Tu equipo" info="usuarios.equipo">
            {usuarios.length === 0 ? (
              <EstadoVacio icono={Users} titulo="No hay cuentas dadas de alta" contenido>
                Cuando invites a alguien de tu equipo, aparece aquí con su rol.
              </EstadoVacio>
            ) : (
              <TablaBase etiqueta="Usuarios y su rol" columnas={columnas} filas={usuarios} idFila={(u) => u.id} altoMaximo={false} tarjetaMovil />
            )}
          </Tarjeta>

          {puedeInvitar ? (
            <Disclosure titulo="+ Invitar a alguien de tu equipo">
              <FormaInvitar accion={acciones.invitar} roles={rolesInvitar ?? roles} />
            </Disclosure>
          ) : (
            <p className="rv-usu__pie">
              Tu rol ve el equipo pero no lo administra: dar acceso al panel, cambiar
              un rol o dar de baja es una decisión del dueño de la flota.
            </p>
          )}

          <Tarjeta titulo="El aislamiento no depende de esconder botones">
            <p className="rv-usu__aislamiento">
              Cada consulta de este panel va filtrada por tu flota, y la base separa los datos de cada flota por su cuenta: aunque
              alguien pidiera datos de otra flota a mano, la base no se los devuelve. Una cuenta dada de baja
              deja de entrar en su siguiente clic y su sesión se revoca; cada cambio de rol, baja y reactivación
              queda en la bitácora de auditoría con quién lo hizo.
            </p>
          </Tarjeta>
        </>
      )}
    </MarcoPagina>
  );
}

function Acciones({ u, esYo, roles, acciones }: {
  u: UsuarioRow; esYo: boolean; roles: ReadonlyArray<OpcionRol>; acciones: AccionesEquipo;
}) {
  // Un superadmin en la lista es personal de Likida: no se administra aquí
  // (el motor lo rechaza igual — esto solo evita ofrecer un botón que rebota).
  const administrable = !esYo && u.rol !== 'superadmin';
  if (!administrable) {
    return <span className="rv-usu__sin">{esYo ? 'Tu propia cuenta la administra otro dueño.' : 'Cuenta de Likida.'}</span>;
  }
  if (!u.activo) return <FormaReactivar accion={acciones.reactivar} id={u.id} />;
  return (
    <div className="rv-usu__acciones">
      <FormaCambiarRol accion={acciones.cambiarRol} id={u.id} rolActual={u.rol} roles={roles} />
      <div className="rv-usu__fila">
        <FormaReenviarAcceso accion={acciones.reenviarAcceso} id={u.id} />
        <FormaCerrarSesiones accion={acciones.cerrarSesiones} id={u.id} />
        <FormaDarDeBaja accion={acciones.darDeBaja} id={u.id} nombre={u.nombre ?? u.email} />
      </div>
    </div>
  );
}
