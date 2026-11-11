import { getT } from '@/lib/i18n/servidor';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { EsqTarjetaV2, EsqCifrasV2, FilaTarjetas } from '../../ui-v2/componentes';
import {
  BloqueIntro, BloqueAlertasAdquisicion, BloqueCifrasCrecimiento, BloqueEmbudoAdquisicion, BloqueCostoLead, BloqueCampanas, BloqueActivacion, BloqueCohortes, BloqueUso, BloqueComisiones, BloqueSinInstrumentacion,
} from './bloques';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import '../dinero.css';

export const dynamic = 'force-dynamic';

/**
 * Crecimiento › Adquisición — con pocas flotas y sin instrumentación de producto casi todo lo que un board esperaría ver aquí (DAU/WAU/MAU,
 * NPS, retención) es honestamente inexistente. Lo real: el embudo de prospectos, el costo por lead donde se puede medir, las campañas con su
 * gasto medido, el embudo de activación, las cohortes y el gasto de IA por día como proxy de uso (etiquetado así, nunca como «crecimiento de
 * usuarios»). Las comisiones de los vendedores NO tienen base todavía y la pantalla lo declara.
 *
 * Cada bloque lee lo suyo (`./bloques`) dentro de su propio <Suspense> con un esqueleto compacto: un bloque lento no bloquea la página y cada
 * uno conserva su propio catch, o sea su propia leyenda honesta.
 */
export default async function CrecimientoPage() {
  const { t: ta } = await getT('admin_dinero');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();

  return (
    <EsqueletoPanelCifras titulo={ta('crecimiento.crecimiento')} apoyo={ta('crecimiento.de_donde_vienen_los')}>
      <Suspense fallback={<EsqTarjetaV2 alto={56} />}><BloqueIntro /></Suspense>
      <Suspense fallback={null}><BloqueAlertasAdquisicion /></Suspense>
      {/* Plantilla PC de Rovaq: cifras arriba → embudo y serie (6-6) → costo por lead y campañas (6-6) → activación y comisiones (6-6) → cohortes. */}
      <Suspense fallback={<EsqCifrasV2 n={4} />}><BloqueCifrasCrecimiento /></Suspense>
      <FilaTarjetas variante="6-6">
        <Suspense fallback={<EsqTarjetaV2 alto={200} />}><BloqueEmbudoAdquisicion /></Suspense>
        <Suspense fallback={<EsqTarjetaV2 alto={200} />}><BloqueUso /></Suspense>
      </FilaTarjetas>
      <FilaTarjetas variante="6-6">
        <Suspense fallback={<EsqTarjetaV2 alto={160} />}><BloqueCostoLead /></Suspense>
        <Suspense fallback={<EsqTarjetaV2 alto={160} />}><BloqueCampanas /></Suspense>
      </FilaTarjetas>
      <FilaTarjetas variante="6-6">
        <Suspense fallback={<EsqTarjetaV2 alto={140} />}><BloqueActivacion /></Suspense>
        <BloqueComisiones ta={ta} />
      </FilaTarjetas>
      <Suspense fallback={<EsqTarjetaV2 alto={120} />}><BloqueCohortes /></Suspense>
      <BloqueSinInstrumentacion ta={ta} />
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t: ta } = await getT('admin_dinero');
  return { title: ta('crecimiento.crecimiento') };
}
