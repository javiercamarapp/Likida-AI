import { mxn, numero, porcentaje } from '@/lib/formato';
import { insightsDeCobros, ETIQUETA_CATEGORIA_INSIGHT, ORDEN_CATEGORIAS_INSIGHT, type ResultadoInsights, type Kpi, type EntradaCategoriaInsight, type CategoriaInsight } from '@/lib/likida/peajes/insights_cobros';
import { CATEGORIAS_COBRO, ROTULO_CANDIDATO } from '@/lib/likida/peajes/reglas_cobro';
import { clasificarPlazos } from '@/lib/likida/peajes/plazo_reclamo';
import { ESTADOS_RECLAMO_ENVIADO, candidatosDePlazo } from '@/lib/likida/peajes/candidatos_plazo';
import { resumirAcreditacion } from '@/lib/likida/peajes/notas_credito';
import { ETIQUETA_ESTADO_RECLAMO } from '@/lib/likida/peajes/reclamos_seguimiento';
// SOLO tipos: estos módulos importan supabaseAdmin y no deben entrar al bundle de la vista.
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';
import { AvisoCompacto, EstadoVacio, StatusChip, TablaBase, Tarjeta } from '@/app/ui-v2/componentes';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';
import './peajes.css';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-27 — LA REVISIÓN DE COBROS EN LA PANTALLA DEL AGENTE DE PEAJES
//
// Arriba del detalle del archivo: «Qué pasó» (una tarjeta por categoría con dinero,
// cantidad y estado del reclamo), «Plazo», «Recuperado vs reclamado» y «% revisado».
// Todo sale de `insightsDeCobros` (T-A2-26): aquí no se calcula ni se redacta ninguna
// cifra nueva, solo se arma su entrada desde lo que la página ya leyó y se pinta.
//
// Un fallo aquí NUNCA bloquea subir, conciliar ni anular un desglose: la página lee estos
// datos con `safe()` y `estadoRevisionCobros` convierte cualquier excepción del cálculo en
// `{ tipo: 'error' }`, que se pinta como una tarjeta degradada en lenguaje llano.
// Un dato que no existe se pinta «sin dato», nunca como 0.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoRevisionCobros =
  | { tipo: 'sin_archivo' }
  | { tipo: 'error' }
  | {
      tipo: 'ok';
      insights: ResultadoInsights;
      /** Etiqueta del reclamo por categoría («Sin reclamar» si nadie la ha reclamado). */
      estadoReclamo: Record<string, string>;
      /** No hay ninguna tarifa configurada: las diferencias de importe no se evalúan. */
      sinTarifa: boolean;
      /** No hay vínculos cruce-viaje guardados para este archivo. */
      sinViajes: boolean;
    };

/** Lo que la página leyó de la base (cada pieza puede venir `null` si no se pudo leer). */
export interface DatosRevisionCobros {
  /** `null` = no hay desglose abierto, o la revisión no se pudo leer (ver `hayDesglose`). */
  reporte: ReporteRevision | null;
  /** ¿Hay un desglose abierto? Distingue «sin archivo» de «no se pudo leer». */
  hayDesglose?: boolean;
  /** Los reclamos de TODA la flota; `null` = no se pudieron leer. */
  reclamos: ReclamoVista[] | null;
  /**
   * A37-A2-06: las decisiones por línea de ESTE desglose (`peaje_candidato_accion`). Con ellas, un reclamo hecho desde la tabla
   * cubre SOLO las líneas que reclamó. `undefined` = el llamador no las pide (se conserva «un reclamo cubre su categoría»);
   * `null` = no se pudieron leer.
   */
  decisiones?: ReadonlyArray<{ indice: number; categoria: string; accion: string; reclamoId: string | null }> | null;
  /** Cuántas tarifas hay configuradas; `null` = no se pudo leer. */
  tarifas: number | null;
  /** Los vínculos cruce-viaje del desglose abierto; `null` = no se pudieron leer. */
  vinculos: ReadonlyArray<{ estado: string }> | null;
  /** Hoy en México (AAAA-MM-DD). */
  hoy: string;
}

const SIN_RECLAMAR = 'Sin reclamar';

