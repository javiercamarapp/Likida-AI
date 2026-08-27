import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getBorradorViaje } from '@/lib/likida/carta_porte_datos';
import { numero } from '@/lib/formato';
import { sufijoTenant } from '../../sufijo';
import { SeccionTimbrado } from './timbrar';

export const dynamic = 'force-dynamic';

// La ruta REAL es dinámica (/dashboard/timbrado/<uuid>); el gate usa la llave
// de su padre — misma área, mismos datos, mismo criterio que /dashboard/<uuid>
// gateando su área a mano (ver visibilidad.ts).
const RUTA = '/dashboard/timbrado';

/**
 * EL TIMBRE DE UN VIAJE (0227 — auditoría Fable c6-3).
 *
 * Vive en `dinero` y no en `operacion` por una razón sola: emitir el CFDI es
 * un acto fiscal irreversible con los importes del flete adentro. Antes el
 * botón colgaba del borrador de Carta Porte, que es del jefe de tráfico — y
 * eso le daba a ese puesto tanto el poder de timbrar como la vista del flete,
 * el IVA y el total.
 *
 * ESTA PANTALLA NO SUSTITUYE AL BORRADOR. El borrador sigue siendo del jefe
 * de tráfico: ahí se declara la ruta, se corrigen los 37 datos del Apéndice 3
 * y se lee el veredicto del validador. Aquí solo se emite, y lo que falte se
 * dice con el mismo texto que el borrador ya enseña (misma función).
 */
export default async function PaginaTimbradoViaje({
  params, searchParams,
}: {
  params: Promise<{ viajeId: string }>;
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const [{ viajeId }, sp] = await Promise.all([params, searchParams]);
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Un error de lectura LANZA adentro (error boundary); null = no es de esta
  // flota o no existe — 404 honesto, jamás la ficha de otro tenant.
  const v = await getBorradorViaje(tenantId, viajeId);
  if (!v) notFound();

  const rotulo = v.folio ?? v.viajeId.slice(0, 8);

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <Link href={`${RUTA}${sufijoTenant(sp)}`} className="text-[12.5px] font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>
          ← Volver a Timbrado
        </Link>
        <Link
          href={`/dashboard/carta-porte/borrador/${v.viajeId}${sufijoTenant(sp)}`}
          className="text-[12.5px] font-medium hover:opacity-75"
          style={{ color: 'var(--marca)' }}
        >
          Ver el borrador completo →
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="font-display text-[19px] font-semibold">Timbrado — viaje {rotulo}</h1>
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          {v.origen && v.destino ? `${v.origen} → ${v.destino}` : 'Ruta sin capturar'}
          {v.unidadEconomico ? ` · Unidad ${v.unidadEconomico}` : ''}
          {' · '}{numero(v.mercancias.length)} mercancía(s)
        </p>
        <p className="text-[12px] px-3 py-2 rounded-lg hairline" style={{ color: 'var(--warn)' }}>
          Timbrar EMITE un CFDI real ante el SAT a nombre de tu flota. Cancelarlo después tiene
          ventana, motivo y, a veces, la aceptación del receptor: se aprieta una vez y con los datos
          revisados.
        </p>
      </header>

      <SeccionTimbrado v={v} searchParams={sp} />
    </main>
  );
}
