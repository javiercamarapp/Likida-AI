import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, costoIaPorDiaDesde } from '@/lib/admin/negocio';
import { getUnidadesMedidas, escenarioDe, ESCENARIOS_VIAJES_DIA, SUPUESTOS_CAPACIDAD, LIMITES_NOMINALES } from '@/lib/admin/capacidad';
import { ahoraMs } from '@/lib/saludo';
import { numero } from '@/lib/formato';
import { usd } from '@/lib/utils';
import { proyectarCosto } from './proyeccion';
import { AreaChartSimple } from '../charts';
import { EstadoVacio, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '../../ui-v2/componentes';
import { Cifra, TiraCifras } from '../../ui-v2/graficas';

export const dynamic = 'force-dynamic';

export default async function CapacidadForecastPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const r = await getResumenNegocio();
  // A37-S05-03: ventana REAL de 30 días (UTC, como la serie) y costo sin redondear.
  // Día UTC A PROPÓSITO (no «hoy» de México): `porDia` viene de la agregación SQL por día UTC y la ventana tiene que casar con sus cubetas.
  const ahoraIso = new Date(ahoraMs()).toISOString();
  const hoyUtc = ahoraIso.slice(0, 10);
  let enVentana: Array<{ dia: string; costoUsd: number }> | null = null;
  try {
    enVentana = await costoIaPorDiaDesde(new Date(new Date(`${hoyUtc}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString());
  } catch { enVentana = null; }
  const proyeccion = enVentana === null ? null : proyectarCosto(r.porDia, enVentana, hoyUtc);
  // El modelo de capacidad (fase 7): unidades MEDIDAS si hay muestra; si la
  // lectura falla, la sección lo dice — jamás un escenario con base fantasma.
  let unidades: Awaited<ReturnType<typeof getUnidadesMedidas>> | null = null;
  try { unidades = await getUnidadesMedidas(ahoraMs()); } catch { unidades = null; }

  return (
    <MarcoPagina titulo="Capacidad & Forecast">
      {enVentana === null ? (
        <EstadoVacio titulo="Sin lectura">
          No se pudo leer el costo de la ventana de 30 días — esto NO significa que no haya gasto.
        </EstadoVacio>
      ) : proyeccion === null ? (
        <EstadoVacio titulo="Sin datos">
          Sin datos de costo de IA registrados todavía — no hay base para proyectar nada.
        </EstadoVacio>
      ) : (
        <>
          <TiraCifras>
            <Cifra
              etiqueta={`Costo diario promedio, últimos ${proyeccion.diasVentana} día${proyeccion.diasVentana === 1 ? '' : 's'}`}
              valor={usd(proyeccion.promedioDiario)}
            />
            <Cifra etiqueta="Proyección a 30 días" valor={usd(proyeccion.proyeccionMensual)} />
          </TiraCifras>

          <Tarjeta titulo="Costo de IA por día">
            {r.porDia.length > 1 ? (
              <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={(v) => usd(v)} etiquetaSerie="Costo de IA por día (USD)" />
            ) : (
              <p className="m-0 flex h-40 items-center text-sm text-muted">
                Sin historial suficiente todavía para una serie — solo hay un día con datos.
              </p>
            )}
            <p className="m-0 mt-3 text-xs text-muted">
              Proyección simple: costo diario promedio × 30 — no es un modelo real de forecasting, solo una
              extrapolación honesta de la tendencia actual.
              {proyeccion.diasVentana < 7 && ' Con tan poca historia, esta cifra es apenas indicativa.'}
            </p>
          </Tarjeta>
        </>
      )}

      {/* ── EL MODELO DE CAPACIDAD (fase 7): escenarios con supuestos A LA VISTA. Las unidades salen de lo medido cuando hay
            muestra; los límites de proveedor son nominales y se dice. ── */}
      <Tarjeta titulo="Modelo de capacidad — escenarios de escala">
        {unidades === null ? (
          <p className="m-0 text-[13px] text-muted">
            No se pudieron leer las unidades medidas — sin base, no se pintan escenarios.
          </p>
        ) : (
          <>
            <p className="m-0 mb-3 text-[13px] text-muted">
              {unidades.costoIaPorViaje !== null
                ? <>Costo de IA MEDIDO: {usd(unidades.costoIaPorViaje)} por viaje liquidado (muestra: {numero(unidades.muestraViajes)} liquidaciones en 30d{unidades.muestraViajes < 30 ? ' — muestra chica, apenas indicativo' : ''}).</>
                : <>Sin liquidaciones en 30d — el costo por viaje no se puede medir y el escenario lo deja en blanco.</>}
            </p>
            <TablaBase
              etiqueta="Proyección de capacidad por escenario"
              columnas={columnasEscenario(unidades.costoIaPorViaje)}
              filas={ESCENARIOS_VIAJES_DIA}
              idFila={(v) => String(v)}
              altoMaximo={false}
            />
            <p className="m-0 mt-3 text-xs text-muted">
              Supuestos declarados: {SUPUESTOS_CAPACIDAD.mensajesPorViaje} mensajes y {SUPUESTOS_CAPACIDAD.comprobantesPorViaje} comprobantes
              por viaje (~{Math.round(SUPUESTOS_CAPACIDAD.bytesPorComprobante / 1000)} KB c/u), {SUPUESTOS_CAPACIDAD.llamadasLlmPorViaje} llamadas
              LLM por viaje, jornada pico de {SUPUESTOS_CAPACIDAD.horasPicoDia} h. Es una estimación con supuestos a la vista, no una medición.
            </p>
            <div className="mt-3 border-t border-[var(--line)] pt-3">
              <p className="etiqueta-mono m-0 mb-1 text-[11px] uppercase text-muted">Límites nominales del proveedor (documentación, no medidos)</p>
              {LIMITES_NOMINALES.map((l) => (
                <p key={l.recurso} className="m-0 text-[12px] text-muted">· {l.recurso}: {l.limite} <span>({l.fuente})</span></p>
              ))}
            </div>
          </>
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}

/** Columnas de la tabla de escenarios: cada fila es un volumen de viajes/día y el resto sale de `escenarioDe`. */
function columnasEscenario(costoIaPorViaje: number | null): ColumnaBase<number>[] {
  return [
    { id: 'viajes', titulo: 'Viajes/día', principal: true, celda: (v) => numero(v) },
    { id: 'wa', titulo: 'Mensajes WA/día', alinear: 'der', celda: (v) => numero(escenarioDe(v, costoIaPorViaje).mensajesDia) },
    { id: 'pico', titulo: 'Pico msg/min', alinear: 'der', celda: (v) => numero(escenarioDe(v, costoIaPorViaje).mensajesMinPico) },
    { id: 'llm', titulo: 'Llamadas LLM/día', alinear: 'der', celda: (v) => numero(escenarioDe(v, costoIaPorViaje).llamadasLlmDia) },
    {
      id: 'costo', titulo: 'Costo IA/día', alinear: 'der',
      celda: (v) => {
        const c = escenarioDe(v, costoIaPorViaje).costoIaDiaUsd;
        return c === null ? <span className="text-muted">sin base medida</span> : usd(c);
      },
    },
    { id: 'storage', titulo: 'Storage/día', alinear: 'der', celda: (v) => `${numero(escenarioDe(v, costoIaPorViaje).storageDiaMb)} MB` },
  ];
}

export const metadata: Metadata = { title: 'Capacidad & Forecast' };
