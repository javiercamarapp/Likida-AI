import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import {
  getHuerfanosDeFlota, traerHuerfanoPendiente, resolverHuerfanoDesdeOficina, addGasto,
} from '@/lib/likida/repo';
import { getViajes } from '@/lib/likida/analytics';
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
  const [pendientes, viajes, totalPendientes] = await Promise.all([
    getHuerfanosDeFlota(tenantId),
    getViajes(tenantId),
    contarHuerfanosPendientes(tenantId),
  ]);

  // A dónde se puede adjuntar: solo viajes VIVOS. Un gasto a un viaje
  // liquidado lo rebota el trigger de la 0037 — mejor no ofrecerlo.
  const viajesVivos = viajes
    .filter((v) => v.estatus === 'abierto' || v.estatus === 'en_cuadre')
    .map((v) => ({
      id: v.id,
      rotulo: `${v.folio}${v.operadorNombre ? ` · ${v.operadorNombre}` : ''}`,
    }));

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

  return (
    <VistaHuerfanos
      pendientes={pendientes}
      viajesVivos={viajesVivos}
      cargados={viajes.length}
      totalPendientes={totalPendientes}
      acciones={{ adjuntar, descartar }}
    />
  );
}
