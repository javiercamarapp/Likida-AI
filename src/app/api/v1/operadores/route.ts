// ═══════════════════════════════════════════════════════════════════════════
// /v1/operadores — el padrón de choferes de la flota.
//
// AUDITORÍA 24, bloqueante 3/4. Una flota que estrena Likida llega con 800
// tractos y varios cientos de choferes ya capturados en su TMS o en una hoja
// de cálculo. Teclearlos de nuevo no es solo trabajo: el teléfono es LA
// IDENTIDAD del chofer frente al bot de WhatsApp, y un dedazo en un dígito no
// produce un registro incompleto, produce un chofer que nunca puede reportar
// un gasto — o, peor, el teléfono de otra persona dentro de la flota.
//
// Por eso esta ruta existe y por eso acepta LOTE: el alta de un padrón entero
// es una sola operación del integrador, y partirla en 400 POST sueltos deja al
// TMS a media captura cuando se le cae la red, sin forma de saber por dónde
// iba.
//
// ── DOS ÁREAS, COMO EN `/v1/unidades` ────────────────────────────────────
//
// LEER el padrón es `operacion`: el jefe de tráfico es exactamente quien debe
// enterarse de que a un chofer se le venció la licencia y hoy no puede salir.
// DARLO DE ALTA es `administracion`: un chofer nuevo es una persona con
// contrato, y su alta dispara el aviso de privacidad.
//
// ── LO QUE ESTA RUTA NO DEVUELVE, A PROPÓSITO ────────────────────────────
//
// El RFC del operador NO viaja en la respuesta. Es dato fiscal de una persona
// física y ningún integrador de tráfico lo necesita para despachar un viaje;
// quien lo requiere para la nómina lo tiene ya en su propio sistema, que es de
// donde salió. Lo que no se manda no se puede filtrar.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import {
  getOperadoresRegistro, MAX_BUSQUEDA_OPERADORES, type FilaRegistroOperador,
} from '@/lib/likida/administracion';
import {
  validarOperadorImportado, importarOperadores,
  type OperadorCrudo, type OperadorImportado, type ResultadoImportacionOperadores,
} from '@/lib/likida/importacion/operadores';
import { DatoInvalido } from '@/lib/likida/errores';
import { resolverTerminalDeFlota } from '@/lib/likida/terminales';
// El tope de UN POST es la MISMA tanda con la que `importarOperadores` escribe
// por dentro: una petición que quepa en una tanda es una petición cuyo tiempo
// de respuesta el integrador puede predecir. Un padrón de 800 son cuatro POST,
// cada uno con su llave. Se importa, no se copia.
import { FILAS_POR_TANDA } from '@/lib/likida/importacion/archivo';
import { clasificarVigencia, DIAS_AVISO, type EstadoVigencia } from '@/lib/likida/vigencias';
import { diasEntreIso } from '@/lib/likida/relojes_legales';
import { hoyMx } from '@/lib/formato';
import { abrir, leerPagina, sobre, fallo, errorApi, type CuerpoError } from '../_comun';
import {
  leerCuerpo, leerLlaveIdempotencia, escribir, huella,
  texto, CampoInvalido,
} from '../_escritura';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET ────────────────────────────────────────────────────────────────────

export interface OperadorApi {
  id: string;
  nombre: string;
  /** `52` + 10 dígitos. `null` = a este chofer NADIE le capturó teléfono, y
   *  entonces no puede usar el bot. No es un `""` ni un 0. */
  telefono: string | null;
  numeroEmpleado: string | null;
  activo: boolean;
  /** Viajes que ya trae encima, para no dar de baja al que está en ruta. */
  viajes: number;
  terminalId: string | null;
  terminalNombre: string | null;
  licencia: {
    numero: string | null;
    tipo: string | null;
    /** ISO AAAA-MM-DD. `null` = sin capturar. */
    vence: string | null;
    /** vencido | por_vencer | vigente | sin_dato. `sin_dato` NO es `vigente`:
     *  a ese chofer nadie le capturó la licencia, no está en regla. */
    estado: EstadoVigencia;
    /** Negativo = ya venció. `null` = sin capturar. */
    diasAlVencimiento: number | null;
    /** La frase ya conjugada, la misma que ve el gerente en el panel. */
    rotulo: string;
  };
  /** Cuándo se le entregó el aviso de privacidad. `null` = TODAVÍA NO. */
  avisoPrivacidadEn: string | null;
}

