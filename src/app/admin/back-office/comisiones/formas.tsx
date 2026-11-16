'use client';

import { Boton, CampoFecha, CampoSelect, CampoTexto, FormaConAviso, type AccionDeForma } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { admin_backoffice } from '@/lib/i18n/es/admin_backoffice';

/** «Devengar periodo»: idempotente (repetirlo no duplica), pero toca el libro de comisiones: pide confirmación que dice qué hace. */
export function FormaDevengar({ accion, periodo, etiquetaMes, deshabilitadoPor }: { accion: AccionDeForma; periodo: string; etiquetaMes: string; deshabilitadoPor?: string | null }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  // Con las tablas ausentes no hay qué devengar: el botón se ve APAGADO y la razón queda a la vista (nunca desaparece sin explicación).
  if (deshabilitadoPor) {
    return (
      <div className="adm-pila">
        <div><Boton variante="secondary" tamano="sm" disabled>{t('comis.devengar')}</Boton></div>
        <p className="adm-din-nota">{deshabilitadoPor}</p>
      </div>
    );
  }
  return (
    <FormaConAviso
      accion={accion} boton={t('comis.devengar')} columnas="md:grid-cols-1"
      confirmar={{ titulo: t('comis.devengar_titulo'), descripcion: t('comis.devengar_desc', { mes: etiquetaMes }), etiquetaConfirmar: t('comis.devengar_si') }}
    >
      <input type="hidden" name="periodo" value={periodo} readOnly />
    </FormaConAviso>
  );
}

export function FormaCfdi({ accion, vendedorId, periodo, hoy }: { accion: AccionDeForma; vendedorId: string; periodo: string; hoy: string }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('vend_pago.registrar_cfdi')} enLinea>
      <input type="hidden" name="vendedorId" value={vendedorId} readOnly />
      <input type="hidden" name="periodo" value={periodo} readOnly />
      <CampoTexto etiqueta={t('vend_pago.f_uuid')} etiquetaOculta name="cfdiUuid" placeholder={t('vend_pago.f_uuid')} maxLength={36} obligatorio />
      <CampoFecha etiqueta={t('vend_pago.f_recibido')} etiquetaOculta name="recibidoEn" defaultValue={hoy} max={hoy} obligatorio />
    </FormaConAviso>
  );
}

export function FormaAutorizar({ accion, pagoId, montoTexto }: { accion: AccionDeForma; pagoId: string; montoTexto: string }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso
      accion={accion} boton={t('vend_pago.autorizar')} columnas="md:grid-cols-1"
      confirmar={{ titulo: t('vend_pago.autorizar_titulo'), descripcion: t('vend_pago.autorizar_desc', { monto: montoTexto }), etiquetaConfirmar: t('vend_pago.autorizar_si') }}
    >
      <input type="hidden" name="pagoId" value={pagoId} readOnly />
      <CampoTexto etiqueta={t('vend_pago.f_monto')} name="monto" inputMode="decimal" ayuda={t('vend_pago.f_monto_ayuda', { monto: montoTexto })} />
    </FormaConAviso>
  );
}

export function FormaPagado({ accion, pagoId, hoy, movimientos }: { accion: AccionDeForma; pagoId: string; hoy: string; movimientos: ReadonlyArray<{ id: string; etiqueta: string }> }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('vend_pago.marcar_pagado')} enLinea>
      <input type="hidden" name="pagoId" value={pagoId} readOnly />
      <CampoTexto etiqueta={t('vend_pago.f_referencia')} etiquetaOculta name="referenciaBanco" placeholder={t('vend_pago.f_referencia')} maxLength={120} />
      <CampoFecha etiqueta={t('vend_pago.f_pagado_en')} etiquetaOculta name="pagadoEn" defaultValue={hoy} max={hoy} obligatorio />
      {movimientos.length > 0 ? (
        <CampoSelect etiqueta={t('gastos.f_movimiento')} etiquetaOculta name="movimientoId" defaultValue="">
          <option value="">{t('gastos.f_sin_movimiento')}</option>
          {movimientos.map((m) => <option key={m.id} value={m.id}>{m.etiqueta}</option>)}
        </CampoSelect>
      ) : null}
    </FormaConAviso>
  );
}
