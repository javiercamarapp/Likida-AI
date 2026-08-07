import { TrendingUp, ScanText, Clock, Bot, Search, Link2, ReceiptText } from 'lucide-react';
import {
  getValorAhorro, getKpis, detectarAnomalias, MINUTOS_CAPTURA_MANUAL,
  type ValorAhorro, type DashboardKpis, type Anomalia,
} from '@/lib/likida/analytics';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { KpiTile, EstadoVacio, ChartCard } from '../../admin/ui/kit';
import { HBars, MultiLine } from '../../admin/ui/graficas';

export const dynamic = 'force-dynamic';

const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Valor & Ahorro (ROI) — PASO 6 del documento, la página que existe para que
 * el dueño SIENTA lo que Likida le da.
 *
 * Es también la más fácil de convertir en mentira, así que aquí la regla de
 * honestidad del producto se aplica más fuerte, no menos: cada cifra dice si
 * es un CONTEO real o una ESTIMACIÓN, y las estimaciones enseñan su supuesto
 * (los 4 min/comprobante) en la misma tarjeta, no en una nota al pie.
 *
 * Lo que el PASO 6 pide y NO se puede sostener con datos reales hoy —multas
 * de Carta Porte evitadas, DSO reducido, "por cada $1 ahorras $X"— se dice
 * al final que falta y por qué. Inventar esas cuatro cifras haría la página
 * más impresionante y al producto indefendible en la primera pregunta.
 */
