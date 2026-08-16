import { BookOpen } from 'lucide-react';
import { BarraPagina } from '../../dashboard/resumen-visual';
import { EstadoVacio } from '../ui/kit';

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
 *
 * Re-envuelta en la anatomía de página (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts`. El mensaje honesto es el mismo de antes.
 */
export default function ConocimientoRagPage() {
  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<BookOpen width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Conocimiento / RAG"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Esta feature no existe en Likida hoy</p>
          {/* EstadoVacio (kit compartido) — mismo mensaje honesto de antes,
              ni una palabra cambiada; las dos oraciones que antes eran `<p>`
              separados van como `<span className="block">` porque EstadoVacio
              ya envuelve `children` en un `<p>` propio, y anidar `<p>` dentro
              de `<p>` es HTML inválido (el navegador cierra el `<p>` externo
              antes de tiempo y React lo marca como mismatch de hidratación).
              Icono por defecto (Info). */}
          <EstadoVacio>
            <span className="block">
              Likida no usa RAG (retrieval-augmented generation) hoy — sus agentes trabajan directo sobre la
              extracción estructurada de OCR y la lógica de conciliación, no sobre una base de conocimiento
              documental. Esta página existe en el mapa de features de referencia, pero no aplica al producto
              actual a menos que eso cambie.
            </span>
            <span className="block mt-3" style={{ color: 'var(--muted)' }}>
              No hay tabla de embeddings, vector store, ni pipeline de retrieval en este código — por eso no hay
              nada más que mostrar aquí: ni carga de documentos, ni medidor de calidad de retrieval, ni un
              probador de RAG. Construir cualquiera de esos widgets sin la feature detrás sería aparentar algo
              que no existe.
            </span>
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
