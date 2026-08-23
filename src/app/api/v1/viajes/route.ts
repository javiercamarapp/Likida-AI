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
import { supabaseAdmin } from '@/lib/supabase/admin';
import { exigir } from '@/lib/likida/pg';
import { acotada } from '@/lib/likida/presupuesto';
import { crearViaje, type NuevoViaje } from '@/lib/likida/operacion';
import { validarIngreso } from '@/lib/likida/ingreso_viaje';
import { abrir, leerPagina, leerCursor, codificarCursor, sobre, fallo, errorApi, type Cursor, type Pagina } from '../_comun';
import {
  leerCuerpo, leerLlaveIdempotencia, validar, escribir, huella,
  texto, uuid, fecha, monto, crudoNumerico, CampoInvalido,
  buscarViajePorFolio, viajeCoincide, type ViajeCreado, type ContenidoViaje,
} from '../_escritura';

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

/** Las columnas EXACTAS que proyecta `ViajeApi`, más las dos del cursor.
 *  `anticipo` no está y no es un olvido: ver la cabecera del archivo. */
const COLUMNAS_VIAJE =
  'id, folio, origen, destino, estatus, fecha_inicio, intake_pendientes, avisado_en, aceptado_en, escalado_en, avisos_enviados, created_at, operador:operador_id(nombre)';

type FilaViaje = Record<string, unknown>;

function aViajeApi(v: FilaViaje): ViajeApi {
  return {
    id: v.id as string,
    folio: (v.folio as string) || (v.id as string).slice(0, 8),
    origen: (v.origen as string) || null,
    destino: (v.destino as string) || null,
    estatus: v.estatus as string,
    fechaInicio: (v.fecha_inicio as string) || null,
    operador: ((v.operador as { nombre?: string } | null)?.nombre) ?? null,
    intakePendientes: Number(v.intake_pendientes ?? 0),
    avisadoEn: (v.avisado_en as string) || null,
    aceptadoEn: (v.aceptado_en as string) || null,
    escaladoEn: (v.escalado_en as string) || null,
    avisosEnviados: Number(v.avisos_enviados ?? 0),
  };
}

/**
 * UNA página del registro, leída con `range` REAL en la base.
 *
 * ── ESC-15 (escala 50k) ─────────────────────────────────────────────────
 *
 * Antes: `getViajes(tenant, desplazamiento + limite)` traía la ventana
 * ENTERA —hasta 1,000 filas— y `rebanar` cortaba en memoria la página de 50.
 * Dos costos: el servidor ordena y manda 1,000 filas para entregar 50, y la
 * ventana se topa en `VENTANA_MAXIMA` = 1,000, que a 50k viajes/mes es menos
 * de UN DÍA de operación: el TMS que quiera el histórico no tiene por dónde.
 *
 * Ahora la base entrega exactamente la página. El desempate por `id` —que es
 * lo que faltaba para poder usar `range` sin repetir/saltar filas entre
 * páginas (la advertencia de `pg.ts`)— va en el propio `order`, y el índice
 * de la 0157 es `(tenant_id, created_at desc, id desc)`, o sea el ORDER BY
 * completo.
 *
 * Se pide UNA FILA DE MÁS: así `hayMas` es un hecho medido y no una
 * derivación de `total`, y el `count: exact` —que a 50k viajes es un
 * `count(*)` por petición— deja de ser obligatorio (`?conteo=1`).
 */
