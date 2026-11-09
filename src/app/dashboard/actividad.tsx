import { BarChartSimple, AreaChartSimple } from '../admin/charts';
import { EstadoVacio } from '../ui-v2/componentes';
import type { DiaViajes } from './serie-diaria';

export type ModoPeriodo = 'semanal' | 'mensual' | 'historico';

/**
 * Reemplaza a `ActividadSemanal` — un solo recuadro con tres vistas en vez
 * de tres widgets sueltos (el Calendario de al lado se quitó, dirección del
 * 8-ago-2026: este recuadro ocupa ese espacio).
 *
 * ── FE-5 (22-ago-2026): LOS DÍAS SE CUENTAN EN SQL ─────────────────────────
 *
 * Semana/Mes bucketeaban EN EL CLIENTE (`bucketsPorDia`) sobre las 100 filas
 * más recientes de `getViajes`. A 50,000 viajes/mes esas 100 filas son ~90
 * minutos de operación: la gráfica rotulada "últimos 7 días" dibujaba hora y
 * media de trabajo y seis barras en cero, sin decir que estaba mirando por
 * una rendija. Ahora `porDia` llega YA CONTADO por la base
 * (`serie_comparativa_tenant` con ventana de 1 día — ver `serie-diaria.ts`),
 * así que Semanal son los últimos 7 buckets reales y Mensual los 30.
 *
 * Histórico sigue aparte (`porMes`, `getViajesPorMes` — agregado real por
 * mes) y se pinta como área/línea, el lenguaje visual de una serie larga.
 *
 * `modo` llega CONTROLADO desde `panel-periodo.tsx` (8-ago-2026) — el
 * selector Semanal/Mensual/Histórico se unificó para mover también
 * Viajes/Gasto por categoría/Liquidado/Top rutas, así que este componente ya
 * no trae su propio pill ni su propio estado.
 */
export function Actividad({
  porDia, porMes, modo,
}: {
  /** Un bucket por día, del más viejo al más reciente. `null` = la lectura
   *  falló; se dice, en vez de dibujar una gráfica en ceros que se lee como
   *  una flota parada. */
  porDia: DiaViajes[] | null;
  /** Un bucket por mes, del más viejo al más reciente. `null` = la lectura
   *  de `getViajesPorMes` falló — MISMA regla que `porDia`: antes del 6-sep,
   *  `BloqueEstadisticas` (inicio-contenido.tsx) colapsaba el `null` con
   *  `?? []` antes de que llegara aquí, y `sinDatos` sobre `[]` es
   *  vacuamente `true`, así que una lectura caída pintaba "Aún no hay
   *  viajes registrados." — la misma mentira que este archivo ya sabía
   *  evitar para `porDia`. */
  porMes: Array<{ dia: string; valor: number }> | null;
  modo: ModoPeriodo;
}) {
  if ((modo !== 'historico' && porDia === null) || (modo === 'historico' && porMes === null)) {
    return (
      <EstadoVacio contenido titulo="No disponible ahora">No se pudo cargar esta gráfica.</EstadoVacio>
    );
  }

  const serie = porDia ?? [];
  const ventana = modo === 'semanal' ? 7 : 30;
  const datosBarras = (ventana >= serie.length ? serie : serie.slice(serie.length - ventana))
    .map((d) => ({ dia: d.dia, valor: d.viajes }));
  const sinDatos = modo === 'historico' ? (porMes ?? []).every((d) => d.valor === 0) : datosBarras.every((d) => d.valor === 0);

  if (sinDatos) {
    return (
      <EstadoVacio contenido titulo="Sin viajes">
        {modo === 'historico' ? 'Aún no hay viajes registrados.' : 'Sin viajes iniciados en este periodo.'}
      </EstadoVacio>
    );
  }
  return modo === 'historico'
    ? <AreaChartSimple datos={porMes ?? []} etiquetaValor={(v) => `${v} viaje${v === 1 ? '' : 's'}`} />
    : <BarChartSimple datos={datosBarras} etiquetaValor={(v) => `${v} viaje${v === 1 ? '' : 's'}`} alto={192} />;
}
