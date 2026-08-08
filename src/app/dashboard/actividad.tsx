import { BarChartSimple, AreaChartSimple } from '../admin/charts';

export type ModoPeriodo = 'semanal' | 'mensual' | 'historico';

/**
 * Últimos `dias` días como buckets — comparación de STRINGS, no de objetos
 * `Date`. `fechaInicio` es columna `date` (sin hora/zona horaria, ver
 * `analytics.ts`), así que convertirla a `Date` y de vuelta a ISO para
 * comparar es un rodeo que en el peor caso corre el bucket un día (el
 * mismo tipo de bug que ya se pagó con `created_at`, un timestamptz, en
 * `getLiquidacionesPorDia`). El único `Date` de esta función es el de HOY,
 * para generar los últimos N días — nunca se parsea `fechaInicio`.
 */
export function bucketsPorDia(viajes: Array<{ fechaInicio: string | null }>, dias: number): Array<{ dia: string; valor: number }> {
  const conteos = new Map<string, number>();
  for (const v of viajes) {
    if (!v.fechaInicio) continue;
    conteos.set(v.fechaInicio, (conteos.get(v.fechaInicio) ?? 0) + 1);
  }
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Array.from({ length: dias }, (_, i) => {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() - (dias - 1 - i));
    const iso = d.toISOString().slice(0, 10);
    return { dia: iso, valor: conteos.get(iso) ?? 0 };
  });
}

/**
 * Reemplaza a `ActividadSemanal` — un solo recuadro con tres vistas en vez
 * de tres widgets sueltos (el Calendario de al lado se quitó, dirección del
 * 8-ago-2026: este recuadro ocupa ese espacio). Semana/Mes leen del MISMO
 * `viajes` que ya carga `page.tsx` (capado a 100 filas recientes — de sobra
 * para 7/30 días). Histórico NO reusa ese arreglo: un tope de 100 se
 * leería como "todo el histórico" en una flota que ya pasó esa cifra, así
 * que viaja aparte (`porMes`, `getViajesPorMes` — agregado real sin tope)
 * y se pinta como área/línea, el lenguaje visual de una serie larga
 * (estilo gráfica de acciones) en vez de barras.
 *
 * `modo` llega CONTROLADO desde `panel-periodo.tsx` (8-ago-2026, más
 * tarde) — el selector Semanal/Mensual/Histórico se unificó para mover
 * también Viajes/Gasto por categoría/Liquidado/Top rutas, así que este
 * componente ya no trae su propio pill ni su propio estado.
 */
export function Actividad({
  viajes, porMes, modo,
}: {
  viajes: Array<{ fechaInicio: string | null }>;
  porMes: Array<{ dia: string; valor: number }>;
  modo: ModoPeriodo;
}) {
  const datosBarras = modo === 'semanal' ? bucketsPorDia(viajes, 7) : bucketsPorDia(viajes, 30);
  const sinDatos = modo === 'historico' ? porMes.every((d) => d.valor === 0) : datosBarras.every((d) => d.valor === 0);

  if (sinDatos) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        {modo === 'historico' ? 'Aún no hay viajes registrados.' : 'Sin viajes iniciados en este periodo.'}
      </p>
    );
  }
  return modo === 'historico'
    ? <AreaChartSimple datos={porMes} etiquetaValor={(v) => `${v} viaje${v === 1 ? '' : 's'}`} />
    : <BarChartSimple datos={datosBarras} etiquetaValor={(v) => `${v} viaje${v === 1 ? '' : 's'}`} alto={192} />;
}
