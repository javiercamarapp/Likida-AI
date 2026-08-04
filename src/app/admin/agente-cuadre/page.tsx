import { getResumenNegocio } from '@/lib/admin/negocio';
import { Calculator, DollarSign, CheckCircle2 } from 'lucide-react';
import { KpiTile, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

/**
 * Agente de Cuadre — la fase que compara los gastos ya capturados contra el
 * anticipo y la política de la flota. Real: `llm_costo` filtrado por
 * `fase === 'cuadre'` (`getResumenNegocio`) y `viaje` para el total de
 * viajes procesados.
 */
export default async function AgenteCuadrePage() {
  const r = await getResumenNegocio();
  const cuadre = r.porFase.find((f) => f.fase === 'cuadre');

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Calculator width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Agente de Cuadre</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Concilia gastos comprobados contra anticipo y política</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <TituloSeccion>Costo real</TituloSeccion>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <KpiTile
              icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Gastado en Cuadre" valor={cuadre ? cuadre.costoUsd : 0} formato="usd"
            />
            <KpiTile
              icono={<Calculator width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Llamadas de Cuadre" valor={cuadre ? cuadre.n : 0} formato="entero"
            />
            <KpiTile
              icono={<CheckCircle2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Viajes procesados" valor={r.viajesProcesados} formato="entero"
            />
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Conciliación automática vs. manual</TituloSeccion>
          <div className="mt-2">
            <EstadoVacio>
              % de conciliación automática vs. manual — necesita instrumentar qué viajes requirieron intervención
              humana, no existe hoy. Likida sabe cuántos viajes se procesaron ({r.viajesProcesados}) y cuánto costó el
              Agente de Cuadre, pero no guarda todavía si un viaje se cerró solo o si alguien tuvo que intervenir.
            </EstadoVacio>
          </div>
        </section>
      </div>
    </div>
  );
}
