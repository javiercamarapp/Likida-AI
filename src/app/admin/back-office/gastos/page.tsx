import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { requireSuperadmin } from '@/lib/auth/guard';
import { hoyMx, mxn, usd } from '@/lib/formato';
import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { Aviso, AvisoCompacto, Disclosure, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { BarList, Columnas, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { uniformes } from '../../cifras-uniformes';
import { observadas } from '../../sello-observado';
import { gastoPorMes, gastoPorProveedor, leerGastos, leerRfcPropio, proveedoresSinGastoReciente, resumirGastos, type GastoFila } from '@/lib/backoffice/gastos';
import { listarProveedores, sugeridosFaltantes, type Proveedor } from '@/lib/backoffice/proveedores';
import { listarCuentas, listarMovimientos, movimientosConciliables, movimientosUsados, saldosPorCuenta, type MovTesoreria } from '@/lib/backoffice/tesoreria';
import { etiquetaMes as etiquetaMesLarga } from '@/lib/backoffice/periodo';
import { SelectorMes } from '../selector-mes';
import { esPeriodoValido, periodoMesActualMx, sumarMeses } from '@/lib/backoffice/utiles-c';
import {
  accionAnularGasto, accionConciliarGasto, accionCrearCuentaTesoreria, accionCrearGasto, accionCrearProveedor, accionRegistrarMovimiento, accionReversarMovimiento,
} from './acciones';
import { FormaAnular, FormaConciliar, FormaCuenta, FormaGasto, FormaMovimiento, FormaProveedor, FormaProveedorSugerido, FormaReversa } from './forma-gasto';
import '../../dinero.css';
import '../../resumen.css';
import './gastos.css';

export const dynamic = 'force-dynamic';

const FILAS_MOSTRADAS = 40;
const MOVS_MOSTRADOS = 15;

const TONO_COMPROBANTE: Record<GastoFila['comprobante'], TonoEstado> = { cfdi: 'ok', invoice_extranjero: 'info', sin_comprobante: 'warn' };

const rotuloComprobante = (c: GastoFila['comprobante'], t: TrDe<'admin_backoffice'>): string => ({
  cfdi: t('gastos.comp_cfdi'), invoice_extranjero: t('gastos.comp_invoice_extranjero'), sin_comprobante: t('gastos.comp_sin_comprobante'),
})[c];

const rotuloDeducible = (d: GastoFila['deducibleEnForma'], t: TrDe<'admin_backoffice'>): string => ({
  si: t('gastos.ded_si'), no: t('gastos.ded_no'), no_evaluable: t('gastos.ded_no_evaluable'),
})[d];

const rotuloCategoria = (c: Proveedor['categoria'], t: TrDe<'admin_backoffice'>): string => ({
  infraestructura: t('gastos.cat_infraestructura'), ia_modelos: t('gastos.cat_ia_modelos'), correo_observabilidad: t('gastos.cat_correo_observabilidad'),
  legal_firma: t('gastos.cat_legal_firma'), whatsapp: t('gastos.cat_whatsapp'), otro: t('gastos.cat_otro'),
})[c];

const rotuloCadencia = (c: Proveedor['cadencia'], t: TrDe<'admin_backoffice'>): string => ({
  mensual: t('proveedores.cad_mensual'), anual: t('proveedores.cad_anual'), por_uso: t('proveedores.cad_por_uso'),
})[c];

const rotuloConcepto = (c: MovTesoreria['concepto'], t: TrDe<'admin_backoffice'>): string => ({
  saldo_inicial: t('tesor.con_saldo_inicial'), ingreso: t('tesor.con_ingreso'), egreso: t('tesor.con_egreso'), ajuste: t('tesor.con_ajuste'),
  traspaso: t('tesor.con_traspaso'), reversa: t('tesor.con_reversa'),
})[c];

const rotuloTipoCuenta = (c: 'banco' | 'stripe' | 'caja', t: TrDe<'admin_backoffice'>): string => ({
  banco: t('tesor.tipo_banco'), stripe: t('tesor.tipo_stripe'), caja: t('tesor.tipo_caja'),
})[c];

/** `?mes=2026-11` o `?mes=2026-11-01` → `2026-11-01`; cualquier otra cosa, el mes en curso de México. */
function periodoDeParametro(mes: string | undefined, actual: string): string {
  const cand = mes && /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : mes;
  return esPeriodoValido(cand) && cand <= actual ? cand : actual;
}

export default async function GastosPage({ searchParams }: { searchParams?: Promise<{ mes?: string }> }) {
  await requireSuperadmin();
  const { t, idioma } = await getT('admin_backoffice');
  const hoy = hoyMx();
  const actual = periodoMesActualMx(hoy);
  const periodo = periodoDeParametro(((await searchParams) ?? {}).mes, actual);

  // Ventana de lectura: la gráfica de 6 meses que termina en el mes visto y los dos meses completos previos al mes en curso (alerta de fijos).
  const desde = [sumarMeses(periodo, -5), sumarMeses(actual, -2)].sort()[0];
  const hasta = [periodo, actual].sort().reverse()[0];
  const [gastos, proveedores, rfc, cuentas, movs, usados] = await Promise.all([
    leerGastos({ desdePeriodo: desde, hastaPeriodo: hasta }),
    listarProveedores(),
    leerRfcPropio(),
    listarCuentas(),
    listarMovimientos(),
    movimientosUsados().catch(() => new Set<string>() as ReadonlySet<string>),
  ]);

  const delMes = gastos.estado === 'ok' ? gastos.dato.filter((g) => g.periodo === periodo) : [];
  const resumen = gastos.estado === 'ok' ? resumirGastos(delMes) : null;
  const sinRfcPropio = !(rfc.estado === 'ok' && rfc.dato !== null);
  const mesesGrafica = gastos.estado === 'ok' ? gastoPorMes(gastos.dato, periodo, 6) : [];
  const porProveedor = gastos.estado === 'ok' ? gastoPorProveedor(delMes, t('gastos.sin_proveedor')) : [];

  const sinDato = (g: PropsCifra['estado']): Pick<PropsCifra, 'valor' | 'estado' | 'mensaje'> => ({ valor: null, estado: g, mensaje: t('bo.no_disponible') });
  const estadoSinDato = gastos.estado === 'error' ? 'error' as const : 'vacio' as const;
  const cifras: PropsCifra[] = resumen ? observadas(uniformes([
    {
      etiqueta: t('gastos.c_total_mes'), valor: mxn(resumen.totalCent / 100), serie: mesesGrafica.map((m) => (m.totalCent === null ? null : m.totalCent / 100)),
      nota: t('gastos.c_total_mes_nota'),
    },
    { etiqueta: t('gastos.c_registrados'), valor: resumen.n, nota: t('gastos.c_registrados_nota') },
    { etiqueta: t('gastos.c_sin_comprobante'), valor: resumen.sinComprobante, tono: resumen.sinComprobante > 0 ? 'warn' as const : undefined },
    {
      etiqueta: t('gastos.c_conciliados'), valor: t('gastos.c_conciliados_valor', { n: resumen.conciliados, total: resumen.n }),
      segmentos: resumen.n > 0 ? [{ etiqueta: t('gastos.c_conciliados'), valor: resumen.conciliados }, { etiqueta: t('gastos.c_por_conciliar'), valor: resumen.n - resumen.conciliados }] : undefined,
    },
    {
      etiqueta: t('gastos.c_iva'), valor: resumen.ivaAcreditableCent === null ? null : mxn(resumen.ivaAcreditableCent / 100),
      nota: resumen.ivaAcreditableCent === null ? t('gastos.c_iva_nadie') : t('gastos.c_iva_n', { n: resumen.conIvaDeclarado, total: resumen.n }),
      ...(resumen.ivaAcreditableCent === null ? { estado: 'vacio' as const, mensaje: t('gastos.c_iva_sin_declarar') } : {}),
    },
  ]), t('gastos.observado')) : uniformes([
    { etiqueta: t('gastos.c_total_mes'), ...sinDato(estadoSinDato) },
    { etiqueta: t('gastos.c_registrados'), ...sinDato(estadoSinDato) },
    { etiqueta: t('gastos.c_sin_comprobante'), ...sinDato(estadoSinDato) },
    { etiqueta: t('gastos.c_conciliados'), ...sinDato(estadoSinDato) },
    { etiqueta: t('gastos.c_iva'), ...sinDato(estadoSinDato) },
  ]);

  const movsConciliables = movs.estado === 'ok' ? movimientosConciliables(movs.dato, usados, 'egreso').slice(0, 30) : [];
  const opcionesMov = movsConciliables.map((m) => ({ id: m.id, etiqueta: `${m.fecha} · ${m.cuentaNombre ?? '—'} · ${mxn(-m.montoCent / 100)}` }));
  const sinGastoReciente = gastos.estado === 'ok' && proveedores.estado === 'ok' ? proveedoresSinGastoReciente(proveedores.dato, gastos.dato, actual, 2) : [];
  const idemGasto = randomUUID();
  const idemMov = randomUUID();
  const etiquetaMes = etiquetaMesLarga(periodo, idioma);

  const avisos = (
    <>
      {sinRfcPropio ? <AvisoCompacto tono="info" resumen={t('gastos.aviso_sin_rfc')} /> : null}
      {gastos.estado === 'error' || proveedores.estado === 'error' ? (
        <Aviso tono="error" titulo={t('gastos.aviso_error_titulo')}>{t('gastos.aviso_error')}</Aviso>
      ) : <AvisoCompacto tono="info" resumen={t('gastos.aviso_manual')} />}
    </>
  );

  const graficas = [
    <Tarjeta key="mes" titulo={t('gastos.g_por_mes')} estado={gastos.estado === 'ok' ? 'ok' : gastos.estado === 'error' ? 'error' : 'vacio'} mensaje={t('bo.no_disponible')} detalle={t('gastos.g_sin_dato_detalle')} reintentar>
      <Columnas
        datos={mesesGrafica.map((m) => ({ etiqueta: `${m.periodo.slice(5, 7)}/${m.periodo.slice(2, 4)}`, valor: m.totalCent === null ? null : m.totalCent / 100 }))}
        etiqueta={t('gastos.g_por_mes')} formato="mxnCompacto" matiz={2} alto={120} variacion={false} vacio={t('gastos.g_sin_captura')}
      />
      <p className="adm-din-nota">{t('gastos.g_por_mes_nota')}</p>
    </Tarjeta>,
    <Tarjeta key="prov" titulo={t('gastos.g_por_proveedor')} estado={gastos.estado === 'ok' ? 'ok' : gastos.estado === 'error' ? 'error' : 'vacio'} mensaje={t('bo.no_disponible')} detalle={t('gastos.g_sin_dato_detalle')} reintentar>
      {porProveedor.length === 0 ? (
        <p className="adm-din-nota">{t('gastos.g_sin_gastos_mes')}</p>
      ) : (
        <BarList
          etiqueta={t('gastos.g_por_proveedor')} matiz={2}
          items={porProveedor.slice(0, 8).map((p) => ({ clave: p.clave, etiqueta: p.etiqueta, valor: p.totalCent / 100, texto: mxn(p.totalCent / 100) }))}
        />
      )}
    </Tarjeta>,
  ];

  return (
    <EsqueletoPanelCifras
      titulo={t('pul9.h_gastos')} apoyo={t('gastos.apoyo')} etiquetaCifras={t('gastos.c_etiqueta')}
      avisos={avisos} cifras={cifras} graficas={graficas} variante="8-4"
    >
      <Tarjeta
        titulo={t('gastos.lista_titulo', { mes: etiquetaMes })}
        estado={gastos.estado === 'ok' ? 'ok' : gastos.estado === 'error' ? 'error' : 'vacio'} mensaje={t('bo.no_disponible')} detalle={t('gastos.g_sin_dato_detalle')} reintentar
        acciones={<SelectorMes t={t} base="/admin/back-office/gastos" param="mes" periodo={periodo} tope={actual} />}
      >
        {sinRfcPropio ? <p className="adm-din-nota" role="note">{t('gastos.sin_rfc_tabla')}</p> : null}
        {delMes.length > FILAS_MOSTRADAS ? <p className="adm-din-nota" role="note">{t('gastos.mostrando', { n: FILAS_MOSTRADAS, total: delMes.length })}</p> : null}
        <TablaBase
          etiqueta={t('gastos.lista_titulo', { mes: etiquetaMes })} idFila={(g) => g.id} tarjetaMovil densa filas={delMes.slice(0, FILAS_MOSTRADAS)}
          vacio={{ titulo: t('gastos.vacio_titulo'), texto: t('gastos.vacio_texto') }}
          columnas={[
            {
              id: 'gasto', titulo: t('gastos.col_gasto'), principal: true,
              celda: (g) => (
                <span className="bo-celda">
                  <span className="bo-celda__nombre">{g.proveedor ?? t('gastos.sin_proveedor')}</span>
                  <span className="bo-celda__tenue">{g.fecha} · {g.concepto ?? '—'}</span>
                </span>
              ),
            },
            {
              id: 'monto', titulo: t('gastos.col_monto'), alinear: 'der',
              celda: (g) => (
                <span className="bo-celda">
                  <span className="bo-celda__nombre bo-monto">{mxn(g.totalCent / 100)}</span>
                  {g.moneda === 'USD' ? <span className="bo-celda__tenue">{t('gastos.usd_detalle', { monto: usd(g.montoOriginalCent / 100), tc: g.tipoCambio ?? '—' })}</span> : null}
                </span>
              ),
            },
            {
              id: 'comprobante', titulo: t('gastos.col_comprobante'),
              celda: (g) => (
                <span className="bo-celda">
                  <StatusChip tono={TONO_COMPROBANTE[g.comprobante]}>{rotuloComprobante(g.comprobante, t)}</StatusChip>
                  <span className="bo-celda__tenue">{t('gastos.deducible_en_forma', { estado: rotuloDeducible(g.deducibleEnForma, t) })}</span>
                </span>
              ),
            },
            {
              id: 'conciliacion', titulo: t('gastos.col_conciliacion'),
              celda: (g) => (g.conciliado ? (
                <span className="bo-celda">
                  <StatusChip tono="ok">{t('gastos.conciliado')}</StatusChip>
                  <span className="bo-celda__tenue">{g.referenciaBanco ?? '—'}</span>
                </span>
              ) : <FormaConciliar accion={accionConciliarGasto} gastoId={g.id} movimientos={opcionesMov} />),
            },
            {
              id: 'anular', titulo: t('gastos.anular'), tituloOculto: true, alinear: 'der',
              celda: (g) => (g.conciliado ? null : (
                <Disclosure titulo={t('gastos.anular')} variante="linea"><FormaAnular accion={accionAnularGasto} gastoId={g.id} /></Disclosure>
              )),
            },
          ]}
        />
      </Tarjeta>

      <Tarjeta titulo={t('gastos.alta_titulo')} contenida>
          <p className="adm-din-nota">{t('gastos.alta_nota')}</p>
          <Disclosure titulo={t('gastos.alta_abrir')} variante="linea" abierto={gastos.estado === 'ok' && delMes.length === 0}>
            <FormaGasto
              accion={accionCrearGasto} claveIdem={idemGasto} hoy={hoy}
              proveedores={proveedores.estado === 'ok' ? proveedores.dato.filter((p) => p.activo).map((p) => ({ id: p.id, nombre: p.nombre })) : []}
            />
          </Disclosure>
      </Tarjeta>

      <Tarjeta
          titulo={t('proveedores.titulo')} contenida
          estado={proveedores.estado === 'ok' ? 'ok' : proveedores.estado === 'error' ? 'error' : 'vacio'} mensaje={t('bo.no_disponible')} detalle={t('proveedores.sin_tabla_detalle')} reintentar
        >
          {sinGastoReciente.length > 0 ? (
            <Aviso tono="warn" titulo={t('proveedores.alerta_titulo')}>
              {sinGastoReciente.map((x) => t('proveedores.alerta_item', { nombre: x.proveedor.nombre, meses: x.mesesSinGasto })).join(' · ')}
            </Aviso>
          ) : null}
          {proveedores.estado === 'ok' ? (
            <>
              <TablaBase
                etiqueta={t('proveedores.titulo')} idFila={(p) => p.id} densa tarjetaMovil filas={proveedores.dato}
                vacio={{ titulo: t('proveedores.vacio_titulo'), texto: t('proveedores.vacio_texto') }}
                columnas={[
                  { id: 'nombre', titulo: t('proveedores.col_nombre'), principal: true, celda: (p) => p.nombre },
                  { id: 'categoria', titulo: t('proveedores.col_categoria'), celda: (p) => rotuloCategoria(p.categoria, t) },
                  { id: 'cadencia', titulo: t('proveedores.col_cadencia'), celda: (p) => rotuloCadencia(p.cadencia, t) },
                  { id: 'rfc', titulo: t('proveedores.col_rfc'), celda: (p) => p.rfc ?? t('proveedores.sin_rfc') },
                ]}
              />
              {sugeridosFaltantes(proveedores.dato).length > 0 ? (
                <Disclosure titulo={t('proveedores.sugeridos_titulo')} resumen={t('proveedores.sugeridos_resumen', { n: sugeridosFaltantes(proveedores.dato).length })} variante="linea">
                  <p className="adm-din-nota">{t('proveedores.sugeridos_nota')}</p>
                  <div className="bo-sugeridos">
                    {sugeridosFaltantes(proveedores.dato).map((s) => (
                      <FormaProveedorSugerido key={s.nombre} accion={accionCrearProveedor} nombre={s.nombre} categoria={s.categoria} cadencia={s.cadencia} />
                    ))}
                  </div>
                </Disclosure>
              ) : null}
              <Disclosure titulo={t('proveedores.alta_titulo')} variante="linea"><FormaProveedor accion={accionCrearProveedor} /></Disclosure>
            </>
          ) : null}
      </Tarjeta>

      <Tarjeta
        titulo={t('tesor.titulo')}
        estado={cuentas.estado === 'ok' && movs.estado === 'ok' ? 'ok' : cuentas.estado === 'error' || movs.estado === 'error' ? 'error' : 'vacio'}
        mensaje={t('bo.no_disponible')} detalle={t('tesor.sin_tabla_detalle')} reintentar
      >
        {cuentas.estado === 'ok' && movs.estado === 'ok' ? (
          <>
            <p className="adm-din-nota">{t('tesor.nota')}</p>
            <TablaBase
              etiqueta={t('tesor.titulo')} idFila={(s) => s.cuenta.id} densa tarjetaMovil filas={saldosPorCuenta(cuentas.dato, movs.dato)}
              vacio={{ titulo: t('tesor.vacio_titulo'), texto: t('tesor.vacio_texto') }}
              columnas={[
                { id: 'cuenta', titulo: t('tesor.col_cuenta'), principal: true, celda: (s) => s.cuenta.nombre },
                { id: 'tipo', titulo: t('tesor.col_tipo'), celda: (s) => rotuloTipoCuenta(s.cuenta.tipo, t) },
                { id: 'saldo', titulo: t('tesor.col_saldo'), alinear: 'der', celda: (s) => (s.movimientos === 0 ? t('tesor.sin_movimientos') : mxn(s.saldoCent / 100)) },
              ]}
            />
            {movs.dato.length > 0 ? (
              <TablaBase
                etiqueta={t('tesor.movs_titulo')} idFila={(m) => m.id} densa tarjetaMovil filas={movs.dato.slice(0, MOVS_MOSTRADOS)}
                columnas={[
                  { id: 'fecha', titulo: t('gastos.f_fecha'), principal: true, celda: (m) => m.fecha },
                  { id: 'cuenta', titulo: t('tesor.col_cuenta'), celda: (m) => m.cuentaNombre ?? '—' },
                  { id: 'concepto', titulo: t('tesor.f_concepto'), celda: (m) => rotuloConcepto(m.concepto, t) },
                  { id: 'monto', titulo: t('gastos.col_monto'), alinear: 'der', celda: (m) => mxn(m.montoCent / 100) },
                  {
                    id: 'reversa', titulo: t('tesor.reversar'), tituloOculto: true, alinear: 'der',
                    celda: (m) => (m.concepto === 'reversa' || movs.dato.some((x) => x.reversaDe === m.id) ? null : (
                      <Disclosure titulo={t('tesor.reversar')} variante="linea"><FormaReversa accion={accionReversarMovimiento} movimientoId={m.id} /></Disclosure>
                    )),
                  },
                ]}
              />
            ) : null}
            <Disclosure titulo={t('tesor.alta_cuenta')} variante="linea"><FormaCuenta accion={accionCrearCuentaTesoreria} /></Disclosure>
            {cuentas.dato.length > 0 ? (
              <Disclosure titulo={t('tesor.alta_mov')} variante="linea">
                <FormaMovimiento accion={accionRegistrarMovimiento} cuentas={cuentas.dato.filter((c) => c.activa).map((c) => ({ id: c.id, nombre: c.nombre }))} claveIdem={idemMov} hoy={hoy} />
              </Disclosure>
            ) : null}
          </>
        ) : null}
      </Tarjeta>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_backoffice');
  return { title: `${t('pul9.h_gastos')} · ${t('bo.nombre')}` };
}
