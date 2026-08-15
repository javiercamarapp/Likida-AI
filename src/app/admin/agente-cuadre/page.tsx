import { getResumenNegocio } from '@/lib/admin/negocio';
import { Calculator, DollarSign, CheckCircle2 } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

const ICONO_KPI = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/**
 * Agente de Cuadre — la fase que compara los gastos ya capturados contra el
 * anticipo y la política de la flota. Real: `llm_costo` filtrado por
 * `fase === 'cuadre'` (`getResumenNegocio`) y `viaje` para el total de
 * viajes procesados.
 *
 * Re-envuelta en la anatomía FlowAI (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts` + `StatCard` del kit. Las cifras y su fuente
 * no cambian. Un cero aquí es MEDIDO: cero filas en `llm_costo` para la
 * fase es cero gasto real, no un relleno.
 */
export default async function AgenteCuadrePage() {
  const r = await getResumenNegocio();
  const cuadre = r.porFase.find((f) => f.fase === 'cuadre');

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Calculator width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente de Cuadre"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Concilia gastos comprobados contra anticipo y política — costo real, histórico</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <StatCard icono={<DollarSign {...ICONO_KPI} />}
              etiqueta="Gastado en Cuadre" valor={cuadre ? cuadre.costoUsd : 0} formato="usd"
            />
            <StatCard icono={<Calculator {...ICONO_KPI} />}
              etiqueta="Llamadas de Cuadre" valor={cuadre ? cuadre.n : 0} formato="entero"
            />
            <StatCard icono={<CheckCircle2 {...ICONO_KPI} />}
              etiqueta="Viajes procesados" valor={r.viajesProcesados} formato="entero"
            />
          </div>

          <div className="card p-3">
            <TituloSeccion>Conciliación automática vs. manual</TituloSeccion>
            <div className="mt-2">
              <EstadoVacio>
                % de conciliación automática vs. manual — necesita instrumentar qué viajes requirieron intervención
                humana, no existe hoy. Likida sabe cuántos viajes se procesaron ({r.viajesProcesados}) y cuánto costó el
                Agente de Cuadre, pero no guarda todavía si un viaje se cerró solo o si alguien tuvo que intervenir.
              </EstadoVacio>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
