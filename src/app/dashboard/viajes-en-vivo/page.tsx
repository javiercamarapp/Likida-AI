import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar } from '@/lib/auth/permisos';
import { fuentes } from '@/lib/likida/orquestador/fuentes';
import '@/lib/likida/orquestador/fuentes_reales';
import { limpiarResumen } from '@/lib/likida/orquestador/escalamiento';
import { armarTableroViajes } from '@/lib/likida/orquestador/tablero_viajes';
import { logger } from '@/lib/logger';
import { ahoraMs } from '@/lib/saludo';
import { TareasAbiertas, VistaViajesEnVivo } from './vista';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUTA = '/dashboard/viajes-en-vivo';

/**
 * El tablero de VIAJES EN VIVO (Ola 3b, orquestador): todos los viajes en curso con su último hito del
 * Conductor, la posición del tractor y su antigüedad, y las excepciones que piden a una persona. Más las
 * tareas que el asistente de la pestaña de chat dejó abiertas para una persona.
 *
 * Área `operacion` (el jefe de tráfico): CERO pesos. Los filtros por terminal y cliente se validan contra el
 * CATÁLOGO de la flota (un id que no está en él se ignora: ningún valor de la URL llega a una consulta).
 * Es el mismo modelo (`armarTableroViajes`) que lee la herramienta `tablero_viajes` del asistente.
 */
export default async function PaginaViajesEnVivo({ searchParams }: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; terminal?: string; cliente?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const ahora = new Date(ahoraMs());
  const entrada = await fuentes().entradaTablero(tenantId, ahora);
  const terminalId = sp.terminal && UUID.test(sp.terminal) && entrada.terminales.some((t) => t.id === sp.terminal) ? sp.terminal : '';
  const clienteId = sp.cliente && UUID.test(sp.cliente) && entrada.clientes.some((c) => c.id === sp.cliente) ? sp.cliente : '';
  const soloExcepciones = sp.vista === 'excepciones';
  const tablero = armarTableroViajes({ ...entrada, filtros: { terminalId: terminalId || null, clienteId: clienteId || null, soloExcepciones } });
  const tareas = await fuentes().escalacionesAbiertas(tenantId, 20).catch((e) => {
    logger.warn('viajes_en_vivo.tareas_sin_leer', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return null;
  });

  const ocultos: Record<string, string> = {};
  if (sp.tenant) ocultos.tenant = sp.tenant;
  if (sp.rol) ocultos.rol = sp.rol;
  const puedeAtender = puedeAsignar(rol);

  async function atender(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    // Dos candados: la ruta y la acción (una acción de servidor es un endpoint, no un botón).
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return;
    const id = String(fd.get('id') ?? '');
    if (!UUID.test(id)) return;
    await fuentes().atenderEscalacion(s.tenantId, id, { usuarioId: s.userId, nota: limpiarResumen(String(fd.get('nota') ?? '')) || null });
    revalidatePath(RUTA);
  }

  return (
    <main className="p-4 md:p-6">
      <VistaViajesEnVivo
        tablero={tablero}
        filtros={{ terminalId, clienteId, soloExcepciones }}
        catalogo={{ terminales: entrada.terminales, clientes: entrada.clientes }}
        accionUrl={RUTA}
        ocultos={ocultos}
        hrefMapa="/dashboard/mapa"
        tareas={<TareasAbiertas tareas={tareas} accion={puedeAtender ? atender : null} ocultos={ocultos} />}
      />
    </main>
  );
}
