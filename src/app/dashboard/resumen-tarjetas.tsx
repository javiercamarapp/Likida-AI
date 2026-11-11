import { Bell, Flag } from 'lucide-react';
import { fechaCorta, mxnEntero, numero, porcentaje } from '@/lib/formato';
import { BotonEnlace, Tarjeta } from '@/app/ui-v2/componentes';
import { BarList, Bullet, Columnas, KindBadge, type ItemKpi } from '@/app/ui-v2/graficas';
import { rotuloDiferencia } from './agentes/liquidacion/rotulo-diferencia';
import { PERIODO_RANGO, RUTA_LIQUIDACION, type DatosResumen } from './resumen-modelo';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

/** ¿Este rol (en este perfil) abre esa pantalla? Sin ello el enlace no se ofrece: nunca un KPI que rebota. */
type PuedeRuta = (ruta: string) => boolean;
const siempre: PuedeRuta = () => true;

// Las tarjetas de datos del Resumen v2. Componentes de servidor, puros sobre `DatosResumen`: sin lectura propia, sin cifra
// inventada (null = «—» / «No es cero»).

/** La tira de KPI: una celda por área (DISENO-ACUERDO #9). Sin acceso al dinero, las mismas áreas pero con conteos. */
export function itemsKpi(d: DatosResumen, sufijo: string, puede: PuedeRuta = siempre, t: TResto = T_RESTO_ES): ItemKpi[] {
  const enlace = (ruta: string) => (puede(ruta) ? `${ruta}${sufijo}` : undefined);
  const k = d.kpis;
  const periodo = PERIODO_RANGO[d.rango];
  const selloLiq = `Liquidaciones · ${periodo}`;
  const hrefLiq = enlace(RUTA_LIQUIDACION);
  const cp = d.cartaPorte;
  const cartaPorte: ItemKpi = {
    etiqueta: t('op.carta_porte_completas'), metrica: 'cumplimiento_carta_porte', info: 'resumen.carta_porte_completas', href: enlace('/dashboard/agentes/carta-porte'),
    valor: cp === null || cp.total === 0 ? null : cp.completas,
    sello: cp === null ? undefined : cp.total === 0 ? 'Sin viajes abiertos' : `de ${numero(cp.total)} · viajes abiertos`,
    conteo: true,
  };
  const porRevisar: ItemKpi = {
    etiqueta: t('op.por_revisar_2'), metrica: 'requiere_accion', info: 'resumen.por_firmar', href: hrefLiq,
    valor: k ? k.porRevisar : null, sello: selloLiq, conteo: true,
  };
  if (d.veDinero) {
    const p = d.peajes;
    return [
      { etiqueta: t('op.monto_comprobado'), metrica: 'dinero_comprobado', info: 'resumen.monto_comprobado', href: hrefLiq, valor: k ? mxnEntero(k.montoComprobado) : null, sello: selloLiq },
      porRevisar,
      {
        etiqueta: t('op.peajes_del_periodo'), metrica: 'gasto_peajes', info: 'resumen.peajes_periodo', href: enlace('/dashboard/agentes/peajes'),
        valor: p && p.total !== null ? mxnEntero(p.total) : null,
        sello: p && p.total !== null ? (p.semanas === 1 ? t('op.casetas_semana_en_curso') : t('op.casetas_ultimas_semanas', { semanas: p.semanas })) : undefined,
      },
      cartaPorte,
    ];
  }
  return [
    { etiqueta: t('op.liquidaciones_cerradas'), metrica: 'volumen_viajes', info: 'resumen.liquidaciones_cerradas', href: hrefLiq, valor: k ? k.viajesLiquidados : null, sello: selloLiq, conteo: true },
    porRevisar,
    // Es un CONTEO de liquidaciones ya cerradas (observado), no una proyección: el sello «Estimado» queda para lo que se estima.
    { etiqueta: t('op.con_diferencias'), metrica: 'diferencias_por_cuadrar', tipo: 'observado', info: 'resumen.con_diferencias', href: hrefLiq, valor: k ? k.conDiferencias : null, sello: selloLiq, conteo: true },
    cartaPorte,
  ];
}

export function TarjetaCierres({ d, t = T_RESTO_ES }: { d: DatosResumen; t?: TResto }) {
  const c = d.cierres;
  const total = c ? c.reduce((s, x) => s + x.valor, 0) : 0;
  return (
    <Tarjeta
      titulo={t('op.liquidaciones_cerradas_por_semana')} info="resumen.cierres_semana" className="rv-res__cierres"
      estado={c === null ? 'error' : 'ok'} reintentar
      acciones={c && total > 0 ? <span className="rv-res__nota">{numero(total)}{' '}{t('op.en_semanas_la_ultima_en_curso', { length: c.length })}</span> : undefined}
    >
      {c ? <Columnas datos={c.map((x) => ({ etiqueta: x.etiqueta, valor: x.valor, parcial: x.parcial, largo: `Semana del ${x.etiqueta}` }))} unidad="cierres" matiz={1} etiqueta={t('op.liquidaciones_cerradas_por_semana_ultimas_ocho')} formato="numero" vacio={t('op.sin_liquidaciones_cerradas_en_las_ultimas')} /> : null}
    </Tarjeta>
  );
}

