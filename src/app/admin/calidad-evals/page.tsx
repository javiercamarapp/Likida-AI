import { FlaskConical } from 'lucide-react';

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
        <div className="p-8 text-center">
          <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <FlaskConical width={20} height={20} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          </div>
          <p className="text-sm mt-4 max-w-lg mx-auto" style={{ color: 'var(--muted)' }}>
            Score de calidad, % de baja confianza, alucinaciones detectadas, CSAT, feedback 👍/👎, drift de calidad,
            evals automáticos por criterio, cola de revisión priorizada — Likida no tiene un pipeline de evaluación
            ni una tabla de feedback hoy.
          </p>
          <p className="text-xs mt-3 max-w-lg mx-auto" style={{ color: 'var(--muted)' }}>
            Esto es AgentOps de nivel Langfuse/Braintrust — semanas de trabajo real, Fase 4 del roadmap.
          </p>
        </div>
      </div>
    </div>
  );
}
