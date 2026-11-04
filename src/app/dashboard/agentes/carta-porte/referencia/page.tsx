import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { firmarFlotaPintada } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { flotaBajoPerfil } from '@/lib/likida/carta_porte_docs/envio';
import { cargarInsumosReferencia, type InsumosReferencia } from '@/lib/likida/carta_porte_docs/referencia_cliente_puerto';
import { tableroReferenciasPendientes } from '@/lib/likida/carta_porte_docs/referencia_cliente';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { sufijoTenant } from '../../../sufijo';
import { capturarReferencia, cambiarExigencia } from './actions';
import { VistaReferencia } from './vista';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Referencia del cliente' };

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/carta-porte/referencia';

/**
 * La referencia comercial del cliente (T-A3-65): pendientes por cliente que la exige, con captura. Es informativa: nada de aquí
 * bloquea un viaje ni un timbrado. Si la lectura falla se dice (no se pinta «sin pendientes»).
 */
export default async function PaginaReferencia({ searchParams }: { searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }> }) {
  const sp = await searchParams;
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA, sp);
  // MX-002: la flota que pinta esta pantalla, firmada, viaja en un campo oculto; las acciones escriben solo en ella.
  const flotaPintada = firmarFlotaPintada(tenantId, userId);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  let insumos: InsumosReferencia | null = null;
  try { insumos = await cargarInsumosReferencia(tenantId, { viajesDelTms: await flotaBajoPerfil(tenantId) }); }
  catch (e) { logger.error('carta_porte_docs.referencia_pantalla', { tenantId, error: e instanceof Error ? e.message : String(e) }); }

  const tablero = insumos ? tableroReferenciasPendientes(insumos.viajes, insumos.reglas, insumos.clientes, new Date()) : null;
  const foliosViaje = new Map<string, string | null>();
  if (tablero) {
    for (const c of tablero.clientes) for (const v of c.viajes.slice(0, 50)) {
      try { foliosViaje.set(v.viajeId, (await repo.viajePorId(tenantId, v.viajeId))?.folio ?? null); } catch { foliosViaje.set(v.viajeId, null); }
    }
  }
  return (
    <VistaReferencia
      tablero={tablero}
      clientes={insumos?.clientes ?? []}
      exigen={new Set((insumos?.reglas ?? []).filter((r) => r.exige).map((r) => r.clienteId))}
      folios={Object.fromEntries(foliosViaje)}
      truncado={insumos?.truncado === true}
      sufijo={sufijoTenant(sp)}
      ver={{ ...(sp.tenant ? { tenant: sp.tenant } : {}), ...(sp.rol ? { rol: sp.rol } : {}), ...(sp.vista ? { vista: sp.vista } : {}), ...(flotaPintada ? { flota: flotaPintada } : {}) }}
      acciones={{ capturar: capturarReferencia, exigencia: cambiarExigencia }}
    />
  );
}