function aOperadorApi(f: FilaRegistroOperador, hoy: string): OperadorApi {
  // La MISMA cuenta que usa el briefing de WhatsApp del chofer (`diasEntreIso`
  // sobre el día de México), para que el panel, el bot y esta API no digan tres
  // números distintos del mismo vencimiento.
  const dias = f.licenciaVence ? diasEntreIso(hoy, f.licenciaVence.slice(0, 10)) : null;
  const v = clasificarVigencia(dias, f.licenciaVence ? 'Licencia' : null);
  return {
    id: f.operadorId,
    nombre: f.nombre,
    telefono: f.telefono,
    numeroEmpleado: f.numeroEmpleado,
    activo: f.activo,
    viajes: f.viajes,
    terminalId: f.terminalId,
    terminalNombre: f.terminalNombre,
    licencia: {
      numero: f.licencia,
      tipo: f.licenciaTipo,
      vence: f.licenciaVence,
      estado: v.estado,
      diasAlVencimiento: dias,
      rotulo: v.rotulo,
    },
    avisoPrivacidadEn: f.avisoPrivacidadEn,
  };
}

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length > MAX_BUSQUEDA_OPERADORES) {
    return errorApi('parametro_invalido', `\`q\` no puede pasar de ${MAX_BUSQUEDA_OPERADORES} caracteres.`);
  }

  try {
    // La base corta la página sobre un orden TOTAL y devuelve el `total` en la
    // misma respuesta: a cientos de choferes el padrón entero no viaja. El
    // `total` es un `count` real, NO el largo de esta página.
    const pagina = Math.floor(pag.pagina.desplazamiento / pag.pagina.limite) + 1;
    if (pag.pagina.desplazamiento % pag.pagina.limite !== 0) {
      return errorApi(
        'parametro_invalido',
        `\`desplazamiento\` tiene que ser múltiplo de \`limite\` en esta ruta (el padrón se pagina por páginas completas). Con \`limite=${pag.pagina.limite}\`, usa 0, ${pag.pagina.limite}, ${pag.pagina.limite * 2}…`,
      );
    }
    const hoy = hoyMx();
    const r = await getOperadoresRegistro(acceso.tenantId, { q, pagina, porPagina: pag.pagina.limite });
    return NextResponse.json({
      ...sobre(r.filas.map((f) => aOperadorApi(f, hoy)), pag.pagina, r.total),
      /** Con cuántos días de anticipación una licencia pasa a `por_vencer`.
       *  Viaja en la respuesta para que el integrador no lo fije por su cuenta
       *  en otro número. */
      diasAviso: DIAS_AVISO,
    });
  } catch (e) {
    return fallo('v1.operadores', e, { tenant: acceso.tenantId });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/operadores — alta del padrón, de uno o en lote.
//
// ── EL LOTE ES UNA OPERACIÓN, NO N OPERACIONES ───────────────────────────
//
// El cuerpo acepta las dos formas y son la misma por dentro:
//   · `{ "nombre": …, "telefono": … }`              → lote de 1
//   · `{ "operadores": [ {…}, {…}, … ] }`           → lote de N
//
// La `Idempotency-Key` cubre EL LOTE ENTERO: mismo lote reintentado tras un
// timeout devuelve la MISMA respuesta, con los mismos ids, sin crear a nadie
// dos veces. Debajo del recuerdo hay una segunda red que no depende de la
// memoria de ninguna instancia: el teléfono es único por flota en la base, así
// que un reintento sin llave —o con llave caducada— tampoco duplica; las filas
// que ya estaban salen en `duplicados`, no en `creados`.
//
// ── UNA FILA MALA NO TIRA EL LOTE ────────────────────────────────────────
//
// Un padrón real trae filas sucias: un teléfono de 9 dígitos, un nombre vacío,
// un chofer que ya está de alta en otra flota. Rechazar las 400 por una sería
// devolverle al integrador un trabajo que ya hizo bien 399 veces. Cada fila
// mala sale en `errores` con su número de fila y el QUÉ corregir, y las buenas
// se escriben. El acuse dice exactamente cuántas de cada una, y esos números
// son los que la ruta contó — no una estimación.
//
// Lo que SÍ tira el lote entero, antes de escribir nada: un cuerpo que no es
// un lote, un lote vacío, o un lote más largo que `MAX_LOTE`. Son errores de
// forma, y a esos se contesta 400 sin tocar la base.
// ═══════════════════════════════════════════════════════════════════════════

/** El 400 de un lote donde NINGUNA fila sirve: el error común de /v1 más el
 *  detalle fila por fila. Es un superconjunto de `CuerpoError`, no otra forma. */
export interface CuerpoErrorPorFila extends CuerpoError {
  error: CuerpoError['error'] & { filas: Array<{ fila: number; motivo: string }> };
}

/** Lo que se acusa de un lote. Los tres números suman las filas mandadas. */
export interface LoteOperadoresCreado {
  creados: ResultadoImportacionOperadores['creados'];
  duplicados: ResultadoImportacionOperadores['duplicados'];
  errores: ResultadoImportacionOperadores['errores'];
  /** Cuántos de los creados traen el aviso de privacidad por entregar. Se
   *  entrega en su primer mensaje al bot; aquí solo se dice cuántos son. */
  avisoPendiente: number;
  /** Cuántas filas traía el cuerpo. `creados + duplicados + errores` da esto
   *  siempre: si no diera, alguna fila se habría perdido en silencio. */
  recibidas: number;
}

type LecturaLote =
  | { ok: true; filas: unknown[] }
  | { ok: false; respuesta: NextResponse };

/** Saca las filas del cuerpo en cualquiera de sus dos formas. */
function leerLote(cuerpo: Record<string, unknown>, campo: string, max: number): LecturaLote {
  const crudo = cuerpo[campo];
  if (crudo === undefined) {
    // Forma corta: el cuerpo ES la fila. Un lote de 1. `terminalId` es del
    // lote, no de la fila, y `normalizarOperador` no lo lee — sobra sin daño.
    return { ok: true, filas: [cuerpo] };
  }
  if (!Array.isArray(crudo)) {
    return { ok: false, respuesta: errorApi('parametro_invalido', `\`${campo}\` tiene que ser una lista. Para dar de alta uno solo, manda sus campos en la raíz del cuerpo.`) };
  }
  if (crudo.length === 0) {
    // Un lote vacío no es un no-op silencioso: es casi siempre un bug del
    // integrador (el filtro de su lado devolvió 0). Se dice.
    return { ok: false, respuesta: errorApi('parametro_invalido', `\`${campo}\` llegó vacío. Un lote sin filas no da de alta a nadie; revisa el filtro de tu lado.`) };
  }
  if (crudo.length > max) {
    return {
      ok: false,
      respuesta: errorApi('parametro_invalido', `\`${campo}\` trae ${crudo.length} filas y el máximo por petición es ${max}. Pártelo en tandas de ${max}, cada una con su \`Idempotency-Key\` propia.`),
    };
  }
  for (const f of crudo) {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) {
      return { ok: false, respuesta: errorApi('parametro_invalido', `Cada elemento de \`${campo}\` tiene que ser un objeto con los campos de la fila.`) };
    }
  }
  return { ok: true, filas: crudo };
}

