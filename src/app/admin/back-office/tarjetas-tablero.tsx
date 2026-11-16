import type { ReactNode } from 'react';
import { BotonEnlace, StatusChip, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import { BarList, Bullet, type ItemBarList } from '@/app/ui-v2/graficas';
import { mxn, numero, porcentaje, type IdiomaFormato } from '@/lib/formato';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import {
  AREAS, AUTOMATIZACION_CORTE, AUTOMATIZACION_POR_AREA, ENLACES_AREA, ENLACES_FACTURACION,
  type AreaId, type EstadoArea, type ResumenFacturacion, type Tablero,
} from '@/lib/backoffice/tablero';
import { OBJETIVO_DIAS_CIERRE } from '@/lib/backoffice/reporte';
import { etiquetaMes } from '@/lib/backoffice/periodo';
import type { Lectura } from '@/lib/backoffice/lectura';

type Tr = TrDe<'admin_backoffice'>;
type Clave = Parameters<Tr>[0];

const TITULO_AREA: Record<AreaId, Clave> = {
  facturacion: 'portada.area_facturacion',
  contabilidad: 'portada.area_contabilidad',
  gastos: 'portada.area_gastos',
  comisiones: 'portada.area_comisiones',
  nomina: 'portada.area_nomina',
  legal: 'portada.area_legal',
  compliance: 'portada.area_compliance',
  reporting: 'portada.area_reporting',
};

const ROTULO_ESTADO: Record<EstadoArea, Clave> = {
  operativa: 'portada.estado_operativa',
  bloqueada_entidad: 'portada.estado_bloqueada',
  no_disponible: 'portada.estado_no_disponible',
  error: 'portada.estado_error',
  compra: 'portada.estado_compra',
};

const TONO_ESTADO: Record<EstadoArea, TonoEstado> = {
  operativa: 'ok', bloqueada_entidad: 'warn', no_disponible: 'muted', error: 'bad', compra: 'info',
};

const ENLACES_FACTURACION_CLAVE: Record<(typeof ENLACES_FACTURACION)[number], Clave> = {
  '/admin/cobranza': 'portada.enl_cobranza',
  '/admin/costos-facturacion': 'portada.enl_planes',
  '/admin/facturas': 'portada.enl_facturas',
};

const ROTULO_CIERRE: Record<'abierto' | 'listo' | 'cerrado', Clave> = {
  abierto: 'cierre.estado_abierto', listo: 'cierre.estado_listo', cerrado: 'cierre.estado_cerrado',
};

type Par = readonly [Clave, string | null];

/** Un valor leído o `null` («No disponible»): una lectura caída nunca se pinta como cero. */
const soloSiOk = <T,>(l: Lectura<T>, f: (d: T) => string | null): string | null => (l.estado === 'ok' ? f(l.dato) : null);

/** Los dos datos que enseña cada tarjeta de área. `null` = «No disponible. No es cero.». */
function paresDeArea(id: AreaId, tab: Tablero, t: Tr, idioma: IdiomaFormato): Par[] {
  switch (id) {
    case 'facturacion':
      return [
        ['portada.p_cobrado_mes', soloSiOk(tab.facturacion, (f) => mxn(f.cobradoMesCent / 100, idioma))],
        ['portada.p_por_cobrar', soloSiOk(tab.facturacion, (f) => (f.porCobrarCent === null ? null : mxn(f.porCobrarCent / 100, idioma)))],
      ];
    case 'contabilidad':
      return [
        ['portada.p_obligaciones', soloSiOk(tab.obligaciones, (o) => numero(o.catalogadas, idioma))],
        ['portada.p_deducible', tab.candado === 'sin_rfc' ? t('portada.v_no_evaluable') : tab.candado === 'con_rfc' ? t('portada.v_en_gastos') : null],
      ];
    case 'gastos':
      return [
        ['portada.p_gasto_mes', soloSiOk(tab.gastos, (g) => mxn(g.totalCent / 100, idioma))],
        ['portada.p_conciliados', soloSiOk(tab.gastos, (g) => t('portada.n_de_m', { n: numero(g.conciliados, idioma), m: numero(g.n, idioma) }))],
      ];
    case 'comisiones':
      return [
        ['portada.p_devengado', soloSiOk(tab.comisiones, (c) => mxn(c.devengadoCent / 100, idioma))],
        ['portada.p_clawback', soloSiOk(tab.comisiones, (c) => mxn(Math.abs(c.clawbackCent) / 100, idioma))],
      ];
    case 'nomina':
      return [['portada.p_decision', t('portada.v_se_compra')], ['portada.p_aqui', t('portada.v_solo_registro')]];
    case 'legal':
      return [
        ['portada.p_vencen_30', soloSiOk(tab.contratos, (c) => numero(c.vencenEn30, idioma))],
        ['portada.p_vencidos_sin_fecha', soloSiOk(tab.contratos, (c) => `${numero(c.vencidos, idioma)} / ${numero(c.sinFecha, idioma)}`)],
      ];
    case 'compliance':
      return [['portada.p_donde', t('portada.v_seguridad_datos')], ['portada.p_incluye', t('portada.v_arco_retencion_bitacora')]];
    case 'reporting':
      return [
        ['portada.p_por_cerrar', soloSiOk(tab.cierres, (c) => `${etiquetaMes(c.mesPorCerrar.periodo, idioma)} · ${c.mesPorCerrar.estado === null ? t('portada.v_sin_borrador') : t(ROTULO_CIERRE[c.mesPorCerrar.estado])}`)],
        ['portada.p_ultimo_cierre', soloSiOk(tab.cierres, (c) => (c.ultimoCerrado === null
          ? t('portada.v_ninguno_cerrado')
          : c.ultimoCerrado.dias === null
            ? etiquetaMes(c.ultimoCerrado.periodo, idioma)
            : t('portada.v_ultimo_cierre', { mes: etiquetaMes(c.ultimoCerrado.periodo, idioma), dias: numero(c.ultimoCerrado.dias, idioma) })))],
      ];
  }
}

/** Una tarjeta por área: estado honesto, dos datos y el enlace. Todas miden lo mismo (dos filas y un pie): sin vacíos. */
export function TarjetaArea({ id, tab, t, idioma }: { id: AreaId; tab: Tablero; t: Tr; idioma: IdiomaFormato }) {
  const estado = tab.estados[id];
  const enlaces: Array<{ href: string; texto: string }> = id === 'facturacion'
    ? ENLACES_FACTURACION.map((href) => ({ href, texto: t(ENLACES_FACTURACION_CLAVE[href]) }))
    : [{ href: ENLACES_AREA[id], texto: t('portada.enl_abrir') }];
  return (
    <Tarjeta titulo={t(TITULO_AREA[id])} acciones={<StatusChip tono={TONO_ESTADO[estado]}>{t(ROTULO_ESTADO[estado])}</StatusChip>} elevar entra="tarjeta">
      <dl className="bo-par">
        {paresDeArea(id, tab, t, idioma).map(([clave, valor]) => (
          <div key={clave}>
            <dt>{t(clave)}</dt>
            <dd data-nd={valor === null || undefined}>{valor ?? t('bo.no_disponible')}</dd>
          </div>
        ))}
      </dl>
      <div className="bo-enlaces">
        {enlaces.map((e) => <BotonEnlace key={e.href} tamano="sm" variante="ghost" href={e.href}>{e.texto}</BotonEnlace>)}
      </div>
    </Tarjeta>
  );
}

/** Las ocho áreas, en el orden del manual. */
export function RejillaAreas({ tab, t, idioma }: { tab: Tablero; t: Tr; idioma: IdiomaFormato }) {
  return (
    <section className="bo-areas" aria-label={t('portada.areas')}>
      {AREAS.map((id) => <TarjetaArea key={id} id={id} tab={tab} t={t} idioma={idioma} />)}
    </section>
  );
}

function FilaMetrica({ rotulo, valor, nota, children }: { rotulo: string; valor: string; nota?: string; children?: ReactNode }) {
  return (
    <li className="bo-metrica">
      <span className="bo-metrica__rotulo">{rotulo}</span>
      <span className="bo-metrica__valor">{valor}</span>
      {children ? <span className="bo-metrica__viz">{children}</span> : null}
      {nota ? <small className="bo-metrica__nota">{nota}</small> : null}
    </li>
  );
}

/** Las métricas del paquete (metricas-del-back-office.md): cada una con su valor absoluto, nunca un porcentaje solo, y «no medido» donde no se mide. */
export function TarjetaMetricas({ tab, t, idioma }: { tab: Tablero; t: Tr; idioma: IdiomaFormato }) {
  const nd = t('bo.no_disponible');
  const fmt = (v: number) => numero(v, idioma);

  // 1 · Días de cierre
  const cierre = tab.cierres.estado === 'ok' ? tab.cierres.dato.ultimoCerrado : undefined;
  const dias = cierre?.dias ?? null;

  // 2 · Gastos conciliados: «n de m», jamás el porcentaje solo
  const g = tab.gastos.estado === 'ok' ? tab.gastos.dato : null;

  // 3 · DSO con la factura más vieja
  const fac: ResumenFacturacion | null = tab.facturacion.estado === 'ok' ? tab.facturacion.dato : null;

  return (
    <Tarjeta titulo={t('portada.metricas')} elevar entra="tarjeta">
      <ul className="bo-metricas">
        <FilaMetrica
          rotulo={t('portada.m_dias_cierre')}
          valor={tab.cierres.estado !== 'ok' ? nd : cierre === null || cierre === undefined ? t('portada.m_sin_cierre') : dias === null ? nd : t('portada.m_dias_habiles', { n: fmt(dias) })}
          nota={tab.cierres.estado !== 'ok' || cierre === null || cierre === undefined ? t('portada.m_dias_nota_sin') : t('portada.m_dias_nota', { objetivo: fmt(OBJETIVO_DIAS_CIERRE) })}
        >
          {dias !== null ? <Bullet valor={dias} meta={OBJETIVO_DIAS_CIERRE} maximo={Math.max(dias, OBJETIVO_DIAS_CIERRE, 5)} etiqueta={t('portada.m_dias_cierre')} formato={fmt} compacto /> : null}
        </FilaMetrica>
        <FilaMetrica
          rotulo={t('portada.m_conciliados')}
          valor={g === null ? nd : g.n === 0 ? t('portada.m_sin_gastos') : t('portada.n_de_m', { n: fmt(g.conciliados), m: fmt(g.n) })}
          nota={t('portada.m_conciliados_nota')}
        >
          {g !== null && g.n > 0 ? <Bullet valor={g.conciliados} maximo={g.n} etiqueta={t('portada.m_conciliados')} formato={fmt} compacto /> : null}
        </FilaMetrica>
        <FilaMetrica
          rotulo={t('portada.m_dso')}
          valor={fac === null ? nd : fac.dsoDias === null ? t('portada.m_dso_sin_cobros') : t('portada.m_dso_valor', { dias: fmt(fac.dsoDias), mas: fac.masViejaDias === null ? '—' : fmt(fac.masViejaDias) })}
          nota={fac !== null && fac.dsoDias !== null ? t('portada.m_dso_nota', { n: fmt(fac.nParaDso) }) : t('portada.m_dso_nota_sin')}
        />
        <FilaMetrica rotulo={t('portada.m_toques')} valor={t('portada.m_no_medido')} nota={t('portada.m_toques_nota')} />
      </ul>
    </Tarjeta>
  );
}

/** El % de automatización por área, con su método declarado: es un ESTIMADO fechado, no una medición continua. */
export function TarjetaAutomatizacion({ t, idioma }: { t: Tr; idioma: IdiomaFormato }) {
  const items: ItemBarList[] = AUTOMATIZACION_POR_AREA.map((a) => ({
    clave: a.id,
    etiqueta: t(TITULO_AREA[a.id]),
    valor: a.pct,
    texto: a.pct === null ? undefined : porcentaje(a.pct, 0, idioma),
    tipo: 'estimado',
    nota: a.pct === null ? t('portada.na_compra') : undefined,
  }));
  return (
    <Tarjeta titulo={t('portada.automatizacion')} elevar entra="tarjeta">
      <BarList items={items} etiqueta={t('portada.automatizacion')} maximo={100} matiz={5} formato={(v) => porcentaje(v, 0, idioma)} />
      <p className="adm-din-nota">{t('portada.automatizacion_metodo', { corte: AUTOMATIZACION_CORTE })}</p>
    </Tarjeta>
  );
}
