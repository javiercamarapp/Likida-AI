import { CampoSelect } from '../../ui-v2/componentes/campos';
import { Tarjeta } from '../../ui-v2/componentes';
import { FormaConAviso, type AccionDeForma } from '../ui/forma';
import { ROLES_INVITABLES } from '@/lib/auth/invitar';
import { nombreDeRol } from '@/lib/auth/roles';
import type { Persona } from '@/lib/admin/personas';

export interface AccionesPersona {
  cambiarRol: AccionDeForma;
  darDeBaja: AccionDeForma;
  reactivar: AccionDeForma;
  reenviarAcceso: AccionDeForma;
  cerrarSesiones: AccionDeForma;
  /** 4b (revisión del dueño). */
  darDeBajaLikida: AccionDeForma;
  reactivarLikida: AccionDeForma;
}

const oculto = (id: string) => <input type="hidden" name="id" value={id} />;

/**
 * Las acciones sobre UNA persona. Presentacional: las acciones de servidor llegan por prop (cada una re-gatea con `requireSuperadmin`
 * y deja su asiento en la bitácora). Todo lo que cierra un acceso pide confirmación que dice la consecuencia.
 */
export function GestionPersona({ p, acciones, yo, bajaLikidaHabilitada }: {
  p: Persona;
  acciones: AccionesPersona;
  /** El id de quien mira: nadie se da de baja a sí mismo (el servidor también lo rechaza). */
  yo: string;
  bajaLikidaHabilitada: boolean;
}) {
  const nombre = p.nombre ?? p.email;
  const titulo = `Gestionar a ${nombre}`;

  if (p.esLikida) {
    return (
      <Tarjeta titulo={titulo}>
        <p>{nombreDeRol(p.rol)}: personal de Likida, no de una flota.</p>
        {p.id === yo ? <p>Es tu propia cuenta: no puedes darte de baja a ti mismo.</p>
          : !bajaLikidaHabilitada ? (
            <p>Dar de baja o reactivar al personal de Likida todavía no está habilitado: queda pendiente de la revisión del dueño.</p>
          ) : p.activa ? (
            <FormaConAviso accion={acciones.darDeBajaLikida} boton="Dar de baja" columnas="md:grid-cols-1"
              confirmar={{
                titulo: `Dar de baja a ${nombre}`,
                descripcion: p.rol === 'superadmin'
                  ? 'Pierde el acceso a esta consola y sus sesiones se cierran. No se permite si es el último superadmin activo. Queda en la bitácora.'
                  : 'Pierde el acceso y sus sesiones se cierran. Queda en la bitácora.',
                etiquetaConfirmar: 'Sí, dar de baja',
              }}>
              {oculto(p.id)}
            </FormaConAviso>
          ) : (
            <FormaConAviso accion={acciones.reactivarLikida} boton="Reactivar" columnas="md:grid-cols-1"
              confirmar={{ titulo: `Reactivar a ${nombre}`, descripcion: 'Vuelve a poder entrar con su correo. Queda en la bitácora.', etiquetaConfirmar: 'Sí, reactivar' }}>
              {oculto(p.id)}
            </FormaConAviso>
          )}
      </Tarjeta>
    );
  }

  if (p.estado === 'sin_acceso') {
    return (
      <Tarjeta titulo={titulo}>
        <p>
          Esta cuenta existe en el panel pero no tiene usuario de acceso: no puede entrar y no se le puede reenviar el correo. Tampoco
          se puede volver a dar de alta con el mismo correo. La reparación todavía no existe en esta pantalla; pásalo a quien administra la base.
        </p>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo={titulo}>
      <p>{nombreDeRol(p.rol)} de {p.tenantNombre ?? 'una flota'}. {p.activa ? 'Cuenta activa.' : 'Cuenta de baja.'}</p>
      {p.activa && (
        <FormaConAviso accion={acciones.cambiarRol} boton="Cambiar rol" columnas="md:grid-cols-2">
          {oculto(p.id)}
          <CampoSelect etiqueta="Rol nuevo" name="rol" defaultValue={ROLES_INVITABLES.some((r) => r.valor === p.rol) ? p.rol : ''} required>
            <option value="" disabled>Elige un rol</option>
            {ROLES_INVITABLES.map((r) => <option key={r.valor} value={r.valor}>{r.rotulo}</option>)}
          </CampoSelect>
        </FormaConAviso>
      )}
      <div>
        {p.activa && (
          <FormaConAviso accion={acciones.reenviarAcceso} boton="Reenviar acceso" enLinea>{oculto(p.id)}</FormaConAviso>
        )}
        {p.activa && (
          <FormaConAviso accion={acciones.cerrarSesiones} boton="Cerrar sesiones" columnas="md:grid-cols-1"
            confirmar={{ titulo: `Cerrar las sesiones de ${nombre}`, descripcion: 'Tendrá que volver a entrar con su correo. Queda en la bitácora.', etiquetaConfirmar: 'Sí, cerrar sesiones' }}>
            {oculto(p.id)}
          </FormaConAviso>
        )}
        {p.activa && p.id !== yo && (
          <FormaConAviso accion={acciones.darDeBaja} boton="Dar de baja" columnas="md:grid-cols-1"
            confirmar={{
              titulo: `Dar de baja a ${nombre}`,
              descripcion: 'Pierde el acceso al panel, sus sesiones se cierran y se revocan sus llaves de API. No se permite si es el único dueño activo de la flota. Queda en la bitácora.',
              etiquetaConfirmar: 'Sí, dar de baja',
            }}>
            {oculto(p.id)}
          </FormaConAviso>
        )}
        {!p.activa && (
          <FormaConAviso accion={acciones.reactivar} boton="Reactivar" columnas="md:grid-cols-1"
            confirmar={{ titulo: `Reactivar a ${nombre}`, descripcion: 'Vuelve a entrar con el rol que tenía. Queda en la bitácora.', etiquetaConfirmar: 'Sí, reactivar' }}>
            {oculto(p.id)}
          </FormaConAviso>
        )}
      </div>
    </Tarjeta>
  );
}
