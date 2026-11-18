import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { fechaHoraMx, mxn, numero } from '@/lib/formato';
import { getT, idiomaActual } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { candadoDeEntidad, leerEntidad } from '@/lib/backoffice/entidad';
import { cobradoDelMesAnterior, leerVistaCierre, puedeMarcarseListo, type CierreMes, type Comprobacion, type EstadoComprobacion, type Faltante } from '@/lib/backoffice/cierre';
import { armarUpdateInversionistas, leerUpdateInversionistas } from '@/lib/backoffice/reporte';
import { desplazarMes, esPeriodo, etiquetaMes, mesDeMx, ultimosMeses } from '@/lib/backoffice/periodo';
import { SelectorMes } from '../selector-mes';
import {
  Aviso, BarraFiltros, BotonEnlace, FilaTarjetas, FiltroOpciones, FormaConAviso, StatusChip, TablaBase, Tarjeta, type TonoEstado,
} from '@/app/ui-v2/componentes';
import { BarList, type ItemBarList, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { uniformes } from '../../cifras-uniformes';
import { observadas } from '../../sello-observado';
import { FormasCierre } from './forma-cierre';
import { accionGuardarUpdate } from './acciones';
import { AYUDA_COMPROBACION, ROTULO_COMPROBACION, ROTULO_ESTADO_CIERRE, ROTULO_ESTADO_COMPROBACION, ROTULO_FALTANTE } from './rotulos';
import '../../dinero.css';
import '../../resumen.css';
import '../tablero.css';
import { NotaVacia } from '../../nota-vacia';

export const dynamic = 'force-dynamic';

type Tr = TrDe<'admin_backoffice'>;

const TONO_COMPROBACION: Record<EstadoComprobacion, TonoEstado> = { ok: 'ok', falla: 'bad', no_evaluable: 'warn', aviso: 'warn' };

/** Una cifra que no se pudo armar: dice QUÉ falta, no «0». */
function sinDato(etiqueta: string, faltantes: readonly Faltante[], relevantes: readonly Faltante[], t: Tr, tipo?: PropsCifra['tipo']): PropsCifra {
  const f = faltantes.find((x) => relevantes.includes(x));
  return { etiqueta, valor: null, estado: 'vacio', mensaje: f ? t('cierre.falta', { que: t(ROTULO_FALTANTE[f]) }) : t('bo.no_disponible'), tipo };
}

function cifrasDeLaPantalla(c: CierreMes, t: Tr, tp: (clave: 'cierre.cobrado_nota', n: number) => string): PropsCifra[] {
  const cent = (v: number | null): number | null => (v === null ? null : v / 100);
  const comisionesNetas = c.comisionesDevengadasCent === null || c.clawbackCent === null ? null : c.comisionesDevengadasCent - c.clawbackCent;
  const eIng = t('cierre.c_ingresos');
  const eIva = t('cierre.c_iva');
  const eCogs = t('cierre.c_cogs');
  const eGas = t('cierre.c_gastos');
  const eCom = t('cierre.c_comisiones');
  const eNeto = t('cierre.c_neto_cifra');
  const FACT: Faltante[] = ['facturas', 'facturas_truncadas', 'desglose_iva'];
  return [
    c.ingresosCobradosCent === null
      ? sinDato(eIng, c.faltantes, FACT, t)
      : { etiqueta: eIng, valor: cent(c.ingresosCobradosCent), formato: 'mxn', nota: tp('cierre.cobrado_nota', c.nCobradas ?? 0) },
    c.ivaTrasladadoCent === null
      ? sinDato(eIva, c.faltantes, FACT, t)
      : { etiqueta: eIva, valor: cent(c.ivaTrasladadoCent), formato: 'mxn', nota: t('cierre.iva_nota') },
    c.cogsIaCent === null
      ? sinDato(eCogs, c.faltantes, ['costo_ia', 'tipo_cambio'], t, 'calculado')
      : { etiqueta: eCogs, valor: cent(c.cogsIaCent), formato: 'mxn', tipo: 'calculado', nota: c.tipoCambio === null ? undefined : t('cierre.cogs_nota', { tc: String(c.tipoCambio) }) },
    c.gastosCent === null
      ? sinDato(eGas, c.faltantes, ['gastos'], t)
      : { etiqueta: eGas, valor: cent(c.gastosCent), formato: 'mxn' },
    comisionesNetas === null
      ? sinDato(eCom, c.faltantes, ['comisiones'], t)
      : { etiqueta: eCom, valor: cent(comisionesNetas), formato: 'mxn', nota: t('cierre.comisiones_nota', { claw: mxn((c.clawbackCent ?? 0) / 100) }) },
    c.netoCent === null
      ? { etiqueta: eNeto, valor: null, estado: 'vacio', tipo: 'calculado', mensaje: t('cierre.neto_falta', { faltantes: c.faltantes.map((f) => t(ROTULO_FALTANTE[f])).join(', ') || t('bo.no_disponible') }) }
      : { etiqueta: eNeto, valor: cent(c.netoCent), formato: 'mxn', tipo: 'calculado', nota: t('cierre.neto_nota') },
  ];
}

export default async function CierrePage({ searchParams }: { searchParams?: Promise<{ mes?: string }> }) {
  const { t, tp } = await getT('admin_backoffice');
  // La puerta de la PÁGINA, no solo la del layout (lo que se lee aquí cruza todas las flotas con service role).
  await requireSuperadmin();
  const idioma = (await idiomaActual()) === 'en' ? 'en' : 'es';
  const sp = (await searchParams) ?? {};
  const mesEnCurso = mesDeMx();
  const porDefecto = desplazarMes(mesEnCurso, -1);
  const periodo = esPeriodo(sp.mes) && sp.mes <= mesEnCurso ? sp.mes : porDefecto;
  const mesTerminado = periodo < mesEnCurso;

  const [vista, entidad, cobradoAnterior, update] = await Promise.all([
    leerVistaCierre(periodo), leerEntidad(), cobradoDelMesAnterior(periodo), leerUpdateInversionistas(periodo),
  ]);
  const candado = candadoDeEntidad(entidad);
  const c = vista.cierre;
  const guardado = vista.guardado.estado === 'ok' ? vista.guardado.dato : null;
  const estado = guardado?.estado ?? null;
  const tablaDisponible = vista.guardado.estado !== 'no_disponible';
  const puedeListo = puedeMarcarseListo(vista.comprobaciones);

  const cifras = observadas(uniformes(cifrasDeLaPantalla(c, t, (clave, n) => tp(clave, n))), t('comun.observado'));

  // ── Avisos (a lo más dos): el estado del mes y el candado de la entidad ──
  const avisoMes = vista.guardado.estado === 'error'
    ? <Aviso tono="error" titulo={t('cierre.aviso_no_leido')}>{t('cierre.aviso_no_leido_texto')}</Aviso>
    : vista.origen === 'cerrado'
      ? <Aviso tono="ok" titulo={t('cierre.aviso_cerrado')}>{t('cierre.aviso_cerrado_texto', { cuando: fechaHoraMx(guardado?.cerradoEn, idioma) })}</Aviso>
      : !mesTerminado
        ? <Aviso tono="info" titulo={t('cierre.aviso_en_curso')}>{t('cierre.aviso_en_curso_texto')}</Aviso>
        : !tablaDisponible
          ? <Aviso tono="warn" titulo={t('cierre.aviso_sin_tabla')}>{t('cierre.aviso_sin_tabla_texto')}</Aviso>
          : estado === null
            ? <Aviso tono="info" titulo={t('cierre.aviso_sin_borrador')}>{t('cierre.aviso_sin_borrador_texto')}</Aviso>
            : null;
  const avisoEntidad = candado === 'sin_rfc'
    ? <Aviso tono="info" titulo={t('cierre.aviso_no_fiscal')}>{t('cierre.aviso_no_fiscal_texto')}</Aviso>
    : null;

  // ── Gráficas: del cobrado al neto y margen por cliente ──
  const pesos = (v: number | null): number | null => (v === null ? null : v / 100);
  const txt = (v: number | null): string | undefined => (v === null ? undefined : mxn(v / 100, idioma));
  const comisionesNetas = c.comisionesDevengadasCent === null || c.clawbackCent === null ? null : c.comisionesDevengadasCent - c.clawbackCent;
  const puente: ItemBarList[] = [
    { clave: 'ingresos', etiqueta: t('cierre.c_ingresos'), valor: pesos(c.ingresosCobradosCent), texto: txt(c.ingresosCobradosCent) },
    { clave: 'cogs', etiqueta: t('cierre.c_cogs'), valor: pesos(c.cogsIaCent), texto: txt(c.cogsIaCent), tipo: 'calculado' },
    { clave: 'gastos', etiqueta: t('cierre.c_gastos'), valor: pesos(c.gastosCent), texto: txt(c.gastosCent) },
    { clave: 'comisiones', etiqueta: t('cierre.c_comisiones'), valor: pesos(comisionesNetas), texto: txt(comisionesNetas) },
    { clave: 'neto', etiqueta: t('cierre.c_neto_cifra'), valor: pesos(c.netoCent), texto: txt(c.netoCent), tipo: 'calculado' },
  ];
  const graficaPuente = (
    <Tarjeta key="puente" titulo={t('cierre.g_puente')} elevar entra="tarjeta">
      <BarList items={puente} etiqueta={t('cierre.g_puente')} matiz={1} formato={(v) => mxn(v, idioma)} />
    </Tarjeta>
  );
  const margenes = c.margenes;
  const graficaMargen = margenes === null
    ? <Tarjeta key="margen" titulo={t('cierre.g_margen')} contenida><NotaVacia tono="info" titulo={t('bo.no_disponible')} /></Tarjeta>
    : margenes.length === 0
      ? <Tarjeta key="margen" titulo={t('cierre.g_margen')} contenida><NotaVacia titulo={t('cierre.g_margen_vacio')}>{t('cierre.g_margen_vacio_detalle')}</NotaVacia></Tarjeta>
      : (
        <Tarjeta key="margen" titulo={t('cierre.g_margen')} elevar entra="tarjeta">
          <BarList
            etiqueta={t('cierre.g_margen')} matiz={3} formato={(v) => mxn(v, idioma)}
            items={margenes.map((m): ItemBarList => ({
              clave: m.tenantId, etiqueta: m.nombre ?? m.tenantId.slice(0, 8), valor: pesos(m.margenCent), texto: txt(m.margenCent),
              nota: m.margenCent === null ? t('cierre.g_margen_sin_dato') : t('cierre.g_margen_nota', { ingreso: mxn((m.ingresosCent ?? 0) / 100, idioma), ia: mxn((m.costoIaCent ?? 0) / 100, idioma) }),
            }))}
          />
        </Tarjeta>
      );

  // ── Comprobaciones ──
  const dinero = (v: number | null): string => (v === null ? '—' : mxn(v / 100, idioma));
  const tablaComprobaciones = (
    <TablaBase<Comprobacion>
      etiqueta={t('cierre.comprobaciones')} idFila={(x) => x.clave} densa tarjetaMovil filas={vista.comprobaciones}
      columnas={[
        {
          id: 'nombre', titulo: t('cierre.col_comprobacion'), principal: true,
          celda: (x) => (
            <>
              {t(ROTULO_COMPROBACION[x.clave])}
              <span className="adm-din-sub">{t(AYUDA_COMPROBACION[x.clave])}</span>
            </>
          ),
        },
        { id: 'tipo', titulo: t('cierre.col_tipo'), celda: (x) => (x.bloqueante ? t('cierre.tipo_bloqueante') : t('cierre.tipo_informativa')) },
        { id: 'estado', titulo: t('cierre.col_estado'), celda: (x) => <StatusChip tono={TONO_COMPROBACION[x.estado]}>{t(ROTULO_ESTADO_COMPROBACION[x.estado])}</StatusChip> },
        { id: 'a', titulo: t('cierre.col_via_a'), alinear: 'der', celda: (x) => <span className="bo-monto">{dinero(x.aCent)}</span> },
        { id: 'b', titulo: t('cierre.col_via_b'), alinear: 'der', celda: (x) => <span className="bo-monto">{dinero(x.bCent)}</span> },
        {
          id: 'dif', titulo: t('cierre.col_diferencia'), alinear: 'der',
          celda: (x) => <span className="bo-monto bo-diferencia" data-tono={x.diffCent !== null && x.diffCent !== 0 ? 'bad' : undefined}>{dinero(x.diffCent)}</span>,
        },
        { id: 'n', titulo: t('cierre.col_filas'), alinear: 'der', celda: (x) => (x.n === null ? '—' : numero(x.n, idioma)) },
      ]}
    />
  );

  const estadoChip: { tono: TonoEstado; texto: string } = estado === null
    ? { tono: 'muted', texto: t('cierre.estado_sin_borrador') }
    : { tono: estado === 'cerrado' ? 'ok' : estado === 'listo' ? 'warn' : 'info', texto: t(ROTULO_ESTADO_CIERRE[estado]) };

  // ── Update a inversionistas: solo si cada cifra del texto existe en el cierre ──
  const borrador = armarUpdateInversionistas(c, t, { idioma, cobradoMesAnteriorCent: cobradoAnterior });
  const guardadoUpdate = update.estado === 'ok' ? update.dato : null;

  return (
    <EsqueletoPanelCifras
      titulo={t('pul9.h_cierre')} apoyo={t('cierre.apoyo')}
      acciones={<SelectorMes t={t} base="/admin/back-office/cierre" param="mes" periodo={periodo} tope={mesEnCurso} completo />}
      etiquetaCifras={t('cierre.cifras_mes', { mes: etiquetaMes(periodo, idioma) })} cifras={cifras}
      filtros={(
        <BarraFiltros
          accion="/admin/back-office/cierre" enLinea etiqueta={t('cierre.mes')} nActivos={periodo === porDefecto ? 0 : 1} limpiarHref="/admin/back-office/cierre"
        >
          <FiltroOpciones
            etiqueta={t('cierre.mes')} nombre="mes" valor={periodo} porDefecto={porDefecto}
            opciones={ultimosMeses(mesEnCurso, 12).reverse().map((p) => ({ valor: p, rotulo: etiquetaMes(p, idioma) }))}
          />
        </BarraFiltros>
      )}
      avisos={avisoMes || avisoEntidad ? <>{avisoMes}{avisoEntidad}</> : null}
      graficas={[graficaPuente, graficaMargen]} variante="6-6"
    >
      <div className="adm-pila">
        <FilaTarjetas variante="8-4" className="adm-fila-pareja">
          <Tarjeta
            titulo={t('cierre.comprobaciones')} elevar entra="tarjeta"
            acciones={<StatusChip tono="neutral">{vista.origen === 'cerrado' ? t('cierre.corrida_guardada') : t('cierre.corrida_ahora')}</StatusChip>}
          >
            <div className="bo-tabla-cierre">{tablaComprobaciones}</div>
            <p className="adm-din-nota">{t('cierre.comprobaciones_regla')}</p>
          </Tarjeta>
          <Tarjeta titulo={t('cierre.acciones', { mes: etiquetaMes(periodo, idioma) })} acciones={<StatusChip tono={estadoChip.tono}>{estadoChip.texto}</StatusChip>} elevar entra="tarjeta">
            <FormasCierre
              t={t} periodo={periodo} estado={estado} tablaDisponible={tablaDisponible} mesTerminado={mesTerminado}
              puedeListo={puedeListo} tipoCambio={guardado?.tipoCambio ?? c.tipoCambio}
            />
          </Tarjeta>
        </FilaTarjetas>

        <Tarjeta
          titulo={t('reporte.seccion')} elevar entra="tarjeta"
          acciones={borrador.ok ? (
            <BotonEnlace
              tamano="sm" variante="secondary" download={`update-${periodo.slice(0, 7)}.md`}
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(`﻿${borrador.markdown}`)}`}
            >
              {t('reporte.descargar')}
            </BotonEnlace>
          ) : undefined}
        >
          {borrador.ok ? (
            <div className="bo-acciones adm-forma-fina">
              <pre className="bo-md" tabIndex={0} aria-label={t('reporte.seccion')}>{borrador.markdown}</pre>
              <p className="adm-din-nota">
                {guardadoUpdate ? t('reporte.guardado_el', { cuando: fechaHoraMx(guardadoUpdate.actualizadoEn, idioma) }) : t('reporte.sin_guardar')} {t('reporte.nunca_se_envia')}
              </p>
              {tablaDisponible && guardado ? (
                <FormaConAviso accion={accionGuardarUpdate} boton={t('reporte.guardar')} columnas="md:grid-cols-1">
                  <input type="hidden" name="periodo" value={periodo} />
                </FormaConAviso>
              ) : (
                <p className="adm-din-nota">{t('reporte.requiere_borrador')}</p>
              )}
            </div>
          ) : (
            <Aviso tono="warn" titulo={t('reporte.no_se_ofrece')}>{t('reporte.no_se_ofrece_texto', { cifras: borrador.fuera.join(', ') })}</Aviso>
          )}
        </Tarjeta>
      </div>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_backoffice');
  return { title: t('cierre.metadata') };
}
