import { cache } from 'react';
import Link from 'next/link';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { getAdquisicion } from '@/lib/admin/adquisicion';
import { listarCampanasConTotal, estadoIntegracionAds } from '@/lib/admin/campanas';
import { ControlCampanas } from './campanas';
import { accionPausarCampana, accionRefrescarGasto } from './acciones';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { contarProspectosPorEstado, ESTADOS_PROSPECTO, COMISION_PRIMER_MES, COMISION_RECURRENTE } from '@/lib/likida/vendedores';
import { getEmbudoActivacion, getCohortesUso } from '@/lib/admin/instrumentacion';
import { numero, fechaCorta, usd } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { getT } from '@/lib/i18n/servidor';
import { AvisoCompacto, Aviso, Disclosure, FilaTarjetas, StatusChip, Tarjeta, TablaBase } from '../../ui-v2/componentes';
import { BarList, Columnas, Embudo, TiraCifras } from '../../ui-v2/graficas';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminDineroEs } from '@/lib/i18n/tr_admin';
// ═══════════════════════════════════════════════════════════════════════════
// BLOQUES DE CRECIMIENTO (R9c): cada bloque es un componente de servidor async con su propia lectura, envuelto por `page.tsx` en su
// propio <Suspense> con un esqueleto compacto: un bloque lento ya no bloquea la página. Las lecturas son las MISMAS de antes (ninguna
// nueva); `cache()` las comparte entre bloques de una misma petición y cada una conserva su propio catch, o sea su propia leyenda honesta.
// ═══════════════════════════════════════════════════════════════════════════

const resumenNegocio = cache(() => getResumenNegocio().catch(() => null));
// El embudo de ADQUISICIÓN sí es real desde la 0105: cae por su lado a null y se DICE (un embudo vacío por base caída afirmaría que no hay pipeline).
const prospectosPorEstado = cache(() => contarProspectosPorEstado().catch(() => null));
// Costo por lead + alertas de adquisición (panel-de-adquisicion §2/§5): cae por su lado a null y se DICE.
const adquisicionAdmin = cache(() => getAdquisicion(ahoraMs()).catch(() => null));
// El control de campañas (0123, §4) — leer y pausar; jamás crear ni subir.
const campanasAdmin = cache(() => listarCampanasConTotal().catch(() => null));
// La mitad de PRODUCTO del funnel (0251): altas → activadas → de pago. null = no se pudo leer, y se dice.
const embudoActivacionAdmin = cache(() => getEmbudoActivacion().catch(() => null));
// Retención por cohortes sobre producto_evento (0251). Mes sin medición = null, jamás un 0% inventado.
const cohortesAdmin = cache(() => getCohortesUso().catch(() => null));

export async function BloqueIntro() {
  const { t: ta } = await getT('admin_dinero');
  const r = await resumenNegocio();
  if (r === null) {
    return <Aviso tono="error" titulo={ta('crecimiento_bloques.no_se_pudo_leer')}>{ta('crecimiento_bloques.esto_no_significa_que')}</Aviso>;
  }
  // AUDITORÍA 10, ALTO — el título y el párrafo afirmaban una sola flota y "solo existe el tenant demo" como texto fijo: con la base en 0 tenants seguían afirmando que había una.
  const esSoloDemo = r.tenants === 1 && r.flotas[0]?.id === tenantDemo();
  const titulo = r.tenants === 0
    ? ta('crecimiento_bloques.sin_flotas_dadas_de')
    : `Con ${r.tenants} flota${r.tenants === 1 ? '' : 's'} dada${r.tenants === 1 ? '' : 's'} de alta, todavía no hay "crecimiento" que medir`;
  const historial = r.tenants === 0
    ? ta('crecimiento_bloques.no_hay_ninguna_flota')
    : esSoloDemo ? ta('crecimiento_bloques.no_hay_historial_de') : ta('crecimiento_bloques.no_hay_historial_de_2');
  return (
    <AvisoCompacto
      tono="info"
      resumen={<><strong>{titulo}.</strong> {historial}, y Likida no tiene instrumentación de producto: ningún conteo de usuarios activos ni embudo de registro.</>}
      mas={ta('crecimiento_bloques.con_cualquier_tendencia_de', { tenants: r.tenants === 0 ? 'cero flotas' : `n=${r.tenants}` })}
    />
  );
}

