import { Sparkles } from 'lucide-react';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { BarraPagina } from '../../dashboard/resumen-visual';
import ChatNegocio from '../chat';

export const dynamic = 'force-dynamic';

/**
 * Chatea con tus Datos — la versión de página completa de `ChatNegocio`
 * (el mismo componente del panel lateral, expandido). Re-envuelta en la
 * anatomía FlowAI (14-ago): lienzo `--g1` + `BarraPagina` con el ícono de
 * `rutas.ts`. El chat y sus respuestas no cambian.
 */
export default async function AdminChat() {
  const r = await getResumenNegocio();

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Sparkles width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Chatea con tus Datos"
        />
        <div className="px-5 py-5 flex-1">
          <div className="max-w-2xl">
            <ChatNegocio resumen={r} />
          </div>
        </div>
      </div>
    </main>
  );
}
