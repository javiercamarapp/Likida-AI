import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toLiquidacionRows } from '@/lib/likida/export';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { exigir, PAGINA, MAX_PAGINAS, LecturaIncompleta } from '@/lib/likida/pg';
import { acotada } from '@/lib/likida/presupuesto';
import { leerPeriodo } from './periodo';

export const runtime = 'nodejs';

// Export de liquidaciones a CSV (ERP/Excel). Gate por la sesión real del
// contralor (Supabase Auth) — ya no por el passcode compartido. El
// service-role salta RLS, así que se sigue filtrando EXPLÍCITO por
// tenant_id, ahora tomado de la sesión en vez de un env var.
export async function GET(req: Request) {
  if (!(await rateLimit(`export:${clientIp(req)}`, 10, 60_000))) return new NextResponse('Demasiadas peticiones', { status: 429 });

  // Ver la nota de `tenant-api.ts`: esto le devolvía 401 al superadmin, y
  // además ignoraba el `?tenant=` de la pantalla — o sea que aun arreglando el
  // 401 habría exportado la flota equivocada, que es peor que no exportar.
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  const tenantId = t.tenantId;

  // CUOTA GLOBAL POR FLOTA, no solo por IP (auditoría externa 15-ago, P1). Con
  // Redis el conteo de arriba (`export:${ip}`) ya es global entre instancias,
  // pero sigue siendo por RED: una sesión válida robada y usada desde varias
  // IPs no lo toca. Esta segunda llave, por tenant, cierra esa otra puerta —
  // mismo número que la de IP, no uno inventado.
  if (!(await rateLimit(`export:tenant:${tenantId}`, 10, 60_000))) return new NextResponse('Demasiadas peticiones', { status: 429 });

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

  // ── ESC-8 (escala 50k): PERIODO OBLIGATORIO Y ARCHIVO EN STREAM ─────────
  //
  // Antes: TODA la tabla de liquidaciones de la flota, sin periodo, armada
  // entera en memoria (`traerTodo` + `toCsv`) antes de mandar el primer byte.
  // A 50k viajes/mes son >4.5 MB de CSV en RAM por descarga al primer mes y
  // sin techo después; con 10 descargas/min por flota (la cuota de arriba),
  // una función de Vercel se queda sin memoria antes que sin cuota.
  //
  // Ahora: `?desde=&hasta=` (YYYY-MM-DD, día de México) obligatorios y a lo
  // más 3 meses, y el archivo sale página por página (`ReadableStream`): cada
  // página se lee, se vuelve CSV y se escribe; en memoria nunca hay más de
  // 1,000 filas. Las columnas y el formato son EXACTAMENTE los de antes (el
  // ERP del contador ya los lee): `toCsv` de `lib/likida/export` sigue
  // escribiendo cada página, y solo la primera lleva el encabezado.
  const periodo = leerPeriodo(new URL(req.url).searchParams);
  if (!periodo.ok) return new NextResponse(periodo.motivo, { status: 400 });
  const { desde, hastaExclusivo, etiqueta } = periodo;

  // ── KEYSET, NO `range` POR POSICIÓN (auditoría 21, MEDIO REINCIDENTE 18-c4) ─
  //
  // Antes cada página era `range(d, d+999)` sobre `created_at desc` — posición
  // sobre un orden que CAMBIA entre página y página: una liquidación nueva
  // escrita a media descarga (un chofer cierra su viaje por WhatsApp) entra en
  // la posición 0 y desplaza todo un lugar, así que la última fila de la
  // página anterior salía DOS VECES en el CSV y otra no salía nunca — con
  // `leidas` llegando exacto a `esperadas`, o sea sin que el corte lo notara.
  //
  // Ahora el cursor es la FILA, no la posición: `(created_at, id) < (última)`,
  // el mismo patrón que `/v1/viajes` y el Registro de Viajes (y el índice de
  // la 0157 es exactamente ese ORDER BY). Una fila nueva entra arriba del
  // cursor y no mueve a nadie: el archivo trae el corte congelado al momento
  // de la primera página, cada fila una sola vez.
  const pagina = (despues: { creadoEn: string; id: string } | null) => {
    let q = supabaseAdmin().from('liquidacion')
      // `id` y `created_at` son el cursor; `toLiquidacionRows` ignora `id`,
      // así que el CSV sigue siendo byte por byte el de siempre.
      // El `count` solo en la primera página, como el `conteo()` de pg.ts:
      // pedirlo en cada vuelta haría contar de más.
      .select('id, created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))', despues ? {} : { count: 'exact' })
      .eq('tenant_id', tenantId)
      .gte('created_at', desde)
      .lt('created_at', hastaExclusivo);
    // `(created_at, id) < (c, i)` en el dialecto de PostgREST: o es más vieja,
    // o es del mismo instante y su id va después en el orden. Sin la segunda
    // rama, dos liquidaciones del mismo microsegundo se pierden o se repiten —
    // la advertencia de `pg.ts`.
    if (despues) {
      q = q.or(`created_at.lt.${despues.creadoEn},and(created_at.eq.${despues.creadoEn},id.lt.${despues.id})`);
    }
    return acotada(
      q.order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(0, PAGINA - 1),
      'export.liquidaciones',
    );
  };

  // La PRIMERA página se lee antes de contestar: así un error de base sigue
  // siendo un 500 con texto, no un archivo a medias con 200. Trae el `count`
  // exacto, que es lo que permite saber cuándo se acabó sin un viaje extra.
  let primera: Awaited<ReturnType<typeof pagina>>;
  try {
    primera = await pagina(null);
    exigir(primera, 'export.liquidaciones');
  } catch (e) {
    logger.error('export.liquidaciones', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }

  const codificador = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controlador) {
      try {
        const esperadas = typeof primera.count === 'number' ? primera.count : null;
        let leidas = 0;
        let res = primera;
        for (let n = 0; n < MAX_PAGINAS; n++) {
          const filas = (exigir(res, 'export.liquidaciones') ?? []) as Array<
            Parameters<typeof toLiquidacionRows>[0][number] & { id: string }
          >;
          const csv = toCsv(toLiquidacionRows(filas));
          // Solo la primera página lleva encabezado; de las demás se quita la
          // primera línea. Pegadas, dan byte por byte lo que daba `toCsv` de
          // la lista entera.
          controlador.enqueue(codificador.encode(n === 0 ? csv : csv.slice(csv.indexOf('\n') + 1)));
          leidas += filas.length;
          if (esperadas !== null && leidas >= esperadas) break;
          if (filas.length === 0) {
            if (esperadas === null) break;
            // Con count conocido y filas faltantes, la base dejó de entregar:
            // un archivo corto con cara de completo es justo lo que no sale.
            throw new LecturaIncompleta('export.liquidaciones', leidas, esperadas);
          }
          const ultima = filas[filas.length - 1];
          res = await pagina({ creadoEn: String(ultima.created_at), id: String(ultima.id) });
        }
        // ── AUDITORÍA 22, BE-3 (ALTO) ────────────────────────────────────
        // Agotar las 100 páginas caía aquí y cerraba el CSV en limpio: a
        // partir de 100,000 filas el archivo salía CORTO con cara de
        // completo. El `throw` de arriba solo cubre «la base dejó de
        // entregar»; este cubre «se acabaron las vueltas», que es el mismo
        // resultado para quien recibe el archivo. Mismo criterio que
        // `traerTodo` en pg.ts: completa Y DEMOSTRADA, o se dice.
        if (esperadas !== null && leidas < esperadas) {
          throw new LecturaIncompleta('export.liquidaciones', leidas, esperadas);
        }
        controlador.close();
      } catch (e) {
        // Un fallo A MEDIO ARCHIVO no puede cambiar el 200 ya enviado; lo que
        // sí puede es ABORTAR la descarga para que el navegador la marque como
        // fallida, en vez de cerrar limpio un CSV al que le faltan filas.
        logger.error('export.liquidaciones_stream', { tenant: tenantId, periodo: etiqueta, err: e instanceof Error ? e.message : String(e) });
        controlador.error(e instanceof Error ? e : new Error(String(e)));
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liquidaciones_likida.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
