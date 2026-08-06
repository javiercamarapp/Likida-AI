import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toLiquidacionRows } from '@/lib/cuadra/export';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { traerTodo, conteo, LecturaIncompleta } from '@/lib/cuadra/pg';

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

  // AUDITORÍA 12, MEDIO (backend): `.limit(5000)` a secas — un contralor con
  // 5,001+ liquidaciones bajaba un CSV corto sin que nadie se lo dijera, el
  // peor tipo de dato que falta: el histórico viejo que cruza contra su ERP.
  // `traerTodo` pagina hasta probar que trajo TODO (conteo exacto en la primera
  // página) y lanza `LecturaIncompleta` si no puede demostrarlo — la doctrina
  // de `pg.ts` que este archivo reintroducía con un techo más alto.
  let filas: unknown[] = [];
  try {
    filas = await traerTodo(
      (d, h) => supabaseAdmin().from('liquidacion')
        .select('created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))', conteo(d))
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(d, h),
      'export.liquidaciones',
    );
  } catch (e) {
    if (e instanceof LecturaIncompleta) {
      logger.error('export.liquidaciones_incompleto', { tenant: tenantId, leidas: e.leidas });
      return new NextResponse('La flota tiene más liquidaciones de las que el export puede traer en una pasada. Si esto persiste, avísanos: necesitamos paginar el archivo.', { status: 500 });
    }
    logger.error('export.liquidaciones', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }

  const rows = toLiquidacionRows(filas as never);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liquidaciones_likida.csv"`,
    },
  });
}
