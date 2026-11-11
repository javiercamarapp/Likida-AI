import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { getConsumoPorAgente, getPresupuestoPorProposito, type Insight, type GastoProposito } from '@/lib/admin/consumo';
import { avisosDeTopeEncendidos, DIAS_SIN_REGISTRO_AVISO, diasSinRegistroIa, leerEstadoCreditoIa, type EstadoCreditoIa } from '@/lib/admin/estado-ia';
import { listarAlertasTopeRecientes, type FilaAlertaTope } from '@/lib/llm/repo';
import { ahoraMs } from '@/lib/saludo';
import { hoyMx, numero, usd } from '@/lib/formato';
import { Aviso, AvisoCompacto, BotonEnlace, Disclosure, EstadoError, FilaTarjetas, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { BarList, Columnas, ColumnasApiladas, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { getT } from '@/lib/i18n/servidor';
import { gastoApiladoPorFlota } from './apilado';

import { uniformes } from '../cifras-uniformes';
import '../dinero.css';

import type { TrDe } from '@/lib/i18n/tr_tipos';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/consumo — A DÓNDE Y POR QUÉ SE VA EL DINERO DE IA. Por agente, por flota, por modelo y por fase, con la serie diaria, los
// insights deterministas (cada uno una regla con su dato, jamás un LLM opinando) y, arriba, lo que hace que TODA la IA se detenga:
// el crédito del proveedor (402) y los avisos de 80 % y 100 % del techo diario. Cada lectura cae por su lado: lo que no se pudo medir
// se dice, nunca se pinta como cero.
// ═══════════════════════════════════════════════════════════════════════════

const tonoInsight = (ta: TrDe<'admin_dinero'>): Record<Insight['tipo'], { tono: TonoEstado; rotulo: string }> => ({
  problema: { tono: 'bad', rotulo: 'Problema' },
  recomendacion: { tono: 'warn', rotulo: ta('consumo.recomendacion') },
  insight: { tono: 'neutral', rotulo: 'Dato' },
});

/** Cuántos días hacia atrás se listan los avisos de tope. */
const DIAS_AVISOS_TOPE = 7;

const faseRotulo = (ta: TrDe<'admin_dinero'>): Record<string, string> => ({
  ocr: ta('consumo.lectura_de_comprobantes'), cuadre: 'Cuadre', escalacion: ta('consumo.escalacion'), chat: 'Chat', router: 'Enrutador', whatsapp: 'WhatsApp',
});

/** Texto del estado del crédito: qué pasa, qué consecuencia tiene y qué hacer. Sin variables de entorno ni jerga. */
function textoCredito(c: EstadoCreditoIa, ta: TrDe<'admin_dinero'>): { tono: 'error' | 'warn' | null; titulo: string; texto: string } {
  switch (c.clave) {
    case 'sin_saldo':
      return { tono: 'error', titulo: ta('consumo.credito_de_ia_agotado'), texto: ta('consumo.el_proveedor_rechaza_toda') };
    case 'llave_invalida':
      return { tono: 'error', titulo: ta('consumo.el_proveedor_rechazo_la'), texto: ta('consumo.toda_la_ia_esta') };
    case 'sin_llave':
      return { tono: 'error', titulo: ta('consumo.no_hay_llave_de'), texto: ta('consumo.sin_llave_no_hay') };
    case 'sin_permiso':
      return { tono: 'warn', titulo: ta('consumo.el_proveedor_nego_una'), texto: ta('consumo.puede_ser_un_modelo') };
    case 'inalcanzable':
      return { tono: 'warn', titulo: ta('consumo.no_se_pudo_comprobar'), texto: ta('consumo.el_proveedor_no_contesto') };
    case 'sin_dato':
      return { tono: 'warn', titulo: ta('consumo.no_se_pudo_comprobar'), texto: ta('consumo.la_prueba_de_la') };
    default:
      return { tono: null, titulo: '', texto: '' };
  }
}

function cifraCredito(c: EstadoCreditoIa, ta: TrDe<'admin_dinero'>) {
  const t = textoCredito(c, ta);
  if (c.clave === 'ok') {
    return c.restanteUsd === null
      ? { valor: ta('consumo.con_credito'), nota: ta('consumo.el_proveedor_no_reporta'), tono: 'ok' as const }
      : { valor: usd(c.restanteUsd), nota: ta('consumo.saldo_restante_que_reporta'), tono: c.restanteUsd < 5 ? ('warn' as const) : ('ok' as const) };
  }
  const caido = c.clave === 'sin_saldo' || c.clave === 'llave_invalida' || c.clave === 'sin_llave';
  return { valor: caido ? ta('consumo.ia_caida') : null, nota: t.titulo, tono: caido ? ('bad' as const) : ('warn' as const) };
}

const dia = (aaaammdd: string) => {
  const [y, m, d] = aaaammdd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : aaaammdd;
};

export default async function ConsumoPage() {
  const { t: ta } = await getT('admin_dinero');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const hoy = hoyMx();
  const desdeAvisos = (() => { const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (DIAS_AVISOS_TOPE - 1)); return d.toISOString().slice(0, 10); })();
  // Resiliencia POR SECCIÓN: el gasto del producto y el del back office caen por su lado; lo que no cargó LO DICE.
  const [r, consumo, proposito, credito, avisos] = await Promise.all([
    getResumenNegocio().catch(() => null),
    getConsumoPorAgente(ahoraMs()).catch(() => null),
    getPresupuestoPorProposito().catch(() => null),
    leerEstadoCreditoIa(),
    listarAlertasTopeRecientes(desdeAvisos).catch(() => null),
  ]);
  const todoCaido = r === null && consumo === null;
  const { t } = await getT('graficas');

  const textoCred = textoCredito(credito, ta);
  const cifraCred = cifraCredito(credito, ta);
  const problemas = (consumo?.insights ?? []).filter((i) => i.tipo === 'problema');
  const resto = (consumo?.insights ?? []).filter((i) => i.tipo !== 'problema');
  const diasSin = r ? diasSinRegistroIa(r.porDia, hoy) : null;
  const avisosEncendidos = avisosDeTopeEncendidos();
  const costoPorViaje = r && r.viajesProcesados > 0 ? r.costoIaUsd / r.viajesProcesados : null;
  const corridas = consumo ? consumo.agentes.reduce((s, a) => s + a.corridas30d, 0) : null;
  const fallos = consumo ? consumo.agentes.reduce((s, a) => s + a.fallos30d, 0) : null;
  const gastoAgentes = consumo ? consumo.agentes.reduce((s, a) => s + a.gastado30dUsd, 0) : null;

  const cifras: PropsCifra[] | undefined = todoCaido ? undefined : uniformes([
    r
      ? { etiqueta: ta('consumo.gastado_en_ia_historico'), valor: r.costoIaUsd, formato: 'usd', deltaPct: r.tendenciaCosto === null ? null : { pct: r.tendenciaCosto, bueno: r.tendenciaCosto < 0 }, deltaNota: ta('consumo.ultimos_7_dias_vs') }
      : { etiqueta: ta('consumo.gastado_en_ia_historico'), valor: null, estado: 'error', reintentar: true },
    r
      ? { etiqueta: ta('consumo.costo_por_viaje_procesado'), valor: costoPorViaje, formato: 'usd', nota: costoPorViaje === null ? ta('consumo.aun_no_hay_viajes') : ta('consumo.estimado_gasto_total_de'), tipo: 'estimado' }
      : { etiqueta: ta('consumo.costo_por_viaje_procesado'), valor: null, estado: 'error', reintentar: true },
    consumo
      ? { etiqueta: ta('consumo.agentes_ultimos_30_dias'), valor: gastoAgentes, formato: 'usd', nota: `${numero(corridas ?? 0)} corridas, ${numero(fallos ?? 0)} en fallo.` }
      : { etiqueta: ta('consumo.agentes_ultimos_30_dias'), valor: null, estado: 'error', mensaje: ta('consumo.la_medicion_por_agente'), reintentar: true },
    { etiqueta: ta('consumo.credito_del_proveedor'), valor: cifraCred.valor, nota: cifraCred.nota, tono: cifraCred.tono, estado: cifraCred.valor === null ? 'vacio' : 'ok', mensaje: ta('consumo.no_se_pudo_comprobar_2') },
  ]);

  // Como máximo DOS avisos visibles (Rovaq): los más graves primero (error antes que aviso) y el resto plegado en el segundo.
  const avisosLista: AvisoItem[] = [
    ...(textoCred.tono ? [{ tono: textoCred.tono, titulo: textoCred.titulo, texto: textoCred.texto }] : []),
    ...problemas.map((i) => ({ tono: 'error' as const, titulo: i.titulo, texto: i.detalle })),
    ...(!avisosEncendidos ? [{ tono: 'warn' as const, titulo: ta('consumo.los_avisos_de_tope'), texto: ta('consumo.una_flota_puede_llegar') }] : []),
    ...(diasSin !== null && diasSin >= DIAS_SIN_REGISTRO_AVISO ? [{ tono: 'warn' as const, titulo: ta('consumo.sin_llamadas_de_ia', { diasSin: numero(diasSin) }), texto: ta('consumo.puede_ser_que_no') }] : []),
  ].sort((x, y) => (x.tono === y.tono ? 0 : x.tono === 'error' ? -1 : 1));

  return (
    <EsqueletoPanelCifras
      titulo={ta('consumo.consumo_de_ia')} apoyo={ta('consumo.a_donde_se_va')} variante="8-4"
      etiquetaCifras={ta('consumo.gasto_de_ia')} cifras={cifras}
      avisos={todoCaido ? undefined : <AvisosAcotados avisos={avisosLista} resto={ta} />}
      graficas={todoCaido ? undefined : [
        <Tarjeta key="gasto" titulo={ta('consumo.gasto_de_ia_por')} estado={r && r.porDia.length > 1 ? 'ok' : r ? 'vacio' : 'error'} contenida={!!r && r.porDia.length <= 1} mensaje={r ? ta('consumo.sin_historial_suficiente') : undefined} detalle={ta('consumo.hacen_falta_al_menos')} reintentar>
          {r ? (
            <>
              <Columnas etiqueta={ta('consumo.gasto_de_ia_por')} datos={r.porDia.map((d) => ({ etiqueta: d.dia.slice(5), largo: dia(d.dia), valor: d.costoUsd }))} formato="usd" vacio="Sin gasto registrado" />
              <p className="adm-din-nota">Tokens usados, histórico: {numero(r.tokensIn)} de entrada y {numero(r.tokensOut)} de salida.</p>
            </>
          ) : null}
        </Tarjeta>,
        <AvisosDeTope key="tope" ta={ta} avisos={avisos} encendidos={avisosEncendidos} />,
      ]}
    >
      {todoCaido ? <EstadoError reintentar>{ta('consumo.no_se_pudo_leer')}</EstadoError> : <>
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo={ta('consumo.por_modelo')} estado={!r ? 'error' : r.porModelo.length === 0 ? 'vacio' : 'ok'} mensaje={r ? ta('consumo.sin_llamadas_registradas') : ta('consumo.no_se_pudo_leer_2')} detalle={ta('consumo.aparece_en_cuanto_el')} reintentar
          acciones={<BotonEnlace href="/admin/costos-facturacion" variante="ghost" tamano="sm">{ta('consumo.ver_cobro')}</BotonEnlace>}>
          {r ? <BarList etiqueta={ta('consumo.gasto_por_modelo')} items={r.porModelo.slice(0, 8).map((m) => ({ clave: m.modelo, etiqueta: m.modelo, valor: m.costoUsd, texto: usd(m.costoUsd), nota: `${numero(m.n)} llamadas` }))} formato={usd} /> : null}
        </Tarjeta>
        <Tarjeta titulo={ta('consumo.por_fase')} estado={!r ? 'error' : r.porFase.length === 0 ? 'vacio' : 'ok'} mensaje={r ? ta('consumo.sin_llamadas_registradas') : ta('consumo.no_se_pudo_leer_2')} detalle={ta('consumo.muestra_en_que_trabajo')} reintentar>
          {r ? <BarList etiqueta={ta('consumo.gasto_por_fase')} items={r.porFase.slice(0, 8).map((f) => ({ clave: f.fase, etiqueta: faseRotulo(ta)[f.fase] ?? f.fase, valor: f.costoUsd, texto: usd(f.costoUsd), nota: `${numero(f.n)} llamadas` }))} formato={usd} /> : null}
        </Tarjeta>
      </FilaTarjetas>

      {proposito && proposito.filas.length > 0 ? (
        <Tarjeta titulo={t('consumo.propositos.titulo')} elevar entra="tarjeta">
          {(() => {
            const g = gastoApiladoPorFlota(proposito.filas);
            return <ColumnasApiladas etiqueta={t('consumo.propositos.etiqueta')} series={g.series.map((s) => t(`consumo.propositos.${s}`))} periodos={g.periodos} formato="usd" />;
          })()}
          <p className="adm-din-nota">{t('consumo.propositos.nota')}</p>
        </Tarjeta>
      ) : null}

      <Tarjeta titulo={ta('consumo.por_agente_gasto_medido')} estado={consumo ? 'ok' : 'error'} mensaje={ta('consumo.la_medicion_por_agente_2')} reintentar>
        {consumo ? (
          <TablaBase
            etiqueta={ta('consumo.consumo_por_agente_en')} idFila={(a) => a.agente} tarjetaMovil
            vacio={{ titulo: ta('consumo.sin_agentes_con_registro'), texto: ta('consumo.aparecen_cuando_un_agente') }}
            filas={consumo.agentes}
            columnas={[
              { id: 'agente', titulo: ta('consumo.agente'), principal: true, celda: (a) => <>{a.agente} <StatusChip tono={a.estado === 'vivo' ? 'ok' : 'neutral'}>{a.estado}{a.runnerHabilitado ? ta('consumo.automatico') : ''}</StatusChip></> },
              { id: 'corridas', titulo: ta('consumo.corridas_30_d'), alinear: 'der', celda: (a) => numero(a.corridas30d) },
              { id: 'fallos', titulo: ta('consumo.fallos'), alinear: 'der', celda: (a) => (a.fallos30d > 0 ? <StatusChip tono="bad">{numero(a.fallos30d)}</StatusChip> : numero(a.fallos30d)) },
              { id: 'gasto', titulo: ta('consumo.gasto_30_d'), alinear: 'der', celda: (a) => usd(a.gastado30dUsd) },
              { id: 'techo', titulo: ta('consumo.hoy_contra_su_techo'), alinear: 'der', celda: (a) => (a.techoDiaUsd === null ? ta('consumo.sin_techo_declarado') : `${numero(a.pctTechoHoy ?? 0)} % de ${usd(a.techoDiaUsd)}`) },
            ]}
          />
        ) : null}
      </Tarjeta>

      <Tarjeta titulo={ta('consumo.por_flota_costo_de')} estado={!r ? 'error' : r.flotas.length === 0 ? 'vacio' : 'ok'} mensaje={r ? ta('consumo.sin_flotas_dadas_de') : ta('consumo.no_se_pudo_leer_3')} detalle={ta('consumo.cada_flota_aparece_aqui')} reintentar>
        {r ? (
          <TablaBase
            etiqueta={ta('consumo.costo_de_ia_por')} idFila={(f) => f.id} tarjetaMovil
            filas={[...r.flotas].sort((a, b) => b.costoIaUsd - a.costoIaUsd)}
            columnas={[
              { id: 'flota', titulo: ta('consumo.flota'), principal: true, celda: (f) => f.nombre },
              { id: 'viajes', titulo: ta('consumo.viajes'), alinear: 'der', celda: (f) => numero(f.viajes) },
              { id: 'costo', titulo: ta('consumo.costo_de_ia_todo'), alinear: 'der', celda: (f) => usd(f.costoIaUsd) },
            ]}
          />
        ) : null}
      </Tarjeta>

      <Tarjeta titulo={ta('consumo.presupuesto_por_proposito_hoy')} estado={proposito ? (proposito.filas.length === 0 ? 'vacio' : 'ok') : 'error'} mensaje={proposito ? ta('consumo.hoy_nadie_ha_gastado') : ta('consumo.no_se_pudo_leer_4')} detalle={ta('consumo.dia_de_mexico_aparece')} reintentar>
        {proposito ? (
          <>
            <p className="adm-din-nota">
              Techo diario por flota: {usd(proposito.topeTenantDiaUsd)}. Reserva del camino interactivo (chofer y chats): {usd(proposito.reservaInteractivoUsd)} ({Math.round(proposito.fraccionReserva * 100)} %).
              El trabajo de fondo (lectura de lote y agentes) solo llega a {usd(proposito.topeTenantDiaUsd - proposito.reservaInteractivoUsd)}.
            </p>
            <TablaBase
              etiqueta={ta('consumo.gasto_de_hoy_por')} idFila={(f: GastoProposito) => `${f.tenantId}-${f.proposito}`} tarjetaMovil
              filas={proposito.filas}
              columnas={[
                { id: 'flota', titulo: ta('consumo.flota'), principal: true, celda: (f: GastoProposito) => f.tenantNombre },
                { id: 'prop', titulo: ta('consumo.proposito'), celda: (f: GastoProposito) => f.proposito },
                { id: 'n', titulo: ta('consumo.llamadas'), alinear: 'der', celda: (f: GastoProposito) => numero(f.n) },
                { id: 'liq', titulo: ta('consumo.liquidado_hoy'), alinear: 'der', celda: (f: GastoProposito) => usd(f.liquidadoUsd) },
                { id: 'res', titulo: ta('consumo.reservado_vivo'), alinear: 'der', celda: (f: GastoProposito) => usd(f.reservadoVivoUsd) },
                {
                  id: 'techo', titulo: ta('consumo.contra_su_techo'), alinear: 'der',
                  celda: (f: GastoProposito) => {
                    // El techo del propósito: el fondo tiene (tope − reserva); el interactivo, el tope completo.
                    const techo = f.proposito === 'interactivo' ? proposito.topeTenantDiaUsd : proposito.topeTenantDiaUsd - proposito.reservaInteractivoUsd;
                    const pct = techo > 0 ? Math.min(100, Math.round(((f.liquidadoUsd + f.reservadoVivoUsd) / techo) * 100)) : 100;
                    return <StatusChip tono={pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok'}>{pct} % de {usd(techo)}</StatusChip>;
                  },
                },
              ]}
            />
          </>
        ) : null}
      </Tarjeta>

      {resto.length > 0 ? (
        <Tarjeta titulo={ta('consumo.recomendaciones_reglas_con_su')}>
          <ul className="adm-din-lista">
            {resto.map((i) => (
              <li key={i.titulo}>
                <StatusChip tono={tonoInsight(ta)[i.tipo].tono}>{tonoInsight(ta)[i.tipo].rotulo}</StatusChip>
                <strong>{i.titulo}</strong> <span>{i.detalle}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}

      <Disclosure titulo={ta('consumo.como_se_mide_y')}>
        <p className="adm-din-nota">
          
          {ta('consumo.el_gasto_del_producto')}
        </p>
      </Disclosure>
      </>}
    </EsqueletoPanelCifras>
  );
}

interface AvisoItem { tono: 'error' | 'warn'; titulo: string; texto: string }

/** Los avisos de la página, de dos en dos como máximo: el primero entero y, si hay más, un segundo aviso compacto que los pliega todos. */
function AvisosAcotados({ avisos, resto }: { avisos: AvisoItem[]; resto: TrDe<'admin_dinero'> }) {
  if (avisos.length === 0) return null;
  const [primero, ...demas] = avisos;
  return (
    <>
      <Aviso tono={primero.tono} titulo={primero.titulo}>{primero.texto}</Aviso>
      {demas.length > 0 ? (
        <AvisoCompacto
          tono={demas.some((d) => d.tono === 'error') ? 'error' : 'warn'}
          resumen={resto('consumo.avisos_mas', { n: numero(demas.length) })}
          etiquetaMas={resto('consumo.ver_avisos')}
          mas={<ul className="adm-din-lista">{demas.map((d) => <li key={d.titulo}><strong>{d.titulo}</strong> <span>{d.texto}</span></li>)}</ul>}
        />
      ) : null}
    </>
  );
}

function AvisosDeTope({ avisos, encendidos, ta }: { avisos: FilaAlertaTope[] | null; encendidos: boolean; ta: TrDe<'admin_dinero'> }) {
  const titulo = ta('consumo.avisos_de_tope_ultimos', { DIAS_AVISOS_TOPE });
  if (avisos === null) return <Tarjeta titulo={titulo} estado="error" mensaje={ta('consumo.no_se_pudieron_leer')} reintentar />;
  if (avisos.length === 0) {
    return (
      <Tarjeta
        titulo={titulo} estado="vacio" contenida mensaje={ta('consumo.ningun_aviso_registrado')}
        detalle={encendidos ? ta('consumo.ninguna_flota_cruzo_el') : ta('consumo.los_avisos_estan_apagados')}
        accionVacio={<BotonEnlace href="/admin/techo-ia" variante="secondary" tamano="sm">Ver techos</BotonEnlace>}
      />
    );
  }
  return (
    <Tarjeta titulo={titulo} acciones={<BotonEnlace href="/admin/techo-ia" variante="ghost" tamano="sm">Ver techos</BotonEnlace>}>
      <TablaBase
        etiqueta={ta('consumo.avisos_de_tope_de')} idFila={(a) => `${a.tenantId}-${a.dia}-${a.nivel}`} tarjetaMovil
        filas={avisos}
        columnas={[
          { id: 'flota', titulo: ta('consumo.flota'), principal: true, celda: (a) => a.tenantNombre },
          { id: 'nivel', titulo: ta('consumo.nivel'), celda: (a) => <StatusChip tono={a.nivel === 100 ? 'bad' : 'warn'}>{a.nivel} %</StatusChip> },
          { id: 'dia', titulo: ta('consumo.dia'), celda: (a) => dia(a.dia) },
          { id: 'uso', titulo: ta('consumo.uso_de_su_techo'), alinear: 'der', celda: (a) => `${usd(a.usoUsd)} de ${usd(a.topeUsd)}` },
        ]}
      />
    </Tarjeta>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t: ta } = await getT('admin_dinero');
  return { title: ta('consumo.consumo_de_ia') };
}
