// ═══════════════════════════════════════════════════════════════════════════
// EL EXPORT QUE LA LANDING PROMETE: una póliza que el ERP asienta.
//
// El export que había era un CSV de ocho columnas —folio, operador, fecha,
// comprobado, anticipo, diferencia, estatus, n_diferencias—: un resumen para
// revisar, no un asiento para importar. La landing decía «el formato que SAP
// Business One o CONTPAQi ya sabe importar, sin retecleo», y esa frase era más
// grande que el archivo.
//
// LOS MISMOS GUARDAS QUE EL RESTO DE `export/`, y por la misma razón: aquí sale
// dinero de una flota. Rate limit por IP y por tenant, tenant resuelto de la
// sesión (nunca del query a secas), y ROL — `puedeExportar` excluye al operador,
// y olvidar preguntárselo es el IDOR que este repo ya documentó como el fallo
// más común del código escrito por agentes.
//
// SIN CATÁLOGO NO HAY PÓLIZA. Si la flota no declaró sus cuentas, esta ruta
// contesta 409 con la lista de lo que falta, no un archivo a medias. Una cuenta
// inventada no se detecta al importar: se detecta en la auditoría del año
// siguiente.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import { polizaDeLiquidacion, type CatalogoContable, type LiquidacionParaPoliza } from '@/lib/likida/contabilidad/poliza';
import { aContpaqi, aSapB1 } from '@/lib/likida/contabilidad/formatos';
import type { ConceptoGasto } from '@/types/likida';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Formato = 'contpaqi' | 'sap_b1';

interface FilaPoliza {
  liquidacionId: string;
  folioViaje: string;
  operador: string;
  fecha: string;
  anticipo: number;
  diferencia: number;
  ivaAcreditable: number;
  porConcepto: Array<{ concepto: ConceptoGasto; subtotal: number }>;
  baseEstimada: number;
}

