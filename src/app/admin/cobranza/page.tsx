import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperadmin } from '@/lib/auth/guard';
import { hoyMx, mxn } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { getPorCobrarTodas } from '@/lib/saas/transferencia';
import { getPiezasDunningPlataforma, getUltimaCorridaDunningPlataforma, type CorridaDunning, type PiezaDunning } from '@/lib/likida/repo';
import { armarEstadoDunning, type SelloToque } from '@/lib/likida/cobranza_estado';
import { toquesDeHoy, tituloToque } from '@/lib/likida/agentes/exito';
import type { FacturaPorCobrar } from '@/lib/saas/transferencia';
import { Aviso, AvisoCompacto, BotonEnlace, Disclosure, FilaTarjetas, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { Columnas } from '@/app/ui-v2/graficas';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { uniformes } from '../cifras-uniformes';
import { observadas } from '../sello-observado';
import '../dinero.css';

import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { rico } from '@/lib/i18n/rico';
export const dynamic = 'force-dynamic';

/**
 * Facturación › Cobranza. Likida cobrando a SUS clientes (no confundir con `gasto`: los comprobantes de gasto de un viaje son recibos
 * del conductor, un concepto totalmente distinto).
 *
 * El agente `cobranza_saas` (`agentes/exito.ts`) corre la cadencia de cinco toques −3/0/+3/+7/+15 contra `factura_saas`. Esta pantalla
 * muestra el estado REAL: qué facturas están por cobrar, qué toque le toca a cada una, y si su propuesta está pendiente, aprobada,
 * rechazada o enviada.
 *
 * LO QUE EL DUNNING NO HACE, y la página lo dice: produce PROPUESTAS a la bandeja de aprobación, no envíos — no hay canal de correo al
 * cliente aprobado, así que nada sale solo (MX-003: cablear el envío es mandar correo a clientes, un efecto externo que se decide aparte;
 * mientras tanto el texto no promete un «editar y mandar» que no existe). Y `null` es «no se pudo leer», `[]` es «no hay nada»: cada
 * lectura falla por separado y se avisa, para no decir «nada por cobrar» con la base caída.
 */
const TONO_SELLO: Record<SelloToque, TonoEstado> = { sin_propuesta: 'bad', superado: 'neutral', pendiente: 'warn', aprobada: 'warn', rechazada: 'neutral', enviada: 'ok' };
const textoSello = (k: SelloToque, t: TrDe<'admin_dinero'>): string => ({
  sin_propuesta: t('neg5.co_sello_sin_propuesta'),
  superado: t('neg5.co_sello_superado'),
  pendiente: t('neg5.co_sello_pendiente'),
  aprobada: t('neg5.co_sello_aprobada'),
  rechazada: t('neg5.co_sello_rechazada'),
  enviada: t('neg5.co_sello_enviada'),
})[k];

/** Filas de la lista; las cifras de arriba cubren todas las facturas, no solo estas. */
const FILAS_MOSTRADAS = 50;

const rotuloEstadoFactura = (e: string, t: TrDe<'admin_dinero'>): string => (({
  pendiente: t('neg5.est_pendiente'), fallida: t('neg5.est_fallida'), pagada: t('neg5.est_pagada'), cancelada: t('neg5.est_cancelada'),
} as Record<string, string>)[e] ?? e);

const hito = (h: number) => `D${h >= 0 ? '+' : ''}${h}`;

async function leer<T>(nombre: string, f: () => Promise<T>): Promise<{ dato: T | null; error: boolean }> {
  try { return { dato: await f(), error: false }; }
  catch (e) { logger.error(`admin.cobranza.${nombre}`, { err: e instanceof Error ? e.message : String(e) }); return { dato: null, error: true }; }
}


export default async function CobranzaPage({ searchParams }: { searchParams?: Promise<{ ver?: string }> }) {
  const { t } = await getT('admin_dinero');
  // La puerta de la PÁGINA, no solo la del layout: en Next un layout no se vuelve a ejecutar si la petición RSC declara que el cliente
  // ya lo tiene, así que lo único que protege estos datos de TODAS las flotas (service role) es esta llamada.
  await requireSuperadmin();
  const hoy = hoyMx();
  const ver = ((await searchParams) ?? {}).ver ?? '';
  // Los totales se calculan sobre TODAS las pendientes/fallidas (conteo exacto de la base), no sobre las filas que se pintan; la lista
  // se acota a FILAS_MOSTRADAS y lo dice.
  const [facturas, corrida] = await Promise.all([
    leer<{ facturas: FacturaPorCobrar[]; total: number }>('por_cobrar', getPorCobrarTodas),
    leer<CorridaDunning | null>('corrida', getUltimaCorridaDunningPlataforma),
  ]);
  // Las piezas se piden por los títulos de los toques de esas facturas: nunca «las N más nuevas», que dejaba a las facturas viejas con
  // un falso «sin propuesta».
  const piezas = facturas.dato
    ? await leer<PiezaDunning[]>('piezas', () => getPiezasDunningPlataforma(toquesDeHoy(facturas.dato!.facturas, hoy).map(tituloToque)))
    : { dato: null as PiezaDunning[] | null, error: false };
  const estado = facturas.dato ? armarEstadoDunning(facturas.dato.facturas, piezas.dato ?? [], hoy) : null;
  const filasVistas = estado ? estado.facturas.slice(0, FILAS_MOSTRADAS) : [];
  const totalBase = facturas.dato?.total ?? 0;
  const truncada = !!facturas.dato && totalBase > facturas.dato.facturas.length;
  const hayError = facturas.error || piezas.error || corrida.error;

  const posicion = ver ? filasVistas.findIndex((f) => f.factura.id === ver) : -1;
  const sel = posicion >= 0 ? filasVistas[posicion] : null;

  // Una lectura completa con todo en cero SÍ es un dato (cero mensualidades): se muestra (Rovaq pinta la tira y la tabla aunque estén en cero).
  // Solo una lectura caída deja la tira vacía.
  const cifras = estado ? uniformes([
    { etiqueta: t('cobranza.por_cobrar'), valor: `${totalBase} · ${mxn(estado.montoPorCobrar)}`, nota: truncada ? t('cobranza.incompleto_hay_mas_facturas') : undefined, tono: truncada ? 'warn' as const : undefined },
    { etiqueta: t('cobranza.vencidas'), valor: `${estado.vencidas} · ${mxn(estado.montoVencido)}`, tono: estado.vencidas > 0 ? 'bad' as const : undefined },
    {
      etiqueta: t('cobranza.toques_sin_propuesta'), valor: String(estado.toquesSinPropuesta),
      nota: estado.toquesSinPropuesta > 0 ? t('cobranza.el_agente_no_ha') : undefined,
      tono: estado.toquesSinPropuesta > 0 && !piezas.error ? 'warn' as const : undefined,
    },
    { etiqueta: t('cobranza.propuestas_pendientes_enviadas_por'), valor: `${estado.propuestasPendientes} / ${estado.propuestasEnviadas}` },
  ]) : undefined;

  // Antigüedad: monto por tramo de días desde el corte, sobre las facturas leídas (nunca un tramo sin facturas inventado: 0 es 0 pesos reales).
  const tramos = estado ? [
    { etiqueta: t('cobranza.ant_por_vencer'), cumple: (d: number) => d <= 0 },
    { etiqueta: t('cobranza.ant_0_7'), cumple: (d: number) => d > 0 && d <= 7 },
    { etiqueta: t('cobranza.ant_8_30'), cumple: (d: number) => d > 7 && d <= 30 },
    { etiqueta: t('cobranza.ant_31'), cumple: (d: number) => d > 30 },
  ].map((b) => ({ etiqueta: b.etiqueta, valor: estado.facturas.filter((f) => b.cumple(f.dias)).reduce((s, f) => s + f.factura.monto, 0) })) : [];

  return (
    <EsqueletoTablaMaestra
      titulo={t('cobranza.facturacion')} apoyo={t('cobranza.seguimiento_de_lo_que')}
      etiquetaCifras={t('cobranza.cobranza_de_las_mensualidades')}
      cifras={cifras ? observadas(cifras, t('a1r4.observado')) : undefined}
      vistaRapida={sel ? (
        <CajonVistaRapida
          titulo={sel.factura.tenantNombre} subtitulo={t('cobranza.vr_subtitulo', { n: posicion + 1, total: filasVistas.length })} hrefCerrar="/admin/cobranza"
          cifras={[
            { etiqueta: t('cobranza.total'), valor: mxn(sel.factura.monto) },
            { etiqueta: t('cobranza.corte'), valor: sel.dias >= 0 ? t('cobranza.dias_desde_el_corte', { dias: sel.dias }) : t('cobranza.faltan_dias', { dias: -sel.dias }) },
            { etiqueta: t('cobranza.toques'), valor: String(sel.toques.length) },
            { etiqueta: t('facturas.periodo'), valor: t('neg5.rango_a', { ini: sel.factura.periodoInicio, fin: sel.factura.periodoFin }) },
          ]}
          pie={<BotonEnlace variante="primary" href="/admin/costos-facturacion">{t('cobranza.vr_abrir')}</BotonEnlace>}
        />
      ) : null}
      avisos={(
        <>
          {hayError ? (
            <Aviso tono="error" titulo={t('cobranza.no_se_pudo_leer')}>
              {facturas.error && t('cobranza.las_facturas_por_cobrar')}
              {piezas.error && t('cobranza.las_propuestas_de_recordatorio')}
              {corrida.error && t('cobranza.la_ultima_corrida_del')}
              {t('cobranza.recarga_la_pagina_si')}
            </Aviso>
          ) : null}
          <AvisoCompacto
            tono="info"
            resumen={t('neg5.co_resumen')}
            mas={rico(t('neg5.co_mas'), {
              strong: (c) => <strong>{c}</strong>,
              aprob: (c) => <Link href="/admin/aprobaciones">{c}</Link>,
              plan: (c) => <Link href="/admin/costos-facturacion">{c}</Link>,
            })}
          />
        </>
      )}
    >
      <FilaTarjetas variante="6-6" className="adm-fila-pareja">
        <Tarjeta titulo={t('cobranza.ultima_corrida_del_agente')} estado={corrida.error ? 'error' : 'ok'} mensaje={t('cobranza.no_se_pudo_leer_2')} reintentar>
          {corrida.dato === null ? (
            <p className="adm-din-nota">
              <StatusChip tono="warn">{t('cobranza.nunca_ha_corrido')}</StatusChip>  {t('cobranza.no_hay_una_sola')}
            </p>
          ) : (
            <>
              <p className="adm-din-nota">
                <StatusChip tono={corrida.dato.estado === 'ok' ? 'ok' : 'bad'}>{corrida.dato.estado === 'ok' ? t('cobranza.ultima_corrida_ok') : t('cobranza.ultima_corrida_con_fallo')}</StatusChip>{' '}
                {corrida.dato.fin.slice(0, 16).replace('T', ' ')} UTC
              </p>
              {corrida.dato.error ? <Aviso tono="error">{corrida.dato.error}</Aviso> : null}
            </>
          )}
        </Tarjeta>
        {estado ? (
          <Tarjeta titulo={t('cobranza.antiguedad_titulo')}>
            <Columnas datos={tramos} etiqueta={t('cobranza.antiguedad_etiqueta')} formato="mxnCompacto" matiz={8} alto={120} variacion={false} />
            <p className="adm-din-nota">{t('cobranza.antiguedad_nota')}</p>
          </Tarjeta>
        ) : null}
      </FilaTarjetas>

      {estado ? (
        <Tarjeta titulo={t('cobranza.facturas_por_cobrar_y')}>
          {estado.facturas.length > filasVistas.length || truncada ? (
            <p className="adm-din-nota" role="note">
              {truncada ? t('neg5.co_mostrando_trunc', { n: filasVistas.length, total: totalBase, leidas: estado.facturas.length }) : t('neg5.co_mostrando_todas', { n: filasVistas.length, total: totalBase })}
            </p>
          ) : null}
          <TablaBase
            etiqueta={t('cobranza.facturas_por_cobrar_y')} idFila={(f) => f.factura.id} tarjetaMovil filas={filasVistas}
            vacio={{ titulo: t('neg5.co_cero_mensualidades'), texto: t('cobranza.no_hay_ninguna_factura') }}
            columnas={[
              { id: 'flota', titulo: t('cobranza.flota'), principal: true, celda: (f) => f.factura.tenantNombre },
              { id: 'monto', titulo: t('cobranza.total'), alinear: 'der', celda: (f) => mxn(f.factura.monto) },
              {
                id: 'corte', titulo: t('cobranza.corte'),
                celda: (f) => (
                  <>
                    <StatusChip tono={f.vencida ? 'bad' : 'neutral'}>{f.dias >= 0 ? t('cobranza.dias_desde_el_corte', { dias: f.dias }) : t('cobranza.faltan_dias', { dias: -f.dias })}</StatusChip>
                    <span className="adm-din-sub">{rotuloEstadoFactura(f.factura.estado, t)} · {t('neg5.rango_a', { ini: f.factura.periodoInicio, fin: f.factura.periodoFin })}</span>
                  </>
                ),
              },
              {
                id: 'toques', titulo: t('cobranza.toques'),
                celda: (f) => (f.toques.length === 0 ? (
                  <>{t('neg5.co_aun_no_toque', { hito: hito(f.proximoHito ?? -3) })}</>
                ) : (
                  <span className="adm-din-acciones adm-cob-toques">
                    {(() => {
                      const ultimo = f.toques[f.toques.length - 1];
                      const previos = f.toques.slice(0, -1);
                      const detalle = f.toques.map((q) => `${hito(q.hito)} · ${piezas.error ? t('cobranza.estado_de_la_propuesta') : textoSello(q.sello, t)}`).join('\n');
                      return (
                        <>
                          <StatusChip tono={piezas.error ? 'neutral' : TONO_SELLO[ultimo.sello]} title={detalle}>
                            {hito(ultimo.hito)} · {piezas.error ? t('cobranza.estado_de_la_propuesta') : textoSello(ultimo.sello, t)}
                          </StatusChip>
                          {previos.length > 0 ? <span className="adm-din-sub">{t('pul9.co_previos', { n: previos.length })}</span> : null}
                        </>
                      );
                    })()}
                    {f.proximoHito !== null ? <span className="adm-din-sub">{t('neg5.co_siguiente', { hito: hito(f.proximoHito) })}</span> : null}
                  </span>
                )),
              },
              { id: 'vr', titulo: '', alinear: 'der', celda: (f) => <BotonEnlace className="adm-cob-vr" href={`/admin/cobranza?ver=${encodeURIComponent(f.factura.id)}`} variante="ghost" tamano="sm">{t('cobranza.vista_rapida')}</BotonEnlace> },
            ]}
          />
        </Tarjeta>
      ) : null}

      <Disclosure titulo={t('cobranza.que_no_se_mide')} resumen={t('neg5.co_resumen_dias')}>
        <p className="adm-din-nota">
          
          {t('cobranza.pendiente_de_construir_los')}
        </p>
      </Disclosure>
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_dinero');
  return { title: t('cobranza.facturacion') };
}
