import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { parseCfdiXml } from '@/lib/likida/intake/cfdi_xml';
import {
  guardarFacturaProveedor, listarFacturasProveedor, decidirFacturaProveedor,
} from '@/lib/likida/proveedores';
import { getFiscalDeFlota } from '@/lib/likida/facturacion/flota_fiscal';
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

  return (
    <VistaAgenteProveedores
      facturas={facturas}
      rfcFlota={rfcFlota}
      sufijo={sufijo}
      acciones={{ subirFactura, decidir }}
      notificaciones={<SeccionNotificaciones tenantId={tenantId} agenteId="proveedores" />}
    />
  );
}