export async function GET(req: Request) {
  if (!(await rateLimit(`export:${clientIp(req)}`, 10, 60_000)))
    return new NextResponse('Demasiadas peticiones', { status: 429 });

  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  const tenantId = t.tenantId;

  if (!(await rateLimit(`export:tenant:${tenantId}`, 10, 60_000)))
    return new NextResponse('Demasiadas peticiones', { status: 429 });

  if (!puedeExportar(t.rol))
    return new NextResponse('Tu rol no puede exportar la contabilidad', { status: 403 });

  const url = new URL(req.url);
  const formato = (url.searchParams.get('formato') ?? 'contpaqi') as Formato;
  if (formato !== 'contpaqi' && formato !== 'sap_b1')
    return new NextResponse('formato debe ser contpaqi o sap_b1', { status: 400 });

  const desde = url.searchParams.get('desde');
  const hasta = url.searchParams.get('hasta');
  if (!desde || !hasta || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta))
    return new NextResponse('desde y hasta son obligatorios en formato AAAA-MM-DD', { status: 400 });

  // ── EL CATÁLOGO DE LA FLOTA ────────────────────────────────────────────
  const { data: fila, error: errPerfil } = await acotada(
    supabaseAdmin().from('tenant').select('perfil').eq('id', tenantId).maybeSingle(),
    'export.poliza.perfil',
  );
  if (errPerfil) {
    logger.error('export.poliza.perfil', { tenantId, err: errPerfil.message });
    return new NextResponse('No se pudo leer la configuración contable', { status: 503 });
  }

  const contab = (fila?.perfil as { contabilidad?: { cuentas?: CatalogoContable; tipoPoliza?: string } } | null)
    ?.contabilidad;
  const catalogo = contab?.cuentas;
  if (!catalogo || !catalogo.gastos) {
    return NextResponse.json(
      {
        error: 'sin_catalogo_contable',
        detalle:
          'Esta flota todavía no declaró su catálogo de cuentas. Sin él no se puede armar una póliza: ' +
          'la cuenta de cada concepto la decide tu contador, y una cuenta inventada no se nota al ' +
          'importar — se nota en la auditoría del año siguiente.',
        comoResolverlo: 'Configúralo en Ajustes → Contabilidad, o pídeselo a tu contador con tu catálogo.',
      },
      { status: 409 },
    );
  }

  const { data, error } = await acotada(
    supabaseAdmin().rpc('poliza_datos_tenant', { p_tenant: tenantId, p_desde: desde, p_hasta: hasta }),
    'export.poliza.datos',
  );
  if (error) {
    logger.error('export.poliza.datos', { tenantId, err: error.message });
    return new NextResponse('No se pudieron leer las liquidaciones', { status: 503 });
  }

  const filas = (data ?? []) as FilaPoliza[];
  if (filas.length === 0)
    return NextResponse.json({ error: 'sin_liquidaciones', detalle: 'No hay liquidaciones cerradas en ese periodo.' }, { status: 404 });

  // ── SE ARMAN TODAS ANTES DE ESCRIBIR NADA ──────────────────────────────
  // Un archivo con la mitad de los asientos es peor que ninguno: el contador
  // importa, cuadra a medias, y la parte que falta no aparece por ningún lado.
  const polizas: Array<{ folio: string; poliza: ReturnType<typeof polizaDeLiquidacion> }> = [];
  const bloqueos: Array<{ folio: string; falta: string[] }> = [];

  for (const f of filas) {
    const liq: LiquidacionParaPoliza = {
      folioViaje: f.folioViaje,
      operador: f.operador,
      fecha: f.fecha,
      anticipo: Number(f.anticipo),
      porConcepto: (f.porConcepto ?? []).map((c) => ({ concepto: c.concepto, subtotal: Number(c.subtotal) })),
      ivaAcreditable: Number(f.ivaAcreditable),
      diferencia: Number(f.diferencia),
    };
    const r = polizaDeLiquidacion(liq, catalogo);
    if (!r.ok) bloqueos.push({ folio: f.folioViaje, falta: r.falta });
    else polizas.push({ folio: f.folioViaje, poliza: r });
  }

  if (bloqueos.length > 0) {
    return NextResponse.json(
      {
        error: 'polizas_incompletas',
        detalle:
          `${bloqueos.length} de ${filas.length} liquidaciones no se pueden asentar. No se exporta el ` +
          'archivo a medias: un contador que importa la mitad cuadra a medias y lo que falta no aparece ' +
          'por ningún lado.',
        bloqueos,
      },
      { status: 409 },
    );
  }

  // Cuántos renglones traen el TOTAL en vez de la base imponible: quien
  // importa tiene que saberlo, porque ahí el IVA no viene separado.
  const conBaseEstimada = filas.reduce((s, f) => s + Number(f.baseEstimada ?? 0), 0);

  const nombre = `poliza-${desde}_${hasta}`;
  if (formato === 'contpaqi') {
    const tipo = contab?.tipoPoliza ?? 'Dr';
    // La numeración la lleva la contabilidad de la flota; aquí se numera de 1
    // en adelante DENTRO del archivo y se dice en el nombre, para que quien
    // importe sepa que no son folios suyos.
    const cuerpo = polizas
      .map((p, i) => (p.poliza.ok ? aContpaqi(p.poliza.poliza, { tipo, numero: i + 1 }) : ''))
      .join('');
    return new NextResponse(cuerpo, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${nombre}-contpaqi.csv"`,
        'x-likida-polizas': String(polizas.length),
        'x-likida-base-estimada': String(conBaseEstimada),
      },
    });
  }

  // SAP B1 son DOS archivos ligados por RecordKey. Se devuelven juntos en JSON
  // porque separarlos en dos descargas es la forma más fácil de que alguien
  // importe uno sin el otro.
  const cabeceras: string[] = [];
  const lineas: string[] = [];
  polizas.forEach((p, i) => {
    if (!p.poliza.ok) return;
    const { cabecera, lineas: ln } = aSapB1(p.poliza.poliza, i + 1);
    // Solo el primero conserva el doble encabezado del DTW.
    cabeceras.push(i === 0 ? cabecera : cabecera.split('\n').slice(2).join('\n'));
    lineas.push(i === 0 ? ln : ln.split('\n').slice(2).join('\n'));
  });

  return NextResponse.json({
    formato: 'sap_b1_dtw',
    archivos: {
      'oJournalEntries.txt': cabeceras.join(''),
      'JournalEntries_Lines.txt': lineas.join(''),
    },
    polizas: polizas.length,
    baseEstimada: conBaseEstimada,
    nota:
      'Son DOS archivos y el Data Transfer Workbench los importa juntos, ligados por RecordKey. ' +
      'Importar solo uno deja asientos sin renglones o renglones sin asiento.',
  });
}
