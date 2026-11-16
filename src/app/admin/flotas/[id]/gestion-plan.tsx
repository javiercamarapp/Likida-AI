'use client';

import { useActionState } from 'react';
import { CampoSelect } from '../../../ui-v2/componentes/campos';
import { BotonConfirmar } from '../../../ui-v2/componentes/confirmar';
import { Boton, clasesBoton } from '../../../ui-v2/componentes/boton';
import { useT } from '@/lib/i18n/proveedor';
import { admin_flotas as admin_flotasEs } from '@/lib/i18n/es/admin_flotas';
import { FormaConAviso, Aviso, type AccionDeForma, type ResultadoAccion } from '../../ui/forma';

/**
 * Asignar / cambiar / activar / pausar / cancelar el plan de ESTA flota (sección «Plan y cobro» de la ficha). Presentacional: la acción de
 * servidor (`accionGestionarPlan`, con su puerta, su segundo factor y su bitácora) llega por prop. Nada de aquí llama a Stripe: crea o mueve
 * la suscripción local que `emitirMensualidad` sabe cobrar por transferencia. Si el plan no tiene price ligado, la acción lo dice y no escribe.
 *
 * Activar y pausar son botones secundarios en UNA fila; «Cancelar suscripción» es el único destructivo: botón de peligro con diálogo que dice
 * el alcance (Rovaq: las acciones destructivas van en peligro, nunca como primario).
 */
export function GestionPlan({ tenantId, planes, accion }: {
  tenantId: string;
  /** `null` = no se pudieron leer los planes: se dice, no se ofrece un selector vacío como si no hubiera. */
  planes: Array<{ clave: string; nombre: string }> | null;
  accion: AccionDeForma;
}) {
  const { t } = useT('admin_flotas', admin_flotasEs);
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const oculto = (op: string) => (
    <>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="operacion" value={op} />
    </>
  );

  return (
    <div className="adm-plan">
      {planes === null ? (
        <p>{t('cf6.plan_no_se_pudieron_leer')}</p>
      ) : (
        <FormaConAviso accion={accion} boton={t('cf6.plan_asignar_o_cambiar')} columnas="md:grid-cols-1">
          {oculto('asignar')}
          <CampoSelect etiqueta={t('cf6.plan_etiqueta')} name="planClave" required defaultValue=""
            ayuda={t('cf6.plan_ayuda')}>
            <option value="" disabled>{t('cf6.plan_elige')}</option>
            {planes.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
          </CampoSelect>
        </FormaConAviso>
      )}
      <div className="adm-plan__fila">
        <form action={enviar}>
          {oculto('activar')}
          <Boton type="submit" variante="secondary" tamano="sm" disabled={pendiente}>{t('cf6.plan_activar')}</Boton>
        </form>
        <form action={enviar}>
          {oculto('pausar')}
          <Boton type="submit" variante="secondary" tamano="sm" disabled={pendiente}>{t('cf6.plan_pausar')}</Boton>
        </form>
        <form action={enviar}>
          {oculto('cancelar')}
          <BotonConfirmar
            etiqueta={t('cf6.plan_cancelar')} deshabilitado={pendiente} tono="peligro" className={clasesBoton('danger', 'sm')}
            titulo={t('cf6.plan_cancelar_titulo')}
            descripcion={t('cf6.plan_cancelar_desc')}
            etiquetaConfirmar={t('cf6.plan_cancelar_confirmar')}
          />
        </form>
      </div>
      <Aviso estado={estado} />
    </div>
  );
}
