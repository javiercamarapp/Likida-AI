import Link from 'next/link';
import { LineChart, Download, FileText, Table2 } from 'lucide-react';
import { getKpis, getGastoPorConcepto, getLiquidacionesPorDia, type DashboardKpis, type GastoPorConcepto } from '@/lib/cuadra/analytics';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeExportar } from '@/lib/auth/permisos';
import { GlobalFilter } from '../../admin/ui/global-filter';
import { EstadoVacio, ChartCard } from '../../admin/ui/kit';
import { HBars } from '../../admin/ui/graficas';
import { BarChartSimple } from '../../admin/charts';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Analítica & Reportes (PASO 7) — lo que de verdad se puede graficar y
 * exportar hoy.
 *
 * El PASO 7 pide un explorador donde el dueño elija CUALQUIER métrica
 * (costo/km, km en vacío, OTIF, km/l) y la cruce por ruta/unidad/operador/mes.
 * La mayoría de esas métricas no tienen columna en el esquema: sin kilómetros,
 * sin unidades y sin ingreso, un "explorador" ofrecería un menú de campos que
 * al elegirlos salen vacíos. Se enseña lo que sí hay, y se dice qué falta.
 */
export default async function AnaliticaPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rango?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/analitica', sp);

  // Mismo default de 30 días que Inicio — y el mismo que declara el
  // `pordefecto` del filtro de abajo: si los dos no coinciden, el pill activo
  // salta solo al hacer clic.
  const rango = sp?.rango === '7' ? '7' : sp?.rango === 'todo' ? 'todo' : '30';
  const ventanaDias = rango === '7' ? 7 : 30;
  const ventana = rango === 'todo' ? undefined : ventanaDias;

  const [kpis, porConcepto, porDia] = await Promise.all([
    safe<DashboardKpis>(() => getKpis(tenantId, ventana)),
    safe<GastoPorConcepto[]>(() => getGastoPorConcepto(tenantId)),
    safe<Array<{ dia: string; valor: number }>>(() => getLiquidacionesPorDia(tenantId, ventanaDias)),
  ]);

  const extra: Record<string, string> | undefined =
    sp?.tenant ? { tenant: sp.tenant } : sp?.vista ? { vista: sp.vista } : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <LineChart width={16} height={16} strokeWidth={1.75} />
          <div>
            <span className="text-sm font-medium block">Analítica & Reportes</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Lo que se puede medir con los datos que hay</span>
          </div>
        </div>
        <GlobalFilter base="/dashboard/analitica" pordefecto="30" activo={rango} extra={extra} />
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <ChartCard
            titulo={`Liquidaciones cerradas — ${rango === 'todo' ? 'histórico' : `últimos ${ventanaDias} días`}`}
            tamano="L"
          >
            {rango === 'todo' ? (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="text-4xl font-semibold tracking-tight tabular">{kpis?.viajesLiquidados ?? 0}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Total histórico</div>
              </div>
            ) : porDia === null ? (
              <EstadoVacio>No se pudo cargar esta gráfica.</EstadoVacio>
            ) : porDia.some((d) => d.valor > 0) ? (
              <BarChartSimple datos={porDia} alto={220} />
            ) : (
              <EstadoVacio>Sin cierres en esta ventana — prueba con 30d o el histórico.</EstadoVacio>
            )}
          </ChartCard>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {porConcepto && porConcepto.length > 0 ? (
            <ChartCard titulo="Gasto por concepto" subtitulo="Todo el histórico de la flota" tamano="M">
              <HBars datos={porConcepto.map((c) => ({ etiqueta: etiquetaConcepto(c.concepto), valor: c.total }))} formato="mxn" />
            </ChartCard>
          ) : (
            <ChartCard titulo="Gasto por concepto" tamano="S">
              <EstadoVacio>Todavía no hay gastos registrados.</EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Reportes
          </h2>
          {puedeExportar(rol) ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <a href="/api/export/liquidaciones" download className="card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                  <Table2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                </div>
                <div>
                  <div className="text-sm font-medium">Liquidaciones en CSV</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    Todas las liquidaciones de tu flota, para abrir en Excel o mandarle a tu contador.
                  </div>
                </div>
              </a>
              <Link href="/dashboard/cuadre" className="card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                  <FileText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                </div>
                <div>
                  <div className="text-sm font-medium">PDF por liquidación</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    El documento con fundamento citado que el motor genera al cerrar cada viaje — se baja desde el
                    detalle de cada una.
                  </div>
                </div>
              </Link>
            </div>
          ) : (
            <div className="mt-3">
              <EstadoVacio icono={<Download width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Tu rol no tiene permiso de exportar. Pídeselo al administrador de la flota.
              </EstadoVacio>
            </div>
          )}
        </section>

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            El explorador libre de métricas (elegir cualquier medida y cruzarla por ruta, unidad, operador o mes)
            necesita datos que hoy no se capturan: kilómetros recorridos, unidad asignada al viaje e ingreso del
            flete. Sin eso, costo/km, km en vacío, km/l, OTIF y margen no se pueden calcular — un menú que los
            ofrezca y los devuelva vacíos es peor que no tenerlo.
            <br /><br />
            Reportes programados por correo o WhatsApp tampoco existen todavía.
          </EstadoVacio>
        </div>
      </div>
    </div>
  );
}