export async function BloqueEmbudoAdquisicion() {
  const { t: ta } = await getT('admin_dinero');
  const prospectos = await prospectosPorEstado();
  // El embudo de ADQUISICIÓN — real desde la 0105. Los prospectos del censo por estado del kanban. Es pipeline de PROSPECTOS, no de usuarios:
  // la conversión que se muestra es cerrados/total, y con cero cerrados se dice "sin cierres todavía" — jamás un 0% con cara de medición.
  if (prospectos === null) {
    return <Tarjeta titulo={ta('crecimiento_bloques.embudo_de_adquisicion')} estado="error" mensaje={ta('crecimiento_bloques.no_se_pudo_leer_2')} reintentar />;
  }
  if (prospectos.total === 0) {
    return <Tarjeta titulo={ta('crecimiento_bloques.embudo_de_adquisicion')} estado="vacio" mensaje={ta('crecimiento_bloques.sin_prospectos_en_el')} detalle={ta('crecimiento_bloques.aparecen_cuando_el_cerebro')} contenida />;
  }
  const { porEstado } = prospectos;
  const embudo = ESTADOS_PROSPECTO.filter((e) => e.valor !== 'lost').map((e) => ({ clave: e.valor, etiqueta: e.rotulo, valor: porEstado[e.valor], texto: numero(porEstado[e.valor]) }));
  return (
    <Tarjeta titulo={ta('crecimiento_bloques.embudo_de_adquisicion_prospectos', { total: numero(prospectos.total) })}>
      <BarList etiqueta={ta('crecimiento_bloques.prospectos_por_estado')} items={embudo} formato={numero} />
      <p className="adm-din-nota">
        {porEstado.won > 0 ? ta('crecimiento_bloques.conversion_a_cierre_de', { won: porEstado.won, total: numero(prospectos.total) }) : ta('crecimiento_bloques.sin_cierres_todavia_la')}
        {porEstado.lost > 0 && ` ${numero(porEstado.lost)} perdidos.`}
        {' '}El detalle por vendedor vive en <Link href="/admin/vendedores">Vendedores</Link>; lo que espera tu aprobación, en <Link href="/admin/aprobaciones">Aprobaciones</Link>.
      </p>
    </Tarjeta>
  );
}

export async function BloqueCostoYCampanas() {
  const { t: ta } = await getT('admin_dinero');
  const [adquisicion, campanas] = await Promise.all([adquisicionAdmin(), campanasAdmin()]);
  const integracionAds = estadoIntegracionAds();
  // Costo por lead + alertas (panel-de-adquisicion §2 y §5). La regla del §2: costo real solo donde es $0 POR DISEÑO; donde falta la
  // integración de gasto se dice, jamás un $0 de encuadre. Las alertas heredan sus umbrales de los documentos que ya los fijaron.
  if (adquisicion === null) {
    return <Tarjeta titulo={ta('crecimiento_bloques.costo_por_lead_y')} estado="error" mensaje={ta('crecimiento_bloques.no_se_pudo_leer_3')} reintentar />;
  }
  return (
    <>
      {adquisicion.alertas.map((a) => <Aviso key={`${a.id}-${a.titulo}`} tono="warn" titulo={a.titulo}>{a.detalle}</Aviso>)}
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo={ta('crecimiento_bloques.costo_por_lead_por')} estado={adquisicion.porFuente.length === 0 ? 'vacio' : 'ok'} mensaje={ta('crecimiento_bloques.sin_leads_capturados')} detalle={ta('crecimiento_bloques.aparece_en_cuanto_entra')}>
          <TablaBase
            etiqueta={ta('crecimiento_bloques.costo_por_lead_por')} idFila={(f) => f.fuente} tarjetaMovil densa filas={adquisicion.porFuente}
            columnas={[
              { id: 'fuente', titulo: ta('crecimiento_bloques.fuente'), principal: true, celda: (f) => f.fuente },
              { id: 'leads', titulo: ta('crecimiento_bloques.leads'), alinear: 'der', celda: (f) => numero(f.leads) },
              { id: 'ultimo', titulo: ta('crecimiento_bloques.ultimo'), alinear: 'der', celda: (f) => (f.ultimoCapturado ? fechaCorta(f.ultimoCapturado) : '—') },
              {
                id: 'costo', titulo: ta('crecimiento_bloques.costo_por_lead'), alinear: 'der',
                celda: (f) => (
                  <>
                    {f.costo ? usd(f.costo.usd) : 'no disponible'}
                    <span className="adm-din-sub">{f.costoNota}</span>
                  </>
                ),
              },
            ]}
          />
          {adquisicion.sinFuenteDeDatos.length > 0 ? (
            <p className="adm-din-nota">Alertas del plan sin fuente de datos todavía: {adquisicion.sinFuenteDeDatos.map((s) => `${s.alerta} (${s.falta})`).join(' · ')}.</p>
          ) : null}
        </Tarjeta>

        <Tarjeta titulo={ta('crecimiento_bloques.control_de_campanas')} estado={campanas === null ? 'error' : 'ok'} mensaje={ta('crecimiento_bloques.no_se_pudieron_leer')} reintentar>
          {campanas !== null ? (
            <>
              <ControlCampanas
                campanas={campanas.campanas}
                integracion={{ metaConfigurada: integracionAds.metaConfigurada }}
                leadsAds={adquisicion.porFuente.filter((f) => f.fuente === 'ads' || f.fuente === 'ads-meta' || f.fuente === 'ads-google').reduce((n, f) => n + f.leads, 0)}
                pausar={accionPausarCampana}
                refrescar={accionRefrescarGasto}
              />
              {campanas.total > campanas.campanas.length ? (
                <Aviso tono="warn">Se muestran las {campanas.campanas.length} campañas más recientes de {campanas.total}. «Actualizar gasto desde Meta» sí cubre todas las de Meta.</Aviso>
              ) : null}
            </>
          ) : null}
        </Tarjeta>
      </FilaTarjetas>
    </>
  );
}

