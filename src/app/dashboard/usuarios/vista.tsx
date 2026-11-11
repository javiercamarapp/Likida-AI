import { fechaMx } from '@/lib/formato';
import type { OpcionRol } from '@/lib/auth/invitar';
import { nombreDeRol } from '@/lib/auth/roles';
import {
  FormaInvitar, FormaCambiarRol, FormaDarDeBaja, FormaReactivar, FormaReenviarAcceso, FormaCerrarSesiones, type AccionForma,
} from './forma';
import { BotonEnlace, EstadoError, FilaTarjetas, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { MenuAcciones } from './menu-acciones';
import './usuarios.css';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

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
export function VistaUsuarios({ usuarios, userId, puedeInvitar, roles, rolesInvitar, acciones, t = T_RESTO_ES }: {
  usuarios: UsuarioRow[] | null;
  /** El de la sesión, para marcar "(tú)" en la lista y no ofrecerle baja. */
  userId: string;
  /** `puedeAdministrar(rol)`: invitar, cambiar rol, dar de baja, reenviar. */
  puedeInvitar: boolean;
  roles: ReadonlyArray<OpcionRol>;
  /** Los roles que ofrece SOLO el formulario de invitar (con `nomina` si aplica). Sin él, los mismos de `roles`. */
  rolesInvitar?: ReadonlyArray<OpcionRol>;
  acciones: AccionesEquipo; t?: TResto;
}) {
  const columnas: ColumnaBase<UsuarioRow>[] = [
    {
      id: 'nombre', titulo: t('llaves.nombre'), principal: true,
      celda: (u) => (
        <span className="rv-usu__nombre" data-baja={u.activo ? undefined : true}>
          {/* Sin nombre cae al correo, no a "—": una persona recién invitada sin nombre sería un renglón que no se puede distinguir de otro. */}
          {u.nombre ?? <span className="cifra-mono">{u.email}</span>}
          {u.id === userId && <span className="rv-usu__yo">{t('cfg.tu')}</span>}
          {u.nombre && <span className="rv-usu__correo cifra-mono">{u.email}</span>}
          {!u.activo && (
            <span className="rv-usu__correo">
              <StatusChip tono="bad">{t('cfg.dada_de_baja')}{u.desactivadoEn ? ` el ${fechaMx(u.desactivadoEn)}` : ''}</StatusChip>
            </span>
          )}
        </span>
      ),
    },
    {
      // Rol (Rovaq «Integrantes y accesos»): un select de 28 que cambia al elegir; quien no se administra (tú, Likida, una baja) ve el chip.
      id: 'rol', titulo: 'Rol',
      celda: (u) => (puedeInvitar && u.activo && u.id !== userId && u.rol !== 'superadmin'
        ? <FormaCambiarRol accion={acciones.cambiarRol} id={u.id} rolActual={u.rol} roles={roles} />
        : <StatusChip tono="neutral">{nombreDeRol(u.rol)}</StatusChip>),
    },
    { id: 'estado', titulo: t('llaves.estado'), celda: (u) => (u.activo ? <StatusChip tono="ok">{t('e26b.usu_activo')}</StatusChip> : <StatusChip tono="bad">{t('cfg.dada_de_baja')}</StatusChip>) },
    {
      id: 'wa', titulo: 'WhatsApp',
      celda: (u) => (u.telefono
        ? <span className="cifra-mono rv-usu__nombre" data-baja={u.activo ? undefined : true}>{u.telefono}</span>
        : <span className="rv-usu__sin">{t('cfg.sin_whatsapp_el_bot_no_lo')}</span>),
    },
    ...(puedeInvitar ? [{
      id: 'acciones', titulo: t('cfg.acciones'),
      celda: (u: UsuarioRow) => <Acciones t={t} u={u} esYo={u.id === userId} acciones={acciones} />,
    }] : []),
  ];

  const catalogoRoles = rolesInvitar ?? roles;

  return (
    <EsqueletoTablaMaestra titulo={t('cfg.usuarios_del_equipo')} apoyo={t('cfg.quien_entra_a_este_panel_y')}>
      {usuarios === null ? (
        <EstadoError accion={<BotonEnlace href="" tamano="sm">{t('cfg.reintentar')}</BotonEnlace>}>{t('cfg.no_se_pudo_cargar_el_equipo')}</EstadoError>
      ) : (
        <>
          {/* Rovaq «Equipo»: Invitar integrante | Qué puede hacer cada rol, lado a lado (sin tira de cifras). */}
          <FilaTarjetas variante="6-6">
            {puedeInvitar ? (
              <Tarjeta titulo={t('cfg.invitar_a_alguien_de_tu_equipo')} entra="tarjeta">
                <FormaInvitar accion={acciones.invitar} roles={catalogoRoles} />
              </Tarjeta>
            ) : (
              <p className="rv-usu__pie">{t('cfg.tu_rol_ve_el_equipo_pero')}</p>
            )}
            <Tarjeta titulo={t('e26.usu_que_puede_cada_rol')} info="usuarios.equipo">
              <div className="rv-usu__roles rv-usu__roles--lista">
                {catalogoRoles.map((r) => <p key={r.valor}><strong>{r.rotulo}:</strong> {r.detalle}</p>)}
              </div>
              <p className="rv-usu__aislamiento"><strong>{t('cfg.el_aislamiento_no_depende_de_esconder')}</strong> {t('cfg.cada_consulta_de_este_panel_va')}</p>
            </Tarjeta>
          </FilaTarjetas>

          <Tarjeta titulo={t('cfg.tu_equipo')} estado={usuarios.length === 0 ? 'vacio' : 'ok'} mensaje={t('cfg.no_hay_cuentas_dadas_de_alta')} detalle={t('cfg.cuando_invites_a_alguien_de_tu')} contenida>
            <TablaBase etiqueta={t('cfg.usuarios_y_su_rol')} columnas={columnas} filas={usuarios} idFila={(u) => u.id} densa altoMaximo={false} tarjetaMovil className="rv-usu__tabla" />
          </Tarjeta>
        </>
      )}
    </EsqueletoTablaMaestra>
  );
}

function Acciones({ u, esYo, acciones, t = T_RESTO_ES }: {
  u: UsuarioRow; esYo: boolean; acciones: AccionesEquipo; t?: TResto;
}) {
  // Un superadmin en la lista es personal de Likida: no se administra aquí
  // (el motor lo rechaza igual — esto solo evita ofrecer un botón que rebota).
  const administrable = !esYo && u.rol !== 'superadmin';
  if (!administrable) {
    return <span className="rv-usu__sin">{esYo ? t('cfg.tu_propia_cuenta_la_administra_otro') : 'Cuenta de Likida.'}</span>;
  }
  if (!u.activo) return <FormaReactivar accion={acciones.reactivar} id={u.id} />;
  return (
    // «Dar de baja» en peligro de 28 px a la vista (Rovaq «Revocar»); lo demás (reenviar acceso, cerrar sesiones) en el menú «Acciones».
    // Cada forma conserva su server action, su aviso y su diálogo de confirmación.
    <div className="rv-usu__celda-acciones">
      <MenuAcciones rotulo={t('cfg.acciones')} etiqueta={`Acciones de ${u.nombre ?? u.email}`}>
        <FormaReenviarAcceso accion={acciones.reenviarAcceso} id={u.id} />
        <FormaCerrarSesiones accion={acciones.cerrarSesiones} id={u.id} />
      </MenuAcciones>
      <FormaDarDeBaja accion={acciones.darDeBaja} id={u.id} nombre={u.nombre ?? u.email} />
    </div>
  );
}
