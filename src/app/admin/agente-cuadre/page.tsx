import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/formato';
import { Calculator, DollarSign, CheckCircle2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

function Insignia({ Icono }: { Icono: typeof Calculator }) {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
    </div>
  );
}

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
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={DollarSign} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{cuadre ? usd(cuadre.costoUsd) : usd(0)}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Gastado en Cuadre</div>
                </div>
              </div>
            </div>
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={Calculator} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{cuadre ? cuadre.n : 0}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Llamadas de Cuadre</div>
                </div>
              </div>
            </div>
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={CheckCircle2} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{r.viajesProcesados}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Viajes procesados</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Conciliación automática vs. manual</TituloSeccion>
          <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
            % de conciliación automática vs. manual — necesita instrumentar qué viajes requirieron intervención
            humana, no existe hoy. Likida sabe cuántos viajes se procesaron ({r.viajesProcesados}) y cuánto costó el
            Agente de Cuadre, pero no guarda todavía si un viaje se cerró solo o si alguien tuvo que intervenir.
          </p>
        </section>
      </div>
    </div>
  );
}
