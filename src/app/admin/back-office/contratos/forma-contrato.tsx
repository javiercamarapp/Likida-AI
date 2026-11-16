import { CampoFecha, CampoSelect, CampoTexto, CampoTextarea, Casilla, FormaConAviso, type AccionDeForma } from '@/app/ui-v2/componentes';
import { TIPOS_CONTRATO } from '@/lib/backoffice/vencimientos';
import type { Contrato } from '@/lib/backoffice/contratos';
import type { TrDe } from '@/lib/i18n/tr_tipos';

/** Alta y edición de un contrato. Con `contrato` la forma edita (lleva el `id` oculto); sin él, da de alta. Va en servidor: solo compone campos nativos. */
export function FormaContrato({ accion, t, contrato }: { accion: AccionDeForma; t: TrDe<'admin_backoffice'>; contrato?: Contrato | null }) {
  const c = contrato ?? null;
  const centavos = c ? c.costoMensualCent : null;
  const pesos = centavos === null ? '' : (centavos / 100).toFixed(2);
  return (
    <FormaConAviso accion={accion} boton={c ? t('contratos.guardar_cambios') : t('contratos.guardar_contrato')} columnas="md:grid-cols-2">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <CampoSelect etiqueta={t('contratos.f_tipo')} name="tipo" obligatorio defaultValue={c?.tipo ?? ''}>
        <option value="">{t('contratos.elige')}</option>
        {TIPOS_CONTRATO.map((k) => <option key={k} value={k}>{t(`contratos.tipo_${k}` as const)}</option>)}
      </CampoSelect>
      <CampoTexto etiqueta={t('contratos.f_contraparte')} name="contraparte" obligatorio maxLength={200} defaultValue={c?.contraparte ?? ''} />
      <CampoFecha etiqueta={t('contratos.f_firmado')} name="firmadoEl" defaultValue={c?.firmadoEl ?? ''} ayuda={t('contratos.f_firmado_ayuda')} />
      <CampoFecha etiqueta={t('contratos.f_vence')} name="venceEl" defaultValue={c?.venceEl ?? ''} ayuda={t('contratos.f_vence_ayuda')} />
      <CampoTexto etiqueta={t('contratos.f_dias_aviso')} name="diasAviso" defaultValue={c ? c.diasAviso.join(', ') : ''} ayuda={t('contratos.f_dias_aviso_ayuda')} />
      <CampoTexto etiqueta={t('contratos.f_responsable')} name="responsable" maxLength={120} defaultValue={c?.responsable ?? ''} ayuda={t('contratos.f_responsable_ayuda')} />
      <CampoTexto etiqueta={t('contratos.f_costo')} name="costoMensual" inputMode="decimal" defaultValue={pesos} ayuda={t('contratos.f_costo_ayuda')} />
      <CampoTexto etiqueta={t('contratos.f_documento')} name="documentoUrl" maxLength={500} defaultValue={c?.documentoUrl ?? ''} ayuda={t('contratos.f_documento_ayuda')} />
      <CampoSelect etiqueta={t('contratos.f_estado')} name="estado" defaultValue={c?.estado === 'vigente' ? 'vigente' : 'borrador'} ayuda={t('contratos.f_estado_ayuda')}>
        <option value="borrador">{t('contratos.estado_borrador')}</option>
        <option value="vigente">{t('contratos.estado_vigente')}</option>
      </CampoSelect>
      <Casilla etiqueta={t('contratos.f_renovacion_auto')} name="renovacionAuto" defaultChecked={c?.renovacionAuto ?? false} />
      <CampoTextarea etiqueta={t('contratos.f_descripcion')} name="descripcion" maxLength={1000} defaultValue={c?.descripcion ?? ''} />
    </FormaConAviso>
  );
}
