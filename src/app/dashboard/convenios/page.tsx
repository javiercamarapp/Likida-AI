import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea, puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar, puedeExportar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { MAX_ARCHIVO_BYTES } from '@/lib/likida/importacion/archivo';
import { archivarConvenioDelPanel, corregirConvenioDelViajeDelPanel, guardarConvenioDelPanel, importarArchivoDelPanel } from '@/lib/likida/convenios/acciones';
import { ConveniosNoDisponibles, listarCatalogosConvenio, listarConvenios, listarViajesConConvenio, type CatalogosConvenio, type ConvenioFila, type ViajeConvenioFila } from '@/lib/likida/convenios/repo';
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

  // Los viajes en curso con su convenio ligado (solo quien edita convenios lo ve). Un fallo aquí no tira el resto de la pantalla.
  let viajes: ViajeConvenioFila[] | null = null;
  if (estado === 'ok' && puedeAsignar(rol)) {
    try { viajes = await listarViajesConConvenio(tenantId); } catch (e) {
      logger.warn('convenios.viajes_no_leidos', { tenantId, err: e instanceof Error ? e.message : String(e) });
    }
  }

  // Lo que el formulario de alta/edición ofrece elegir (solo para quien edita). Un fallo aquí apaga la edición, no la pantalla.
  let catalogos: CatalogosConvenio | null = null;
  if (estado === 'ok' && puedeAsignar(rol)) {
    try { catalogos = await listarCatalogosConvenio(tenantId); } catch (e) {
      logger.warn('convenios.catalogos_no_leidos', { tenantId, err: e instanceof Error ? e.message : String(e) });
    }
  }

  async function accionGuardar(_p: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico editan los convenios.' };
    const campo = (k: string): string => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');
    const categorias = fd.getAll('ins_categoria'), textos = fd.getAll('ins_texto'), momentos = fd.getAll('ins_momento'), lugares = fd.getAll('ins_lugar');
    const texto = (v: FormDataEntryValue | undefined): string => (typeof v === 'string' ? v : '');
    const instrucciones: Array<{ categoria: string; texto: string; momento: string; lugar: string }> = [];
    for (let i = 0; i < Math.min(textos.length, 60); i++) instrucciones.push({ categoria: texto(categorias[i]), texto: texto(textos[i]), momento: texto(momentos[i]), lugar: texto(lugares[i]) });
    const r = await guardarConvenioDelPanel({ tenantId: s.tenantId, rol: s.rol }, {
      convenioId: campo('convenioId'), clienteId: campo('clienteId'), nombre: campo('nombre'), origen: campo('origen'), destino: campo('destino'),
      sitioOrigenId: campo('sitioOrigenId'), sitioDestinoId: campo('sitioDestinoId'), vigenteDesde: campo('vigenteDesde'), vigenteHasta: campo('vigenteHasta'),
      notas: campo('notas'), version: campo('version'),
      instrucciones,
      llevarAViajes: campo('llevarAViajes') === 'si', reenviar: campo('reenviar') === 'si',
    });
    if (r.ok) revalidatePath(RUTA);
    return r;
  }

  async function accionCorregir(_p: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico editan los convenios.' };
    const campo = (k: string): string => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');
    const r = await corregirConvenioDelViajeDelPanel({ tenantId: s.tenantId, rol: s.rol }, { viajeId: campo('viajeId'), convenioId: campo('convenioId'), reenviar: campo('reenviar') === 'si' });
    if (r.ok) revalidatePath(RUTA);
    return r;
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
      viajes={viajes} accionCorregir={accionCorregir} catalogos={catalogos} accionGuardar={accionGuardar}
    />
  );
}