function entradaDeCategorias(
  reporte: ReporteRevision, reclamosDelArchivo: readonly ReclamoVista[],
  decisiones: ReadonlyArray<{ indice: number; categoria: string; accion: string }> = [],
): EntradaCategoriaInsight[] {
  const { revision } = reporte;
  return CATEGORIAS_COBRO.map((categoria) => {
    const res = revision.porCategoria[categoria];
    const reclamados = reclamosDelArchivo
      .filter((r) => r.categoria === categoria && ESTADOS_RECLAMO_ENVIADO.has(r.estado))
      .reduce((s, r) => s + r.nCruces, 0);
    const justificados = revision.candidatos.filter((c) => c.categoria === categoria && c.justificacion).length;
    // A2P-09: lo que finanzas descartó o justificó por decisión (sin regla de caseta) también está atendido.
    const porDecision = new Set(decisiones.filter((x) => x.categoria === categoria && (x.accion === 'descartado' || x.accion === 'justificado')).map((x) => x.indice));
    const decididos = revision.candidatos.filter((c) => c.categoria === categoria && !c.justificacion && porDecision.has(c.indice)).length;
    // Se atiende lo reclamado, lo justificado y lo descartado; el módulo de insights acota a `n`.
    return { categoria, n: res.n, monto: res.monto, atendidos: reclamados + justificados + decididos };
  });
}

/**
 * De los datos de la base a lo que se pinta. Nunca lanza: un cálculo que truena es `error`.
 *
 * Rulings (T-A2-27): «cruces evaluados» = líneas con clase (lo que el sistema pudo validar de
 * punta a punta); «por vencer» solo cuenta candidatos NO cubiertos por un reclamo ENVIADO de este archivo
 * (ver `lineasCubiertasPorReclamo`: preparado y rechazado no cubren nada); «atípicos nuevos» = cruces atípicos que el
 * detector marca en este archivo en esta lectura.
 */
export function estadoRevisionCobros(d: DatosRevisionCobros): EstadoRevisionCobros {
  if (!d.reporte) return d.hayDesglose === false ? { tipo: 'sin_archivo' } : { tipo: 'error' };
  // Sin reclamos legibles, «reclamado $0» parecería medición: se degrada completo.
  if (!d.reclamos) return { tipo: 'error' };
  try {
    const reporte = d.reporte;
    const delArchivo = d.reclamos.filter((r) => r.desgloseId === reporte.desgloseId);
    if (d.decisiones === null) return { tipo: 'error' };
    const categorias = entradaDeCategorias(reporte, delArchivo, d.decisiones ?? []);
    // A37-A2-06 / A37-S15-03: la definición de «sin reclamar» vive en `candidatos_plazo.ts` (la misma del aviso del cron).
    const candidatosPlazo = candidatosDePlazo({
      desgloseId: reporte.desgloseId, candidatos: reporte.revision.candidatos, reclamosDelArchivo: delArchivo,
      ...(d.decisiones === undefined ? {} : { decisiones: d.decisiones ?? [] }),
    });
    const hayCandidatos = reporte.revision.candidatos.length > 0;
    const porVencer = hayCandidatos && candidatosPlazo.length === 0
      ? null
      : (() => {
          const g = clasificarPlazos(candidatosPlazo, d.hoy).porVencer;
          return { cruces: g.reduce((s, x) => s + x.cruces, 0), monto: Math.round(g.reduce((s, x) => s + x.monto, 0) * 100) / 100 };
        })();

    const total = reporte.revision.lineasRevisadas;
    // A37-A2-04: SOLO los reclamos de ESTE archivo (antes sumaba los de toda la flota bajo un tablero del archivo).
    const acreditacion = resumirAcreditacion(
      delArchivo.map((r) => ({ id: r.id, estado: r.estado, fechaCobroMasAntiguo: r.fechaCobroMasAntiguo, montoReclamado: r.montoReclamado, montoAcreditado: r.montoAcreditado })),
      d.hoy,
    );
    const sinViajes = !d.vinculos || d.vinculos.length === 0;

    const insights = insightsDeCobros({
      cruces: { total, evaluados: Math.max(0, total - reporte.revision.sinClase) },
      categorias,
      acreditacion: { reclamado: acreditacion.reclamado, acreditado: acreditacion.acreditado, diferencia: acreditacion.diferencia, pendiente: acreditacion.pendiente },
      porVencer,
      atipicosNuevos: reporte.atipicos.atipicos.length,
      sinViaje: sinViajes ? null : (d.vinculos ?? []).filter((v) => v.estado === 'sin_viaje').length,
    });

    const estadoReclamo: Record<string, string> = {};
    for (const cat of ORDEN_CATEGORIAS_INSIGHT) {
      const etiquetas = [...new Set(delArchivo.filter((r) => r.categoria === cat).map((r) => ETIQUETA_ESTADO_RECLAMO[r.estado]))];
      estadoReclamo[cat] = etiquetas.length > 0 ? etiquetas.join('; ') : SIN_RECLAMAR;
    }
    return { tipo: 'ok', insights, estadoReclamo, sinTarifa: d.tarifas === 0, sinViajes };
  } catch {
    return { tipo: 'error' };
  }
}

