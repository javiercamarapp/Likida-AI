import { CampoSelect, CampoTexto, Casilla } from '../../ui-v2/componentes/campos';
import { FormaConAviso, type AccionDeForma } from '../ui/forma';
import { REGIMENES, USOS_CFDI } from '@/lib/saas/fiscal';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminFlotasEs } from '@/lib/i18n/tr_admin';
/**
 * El formulario de alta de una flota. Presentacional: la acción de servidor (`accionCrearFlota`, con su puerta, su segundo factor y su
 * bitácora) llega por prop. `planes === null` = no se pudieron leer los planes: se dice, no se ofrece un selector vacío como si no hubiera.
 */
export function AltaFlota({ accion, planes, t = trAdminFlotasEs }: { accion: AccionDeForma; planes: Array<{ clave: string; nombre: string }> | null; t?: TrDe<'admin_flotas'> }) {
  return (
    <div className="adm-forma-fina">
      <FormaConAviso accion={accion} boton={t('flotas_alta.dar_de_alta')} columnas="md:grid-cols-1">
        <CamposAltaFlota planes={planes} t={t} />
      </FormaConAviso>
    </div>
  );
}

/** Los campos del alta, sin envoltorio: los comparten el formulario de página (`AltaFlota`) y el cajón de «Nueva flota». */
export function CamposAltaFlota({ planes, t = trAdminFlotasEs }: { planes: Array<{ clave: string; nombre: string }> | null; t?: TrDe<'admin_flotas'> }) {
  return (
    <>
      <CampoTexto etiqueta={t('flotas_alta.nombre_de_la_flota')} name="nombre" required placeholder={t('flotas_alta.flota_de_ejemplo')} />
      {planes === null ? (
        <CampoTexto etiqueta={t('flotas_alta.plan')} name="planNoDisponible" disabled placeholder={t('flotas_alta.no_se_pudieron_leer')} ayuda={t('flotas_alta.asignalo_despues_desde_la')} />
      ) : (
        <CampoSelect etiqueta={t('flotas_alta.plan')} name="planClave" defaultValue="" ayuda={t('flotas_alta.empieza_en_prueba_no')}>
          <option value="">{t('flotas_alta.sin_plan_por_ahora')}</option>
          {planes.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
        </CampoSelect>
      )}
      <CampoTexto etiqueta="RFC" name="rfc" placeholder={t('flotas_alta.opcional')} ayuda={t('flotas_alta.se_rechaza_si_no')} />
      <CampoTexto etiqueta={t('flotas_alta.ciudad')} name="ciudad" placeholder={t('flotas_alta.opcional')} />
      <CampoTexto etiqueta={t('flotas_alta.razon_social')} name="razonSocial" placeholder={t('flotas_alta.opcional')}
        ayuda={t('flotas_alta.tal_cual_su_constancia')} />
      <CampoTexto etiqueta={t('flotas_alta.codigo_postal_fiscal')} name="codigoPostalFiscal" placeholder={t('flotas_alta.5_digitos_opcional')}
        ayuda={t('flotas_alta.el_del_domicilio_fiscal')} />
      <CampoSelect etiqueta={t('flotas_alta.uso_del_cfdi')} name="usoCfdi" defaultValue="">
        <option value="">{t('flotas_alta.sin_declarar')}</option>
        {USOS_CFDI.map((u) => <option key={u.clave} value={u.clave}>{u.clave} — {u.nombre}</option>)}
      </CampoSelect>
      <CampoSelect etiqueta={t('flotas_alta.regimen_fiscal')} name="regimenFiscal" defaultValue=""
        ayuda={t('flotas_alta.la_facilidad_del_15')}>
        <option value="">{t('flotas_alta.sin_declarar')}</option>
        {REGIMENES.map((r) => <option key={r.clave} value={r.clave}>{r.clave} — {r.nombre}</option>)}
      </CampoSelect>
      <CampoTexto etiqueta={t('flotas_alta.correo_del_administrador')} name="emailAdmin" tipo="email" placeholder={t('flotas_alta.dueno_flota_mx')}
        ayuda={t('flotas_alta.recibe_el_correo_de')} />
      <CampoTexto etiqueta={t('flotas_alta.nombre_del_administrador')} name="nombreAdmin" placeholder={t('flotas_alta.opcional')} />
      <CampoTexto etiqueta={t('flotas_alta.whatsapp_del_administrador')} name="telefonoAdmin" placeholder={t('flotas_alta.10_digitos_opcional')}
        ayuda={t('flotas_alta.con_el_el_bot')} />
      <Casilla name="dedicacionExclusivaCarga" etiqueta={t('flotas_alta.exclusivamente_autotransporte_de_carga')}
        ayuda={t('flotas_alta.habilita_la_facilidad_del')} />
    </>
  );
}
