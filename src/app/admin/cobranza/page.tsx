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
import { Aviso, AvisoCompacto, Disclosure, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import '../dinero.css';

import { getT } from '@/lib/i18n/servidor';
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
const ROTULO_SELLO: Record<SelloToque, { texto: string; tono: TonoEstado }> = {
  sin_propuesta: { texto: 'sin propuesta', tono: 'bad' },
  superado: { texto: 'sin propuesta (el agente solo propone el toque más alto)', tono: 'neutral' },
  pendiente: { texto: 'propuesta pendiente', tono: 'warn' },
  aprobada: { texto: 'aprobada, sin enviar', tono: 'warn' },
  rechazada: { texto: 'rechazada', tono: 'neutral' },
  enviada: { texto: 'enviada', tono: 'ok' },
};

/** Filas de la lista; las cifras de arriba cubren todas las facturas, no solo estas. */
const FILAS_MOSTRADAS = 50;

const hito = (h: number) => `D${h >= 0 ? '+' : ''}${h}`;

async function leer<T>(nombre: string, f: () => Promise<T>): Promise<{ dato: T | null; error: boolean }> {
  try { return { dato: await f(), error: false }; }
  catch (e) { logger.error(`admin.cobranza.${nombre}`, { err: e instanceof Error ? e.message : String(e) }); return { dato: null, error: true }; }
}


export default async function CobranzaPage() {
  const { t } = await getT('admin_dinero');
  // La puerta de la PÁGINA, no solo la del layout: en Next un layout no se vuelve a ejecutar si la petición RSC declara que el cliente
  // ya lo tiene, así que lo único que protege estos datos de TODAS las flotas (service role) es esta llamada.
  await requireSuperadmin();
  const hoy = hoyMx();
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
  // Sin facturas leídas, sin total en la base y sin propuestas: ninguna de las 4 cifras tiene base real que medir.
  const sinBase = !!estado && totalBase === 0 && estado.facturas.length === 0 && estado.propuestasPendientes === 0 && estado.propuestasEnviadas === 0;
  const hayError = facturas.error || piezas.error || corrida.error;

  const cifras = estado && !sinBase ? [
    { etiqueta: t('cobranza.por_cobrar'), valor: `${totalBase} · ${mxn(estado.montoPorCobrar)}`, nota: truncada ? t('cobranza.incompleto_hay_mas_facturas') : undefined, tono: truncada ? 'warn' as const : undefined },
    { etiqueta: t('cobranza.vencidas'), valor: `${estado.vencidas} · ${mxn(estado.montoVencido)}`, tono: estado.vencidas > 0 ? 'bad' as const : undefined },
    {
      etiqueta: t('cobranza.toques_sin_propuesta'), valor: String(estado.toquesSinPropuesta),
      nota: estado.toquesSinPropuesta > 0 ? t('cobranza.el_agente_no_ha') : undefined,
      tono: estado.toquesSinPropuesta > 0 && !piezas.error ? 'warn' as const : undefined,
    },
    { etiqueta: t('cobranza.propuestas_pendientes_enviadas_por'), valor: `${estado.propuestasPendientes} / ${estado.propuestasEnviadas}` },
  ] : undefined;

  return (
    <EsqueletoTablaMaestra
      titulo={t('cobranza.facturacion')} apoyo={t('cobranza.seguimiento_de_lo_que')}
      etiquetaCifras={t('cobranza.cobranza_de_las_mensualidades')}
      cifras={cifras}
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
            resumen="El dunning de las mensualidades de Likida ya corre: prepara recordatorios en cinco toques, como propuestas a la bandeja de aprobación, no envíos."
            mas={(
              <>
                El agente de cobranza recorre las facturas pendientes o fallidas y, para cada una, prepara un recordatorio —3 días antes del corte, el día, y +3, +7 y +15—.
                Son <strong>propuestas a la bandeja de aprobación, no envíos</strong>: no hay canal de correo al cliente aprobado y nada sale solo. En{' '}
                <Link href="/admin/aprobaciones">Aprobaciones</Link> el dueño solo aprueba o rechaza la propuesta; el envío al cliente lo hace por su cuenta y el sistema no lo registra,
                así que «enviadas» seguirá en 0 hasta que exista ese canal. Emitir la mensualidad, conciliar el pago contra el banco y timbrar el CFDI se hace en{' '}
                <Link href="/admin/costos-facturacion">Planes y cobro</Link>. El vencimiento se toma como el inicio del periodo (la mensualidad se cobra por adelantado).
              </>
            )}
          />
        </>
      )}
    >
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
        <Tarjeta
          titulo={t('cobranza.facturas_por_cobrar_y')} estado={estado.facturas.length === 0 ? 'vacio' : 'ok'}
          mensaje="0 mensualidades por cobrar" detalle={t('cobranza.no_hay_ninguna_factura')}
        >
          {estado.facturas.length > filasVistas.length || truncada ? (
            <p className="adm-din-nota" role="note">
              Mostrando {filasVistas.length} de {totalBase}; las cifras de arriba cubren {truncada ? `las ${estado.facturas.length} leídas (hay más en la base: sus totales están incompletos)` : 'todas'}.
            </p>
          ) : null}
          <TablaBase
            etiqueta={t('cobranza.facturas_por_cobrar_y')} idFila={(f) => f.factura.id} tarjetaMovil densa filas={filasVistas}
            columnas={[
              { id: 'flota', titulo: t('cobranza.flota'), principal: true, celda: (f) => f.factura.tenantNombre },
              { id: 'monto', titulo: t('cobranza.total'), alinear: 'der', celda: (f) => mxn(f.factura.monto) },
              {
                id: 'corte', titulo: t('cobranza.corte'),
                celda: (f) => (
                  <>
                    <StatusChip tono={f.vencida ? 'bad' : 'neutral'}>{f.dias >= 0 ? t('cobranza.dias_desde_el_corte', { dias: f.dias }) : t('cobranza.faltan_dias', { dias: -f.dias })}</StatusChip>
                    <span className="adm-din-sub">{f.factura.estado} · {f.factura.periodoInicio} a {f.factura.periodoFin}</span>
                  </>
                ),
              },
              {
                id: 'toques', titulo: t('cobranza.toques'),
                celda: (f) => (f.toques.length === 0 ? (
                  <>Aún no alcanza el primer toque ({hito(f.proximoHito ?? -3)}).</>
                ) : (
                  <span className="adm-din-acciones">
                    {f.toques.map((toque) => (
                      <StatusChip key={toque.hito} tono={piezas.error ? 'neutral' : ROTULO_SELLO[toque.sello].tono}>
                        {hito(toque.hito)} · {piezas.error ? t('cobranza.estado_de_la_propuesta') : ROTULO_SELLO[toque.sello].texto}
                      </StatusChip>
                    ))}
                    {f.proximoHito !== null ? <span className="adm-din-sub">siguiente: {hito(f.proximoHito)}</span> : null}
                  </span>
                )),
              },
            ]}
          />
        </Tarjeta>
      ) : null}

      <Disclosure titulo={t('cobranza.que_no_se_mide')} resumen="Días de cobro y recuperación">
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
