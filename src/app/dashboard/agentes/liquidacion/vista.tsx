import Link from 'next/link';
import { ArrowRight, Bot, BellRing, Flag, Link2, Settings } from 'lucide-react';
import './liquidacion.css';
import type { LiqRow, DashboardKpis, HechoSolo, DineroObservadoTipo } from '@/lib/likida/analytics';
import { etiquetaConcepto, type PoliticaGasto } from '@/lib/likida/cuadre/engine';
import { mxn, mxnCompacto, numero, fechaCorta } from '@/lib/formato';
import { Bloque } from '../../bloque';
import { SeccionCola, type ColaProps } from './cola';

// El rótulo de cada tipo de diferencia vive en `rotulo-diferencia.ts`, tipado
// contra `TipoDiferencia` completo (M10) — aquí había 3 renglones para ~35 tipos.
import { rotuloDiferencia as rotuloTipo } from './rotulo-diferencia';
import { BarList, Columnas, Cifra, DonaMini, TiraCifras } from '@/app/ui-v2/graficas';
import { EsqCifrasV2, EsqTablaV2, EsqTarjetaV2, EstadoVacio, FilaTarjetas, Icono, MarcoPagina, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { TR_ES, rico, type TrAgentes, selloHoyTr } from '../i18n-agentes';
import { getT } from '@/lib/i18n/servidor';

/** Los conteos del ciclo. `porRevisar` sale de los KPIs; los otros tres, de
 *  `contarViajes`. Van juntos porque los pinta UNA sola tarjeta. */
export interface CicloLiquidacion {
  abiertos: number | null;
  enCuadre: number | null;
  porRevisar: number;
  liquidados: number | null;
}

/** Las cuatro fuentes de "Lo que hizo solo", en un solo paquete: la tarjeta
 *  aterriza completa y no a pedazos. */
export interface HizoSolo {
  hechos: HechoSolo[] | null;
  huerfanos: { resueltos: number; totales: number } | null;
  docsProcesados: number | null;
  /** Lecturas de IA del agente (sin chat). null = no se pudo leer. */
  actividadIa: number | null;
}

/**
 * FE-14: `extra` ya no es un paquete de VALORES sino de PROMESAS. La página
 * las lanza todas juntas y cada tarjeta espera SOLO la suya — pasar el valor
 * ya esperado volvería a serializar aquí lo que allá se paralelizó.
 */
export interface ExtraAgenteLiquidacion {
  /** ¿El rol puede abrir /dashboard/configuracion? (El contador no —
   *  esconder el link vale más que un clic que rebota.) No es una lectura:
   *  se resuelve con la sesión y viaja como valor. */
  puedeVerReglas: boolean;
  ciclo: Promise<CicloLiquidacion>;
  /** Cierres por día (últimas 12 semanas). null = no se pudo leer. */
  cierresPorDia: Promise<Array<{ fecha: string; valor: number }> | null>;
  hizoSolo: Promise<HizoSolo>;
  porTipo: Promise<DineroObservadoTipo[] | null>;
  /** Diferencias por operador, ya en forma de barras (top, solo >0). */
  operadores: Promise<Array<{ etiqueta: string; valor: number }> | null>;
  politica: Promise<PoliticaGasto[] | null>;
}

/**
 * El render del Agente de Liquidación de Ruta (v2, 13-ago-2026: "gráficas,
 * algo visual… estilo minimalista elegante premium como el dashboard
 * inicial"). Tres zonas: la firma del humano (cola), la evidencia de que el
 * agente trabaja (ciclo, calendario, lo-que-hizo-solo), y el criterio con el
 * que juzga (dinero observado, operadores, sus reglas).
 *
 * Cada sección degrada por su cuenta: un dato que no se pudo leer enseña su
 * leyenda honesta sin tumbar la página — y un cero MEDIDO sí se grafica. Y
 * desde FE-14 cada una además LLEGA por su cuenta: la barra de página sale
 * con el primer flush y las nueve tarjetas aterrizan conforme contestan sus
 * consultas, cada una con un esqueleto de su alto.
 */
export function VistaAgenteLiquidacion({
  kpis, liquidaciones, cola, extra, sufijo, notificaciones, externas, tr = TR_ES,
}: {
  /** Primario: falla CERRADO. Su bloque enseña `EstadoError` — nunca un
   *  "0 por revisar" que nadie midió. */
  kpis: Promise<DashboardKpis>;
  /** Las 50 liquidaciones más recientes — SOLO para «últimos cierres».
   *  La cola YA NO sale de aquí (FE-5): un recorte de 2.4 h escondía justo a
   *  las que más llevaban esperando firma. */
  liquidaciones: Promise<LiqRow[]>;
  /** La cola de revisión de verdad: su propia consulta, por antigüedad, por
   *  llave y con `count` real. Ver `cola.tsx`. */
  cola: ColaProps;
  extra: ExtraAgenteLiquidacion;
  sufijo: string;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
  /** «Liquidaciones externas» (0370): las que calculó el SAP/TMS de la flota y
   *  Likida solo entrega. Entra ya renderizada (con su `Bloque`) por la misma
   *  razón que `notificaciones`: la vista no importa el repositorio de datos. */
  externas?: React.ReactNode; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <MarcoPagina titulo={tx('liquidacion.vista.liquidacion_automatica')} apoyo={tx('liquidacion.vista.el_agente_arma_la_liquidacion')}>

      <Bloque mensaje={tx('liquidacion.vista.no_se_pudieron_leer_los')} esqueleto={<EsqCifrasV2 n={4} />}>
        <BloqueKpis kpis={kpis} />
      </Bloque>

      <Bloque mensaje={tx('liquidacion.vista.no_se_pudo_leer_la')} esqueleto={<EsqTablaV2 filas={5} />}>
        <SeccionCola {...cola} />
      </Bloque>

      {externas}

      {/* ── La evidencia de que trabaja ── */}
      <FilaTarjetas variante="4-4-4">
        <Bloque mensaje={tx('liquidacion.vista.no_se_pudo_contar_el')} esqueleto={<EsqTarjetaV2 alto={160} />}>
          <BloqueCiclo ciclo={extra.ciclo} />
        </Bloque>
        <Bloque mensaje={tx('liquidacion.vista.no_se_pudo_leer_la_2')} esqueleto={<EsqTarjetaV2 alto={160} />}>
          <BloqueCierres cierresPorDia={extra.cierresPorDia} />
        </Bloque>
        <Bloque mensaje={tx('liquidacion.vista.no_se_pudo_leer_el')} esqueleto={<EsqTarjetaV2 alto={160} />}>
          <BloqueHizoSolo hizoSolo={extra.hizoSolo} />
        </Bloque>
      </FilaTarjetas>

      {/* ── El criterio con el que juzga ── */}
      <FilaTarjetas variante="4-4-4">
        <Bloque mensaje={tx('liquidacion.vista.no_se_pudo_leer_el_2')} esqueleto={<EsqTarjetaV2 alto={240} />}>
          <BloqueDineroObservado porTipo={extra.porTipo} />
        </Bloque>
        <Bloque mensaje={tx('liquidacion.vista.no_se_pudo_leer_el_3')} esqueleto={<EsqTarjetaV2 alto={240} />}>
          <BloqueOperadores operadores={extra.operadores} />
        </Bloque>
        <Bloque mensaje={tx('liquidacion.vista.no_se_pudo_leer_la_3')} esqueleto={<EsqTarjetaV2 alto={240} />}>
          <BloqueReglas politica={extra.politica} puedeVerReglas={extra.puedeVerReglas} sufijo={sufijo} />
        </Bloque>
      </FilaTarjetas>

      <Bloque mensaje={tx('liquidacion.vista.no_se_pudieron_leer_los_2')} esqueleto={<EsqTablaV2 filas={5} />}>
        <BloqueUltimosCierres liquidaciones={liquidaciones} sufijo={sufijo} />
      </Bloque>

      {notificaciones}
    </MarcoPagina>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS BLOQUES. Cada uno espera SOLO su promesa.
// ═══════════════════════════════════════════════════════════════════════════

async function BloqueKpis({ kpis: pKpis }: { kpis: Promise<DashboardKpis> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const kpis = await pKpis;
  return (
    <TiraCifras sello={selloHoyTr(tr, tx('liquidacion.vista.liquidaciones_de_la_flota'))}>
      {/* FE-17: es el acumulado HISTÓRICO — a escala 50k son miles de millones y
          `$9,000,000,000.00` no cabe en un cuarto de fila. `mxnCompacto`
          abrevia SOLO a partir del millón; debajo es `mxn()` exacto. */}
      <Cifra info="liquidacion.monto_comprobado" etiqueta={tx('liquidacion.vista.monto_comprobado')} valor={mxnCompacto(kpis.montoComprobado, tr.idioma)} nota={tx('liquidacion.vista.historico_2')} />
      <Cifra info="liquidacion.tasa_cuadre" etiqueta={tx('liquidacion.vista.tasa_de_cuadre')} valor={`${numero(kpis.tasaCuadre)}%`} nota={tx('liquidacion.vista.liquidaciones', { viajesLiquidados: numero(kpis.viajesLiquidados) })} />
      {/* BLOQ-6: desde la 0299 hay DOS estados y este KPI es el del MOTOR
          («no pude cuadrarla»), no el de la firma. La cola de abajo cuenta lo
          que espera FIRMA —que incluye las de diferencias— y sale de su
          propia consulta: dos números distintos con su rótulo distinto, en vez
          de dos versiones del mismo. */}
      <Cifra info="liquidacion.por_revisar" etiqueta={tx('liquidacion.vista.por_revisar')} valor={numero(kpis.porRevisar)} nota={tx('liquidacion.vista.el_agente_no_pudo_cuadrarlas')}
        tono={kpis.porRevisar > 0 ? 'warn' : undefined} />
      <Cifra info="liquidacion.con_diferencias" etiqueta={tx('liquidacion.vista.con_diferencias')} valor={numero(kpis.conDiferencias)} tono={kpis.conDiferencias > 0 ? 'bad' : undefined} />
    </TiraCifras>
  );
}

async function BloqueCiclo({ ciclo }: { ciclo: Promise<CicloLiquidacion> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const funnel = await ciclo;
  // Barras SOLO de lo VIVO (auditoría 13-ago): "Liquidados" es acumulado
  // histórico y en meses domina la escala — las etapas vivas se volverían
  // astillas invisibles. Lo vivo se grafica; el histórico es una línea.
  const cicloVivoLegible = funnel.abiertos !== null && funnel.enCuadre !== null;
  const pasosVivos = cicloVivoLegible
    ? [
        { clave: 'abiertos', etiqueta: tx('liquidacion.vista.abiertos'), valor: funnel.abiertos as number },
        { clave: 'en_cuadre', etiqueta: tx('liquidacion.vista.en_cuadre'), valor: funnel.enCuadre as number },
        { clave: 'por_revisar', etiqueta: tx('liquidacion.vista.por_revisar'), valor: funnel.porRevisar },
      ]
    : [];
  const hayCicloVivo = cicloVivoLegible && pasosVivos.some((p) => p.valor > 0);
  if (!cicloVivoLegible) {
    return <Tarjeta titulo={tx('liquidacion.vista.viajes_en_curso')} info="liquidacion.viajes_en_curso" estado="error" mensaje={tx('liquidacion.vista.no_se_pudo_contar_el_2')} />;
  }
  if (!hayCicloVivo) {
    return (
      <Tarjeta titulo={tx('liquidacion.vista.viajes_en_curso')} info="liquidacion.viajes_en_curso" estado="vacio" mensaje={tx('liquidacion.vista.nada_vivo_en_el_ciclo')} detalle={tx('liquidacion.vista.el_proximo_viaje_que_despaches')}>
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo={tx('liquidacion.vista.viajes_en_curso')} info="liquidacion.viajes_en_curso">
      <p className="rv-liq-sub">{tx('liquidacion.vista.la_foto_de_ahora_mismo')}</p>
      {/* BarList y no embudo A PROPÓSITO: el embudo imprime conversión paso a paso y este ciclo no es un embudo decreciente. */}
      <BarList etiqueta={tx('liquidacion.vista.viajes_en_curso_por_etapa')} items={pasosVivos} />
      {funnel.liquidados !== null && (
        <p className="rv-liq-pie">
          {rico(tx('liquidacion.vista.viajes_liquidados_en_total_historico'), { strong: <strong className="cifra-mono">{numero(funnel.liquidados)}</strong> })}
        </p>
      )}
    </Tarjeta>
  );
}

async function BloqueCierres({ cierresPorDia }: {
  cierresPorDia: Promise<Array<{ fecha: string; valor: number }> | null>;
}) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const dias = await cierresPorDia;
  const total = dias?.reduce((s, d) => s + d.valor, 0) ?? 0;
  if (dias === null) {
    return <Tarjeta titulo={tx('liquidacion.vista.cierres_por_dia')} info="liquidacion.cierres_por_dia" estado="error" mensaje={tx('liquidacion.vista.no_se_pudo_leer_la_4')} />;
  }
  if (total <= 0) {
    return (
      <Tarjeta titulo={tx('liquidacion.vista.cierres_por_dia')} info="liquidacion.cierres_por_dia" estado="vacio" mensaje={tx('liquidacion.vista.sin_cierres_en_12_semanas')} detalle={tx('liquidacion.vista.cada_dia_con_cierres_pinta')}>
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo={tx('liquidacion.vista.cierres_por_dia')} info="liquidacion.cierres_por_dia">
      <p className="rv-liq-sub">{tx('liquidacion.vista.ultimas_12_semanas')}</p>
      <Columnas
        etiqueta={tx('liquidacion.vista.liquidaciones_cerradas_por_dia_ultim')}
        datos={dias.map((d) => ({ etiqueta: fechaCorta(d.fecha, tr.idioma), valor: d.valor, largo: fechaCorta(d.fecha, tr.idioma) }))}
        formato="numero"
        alto={140}
        variacion={false}
        unidad="liquidaciones"
      />
      <p className="rv-liq-pie">{tx('liquidacion.vista.liquidaciones_cerradas_en_la_ventana', { total: numero(total) })}</p>
    </Tarjeta>
  );
}

async function BloqueHizoSolo({ hizoSolo }: { hizoSolo: Promise<HizoSolo> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const { hechos, huerfanos, docsProcesados, actividadIa } = await hizoSolo;
  if (hechos === null) {
    return <Tarjeta titulo={tx('liquidacion.vista.lo_que_hizo_solo')} info="liquidacion.hizo_solo" estado="error" mensaje={tx('liquidacion.vista.no_se_pudo_leer_el_4')} />;
  }
  if (hechos.length === 0 && !(huerfanos && huerfanos.resueltos > 0)) {
    return (
      <Tarjeta titulo={tx('liquidacion.vista.lo_que_hizo_solo')} info="liquidacion.hizo_solo" estado="vacio" mensaje={tx('liquidacion.vista.aun_nada_que_presumir')}
        detalle={tx('liquidacion.vista.cuando_el_agente_mande_un')}>
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo={tx('liquidacion.vista.lo_que_hizo_solo')} info="liquidacion.hizo_solo">
      <ul className="rv-liq-hechos">
        {hechos.map((h, i) => (
          <li key={i} className="rv-liq-hecho">
            <span className="rv-liq-hecho__icono" data-tono={h.tipo === 'recordatorio' ? 'neutro' : 'warn'}>
              <Icono icono={h.tipo === 'recordatorio' ? BellRing : Flag} />
            </span>
            <div className="rv-liq-hecho__texto">
              {h.tipo === 'recordatorio'
                ? <span>{rico(tx('liquidacion.vista.le_recordo_a_comprobar_el'), { strong: <strong>{h.operador ?? tx('liquidacion.vista.el_operador')}</strong>, folio: h.folio })}</span>
                : <span>{rico(tx('liquidacion.vista.escalo_el_viaje_para_atencion'), { strong: <strong>{h.folio}</strong> })}</span>}
              <span className="rv-liq-hecho__fecha">{fechaCorta(h.cuando, tr.idioma)}</span>
            </div>
          </li>
        ))}
        {huerfanos && huerfanos.resueltos > 0 && (
          <li className="rv-liq-hecho rv-liq-hecho--aparte">
            <span className="rv-liq-hecho__icono" data-tono="ok"><Icono icono={Link2} /></span>
            <span className="rv-liq-hecho__texto">{rico(tx('liquidacion.vista.amarro_solo_comprobantes_que_llegaro'), { strong: <strong>{numero(huerfanos.resueltos)}</strong> })}</span>
          </li>
        )}
      </ul>
      {(docsProcesados !== null || actividadIa !== null) && (
        <p className="rv-liq-pie">
          {rico(tx('liquidacion.vista.historico'), { v0: docsProcesados !== null && (
            <>{rico(tx('liquidacion.vista.comprobantes_leidos'), { strong: <strong className="cifra-mono">{numero(docsProcesados)}</strong> })}</>
          ), v1: docsProcesados !== null && actividadIa !== null && ' · ', v2: actividadIa !== null && (
            <>{rico(tx('liquidacion.vista.lecturas_de_ia'), { strong: <strong className="cifra-mono">{numero(actividadIa)}</strong> })}</>
          ), v3: ' ' })}
        </p>
      )}
    </Tarjeta>
  );
}

export async function BloqueDineroObservado({ porTipo: p }: { porTipo: Promise<DineroObservadoTipo[] | null> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const porTipo = await p;
  const totalObservado = porTipo?.reduce((s, t) => s + t.monto, 0) ?? 0;
  if (porTipo === null) {
    return <Tarjeta titulo={tx('liquidacion.vista.dinero_observado')} info="liquidacion.dinero_observado" estado="error" mensaje={tx('liquidacion.vista.no_se_pudo_leer_el_5')} />;
  }
  if (porTipo.length === 0) {
    return (
      <Tarjeta titulo={tx('liquidacion.vista.dinero_observado')} info="liquidacion.dinero_observado" estado="vacio" mensaje={tx('liquidacion.vista.sin_diferencias_detectadas')}
        detalle={tx('liquidacion.vista.cuando_el_agente_atrape_un')}>
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo={tx('liquidacion.vista.dinero_observado')} info="liquidacion.dinero_observado">
      <p className="rv-liq-sub">{tx('liquidacion.vista.todas_las_diferencias_que_el')}</p>
      <DonaMini
        etiqueta={tx('liquidacion.vista.dinero_observado_por_tipo_de')}
        centro={mxn(totalObservado, tr.idioma)}
        formato="mxn"
        gajos={porTipo.map((t) => ({ etiqueta: rotuloTipo(t.tipo, tx), valor: t.monto }))}
      />
      <ul className="rv-liq-filas">
        {porTipo.map((t) => (
          <li key={t.tipo} className="rv-liq-filas__fila">
            <span className="rv-liq-filas__rotulo">{rotuloTipo(t.tipo, tx)} · {numero(t.n)}</span>
            <span className="cifra-mono">{mxn(t.monto, tr.idioma)}</span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

async function BloqueOperadores({ operadores: p }: {
  operadores: Promise<Array<{ etiqueta: string; valor: number }> | null>;
}) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const operadores = await p;
  if (operadores === null) {
    return <Tarjeta titulo={tx('liquidacion.vista.diferencias_por_operador')} info="liquidacion.por_operador" estado="error" mensaje={tx('liquidacion.vista.no_se_pudo_leer_el_5')} />;
  }
  if (operadores.length === 0) {
    return (
      <Tarjeta titulo={tx('liquidacion.vista.diferencias_por_operador')} info="liquidacion.por_operador" estado="vacio" mensaje={tx('liquidacion.vista.ningun_operador_acumula_diferencias')} detalle={tx('liquidacion.vista.la_senal_que_quieres_ver')}>
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo={tx('liquidacion.vista.diferencias_por_operador')} info="liquidacion.por_operador">
      <p className="rv-liq-sub">{tx('liquidacion.vista.liquidaciones_con_diferencia_por_ope')}</p>
      <BarList etiqueta={tx('liquidacion.vista.liquidaciones_con_diferencia_por_ope_2')} items={operadores.map((o, i) => ({ clave: `${i}-${o.etiqueta}`, etiqueta: o.etiqueta, valor: o.valor }))} />
    </Tarjeta>
  );
}

async function BloqueReglas({ politica: p, puedeVerReglas, sufijo }: {
  politica: Promise<PoliticaGasto[] | null>; puedeVerReglas: boolean; sufijo: string;
}) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const politica = await p;
  /* "Ver", no "Editar": Configuración hoy es solo lectura — un botón que promete editar y no edita es un botón que miente.
     Cuando esa página edite, esto vuelve a ser "Editar". */
  const ver = puedeVerReglas ? (
    <Link href={`/dashboard/configuracion${sufijo}`} title={tx('liquidacion.vista.ver_la_configuracion_completa')} className="rv-liq-enlace">
      {rico(tx('liquidacion.vista.ver'), { el: <Icono icono={Settings} tam={14} /> })}
    </Link>
  ) : null;
  if (politica === null) {
    return <Tarjeta titulo={tx('liquidacion.vista.sus_reglas')} info="liquidacion.reglas" acciones={ver} estado="error" mensaje={tx('liquidacion.vista.no_se_pudo_leer_la_5')} />;
  }
  return (
    <Tarjeta titulo={tx('liquidacion.vista.sus_reglas')} info="liquidacion.reglas" acciones={ver}>
      <ul className="rv-liq-filas">
        {politica.map((pg) => (
          <li key={pg.concepto} className="rv-liq-filas__fila">
            <span className="rv-liq-filas__rotulo">{etiquetaConcepto(pg.concepto)}</span>
            <span className="cifra-mono">
              {pg.topeMonto !== undefined ? mxn(pg.topeMonto, tr.idioma) : pg.requiereCfdi ? tx('liquidacion.vista.requiere_cfdi') : tx('liquidacion.vista.sin_tope')}
            </span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

async function BloqueUltimosCierres({ liquidaciones, sufijo }: {
  liquidaciones: Promise<LiqRow[]>; sufijo: string;
}) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const liqs = await liquidaciones;
  const cierres = liqs.filter((l) => l.estatus !== 'revisar').slice(0, 5);
  return (
    <Tarjeta titulo={tx('liquidacion.vista.ultimos_cierres')} info="liquidacion.ultimos_cierres">
      {cierres.length === 0 ? (
        <EstadoVacio icono={Bot} titulo={tx('liquidacion.vista.aun_sin_cierres')}>
          {tx('liquidacion.vista.el_agente_todavia_no_cierra')}
        </EstadoVacio>
      ) : (
        <TablaLiqs tr={tr} filas={cierres} sufijo={sufijo} conVer />
      )}
    </Tarjeta>
  );
}

const ESTATUS: Record<string, { rotulo: string; tono: TonoEstado }> = {
  cuadrada: { rotulo: 'Cuadrada', tono: 'ok' },
  con_diferencias: { rotulo: 'Con diferencias', tono: 'warn' },
  revisar: { rotulo: 'Por revisar', tono: 'bad' },
};

function TablaLiqs({ filas, sufijo, conVer, tr = TR_ES }: { filas: LiqRow[]; sufijo: string; conVer?: boolean; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  return (
    <TablaBase<LiqRow>
      etiqueta={tx('liquidacion.vista.viajes_de_la_liquidacion')}
      filas={filas}
      idFila={(l) => l.id}
      tarjetaMovil
      columnas={[
        { id: 'viaje', titulo: tx('liquidacion.vista.viaje'), principal: true, celda: (l) => <strong>{l.folio}</strong> },
        { id: 'fecha', titulo: tx('liquidacion.vista.fecha'), celda: (l) => <span className="rv-liq-apagado">{fechaCorta(l.creadoEn, tr.idioma)}</span> },
        { id: 'comprobado', titulo: tx('liquidacion.vista.comprobado'), alinear: 'der', celda: (l) => <span className="cifra-mono">{mxn(l.comprobado, tr.idioma)}</span> },
        { id: 'diferencia', titulo: tx('liquidacion.vista.diferencia'), alinear: 'der', celda: (l) => <span className={l.diferencia !== 0 ? 'cifra-mono rv-liq-malo' : 'cifra-mono'}>{mxn(l.diferencia, tr.idioma)}</span> },
        {
          id: 'estatus', titulo: tx('liquidacion.vista.estatus'), celda: (l) => {
            const e = ESTATUS[l.estatus] ?? { rotulo: l.estatus, tono: 'muted' as const };
            return <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>;
          },
        },
        ...(conVer ? [{
          id: 'ver', titulo: tx('liquidacion.vista.ver_el_viaje'), alinear: 'der' as const, celda: (l: LiqRow) => (
            <Link href={`/dashboard/${l.id}${sufijo}`} className="rv-liq-enlace">{rico(tx('liquidacion.vista.ver_2'), { el: <Icono icono={ArrowRight} tam={14} /> })}</Link>
          ),
        }] : []),
      ]}
    />
  );
}