export default async function ValorAhorroPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/valor-ahorro', sp);

  const [valor, kpis, anomalias] = await Promise.all([
    safe<ValorAhorro>(() => getValorAhorro(tenantId)),
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
  ]);

  const dineroAnomalias = anomalias?.reduce((s, a) => s + a.monto, 0) ?? 0;
  const dineroObservado = (kpis?.diferenciaDetectada ?? 0) + dineroAnomalias;
  const totalAcciones = valor?.accionesPorAgente.reduce((s, a) => s + a.n, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <TrendingUp width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Valor & Ahorro</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Lo que Likida hizo por ti — conteos reales, y lo estimado marcado como estimado
          </span>
        </div>
      </header>

      {valor === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudieron cargar los datos de esta página.
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          {/* ── Hero: el trabajo que el agente hizo ── */}
          <section className="p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Lo que Likida hizo
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <KpiTile icono={<ScanText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Comprobantes leídos por el Agente OCR" valor={valor.documentosProcesados} formato="entero" destacar
                nota="Conteo real — comprobantes que entraron por WhatsApp y no se teclearon a mano" />
              <KpiTile icono={<Clock width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Horas de captura ahorradas (estimado)" valor={valor.horasAhorradasEstimadas} formato="numero"
                nota={`ESTIMACIÓN: ${valor.documentosProcesados} comprobantes × ${MINUTOS_CAPTURA_MANUAL} min de captura manual ÷ 60. Los ${MINUTOS_CAPTURA_MANUAL} min son un supuesto, no una medición.`} />
              <KpiTile icono={<Bot width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Acciones resueltas por los agentes" valor={totalAcciones} formato="entero"
                nota="Conteo real — cada llamada de IA registrada (OCR, cuadre, WhatsApp)" />
            </div>
          </section>

          {/* ── Dinero observado ── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Dinero que el motor puso sobre la mesa
            </h2>
            {kpis === null ? (
              <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <KpiTile icono={<Search width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Observado por el cuadre" valor={kpis.diferenciaDetectada} formato="mxn"
                    nota="Gastos sobre política + duplicados que el motor marcó" />
                  <KpiTile icono={<Link2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="En comprobantes repetidos entre viajes" valor={dineroAnomalias} formato="mxn"
                    nota={anomalias === null ? 'No se pudo revisar' : `${anomalias.length} coincidencias detectadas — no es un veredicto`} />
                  <KpiTile icono={<ReceiptText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Total puesto a revisión" valor={dineroObservado} formato="mxn"
                    nota="Suma de los dos anteriores — dinero señalado para que lo revises, no dinero cobrado" />
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                  Esto es dinero <strong>señalado</strong>, no recuperado: el motor lo marca y tú decides. Presentarlo
                  como &quot;ahorro&quot; sería contar como ganado algo que todavía no se cobra.
                </p>
              </>
            )}
          </section>

          {/* ── Automatización por agente ── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            {valor.accionesPorAgente.length > 0 ? (
              <ChartCard titulo="Acciones por agente" subtitulo="Conteo real de llamadas de IA registradas" tamano="M">
                <HBars datos={valor.accionesPorAgente.map((a) => ({ etiqueta: FASE_LABEL[a.fase] ?? a.fase, valor: a.n }))} formato="entero" />
              </ChartCard>
            ) : (
              <ChartCard titulo="Acciones por agente" tamano="S">
                <EstadoVacio>Todavía no hay actividad de IA registrada para esta flota.</EstadoVacio>
              </ChartCard>
            )}
          </section>

          {/* ── Trabajo acumulado ── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            {/* TRES meses, no dos: una línea entre dos puntos siempre se ve
                como una tendencia recta, y con dos meses no hay tendencia
                medida — solo dos números unidos por una recta que el ojo lee
                como proyección. Mismo criterio que `Tendencia` (charts.tsx),
                que se calla con menos de 14 días de historia. */}
            {valor.acumuladoPorMes.length >= 3 ? (
              <ChartCard titulo="Comprobantes procesados — acumulado" subtitulo="La curva del trabajo que ya no se hace a mano" tamano="L">
                <MultiLine
                  series={[{ nombre: 'Acumulado', valores: valor.acumuladoPorMes.map((m) => m.acumulado) }]}
                  categorias={valor.acumuladoPorMes.map((m) => m.mes)}
                />
              </ChartCard>
            ) : (
              <ChartCard titulo="Comprobantes procesados — acumulado" tamano="S">
                <EstadoVacio>
                  Sin historia suficiente todavía — hace falta más de un mes de actividad para que una curva
                  acumulada diga algo.
                </EstadoVacio>
              </ChartCard>
            )}
          </section>

          {/* ── Comprobantes rescatados ── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Comprobantes rescatados
            </h2>
            {valor.huerfanosTotales === 0 ? (
              <div className="mt-3">
                <EstadoVacio>
                  Todavía no ha llegado ningún comprobante suelto (sin viaje al que amarrarse).
                </EstadoVacio>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <KpiTile icono={<Link2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Llegaron sin viaje" valor={valor.huerfanosTotales} formato="entero" />
                  <KpiTile icono={<Link2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Amarrados a su viaje" valor={valor.huerfanosResueltos} formato="entero"
                    nota="Comprobantes que se habrían perdido y acabaron en su liquidación" />
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                  Un comprobante que llega suelto por WhatsApp —sin viaje al que pertenecer— es un deducible que
                  normalmente se pierde. Estos se recuperaron.
                </p>
              </>
            )}
          </section>

          {/* ── Lo que todavía no se puede calcular ── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Lo que todavía no se puede calcular
            </h2>
            <div className="mt-3">
              <EstadoVacio>
                <strong>&quot;Por cada $1 que pagas, ahorras $X&quot;</strong> — Likida todavía no te cobra, así que ese
                cociente no tiene denominador real: cualquier número ahí sería inventado.
                <br /><br />
                <strong>Multas de Carta Porte evitadas</strong> — hace falta el validador pre-timbrado, que no existe todavía.
                <br /><br />
                <strong>Días de cobro (DSO) reducidos</strong> y <strong>flujo de caja liberado</strong> — no hay facturación
                ni cobranza en el sistema, así que no hay contra qué medirlo.
                <br /><br />
                <strong>Antes vs. con Likida</strong> — nunca se midió el &quot;antes&quot; de esta flota. Comparar contra un
                promedio de industria inventado sería exactamente el tipo de cifra que este panel evita.
              </EstadoVacio>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
