import { NextResponse } from 'next/server';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeExportar } from '@/lib/auth/permisos';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { toCsv } from '@/lib/cuadra/export';
import { resolverPeriodo, getGastosFiscales, causasDe, aFilasExport, type GastoFiscal } from '@/lib/cuadra/fiscal';
import { getConfig } from '@/lib/cuadra/config';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT DEL PANEL FISCAL — la mitad "exportar" del rol de solo lectura.
//
// TRES PUERTAS, Y LAS TRES HACEN FALTA:
//
//   1. `getSessionTenant` — sin sesión no hay tenant, y el service-role salta
//      RLS: el `tenant_id` sale de la sesión, NUNCA del query string. Es el
//      patrón de `api/export/liquidaciones` y la razón por la que un IDOR aquí
//      sería una fuga entre flotas, no un bug de UI.
//   2. `puedeVerRuta` — la MISMA función que gatea la pantalla. Un endpoint que
//      autoriza distinto de la página que lo ofrece es la forma clásica de que
//      el link desaparezca y la URL siga sirviendo el dato: es exactamente lo
//      que `visibilidad.ts` documenta haber tenido que cerrar para el chofer.
//   3. `puedeExportar` — el contador SÍ puede (está en el set), el operador no.
//
// Vive bajo `dashboard/contador/` y no en `api/export/` a propósito: la ruta
// que autoriza y la ruta que exporta comparten prefijo, así que la relación
// entre las dos se ve en el árbol de archivos y no hay que ir a buscarla.
// ═══════════════════════════════════════════════════════════════════════════

const PANTALLA = '/dashboard/contador/cfdi';

export async function GET(req: Request) {
  if (!rateLimit(`export-fiscal:${clientIp(req)}`, 10, 60_000)) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  const s = await getSessionTenant();
  if (!s) return new NextResponse('No autorizado', { status: 401 });
  if (!puedeVerRuta(s.rol, PANTALLA)) return new NextResponse('No autorizado', { status: 403 });
  if (!puedeExportar(s.rol)) return new NextResponse('Tu rol no puede exportar', { status: 403 });

  const url = new URL(req.url);

  // SUPERADMIN Y SOLO SUPERADMIN puede pedir otra flota, y aun así se comprueba
  // que exista. Para cualquier otro rol el `?tenant=` se ignora en silencio: si
  // se honrara, sería un IDOR de un solo teclazo sobre datos fiscales de otra
  // empresa. Mismo criterio que `resolverTenantEfectivo`.
  let tenantId = s.tenantId;
  const pedido = url.searchParams.get('tenant');
  if (s.rol === 'superadmin' && pedido) {
    const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', pedido).maybeSingle();
    if (data) tenantId = data.id as string;
  }
  if (!tenantId) {
    // Un superadmin sin tenant resuelto cae al demo en el panel; aquí no se
    // adivina: exportar el tenant equivocado es peor que no exportar.
    return new NextResponse('Sin flota asignada: no hay nada que exportar.', { status: 400 });
  }

  const periodo = resolverPeriodo(url.searchParams.get('p') ?? undefined, new Date().toISOString().slice(0, 10));
  const filtro = url.searchParams.get('f');

  try {
    const [cfg, gastos] = await Promise.all([
      getConfig(tenantId),
      getGastosFiscales(tenantId, periodo),
    ]);
    const opts = {
      efectivoTopeMxn: cfg.estimulos.efectivoTopeMxn,
      clavesCombustible: cfg.hidrocarburos.claves,
      clavesDieselIeps: cfg.estimulos.clavesDieselIeps,
    };

    // El MISMO filtro que la pantalla, para que el CSV sea lo que se veía. Un
    // export que trae más filas que la tabla que lo ofreció hace que el
    // contador desconfíe de las dos.
    const pasa = (g: GastoFiscal): boolean => {
      switch (filtro) {
        case 'con_cfdi': return Boolean(g.cfdiUuid);
        case 'sin_cfdi': return !g.cfdiUuid;
        case 'vigentes': return Boolean(g.cfdiUuid) && g.estadoSat === 'vigente';
        case 'cancelados': return Boolean(g.cfdiUuid) && g.estadoSat === 'cancelado';
        case 'por_validar': return Boolean(g.cfdiUuid) && g.estadoSat !== 'vigente' && g.estadoSat !== 'cancelado';
        case 'observados': return causasDe(g, opts).length > 0;
        default: return true;
      }
    };

    const ordenados = [...gastos]
      .filter(pasa)
      .sort((a, b) => ((a.fecha ?? '') < (b.fecha ?? '') ? 1 : -1));

    // Sin filas se devuelve el ENCABEZADO solo, no un archivo de 0 bytes: un
    // CSV vacío se abre en Excel como un error de descarga, y el contador no
    // puede distinguir "no hay nada en este periodo" de "falló el export".
    const filas = aFilasExport(ordenados, opts);
    const csv = filas.length
      ? toCsv(filas)
      : 'fecha,concepto,viaje,operador,folio,rfc_emisor,cfdi_uuid,estado_sat,efos,forma_pago,monto,sub_total,iva_traslado,ieps_traslado,clave_prod_serv,situacion_fiscal,fundamento\n';

    const nombre = `cfdi_${periodo.clave}${filtro ? `_${filtro}` : ''}.csv`;
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        // Datos fiscales de una flota no se guardan en ninguna caché compartida.
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    // El detalle se queda del lado del servidor: el texto crudo de PostgREST
    // saca nombres de columna hacia afuera, y si el usuario cierra la pestaña
    // el único testigo del fallo desaparece.
    logger.error('export.cfdi_fiscal', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }
}
