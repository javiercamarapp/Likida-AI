import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import {
  getHuerfanosDeFlota, traerHuerfanoPendiente, resolverHuerfanoDesdeOficina, addGasto,
} from '@/lib/likida/repo';
import { buscarViajesVivos, type OpcionViaje } from '@/lib/likida/repo_paginado';
import { acotada } from '@/lib/likida/presupuesto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { contarHuerfanosPendientes } from '@/lib/likida/repo';
import { logger } from '@/lib/logger';
import { sufijoTenant } from '../sufijo';
import { VistaHuerfanos } from './vista';

export const dynamic = 'force-dynamic';

/**
 * ¿ESTE viaje sigue vivo, y es de ESTA flota? (FE-5, 22-ago-2026)
 *
 * Antes esto se contestaba con `(await getViajes(tenantId)).some(...)`: las
 * 100 filas MÁS RECIENTES. A 50,000 viajes/mes eso son ~90 minutos, así que
 * adjuntar un comprobante a un viaje abierto de ayer contestaba "Ese viaje ya
 * no está abierto. Recarga la página." — una afirmación FALSA sobre el estado
 * del viaje, dicha con toda seguridad, sobre la que el usuario no podía hacer
 * nada (recargar no cambiaba nada). Peor todavía: la comprobación existe como
 * candado de seguridad, y un candado que depende de una ventana de tiempo no
 * es un candado.
 *
 * Ahora se pregunta por el viaje EXACTO, anclado al tenant, y se lee su
 * estatus. `null` (no se pudo leer) NO se toma por "no está vivo": se
 * distingue arriba para no acusar al viaje de algo que no se comprobó.
 */
async function viajeSigueVivo(tenantId: string, viajeId: string): Promise<boolean | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje')
    .select('estatus')
    .eq('id', viajeId)
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'huerfanos.viajeSigueVivo');
  if (error) {
    logger.error('huerfano.destino_no_verificado', { viajeId, err: error.message });
    return null;
  }
  if (!data) return false;
  const e = data.estatus as string;
  return e === 'abierto' || e === 'en_cuadre';
}

/** El gateo que ambas actions repiten adentro. Helper de módulo y no
 *  closure: una action solo captura VALORES serializables (tenantId). */
async function exigirPermiso(tenantId: string): Promise<string | null> {
  const sesion = await requireSessionTenant('/dashboard/huerfanos');
  if (!puedeVerArea(sesion.rol, 'dinero')) return 'Tu rol no puede resolver comprobantes.';
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return 'Esta bandeja no es de tu flota.';
  return null;
}

/**
 * Comprobantes sin viaje (F2 del plan) — la bandeja de la OFICINA para lo
 * que "una foto NUNCA se rechaza" dejó en el limbo: el chofer mandó un
 * comprobante sin viaje abierto (o después de liquidar, o el OCR se cayó) y
 * alguien tiene que acomodarlo o descartarlo.
 *
 * El adjuntar sigue EL MISMO ORDEN que el flujo de WhatsApp (processor):
 * primero `addGasto` al viaje, DESPUÉS se resuelve la fila. Si el insert
 * falla a medias, queda una fila todavía pendiente — nunca un comprobante
 * marcado como puesto que no está en ningún lado.
 *
 * SIN FOTOS a propósito: exhibir el comprobante a un humano tiene candado
 * legal propio (LFPDPPP art. 8, decisión del 2-ago); aquí viaja el dato
 * extraído, no la imagen.
 */
