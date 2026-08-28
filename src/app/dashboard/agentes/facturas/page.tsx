import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { getPorFacturar, contarConCfdi, validarUuidCfdi } from '@/lib/likida/facturacion/pendientes';
import { mandatoFiscalAceptado, modoEfectivo } from '@/lib/likida/facturacion/modo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { PORTALES_CONOCIDOS } from '@/lib/likida/facturacion/adaptadores/registro';
import { COMERCIOS } from '@/lib/likida/facturacion/comercios';
import { vinculosDePortales } from '@/lib/likida/facturacion/vinculo_portal';
import { autorizarRelogin, permisosDeRelogin, revocarRelogin } from '@/lib/likida/facturacion/relogin_portal';
import { revalidatePath } from 'next/cache';
import type { FilaPortal } from './portales-vinculo';
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
  const [tickets, conCfdi, corridas, vinculos, permisos] = await Promise.all([
    getPorFacturar(tenantId),
    contarConCfdi(tenantId),
    // La ficha de corridas (B3): null = no se pudo leer, y la ficha lo dice.
    ultimasCorridas(tenantId, 'facturas').catch(() => null),
    // El estado del vínculo por portal. `null` = no se pudo leer, y la sección
    // lo dice tal cual: pintar «sin vincular» sobre una lectura caída mandaría
    // al contralor a re-vincular portales que están bien.
    vinculosDePortales(tenantId),
    // El permiso de re-login automático (0233). Misma regla: `null` = ciego,
    // y los controles lo dicen en vez de enseñar la casilla desmarcada — que
    // invitaría a re-autorizar algo que ya está autorizado.
    permisosDeRelogin(tenantId),
  ]);

  // Los portales que ESTA pantalla enseña: los del catálogo que piden cuenta,
  // más cualquiera que ya tenga un vínculo anotado (un portal sin cuenta puede
  // haber vinculado sesión de todos modos). Se deriva del catálogo y del
  // estado — nunca de una lista escrita a mano, que es la que se desincroniza.
  const conVinculo = new Set(vinculos?.keys() ?? []);
  const portales: FilaPortal[] = COMERCIOS
    .filter((c) => c.requiereCuenta || conVinculo.has(c.clave))
    .map((c) => {
      const v = vinculos?.get(c.clave);
      const p = permisos?.get(c.clave);
      return {
        clave: c.clave,
        nombre: c.nombre,
        portal: c.portal,
        // Sin fila = sin vincular. Es lo que dice la 0232 y lo que significa.
        estado: v?.estado ?? 'sin_vincular',
        vinculadaEn: v?.vinculadaEn ?? null,
        caducadaEn: v?.caducadaEn ?? null,
        motivo: v?.motivo ?? null,
        // `permisos === null` es «no se pudo leer» y viaja como `null` hasta
        // la pantalla; sin fila, en cambio, es «nadie lo ha autorizado», que
        // es un hecho y se puede afirmar (0233).
        relogin: permisos === null ? null : {
          permitido: p?.permitido ?? false,
          permitidoPor: p?.permitidoPor ?? null,
          permitidoEn: p?.permitidoEn ?? null,
          ultimoExitoEn: p?.ultimoExitoEn ?? null,
          ultimoMotivo: p?.ultimoMotivo ?? null,
          ultimaClase: p?.ultimaClase ?? null,
          intentosDia: p?.intentosDia ?? 0,
          bloqueado: p?.bloqueado ?? false,
        },
      };
    });

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

  /**
   * LA PUERTA DEL CONSENTIMIENTO (0233). Es la acción con la que una flota
   * autoriza que Likida guarde su contraseña de un portal, así que se protege
   * como la que escribe un CFDI y por las mismas razones:
   *
   *   · re-verifica sesión, rol y flota ADENTRO (esto es alcanzable por POST
   *     directo, y el tenant viaja por CLOSURE — el cliente no lo elige);
   *   · exige el área `dinero`, el mismo permiso que capturar una factura:
   *     quien no puede tocar el dinero de la flota tampoco decide sobre sus
   *     accesos;
   *   · el comercio se valida contra el CATÁLOGO, no se acepta como texto: una
   *     clave inventada crearía una fila de permiso sobre un portal que no
   *     existe, y esa fila nadie la vería nunca para borrarla.
   */
  async function accionAutorizarRelogin(
    _prev: { error?: string; ok?: string } | null,
    fd: FormData,
  ): Promise<{ error?: string; ok?: string } | null> {
    'use server';
    const guardia = await guardarPermiso(fd);
    if ('error' in guardia) return guardia;

    try {
      await autorizarRelogin({
        tenantId,
        comercio: guardia.comercio,
        actor: { id: guardia.userId },
        firma: guardia.firma,
        ahora: new Date().toISOString(),
      });
    } catch (e) {
      logger.error('relogin.autorizar.fallo', { tenantId, comercio: guardia.comercio, err: e instanceof Error ? e.message : 'error' });
      return { error: 'No se pudo guardar el permiso. Inténtalo de nuevo.' };
    }
    revalidatePath('/dashboard/agentes/facturas');
    return { ok: 'Listo: Likida va a reconectar sola cuando el portal cierre tu sesión.' };
  }

  /** Y la de deshacerlo, que BORRA la contraseña guardada. Mismas guardas. */
  async function accionRevocarRelogin(
    _prev: { error?: string; ok?: string } | null,
    fd: FormData,
  ): Promise<{ error?: string; ok?: string } | null> {
    'use server';
    const guardia = await guardarPermiso(fd);
    if ('error' in guardia) return guardia;

    let borrada = false;
    try {
      ({ contrasenaBorrada: borrada } = await revocarRelogin({
        tenantId,
        comercio: guardia.comercio,
        actor: { id: guardia.userId },
        firma: guardia.firma,
        ahora: new Date().toISOString(),
      }));
    } catch (e) {
      logger.error('relogin.revocar.fallo', { tenantId, comercio: guardia.comercio, err: e instanceof Error ? e.message : 'error' });
      return { error: 'No se pudo revocar el permiso. Inténtalo de nuevo — y si vuelve a fallar, avísanos: la contraseña sigue guardada.' };
    }
    revalidatePath('/dashboard/agentes/facturas');
    // Se dice LO QUE PASÓ, no lo que se esperaba: si no había contraseña que
    // borrar, afirmar que se borró sería una tranquilidad falsa.
    return {
      ok: borrada
        ? 'Borrada. Cuando el portal cierre tu sesión, vuelves a entrar tú.'
        : 'Permiso quitado. No había ninguna contraseña guardada de este portal.',
    };
  }

  /** Sesión + rol + flota + comercio del catálogo, en un solo sitio. */
  async function guardarPermiso(
    fd: FormData,
  ): Promise<{ error: string } | { comercio: string; userId: string; firma: string | null }> {
    'use server';
    const sesion = await requireSessionTenant('/dashboard/agentes/facturas');
    if (!puedeVerArea(sesion.rol, 'dinero')) {
      return { error: 'Tu rol no puede decidir sobre los accesos de la flota.' };
    }
    if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) {
      return { error: 'Estos portales no son de tu flota.' };
    }

    const crudo = fd.get('comercio');
    const clave = typeof crudo === 'string' ? crudo.trim().slice(0, 64) : '';
    if (!clave || !COMERCIOS.some((c) => c.clave === clave)) {
      return { error: 'Ese portal no está en el catálogo.' };
    }
    return { comercio: clave, userId: sesion.userId, firma: sesion.nombre };
  }

  return (
    <VistaAgenteFacturas
      tickets={tickets}
      portalesConAdaptador={PORTALES_CONOCIDOS}
      portales={portales}
      vinculosLeidos={vinculos !== null}
      autorizarRelogin={accionAutorizarRelogin}
      revocarRelogin={accionRevocarRelogin}
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
