import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { emailDeUsuario } from '@/lib/likida/conductor/trabajo';
import { crearRepoVigia } from '@/lib/likida/vigia/repo';
import { analizarHistorial } from '@/lib/likida/vigia/historial/analisis';
import { leerClientesParaGrupo, leerGrupos, leerMensajesHistorial, leerRespuestasRapidas } from '@/lib/likida/vigia/historial/repo';
import { altaGrupoPanel, aprobarRespuestaRapidaPanel, borrarGrupoPanel, criticoGrupoPanel, importarHistorialPanel, retirarRespuestaRapidaPanel } from '@/lib/likida/vigia/historial/acciones';
import { sufijoTenant } from '../../../sufijo';
import { VistaHistorialVigia } from './vista';
import type { ResultadoGrupos } from './formas';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/vigia/historial';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Busqueda = { vista?: string; tenant?: string; rol?: string; grupo?: string };

/** Vuelve a resolver la sesión: una acción de servidor es un endpoint. A nivel de módulo (nada de closures serializadas). */
async function contexto(sp: Busqueda) {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA)) return null;
  return { tenantId: s.tenantId, rol: s.rol, usuarioId: s.userId, email: await emailDeUsuario(s.userId).catch(() => null) };
}

/**
 * Grupos de clientes (críticos o no) e histórico exportado del Vigía (0484): quién es crítico, el chat de WhatsApp que se sube y
 * el reporte de preguntas frecuentes, temas por semana y tiempos de respuesta. Cero pesos. Lo ve quien ve el Vigía; solo el
 * dueño agrega, marca, sube y borra.
 */
export default async function PaginaHistorialVigia({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const grupoElegido = sp.grupo && UUID.test(sp.grupo) ? sp.grupo : null;

  const [grupos, clientes, config, rapidas] = await Promise.all([
    leerGrupos(tenantId).catch((e) => { logger.warn('vigia.grupos_no_leidos', { err: e instanceof Error ? e.message : String(e) }); return null; }),
    leerClientesParaGrupo(tenantId).catch(() => []),
    crearRepoVigia().config(tenantId).catch(() => null),
    leerRespuestasRapidas(tenantId).catch((e) => { logger.warn('vigia.respuestas_rapidas_no_leidas', { err: e instanceof Error ? e.message : String(e) }); return null; }),
  ]);
  const umbralMin = config?.slaCriticoMin ?? 10;
  const datos = grupos === null ? null : await leerMensajesHistorial(tenantId, grupoElegido).catch((e) => { logger.warn('vigia.historial_no_leido', { err: e instanceof Error ? e.message : String(e) }); return null; });
  const reporte = datos ? analizarHistorial(datos.mensajes, { umbralMin }) : null;

  async function alta(_p: ResultadoGrupos, fd: FormData): Promise<ResultadoGrupos> {
    'use server';
    const c = await contexto(sp);
    if (!c) return { ok: false, error: 'No tienes acceso a esta pantalla.' };
    const r = await altaGrupoPanel(c, fd);
    if (r.ok) revalidatePath(RUTA);
    return r;
  }
  async function critico(_p: ResultadoGrupos, fd: FormData): Promise<ResultadoGrupos> {
    'use server';
    const c = await contexto(sp);
    if (!c) return { ok: false, error: 'No tienes acceso a esta pantalla.' };
    const r = await criticoGrupoPanel(c, fd);
    if (r.ok) revalidatePath(RUTA);
    return r;
  }
  async function borrar(_p: ResultadoGrupos, fd: FormData): Promise<ResultadoGrupos> {
    'use server';
    const c = await contexto(sp);
    if (!c) return { ok: false, error: 'No tienes acceso a esta pantalla.' };
    const r = await borrarGrupoPanel(c, fd);
    if (r.ok) revalidatePath(RUTA);
    return r;
  }
  async function aprobarRapida(_p: ResultadoGrupos, fd: FormData): Promise<ResultadoGrupos> {
    'use server';
    const c = await contexto(sp);
    if (!c) return { ok: false, error: 'No tienes acceso a esta pantalla.' };
    const r = await aprobarRespuestaRapidaPanel(c, fd);
    if (r.ok) revalidatePath(RUTA);
    return r;
  }
  async function retirarRapida(_p: ResultadoGrupos, fd: FormData): Promise<ResultadoGrupos> {
    'use server';
    const c = await contexto(sp);
    if (!c) return { ok: false, error: 'No tienes acceso a esta pantalla.' };
    const r = await retirarRespuestaRapidaPanel(c, fd);
    if (r.ok) revalidatePath(RUTA);
    return r;
  }
  async function importar(_p: ResultadoGrupos, fd: FormData): Promise<ResultadoGrupos> {
    'use server';
    const c = await contexto(sp);
    if (!c) return { ok: false, error: 'No tienes acceso a esta pantalla.' };
    const f = fd.get('archivo');
    const archivo = f instanceof File && f.size > 0 ? { nombre: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    const r = await importarHistorialPanel(c, fd, archivo);
    if (r.ok) revalidatePath(RUTA);
    return r;
  }

  return (
    <VistaHistorialVigia
      sufijo={sufijoTenant(sp)} grupos={grupos} clientes={clientes} reporte={reporte} grupoElegido={grupoElegido} truncado={datos?.truncado ?? false}
      umbralMin={umbralMin} puedeEditar={puedeAdministrar(rol)} puedeAprobar={['superadmin', 'flota_admin', 'encargado'].includes(rol)} rapidas={rapidas}
      acciones={{ alta, critico, borrar, importar, aprobarRapida, retirarRapida }}
    />
  );
}
