import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { requireSuperadmin } from '@/lib/auth/guard';
import { hoyMx, mxn, numero } from '@/lib/formato';
import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import {
  Aviso, AvisoCompacto, BotonEnlace, CampoFecha, CampoSelect, CampoTexto, Disclosure, FilaTarjetas, FormaConAviso, StatusChip, TablaBase, Tarjeta, type TonoEstado,
} from '@/app/ui-v2/componentes';
import { BarList, Columnas, DonaMini, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { uniformes } from '../../cifras-uniformes';
import { observadas } from '../../sello-observado';
import '../../dinero.css';
import '../../resumen.css';
import './contabilidad.css';
import { armarCalendario, ordenarCalendario, resumenCalendario, type FilaCalendario } from '@/lib/backoffice/calendario';
import { leerCumplimientos, leerObligaciones, leerPaqueteDelMes } from '@/lib/backoffice/contabilidad';
import { primerDiaDelMes, type EstadoObligacion } from '@/lib/backoffice/fiscal';
import { etiquetaMes } from '@/lib/backoffice/periodo';
import { SelectorMes } from '../selector-mes';
import { aPesos, armarBalanza, estadoDeResultados, LINEAS_FORMA, type AsientoLibro, type ComprobacionLibro } from '@/lib/backoffice/libro';
import type { Cuenta } from '@/lib/backoffice/cuentas';
import { OBLIGACIONES_DEL_PAQUETE, type Advertencia, type MotivoIvaSinDato, type MotivoNoListo, type MotivoPendienteDiot, type PaqueteArmado } from '@/lib/backoffice/paquete-contable';
import type { Lectura } from '@/lib/backoffice/lectura';
import { accionGenerarPaquete, accionMarcarPresentada, accionRegistrarAsientoManual, accionReversarAsiento } from './acciones';

export const dynamic = 'force-dynamic';

/**
 * Back-office › Contabilidad: el calendario fiscal y el libro de partida doble propios de Likida.
 *
 * Reglas de honestidad de la pantalla:
 *  · `no_disponible` (la tabla aún no se aplicó) NO es cero: se pinta «No disponible. No es cero.»; un libro sin asientos es otro estado.
 *  · Sin RFC propio (SAPI sin constituir) el paquete queda bloqueado y las obligaciones «aún no aplican» y no llevan fecha. No se rellena nada.
 *  · Las fechas fiscales son NOMINALES (no se ajustan por día inhábil) y todo el catálogo está pendiente de contador.
 *  · El sistema nunca presenta ante el SAT: «presentada» la marca una persona con el acuse; el cruce contra el cierre no ajusta nada.
 */

type T = TrDe<'admin_backoffice'>;
type Tr = Awaited<ReturnType<typeof getT<'admin_backoffice'>>>;
type Tp = Tr['tp'];

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const POLIZAS_MOSTRADAS = 12;
const CUENTAS_EN_BARRAS = 6;

const TONO_ESTADO: Record<EstadoObligacion, TonoEstado> = {
  aun_no_aplica: 'muted', sin_fecha: 'muted', pendiente: 'warn', paquete_listo: 'info', presentada: 'ok', no_aplica: 'neutral',
};

const rotuloEstado = (e: EstadoObligacion, t: T): string => ({
  aun_no_aplica: t('calendario.estado_aun_no_aplica'),
  sin_fecha: t('calendario.estado_sin_fecha'),
  pendiente: t('calendario.estado_pendiente'),
  paquete_listo: t('calendario.estado_paquete_listo'),
  presentada: t('calendario.estado_presentada'),
  no_aplica: t('calendario.estado_no_aplica'),
})[e];

function rotuloVigencia(f: FilaCalendario, tp: Tp, t: T): { tono: TonoEstado; texto: string } | null {
  if (!f.vigencia || f.dias === null) return null;
  const n = Math.abs(f.dias);
  if (f.vigencia.estado === 'vencido') return { tono: 'bad', texto: tp('calendario.vig_vencida', n) };
  if (f.vigencia.estado === 'por_vencer') return { tono: 'warn', texto: f.dias === 0 ? t('calendario.vig_hoy') : tp('calendario.vig_por_vencer', n) };
  if (f.vigencia.estado === 'vigente') return { tono: 'ok', texto: tp('calendario.vig_vigente', n) };
  return null;
}

const nombreComprobacion = (c: ComprobacionLibro['codigo'], t: T): { nombre: string; a: string; b: string } => ({
  C3: { nombre: t('contab.c3_nombre'), a: t('contab.c3_a'), b: t('contab.c3_b') },
  C4: { nombre: t('contab.c4_nombre'), a: t('contab.c4_a'), b: t('contab.c4_b') },
  C10: { nombre: t('contab.c10_nombre'), a: t('contab.c10_a'), b: t('contab.c10_b') },
  C21: { nombre: t('contab.c21_nombre'), a: t('contab.c21_a'), b: t('contab.c21_b') },
  CU1: { nombre: t('contab.cu1_nombre'), a: t('contab.cu1_a'), b: t('contab.cu1_b') },
})[c];

const textoPendienteDiot = (m: MotivoPendienteDiot, t: T): string => ({
  sin_comprobante: t('fiscal.diot_p_sin_comprobante'),
  invoice_extranjero: t('fiscal.diot_p_invoice_extranjero'),
  sin_cfdi_uuid: t('fiscal.diot_p_sin_cfdi_uuid'),
  sin_rfc_proveedor: t('fiscal.diot_p_sin_rfc_proveedor'),
  rfc_invalido: t('fiscal.diot_p_rfc_invalido'),
  sin_desglose: t('fiscal.diot_p_sin_desglose'),
})[m];

const textoIvaSinDato = (m: MotivoIvaSinDato, t: T): string => ({
  sin_trasladado: t('fiscal.iva_sin_dato_sin_trasladado'),
  gasto_sin_iva: t('fiscal.iva_sin_dato_gasto_sin_iva'),
  sin_gastos_leidos: t('fiscal.iva_sin_dato_sin_gastos_leidos'),
})[m];

const textoAdvertencia = (a: Advertencia, t: T): string => ({
  cruce_no_cuadra: t('contab.adv_cruce_no_cuadra'),
  cruce_sin_cierre: t('contab.adv_cruce_sin_cierre'),
  diot_con_pendientes: t('contab.adv_diot_con_pendientes'),
  diot_sin_gastos: t('contab.adv_diot_sin_gastos'),
  iva_a_pagar_sin_dato: t('contab.adv_iva_a_pagar_sin_dato'),
  movimientos_sin_cfdi: t('contab.adv_movimientos_sin_cfdi'),
})[a];

const textoNoListo = (m: MotivoNoListo, t: T): string => (m === 'comprobacion_bloqueante' ? t('contab.nolisto_comprobacion') : t('contab.nolisto_vacio'));

/** Las vías de C10 y C21 son conteos, no pesos. */
const esConteo = (c: ComprobacionLibro['codigo']): boolean => c === 'C10' || c === 'C21';
const viaTexto = (cent: number | null, c: ComprobacionLibro['codigo']): string => (cent === null ? '—' : esConteo(c) ? numero(cent) : mxn(aPesos(cent)));

const pesos = (cent: number | null): string => (cent === null ? '—' : mxn(aPesos(cent)));

/** La lectura que no está `ok`, dicha por su causa: ausente (tabla sin aplicar) o fallo de la base. */
function sinLectura(l: Lectura<unknown>, t: T): { estado: 'vacio' | 'error'; mensaje: string } {
  return l.estado === 'error' ? { estado: 'error', mensaje: t('contab.no_se_pudo_leer') } : { estado: 'vacio', mensaje: t('bo.no_disponible') };
}

function enlaceCsv(csv: string): string {
  // Con la marca de orden de bytes (BOM) para que las hojas de cálculo abran los acentos bien.
  return `data:text/csv;charset=utf-8,${encodeURIComponent(String.fromCharCode(0xfeff) + csv)}`;
}

export default async function ContabilidadPage({ searchParams }: { searchParams?: Promise<{ periodo?: string }> }) {
  const { t, tp, idioma } = await getT('admin_backoffice');
  // La puerta de la PÁGINA, no solo la del layout: lo que se lee aquí es contabilidad de la empresa, con service role.
  await requireSuperadmin();
  const hoy = hoyMx();
  const pedido = ((await searchParams) ?? {}).periodo ?? '';
  const periodo = MES.test(pedido) ? `${pedido}-01` : primerDiaDelMes(hoy);
  const etiquetaPeriodo = etiquetaMes(periodo, idioma);

  const [datos, obligaciones, cumplimientos] = await Promise.all([leerPaqueteDelMes(periodo), leerObligaciones(), leerCumplimientos()]);
  const { candado, libro, cuentas, comprobaciones, delMes, paquete } = datos;
  const cuentasOk: Cuenta[] | null = cuentas.estado === 'ok' ? cuentas.dato : null;

  // Calendario: necesita el catálogo Y los cumplimientos; si falta uno, la sección dice cuál.
  const lecturaCalendario: Lectura<unknown> = obligaciones.estado !== 'ok' ? obligaciones : cumplimientos;
  const filas = obligaciones.estado === 'ok' && cumplimientos.estado === 'ok'
    ? ordenarCalendario(armarCalendario({
      obligaciones: obligaciones.dato, cumplimientos: cumplimientos.dato, candado, constituidaEl: datos.entidad.estado === 'ok' ? datos.entidad.dato?.constituidaEl ?? null : null, hoy,
    }))
    : null;
  const resumen = filas ? resumenCalendario(filas) : null;

  const armado: PaqueteArmado | null = paquete && paquete.bloqueado === false ? paquete : null;
  // El estado de resultados y la balanza del mes salen del libro, con o sin RFC: el candado frena el paquete fiscal, no la contabilidad.
  const resultados = delMes && cuentasOk ? estadoDeResultados(delMes, cuentasOk) : null;
  const balanza = delMes && cuentasOk ? armarBalanza(delMes, cuentasOk) : null;
  const verdes = comprobaciones ? comprobaciones.filter((c) => c.ok === true).length : null;
  const evaluables = comprobaciones ? comprobaciones.filter((c) => c.ok !== null).length : null;
  const enRojo = comprobaciones ? comprobaciones.filter((c) => c.bloqueante && c.ok === false).length : 0;

  // ── Cifras ────────────────────────────────────────────────────────────────
  const cifras: PropsCifra[] = uniformes([
    candado.bloqueado
      ? { etiqueta: t('calendario.cifra'), valor: null, estado: 'vacio', mensaje: t('calendario.aun_no_aplica') }
      : resumen
        ? { etiqueta: t('calendario.cifra'), valor: resumen.pendientes + resumen.paquetesListos, nota: t('calendario.cifra_nota', { vencidas: resumen.vencidas, por_vencer: resumen.porVencer }), tono: resumen.vencidas > 0 ? 'bad' : resumen.porVencer > 0 ? 'warn' : undefined, tipo: 'calculado' }
        : { etiqueta: t('calendario.cifra'), valor: null, ...sinLectura(lecturaCalendario, t) },
    libro.estado === 'ok' && delMes
      ? { etiqueta: t('contab.cifra_polizas'), valor: delMes.length, nota: t('contab.cifra_polizas_nota', { periodo: etiquetaPeriodo, reversas: delMes.filter((a) => a.reversaDe !== null).length }) }
      : { etiqueta: t('contab.cifra_polizas'), valor: null, ...sinLectura(libro, t) },
    resultados
      ? resultados.hayMovimientos
        ? { etiqueta: t('contab.cifra_resultado'), valor: aPesos(resultados.resultadoCent), formato: 'mxn', nota: t('contab.cifra_resultado_nota'), tipo: 'calculado' }
        : { etiqueta: t('contab.cifra_resultado'), valor: null, estado: 'vacio', mensaje: t('contab.sin_movimientos') }
      : { etiqueta: t('contab.cifra_resultado'), valor: null, ...sinLectura(libro.estado !== 'ok' ? libro : cuentas, t) },
    comprobaciones && verdes !== null && evaluables !== null
      ? { etiqueta: t('contab.cifra_comprobaciones'), valor: t('contab.n_de_m', { n: verdes, m: evaluables }), nota: t('contab.cifra_comprobaciones_nota', { no_evaluables: comprobaciones.length - evaluables }), tono: enRojo > 0 ? 'bad' : 'ok', tipo: 'calculado' }
      : { etiqueta: t('contab.cifra_comprobaciones'), valor: null, ...sinLectura(libro.estado !== 'ok' ? libro : cuentas, t) },
    candado.bloqueado
      ? { etiqueta: t('contab.cifra_paquete'), valor: t('contab.paquete_bloqueado'), nota: t('pul9.paquete_sin_rfc'), tono: 'warn', tipo: 'calculado' }
      : armado
        ? { etiqueta: t('contab.cifra_paquete'), valor: armado.listo ? t('contab.paquete_listo') : t('contab.paquete_no_listo'), tono: armado.listo ? 'ok' : 'warn', tipo: 'calculado' }
        : { etiqueta: t('contab.cifra_paquete'), valor: null, ...sinLectura(libro.estado !== 'ok' ? libro : cuentas, t) },
  ]);

  // ── Gráficas ──────────────────────────────────────────────────────────────
  const sinLibro = libro.estado !== 'ok' || !cuentasOk;
  const lecturaGraficas = sinLectura(libro.estado !== 'ok' ? libro : cuentas, t);
  const vacioMes = { estado: 'vacio' as const, mensaje: t('contab.sin_movimientos'), detalle: t('contab.sin_movimientos_detalle') };
  const gBalanza = balanza ? [...balanza.filas].sort((a, b) => Math.abs(b.saldoCent) - Math.abs(a.saldoCent)).slice(0, CUENTAS_EN_BARRAS) : [];
  const gCostos = resultados ? resultados.porCuenta.filter((c) => c.tipo !== 'I' && c.montoCent > 0) : [];

  const graficas = [
    <Tarjeta key="resultados" titulo={t('contab.g_resultados')} {...(sinLibro ? lecturaGraficas : resultados?.hayMovimientos ? {} : vacioMes)}>
      {resultados?.hayMovimientos ? (
        <Columnas
          datos={[
            { etiqueta: t('contab.g_ingresos'), valor: aPesos(resultados.ingresosCent) },
            { etiqueta: t('contab.g_costos'), valor: aPesos(resultados.costosCent) },
            { etiqueta: t('contab.g_gastos'), valor: aPesos(resultados.gastosCent) },
          ]}
          etiqueta={t('contab.g_resultados')} formato="mxnCompacto" matiz={8} alto={120} variacion={false}
        />
      ) : null}
    </Tarjeta>,
    <Tarjeta key="mayor" titulo={t('contab.g_mayor')} {...(sinLibro ? lecturaGraficas : gBalanza.length > 0 ? {} : vacioMes)}>
      {gBalanza.length > 0 ? (
        <BarList
          etiqueta={t('contab.g_mayor')} matiz={8}
          items={gBalanza.map((f) => ({ clave: f.cuenta, etiqueta: `${f.cuenta} · ${f.nombre}`, valor: Math.abs(aPesos(f.saldoCent)), texto: mxn(aPesos(f.saldoCent)) }))}
        />
      ) : null}
    </Tarjeta>,
    <Tarjeta key="costos" titulo={t('contab.g_costos_gastos')} {...(sinLibro ? lecturaGraficas : gCostos.length > 0 ? {} : vacioMes)}>
      {gCostos.length > 0 && resultados ? (
        <DonaMini
          etiqueta={t('contab.g_costos_gastos')} matiz={8}
          gajos={gCostos.map((c) => ({ etiqueta: `${c.cuenta} · ${c.nombre}`, valor: aPesos(c.montoCent) }))}
          centro={mxn(aPesos(resultados.costosCent + resultados.gastosCent))}
        />
      ) : null}
    </Tarjeta>,
  ];

  // ── Avisos (a lo más dos) ─────────────────────────────────────────────────
  const avisoCandado = candado.bloqueado ? (
    <AvisoCompacto
      key="candado" tono="warn" etiquetaMas={t('contab.ver_mas')}
      resumen={candado.motivo === 'sin_rfc' ? t('fiscal.candado_resumen') : t('fiscal.candado_resumen_ilegible')}
      mas={t('fiscal.candado_mas')}
    />
  ) : null;
  const avisoLectura = libro.estado === 'error' || cuentas.estado === 'error'
    ? <Aviso key="lectura" tono="error" titulo={t('contab.no_se_pudo_leer')}>{t('contab.recarga')}</Aviso>
    : libro.estado === 'ok' && libro.dato.truncado
      ? <Aviso key="truncado" tono="warn" titulo={t('contab.libro_truncado')}>{t('contab.libro_truncado_texto')}</Aviso>
      : null;

  const claveAsiento = `asiento-${randomUUID()}`;
  const claveReversa = `reversa-${randomUUID()}`;

  return (
    <EsqueletoPanelCifras
      titulo={t('pul9.h_contabilidad')} apoyo={t('contab.apoyo')} etiquetaCifras={t('contab.cifras_etiqueta')}
      cifras={observadas(cifras, t('contab.observado'))}
      acciones={<SelectorMes t={t} base="/admin/back-office/contabilidad" param="periodo" periodo={periodo} />}
      avisos={<>{avisoCandado}{avisoLectura}</>}
      graficas={graficas} variante="4-4-4"
    >
      <Tarjeta titulo={t('calendario.titulo')} {...(filas ? {} : sinLectura(lecturaCalendario, t))}>
        {filas ? (
          <>
            <p className="adm-din-nota">{t('calendario.rotulo')}</p>
            <TablaBase
              etiqueta={t('calendario.titulo')} idFila={(f) => f.clave} tarjetaMovil filas={filas} densa
              vacio={{ titulo: t('calendario.vacio'), texto: t('calendario.vacio_texto') }}
              columnas={[
                {
                  id: 'obligacion', titulo: t('calendario.col_obligacion'), principal: true,
                  celda: (f) => (
                    <>
                      {f.nombre}
                      <span className="adm-din-sub">{f.periodo ? t('calendario.cubre', { periodo: f.periodo.slice(0, 7) }) : ''}{f.estadoCatalogo === 'pendiente_de_contador' ? `${f.periodo ? ' · ' : ''}${t('calendario.pendiente_contador')}` : ''}</span>
                    </>
                  ),
                },
                {
                  id: 'fecha', titulo: t('calendario.col_fecha'),
                  celda: (f) => (f.fechaLimite ? (
                    <>
                      {f.fechaLimite}
                      <span className="adm-din-sub">{f.sujetaADiaInhabil ? t('calendario.fin_de_semana') : t('calendario.nominal')}</span>
                    </>
                  ) : '—'),
                },
                { id: 'estado', titulo: t('calendario.col_estado'), celda: (f) => <StatusChip tono={TONO_ESTADO[f.estado]}>{rotuloEstado(f.estado, t)}</StatusChip> },
                {
                  id: 'vigencia', titulo: t('calendario.col_vigencia'),
                  celda: (f) => {
                    const v = rotuloVigencia(f, tp, t);
                    return v ? <StatusChip tono={v.tono}>{v.texto}</StatusChip> : '—';
                  },
                },
                {
                  id: 'acuse', titulo: t('calendario.col_acuse'),
                  celda: (f) => (f.cumplimiento?.estado === 'presentada' ? (
                    <>
                      {f.cumplimiento.acuseRef}
                      <span className="adm-din-sub">{t('calendario.presentada_por', { quien: f.cumplimiento.presentadaPor ?? '—', fecha: f.cumplimiento.presentadaEn ?? '—' })}</span>
                    </>
                  ) : '—'),
                },
              ]}
            />
            {!candado.bloqueado && filas.some((f) => f.periodo && (f.estado === 'pendiente' || f.estado === 'paquete_listo')) ? (
              <Disclosure variante="linea" titulo={t('calendario.marcar_titulo')} resumen={t('calendario.marcar_resumen')}>
                <FormaConAviso accion={accionMarcarPresentada} boton={t('calendario.marcar_boton')}>
                  <CampoSelect etiqueta={t('calendario.campo_obligacion')} name="obligacion" obligatorio defaultValue="">
                    <option value="">{t('contab.elige')}</option>
                    {filas.filter((f) => f.periodo && (f.estado === 'pendiente' || f.estado === 'paquete_listo')).map((f) => (
                      <option key={`${f.clave}|${f.periodo}`} value={`${f.clave}|${f.periodo}`}>{`${f.nombre} · ${f.periodo?.slice(0, 7)}`}</option>
                    ))}
                  </CampoSelect>
                  <CampoTexto etiqueta={t('calendario.campo_acuse')} ayuda={t('calendario.campo_acuse_ayuda')} name="acuseRef" obligatorio maxLength={120} autoComplete="off" />
                  <CampoFecha etiqueta={t('calendario.campo_fecha')} name="presentadaEn" defaultValue={hoy} max={hoy} obligatorio />
                  <CampoTexto etiqueta={t('calendario.campo_nota')} name="nota" maxLength={200} autoComplete="off" />
                </FormaConAviso>
                <p className="adm-din-nota">{t('calendario.marcar_nota')}</p>
              </Disclosure>
            ) : null}
          </>
        ) : null}
      </Tarjeta>

      <FilaTarjetas variante="6-6" className="adm-fila-pareja">
        <Tarjeta titulo={t('contab.comprobaciones')} {...(comprobaciones ? {} : sinLectura(libro.estado !== 'ok' ? libro : cuentas, t))}>
          {comprobaciones ? (
            <>
              <ul className="adm-din-lista">
                {comprobaciones.map((c) => {
                  const n = nombreComprobacion(c.codigo, t);
                  return (
                    <li key={c.codigo}>
                      <StatusChip tono={c.ok === null ? 'muted' : c.ok ? 'ok' : 'bad'}>{c.ok === null ? t('contab.no_evaluable') : c.ok ? t('contab.en_verde') : t('contab.en_rojo')}</StatusChip>
                      <strong>{n.nombre}</strong>
                      <span>{c.bloqueante ? t('contab.bloqueante') : t('contab.informativa')}</span>
                      <span className="adm-din-sub">{`${n.a}: ${viaTexto(c.viaA.cent, c.codigo)} · ${n.b}: ${viaTexto(c.viaB.cent, c.codigo)}`}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="adm-din-nota">{t('contab.comprobaciones_nota')}</p>
            </>
          ) : null}
        </Tarjeta>

        <Tarjeta titulo={t('contab.paquete')} {...(candado.bloqueado || armado ? {} : sinLectura(libro.estado !== 'ok' ? libro : cuentas, t))}>
          {candado.bloqueado ? <PaqueteBloqueado t={t} /> : armado ? <PaqueteMes t={t} paquete={armado} periodo={periodo} /> : null}
        </Tarjeta>
      </FilaTarjetas>

      <Tarjeta titulo={t('contab.polizas')} {...(delMes ? {} : sinLectura(libro, t))}>
        {delMes && libro.estado === 'ok' ? <Polizas t={t} asientos={delMes} todos={libro.dato.asientos} /> : null}
      </Tarjeta>

      <FilaTarjetas variante="6-6" className="adm-fila-pareja">
        <Tarjeta titulo={t('contab.asiento_manual')} {...(cuentasOk ? {} : sinLectura(cuentas, t))}>
          {cuentasOk ? (
            <>
              <p className="adm-din-nota">{t('contab.asiento_manual_nota')}</p>
              <FormaConAviso accion={accionRegistrarAsientoManual} boton={t('contab.registrar_asiento')}>
                <input type="hidden" name="claveIdem" value={claveAsiento} />
                <CampoFecha etiqueta={t('contab.campo_fecha')} name="fecha" defaultValue={hoy} max={hoy} obligatorio />
                <CampoTexto etiqueta={t('contab.campo_descripcion')} name="descripcion" obligatorio maxLength={200} autoComplete="off" />
                <CampoTexto etiqueta={t('contab.campo_motivo')} ayuda={t('contab.campo_motivo_ayuda')} name="motivo" obligatorio maxLength={200} autoComplete="off" />
                <CampoSelect etiqueta={t('contab.campo_soporte')} name="soporte" defaultValue="ninguno">
                  <option value="ninguno">{t('contab.soporte_ninguno')}</option>
                  <option value="cfdi">{t('contab.soporte_cfdi')}</option>
                  <option value="invoice_extranjero">{t('contab.soporte_extranjero')}</option>
                </CampoSelect>
                <CampoTexto etiqueta={t('contab.campo_soporte_ref')} name="soporteRef" maxLength={80} autoComplete="off" />
                <fieldset className="ct-lineas">
                  <legend className="ct-lineas__leyenda">{t('contab.lineas')}</legend>
                  {Array.from({ length: LINEAS_FORMA }, (_, i) => i + 1).map((n) => (
                    <div key={n} className="ct-lineas__fila">
                      <CampoSelect etiqueta={t('contab.linea_cuenta', { n })} etiquetaOculta name={`cuenta_${n}`} defaultValue="">
                        <option value="">{t('contab.linea_cuenta', { n })}</option>
                        {cuentasOk.filter((c) => c.activa).map((c) => <option key={c.codigo} value={c.codigo}>{`${c.codigo} · ${c.nombre}`}</option>)}
                      </CampoSelect>
                      <CampoTexto etiqueta={t('contab.linea_debe', { n })} etiquetaOculta name={`debe_${n}`} placeholder={t('contab.debe')} inputMode="decimal" autoComplete="off" />
                      <CampoTexto etiqueta={t('contab.linea_haber', { n })} etiquetaOculta name={`haber_${n}`} placeholder={t('contab.haber')} inputMode="decimal" autoComplete="off" />
                    </div>
                  ))}
                </fieldset>
              </FormaConAviso>
              <p className="adm-din-nota">{t('contab.plan_propuesto')}</p>
            </>
          ) : null}
        </Tarjeta>

        <Tarjeta titulo={t('contab.reversar')} {...(libro.estado === 'ok' ? {} : sinLectura(libro, t))}>
          {libro.estado === 'ok' ? <Reversar t={t} asientos={libro.dato.asientos} clave={claveReversa} /> : null}
        </Tarjeta>
      </FilaTarjetas>
    </EsqueletoPanelCifras>
  );
}

function PaqueteBloqueado({ t }: { t: T }) {
  return (
    <>
      <p className="adm-din-nota">
        <StatusChip tono="warn">{t('contab.paquete_bloqueado')}</StatusChip>
      </p>
      <p className="adm-din-nota">{t('fiscal.paquete_bloqueado_texto')}</p>
      <ul className="adm-din-lista">
        <li><StatusChip tono="muted">{t('fiscal.no_evaluable_sin_rfc')}</StatusChip><strong>{t('fiscal.diot')}</strong></li>
        <li><StatusChip tono="muted">{t('fiscal.no_evaluable_sin_rfc')}</StatusChip><strong>{t('fiscal.cfdi_gastos')}</strong></li>
        <li><StatusChip tono="muted">{t('fiscal.no_evaluable_sin_rfc')}</StatusChip><strong>{t('fiscal.deducible_en_forma')}</strong></li>
      </ul>
    </>
  );
}

function PaqueteMes({ t, paquete, periodo }: { t: T; paquete: PaqueteArmado; periodo: string }) {
  const ym = periodo.slice(0, 7);
  const { cruce, diot, iva } = paquete;
  const pendientesPorMotivo = new Map<MotivoPendienteDiot, number>();
  for (const p of diot?.pendientes ?? []) pendientesPorMotivo.set(p.motivo, (pendientesPorMotivo.get(p.motivo) ?? 0) + 1);
  return (
    <>
      <p className="adm-din-acciones">
        <BotonEnlace variante="secondary" tamano="sm" href={enlaceCsv(paquete.balanzaCsv)} download={`balanza-${ym}.csv`}>{t('contab.descargar_balanza')}</BotonEnlace>
        <BotonEnlace variante="secondary" tamano="sm" href={enlaceCsv(paquete.polizasCsv)} download={`polizas-${ym}.csv`}>{t('contab.descargar_polizas')}</BotonEnlace>
      </p>
      <p className="adm-din-nota">{t('contab.paquete_csv_nota')}</p>
      {paquete.movimientosSinCfdi > 0 ? <p className="adm-din-nota"><StatusChip tono="warn">{t('contab.sin_cfdi')}</StatusChip> {t('contab.sin_cfdi_n', { n: paquete.movimientosSinCfdi })}</p> : null}

      <ul className="adm-din-lista">
        <li>
          <strong>{t('contab.cruce')}</strong>
          <StatusChip tono={cruce.cuadra === null ? 'muted' : cruce.cuadra ? 'ok' : 'bad'}>{cruce.cuadra === null ? t('contab.cruce_sin_cierre') : cruce.cuadra ? t('contab.cruce_cuadra') : t('contab.cruce_no_cuadra')}</StatusChip>
          {cruce.filas.map((f) => (
            <span key={f.concepto} className="adm-din-sub">
              {`${f.concepto === 'ingresos' ? t('contab.g_ingresos') : t('contab.cruce_costos_gastos')}: ${t('contab.cruce_libro')} ${pesos(f.libroCent)} · ${t('contab.cruce_cierre')} ${pesos(f.cierreCent)} · ${t('contab.cruce_diferencia')} ${pesos(f.diferenciaCent)}`}
            </span>
          ))}
          <span className="adm-din-sub">{t('contab.cruce_no_ajusta')}</span>
        </li>
        <li>
          <strong>{t('fiscal.diot')}</strong>
          {diot ? (
            <>
              <span>{t('fiscal.diot_resumen', { renglones: diot.renglones.length, pendientes: diot.pendientes.length })}</span>
              {[...pendientesPorMotivo.entries()].map(([motivo, n]) => <span key={motivo} className="adm-din-sub">{`${textoPendienteDiot(motivo, t)}: ${n}`}</span>)}
            </>
          ) : <StatusChip tono="muted">{t('bo.no_disponible')}</StatusChip>}
        </li>
        <li>
          <strong>{t('fiscal.iva')}</strong>
          <span className="adm-din-sub">{`${t('fiscal.iva_trasladado')}: ${pesos(iva.trasladadoCent)} · ${t('fiscal.iva_acreditable')}: ${pesos(iva.acreditableCent)}`}</span>
          <span>{`${t('fiscal.iva_a_pagar')}: ${pesos(iva.aPagarCent)}`}</span>
          {iva.motivoSinDato ? <span className="adm-din-sub">{textoIvaSinDato(iva.motivoSinDato, t)}</span> : null}
        </li>
      </ul>

      {paquete.advertencias.length > 0 ? (
        <ul className="adm-din-lista">
          {paquete.advertencias.map((a) => <li key={a}><StatusChip tono="warn">{t('contab.advertencia')}</StatusChip>{textoAdvertencia(a, t)}</li>)}
        </ul>
      ) : null}

      {paquete.listo ? (
        <FormaConAviso accion={accionGenerarPaquete} boton={t('contab.marcar_paquete')}>
          <input type="hidden" name="periodo" value={periodo} />
        </FormaConAviso>
      ) : (
        <p className="adm-din-nota"><StatusChip tono="warn">{t('contab.paquete_no_listo')}</StatusChip> {paquete.motivosNoListo.map((m) => textoNoListo(m, t)).join(', ')}</p>
      )}
      <p className="adm-din-nota">{t('contab.paquete_cubre', { obligaciones: OBLIGACIONES_DEL_PAQUETE.length })}</p>
    </>
  );
}

function Polizas({ t, asientos, todos }: { t: T; asientos: readonly AsientoLibro[]; todos: readonly AsientoLibro[] }) {
  const reversados = new Set(todos.filter((a) => a.reversaDe !== null).map((a) => a.reversaDe as string));
  const foliosPorId = new Map(todos.map((a) => [a.id, a.folio]));
  const recientes = [...asientos].sort((a, b) => b.seq - a.seq).slice(0, POLIZAS_MOSTRADAS);
  return (
    <TablaBase
      etiqueta={t('contab.polizas')} idFila={(a) => a.id} tarjetaMovil densa filas={recientes}
      vacio={{ titulo: t('contab.sin_polizas'), texto: t('contab.sin_polizas_texto') }}
      columnas={[
        { id: 'folio', titulo: t('contab.col_folio'), principal: true, celda: (a) => (<>{a.folio}<span className="adm-din-sub">{a.fechaNeg}</span></>) },
        {
          id: 'descripcion', titulo: t('contab.col_descripcion'),
          celda: (a) => (
            <>
              {a.descripcion}
              <span className="adm-din-acciones">
                {a.reversaDe ? <StatusChip tono="neutral">{t('contab.reversa_de', { folio: foliosPorId.get(a.reversaDe) ?? '—' })}</StatusChip> : null}
                {reversados.has(a.id) ? <StatusChip tono="neutral">{t('contab.reversado')}</StatusChip> : null}
                {a.soporte === 'ninguno' ? <StatusChip tono="warn">{t('contab.sin_cfdi')}</StatusChip> : null}
              </span>
            </>
          ),
        },
        { id: 'total', titulo: t('contab.col_total'), alinear: 'der', celda: (a) => mxn(aPesos(a.lineas.reduce((s, l) => s + l.debeCent, 0))) },
        { id: 'hash', titulo: t('contab.col_hash'), celda: (a) => <span className="ct-hash" title={a.hash}>{a.hash.slice(0, 8)}</span> },
      ]}
    />
  );
}

function Reversar({ t, asientos, clave }: { t: T; asientos: readonly AsientoLibro[]; clave: string }) {
  const reversados = new Set(asientos.filter((a) => a.reversaDe !== null).map((a) => a.reversaDe as string));
  const candidatos = asientos.filter((a) => a.esManual && a.reversaDe === null && !reversados.has(a.id)).sort((a, b) => b.seq - a.seq).slice(0, 50);
  if (candidatos.length === 0) return <p className="adm-din-nota">{t('contab.reversar_ninguno')}</p>;
  return (
    <>
      <p className="adm-din-nota">{t('contab.reversar_nota')}</p>
      <FormaConAviso accion={accionReversarAsiento} boton={t('contab.reversar_boton')}>
        <input type="hidden" name="claveIdem" value={clave} />
        <CampoSelect etiqueta={t('contab.reversar_asiento')} name="asientoId" obligatorio defaultValue="">
          <option value="">{t('contab.elige')}</option>
          {candidatos.map((a) => <option key={a.id} value={a.id}>{`${a.folio} · ${a.fechaNeg} · ${a.descripcion.slice(0, 60)}`}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta={t('contab.campo_motivo')} ayuda={t('contab.reversar_motivo_ayuda')} name="motivo" obligatorio maxLength={200} autoComplete="off" />
      </FormaConAviso>
    </>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_backoffice');
  return { title: `${t('pul9.h_contabilidad')} · ${t('bo.nombre')}` };
}
