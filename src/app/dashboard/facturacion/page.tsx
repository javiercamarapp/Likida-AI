import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getFacturacionClientes, type FacturacionClientes } from '@/lib/likida/facturacion_clientes';
import { VistaFacturacion } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/facturacion';

/**
 * FACTURACIÓN A CLIENTES — la página que faltaba detrás de un link vivo.
 *
 * `rutas.ts` pintaba "Facturación a clientes" en la categoría DINERO Y FISCAL y
 * `visibilidad.ts` ya la tenía clasificada como área `dinero`, pero el
 * directorio no existía: el link daba 404 en producción. Esto lo cierra.
 *
 * ── LA PUERTA ─────────────────────────────────────────────────────────────
 * `puedeVerRuta(rol, RUTA)` con área `dinero` — superadmin, flota_admin y
 * contador. Espeja `ve_finanzas()` de la 0049, que es la RLS de
 * `factura_emitida`/`pago_recibido`: el encargado (jefe de tráfico) despacha,
 * no factura, y la cartera completa de la empresa no es suya. La comprobación
 * no es cosmética: `getFacturacionClientes` lee con `supabaseAdmin()`, que pasa
 * por encima de RLS, así que ÉSTA es la única puerta que hay.
 *
 * Es de solo lectura a propósito. Registrar una factura emitida y sus pagos es
 * una escritura fiscal (folio, UUID del CFDI, timbrado) que hoy no tiene dueño
 * en el producto — Likida no es PAC y el UUID llega de fuera (0049). Inventarle
 * un formulario aquí crearía facturas que ningún SAT conoce. Ver el reporte.
 */
export default async function PaginaFacturacion({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge que no hay facturas: devuelve `null` y la vista pinta el
  // error. Supabase reporta los fallos POR VALOR, así que una base caída se
  // leería como "no te debe nadie y no tienes nada sin facturar" — las dos
  // conclusiones contrarias a las que esta pantalla existe para dar.
  let datos: FacturacionClientes | null;
  try {
    datos = await getFacturacionClientes(tenantId);
  } catch {
    datos = null;
  }

  return <VistaFacturacion datos={datos} />;
}
