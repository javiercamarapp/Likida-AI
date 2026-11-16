import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { hoyMx, mxn } from '@/lib/formato';
import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { Aviso, AvisoCompacto, FilaTarjetas, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { BarList, Columnas, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { uniformes } from '../../cifras-uniformes';
import { observadas } from '../../sello-observado';
import {
  devengadoPorMes, leerClientesCerrados, leerMovimientosComision, leerPagosVendedor, leerReglasVigentes, leerVendedoresBasico, resumenPorVendedor, type FilaVendedor,
} from '@/lib/backoffice/comisiones';
import { listarMovimientos, movimientosConciliables, movimientosUsados } from '@/lib/backoffice/tesoreria';
import { esPeriodoValido, periodoMesActualMx } from '@/lib/backoffice/utiles-c';
import { etiquetaMes } from '@/lib/backoffice/periodo';
import { SelectorMes } from '../selector-mes';
import { accionAutorizarPago, accionDevengarPeriodo, accionMarcarPagado, accionRegistrarCfdi } from './acciones';
import { FormaAutorizar, FormaCfdi, FormaDevengar, FormaPagado } from './formas';
import '../../dinero.css';
import '../../resumen.css';
import './comisiones.css';

export const dynamic = 'force-dynamic';

const TONO_PAGO: Record<'borrador' | 'autorizado' | 'pagado', TonoEstado> = { borrador: 'warn', autorizado: 'info', pagado: 'ok' };
const rotuloPago = (e: 'borrador' | 'autorizado' | 'pagado', t: TrDe<'admin_backoffice'>): string => ({
  borrador: t('vend_pago.est_borrador'), autorizado: t('vend_pago.est_autorizado'), pagado: t('vend_pago.est_pagado'),
})[e];

function periodoDeParametro(mes: string | undefined, actual: string): string {
  const cand = mes && /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : mes;
  return esPeriodoValido(cand) && cand <= actual ? cand : actual;
}

const pctTexto = (bps: readonly number[]): string => (bps.length === 0 ? '—' : bps.map((b) => `${b / 100} %`).join(' / '));

export default async function ComisionesPage({ searchParams }: { searchParams?: Promise<{ mes?: string }> }) {
  await requireSuperadmin();
  const { t, idioma } = await getT('admin_backoffice');
  const hoy = hoyMx();
  const actual = periodoMesActualMx(hoy);
  const periodo = periodoDeParametro(((await searchParams) ?? {}).mes, actual);

  const [vendedores, movs, pagos, clientes, reglas, movsTes, usados] = await Promise.all([
    leerVendedoresBasico(),
    leerMovimientosComision(),
    leerPagosVendedor(),
    leerClientesCerrados(),
    leerReglasVigentes(),
    listarMovimientos(),
    movimientosUsados().catch(() => new Set<string>() as ReadonlySet<string>),
  ]);

  const completo = vendedores.estado === 'ok' && movs.estado === 'ok' && pagos.estado === 'ok';
  const hayError = [vendedores, movs, pagos].some((l) => l.estado === 'error');
  const filas: FilaVendedor[] = completo ? resumenPorVendedor(vendedores.dato.map((v) => ({ id: v.id, nombre: v.nombre })), movs.dato, pagos.dato, periodo) : [];
  const emailDe = new Map(vendedores.estado === 'ok' ? vendedores.dato.map((v) => [v.id, v.email]) : []);
  const suma = (f: (x: FilaVendedor) => number) => filas.reduce((s, x) => s + f(x), 0);
  const estadoSinDato = hayError ? 'error' as const : 'vacio' as const;
  const sinDato = { valor: null, estado: estadoSinDato, mensaje: t('bo.no_disponible') } as const;
  const pagosVivos = pagos.estado === 'ok' ? pagos.dato : [];
  const opcionesMov = movsTes.estado === 'ok'
    ? movimientosConciliables(movsTes.dato, usados, 'egreso').slice(0, 30).map((m) => ({ id: m.id, etiqueta: `${m.fecha} · ${m.cuentaNombre ?? '—'} · ${mxn(-m.montoCent / 100)}` }))
    : [];
  const mesesGrafica = movs.estado === 'ok' ? devengadoPorMes(movs.dato.filter((m) => m.tipo === 'devengo'), periodo, 6) : [];

  const cifras: PropsCifra[] = completo ? observadas(uniformes([
    { etiqueta: t('comis.c_base'), valor: mxn(suma((f) => f.cobradoBaseCent) / 100), nota: t('comis.c_base_nota') },
    { etiqueta: t('comis.c_devengado'), valor: mxn(suma((f) => f.devengadoCent) / 100), serie: mesesGrafica.map((m) => (m.montoCent === null ? null : m.montoCent / 100)) },
    { etiqueta: t('comis.c_ajustes'), valor: mxn(suma((f) => f.clawbackCent) / 100), nota: t('comis.c_ajustes_nota') },
    { etiqueta: t('comis.c_por_pagar'), valor: mxn(suma((f) => f.saldo.porPagarCent) / 100), nota: suma((f) => f.saldo.arrastreCent) > 0 ? t('comis.c_arrastre', { monto: mxn(suma((f) => f.saldo.arrastreCent) / 100) }) : undefined },
    {
      etiqueta: t('comis.c_pagos'), valor: pagosVivos.filter((p) => p.estado === 'autorizado' || p.estado === 'borrador').length,
      nota: t('pul9.pagos_total_nota', { a: pagosVivos.filter((p) => p.estado === 'autorizado').length, b: pagosVivos.filter((p) => p.estado === 'borrador').length }),
    },
  ]), t('gastos.observado')) : uniformes([
    { etiqueta: t('comis.c_base'), ...sinDato }, { etiqueta: t('comis.c_devengado'), ...sinDato }, { etiqueta: t('comis.c_ajustes'), ...sinDato },
    { etiqueta: t('comis.c_por_pagar'), ...sinDato }, { etiqueta: t('comis.c_pagos'), ...sinDato },
  ]);

  const sinTablas = [vendedores, movs, pagos].some((l) => l.estado === 'no_disponible');
  const sinCobros = completo && clientes.estado === 'ok' && clientes.dato.length === 0;
  const avisos = (
    <>
      {hayError ? <Aviso tono="error" titulo={t('gastos.aviso_error_titulo')}>{t('comis.aviso_error')}</Aviso> : null}
      <AvisoCompacto
        tono="info"
        resumen={sinCobros ? t('comis.aviso_sin_cobros') : t('comis.aviso_manual')}
        mas={t('comis.aviso_mas')}
      />
    </>
  );

  const pasos = (
    <FilaTarjetas variante="6-6" className="adm-fila-pareja">
      <Tarjeta titulo={t('comis.regla_titulo')} contenida>
        <ul className="bo-com-regla">
          <li><span className="bo-com-regla__rotulo">{t('comis.regla_primer')}</span> {`${reglas.primerMesBp / 100} %`}</li>
          <li><span className="bo-com-regla__rotulo">{t('comis.regla_recurrente')}</span> {`${reglas.recurrenteBp / 100} %`}</li>
          <li><span className="bo-com-regla__rotulo">{t('comis.regla_base')}</span> {t('comis.regla_base_valor')}</li>
          <li>
            <span className="bo-com-regla__rotulo">{t('comis.regla_vigencia')}</span>{' '}
            {reglas.vigenciaMeses === null ? t('comis.vigencia_no_definida') : t('comis.vigencia_n', { n: reglas.vigenciaMeses })}
          </li>
        </ul>
        <p className="adm-din-nota">{t('comis.regla_nota')}</p>
      </Tarjeta>
      <Tarjeta titulo={t('comis.devengar_tarjeta', { mes: etiquetaMes(periodo, idioma) })} contenida>
        <p className="adm-din-nota">{t('comis.devengar_nota')}</p>
        <FormaDevengar accion={accionDevengarPeriodo} periodo={periodo} etiquetaMes={etiquetaMes(periodo, idioma)} deshabilitadoPor={sinTablas ? t('comis.sin_tabla_detalle') : null} />
      </Tarjeta>
    </FilaTarjetas>
  );

  const graficas = [
    <Tarjeta key="mes" titulo={t('comis.g_por_mes')} estado={movs.estado === 'ok' ? 'ok' : movs.estado === 'error' ? 'error' : 'vacio'} mensaje={t('bo.no_disponible')} detalle={t('comis.sin_tabla_detalle')} reintentar>
      <Columnas
        datos={mesesGrafica.map((m) => ({ etiqueta: `${m.periodo.slice(5, 7)}/${m.periodo.slice(2, 4)}`, valor: m.montoCent === null ? null : m.montoCent / 100 }))}
        etiqueta={t('comis.g_por_mes')} formato="mxnCompacto" matiz={8} alto={120} variacion={false} vacio={t('comis.g_sin_movimientos')}
      />
      <p className="adm-din-nota">{t('comis.g_por_mes_nota')}</p>
    </Tarjeta>,
    <Tarjeta key="vend" titulo={t('comis.g_por_vendedor')} estado={completo ? 'ok' : hayError ? 'error' : 'vacio'} mensaje={t('bo.no_disponible')} detalle={t('comis.sin_tabla_detalle')} reintentar>
      {filas.every((f) => f.devengadoCent === 0) ? (
        <p className="adm-din-nota">{t('comis.g_sin_devengo')}</p>
      ) : (
        <BarList
          etiqueta={t('comis.g_por_vendedor')} matiz={8}
          items={filas.filter((f) => f.devengadoCent !== 0).map((f) => ({ clave: f.vendedorId, etiqueta: f.nombre, valor: f.devengadoCent / 100, texto: mxn(f.devengadoCent / 100) }))}
        />
      )}
    </Tarjeta>,
  ];

  return (
    <EsqueletoPanelCifras
      titulo={t('pul9.h_comisiones')} apoyo={t('comis.apoyo')} etiquetaCifras={t('comis.c_etiqueta')}
      avisos={avisos} cifras={cifras} graficas={graficas} variante="8-4"
    >
      <Tarjeta
        titulo={t('comis.tabla_titulo', { mes: etiquetaMes(periodo, idioma) })}
        estado={completo ? 'ok' : hayError ? 'error' : 'vacio'} mensaje={t('bo.no_disponible')} detalle={t('comis.sin_tabla_detalle')} reintentar
        acciones={<SelectorMes t={t} base="/admin/back-office/comisiones" param="mes" periodo={periodo} tope={actual} />}
      >
        <TablaBase
          etiqueta={t('comis.tabla_titulo', { mes: etiquetaMes(periodo, idioma) })} idFila={(f) => f.vendedorId} tarjetaMovil filas={filas}
          vacio={{ titulo: t('comis.vacio_titulo'), texto: t('comis.vacio_texto') }}
          columnas={[
            {
              id: 'vendedor', titulo: t('comis.col_vendedor'), principal: true,
              celda: (f) => (
                <span className="bo-com-celda">
                  <span className="bo-com-celda__nombre">{f.nombre}</span>
                  <span className="bo-com-celda__tenue">{emailDe.get(f.vendedorId) ?? ''}</span>
                </span>
              ),
            },
            { id: 'base', titulo: t('comis.col_base'), alinear: 'der', celda: (f) => mxn(f.cobradoBaseCent / 100) },
            { id: 'pct', titulo: t('comis.col_pct'), alinear: 'der', celda: (f) => pctTexto(f.pctsBp) },
            { id: 'devengado', titulo: t('comis.col_devengado'), alinear: 'der', celda: (f) => mxn(f.devengadoCent / 100) },
            { id: 'ajustes', titulo: t('comis.col_ajustes'), alinear: 'der', celda: (f) => mxn(f.clawbackCent / 100) },
            {
              id: 'saldo', titulo: t('comis.col_saldo'), alinear: 'der',
              celda: (f) => (
                <span className="bo-com-celda">
                  <span className="bo-com-celda__nombre">{mxn(f.saldo.saldoCent / 100)}</span>
                  {f.saldo.arrastrar ? <StatusChip tono="warn">{t('comis.se_arrastra')}</StatusChip> : null}
                </span>
              ),
            },
            {
              id: 'cfdi', titulo: t('comis.col_cfdi'),
              celda: (f) => (f.pago?.cfdiUuid ? (
                <span className="bo-com-celda">
                  <span className="bo-com-celda__nombre">{f.pago.cfdiUuid.slice(0, 8)}…</span>
                  <span className="bo-com-celda__tenue">{f.pago.cfdiRecibidoEn ?? '—'}</span>
                </span>
              ) : f.saldo.porPagarCent > 0 ? (
                <FormaCfdi accion={accionRegistrarCfdi} vendedorId={f.vendedorId} periodo={periodo} hoy={hoy} />
              ) : <span className="bo-com-celda__tenue">{t('comis.sin_saldo')}</span>),
            },
            {
              id: 'pago', titulo: t('comis.col_pago'),
              celda: (f) => {
                if (!f.pago) return <StatusChip tono="muted">{t('vend_pago.sin_pago')}</StatusChip>;
                const p = f.pago;
                return (
                  <span className="bo-com-celda">
                    <StatusChip tono={TONO_PAGO[p.estado]}>{rotuloPago(p.estado, t)} · {mxn(p.montoCent / 100)}</StatusChip>
                    {p.estado === 'borrador' ? <FormaAutorizar accion={accionAutorizarPago} pagoId={p.id} montoTexto={mxn(p.montoCent / 100)} /> : null}
                    {p.estado === 'autorizado' ? <FormaPagado accion={accionMarcarPagado} pagoId={p.id} hoy={hoy} movimientos={opcionesMov} /> : null}
                    {p.estado === 'pagado' ? <span className="bo-com-celda__tenue">{p.pagadoEn ?? '—'} · {p.referenciaBanco ?? '—'}</span> : null}
                  </span>
                );
              },
            },
          ]}
        />
      </Tarjeta>
      {pasos}
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_backoffice');
  return { title: `${t('pul9.h_comisiones')} · ${t('bo.nombre')}` };
}
