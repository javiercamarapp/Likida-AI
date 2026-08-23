import { BarChartSimple, AreaChartSimple } from '../admin/charts';

export type ModoPeriodo = 'semanal' | 'mensual' | 'historico';

/**
 * Últimos `dias` días como buckets — comparación de STRINGS, no de objetos
 * `Date`. `fechaInicio` es columna `date` (sin hora/zona horaria, ver
 * `analytics.ts`), así que convertirla a `Date` y de vuelta a ISO para
 * comparar es un rodeo que en el peor caso corre el bucket un día (el
 * mismo tipo de bug que ya se pagó con `created_at`, un timestamptz, en
 * `getLiquidacionesPorDia`). Nunca se parsea `fechaInicio`.
 *
 * ── FE-20 (auditoría prod): `hoy` LLEGA, no se calcula ──────────────────────
 *
 * Esta función se ejecuta en un Client Component (`PanelPeriodo`), y por tanto
 * DOS veces: una en el servidor al pintar el HTML y otra en el navegador al
 * hidratar. Sacaba el día de `new Date()` + `setHours(0,0,0,0)`, es decir del
 * reloj Y la zona de quien la corriera:
 *
 *     servidor (Vercel, UTC)      → 1 de enero
 *     navegador del contralor (MX)→ 31 de diciembre
 *
 * De las 18:00 a las 24:00 hora de México los dos renders no coincidían: React
 * reporta un mismatch de hidratación y la gráfica PARPADEA a otro conjunto de
 * barras delante del usuario. Ahora el día lo resuelve el servidor UNA vez
 * (`hoyMx`) y viaja como prop, así que los dos renders son el mismo — y es el
 * día de México, que es el que el rótulo "últimos 7 días" promete.
 */
export function bucketsPorDia(
  viajes: Array<{ fechaInicio: string | null }>,
  dias: number,
  hoy: string,
): Array<{ dia: string; valor: number }> {
  const conteos = new Map<string, number>();
  for (const v of viajes) {
    if (!v.fechaInicio) continue;
    conteos.set(v.fechaInicio, (conteos.get(v.fechaInicio) ?? 0) + 1);
  }
  // Aritmética de calendario sobre un día ya resuelto: no es conversión de
  // zona, y por eso puede ir en UTC sin correr nada (mismo criterio que
  // `fechaMx` con un valor de solo fecha).
  const ancla = new Date(`${hoy}T00:00:00Z`);
  return Array.from({ length: dias }, (_, i) => {
    const d = new Date(ancla);
    d.setUTCDate(ancla.getUTCDate() - (dias - 1 - i));
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
  viajes, porMes, modo, hoy,
}: {
  viajes: Array<{ fechaInicio: string | null }>;
  porMes: Array<{ dia: string; valor: number }>;
  modo: ModoPeriodo;
  /** El día de México (`hoyMx`) resuelto EN EL SERVIDOR — ver `bucketsPorDia`.
   *  Calcularlo aquí daría un HTML distinto al hidratar. */
  hoy: string;
}) {
  const datosBarras = modo === 'semanal' ? bucketsPorDia(viajes, 7, hoy) : bucketsPorDia(viajes, 30, hoy);
  const sinDatos = modo === 'historico' ? porMes.every((d) => d.valor === 0) : datosBarras.every((d) => d.valor === 0);

  if (sinDatos) {
    return (
      <div className="flex-1 min-h-[110px] w-full flex items-center justify-center">
        <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>
          {modo === 'historico' ? 'Aún no hay viajes registrados.' : 'Sin viajes iniciados en este periodo.'}
        </p>
      </div>
    );
  }
  return modo === 'historico'
    ? <AreaChartSimple datos={porMes} etiquetaValor={(v) => `${v} viaje${v === 1 ? '' : 's'}`} />
    : <BarChartSimple datos={datosBarras} etiquetaValor={(v) => `${v} viaje${v === 1 ? '' : 's'}`} alto={192} />;
}
