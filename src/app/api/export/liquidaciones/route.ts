import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toLiquidacionRows } from '@/lib/cuadra/export';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// Export de liquidaciones a CSV (ERP/Excel). Gate por la sesión real del
// contralor (Supabase Auth) — ya no por el passcode compartido. El
// service-role salta RLS, así que se sigue filtrando EXPLÍCITO por
// tenant_id, ahora tomado de la sesión en vez de un env var.
export async function GET(req: Request) {
  if (!rateLimit(`export:${clientIp(req)}`, 10, 60_000)) return new NextResponse('Demasiadas peticiones', { status: 429 });

  // Ver la nota de `tenant-api.ts`: esto le devolvía 401 al superadmin, y
  // además ignoraba el `?tenant=` de la pantalla — o sea que aun arreglando el
  // 401 habría exportado la flota equivocada, que es peor que no exportar.
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  const tenantId = t.tenantId;

  // ── QUIÉN PUEDE DESCARGAR, NO SOLO DE QUÉ FLOTA ──────────────────────────
  //
  // Faltaba esto y era un IDOR: la ruta autorizaba por SESIÓN y por TENANT, y
  // ahí se detenía. Cualquier usuario de la flota —incluido un OPERADOR, que
  // solo debe ver lo suyo— bajaba el PDF de la liquidación de cualquier
  // compañero con nada más que el id en la URL.
  //
  // `puedeExportar` ya excluía a `operador`; la ruta nunca se lo preguntó. Es
  // el patrón que este repo tiene documentado como el fallo más común del
  // código escrito por agentes: se acota el tenant y se olvida el rol.

  // LA PUERTA DE UN EXPORT ES LA DEL DATO, NO LA DEL VERBO.
  //
  // `puedeExportar` incluye al ENCARGADO, pero la matriz de la 0044 le da solo
  // el área `operacion` y la base lo excluye de `ve_finanzas()`. Este archivo
  // es DINERO: folio, operador, anticipo, comprobado y diferencia por viaje.
  //
  // La contradicción vivía dentro de una sola pantalla: `/dashboard/analitica`
  // le escondía la gráfica con "tu rol no ve cifras de dinero" y tres pulgadas
  // más abajo le pintaba el botón que se las daba enteras en CSV.
  if (!puedeVerArea(t.rol, 'dinero')) {
    logger.warn('export.area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }

  if (!puedeExportar(t.rol)) {
    logger.warn('export.rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const { data, error } = await supabaseAdmin()
    .from('liquidacion')
    .select('created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(5000);
  // El texto crudo de PostgREST iba en el cuerpo del 500 y del lado del
  // servidor NO quedaba ninguna línea: el único testigo del fallo era el
  // navegador del contralor, que no lo guarda. Si cerraba la pestaña, el evento
  // no existió. Y de paso el mensaje sacaba nombres de columna y detalle del
  // esquema hacia afuera (auditoría 5, operabilidad, ALTO).
  //
  // Se invierte: el detalle se queda dentro y el usuario recibe algo que puede
  // repetir por teléfono. `tenant` va en el log —el redactor lo huella, no lo
  // borra— para saber de qué flota era el fallo.
  if (error) {
    logger.error('export.liquidaciones', { tenant: tenantId, err: error.message });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = toLiquidacionRows((data ?? []) as any);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liquidaciones_likida.csv"`,
    },
  });
}
