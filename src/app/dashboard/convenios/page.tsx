import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea, puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar, puedeExportar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { MAX_ARCHIVO_BYTES } from '@/lib/likida/importacion/archivo';
import { archivarConvenioDelPanel, importarArchivoDelPanel } from '@/lib/likida/convenios/acciones';
import { ConveniosNoDisponibles, listarConvenios, type ConvenioFila } from '@/lib/likida/convenios/repo';
import { sufijoTenant } from '../sufijo';
import { VistaConvenios } from './vista';
import type { ResultadoSitio } from '../agentes/conductores/sitios/formas';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/convenios';

/**
 * Los convenios de clientes (0580): perfiles con sus instrucciones de operación, importador CSV/Excel y exportación de
 * las instrucciones para que la flota las escriba en SU sistema. La tarifa y los requisitos de cobro solo se leen (y se
 * pintan) para quien ve el área de dinero: para los demás ni siquiera se consultan.
 */
export default async function PaginaConvenios({ searchParams }: { searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }> }) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const verDinero = puedeVerArea(rol, 'dinero');

  let convenios: ConvenioFila[] | null = null;
  let estado: 'ok' | 'no_disponible' | 'error' = 'ok';
  try {
    convenios = await listarConvenios(tenantId, { conFinanzas: verDinero });
  } catch (e) {
    if (e instanceof ConveniosNoDisponibles) estado = 'no_disponible';
    else { estado = 'error'; logger.warn('convenios.no_leidos', { tenantId, err: e instanceof Error ? e.message : String(e) }); }
  }

  async function accionImportar(_p: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico editan los convenios.' };
    const archivo = fd.get('archivo');
    let bytes: ArrayBuffer | null = null;
    if (archivo instanceof File && archivo.size > 0) {
      if (archivo.size > MAX_ARCHIVO_BYTES) return { ok: false, error: 'El archivo pesa más de 4 MB: divídelo en partes.' };
      bytes = await archivo.arrayBuffer();
    }
    const texto = typeof fd.get('csv') === 'string' ? (fd.get('csv') as string) : '';
    const r = await importarArchivoDelPanel({ tenantId: s.tenantId, rol: s.rol }, { bytes, texto });
    if (r.ok) revalidatePath(RUTA);
    return r;
  }

  async function accionEstado(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return;
    await archivarConvenioDelPanel({ tenantId: s.tenantId, rol: s.rol }, String(fd.get('id') ?? ''), fd.get('activo') === 'si');
    revalidatePath(RUTA);
  }

  return (
    <VistaConvenios
      sufijo={sufijoTenant(sp)} convenios={convenios} estado={estado} puedeEditar={puedeAsignar(rol)} verDinero={verDinero}
      puedeExportar={puedeExportar(rol)} accionImportar={accionImportar} accionEstado={accionEstado}
    />
  );
}
