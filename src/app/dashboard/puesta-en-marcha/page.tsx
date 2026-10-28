import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';

export const dynamic = 'force-dynamic';

/** La puerta de la ruta: esta cadena se clasifica en `AREA_POR_RUTA` y `RUTAS_PERFIL_CINCO_AGENTES` (visibilidad.ts). */
const RUTA = '/dashboard/puesta-en-marcha';

/**
 * Puesta en marcha — el asistente de conexiones del dueño (PLAN-MAESTRO §2.5).
 *
 * ESQUELETO DEL PR «catálogo de rutas» (carril A): solo existe la ruta, su clasificación y su puerta, para que
 * `perfil_fuga_paginas`, `perfil_matriz` y `AREA_POR_RUTA` queden cerrados UNA sola vez en la Fase 1. La pantalla real
 * (anillo de avance, pasos, drawer «Cómo conseguirlo») la completa el carril C sobre este mismo archivo. Es una ruta
 * NUEVA y delgada: no reutiliza `/dashboard/arranque`, cuyas lecturas tocan recursos que el perfil niega.
 */
export default async function PaginaPuestaEnMarcha({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  return (
    <div className="p-6">
      <h1 className="font-display text-xl font-semibold">Puesta en marcha</h1>
      <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>
        Aquí vas a ver, paso por paso, qué falta para que tus agentes operen y quién tiene que resolverlo.
      </p>
    </div>
  );
}
