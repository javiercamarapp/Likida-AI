import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { filasDeCatalogo } from '@/lib/likida/carta_porte_docs/catalogo_pantalla';
import { sufijoTenant } from '../../../sufijo';
import { guardarFilaCatalogo, importarCatalogoCsv } from './actions';
import { VistaCatalogo, type CatalogoVista, type ClienteVista } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/carta-porte/catalogo';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El catálogo del cliente del Agente de Carta Porte (T-A3-22). Gatea con su propia llave (`RUTA`), clasificada en el
 * perfil `cinco_agentes`: un tenant con perfil que no la tenga en la lista rebota al panel. Las filas se leen SIEMPRE
 * con el tenant de la sesión y el cliente que ese tenant tiene; un `?cliente=` ajeno o inventado no encuentra nada.
 */
export default async function PaginaCatalogoCliente({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; cliente?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Sin clientes legibles no hay nada que mostrar con honestidad: lanza (error boundary), no finge «sin clientes».
  const clientes: ClienteVista[] = await repo.listarClientes(tenantId);
  const pedido = typeof sp.cliente === 'string' && UUID.test(sp.cliente) ? sp.cliente.toLowerCase() : null;
  const elegido = clientes.find((c) => c.id.toLowerCase() === pedido) ?? (clientes.length === 1 ? clientes[0] : null);

  let catalogo: CatalogoVista | null = null;
  let lecturaFallida = false;
  if (elegido) {
    try {
      const c = await repo.cargarCatalogoCliente(tenantId, elegido.id);
      catalogo = { ...filasDeCatalogo(c), truncado: c.truncado === true };
    } catch (e) {
      lecturaFallida = true;
      logger.error('carta_porte_docs.catalogo_pantalla', { tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <VistaCatalogo
      clientes={clientes}
      clienteId={elegido?.id ?? null}
      catalogo={catalogo}
      lecturaFallida={lecturaFallida}
      sufijo={sufijoTenant(sp)}
      ver={{ ...(sp.tenant ? { tenant: sp.tenant } : {}), ...(sp.rol ? { rol: sp.rol } : {}), ...(sp.vista ? { vista: sp.vista } : {}) }}
      acciones={{ guardarFila: guardarFilaCatalogo, importar: importarCatalogoCsv }}
    />
  );
}
