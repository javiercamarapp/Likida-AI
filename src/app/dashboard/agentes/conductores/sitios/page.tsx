import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { leerSitioManual, parsearCsvSitios, MAX_BYTES_CSV_SITIOS } from '@/lib/likida/conductor/sitios';
import { cambiarEstadoSitio, guardarSitio, importarSitios, listarSitios, leerCatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
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

  async function accionGuardar(_p: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico editan el catálogo.' };
    const leido = leerSitioManual(fd);
    if ('error' in leido) return { ok: false, error: leido.error };
    try {
      const r = await guardarSitio(s.tenantId, leido.ok);
      if (r === 'duplicado') return { ok: false, error: 'Ya existe un sitio con ese nombre o ese código en tu flota.' };
      if (r === 'referencia_ajena') return { ok: false, error: 'El cliente o el sitio padre elegido no es de tu flota.' };
      if (r === 'no_encontrado') return { ok: false, error: 'Ese sitio ya no existe.' };
      if (r === 'datos_invalidos') return { ok: false, error: 'La base rechazó los datos: revisa coordenadas y radio.' };
      revalidatePath(RUTA);
      return { ok: true, mensaje: leido.ok.id ? 'Sitio actualizado.' : 'Sitio creado.' };
    } catch (e) {
      logger.error('sitios.guardar_fallo', { err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: 'No pude guardarlo ahorita. Intenta de nuevo en un momento.' };
    }
  }

  async function accionImportar(_p: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico importan sitios.' };
    const archivo = fd.get('archivo');
    let texto = '';
    if (archivo instanceof File && archivo.size > 0) {
      if (archivo.size > MAX_BYTES_CSV_SITIOS) return { ok: false, error: 'El archivo pesa más de 1 MB; divídelo en partes.' };
      texto = await archivo.text();
    } else if (typeof fd.get('csv') === 'string') texto = fd.get('csv') as string;
    const defecto = typeof fd.get('radio_defecto') === 'string' && /^\d+$/.test((fd.get('radio_defecto') as string).trim()) ? Number((fd.get('radio_defecto') as string).trim()) : null;
    const parseado = parsearCsvSitios(texto, { radioPorDefectoM: defecto });
    if (parseado.errores.length > 0) {
      return {
        ok: false, error: `No se importó nada: ${parseado.errores.length} problema${parseado.errores.length === 1 ? '' : 's'} en el archivo.`,
        detalles: parseado.errores.slice(0, 30).map((e) => (e.linea > 0 ? `Línea ${e.linea}: ${e.mensaje}` : e.mensaje)),
      };
    }
    try {
      const r = await importarSitios(s.tenantId, parseado.filas);
      if (!r.ok) {
        return { ok: false, error: 'No se importó nada: revisa estos puntos.', detalles: r.errores.slice(0, 30).map((e) => `Línea ${e.linea}: ${e.mensaje}`) };
      }
      revalidatePath(RUTA);
      return { ok: true, mensaje: `Importado: ${r.creados} nuevo${r.creados === 1 ? '' : 's'} y ${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'}.` };
    } catch (e) {
      logger.error('sitios.importar_fallo', { err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: 'No pude importar ahorita. No se guardó nada; intenta de nuevo en un momento.' };
    }
  }

  async function accionEstado(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return;
    const id = String(fd.get('id') ?? '');
    if (!UUID.test(id)) return;
    await cambiarEstadoSitio(s.tenantId, id.toLowerCase(), fd.get('activa') === 'si').catch((e) => logger.error('sitios.estado_fallo', { err: e instanceof Error ? e.message : String(e) }));
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
