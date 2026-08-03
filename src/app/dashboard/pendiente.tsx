import type { LucideIcon } from 'lucide-react';
import { EstadoVacio } from '../admin/ui/kit';

/**
 * La pantalla de una sección que TODAVÍA NO EXISTE — y que lo dice en vez de
 * simularlo.
 *
 * Siete secciones del panel están en este caso (Rentabilidad, Clientes,
 * Cobranza, Unidades, Mapa, Cotizador, Soporte) porque no hay una sola fila
 * en la base que las alimente: no existe tabla de clientes, ni de vehículos,
 * ni de facturas emitidas, ni GPS. La alternativa —enseñarlas con datos de
 * ejemplo— haría el panel más impresionante y al producto indefendible en la
 * primera pregunta del contralor: "¿y estos números de dónde salen?".
 *
 * Cada una explica QUÉ falta (`falta`) y QUÉ traería cuando exista
 * (`cuandoExista`), para que se lea como un roadmap y no como un error.
 */
export default function SeccionPendiente({
  Icono, titulo, subtitulo, falta, cuandoExista,
}: {
  Icono: LucideIcon;
  titulo: string;
  subtitulo: string;
  /** Por qué no se puede construir hoy — la pieza que falta, concreta. */
  falta: React.ReactNode;
  /** Lo que esta pantalla mostraría el día que esa pieza exista. */
  cuandoExista: string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Icono width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">{titulo}</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>{subtitulo}</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Todavía no existe
          </h2>
          <div className="mt-3">
            <EstadoVacio icono={<Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
              {falta}
            </EstadoVacio>
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Qué va a mostrar cuando exista
          </h2>
          <ul className="text-sm mt-3 space-y-2" style={{ color: 'var(--muted)' }}>
            {cuandoExista.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="w-1 h-1 rounded-full mt-2 shrink-0" style={{ background: 'var(--muted)' }} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Esta pantalla está vacía a propósito. Likida prefiere enseñarte un hueco honesto que cifras de ejemplo
            que se lean como tuyas.
          </p>
        </div>
      </div>
    </div>
  );
}