// ── Pintado ─────────────────────────────────────────────────────────────────

function valorKpi(k: Kpi, extra?: { monto?: number | null }): string {
  switch (k.formato) {
    case 'porcentaje': return porcentaje(k.valor as number);
    case 'pesos': return mxn(k.valor as number);
    case 'cruces':
      return extra?.monto != null ? `${numero(k.valor as number)} (${mxn(extra.monto)})` : numero(k.valor as number);
    default: return numero(k.valor as number);
  }
}

const INFO_KPI: Record<string, InfoClave> = {
  por_vencer: 'peajes_cobros.por_vencer',
  reclamado: 'peajes_cobros.reclamado',
  acreditado: 'peajes_cobros.acreditado',
  pendiente: 'peajes_cobros.pendiente',
  pct_revisado: 'peajes_cobros.pct_revisado',
  cruces_evaluados: 'peajes_cobros.cruces_evaluados',
  atipicos_nuevos: 'peajes_cobros.atipicos_nuevos',
  sin_viaje: 'peajes_cobros.sin_viaje',
};

/** Una cifra de la revisión: el valor sale de `insightsDeCobros`; un dato que no existe es «sin dato», jamás 0. */
function CifraKpi({ k, monto, tono }: { k: Kpi; monto?: number | null; tono?: 'warn' }) {
  const info = INFO_KPI[k.id];
  const sinDato = k.valor === null;
  return (
    <Cifra
      etiqueta={k.titulo} info={info} sello={`Fuente: ${k.fuente}`}
      valor={sinDato ? null : valorKpi(k, { monto })}
      {...(sinDato ? { estado: 'vacio' as const, mensaje: `Sin dato. ${k.detalle}` } : { nota: k.detalle })}
      tono={sinDato ? undefined : tono}
    />
  );
}

/** Un bloque de la revisión (Qué pasó, Plazo…). Es el rótulo de una franja dentro de la tarjeta, no un recuadro nuevo. */
function Franja({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <div className="rv-pj-franja" role="group" aria-labelledby={id}>
      {/* sin-info: rótulo de una franja dentro de la tarjeta «Revisión de cobros», que es quien lleva el recuadro */}
      <h3 id={id} className="rv-pj-franja__titulo">{titulo}</h3>
      {children}
    </div>
  );
}

export function RevisionCobros({ estado, tr = TR_ES }: { estado: EstadoRevisionCobros; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <div role="region" aria-label={tx('rest.revision_de_cobros')}>
      <Tarjeta titulo={tx('rest.revision_de_cobros')}>
        <p className="rv-pj-nota">{ROTULO_CANDIDATO}{tx('rest.lo_que_el_sistema_marca_son')}</p>

        {estado.tipo === 'sin_archivo' && (
          <EstadoVacio titulo={tx('rest.aun_nada_que_revisar')}>{tx('rest.aun_no_hay_nada_que_revisar')}</EstadoVacio>
        )}

        {estado.tipo === 'error' && (
          <AvisoCompacto tono="warn" resumen={tx('rest.no_se_pudo_calcular_la_revision')} />
        )}

        {estado.tipo === 'ok' && <CuerpoRevision tr={tr} estado={estado} />}
      </Tarjeta>
    </div>
  );
}