function Dato({ etiqueta, children, sello }: { etiqueta: string; children: React.ReactNode; sello?: React.ReactNode }) {
  return <div className="rv-dato"><dt>{etiqueta}</dt><dd>{children}{sello}</dd></div>;
}

export function TarjetaDiferencias({ d, t = T_RESTO_ES }: { d: DatosResumen; t?: TResto }) {
  const k = d.kpis;
  return (
    <Tarjeta titulo={d.veDinero ? t('op.diferencias_vs_recuperado') : t('op.diferencias_en_liquidaciones')} info="resumen.diferencias_recuperado" estado={k === null ? 'error' : 'ok'} reintentar>
      {k ? (
        <>
          <dl className="rv-datos">
            {d.veDinero ? <Dato etiqueta={t('op.diferencia_detectada')}>{mxnEntero(k.diferenciaDetectada)}</Dato> : null}
            {d.veDinero ? <Dato etiqueta={t('op.recuperado')} sello={<KindBadge tipo="sin_dato" />}>—</Dato> : null}
            <Dato etiqueta={t('op.con_diferencias')}>{numero(k.conDiferencias)} de {numero(k.viajesLiquidados)}</Dato>
            {!d.veDinero ? <Dato etiqueta={t('op.por_revisar_2')}>{numero(k.porRevisar)}</Dato> : null}
          </dl>
          <div data-cero-fuente="">
            <Bullet valor={k.viajesLiquidados > 0 ? k.tasaCuadre : null} maximo={100} matiz={3} etiqueta={t('op.cuadre_sin_diferencias')} formato={(v) => porcentaje(v, 0)} />
          </div>
        </>
      ) : null}
    </Tarjeta>
  );
}

/** «Top»: dónde más pesan las diferencias del historial, por tipo. Solo con acceso al dinero; null = «No es cero», nunca una barra en cero. */
export function TarjetaTopTipos({ d, t = T_RESTO_ES }: { d: DatosResumen; t?: TResto }) {
  const tipos = d.porTipo ? [...d.porTipo].filter((x) => x.monto > 0).sort((a, b) => b.monto - a.monto).slice(0, 5) : null;
  const tope = tipos && tipos.length ? tipos[0].monto : 1;
  return (
    <Tarjeta titulo={t('op.donde_mas_pesa_historial')} info="resumen.diferencias_recuperado" estado={tipos === null ? 'error' : tipos.length === 0 ? 'vacio' : 'ok'} reintentar
      mensaje={tipos && tipos.length === 0 ? t('op.sin_diferencias_registradas') : undefined}>
      {tipos && tipos.length > 0 ? (
        <BarList etiqueta={t('op.donde_mas_pesan_las_diferencias')} matiz={6} maximo={tope} formato={mxnEntero}
          items={tipos.map((x) => ({ clave: x.tipo, etiqueta: rotuloDiferencia(x.tipo), valor: x.monto }))} />
      ) : null}
    </Tarjeta>
  );
}

export function TarjetaHizoSolo({ d, sufijo, puede = siempre, t = T_RESTO_ES }: { d: DatosResumen; sufijo: string; puede?: PuedeRuta; t?: TResto }) {
  const h = d.hechos;
  return (
    <Tarjeta
      titulo={t('op.lo_que_hizo_solo')} info="resumen.lo_que_hizo_solo" estado={h === null ? 'error' : h.length === 0 ? 'vacio' : 'ok'} reintentar
      mensaje={h && h.length === 0 ? t('op.el_agente_todavia_no_ha_actuado') : undefined}
      acciones={puede(RUTA_LIQUIDACION) ? <BotonEnlace tamano="sm" variante="ghost" href={`${RUTA_LIQUIDACION}${sufijo}`}>{t('op.ver_actividad')}</BotonEnlace> : undefined}
    >
      {h && h.length ? (
        <ul className="rv-solo">
          {h.map((x) => (
            <li key={`${x.tipo}-${x.folio}-${x.cuando}`}>
              <span className="rv-solo__icono" aria-hidden="true">{x.tipo === 'escalado' ? <Flag width={14} height={14} /> : <Bell width={14} height={14} />}</span>
              <span className="rv-solo__texto" title={x.tipo === 'escalado' ? t('op.viaje_folio_escalado', { folio: x.folio }) : x.operador ? t('op.recordatorio_a_operador', { operador: x.operador }) : t('op.recordatorio_de_comprobacion')}>
                {x.tipo === 'escalado' ? <>{t('op.escalo_el_viaje')}{' '}<b className="rv-id">{x.folio}</b></> : <>{t('op.recordo_comprobar_a')}{' '}{x.operador ?? 'un operador'}</>}
              </span>
              <span className="rv-solo__cuando">{fechaCorta(x.cuando)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Tarjeta>
  );
}