async function leerViajes(
  tenantId: string,
  pagina: Pagina,
  despues: Cursor | null,
  conConteo: boolean,
): Promise<{ filas: FilaViaje[]; total: number | null }> {
  let q = supabaseAdmin()
    .from('viaje')
    .select(COLUMNAS_VIAJE, conConteo ? { count: 'exact' } : {})
    .eq('tenant_id', tenantId);

  // `(created_at, id) < (c, i)` en el dialecto de PostgREST: o es más viejo,
  // o es del mismo instante y su id va después en el orden. Sin la segunda
  // rama, dos viajes creados en el mismo microsegundo se pierden o se
  // repiten — que es exactamente el fallo contra el que advierte `pg.ts`.
  if (despues) {
    q = q.or(`created_at.lt.${despues.creadoEn},and(created_at.eq.${despues.creadoEn},id.lt.${despues.id})`);
  }

  q = q.order('created_at', { ascending: false }).order('id', { ascending: false });

  // Una fila de más para saber si hay página siguiente sin contar la tabla.
  const desde = despues ? 0 : pagina.desplazamiento;
  q = q.range(desde, desde + pagina.limite);

  const res = await acotada(q, 'v1.viajes');
  const filas = (exigir(res, 'v1.viajes') ?? []) as FilaViaje[];
  return { filas, total: typeof res.count === 'number' ? res.count : null };
}

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;
  const cur = leerCursor(req.url, pag.pagina);
  if (!cur.ok) return cur.respuesta;

  try {
    const { filas, total } = await leerViajes(acceso.tenantId, pag.pagina, cur.despues, cur.conteo);

    // ── EL RECORTE SILENCIOSO DE PostgREST, ATRAPADO ────────────────────────
    // PostgREST recorta a `max_rows` SIN avisar: no lanza, no loguea, devuelve
    // menos filas. Con `limite ≤ 200` la página pedida (limite + 1) cabe de
    // sobra bajo el techo por default (1,000, ver `pg.ts`), pero `max_rows` es
    // un ajuste de proyecto que se puede bajar. Cuando el integrador pidió el
    // total, se comprueba: página corta + total que dice que hay más = techo
    // del servidor, NO el final de la tabla. Servir eso sería decirle al TMS
    // "ya no hay más viajes" cuando sí los hay.
    const pedidas = pag.pagina.limite + 1;
    const leidas = (cur.despues ? 0 : pag.pagina.desplazamiento) + filas.length;
    if (filas.length < pedidas && total !== null && total > leidas) {
      return errorApi(
        'lectura_incompleta',
        'El servidor de datos recortó la lectura antes de llegar al final de la página pedida. No devolvemos una página corta como si fuera la última: pide un `limite` menor o avísanos.',
      );
    }

    const hayMas = filas.length > pag.pagina.limite;
    const pagina = filas.slice(0, pag.pagina.limite);
    const ultima = pagina.at(-1);
    const siguiente = hayMas && ultima
      ? codificarCursor({ creadoEn: String(ultima.created_at), id: String(ultima.id) })
      : null;

    return NextResponse.json(sobre(pagina.map(aViajeApi), pag.pagina, total, { hayMas, siguiente }));
  } catch (e) {
    return fallo('v1.viajes', e, { tenant: acceso.tenantId });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/viajes — el TMS de la flota despacha DESDE SU PROPIO CÓDIGO.
//
// Es la otra mitad del argumento de venta: hasta aquí Likida podía LEERSE
// desde un sistema ajeno, pero los viajes seguían capturándose a mano en el
// panel. Transportes Innovativos está reescribiendo su TMS y quiere que sus
// viajes entren aquí sin que nadie los vuelva a teclear.
//
// ── ÁREA `administracion`, NO `operacion` ────────────────────────────────
//
// El `GET` de arriba es `operacion` a propósito: un tablero de tráfico tiene
// que poder leer los viajes. CREARLOS no es el mismo permiso. Una llave de
// tablero —la que se pega en un Grafana o en el Looker de la flota, la que
// más manos toca y la que más fácil se filtra— no debe poder meter viajes al
// Registro del contralor. `administracion` la tienen el dueño y el superadmin
// (`lib/auth/visibilidad.ts`), y en una llave hay que pedirla explícitamente.
//
// ── LOS TRES CANDADOS DE LA BASE, DICHOS AQUÍ PARA QUE NADIE LOS DESCUBRA
//    EN PRODUCCIÓN ───────────────────────────────────────────────────────
//
// 1. `viaje.operador_id` es NOT NULL desde la 0001. Por eso `operadorId` es
//    OBLIGATORIO en esta ruta y no opcional como en `NuevoViaje`: mandarlo
//    vacío no crearía un viaje "sin asignar", tronaría con un 23502 que el
//    integrador no puede interpretar. Es el mismo lateral que el importador de
//    archivos ya documenta (`importar_viajes.ts`).
// 2. `uq_viaje_abierto_por_operador` (0029): un operador tiene A LO MÁS un
//    viaje sin liquidar. El choque sale como 400 explicando la regla, no como
//    500 — ver `traducirFalla`.
// 3. `viaje_folio_unico` (0092): (tenant_id, folio). Es la red DURABLE de la
//    idempotencia, y por eso `folio` es obligatorio aquí. Con folio NULL el
//    unique no participa (NULLS DISTINCT) y dos reintentos crearían dos
//    viajes: un viaje despachado por WhatsApp puede nacer sin folio porque
//    nadie lo va a reintentar, uno que entra por API no.
//
// ── ESTA RUTA LE ESCRIBE AL CHOFER ───────────────────────────────────────
//
// `crearViaje` avisa por WhatsApp al operador en cuanto el viaje existe
// (best-effort: si el aviso no sale, el viaje ya está creado y el panel lo
// sigue enseñando como no avisado). O sea que un POST aquí manda un mensaje a
// una persona. No es un efecto colateral que se pueda quitar por ser una API:
// es la operación que el jefe de tráfico pidió, y un viaje que el chofer no
// conoce es un viaje que no arranca.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tope de cordura del anticipo, con el mismo criterio que los de
 * `ingreso_viaje.ts`: no es un límite de negocio, es el dedazo que se atrapa al
 * capturar en vez de tres semanas después. El anticipo es el efectivo que la
 * empresa le adelanta al operador para diesel, casetas y comidas de UN viaje;
 * un millón de pesos es un cero de más, y si alguna vez fuera real se captura
 * hablando con nosotros.
 */
const TOPE_ANTICIPO = 1_000_000;

/**
 * El cuerpo de `POST /v1/viajes`, ya normalizado.
 *
 * ── EL `tenant_id` DEL CUERPO NO EXISTE EN ESTA FUNCIÓN ───────────────────
 *
 * No se lee, no se compara, no se rechaza: no se menciona. El tenant sale de
 * `abrir()` —o sea de la llave o de la cookie— y entra a `crearViaje` desde
 * ahí. Un campo que ninguna línea lee no puede cambiar de flota un viaje ni
 * por descuido; rechazarlo con un 400, en cambio, le tiraría la sincronización
 * a un TMS que reenvía su payload completo por costumbre. Es la misma decisión
 * que `urlSinTenant` toma con el `?tenant=` en `_comun.ts`, y está fijada por
 * prueba en `_escritura.test.ts`.
 */
function normalizarViaje(cuerpo: Record<string, unknown>): NuevoViaje & { folio: string } {
  const folio = texto(cuerpo, 'folio', { obligatorio: true, max: 64 });
  const operadorId = uuid(cuerpo, 'operadorId', { obligatorio: true });
  // `texto()` con `obligatorio` ya lanza si falta; el `if` es para TypeScript,
  // que no puede saberlo, y no una segunda validación.
  if (!folio || !operadorId) throw new CampoInvalido('folio', '`folio` y `operadorId` son obligatorios.');

  // El ingreso NO se valida aquí: se delega en el motor que ya distingue VACÍO
  // de CERO (`validarIngreso`). Un `ingresoFlete` ausente sale `null`, jamás 0.
  const ingreso = validarIngreso({
    clienteId: uuid(cuerpo, 'clienteId') ?? '',
    ingresoFlete: crudoNumerico(cuerpo, 'ingresoFlete'),
    kmRecorridos: crudoNumerico(cuerpo, 'kmRecorridos'),
  });

  return {
    folio,
    operadorId,
    origen: texto(cuerpo, 'origen', { max: 120 }),
    destino: texto(cuerpo, 'destino', { max: 120 }),
    fechaInicio: fecha(cuerpo, 'fechaInicio'),
    unidadId: uuid(cuerpo, 'unidadId'),
    clienteId: ingreso.clienteId,
    ingresoFlete: ingreso.ingresoFlete,
    kmRecorridos: ingreso.kmRecorridos,
    // ── EL ÚNICO CAMPO DONDE AUSENTE SE VUELVE UN NÚMERO, Y SE DICE ────────
    // `viaje.anticipo` es `numeric(12,2) NOT NULL DEFAULT 0` (0001): la columna
    // no puede guardar "no sé". Un viaje sin anticipo declarado es un viaje
    // donde la empresa no adelantó efectivo, y 0 es la medición correcta de
    // eso — no un relleno. La distinción vacío/cero que sí cambia una medición
    // (el INGRESO) vive donde puede: en `ingreso_flete`, que sí es nullable.
    anticipo: monto(cuerpo, 'anticipo', { min: 0, max: TOPE_ANTICIPO }) ?? 0,
  };
}

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  // La llave ANTES del cuerpo: es una cabecera y no cuesta leerla, así que una
  // integración a la que se le olvidó se entera sin que nadie parsee su JSON.
  const llave = leerLlaveIdempotencia(req);
  if (!llave.ok) return llave.respuesta;

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const v = validar('v1.viajes.post', () => normalizarViaje(cuerpo.cuerpo));
  if (!v.ok) return v.respuesta;
  const nuevo = v.valor;

  return escribir<ViajeCreado>({
    evento: 'v1.viajes.post',
    tenantId: acceso.tenantId,
    llave: llave.llave,
    huella: huella({
      folio: nuevo.folio,
      operadorId: nuevo.operadorId ?? null,
      origen: nuevo.origen ?? null,
      destino: nuevo.destino ?? null,
      fechaInicio: nuevo.fechaInicio ?? null,
      unidadId: nuevo.unidadId ?? null,
      clienteId: nuevo.clienteId ?? null,
      ingresoFlete: nuevo.ingresoFlete ?? null,
      kmRecorridos: nuevo.kmRecorridos ?? null,
      anticipo: nuevo.anticipo ?? 0,
    }),
    restriccion: 'viaje_folio_unico',
    // La MISMA consulta que encuentra la fila trae su contenido, y aquí se
    // decide si esta petición es un reintento (mismo contenido → 200) o un
    // cuerpo genuinamente distinto contra un folio ocupado (→ 409). Antes esa
    // segunda mitad no existía: los montos nuevos se descartaban en silencio
    // bajo un `200 {idempotente:true}` (hallazgo A8, auditoría 4).
    buscar: async () => {
      const x = await buscarViajePorFolio(acceso.tenantId, nuevo.folio);
      if (!x) return null;
      const pedido: ContenidoViaje = {
        operadorId: nuevo.operadorId ?? null,
        origen: nuevo.origen ?? null,
        destino: nuevo.destino ?? null,
        fechaInicio: nuevo.fechaInicio ?? null,
        unidadId: nuevo.unidadId ?? null,
        clienteId: nuevo.clienteId ?? null,
        ingresoFlete: nuevo.ingresoFlete ?? null,
        kmRecorridos: nuevo.kmRecorridos ?? null,
        anticipo: nuevo.anticipo ?? 0,
      };
      return { dato: x.dato, coincide: viajeCoincide(x.contenido, pedido) };
    },
    mensajeConflicto:
      `Ya existe un viaje con el folio \`${nuevo.folio}\` en tu flota, con contenido DISTINTO al que mandaste. ` +
      'Tus datos NO se guardaron. Consulta el viaje con `GET /v1/viajes/{id}`; esta API no actualiza viajes — las correcciones se capturan en el panel.',
    // EL TENANT SALE DE `acceso`, que salió de la credencial. Es el único
    // lugar de esta ruta donde se decide de qué flota es el viaje.
    crear: async () => ({
      id: await crearViaje(acceso.tenantId, nuevo),
      folio: nuevo.folio,
      // `crearViaje` escribe `estatus: 'abierto'` literal en el MISMO insert
      // que devolvió el id. No se relee: releer no lo haría más cierto, solo
      // más tarde.
      estatus: 'abierto',
    }),
  });
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
