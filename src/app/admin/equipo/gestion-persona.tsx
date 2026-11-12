import { CampoSelect } from '../../ui-v2/componentes/campos';
import { Tarjeta } from '../../ui-v2/componentes';
import { FormaConAviso, type AccionDeForma } from '../ui/forma';
import { ROLES_INVITABLES } from '@/lib/auth/invitar';
import { nombreDeRol } from '@/lib/auth/roles';
import type { Persona } from '@/lib/admin/personas';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminFlotasEs } from '@/lib/i18n/tr_admin';
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
export function GestionPersona({ p, acciones, yo, bajaLikidaHabilitada, t = trAdminFlotasEs }: {
  p: Persona;
  acciones: AccionesPersona;
  /** El id de quien mira: nadie se da de baja a sí mismo (el servidor también lo rechaza). */
  yo: string;
  bajaLikidaHabilitada: boolean; t?: TrDe<'admin_flotas'>;
}) {
  const nombre = p.nombre ?? p.email;
  const titulo = t('equipo_gestion_persona.gestionar_a', { nombre });

  if (p.esLikida) {
    return (
      <Tarjeta titulo={titulo}>
        <p>{nombreDeRol(p.rol)}{t('equipo_gestion_persona.personal_de_likida_no')}</p>
        {p.id === yo ? <p>{t('equipo_gestion_persona.es_tu_propia_cuenta')}</p>
          : !bajaLikidaHabilitada ? (
            <p>{t('equipo_gestion_persona.dar_de_baja_o')}</p>
          ) : p.activa ? (
            <FormaConAviso accion={acciones.darDeBajaLikida} boton="Dar de baja" columnas="md:grid-cols-1"
              confirmar={{
                titulo: t('equipo_gestion_persona.dar_de_baja_a', { nombre }),
                descripcion: p.rol === 'superadmin'
                  ? t('equipo_gestion_persona.pierde_el_acceso_a')
                  : t('equipo_gestion_persona.pierde_el_acceso_y'),
                etiquetaConfirmar: t('equipo_gestion_persona.si_dar_de_baja'),
              }}>
              {oculto(p.id)}
            </FormaConAviso>
          ) : (
            <FormaConAviso accion={acciones.reactivarLikida} boton="Reactivar" columnas="md:grid-cols-1"
              confirmar={{ titulo: t('equipo_gestion_persona.reactivar_a', { nombre }), descripcion: t('equipo_gestion_persona.vuelve_a_poder_entrar'), etiquetaConfirmar: t('equipo_gestion_persona.si_reactivar') }}>
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
          
          {t('equipo_gestion_persona.esta_cuenta_existe_en')}
        </p>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo={titulo}>
      <p>{nombreDeRol(p.rol)} de {p.tenantNombre ?? 'una flota'}. {p.activa ? t('equipo_gestion_persona.cuenta_activa') : t('equipo_gestion_persona.cuenta_de_baja')}</p>
      {p.activa && (
        <FormaConAviso accion={acciones.cambiarRol} boton="Cambiar rol" columnas="md:grid-cols-2">
          {oculto(p.id)}
          <CampoSelect etiqueta={t('equipo_gestion_persona.rol_nuevo')} name="rol" defaultValue={ROLES_INVITABLES.some((r) => r.valor === p.rol) ? p.rol : ''} required>
            <option value="" disabled>{t('equipo_gestion_persona.elige_un_rol')}</option>
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
            confirmar={{ titulo: t('equipo_gestion_persona.cerrar_las_sesiones_de', { nombre }), descripcion: t('equipo_gestion_persona.tendra_que_volver_a'), etiquetaConfirmar: t('equipo_gestion_persona.si_cerrar_sesiones') }}>
            {oculto(p.id)}
          </FormaConAviso>
        )}
        {p.activa && p.id !== yo && (
          <FormaConAviso accion={acciones.darDeBaja} boton="Dar de baja" columnas="md:grid-cols-1"
            confirmar={{
              titulo: t('equipo_gestion_persona.dar_de_baja_a', { nombre }),
              descripcion: t('equipo_gestion_persona.pierde_el_acceso_al'),
              etiquetaConfirmar: t('equipo_gestion_persona.si_dar_de_baja'),
            }}>
            {oculto(p.id)}
          </FormaConAviso>
        )}
        {!p.activa && (
          <FormaConAviso accion={acciones.reactivar} boton="Reactivar" columnas="md:grid-cols-1"
            confirmar={{ titulo: t('equipo_gestion_persona.reactivar_a', { nombre }), descripcion: t('equipo_gestion_persona.vuelve_a_entrar_con'), etiquetaConfirmar: t('equipo_gestion_persona.si_reactivar') }}>
            {oculto(p.id)}
          </FormaConAviso>
        )}
      </div>
    </Tarjeta>
  );
}
