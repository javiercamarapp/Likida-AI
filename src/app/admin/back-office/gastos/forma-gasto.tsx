'use client';

import { useState } from 'react';
import { CampoFecha, CampoSelect, CampoTexto, FormaConAviso, type AccionDeForma } from '@/app/ui-v2/componentes';
import { CATEGORIAS_GASTO, sugerirClasificacion, type CategoriaGasto } from '@/lib/backoffice/clasificador';
import { CADENCIAS_PROVEEDOR, CONCEPTOS_MANUALES, TIPOS_CUENTA } from '@/lib/backoffice/constantes-c';
import { useT } from '@/lib/i18n/proveedor';
import { admin_backoffice } from '@/lib/i18n/es/admin_backoffice';

/** Rótulo de cada categoría de proveedor/gasto (claves del diccionario, nunca texto suelto). */
const CLAVE_CATEGORIA: Record<CategoriaGasto, keyof typeof admin_backoffice> = {
  infraestructura: 'gastos.cat_infraestructura',
  ia_modelos: 'gastos.cat_ia_modelos',
  correo_observabilidad: 'gastos.cat_correo_observabilidad',
  legal_firma: 'gastos.cat_legal_firma',
  whatsapp: 'gastos.cat_whatsapp',
  otro: 'gastos.cat_otro',
};

const CLAVE_CADENCIA: Record<(typeof CADENCIAS_PROVEEDOR)[number], keyof typeof admin_backoffice> = {
  mensual: 'proveedores.cad_mensual',
  anual: 'proveedores.cad_anual',
  por_uso: 'proveedores.cad_por_uso',
};

const CLAVE_TIPO: Record<(typeof TIPOS_CUENTA)[number], keyof typeof admin_backoffice> = {
  banco: 'tesor.tipo_banco', stripe: 'tesor.tipo_stripe', caja: 'tesor.tipo_caja',
};

const CLAVE_CONCEPTO: Record<(typeof CONCEPTOS_MANUALES)[number], keyof typeof admin_backoffice> = {
  saldo_inicial: 'tesor.con_saldo_inicial', ingreso: 'tesor.con_ingreso', egreso: 'tesor.con_egreso', ajuste: 'tesor.con_ajuste',
};

export interface OpcionProveedor { id: string; nombre: string }

/** Alta manual de un gasto. La clave de idempotencia nace en el servidor al pintar la página: repetir el envío no duplica. */
export function FormaGasto({ accion, proveedores, claveIdem, hoy }: { accion: AccionDeForma; proveedores: readonly OpcionProveedor[]; claveIdem: string; hoy: string }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  const [moneda, setMoneda] = useState('MXN');
  const [comprobante, setComprobante] = useState('sin_comprobante');
  const [proveedorId, setProveedorId] = useState('');
  const [concepto, setConcepto] = useState('');
  const nombre = proveedores.find((p) => p.id === proveedorId)?.nombre ?? null;
  const sug = sugerirClasificacion({ proveedor: nombre, concepto });
  return (
    <FormaConAviso accion={accion} boton={t('gastos.f_guardar')} columnas="md:grid-cols-4">
      <input type="hidden" name="claveIdem" value={claveIdem} readOnly />
      <CampoSelect etiqueta={t('gastos.f_proveedor')} name="proveedorId" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
        <option value="">{t('gastos.f_sin_proveedor')}</option>
        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </CampoSelect>
      <CampoFecha etiqueta={t('gastos.f_fecha')} name="fecha" defaultValue={hoy} max={hoy} obligatorio />
      <CampoTexto etiqueta={t('gastos.f_concepto')} name="concepto" maxLength={200} value={concepto} onChange={(e) => setConcepto(e.target.value)} obligatorio />
      <CampoSelect etiqueta={t('gastos.f_moneda')} name="moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
        <option value="MXN">MXN</option>
        <option value="USD">USD</option>
      </CampoSelect>
      <CampoTexto etiqueta={t('gastos.f_monto')} name="monto" inputMode="decimal" ayuda={moneda === 'USD' ? t('gastos.f_monto_usd') : undefined} obligatorio />
      {moneda === 'USD' ? (
        <CampoTexto etiqueta={t('gastos.f_tipo_cambio')} name="tipoCambio" inputMode="decimal" ayuda={t('gastos.f_tipo_cambio_ayuda')} obligatorio />
      ) : null}
      <CampoSelect etiqueta={t('gastos.f_comprobante')} name="comprobante" value={comprobante} onChange={(e) => setComprobante(e.target.value)}>
        <option value="sin_comprobante">{t('gastos.comp_sin_comprobante')}</option>
        <option value="cfdi">{t('gastos.comp_cfdi')}</option>
        <option value="invoice_extranjero">{t('gastos.comp_invoice_extranjero')}</option>
      </CampoSelect>
      {comprobante === 'cfdi' ? (
        <>
          <CampoTexto etiqueta={t('gastos.f_uuid')} name="cfdiUuid" ayuda={t('gastos.f_uuid_ayuda')} obligatorio />
          <CampoTexto etiqueta={t('gastos.f_iva')} name="iva" inputMode="decimal" ayuda={t('gastos.f_iva_ayuda')} />
        </>
      ) : null}
      <CampoTexto
        etiqueta={t('gastos.f_cuenta')} name="cuentaContable" key={sug.cuentaContable ?? 'sin'} defaultValue={sug.cuentaContable ?? ''}
        ayuda={sug.categoria ? t('gastos.f_sugerencia', { categoria: t(CLAVE_CATEGORIA[sug.categoria]), regla: sug.coincidio ?? '' }) : t('gastos.f_sin_sugerencia')}
      />
    </FormaConAviso>
  );
}

