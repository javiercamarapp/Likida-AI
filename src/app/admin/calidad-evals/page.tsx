import { FlaskConical } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';

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
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <FlaskConical width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Calidad & Evals</span>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <EstadoVacio icono={<FlaskConical width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
            Score de calidad, % de baja confianza, alucinaciones detectadas, CSAT, feedback 👍/👎, drift de calidad,
            evals automáticos por criterio, cola de revisión priorizada — Likida no tiene un pipeline de evaluación
            ni una tabla de feedback hoy.
            <br /><br />
            Esto es AgentOps de nivel Langfuse/Braintrust — semanas de trabajo real, Fase 4 del roadmap.
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}