/** Normaliza una fila del lote. Lanza `CampoInvalido` con el QUÉ corregir. */
function normalizarOperador(cuerpo: Record<string, unknown>, fila: number): OperadorImportado {
  // Como en el resto de /v1: un `tenant_id` en el cuerpo no se lee aquí ni en
  // ningún otro sitio de la ruta. El tenant sale de `abrir()`.
  const nombre = texto(cuerpo, 'nombre', { obligatorio: true, max: 120 });
  if (!nombre) throw new CampoInvalido('nombre', '`nombre` es obligatorio.');
  // Sin `obligatorio: true`: ese camino lanza «`telefono` es obligatorio.» y
  // aquí el porqué importa más que el qué. Un integrador que lee «es la
  // identidad del chofer» entiende que no puede mandar el campo vacío y
  // rellenarlo después; con el mensaje genérico, lo rellena después.
  const telefono = texto(cuerpo, 'telefono', { max: 25 });
  if (!telefono) throw new CampoInvalido('telefono', 'Falta el `telefono`: es la identidad del chofer frente al bot de WhatsApp, y sin él no puede reportar un gasto.');

  const crudo: OperadorCrudo = {
    nombre,
    telefono,
    numeroEmpleado: texto(cuerpo, 'numeroEmpleado', { max: 40 }),
    rfc: texto(cuerpo, 'rfc', { max: 13 }),
    licencia: texto(cuerpo, 'licencia', { max: 40 }),
    licenciaTipo: texto(cuerpo, 'licenciaTipo', { max: 10 }),
    licenciaVence: texto(cuerpo, 'licenciaVence', { max: 10 }),
  };
  try {
    return validarOperadorImportado(crudo, fila);
  } catch (e) {
    // `validarOperadorImportado` es la MISMA validación que usa el panel y que
    // usa la importación por archivo. Su mensaje ya dice qué corregir; aquí
    // solo se le pone el vestido de error de API.
    if (e instanceof DatoInvalido) throw new CampoInvalido('operador', e.message);
    throw e;
  }
}

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const llave = leerLlaveIdempotencia(req);
  if (!llave.ok) return llave.respuesta;

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const lote = leerLote(cuerpo.cuerpo, 'operadores', FILAS_POR_TANDA);
  if (!lote.ok) return lote.respuesta;

  // Se valida TODO el lote antes de escribir NADA: las filas buenas van a la
  // base, las malas se acusan por su número de fila. `fila` empieza en 1 y es
  // la posición en la lista que mandó el integrador — el mismo índice que él
  // puede señalar en su propio arreglo.
  const buenas: OperadorImportado[] = [];
  const errores: Array<{ fila: number; motivo: string }> = [];
  for (let i = 0; i < lote.filas.length; i++) {
    try {
      buenas.push(normalizarOperador(lote.filas[i] as Record<string, unknown>, i + 1));
    } catch (e) {
      // Los DOS errores que se le enseñan al integrador son los que se
      // escribieron para que alguien los lea, igual que en `validar()`:
      // `CampoInvalido` (nombra el campo) y `DatoInvalido` (ya redactado para
      // una persona). Cualquier otra excepción es una falla NUESTRA y no se
      // convierte en «esta fila venía mal»: se va por `fallo()`, que además
      // corta el mensaje interno.
      if (!(e instanceof CampoInvalido || e instanceof DatoInvalido)) {
        return fallo('v1.operadores.post', e, { tenant: acceso.tenantId, fila: i + 1 });
      }
      errores.push({ fila: i + 1, motivo: e.message });
    }
  }

  const recibidas = lote.filas.length;

  // El patio (terminal) es del LOTE, no de la fila: un alta masiva es
  // típicamente la plantilla de un patio. Opcional; sin él los choferes nacen
  // sin patio, que es la verdad y no un patio inventado.
  //
  // SE RESUELVE AQUÍ, ANTES DE `escribir`: un patio que no es de esta flota es
  // un error del INTEGRADOR y merece un 400 que lo diga. Dentro de `crear()`
  // el `DatoInvalido` caería en `traducirFalla`, que no lo conoce, y saldría
  // un 500 — «me falló algo» en vez de «ese patio no es tuyo».
  let terminalId: string | null;
  try {
    terminalId = await resolverTerminalDeFlota(acceso.tenantId, texto(cuerpo.cuerpo, 'terminalId', { max: 40 }));
  } catch (e) {
    if (e instanceof DatoInvalido) return errorApi('parametro_invalido', e.message);
    return fallo('v1.operadores.post', e, { tenant: acceso.tenantId });
  }

  // Ni una sola fila válida: no hay escritura que hacer, y contestar 201 con
  // `creados: []` haría que el integrador tachara el lote como entregado. Es
  // un 400 con el detalle fila por fila.
  if (buenas.length === 0) {
    const cuerpoError: CuerpoErrorPorFila = {
      error: {
        codigo: 'parametro_invalido',
        mensaje: `Ninguna de las ${recibidas} filas del lote es válida; no se dio de alta a nadie. Corrige lo que dice cada fila y reintenta con una \`Idempotency-Key\` nueva.`,
        // El detalle POR FILA, además del mensaje: un lote de 200 que rebota
        // entero sin decir cuáles fallaron obliga al integrador a bisecar a
        // mano. `codigo` y `mensaje` siguen ahí para quien solo ramifica sobre
        // el contrato común de /v1.
        filas: errores,
      },
    };
    return NextResponse.json(cuerpoError, { status: 400 });
  }

  return escribir<LoteOperadoresCreado>({
    evento: 'v1.operadores.post',
    tenantId: acceso.tenantId,
    llave: llave.llave,
    // La huella es del LOTE NORMALIZADO: reintentar el mismo lote con las
    // llaves del JSON en otro orden sigue siendo la misma operación, y un
    // `tenant_id` colado en el cuerpo no la cambia porque no entra aquí.
    huella: huella({
      filas: buenas.map((f) => `${f.telefono}|${f.nombre}|${f.numeroEmpleado ?? ''}|${f.licencia ?? ''}|${f.licenciaVence ?? ''}`).join('\n'),
      terminalId: terminalId ?? '',
      invalidas: errores.length,
      recibidas,
    }),
    // El lote no choca contra un unique: `importarOperadores` lee el padrón
    // primero y manda a `duplicados` lo que ya estaba. Esta restricción existe
    // para el contrato de `escribir` y no llega a dispararse.
    restriccion: 'operador_telefono_unico',
    // No hay "llave natural del lote": la dedup por fila la hace
    // `importarOperadores` contra el padrón. Aquí solo manda el recuerdo.
    buscar: async () => null,
    mensajeConflicto: 'Ese lote ya se procesó con otro contenido. Consulta el padrón con `GET /v1/operadores`.',
    crear: async () => {
      const r = await importarOperadores(acceso.tenantId, buenas, {
        origen: 'api',
        terminalId,
        actor: { id: `llave:${acceso.rol}` },
      });
      // `importarOperadores` solo pone `error` cuando NO escribió nada porque
      // no pudo leer el padrón. Fallar cerrado: se lanza para que salga un 503
      // con cuerpo, no un 201 con `creados: []` que se leería como "ya está".
      if (r.error) throw new Error(`importarOperadores: ${r.error}`);
      return {
        creados: r.creados,
        duplicados: r.duplicados,
        // Los errores de forma (de aquí) y los de escritura (de la
        // importación) son la misma lista para quien lee el acuse: lo que le
        // importa es qué filas no quedaron.
        errores: [...errores, ...r.errores].sort((a, b) => a.fila - b.fila),
        avisoPendiente: r.avisoPendiente,
        recibidas,
      };
    },
  });
}
