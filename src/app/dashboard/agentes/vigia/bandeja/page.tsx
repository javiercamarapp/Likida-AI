import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { ahoraMs } from '@/lib/saludo';
import { cargarTablero, cargarHiloConversacion, type MensajeHilo } from '@/lib/likida/vigia/repo';
import { filtrosDeUrl } from '@/lib/likida/vigia/bandeja_atencion';
import { getT } from '@/lib/i18n/servidor';
import { vigilar } from '../../../bloque';
import { VistaBandeja } from './vista';
import { ejecutarConversacion, ejecutarDecidir } from './ejecutar';
import type { ResultadoVigia } from '../controles';
import type { Metadata } from 'next';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT('agentes')).t('bj.page.titulo') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/vigia/bandeja';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quien decide por los clientes: el dueño y el encargado (igual que el panel del Vigía). El resto solo mira. */
const DECIDE = ['flota_admin', 'encargado'];

type Busqueda = { vista?: string; tenant?: string; rol?: string; chat?: string; estado?: string; prioridad?: string; cliente?: string };

/** Vuelve a resolver la sesión desde la cookie y devuelve el actor si su rol decide. A nivel de módulo (las acciones no cierran sobre funciones locales). */
async function actor(sp: Busqueda, tenantId: string) {
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerRuta(s.rol, RUTA) || !DECIDE.includes(s.rol)) return null;
  return { tenantId: s.tenantId, userId: s.userId };
}

async function leerHilo(tenantId: string, id: string): Promise<MensajeHilo[] | 'error'> {
  try {
    return await cargarHiloConversacion(tenantId, id);
  } catch (e) {
    logger.warn('vigia.bandeja_hilo_no_leido', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return 'error';
  }
}

/**
 * La bandeja de atención del Vigía: los chats con clientes divididos por prioridad, quién los contesta, cuánto llevan sin respuesta y el
 * hilo completo de cada uno. Lee lo mismo que el panel (`cargarTablero`) y el hilo de la conversación abierta. Las acciones son las del
 * panel (aprobar, tomar, responder): cada una vuelve a resolver sesión, rol y flota desde la cookie y nunca acepta un `tenant_id` del cliente.
 */
export default async function PaginaBandeja({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const tr = await getT('agentes');
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const datos = vigilar(cargarTablero(tenantId));
  const chat = sp.chat && UUID.test(sp.chat) ? sp.chat : null;
  // El hilo solo se lee si la conversación es de la flota y está activa (cargarTablero ya filtra por tenant).
  const hilo = vigilar(datos.then((d) => (chat && d.conversaciones.some((c) => c.id === chat) ? leerHilo(tenantId, chat) : null)));

  async function decidir(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId);
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_o_el_encargado_5') };
    const r = await ejecutarDecidir(a, fd, tx);
    revalidatePath(RUTA);
    return r;
  }

  async function conversacion(_p: ResultadoVigia, fd: FormData): Promise<ResultadoVigia> {
    'use server';
    const { t: tx } = await getT('agentes');
    const a = await actor(sp, tenantId);
    if (!a) return { ok: false, error: tx('rest.solo_el_dueno_o_el_encargado_5') };
    const r = await ejecutarConversacion(a, fd, tx);
    revalidatePath(RUTA);
    return r;
  }

  return (
    <VistaBandeja
        tr={tr} datos={datos} hilo={hilo} chat={chat} filtros={filtrosDeUrl(sp)} ahoraMs={ahoraMs()}
        puedeDecidir={DECIDE.includes(rol)} acciones={{ decidir, conversacion }}
        ocultos={[...(sp.tenant ? [['tenant', sp.tenant] as const] : []), ...(sp.vista ? [['vista', sp.vista] as const] : []), ...(sp.rol ? [['rol', sp.rol] as const] : [])]}
    />
  );
}