export default async function PaginaHuerfanos({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/huerfanos', sp);
  if (!puedeVerRuta(rol, '/dashboard/huerfanos')) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  // Primarios sin catch: bandeja ciega = página caída, no "no hay sueltos".
  // El CONTEO va aparte y sí degrada (`null`): sirve para rotular "200 de N",
  // y no poder contar no puede tumbar la bandeja (FE-13).
  const [pendientes, hayViajesVivosRes, totalPendientes] = await Promise.all([
    getHuerfanosDeFlota(tenantId),
    // FE-3: ya NO se trae la lista completa de viajes vivos (antes
    // `getViajes(tenantId)`, 100 más recientes) para armar el `<select>` —
    // solo se pregunta SI hay alguno, con `count exact, head` (cero filas de
    // vuelta). El combo de la fila (`buscarViajeAccion`, abajo) le pregunta
    // al servidor por folio/operador cuando el humano escribe.
    acotada(supabaseAdmin()
      .from('viaje').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).in('estatus', ['abierto', 'en_cuadre']), 'huerfanos.hay_viajes_vivos'),
    contarHuerfanosPendientes(tenantId),
  ]);
  // Un conteo caído no puede esconder el botón de adjuntar (sería fallar
  // "cerrado" en el sentido incorrecto: negar una acción legítima por una
  // lectura que ni siquiera es la de seguridad — esa vive en
  // `viajeSigueVivo`, dentro de la action). Se asume que SÍ hay, y el
  // combo dice por su cuenta si no encuentra nada al buscar.
  const hayViajesVivos = hayViajesVivosRes.error ? true : (hayViajesVivosRes.count ?? 0) > 0;
  if (hayViajesVivosRes.error) {
    logger.warn('huerfanos.conteo_viajes_vivos', { tenantId, err: hayViajesVivosRes.error.message });
  }

  async function adjuntar(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const negado = await exigirPermiso(tenantId);
    if (negado) return { error: negado };

    const huerfanoId = typeof fd.get('huerfanoId') === 'string' ? (fd.get('huerfanoId') as string).trim().slice(0, 64) : '';
    const viajeId = typeof fd.get('viajeId') === 'string' ? (fd.get('viajeId') as string).trim().slice(0, 64) : '';
    if (!huerfanoId) return { error: 'Falta el comprobante.' };
    if (!viajeId) return { error: 'Elige el viaje al que va.' };

    const h = await traerHuerfanoPendiente(tenantId, huerfanoId);
    if (!h) return { error: 'Ese comprobante ya no está pendiente — alguien más lo resolvió. Recarga la página.' };

    // El guardia que el flujo gemelo de WhatsApp ya tiene (processor solo
    // ofrece lo que trae monto): un fallo de OCR guarda el huérfano con
    // monto 0, y adjuntarlo metería una línea de $0.00 —una cifra que nadie
    // midió— en la liquidación del contralor. Number() porque `gasto` es una
    // columna JSON: un monto ausente o raro también se rebota.
    if (!(Number(h.gasto.monto) > 0)) {
      return { error: 'Ese comprobante no trae monto legible — pídele al chofer que reenvíe la foto; adjuntarlo metería $0.00 a la liquidación.' };
    }

    // El viaje destino se re-verifica ADENTRO (un viajeId ajeno o liquidado
    // no pasa), no se confía en que venía del <select>. Se pregunta POR ESE
    // VIAJE, no por los 100 más recientes — ver `viajeSigueVivo`.
    const destinoOk = await viajeSigueVivo(tenantId, viajeId);
    if (destinoOk === null) {
      return { error: 'No se pudo comprobar el viaje destino ahora mismo — inténtalo de nuevo.' };
    }
    if (!destinoOk) return { error: 'Ese viaje ya no está abierto. Recarga la página.' };

    try {
      await addGasto(tenantId, viajeId, h.gasto);
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === '23505') {
        // El gasto YA vive en algún viaje (misma foto, mismo id). No se
        // resuelve como adjuntado a ESTE viaje: sería un rótulo falso.
        return { error: 'Ese comprobante ya vive en un viaje — si aquí sobra, descártalo.' };
      }
      logger.error('huerfano.oficina_adjuntar_fallo', { huerfanoId, err: e instanceof Error ? e.message : String(e) });
      return { error: 'No se pudo adjuntar. Inténtalo de nuevo.' };
    }

    const r = await resolverHuerfanoDesdeOficina(tenantId, huerfanoId, 'adjuntado', viajeId);
    if (r.error) return { error: r.error };
    logger.info('huerfano.oficina_adjuntado', { tenantId, huerfanoId, viajeId });
    redirect(`/dashboard/huerfanos${sufijo}`);
  }

  async function descartar(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const negado = await exigirPermiso(tenantId);
    if (negado) return { error: negado };

    const huerfanoId = typeof fd.get('huerfanoId') === 'string' ? (fd.get('huerfanoId') as string).trim().slice(0, 64) : '';
    if (!huerfanoId) return { error: 'Falta el comprobante.' };

    const r = await resolverHuerfanoDesdeOficina(tenantId, huerfanoId, 'descartado', null);
    if (r.error) return { error: r.error };
    logger.info('huerfano.oficina_descartado', { tenantId, huerfanoId });
    redirect(`/dashboard/huerfanos${sufijo}`);
  }

  /**
   * FE-3 · El buscador del combo "Adjuntar a…" — el `tenantId` va por
   * CLOSURE (el cliente manda solo el texto), y repite el gateo completo:
   * es alcanzable por POST directo, y aunque solo devuelva folios y nombres
   * de operador, son datos de UNA flota. LANZA ante rechazo o fallo — una
   * lista vacía es la afirmación "no hay ningún viaje así", y sería falsa.
   */
  async function buscarViajeAccion(q: string): Promise<OpcionViaje[]> {
    'use server';
    const negado = await exigirPermiso(tenantId);
    if (negado) throw new Error(negado);
    try {
      return await buscarViajesVivos(tenantId, typeof q === 'string' ? q : '');
    } catch (err) {
      logger.error('huerfanos.buscar_viaje.fallo', { err: err instanceof Error ? err.message : String(err) });
      throw new Error('No se pudo buscar en los viajes vivos.');
    }
  }

  return (
    <VistaHuerfanos
      pendientes={pendientes}
      hayViajesVivos={hayViajesVivos}
      buscarViaje={buscarViajeAccion}
      totalPendientes={totalPendientes}
      acciones={{ adjuntar, descartar }}
    />
  );
}
