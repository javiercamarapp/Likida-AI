import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { getPorFacturar, contarConCfdi, validarUuidCfdi } from '@/lib/likida/facturacion/pendientes';
import { mandatoFiscalAceptado, modoEfectivo } from '@/lib/likida/facturacion/modo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { VistaAgenteFacturas } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';
import { FichaCorridas } from '../ficha-corridas';
import { ultimasCorridas } from '@/lib/likida/agentes/corridas';

export const dynamic = 'force-dynamic';

/**
 * Agente de Facturas — v2 (13-ago-2026: "que se entienda TODO lo que hace"
 * + "quiero que todas las funcionalidades ya estén configuradas"). La
 * puerta trae sesión, datos y LA ACCIÓN del jefe: capturar el folio fiscal
 * cuando facturó él mismo, que saca el ticket de la cola de verdad.
 *
 * LO QUE ESTA PÁGINA NO AFIRMA: emisión que el modo no permite. `emite` es
 * verdad solo con FACTURACION_MODO=emitir Y el mandato aceptado (candado
 * legal de modo.ts) — en ensayo, la vista lo dice tal cual.
 */
export default async function PaginaAgenteFacturas({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/facturas', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/facturas')) redirect('/dashboard');

  const base = sp.tenant ? `?tenant=${sp.tenant}` : sp.vista ? `?vista=${sp.vista}` : '';
  const sufijo = sp.rol ? `${base}${base ? '&' : '?'}rol=${sp.rol}` : base;

  // Sin catch: base caída = página caída, no una lista vacía que afirma
  // "todo facturado" estando ciega. El contador degrada solo (null = se dice).
  const [tickets, conCfdi, corridas] = await Promise.all([
    getPorFacturar(tenantId),
    contarConCfdi(tenantId),
    // La ficha de corridas (B3): null = no se pudo leer, y la ficha lo dice.
    ultimasCorridas(tenantId, 'facturas').catch(() => null),
  ]);

  const emite = modoEfectivo(
    process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo',
    mandatoFiscalAceptado(),
  ) === 'emitir';

  async function marcarFacturada(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    // EL CHEQUEO SE REPITE ADENTRO (patrón del repo): esta action es
    // alcanzable por POST directo y re-verifica sesión y permiso. El tenant
    // viaja por CLOSURE del render — el cliente no lo manda ni lo elige — y
    // aun así se cruza contra el de la sesión.
    const sesion = await requireSessionTenant('/dashboard/agentes/facturas');
    if (!puedeVerArea(sesion.rol, 'dinero')) {
      return { error: 'Tu rol no puede capturar facturas.' };
    }
    if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) {
      return { error: 'Esta cola no es de tu flota.' };
    }

    const crudoId = fd.get('gastoId');
    const gastoId = typeof crudoId === 'string' ? crudoId.trim().slice(0, 64) : '';
    const uuid = validarUuidCfdi(fd.get('uuid'));
    if (!gastoId) return { error: 'Falta el ticket.' };
    if (!uuid) {
      return { error: 'Ese folio no tiene la forma del UUID que imprime el portal (36 caracteres con guiones).' };
    }

    // Anclado a tenant Y a cfdi_uuid nulo: no se pisa una factura ya
    // amarrada, y un gastoId ajeno simplemente no encuentra fila.
    const { data, error } = await supabaseAdmin()
      .from('gasto')
      .update({ cfdi_uuid: uuid, cfdi_orden: 1 })
      .eq('id', gastoId)
      .eq('tenant_id', tenantId)
      .is('cfdi_uuid', null)
      .select('id');
    if (error) {
      // El índice único (tenant, uuid, orden) atrapa el folio repetido.
      if (error.code === '23505') {
        return { error: 'Ese folio fiscal ya está amarrado a otro ticket de la flota — revisa el CFDI.' };
      }
      logger.error('facturas.marcar.fallo', { gastoId, err: error.message });
      return { error: 'No se pudo guardar. Inténtalo de nuevo.' };
    }
    if (!data || data.length === 0) {
      return { error: 'Ese ticket ya no está en la cola (¿ya tenía factura?). Recarga la página.' };
    }
    logger.info('facturas.marcada_a_mano', { tenantId, gastoId });
    redirect(`/dashboard/agentes/facturas${sufijo}`);
  }

  return (
    <VistaAgenteFacturas
      tickets={tickets}
      extra={{ conCfdi, emite }}
      marcarFacturada={marcarFacturada}
      notificaciones={
        <>
          <FichaCorridas corridas={corridas} />
          <SeccionNotificaciones tenantId={tenantId} agenteId="facturas" />
        </>
      }
    />
  );
}
