import { ClipboardCheck } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';
import { BarraPagina } from '../../dashboard/resumen-visual';

export const dynamic = 'force-dynamic';

/**
 * Calidad & Evals — página enteramente de empty-state honesto:
 * `requireSuperadmin()` ya lo hizo el layout, aquí no hay datos que traer
 * porque no existe una fuente real detrás de ninguna de estas métricas.
 * Likida no tiene pipeline de evaluación ni tabla de feedback (👍/👎) hoy —
 * esto es AgentOps de nivel Langfuse/Braintrust, semanas de trabajo real,
 * Fase 4 del roadmap. Nada de esto se simula con una gráfica vacía o un
 * número inventado.
 */
export default function CalidadEvalsPage() {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ClipboardCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Calidad & Evals"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <EstadoVacio icono={<ClipboardCheck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            Score de calidad, % de baja confianza, alucinaciones detectadas, CSAT, feedback 👍/👎, drift de calidad,
            evals automáticos por criterio, cola de revisión priorizada — Likida no tiene un pipeline de evaluación
            ni una tabla de feedback hoy.
            <br /><br />
            Esto es AgentOps de nivel Langfuse/Braintrust — semanas de trabajo real, Fase 4 del roadmap.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
