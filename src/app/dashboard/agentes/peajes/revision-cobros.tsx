import { mxn, numero, porcentaje } from '@/lib/formato';
import { insightsDeCobros, ETIQUETA_CATEGORIA_INSIGHT, ORDEN_CATEGORIAS_INSIGHT, type ResultadoInsights, type Kpi, type EntradaCategoriaInsight, type CategoriaInsight } from '@/lib/likida/peajes/insights_cobros';
import { CATEGORIAS_COBRO, ROTULO_CANDIDATO } from '@/lib/likida/peajes/reglas_cobro';
import { clasificarPlazos } from '@/lib/likida/peajes/plazo_reclamo';
import { resumirAcreditacion } from '@/lib/likida/peajes/notas_credito';
import { ETIQUETA_ESTADO_RECLAMO } from '@/lib/likida/peajes/reclamos_seguimiento';
// SOLO tipos: estos módulos importan supabaseAdmin y no deben entrar al bundle de la vista.
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';

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
  /** Cuántas tarifas hay configuradas; `null` = no se pudo leer. */
  tarifas: number | null;
  /** Los vínculos cruce-viaje del desglose abierto; `null` = no se pudieron leer. */
  vinculos: ReadonlyArray<{ estado: string }> | null;
  /** Hoy en México (AAAA-MM-DD). */
  hoy: string;
}

const SIN_RECLAMAR = 'Sin reclamar';

function entradaDeCategorias(reporte: ReporteRevision, reclamosDelArchivo: readonly ReclamoVista[]): EntradaCategoriaInsight[] {
  const { revision } = reporte;
  return CATEGORIAS_COBRO.map((categoria) => {
    const res = revision.porCategoria[categoria];
    const reclamados = reclamosDelArchivo.filter((r) => r.categoria === categoria).reduce((s, r) => s + r.nCruces, 0);
    const justificados = revision.candidatos.filter((c) => c.categoria === categoria && c.justificacion).length;
    // Se atiende lo reclamado y lo justificado; el módulo de insights acota a `n`.
    return { categoria, n: res.n, monto: res.monto, atendidos: reclamados + justificados };
  });
}

/**
 * De los datos de la base a lo que se pinta. Nunca lanza: un cálculo que truena es `error`.
 *
 * Rulings (T-A2-27): «cruces evaluados» = líneas con clase (lo que el sistema pudo validar de
 * punta a punta); «por vencer» solo cuenta candidatos de categorías SIN reclamo en este archivo
 * (un reclamo cubre todos los candidatos de su categoría); «atípicos nuevos» = cruces atípicos que el
 * detector marca en este archivo en esta lectura.
 */