export async function BloqueActivacion() {
  const { t: ta } = await getT('admin_dinero');
  const [embudoActivacion, { t }] = await Promise.all([embudoActivacionAdmin(), getT('graficas')]);
  // El embudo de ACTIVACIÓN — la mitad de producto (0251), contado en la base: altas → con al menos una liquidación → con suscripción de pago
  // activa. Con null se dice «no se pudo leer»; con ceros se dicen los ceros — son conteos reales, no encuadre.
  if (embudoActivacion === null) {
    return <Tarjeta titulo={ta('crecimiento_bloques.embudo_de_activacion')} estado="error" mensaje={ta('crecimiento_bloques.no_se_pudo_leer_4')} reintentar />;
  }
  return (
    <Tarjeta titulo={ta('crecimiento_bloques.embudo_de_activacion_de')} elevar entra="tarjeta">
      {/* Con los tres conteos en cero el embudo se pinta «vacío»; aquí el cero es un dato real y se dice como tal. */}
      {embudoActivacion.altas + embudoActivacion.activadas + embudoActivacion.dePago === 0 ? (
        <p className="adm-din-nota">{t('crecimiento.activacion.ceros')}</p>
      ) : <Embudo
        etiqueta={ta('crecimiento_bloques.flotas_por_etapa_de')}
        formato="numero"
        etapas={[
          { etiqueta: ta('crecimiento_bloques.flotas_dadas_de_alta'), valor: embudoActivacion.altas },
          { etiqueta: ta('crecimiento_bloques.activadas_con_al_menos'), valor: embudoActivacion.activadas },
          { etiqueta: ta('crecimiento_bloques.de_pago_suscripcion_activa'), valor: embudoActivacion.dePago },
        ]}
      />}
      <p className="adm-din-nota">
        
        {ta('crecimiento_bloques.contado_en_la_base')}
        {embudoActivacion.dePago === 0 && ta('crecimiento_bloques.el_cero_de_de')}
      </p>
    </Tarjeta>
  );
}

export async function BloqueCohortes() {
  const { t: ta } = await getT('admin_dinero');
  const cohortes = await cohortesAdmin();
  // Retención por COHORTES — producto_evento (0251). La regla de honestidad vive en construirCohortes(): un mes anterior al primer evento
  // registrado es «no medido» (null), jamás un 0% — pintarle churn a los meses pre-medición sería inventar.
  if (cohortes === null) {
    return <Tarjeta titulo={ta('crecimiento_bloques.retencion_por_cohortes')} estado="error" mensaje={ta('crecimiento_bloques.no_se_pudieron_leer_2')} reintentar />;
  }
  return (
    <Tarjeta titulo={ta('crecimiento_bloques.retencion_por_cohortes_uso')} estado={cohortes.filas.length === 0 ? 'vacio' : 'ok'} mensaje={ta('crecimiento_bloques.sin_flotas_dadas_de_2')} detalle={ta('crecimiento_bloques.no_hay_cohorte_que')}>
      <TablaBase
        etiqueta={ta('crecimiento_bloques.cohortes_por_mes_de')} idFila={(f) => f.cohorte} tarjetaMovil densa filas={cohortes.filas}
        columnas={[
          { id: 'cohorte', titulo: ta('crecimiento_bloques.cohorte_mes_de_alta'), principal: true, celda: (f) => f.cohorte },
          { id: 'flotas', titulo: ta('crecimiento_bloques.flotas'), alinear: 'der', celda: (f) => numero(f.flotas) },
          {
            id: 'meses', titulo: ta('crecimiento_bloques.flotas_con_uso_mes'),
            celda: (f) => (
              <span className="adm-din-acciones">
                {f.celdas.map((c) => (
                  <StatusChip key={c.mes} tono={c.activas === null ? 'muted' : 'neutral'} title={c.mes}>
                    {c.mes.slice(5)}{' · '}{c.activas === null ? 'no medido' : `${numero(c.activas)}/${numero(f.flotas)}`}{c.enCurso && c.activas !== null ? ' (en curso)' : ''}
                  </StatusChip>
                ))}
              </span>
            ),
          },
        ]}
      />
      <p className="adm-din-nota">
        {cohortes.desdeMedicion === null
          ? ta('crecimiento_bloques.la_medicion_de_uso')
          : ta('crecimiento_bloques.la_medicion_empezo_en', { desdeMedicion: cohortes.desdeMedicion })}
        {' '}{ta('crecimiento_bloques.con_pocas_flotas_la')}
      </p>
    </Tarjeta>
  );
}