/** Alta de un proveedor (con todos sus datos). */
export function FormaProveedor({ accion }: { accion: AccionDeForma }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('proveedores.f_guardar')} columnas="md:grid-cols-4">
      <CampoTexto etiqueta={t('proveedores.f_nombre')} name="nombre" maxLength={120} obligatorio />
      <CampoTexto etiqueta={t('proveedores.f_rfc')} name="rfc" maxLength={13} ayuda={t('proveedores.f_rfc_ayuda')} />
      <CampoSelect etiqueta={t('proveedores.f_categoria')} name="categoria" defaultValue="otro">
        {CATEGORIAS_GASTO.map((c) => <option key={c} value={c}>{t(CLAVE_CATEGORIA[c])}</option>)}
      </CampoSelect>
      <CampoSelect etiqueta={t('proveedores.f_cadencia')} name="cadencia" defaultValue="mensual">
        {CADENCIAS_PROVEEDOR.map((c) => <option key={c} value={c}>{t(CLAVE_CADENCIA[c])}</option>)}
      </CampoSelect>
    </FormaConAviso>
  );
}

/** El botón «Agregar proveedor» de un proveedor fijo conocido: nombre precargado, cero montos. */
export function FormaProveedorSugerido({ accion, nombre, categoria, cadencia }: { accion: AccionDeForma; nombre: string; categoria: string; cadencia: string }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('proveedores.agregar_nombre', { nombre })} enLinea>
      <input type="hidden" name="nombre" value={nombre} readOnly />
      <input type="hidden" name="categoria" value={categoria} readOnly />
      <input type="hidden" name="cadencia" value={cadencia} readOnly />
    </FormaConAviso>
  );
}

/** Conciliar un gasto: EXIGE una referencia de banco o un movimiento de tesorería. */
export function FormaConciliar({ accion, gastoId, movimientos }: { accion: AccionDeForma; gastoId: string; movimientos: ReadonlyArray<{ id: string; etiqueta: string }> }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('gastos.conciliar')} enLinea>
      <input type="hidden" name="gastoId" value={gastoId} readOnly />
      <CampoTexto etiqueta={t('gastos.f_referencia')} etiquetaOculta name="referenciaBanco" placeholder={t('gastos.f_referencia')} maxLength={120} />
      {movimientos.length > 0 ? (
        <CampoSelect etiqueta={t('gastos.f_movimiento')} etiquetaOculta name="movimientoId" defaultValue="">
          <option value="">{t('gastos.f_sin_movimiento')}</option>
          {movimientos.map((m) => <option key={m.id} value={m.id}>{m.etiqueta}</option>)}
        </CampoSelect>
      ) : null}
    </FormaConAviso>
  );
}

/** Anular un gasto: motivo obligatorio; nunca se borra. */
export function FormaAnular({ accion, gastoId }: { accion: AccionDeForma; gastoId: string }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('gastos.anular')} enLinea>
      <input type="hidden" name="gastoId" value={gastoId} readOnly />
      <CampoTexto etiqueta={t('gastos.f_motivo')} etiquetaOculta name="motivo" placeholder={t('gastos.f_motivo')} maxLength={200} obligatorio />
    </FormaConAviso>
  );
}

export function FormaCuenta({ accion }: { accion: AccionDeForma }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('tesor.f_guardar_cuenta')} columnas="md:grid-cols-2">
      <CampoTexto etiqueta={t('tesor.f_nombre')} name="nombre" maxLength={80} obligatorio />
      <CampoSelect etiqueta={t('tesor.f_tipo')} name="tipo" defaultValue="banco">
        {TIPOS_CUENTA.map((c) => <option key={c} value={c}>{t(CLAVE_TIPO[c])}</option>)}
      </CampoSelect>
    </FormaConAviso>
  );
}

export function FormaMovimiento({ accion, cuentas, claveIdem, hoy }: { accion: AccionDeForma; cuentas: ReadonlyArray<{ id: string; nombre: string }>; claveIdem: string; hoy: string }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('tesor.f_guardar_mov')} columnas="md:grid-cols-4">
      <input type="hidden" name="claveIdem" value={claveIdem} readOnly />
      <CampoSelect etiqueta={t('tesor.f_cuenta')} name="cuentaId" obligatorio>
        {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </CampoSelect>
      <CampoFecha etiqueta={t('gastos.f_fecha')} name="fecha" defaultValue={hoy} max={hoy} obligatorio />
      <CampoSelect etiqueta={t('tesor.f_concepto')} name="concepto" defaultValue="ingreso">
        {CONCEPTOS_MANUALES.map((c) => <option key={c} value={c}>{t(CLAVE_CONCEPTO[c])}</option>)}
      </CampoSelect>
      <CampoTexto etiqueta={t('gastos.f_monto')} name="monto" inputMode="decimal" ayuda={t('tesor.f_monto_ayuda')} obligatorio />
      <CampoTexto etiqueta={t('tesor.f_nota')} name="nota" maxLength={300} />
    </FormaConAviso>
  );
}

export function FormaReversa({ accion, movimientoId }: { accion: AccionDeForma; movimientoId: string }) {
  const { t } = useT('admin_backoffice', admin_backoffice);
  return (
    <FormaConAviso accion={accion} boton={t('tesor.reversar')} enLinea>
      <input type="hidden" name="movimientoId" value={movimientoId} readOnly />
      <CampoTexto etiqueta={t('gastos.f_motivo')} etiquetaOculta name="motivo" placeholder={t('gastos.f_motivo')} maxLength={200} obligatorio />
    </FormaConAviso>
  );
}
