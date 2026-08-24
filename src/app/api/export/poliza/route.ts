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
import { polizaDeLiquidacion, type LiquidacionParaPoliza } from '@/lib/likida/contabilidad/poliza';
import { catalogoDeclarado, CUENTAS_BALANCE } from '@/lib/likida/contabilidad/catalogo';
import { archivoContpaqi, archivoSapB1 } from '@/lib/likida/contabilidad/formatos';
import { perfilExportacionDeclarado } from '@/lib/likida/contabilidad/perfiles';
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
  porConcepto: Array<{ concepto: ConceptoGasto; subtotal: number | null; baseConocida?: boolean }>;
  baseDesconocida: number;
}

const DIAS_MAXIMO = 92;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(iso: string): boolean {
  if (!FECHA_ISO.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === iso;
}

function diasEntre(desde: string, hasta: string): number {
  return Math.floor((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;
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
  if (!desde || !hasta || !fechaValida(desde) || !fechaValida(hasta))
    return new NextResponse('desde y hasta son obligatorios en formato AAAA-MM-DD', { status: 400 });
  if (hasta < desde) return new NextResponse('hasta no puede ser anterior a desde', { status: 400 });
  const dias = diasEntre(desde, hasta);
  if (dias > DIAS_MAXIMO) {
    return NextResponse.json({
      error: 'rango_demasiado_grande',
      detalle: `El export de pólizas admite como máximo ${DIAS_MAXIMO} días por archivo; pediste ${dias}. Divide el periodo para que el archivo se revise e importe de forma controlada.`,
      maximoDias: DIAS_MAXIMO,
    }, { status: 413 });
  }
  const preflight = url.searchParams.get('preflight') === '1';

  // ── EL CATÁLOGO DE LA FLOTA ────────────────────────────────────────────
  // Se lee lo DECLARADO (`tenant.config.catalogoCuentas`, la pantalla de
  // Configuración), nunca `getConfig()`: ése fusiona `DEMO_CONFIG`, cuyas
  // cuentas están marcadas 🔴 demo en el código, y las asentaría en el ERP de
  // la flota como si fueran suyas.
  let catalogo;
  try {
    const lectura = await catalogoDeclarado(tenantId);
    if (!lectura.ok) {
      return NextResponse.json(
        {
          error: 'sin_catalogo_contable',
          detalle:
            'Esta flota todavía no declaró su catálogo de cuentas. Sin él no se puede armar una póliza: ' +
            'la cuenta de cada concepto la decide tu contador, y una cuenta inventada no se nota al ' +
            'importar — se nota en la auditoría del año siguiente.',
          comoResolverlo:
            'Captúralo en Configuración → Catálogo de cuentas de tu contador, una por línea como ' +
            '`concepto=cuenta`. Además de los conceptos de gasto, la póliza necesita las cuentas de ' +
            'balance: ' + Object.keys(CUENTAS_BALANCE).join(', ') + '.',
          donde: '/dashboard/configuracion',
        },
        { status: 409 },
      );
    }
    catalogo = lectura.catalogo;
  } catch (e) {
    logger.error('export.poliza.catalogo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo leer la configuración contable', { status: 503 });
  }

  // Cada ERP usa la plantilla que confirmó ESTA flota. No hay una plantilla
  // universal segura: versiones, segmentos y campos obligatorios cambian. Una
  // credencial guardada tampoco prueba que el archivo importe, así que este
  // perfil es una confirmación separada y explícita.
  let perfil;
  try {
    perfil = await perfilExportacionDeclarado(tenantId, formato);
  } catch (e) {
    logger.error('export.poliza.perfil_erp', { tenantId, formato, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo leer el perfil de exportación ERP', { status: 503 });
  }
  if (!perfil) {
    return NextResponse.json({
      error: 'perfil_erp_sin_confirmar',
      detalle: `No hay una plantilla ${formato === 'contpaqi' ? 'CONTPAQi' : 'SAP Business One DTW'} confirmada para esta flota. No se genera un layout supuesto: pide a tu contador que confirme una plantilla de importación de su instancia.`,
      estado: 'no_listo',
    }, { status: 409 });
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
    const sinBase = (f.porConcepto ?? []).filter((c) => c.baseConocida !== true || c.subtotal === null);
    if (sinBase.length > 0) {
      bloqueos.push({
        folio: f.folioViaje,
        falta: [`base gravable desconocida para ${sinBase.map((c) => `«${c.concepto}»`).join(', ')}. El XML no informó SubTotal; no se sustituye por el total porque duplicaría o mezclaría IVA en la póliza.`],
      });
      continue;
    }
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

  const conBaseDesconocida = filas.reduce((s, f) => s + Number(f.baseDesconocida ?? 0), 0);

  if (preflight) {
    return NextResponse.json({
      listo: true,
      formato,
      plantillaConfirmadaEn: perfil.confirmadoEn,
      polizas: polizas.length,
      rango: { desde, hasta, dias, maximoDias: DIAS_MAXIMO },
      advertencias: conBaseDesconocida > 0
        ? [`${conBaseDesconocida} renglón(es) no tienen base gravable conocida y bloquearon el export; carga o corrige el XML antes de importar.`]
        : [],
      estado: 'listo_para_generar_no_importado',
    });
  }

  const nombre = `poliza-${desde}_${hasta}`;
  if (formato === 'contpaqi') {
    if (perfil.sistema !== 'contpaqi') return new NextResponse('Perfil ERP inconsistente', { status: 500 });
    // `archivoContpaqi`, no `aContpaqi` por póliza: el importador recibe UN
    // encabezado por archivo. Repetirlo entre movimientos se interpreta como
    // un asiento corrupto en varios esquemas.
    const cuerpo = archivoContpaqi(polizas.map((p) => p.poliza.ok ? p.poliza.poliza : null).filter((p): p is NonNullable<typeof p> => p !== null), {
      ...perfil.opciones,
      numeroInicial: perfil.opciones.numero,
    });
    return new NextResponse(cuerpo, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${nombre}-contpaqi.csv"`,
        'x-likida-polizas': String(polizas.length),
        'x-likida-base-desconocida': String(conBaseDesconocida),
        'x-likida-estado': 'generado_no_importado',
      },
    });
  }

  if (perfil.sistema !== 'sap_b1') return new NextResponse('Perfil ERP inconsistente', { status: 500 });
  // SAP B1 DTW son DOS archivos ligados por JdtNum. Ambos llevan un único
  // doble encabezado de la plantilla confirmada; devolverlos juntos evita que
  // se importe un hijo sin su cabecera.
  const sap = archivoSapB1(polizas.map((p) => p.poliza.ok ? p.poliza.poliza : null).filter((p): p is NonNullable<typeof p> => p !== null), perfil.plantilla);

  return NextResponse.json({
    formato: 'sap_b1_dtw',
    archivos: {
      'oJournalEntries.txt': sap.cabecera,
      'JournalEntries_Lines.txt': sap.lineas,
    },
    polizas: polizas.length,
    baseDesconocida: conBaseDesconocida,
    nota:
      'Son DOS archivos y el Data Transfer Workbench los importa juntos, ligados por JdtNum. ' +
      'El archivo está generado desde una plantilla confirmada para esta flota; Likida no puede afirmar que ya fue importado hasta que tu contador lo pruebe en su instancia.',
    estado: 'generado_no_importado',
    plantillaConfirmadaEn: perfil.confirmadoEn,
  });
}