function CuerpoRevision({ estado, tr = TR_ES }: { estado: Extract<EstadoRevisionCobros, { tipo: 'ok' }>; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { insights: r, estadoReclamo } = estado;
  const k = r.kpis;
  return (
    <>
      {(estado.sinTarifa || estado.sinViajes) && (
        <ul className="rv-pj-notas">
          {estado.sinTarifa && <li>{tx('rest.sin_tarifa_configurada_las_diferencias_de')}</li>}
          {estado.sinViajes && <li>{tx('rest.el_cruce_con_viajes_no_esta')}</li>}
        </ul>
      )}

      <Franja id="cobros-que-paso" titulo={tx('conductores.vista.que_paso')}>
        <div className="rv-pj-tarjetas">
          {r.tarjetas.map((t) => (
            <article key={t.id} className="rv-pj-caja" aria-labelledby={`cobro-${t.id}`}>
              <h4 id={`cobro-${t.id}`} className="rv-pj-caja__titulo">{t.titulo}</h4>
              <div className="cifra-mono rv-pj-caja__monto">{mxn(t.monto)}</div>
              <div className="rv-pj-nota">{numero(t.n)} {t.n === 1 ? 'cruce' : 'cruces'}</div>
              {t.id !== 'sin_candidatos' && (
                <div className="rv-pj-nota">{tx('rest.reclamo')}{' '}{estadoReclamo[t.id] ?? SIN_RECLAMAR}</div>
              )}
              <p className="rv-pj-texto">{t.quePaso}</p>
              <p className="rv-pj-nota">{ricoT(tx('rest.strong_que_significa_strong'), { strong: (c) => <strong>{c}</strong> })}{' '}{t.queSignifica}</p>
              <p className="rv-pj-nota">{ricoT(tx('rest.strong_que_hacer_strong'), { strong: (c) => <strong>{c}</strong> })}{' '}{t.queHacer}</p>
              <p className="rv-pj-nota">{tx('rest.fuente')}{' '}{t.fuente}</p>
            </article>
          ))}
        </div>
        {r.tarjetas.some((t) => t.id !== 'sin_candidatos') && <TablaCategorias tr={tr} r={r} estadoReclamo={estadoReclamo} />}
      </Franja>

      <Franja id="cobros-plazo" titulo={tx('rest.plazo')}>
        <TiraCifras etiqueta={tx('rest.plazo_para_reclamar')}>
          <CifraKpi k={k.porVencer} monto={k.porVencer.monto} tono={(k.porVencer.valor ?? 0) > 0 ? 'warn' : undefined} />
        </TiraCifras>
      </Franja>

      <Franja id="cobros-recuperado" titulo={tx('rest.recuperado_vs_reclamado')}>
        <TiraCifras etiqueta={tx('rest.recuperado_contra_reclamado')}>
          <CifraKpi k={k.reclamado} />
          <CifraKpi k={k.acreditado} />
          <CifraKpi k={k.pendiente} tono={(k.pendiente.valor ?? 0) > 0 ? 'warn' : undefined} />
        </TiraCifras>
      </Franja>

      <Franja id="cobros-revisado" titulo={tx('rest.revisado')}>
        <TiraCifras etiqueta={tx('rest.que_tanto_se_ha_revisado')}>
          <CifraKpi k={k.pctRevisado} />
          <CifraKpi k={k.crucesEvaluados} />
          <CifraKpi k={k.atipicosNuevos} />
          <CifraKpi k={k.sinViaje} />
        </TiraCifras>
        <p className="rv-pj-nota">{tx('rest.lo_revisado_por_una_persona_y', { motivo: r.ahorroDeTiempo.motivo })}</p>
      </Franja>
    </>
  );
}

function TablaCategorias({ r, estadoReclamo, tr = TR_ES }: { r: ResultadoInsights; estadoReclamo: Record<string, string>; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const filas = r.tarjetas.filter((t) => t.id !== 'sin_candidatos');
  return (
    <TablaBase<(typeof filas)[number]>
      etiqueta={tx('rest.candidatos_de_cobro_por_categoria_con')}
      filas={filas}
      idFila={(t) => t.id}
      densa
      altoMaximo={false}
      tarjetaMovil
      columnas={[
        { id: 'categoria', titulo: tx('rest.categoria_2'), principal: true, celda: (t) => ETIQUETA_CATEGORIA_INSIGHT[t.id as CategoriaInsight] ?? t.titulo },
        { id: 'cruces', titulo: tx('rest.cruces_3'), alinear: 'der', celda: (t) => <span className="cifra-mono">{numero(t.n)}</span> },
        { id: 'monto', titulo: tx('rest.monto'), alinear: 'der', celda: (t) => <span className="cifra-mono">{mxn(t.monto)}</span> },
        { id: 'estado', titulo: tx('rest.estado_del_reclamo'), celda: (t) => <StatusChip tono={(estadoReclamo[t.id] ?? SIN_RECLAMAR) === SIN_RECLAMAR ? 'muted' : 'info'}>{estadoReclamo[t.id] ?? SIN_RECLAMAR}</StatusChip> },
      ]}
    />
  );
}
