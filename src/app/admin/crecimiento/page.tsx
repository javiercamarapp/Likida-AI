import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { TrendingUp } from 'lucide-react';
import { BarraPagina } from '../../dashboard/resumen-visual';
import { EsqTarjetaV2, EsqCifrasV2 } from '../../ui-v2/componentes';
import {
  BloqueIntro, BloqueEmbudoAdquisicion, BloqueCostoYCampanas, BloqueActivacion, BloqueCohortes, BloqueUso, BloqueSinInstrumentacion,
} from './bloques';

export const dynamic = 'force-dynamic';

/**
 * Crecimiento — con 1 solo tenant y sin instrumentación de producto (no hay
 * tabla de eventos, ni funnel, ni cohortes), casi todo lo que un board
 * esperaría ver aquí (DAU/WAU/MAU, NPS, embudo, retención) es honestamente
 * inexistente. Lo único real y relevante: el gasto de IA por día
 * (`resumen.porDia`) como proxy de "cuánto se está usando la plataforma" —
 * etiquetado así a propósito, nunca como "crecimiento de usuarios", porque
 * no hay una sola métrica de usuario real detrás.
 *
 * Anatomía de página (14-ago): BarraPagina + tarjetas sobre el lienzo tenue
 * (--g1), como consola.tsx. El H1 honesto y su párrafo se quedan — son la
 * tesis de la página — solo cambian de glass-panel a tarjeta.
 *
 * R9c: cada bloque lee lo suyo (`./bloques`) dentro de su propio <Suspense> con un esqueleto compacto —un bloque lento ya no bloquea la
 * página—. Antes las seis lecturas salían juntas en un `Promise.all` y la página esperaba a la más lenta; ahora cada una conserva su propio
 * catch (su propia leyenda honesta) y se pinta cuando llega.
 */
export default async function CrecimientoPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<TrendingUp width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Crecimiento"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <Suspense fallback={<EsqTarjetaV2 alto={84} />}><BloqueIntro /></Suspense>
          <Suspense fallback={<EsqTarjetaV2 alto={120} />}><BloqueEmbudoAdquisicion /></Suspense>
          <Suspense fallback={<EsqTarjetaV2 alto={160} />}><BloqueCostoYCampanas /></Suspense>
          <Suspense fallback={<EsqTarjetaV2 alto={120} />}><BloqueActivacion /></Suspense>
          <Suspense fallback={<EsqTarjetaV2 alto={120} />}><BloqueCohortes /></Suspense>
          <Suspense fallback={<><EsqTarjetaV2 alto={240} /><EsqCifrasV2 n={2} /></>}><BloqueUso /></Suspense>
          <BloqueSinInstrumentacion />
        </div>
      </div>
    </main>
  );
}

export const metadata: Metadata = { title: 'Crecimiento' };
