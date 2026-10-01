import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { MAX_BYTES_CSV_SITIOS } from '@/lib/likida/conductor/sitios';
import { archivarSitioDelPanel, guardarSitioDelPanel, importarCsvDelPanel } from '@/lib/likida/conductor/acciones_sitios';
import { listarSitios, leerCatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { sufijoTenant } from '../../../sufijo';
import { VistaSitios } from './vista';
import type { ResultadoSitio } from './formas';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/conductores/sitios';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El catálogo de sitios del Agente 5 (0385): clientes, plantas y andenes con su centro y su radio — contra
 * ellos se valida cada «ya llegué». Editor mínimo + importador CSV todo-o-nada. Cero pesos en pantalla.
 */
export default async function PaginaSitios({ searchParams }: { searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; q?: string; editar?: string }> }) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const puedeEditar = puedeAsignar(rol);
  const busqueda = (sp.q ?? '').slice(0, 60);

  const [lista, catalogos] = await Promise.all([
    listarSitios(tenantId, { busqueda }).catch((e) => { logger.warn('sitios.no_leidos', { tenantId, err: e instanceof Error ? e.message : String(e) }); return null; }),
    leerCatalogosFiltro(tenantId).catch(() => null),
  ]);
  const editarId = sp.editar && UUID.test(sp.editar) ? sp.editar.toLowerCase() : null;
  const editando = editarId ? (lista?.sitios.find((s) => s.id === editarId) ?? null) : null;

  const aResultado = (r: Awaited<ReturnType<typeof guardarSitioDelPanel>>): ResultadoSitio => r;

  async function accionGuardar(_p: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico editan el catálogo.' };
    const r = aResultado(await guardarSitioDelPanel({ tenantId: s.tenantId, rol: s.rol }, fd));
    if (r?.ok) revalidatePath(RUTA);
    return r;
  }

  async function accionImportar(_p: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico importan sitios.' };
    const archivo = fd.get('archivo');
    let texto = '';
    if (archivo instanceof File && archivo.size > 0) {
      if (archivo.size > MAX_BYTES_CSV_SITIOS) return { ok: false, error: 'El archivo pesa más de 1 MB; divídelo en partes.' };
      texto = await archivo.text();
    } else if (typeof fd.get('csv') === 'string') texto = fd.get('csv') as string;
    const dTxt = typeof fd.get('radio_defecto') === 'string' ? (fd.get('radio_defecto') as string).trim() : '';
    const r = aResultado(await importarCsvDelPanel({ tenantId: s.tenantId, rol: s.rol }, { texto, radioDefecto: /^\d+$/.test(dTxt) ? Number(dTxt) : null }));
    if (r?.ok) revalidatePath(RUTA);
    return r;
  }

  async function accionEstado(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return;
    await archivarSitioDelPanel({ tenantId: s.tenantId, rol: s.rol }, String(fd.get('id') ?? ''), fd.get('activa') === 'si');
    revalidatePath(RUTA);
  }

  return (
    <VistaSitios
      sufijo={sufijoTenant(sp)} sitios={lista?.sitios ?? null} hayMas={lista?.hayMas ?? false} clientes={catalogos?.clientes ?? []}
      puedeEditar={puedeEditar} editando={editando} busqueda={busqueda}
      accionGuardar={accionGuardar} accionImportar={accionImportar} accionEstado={accionEstado}
    />
  );
}
