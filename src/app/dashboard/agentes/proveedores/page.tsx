import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { parseCfdiXml } from '@/lib/likida/intake/cfdi_xml';
import {
  guardarFacturaProveedor, listarFacturasProveedor, decidirFacturaProveedor,
} from '@/lib/likida/proveedores';
import { getFiscalDeFlota } from '@/lib/likida/facturacion/flota_fiscal';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  getBuzon, generarBuzon as generarBuzonDeFlota, rotarBuzon as rotarBuzonDeFlota,
} from '@/lib/correo/buzon_escritura';
import { dominioBuzon } from '@/lib/correo/buzon';
import { logger } from '@/lib/logger';
import { sufijoTenant } from '../../sufijo';
import { VistaAgenteProveedores } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';

export const dynamic = 'force-dynamic';

const MAX_XML_BYTES = 2 * 1024 * 1024;

/** El gateo de las actions — helper de módulo (una action solo captura
 *  valores serializables). */
async function exigirPermiso(tenantId: string): Promise<{ error: string } | { quien: string }> {
  const sesion = await requireSessionTenant('/dashboard/agentes/proveedores');
  if (!puedeVerArea(sesion.rol, 'dinero')) return { error: 'Tu rol no puede operar facturas de proveedor.' };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: 'Esta bandeja no es de tu flota.' };
  return { quien: sesion.nombre ?? sesion.userId };
}

/**
 * El gateo de las actions del BUZÓN: además del área, `puedeAdministrar`.
 *
 * La página es área `dinero` (el contador VE la bandeja), pero generar o rotar
 * el buzón es CONTROL: rota la credencial que decide a qué flota entra cada
 * factura. Misma pareja de puertas que las llaves de API — y se comprueba
 * DENTRO de la action de todos modos, porque una server action es un endpoint
 * alcanzable por POST directo, no un botón.
 */
async function exigirControlBuzon(tenantId: string): Promise<{ error: string } | { userId: string }> {
  const sesion = await requireSessionTenant('/dashboard/agentes/proveedores');
  if (!puedeVerArea(sesion.rol, 'dinero')) return { error: 'Tu rol no puede operar facturas de proveedor.' };
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: 'Esta bandeja no es de tu flota.' };
  if (!puedeAdministrar(sesion.rol)) return { error: 'Solo el dueño de la flota genera o rota el buzón.' };
  return { userId: sesion.userId };
}

/**
 * Agente de Proveedores (F6 del plan) — la factura del taller o la
 * refaccionaria que hoy se captura a mano en el ERP. Entra el XML (dato
 * duro del CFDI, sin OCR: la factura de proveedor en México siempre trae
 * XML), un HUMANO aprueba o rechaza (LFPDPPP 26-II), y lo aprobado sale en
 * el layout importable a SAP/CONTPAQi. La escritura DIRECTA a SAP B1 es la
 * fase siguiente, con credenciales del cliente — esta página no la promete.
 */
export default async function PaginaAgenteProveedores({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/proveedores', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/proveedores')) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  // Primario sin catch: bandeja ciega = página caída, no "no hay facturas".
  const facturas = await listarFacturasProveedor(tenantId);
  const fiscal = await getFiscalDeFlota(tenantId).catch(() => null);
  const rfcFlota = fiscal?.flota?.rfc || null;

  // El buzón es SECUNDARIO de esta página: si su lectura falla, la bandeja
  // sigue sirviendo, y la sección dice "no se pudo leer" — nunca "sin buzón",
  // que ofrecería generar (y rotar sin querer) encima del que quizá exista.
  const buzon = await getBuzon(tenantId).catch(() => null);
  const dominioConfigurado = dominioBuzon() !== null;
  const puedeAdministrarBuzon = puedeAdministrar(rol);

  async function subirFactura(
    _prev: { error?: string; aviso?: string } | null,
    fd: FormData,
  ): Promise<{ error?: string; aviso?: string } | null> {
    'use server';
    const permiso = await exigirPermiso(tenantId);
    if ('error' in permiso) return { error: permiso.error };

    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Elige el XML de la factura.' };
    if (archivo.size > MAX_XML_BYTES) return { error: 'Ese archivo pesa demasiado para ser el XML de una factura.' };

    const texto = await archivo.text();
    const xml = parseCfdiXml(texto);
    if (!xml?.uuid || typeof xml.total !== 'number') {
      return { error: 'No pude leerlo como CFDI (XML). El PDF solo es la representación — aquí va el XML que manda el proveedor.' };
    }

    const rfc = (await getFiscalDeFlota(tenantId).catch(() => null))?.flota?.rfc || null;
    const r = await guardarFacturaProveedor(tenantId, xml, texto, rfc);
    if (!r.ok) {
      return r.motivo === 'duplicada'
        ? { error: 'Esa factura ya está en la bandeja (mismo folio fiscal).' }
        : { error: 'No se pudo guardar la factura. Inténtalo de nuevo.' };
    }
    logger.info('proveedores.subida', { tenantId, factura: r.facturaId });
    return {
      aviso: r.receptorEsFlota === false
        ? 'Guardada — OJO: el receptor del CFDI NO es el RFC de tu flota; revísala antes de aprobar.'
        : 'Guardada. Está en la bandeja esperando tu decisión.',
    };
  }

  async function decidir(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    const permiso = await exigirPermiso(tenantId);
    if ('error' in permiso) return { error: permiso.error };

    const facturaId = typeof fd.get('facturaId') === 'string' ? (fd.get('facturaId') as string).trim().slice(0, 64) : '';
    const decision = fd.get('decision');
    if (!facturaId || (decision !== 'aprobada' && decision !== 'rechazada')) return { error: 'Decisión incompleta.' };

    const r = await decidirFacturaProveedor(tenantId, facturaId, decision, permiso.quien);
    if (r.error) return { error: r.error };
    logger.info('proveedores.decidida', { tenantId, facturaId, decision });
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  // Sin parámetros a propósito: la action no lee nada del formulario (el
  // tenant va por closure desde la sesión) y `useActionState` acepta una
  // función de menor aridad.
  async function generarBuzonAccion(): Promise<{ error?: string } | null> {
    'use server';
    const permiso = await exigirControlBuzon(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    try {
      await generarBuzonDeFlota(tenantId, { id: permiso.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'generar la dirección del buzón') };
    }
    // El redirect va FUERA del try: lanza NEXT_REDIRECT y un catch encima lo
    // convertiría en "falla del sistema" sobre una operación que sí ocurrió.
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  async function rotarBuzonAccion(): Promise<{ error?: string } | null> {
    'use server';
    const permiso = await exigirControlBuzon(tenantId);
    if ('error' in permiso) return { error: permiso.error };
    try {
      await rotarBuzonDeFlota(tenantId, { id: permiso.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'rotar la dirección del buzón') };
    }
    redirect(`/dashboard/agentes/proveedores${sufijo}`);
  }

  return (
    <VistaAgenteProveedores
      facturas={facturas}
      rfcFlota={rfcFlota}
      sufijo={sufijo}
      buzon={buzon}
      dominioConfigurado={dominioConfigurado}
      puedeAdministrarBuzon={puedeAdministrarBuzon}
      acciones={{ subirFactura, decidir, generarBuzon: generarBuzonAccion, rotarBuzon: rotarBuzonAccion }}
      notificaciones={<SeccionNotificaciones tenantId={tenantId} agenteId="proveedores" />}
    />
  );
}