export async function BloqueUso() {
  const { t: ta } = await getT('admin_dinero');
  const r = await resumenNegocio();
  if (r === null) {
    return <Tarjeta titulo={ta('crecimiento_bloques.uso_de_la_plataforma')} estado="error" mensaje={ta('crecimiento_bloques.no_se_pudo_leer_5')} reintentar />;
  }
  const serieTokens = r.porDia.slice(-8).map((d) => d.tokens);
  return (
    <>
      <Tarjeta titulo={ta('crecimiento_bloques.uso_de_la_plataforma')} estado={r.porDia.length > 1 ? 'ok' : 'vacio'} mensaje={ta('crecimiento_bloques.sin_historial_suficiente')} detalle={ta('crecimiento_bloques.hacen_falta_al_menos')}>
        <p className="adm-din-nota">{ta('crecimiento_bloques.no_es_una_metrica')}</p>
        <Columnas etiqueta={ta('crecimiento_bloques.gasto_de_ia_por')} datos={r.porDia.map((d) => ({ etiqueta: d.dia.slice(5), largo: d.dia, valor: d.costoUsd }))} formato="usd" vacio="Sin gasto registrado" />
      </Tarjeta>
      <TiraCifras etiqueta={ta('crecimiento_bloques.uso_de_la_plataforma_2')} items={[
        { etiqueta: ta('crecimiento_bloques.viajes_procesados'), valor: r.viajesProcesados, formato: 'entero' },
        { etiqueta: ta('crecimiento_bloques.tokens_usados'), valor: r.tokensIn + r.tokensOut, formato: 'numero', delta: r.tendenciaTokens === null ? null : { texto: ta('crecimiento_bloques.vs_los_7_dias', { Math: Math.abs(r.tendenciaTokens) }), dir: r.tendenciaTokens > 0 ? 'sube' : r.tendenciaTokens < 0 ? 'baja' : 'igual' }, serie: serieTokens },
      ]} />
    </>
  );
}

export function BloqueSinInstrumentacion({ ta = trAdminDineroEs }: { ta?: TrDe<'admin_dinero'> } = {}) {
  // El embudo activados → de pago y la retención por cohortes SALIERON de esta lista (0251): ya se miden. Lo que queda tiene cada uno su razón.
  const sinInstrumentacion = [
    ta('crecimiento_bloques.usuarios_activos_por_dia'),
    ta('crecimiento_bloques.nps_necesita_encuestas_que'),
    ta('crecimiento_bloques.adopcion_por_funcion_se'),
  ];
  return (
    <>
      <Tarjeta titulo={ta('crecimiento_bloques.comisiones_de_vendedores')} estado="vacio" mensaje={ta('crecimiento_bloques.falta_aun_no_hay')}
        detalle={ta('crecimiento_bloques.el_esquema_solo_existe', { Math: Math.round(COMISION_PRIMER_MES * 100), Math2: Math.round(COMISION_RECURRENTE * 100) })}
        contenida />
      <Disclosure titulo={ta('crecimiento_bloques.lo_que_esta_pagina')} resumen={ta('crecimiento_bloques.cosas_cada_una_con', { length: sinInstrumentacion.length })}>
        <ul className="adm-din-lista">
          {sinInstrumentacion.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="adm-din-nota">{ta('crecimiento_bloques.cada_renglon_dice_su')}</p>
      </Disclosure>
    </>
  );
}
