// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/viajes — el registro de viajes de la flota, para un TMS ajeno.
//
// Es la ruta que sostiene el argumento de venta: no importa qué TMS use hoy la
// flota ni cuál esté escribiendo para dentro de año y medio, Likida es una capa
// encima y esta lista sobrevive a la migración. Por eso es de LECTURA y por eso
// las llaves del JSON están en español (ver la nota del final del archivo).
//
// ── AQUÍ NO SALE UN PESO ─────────────────────────────────────────────────
//
// `getViajes` devuelve `anticipo` y esta ruta NO lo proyecta. No es un olvido:
// la clasificación del panel pone el registro de viajes en el área `operacion`
// (`lib/auth/visibilidad.ts`), y el 4-ago-2026 hubo cuatro pantallas de
// operación enseñando dinero — anticipo por viaje entre ellas — a la vista del
// jefe de tráfico, que es precisamente el rol que no ve finanzas. La API
// hereda esa línea: el dinero de un viaje vive en
// `/v1/viajes/{id}/contribucion`, que se gatea por `dinero`.
//
// Un integrador que necesite el anticipo tiene que pedirlo: es una decisión de
// producto, no un hueco que se tape agregando la columna.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getViajes, contarViajes, type ViajeRow } from '@/lib/likida/analytics';
import { abrir, leerPagina, rebanar, sobre, fallo, errorApi } from '../_comun';

export const runtime = 'nodejs';
// Sin esto Next puede cachear la respuesta de una ruta GET, y una API
// multi-tenant que cachea es una API que le sirve la flota A a la flota B.
export const dynamic = 'force-dynamic';

/** Lo que /v1 promete de un viaje. Deliberadamente MENOS que `ViajeRow`. */
export interface ViajeApi {
  id: string;
  /** `viaje.folio`, o los 8 primeros del uuid si la flota no lo captura. */
  folio: string;
  origen: string | null;
  destino: string | null;
  /** `abierto | en_cuadre | liquidado` (constraint `viaje_estatus_dominio`). */
  estatus: string;
  fechaInicio: string | null;
  operador: string | null;
  /** Comprobantes recibidos por WhatsApp que el motor aún no ha procesado. */
  intakePendientes: number;
  /** Los cuatro sellos de la confirmación del chofer (mig. 0058). `null` en
   *  `avisadoEn` es "no hay registro del aviso"; el 0 de `avisosEnviados` es un
   *  conteo real. No se aplastan a un mismo valor. */
  avisadoEn: string | null;
  aceptadoEn: string | null;
  escaladoEn: string | null;
  avisosEnviados: number;
}

function aViajeApi(v: ViajeRow): ViajeApi {
  return {
    id: v.id,
    folio: v.folio,
    origen: v.origen,
    destino: v.destino,
    estatus: v.estatus,
    fechaInicio: v.fechaInicio,
    operador: v.operadorNombre,
    intakePendientes: v.intakePendientes,
    avisadoEn: v.avisadoEn,
    aceptadoEn: v.aceptadoEn,
    escaladoEn: v.escaladoEn,
    avisosEnviados: v.avisosEnviados,
  };
}

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;
  const { limite, desplazamiento } = pag.pagina;

  try {
    // `getViajes` no acepta desplazamiento: pide los N MÁS RECIENTES y ya. Se
    // le pide la ventana completa y se rebana. Es más caro que un `range`, y
    // aun así es lo correcto hoy: `getViajes` ordena por `created_at` SIN
    // desempate único, y `pg.ts` advierte que un `range` sobre un orden que
    // empata puede repetir una fila y saltarse otra entre dos páginas. Una
    // sola foto rebanada no tiene ese problema.
    //
    // ANOTADO (no se toca en esta entrega): para paginar de verdad,
    // `getViajes` necesita `.order('id')` de desempate y un parámetro de
    // `range`. Con eso, `VENTANA_MAXIMA` deja de hacer falta.
    const [todos, total] = await Promise.all([
      getViajes(acceso.tenantId, desplazamiento + limite),
      contarViajes(acceso.tenantId),
    ]);

    // ── EL RECORTE SILENCIOSO DE PostgREST, ATRAPADO ────────────────────────
    // `getViajes` usa `.limit(n)` y PostgREST recorta a `max_rows` SIN avisar:
    // no lanza, no loguea, devuelve menos filas. Si pedimos N, vinieron menos
    // de N, y el conteo dice que hay más de las que vinieron, entonces lo que
    // tenemos es el techo del servidor y NO el final de la tabla. Servir eso
    // como una página normal sería decirle al TMS "ya no hay más viajes"
    // cuando sí los hay — la clase de mentira que define este producto.
    const pedidas = desplazamiento + limite;
    if (todos.length < pedidas && total !== null && total > todos.length) {
      return errorApi(
        'lectura_incompleta',
        'El servidor de datos recortó la lectura antes de llegar a la página pedida. No devolvemos una página corta como si fuera la última: pide un `desplazamiento` menor o avísanos para paginar del lado del servidor.',
      );
    }

    return NextResponse.json(sobre(rebanar(todos, pag.pagina).map(aViajeApi), pag.pagina, total));
  } catch (e) {
    return fallo('v1.viajes', e, { tenant: acceso.tenantId });
  }
}

// ── POR QUÉ LAS LLAVES VAN EN ESPAÑOL ──────────────────────────────────────
//
// `folio`, `viaje`, `unidad`, `operador`, `liquidacion` y `comprobado` son los
// nombres de la cosa en el negocio, no traducciones: es lo que dice el papel
// que el contralor cruza contra su ERP y es como se llaman las columnas de la
// base. Traducirlos al inglés en el borde crearía un segundo vocabulario para
// las mismas cifras, y el modo de falla de tener dos vocabularios ya está
// documentado en este repo: una cifra que se lee distinto en dos sitios se lee
// como dos cálculos distintos.
//
// El precio es que un integrador que no hable español tiene que leer el
// OpenAPI. Es un precio bajo: el comprador es una flota mexicana y quien va a
// escribir el cliente es su propio equipo de sistemas.