export function estadoRevisionCobros(d: DatosRevisionCobros): EstadoRevisionCobros {
  if (!d.reporte) return d.hayDesglose === false ? { tipo: 'sin_archivo' } : { tipo: 'error' };
  // Sin reclamos legibles, «reclamado $0» parecería medición: se degrada completo.
  if (!d.reclamos) return { tipo: 'error' };
  try {
    const reporte = d.reporte;
    const delArchivo = d.reclamos.filter((r) => r.desgloseId === reporte.desgloseId);
    const categorias = entradaDeCategorias(reporte, delArchivo);

    const reclamadas = new Set(delArchivo.map((r) => r.categoria));
    const candidatosPlazo = reporte.revision.candidatos
      .filter((c): c is typeof c & { fecha: string } => typeof c.fecha === 'string' && c.fecha !== '')
      .map((c) => ({ lineaId: String(c.indice), desgloseId: reporte.desgloseId, fechaCruce: c.fecha, monto: c.monto, reclamado: reclamadas.has(c.categoria) }));
    const hayCandidatos = reporte.revision.candidatos.length > 0;
    const porVencer = hayCandidatos && candidatosPlazo.length === 0
      ? null
      : (() => {
          const g = clasificarPlazos(candidatosPlazo, d.hoy).porVencer;
          return { cruces: g.reduce((s, x) => s + x.cruces, 0), monto: Math.round(g.reduce((s, x) => s + x.monto, 0) * 100) / 100 };
        })();

    const total = reporte.revision.lineasRevisadas;
    const acreditacion = resumirAcreditacion(
      d.reclamos.map((r) => ({ id: r.id, estado: r.estado, fechaCobroMasAntiguo: r.fechaCobroMasAntiguo, montoReclamado: r.montoReclamado, montoAcreditado: r.montoAcreditado })),
      d.hoy,
    );
    const sinViajes = !d.vinculos || d.vinculos.length === 0;

    const insights = insightsDeCobros({
      cruces: { total, evaluados: Math.max(0, total - reporte.revision.sinClase) },
      categorias,
      acreditacion: { reclamado: acreditacion.reclamado, acreditado: acreditacion.acreditado, diferencia: acreditacion.diferencia },
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
  if (k.valor === null) return 'sin dato';
  switch (k.formato) {
    case 'porcentaje': return porcentaje(k.valor);
    case 'pesos': return mxn(k.valor);
    case 'cruces':
      return extra?.monto != null ? `${numero(k.valor)} (${mxn(extra.monto)})` : numero(k.valor);
    default: return numero(k.valor);
  }
}

function KpiTarjeta({ k, monto, tono }: { k: Kpi; monto?: number | null; tono?: 'warn' }) {
  const sinDato = k.valor === null;
  return (
    <div className="card p-3.5">
      <div className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>{k.titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1"
        style={sinDato ? { color: 'var(--faint)' } : tono ? { color: `var(--${tono})` } : undefined}>
        {valorKpi(k, { monto })}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{k.detalle}</div>
      <div className="text-[10px] mt-1" style={{ color: 'var(--faint)' }}>Fuente: {k.fuente}</div>
    </div>
  );
}

function Franja({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2" aria-labelledby={id}>
      <h3 id={id} className="font-display text-[13px] font-semibold">{titulo}</h3>
      {children}
    </div>
  );
}

function Leyenda({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{children}</p>;
}

export function RevisionCobros({ estado }: { estado: EstadoRevisionCobros }) {
  return (
    <section className="card p-4 space-y-4" aria-label="Revisión de cobros">
      <div>
        <h2 className="font-display text-[15px] font-semibold">Revisión de cobros</h2>
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{ROTULO_CANDIDATO}. Lo que el sistema marca son candidatos a reclamo, no acusaciones.</p>
      </div>

      {estado.tipo === 'sin_archivo' && (
        <Leyenda>Aún no hay nada que revisar: sube el archivo del proveedor y aquí aparecen los cobros dudosos.</Leyenda>
      )}

      {estado.tipo === 'error' && (
        <p role="status" className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
          No se pudo calcular la revisión de cobros ahora mismo. Puedes seguir subiendo, conciliando y anulando archivos; vuelve a abrir esta pantalla en un momento.
        </p>
      )}

      {estado.tipo === 'ok' && <CuerpoRevision estado={estado} />}
    </section>
  );
}

function CuerpoRevision({ estado }: { estado: Extract<EstadoRevisionCobros, { tipo: 'ok' }> }) {
  const { insights: r, estadoReclamo } = estado;
  const k = r.kpis;
  return (
    <>
      {(estado.sinTarifa || estado.sinViajes) && (
        <ul className="text-[12px] list-disc pl-4 space-y-0.5" style={{ color: 'var(--muted)' }}>
          {estado.sinTarifa && <li>Sin tarifa configurada: las diferencias de importe quedan como candidatos y no se evalúan hasta que cargues el tarifario.</li>}
          {estado.sinViajes && <li>El cruce con viajes no está disponible para este archivo: los cruces no se pueden ligar a un viaje todavía (cruce con viajes no disponible).</li>}
        </ul>
      )}

      <Franja id="cobros-que-paso" titulo="Qué pasó">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {r.tarjetas.map((t) => (
            <article key={t.id} className="card p-3.5" aria-labelledby={`cobro-${t.id}`}>
              <h4 id={`cobro-${t.id}`} className="text-[12.5px] font-semibold">{t.titulo}</h4>
              <div className="cifra-mono text-[18px] font-medium mt-1">{mxn(t.monto)}</div>
              <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{numero(t.n)} {t.n === 1 ? 'cruce' : 'cruces'}</div>
              {t.id !== 'sin_candidatos' && (
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>Reclamo: {estadoReclamo[t.id] ?? SIN_RECLAMAR}</div>
              )}
              <p className="text-[12px] mt-2">{t.quePaso}</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}><strong>Qué significa:</strong> {t.queSignifica}</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}><strong>Qué hacer:</strong> {t.queHacer}</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--faint)' }}>Fuente: {t.fuente}</p>
            </article>
          ))}
        </div>
        {r.tarjetas.some((t) => t.id !== 'sin_candidatos') && <TablaCategorias r={r} estadoReclamo={estadoReclamo} />}
      </Franja>

      <Franja id="cobros-plazo" titulo="Plazo">
        <div className="grid sm:grid-cols-2 gap-3">
          <KpiTarjeta k={k.porVencer} monto={k.porVencer.monto} tono={(k.porVencer.valor ?? 0) > 0 ? 'warn' : undefined} />
        </div>
      </Franja>

      <Franja id="cobros-recuperado" titulo="Recuperado vs reclamado">
        <div className="grid sm:grid-cols-3 gap-3">
          <KpiTarjeta k={k.reclamado} />
          <KpiTarjeta k={k.acreditado} />
          <KpiTarjeta k={k.pendiente} tono={(k.pendiente.valor ?? 0) > 0 ? 'warn' : undefined} />
        </div>
      </Franja>

      <Franja id="cobros-revisado" titulo="% revisado">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTarjeta k={k.pctRevisado} />
          <KpiTarjeta k={k.crucesEvaluados} />
          <KpiTarjeta k={k.atipicosNuevos} />
          <KpiTarjeta k={k.sinViaje} />
        </div>
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
          Lo revisado por una persona y lo evaluado por el sistema son medidas distintas y no se suman. {r.ahorroDeTiempo.motivo}
        </p>
      </Franja>
    </>
  );
}

function TablaCategorias({ r, estadoReclamo }: { r: ResultadoInsights; estadoReclamo: Record<string, string> }) {
  const filas = r.tarjetas.filter((t) => t.id !== 'sin_candidatos');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <caption className="sr-only">Candidatos de cobro por categoría, con su dinero y el estado del reclamo</caption>
        <thead>
          <tr style={{ color: 'var(--muted)' }}>
            <th scope="col" className="text-left font-medium py-1 pr-3">Categoría</th>
            <th scope="col" className="text-right font-medium py-1 px-3">Cruces</th>
            <th scope="col" className="text-right font-medium py-1 px-3">Monto</th>
            <th scope="col" className="text-left font-medium py-1 pl-3">Estado del reclamo</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((t) => (
            <tr key={t.id}>
              <th scope="row" className="text-left font-normal py-1 pr-3">{ETIQUETA_CATEGORIA_INSIGHT[t.id as CategoriaInsight] ?? t.titulo}</th>
              <td className="text-right cifra-mono py-1 px-3">{numero(t.n)}</td>
              <td className="text-right cifra-mono py-1 px-3">{mxn(t.monto)}</td>
              <td className="py-1 pl-3">{estadoReclamo[t.id] ?? SIN_RECLAMAR}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
