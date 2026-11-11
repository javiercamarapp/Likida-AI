import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { fechaMx, mxn, numero } from '@/lib/formato';
import { listarFacturasSaas, type FacturaSaasFila } from '@/lib/saas/transferencia';
import { Aviso, BarraFiltros, BotonEnlace, Disclosure, EstadoError, FiltroFecha, FiltroOpciones, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { BotonExportarFacturas } from './boton-exportar';
import { leerFiltros, rangoAlReves } from './filtros';
import { hrefConParams } from '@/app/ui-v2/datos';
import '../dinero.css';

import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/facturas — Facturación › Facturas. Las mensualidades que Likida emitió a sus flotas: pendientes, pagadas, fallidas y
// canceladas, con la referencia del pago y su CFDI, y la exportación para el contador. Solo LEE (emitir, marcar pagada y timbrar viven
// en Planes y cobro). Todo sale de las filas de `factura_saas`: lo que la fila no tiene se dice («—», «Sin timbrar»), no se rellena.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántas filas se pintan. Si la base tiene más, la pantalla lo dice y las cifras no suman un total parcial. */
const FILAS_EN_PANTALLA = 500;

const TONO: Record<string, TonoEstado> = { pagada: 'ok', pendiente: 'warn', fallida: 'bad', cancelada: 'muted' };
const ROTULO: Record<string, string> = { pagada: 'Pagada', pendiente: 'Pendiente', fallida: 'Fallida', cancelada: 'Cancelada' };

function celdaCfdi(f: FacturaSaasFila) {
  if (f.cfdiCanceladoEn) return <StatusChip tono="muted">CFDI cancelado</StatusChip>;
  if (f.cfdiUuid) {
    return (
      <>
        <span title={f.cfdiUuid}>{f.cfdiUuid.slice(0, 8)}…</span>
        {f.cfdiVerificacionUrl ? <> <a href={f.cfdiVerificacionUrl} target="_blank" rel="noopener noreferrer">Verificar en el SAT</a></> : null}
      </>
    );
  }
  if (f.estado === 'pagada') return <StatusChip tono="warn">Sin timbrar</StatusChip>;
  return '—';
}

export default async function FacturasPage({ searchParams }: { searchParams: Promise<{ estado?: string; desde?: string; hasta?: string; ver?: string }> }) {
  const { t } = await getT('admin_dinero');
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const filtros = leerFiltros(sp);
  const ver = typeof sp.ver === 'string' ? sp.ver : '';
  const alReves = rangoAlReves(filtros);
  let lectura: Awaited<ReturnType<typeof listarFacturasSaas>> | null = null;
  if (!alReves) {
    try { lectura = await listarFacturasSaas({ ...filtros, limite: FILAS_EN_PANTALLA }); } catch (e) { logger.error('admin.facturas', { err: e instanceof Error ? e.message : String(e) }); }
  }
  const filas = lectura?.filas ?? [];
  const recortada = lectura?.truncado ?? false;
  const nFiltros = Object.keys(filtros).length;

  // Sumas sobre lo cargado: solo valen si la lista está completa. Una cancelada no es dinero facturado.
  const suma = (pred: (f: FacturaSaasFila) => boolean) => filas.filter(pred).reduce((s, f) => s + f.monto, 0);
  const cuenta = (pred: (f: FacturaSaasFila) => boolean) => filas.filter(pred).length;
  const completa = lectura !== null && !recortada;
  const errorCifra = (etiqueta: string) => ({ etiqueta, valor: null, estado: 'error' as const, mensaje: recortada ? t('facturas.la_lista_esta_recortada') : t('facturas.no_se_pudo_leer'), reintentar: true });

  const paramsFiltros: Record<string, string | undefined> = { ...filtros };
  const hrefVer = (id: string) => hrefConParams('/admin/facturas', paramsFiltros, { ver: id });
  const hrefCerrar = hrefConParams('/admin/facturas', paramsFiltros, {});
  const posicion = ver ? filas.findIndex((f) => f.id === ver) : -1;
  const sel = posicion >= 0 ? filas[posicion] : null;

  const cifras: PropsCifra[] = [
    completa
      ? { etiqueta: t('facturas.facturado'), valor: suma((f) => f.estado !== 'cancelada'), formato: 'mxn', nota: `${numero(cuenta((f) => f.estado !== 'cancelada'))} facturas, sin contar canceladas.` }
      : errorCifra('Facturado'),
    completa
      ? { etiqueta: t('facturas.cobrado'), valor: suma((f) => f.estado === 'pagada'), formato: 'mxn', nota: `${numero(cuenta((f) => f.estado === 'pagada'))} pagadas.`, tono: 'ok' }
      : errorCifra('Cobrado'),
    completa
      ? { etiqueta: t('facturas.por_cobrar'), valor: suma((f) => f.estado === 'pendiente' || f.estado === 'fallida'), formato: 'mxn', nota: `${numero(cuenta((f) => f.estado === 'pendiente' || f.estado === 'fallida'))} pendientes o fallidas.`, tono: cuenta((f) => f.estado === 'pendiente' || f.estado === 'fallida') > 0 ? 'warn' : undefined }
      : errorCifra(t('facturas.por_cobrar')),
    completa
      ? { etiqueta: t('facturas.pagadas_sin_cfdi'), valor: cuenta((f) => f.estado === 'pagada' && !f.cfdiUuid), nota: t('facturas.cobradas_pero_sin_timbrar'), tono: cuenta((f) => f.estado === 'pagada' && !f.cfdiUuid) > 0 ? 'warn' : 'ok' }
      : errorCifra(t('facturas.pagadas_sin_cfdi')),
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('facturas.facturacion')}
      apoyo={t('facturas.las_mensualidades_que_likida')}
      acciones={<BotonExportarFacturas estado={filtros.estado} desde={filtros.desde} hasta={filtros.hasta} deshabilitado={alReves || lectura === null || (completa && filas.length === 0)} />}
      filtros={(
        <BarraFiltros accion="/admin/facturas" enLinea etiqueta={t('facturas.filtrar_facturas')} nActivos={nFiltros} limpiarHref="/admin/facturas">
          <FiltroOpciones
            etiqueta={t('facturas.estado')} nombre="estado" valor={filtros.estado ?? ''}
            opciones={[{ valor: 'pendiente', rotulo: 'Pendiente' }, { valor: 'pagada', rotulo: 'Pagada' }, { valor: 'fallida', rotulo: 'Fallida' }, { valor: 'cancelada', rotulo: 'Cancelada' }]}
          />
          <FiltroFecha nombre="desde" etiqueta={t('facturas.periodo_desde')} valor={filtros.desde} />
          <FiltroFecha nombre="hasta" etiqueta={t('facturas.periodo_hasta')} valor={filtros.hasta} />
        </BarraFiltros>
      )}
      avisos={(
        <>
          {alReves ? <Aviso tono="warn" titulo={t('facturas.el_rango_esta_al')}>{t('facturas.la_fecha_desde_es')}</Aviso> : null}
          {recortada ? (
            <Aviso tono="warn" titulo={t('facturas.se_muestran_de_facturas', { length: numero(filas.length), lectura: numero(lectura!.total) })}>
          
              {t('facturas.la_lista_esta_recortada_2')}
            </Aviso>
          ) : null}

        </>
      )}
      etiquetaCifras={t('facturas.facturas_de_la_mensualidad')}
      cifras={cifras}
      vistaRapida={sel ? (
        <CajonVistaRapida
          titulo={sel.tenantNombre} subtitulo={t('facturas.vr_subtitulo', { n: posicion + 1, total: filas.length })} hrefCerrar={hrefCerrar}
          cifras={[
            { etiqueta: t('facturas.total'), valor: mxn(sel.monto) },
            { etiqueta: t('facturas.estado'), valor: ROTULO[sel.estado] ?? sel.estado },
            { etiqueta: t('facturas.periodo'), valor: `${sel.periodoInicio} a ${sel.periodoFin}` },
            { etiqueta: t('facturas.pago'), valor: sel.pagadaEn ? fechaMx(sel.pagadaEn) : '—' },
          ]}
          pie={<BotonEnlace variante="suave" href="/admin/costos-facturacion">{t('facturas.vr_abrir')}</BotonEnlace>}
        />
      ) : null}
    >
      {lectura === null && !alReves ? (
        <EstadoError reintentar>{t('facturas.no_se_pudieron_leer')}</EstadoError>
      ) : (
        <Tarjeta titulo={t('facturas.facturas')} estado={filas.length === 0 ? 'vacio' : 'ok'} mensaje={nFiltros > 0 ? t('facturas.ninguna_factura_con_ese') : t('facturas.aun_no_hay_facturas')}
          detalle={nFiltros > 0 ? t('facturas.quita_el_filtro_o') : t('facturas.aparecen_aqui_en_cuanto')}>
          <TablaBase
            etiqueta={t('facturas.facturas_de_la_mensualidad')} idFila={(f) => f.id} tarjetaMovil densa filas={filas}
            columnas={[
              { id: 'flota', titulo: t('facturas.flota'), principal: true, celda: (f) => f.tenantNombre },
              { id: 'periodo', titulo: t('facturas.periodo'), celda: (f) => `${f.periodoInicio} a ${f.periodoFin}` },
              { id: 'estado', titulo: t('facturas.estado'), celda: (f) => <StatusChip tono={TONO[f.estado] ?? 'neutral'}>{ROTULO[f.estado] ?? f.estado}</StatusChip> },
              {
                id: 'total', titulo: t('facturas.total'), alinear: 'der',
                celda: (f) => (
                  <>
                    {mxn(f.monto)}
                    <span className="adm-din-sub">{f.subtotal === null || f.iva === null ? t('facturas.sin_desglose_no_se') : `${mxn(f.subtotal)} + IVA ${mxn(f.iva)}`}</span>
                  </>
                ),
              },
              {
                id: 'pago', titulo: t('facturas.pago'),
                celda: (f) => (f.pagadaEn
                  ? <>{fechaMx(f.pagadaEn)}<span className="adm-din-sub">{f.referenciaBanco ? `Ref. ${f.referenciaBanco}` : t('facturas.sin_referencia_del_banco')}</span></>
                  : <>—<span className="adm-din-sub">{f.referencia ? t('facturas.ref_de_pago', { referencia: f.referencia }) : ''}</span></>),
              },
              { id: 'cfdi', titulo: 'CFDI', celda: celdaCfdi },
              { id: 'vr', titulo: '', alinear: 'der', celda: (f) => <BotonEnlace href={hrefVer(f.id)} variante="ghost" tamano="sm">{t('facturas.vista_rapida')}</BotonEnlace> },
            ]}
          />
        </Tarjeta>
      )}

      <Disclosure titulo={t('facturas.que_incluye_y_que')} resumen="Exportación y XML o PDF">
        <p className="adm-din-nota">
          
          {t('facturas.el_archivo_del_contador')}
        </p>
      </Disclosure>
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_dinero');
  return { title: t('facturas.facturas') };
}
