'use client';

import { useT } from '@/lib/i18n/proveedor';
import { admin_flotas as admin_flotasEs } from '@/lib/i18n/es/admin_flotas';
import { CampoSelect } from '../../../ui-v2/componentes/campos';
import { FormaConAviso, type AccionDeForma } from '../../ui/forma';

/** La declaración del 15 % (RFA 2.9) de UNA flota: se ve y se corrige. Presentacional; la acción (`accionFacilidad`) llega por prop. */
export function Declaracion15({ flotaId, ded, reg, accion }: {
  flotaId: string;
  ded: boolean | undefined;
  reg: boolean | undefined;
  accion: AccionDeForma;
}) {
  const { t } = useT('admin_flotas', admin_flotasEs);
  const valor = (b: boolean | undefined) => (b === true ? 'si' : b === false ? 'no' : '');
  return (
    <FormaConAviso accion={accion} boton={t('cf6.decl_guardar')} columnas="md:grid-cols-2">
      <input type="hidden" name="flotaId" value={flotaId} />
      <CampoSelect etiqueta={t('cf6.decl_dedicacion')} name="ded" defaultValue={valor(ded)}>
        <option value="">{t('cf6.decl_sin_declarar')}</option>
        <option value="si">{t('cf6.decl_si')}</option>
        <option value="no">{t('cf6.decl_no')}</option>
      </CampoSelect>
      <CampoSelect etiqueta={t('cf6.decl_regimen')} name="reg" defaultValue={valor(reg)}>
        <option value="">{t('cf6.decl_sin_declarar')}</option>
        <option value="si">{t('cf6.decl_si')}</option>
        <option value="no">{t('cf6.decl_no')}</option>
      </CampoSelect>
    </FormaConAviso>
  );
}
