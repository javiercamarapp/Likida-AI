import { BookOpen } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Conocimiento / RAG — Likida NO tiene esta feature. No hay tabla de
 * embeddings, no hay vector store, no hay pipeline de retrieval sobre
 * documentos: los agentes (OCR, Cuadre) trabajan directo sobre la
 * extracción estructurada y la lógica de conciliación, no sobre una base
 * de conocimiento documental. Por eso esta página es un solo panel con un
 * mensaje honesto — nada de UI de carga de documentos, medidores de
 * calidad de retrieval ni un "probador" de RAG: construir cualquiera de
 * esos widgets sería aparentar una feature que conceptualmente no existe
 * en el producto, justo lo que la regla del proyecto prohíbe.
 */
export default function ConocimientoRagPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <BookOpen width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Conocimiento / RAG</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Esta feature no existe en Likida hoy</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-6">
          <p className="text-sm leading-relaxed">
            Likida no usa RAG (retrieval-augmented generation) hoy — sus agentes trabajan directo sobre la
            extracción estructurada de OCR y la lógica de conciliación, no sobre una base de conocimiento
            documental. Esta página existe en el mapa de features de referencia, pero no aplica al producto
            actual a menos que eso cambie.
          </p>
          <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>
            No hay tabla de embeddings, vector store, ni pipeline de retrieval en este código — por eso no hay
            nada más que mostrar aquí: ni carga de documentos, ni medidor de calidad de retrieval, ni un
            probador de RAG. Construir cualquiera de esos widgets sin la feature detrás sería aparentar algo
            que no existe.
          </p>
        </section>
      </div>
    </div>
  );
}
