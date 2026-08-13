import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getPorFacturar, contarConCfdi } from '@/lib/likida/facturacion/pendientes';
import { mandatoFiscalAceptado, modoEfectivo } from '@/lib/likida/facturacion/modo';
import { VistaAgenteFacturas } from './vista';

export const dynamic = 'force-dynamic';

/**
 * Agente de Facturas — v2 (13-ago-2026: "que se entienda TODO lo que hace").
 * La puerta trae sesión y datos; el dibujo vive en `vista.tsx`, que reparte
 * la cola con la MISMA regla que el código (`enrutar.ts`): te toca a ti /
 * la máquina se encarga / incompletos.
 *
 * LO QUE ESTA PÁGINA NO AFIRMA: emisión que el modo no permite. `emite` es
 * verdad solo con FACTURACION_MODO=emitir Y el mandato aceptado (el candado
 * legal de modo.ts) — en ensayo, la vista lo dice tal cual.
 */
export default async function PaginaAgenteFacturas({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/facturas', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/facturas')) redirect('/dashboard');

  // Sin catch: base caída = página caída, no una lista vacía que afirma
  // "todo facturado" estando ciega. El contador degrada solo (null = se dice).
  const [tickets, conCfdi] = await Promise.all([
    getPorFacturar(tenantId),
    contarConCfdi(tenantId),
  ]);

  const emite = modoEfectivo(
    process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo',
    mandatoFiscalAceptado(),
  ) === 'emitir';

  return <VistaAgenteFacturas tickets={tickets} extra={{ conCfdi, emite }} />;
}
