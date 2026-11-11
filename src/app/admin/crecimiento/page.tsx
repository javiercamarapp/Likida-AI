import { getT } from '@/lib/i18n/servidor';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { EsqTarjetaV2, EsqCifrasV2, MarcoPagina } from '../../ui-v2/componentes';
import {
  BloqueIntro, BloqueEmbudoAdquisicion, BloqueCostoYCampanas, BloqueActivacion, BloqueCohortes, BloqueUso, BloqueSinInstrumentacion,
} from './bloques';
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
    <MarcoPagina titulo={ta('crecimiento.crecimiento')} apoyo={ta('crecimiento.de_donde_vienen_los')}>
      <Suspense fallback={<EsqTarjetaV2 alto={84} />}><BloqueIntro /></Suspense>
      <Suspense fallback={<EsqTarjetaV2 alto={120} />}><BloqueEmbudoAdquisicion /></Suspense>
      <Suspense fallback={<EsqTarjetaV2 alto={160} />}><BloqueCostoYCampanas /></Suspense>
      <Suspense fallback={<EsqTarjetaV2 alto={120} />}><BloqueActivacion /></Suspense>
      <Suspense fallback={<EsqTarjetaV2 alto={120} />}><BloqueCohortes /></Suspense>
      <Suspense fallback={<><EsqTarjetaV2 alto={240} /><EsqCifrasV2 n={2} /></>}><BloqueUso /></Suspense>
      <BloqueSinInstrumentacion ta={ta} />
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t: ta } = await getT('admin_dinero');
  return { title: ta('crecimiento.crecimiento') };
}
