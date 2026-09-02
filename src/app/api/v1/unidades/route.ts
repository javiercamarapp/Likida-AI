// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/unidades — el parque vehicular con sus vigencias de ley.
//
// Es la ruta que más vale de las cuatro para un TMS ajeno, porque el dato que
// devuelve no lo tiene el TMS: si una unidad puede salir HOY a carretera. Una
// unidad con la verificación vencida o el permiso SICT caducado no es una
// unidad con un papel pendiente, es una unidad que no debería estar rodando, y
// la multa, la detención y el seguro que no responde son del dueño de la flota.
//
// El motor ya existía (`getUnidades` elige el papel MÁS PRÓXIMO a vencer de los
// tres y devuelve los días, negativos si ya venció) y la clasificación también
// (`clasificarVigencia`). Aquí se juntan para que el número y su significado
// viajen en la misma respuesta: mandar `diasAlVencimiento: -3` a pelo obliga al
// integrador a reimplementar el criterio, y a la tercera implementación una de
// ellas va a decir que -3 es "vigente".
//
// ── `sin_dato` NO ES `vigente`, Y ESA ES LA LÍNEA ────────────────────────
//
// `diasAlVencimiento: null` significa que a esa unidad NADIE le capturó papeles.
// No está en regla: está sin verificar. La API lo manda como estado
// `sin_dato`, nunca como `vigente` ni como 0 días. Pintarla en verde sería el
// caso exacto que este producto no se permite — el gerente la vería en la lista
// de "todo al día" y se enteraría del problema cuando lo pare un inspector.
//
// Área `operacion`: aquí no se enseña un peso, y el jefe de tráfico es
// EXACTAMENTE quien debe enterarse de que una unidad no puede salir.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getUnidades, crearUnidad, type UnidadRow, type NuevaUnidad } from '@/lib/likida/operacion';
import { clasificarVigencia, contarVigencias, DIAS_AVISO, type EstadoVigencia } from '@/lib/likida/vigencias';
import { abrir, leerPagina, rebanar, sobre, fallo, errorApi, type CuerpoError } from '../_comun';
import {
  leerCuerpo, leerLlaveIdempotencia, validar, escribir, huella,
  texto, entero, CampoInvalido,
  buscarUnidadPorEconomico, unidadCoincide, type UnidadCreada, type ContenidoUnidad,
  ANIO_MIN_UNIDAD,
} from '../_escritura';
import { DatoInvalido } from '@/lib/likida/errores';
import { resolverTerminalDeFlota } from '@/lib/likida/terminales';
// El tope de UN POST es la MISMA tanda con la que `importarUnidades` escribe
// por dentro: una petición que quepa en una tanda es una petición cuyo tiempo
// de respuesta el integrador puede predecir. Un parque de 800 son cuatro POST,
// cada uno con su llave. Se importa, no se copia: un segundo 200 escrito aquí
// se despegaría del real la primera vez que alguien mueva uno de los dos.
import { FILAS_POR_TANDA } from '@/lib/likida/importacion/archivo';
import {
  validarUnidadImportada, importarUnidades,
  type UnidadCrudaImportada, type UnidadImportada, type ResultadoImportacionUnidades,
} from '@/lib/likida/importacion/unidades';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface UnidadApi {
  id: string;
  numeroEconomico: string;
  placas: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  /** Dominio de `unidad.estado` (0047): disponible, en_viaje, taller, baja. */
  estado: string;
  /** `null` = no se ha capturado el odómetro. NUNCA 0. */
  kmActual: number | null;
  activo: boolean;
  ordenesAbiertas: number;
  vigencia: {
    /** vencido | por_vencer | vigente | sin_dato. */
    estado: EstadoVigencia;
    /** Días al vencimiento MÁS PRÓXIMO de los tres papeles. NEGATIVO = ya
     *  venció. `null` = ningún papel capturado, y entonces `estado` es
     *  `sin_dato` — que no es lo mismo que estar en regla. */
    diasAlVencimiento: number | null;
    /** Cuál de los tres papeles es el que vence antes. `null` sin dato. */
    queVence: string | null;
    /** La frase ya conjugada, la misma que ve el gerente en el panel. */
    rotulo: string;
    /** Si esto le pide algo a una persona HOY. */
    pide: boolean;
  };
}

function aUnidadApi(u: UnidadRow): UnidadApi {
  const v = clasificarVigencia(u.diasAlVencimiento, u.queVence);
  return {
    id: u.id,
    numeroEconomico: u.numeroEconomico,
    placas: u.placas,
    marca: u.marca,
    modelo: u.modelo,
    anio: u.anio,
    estado: u.estado,
    kmActual: u.kmActual,
    activo: u.activo,
    ordenesAbiertas: u.ordenesAbiertas,
    vigencia: {
      estado: v.estado,
      diasAlVencimiento: u.diasAlVencimiento,
      queVence: u.queVence,
      rotulo: v.rotulo,
      pide: v.pide,
    },
  };
}

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;

  try {
    // `getUnidades` usa `traerTodo`: o trae TODAS las unidades de la flota o
    // lanza `LecturaIncompleta`. Por eso aquí el total es exacto y se puede
    // rebanar en memoria sin arriesgar el salto de filas que tendría un
    // `range` sobre un orden que empata (`numero_economico` no es único).
    const todas = await getUnidades(acceso.tenantId);
    const resumen = contarVigencias(todas);

    return NextResponse.json({
      ...sobre(rebanar(todas, pag.pagina).map(aUnidadApi), pag.pagina, todas.length),
      // El resumen es de la FLOTA ENTERA, no de la página: es lo que se pinta
      // en un semáforo, y un semáforo calculado sobre 50 de 300 unidades diría
      // que no hay nada vencido porque los vencidos cayeron en la página 3.
      resumen: {
        ...resumen,
        /** Con cuántos días de anticipación empieza a avisar `por_vencer`.
         *  Viaja en la respuesta para que el integrador no lo adivine ni lo
         *  fije por su cuenta en otro número. */
        diasAviso: DIAS_AVISO,
      },
    });
  } catch (e) {
    return fallo('v1.unidades', e, { tenant: acceso.tenantId });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/unidades — dar de alta el parque desde el TMS de la flota.
//
// Una flota que estrena Likida tiene entre 20 y 300 unidades ya capturadas en
// su sistema. Teclearlas otra vez a mano no es solo trabajo: es la primera
// oportunidad de que el número económico no coincida entre los dos sistemas, y
// a partir de ahí ninguna unidad se puede cruzar.
//
// ── ÁREA `administracion`, aunque el GET sea `operacion` ─────────────────
//
// LEER el parque es del jefe de tráfico —es exactamente quien debe enterarse
// de que una unidad no puede salir— y por eso el `GET` de arriba es
// `operacion`. DARLA DE ALTA es del dueño: una unidad nueva es un activo de la
// empresa y su alta cambia el denominador de todo lo que se mide por unidad.
// Son dos permisos distintos y aquí se piden distintos.
//
// ── DOS FORMAS DE CUERPO, Y NO CAPTURAN LO MISMO ─────────────────────────
//
// · UNA unidad (los campos en la raíz del cuerpo) — el camino de siempre, sin
//   cambios. Pasa por `crearUnidad` y por eso NO captura las tres fechas de
//   vigencia: `NuevaUnidad` (`lib/likida/operacion.ts`) no las acepta. Una
//   unidad creada así nace con `vigencia.estado = 'sin_dato'`, que es la
//   verdad —nadie le capturó papeles— y no `vigente`, que sería la mentira que
//   la cabecera de este archivo existe para prohibir.
//
// · UN LOTE (`{ "unidades": [ … ] }`, auditoría 24) — el camino del alta
//   masiva. Pasa por `importarUnidades`, que SÍ escribe póliza, permiso SICT y
//   verificación, y además exige placa. Es el que debe usar una flota que
//   estrena Likida con 800 tractos: 800 POST sueltos dejan al TMS a media
//   captura cuando se le cae la red, sin forma de saber por dónde iba.
//
// Que las dos formas capturen distinto está dicho aquí y en el OpenAPI. Lo que
// no se hace es fingir que la forma corta guardó unas fechas que no recibió.
//
// ── LO QUE NINGUNA DE LAS DOS CAPTURA ────────────────────────────────────
//
// Ni `estado` ni `kmActual`. Los dos son mediciones de la operación, no del
// alta: el estado lo mueve el despacho y el odómetro lo reporta el chofer.
// Nacer con `kmActual: 0` sería afirmar que la unidad tiene cero kilómetros.
// ═══════════════════════════════════════════════════════════════════════════

/** El primer año de una unidad de carga que siga rodando. Un `1900` es un
 *  dedazo; un año en el futuro lejano también. `+2` porque los modelos se
 *  venden adelantados. */

function normalizarUnidad(cuerpo: Record<string, unknown>, hoy = new Date()): NuevaUnidad {
  // Igual que en `POST /v1/viajes`: un `tenant_id` en el cuerpo no se lee aquí
  // ni en ningún otro sitio de la ruta. El tenant sale de `abrir()`.
  const numeroEconomico = texto(cuerpo, 'numeroEconomico', { obligatorio: true, max: 40 });
  if (!numeroEconomico) throw new CampoInvalido('numeroEconomico', '`numeroEconomico` es obligatorio.');

  return {
    numeroEconomico,
    placas: texto(cuerpo, 'placas', { max: 20 }),
    marca: texto(cuerpo, 'marca', { max: 60 }),
    modelo: texto(cuerpo, 'modelo', { max: 60 }),
    anio: entero(cuerpo, 'anio', { min: ANIO_MIN_UNIDAD, max: hoy.getUTCFullYear() + 2 }),
  };
}

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const llave = leerLlaveIdempotencia(req);
  if (!llave.ok) return llave.respuesta;

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;

  // La forma del cuerpo elige el camino, y la elección es explícita: si viene
  // `unidades`, es un lote; si no, es una unidad. No se adivina por el número
  // de campos ni se acepta que vengan las dos cosas a la vez.
  if (cuerpo.cuerpo.unidades !== undefined) {
    if (typeof cuerpo.cuerpo.numeroEconomico === 'string') {
      return errorApi('parametro_invalido', 'El cuerpo trae `unidades` (lote) y además `numeroEconomico` (unidad suelta). Manda una de las dos formas, no las dos.');
    }
    return postLote(acceso.tenantId, acceso.rol, llave.llave, cuerpo.cuerpo);
  }

  const v = validar('v1.unidades.post', () => normalizarUnidad(cuerpo.cuerpo));
  if (!v.ok) return v.respuesta;
  const nueva = v.valor;

  return escribir<UnidadCreada>({
    evento: 'v1.unidades.post',
    tenantId: acceso.tenantId,
    llave: llave.llave,
    huella: huella({
      numeroEconomico: nueva.numeroEconomico,
      placas: nueva.placas ?? null,
      marca: nueva.marca ?? null,
      modelo: nueva.modelo ?? null,
      anio: nueva.anio ?? null,
    }),
    // (tenant_id, numero_economico), mig. 0047. Es la red durable: el número
    // económico es como la flota llama a la unidad en la radio y en el papel,
    // así que un reintento trae el mismo y choca aquí en vez de crear un
    // segundo camión que no existe.
    restriccion: 'unidad_economico_unico',
    // Igual que en `POST /v1/viajes`: mismo contenido → 200 idempotente;
    // mismo número económico con OTRO contenido → 409 que lo dice, en vez de
    // descartar placas y año en silencio (hallazgo A8, auditoría 4).
    buscar: async () => {
      const x = await buscarUnidadPorEconomico(acceso.tenantId, nueva.numeroEconomico);
      if (!x) return null;
      const pedido: ContenidoUnidad = {
        placas: nueva.placas ?? null,
        marca: nueva.marca ?? null,
        modelo: nueva.modelo ?? null,
        anio: nueva.anio ?? null,
      };
      return { dato: x.dato, coincide: unidadCoincide(x.contenido, pedido) };
    },
    mensajeConflicto:
      `Ya existe una unidad con el número económico \`${nueva.numeroEconomico}\` en tu flota, con contenido DISTINTO al que mandaste. ` +
      'Tus datos NO se guardaron. Consulta tus unidades con `GET /v1/unidades`; las correcciones se capturan en el panel.',
    crear: async () => ({
      id: await crearUnidad(acceso.tenantId, nueva),
      numeroEconomico: nueva.numeroEconomico,
    }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EL LOTE — `{ "unidades": [ … ] }` (auditoría 24, bloqueante 3/4)
//
// ── LA IDEMPOTENCIA TIENE DOS REDES, Y LA DE ABAJO NO DEPENDE DE NOSOTROS ─
//
// La `Idempotency-Key` cubre EL LOTE ENTERO: el mismo lote reintentado tras un
// timeout devuelve la MISMA respuesta, con los mismos ids, sin crear nada dos
// veces. Debajo hay una red que no depende de la memoria de ninguna instancia
// ni de que la llave siga viva: el `upsert` va por `(tenant_id,
// numero_economico)` con `ignoreDuplicates`, así que un reintento sin llave
// tampoco duplica — las unidades que ya estaban salen en `duplicadas`, no en
// `creadas`, y NO SE LES PISA NADA de lo que ya tenían.
//
// Ese "no se pisa" es deliberado y es lo contrario de lo que haría un upsert
// normal: si la unidad T-042 ya está en Likida con su póliza al día y el TMS
// remanda el lote con la póliza vieja que traía en su exportación, sobrescribir
// borraría un dato bueno con uno viejo. El alta masiva DA DE ALTA; corregir es
// otra operación y se hace en el panel.
//
// ── UNA FILA MALA NO TIRA EL LOTE ────────────────────────────────────────
//
// Un parque real trae filas sucias: una placa repetida, un año de 1900, una
// unidad sin número económico. Cada una sale en `errores` con su número de
// fila y el QUÉ corregir; las buenas se escriben. Lo que sí tira el lote
// entero, antes de escribir nada, es un cuerpo que no es un lote, un lote
// vacío o uno más largo que `FILAS_POR_TANDA`.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que se acusa de un lote. Los tres números suman las filas mandadas. */
export interface LoteUnidadesCreado {
  creadas: ResultadoImportacionUnidades['creadas'];
  duplicadas: ResultadoImportacionUnidades['duplicadas'];
  errores: ResultadoImportacionUnidades['errores'];
  /** Cuántas filas traía el cuerpo. `creadas + duplicadas + errores` da esto
   *  siempre: si no diera, alguna fila se habría perdido en silencio. */
  recibidas: number;
}

/** El 400 de un lote donde NINGUNA fila sirve: el error común de /v1 más el
 *  detalle fila por fila. Es un superconjunto de `CuerpoError`, no otra forma. */
export interface CuerpoErrorPorFila extends CuerpoError {
  error: CuerpoError['error'] & { filas: Array<{ fila: number; motivo: string }> };
}

/** Normaliza una fila del lote. Lanza `CampoInvalido`/`DatoInvalido` con el
 *  QUÉ corregir. Reusa `validarUnidadImportada`, que es la MISMA validación
 *  que corre la importación por archivo del panel: dos puertas, una regla. */
function normalizarUnidadDelLote(cuerpo: Record<string, unknown>, fila: number, hoy = new Date()): UnidadImportada {
  // Como en el resto de /v1: un `tenant_id` en el cuerpo no se lee aquí ni en
  // ningún otro sitio de la ruta. El tenant sale de `abrir()`.
  const placas = texto(cuerpo, 'placas', { obligatorio: true, max: 20 });
  // A diferencia de la forma corta, el lote EXIGE placa. No es un capricho:
  // el alta masiva es lo que llena el parque de golpe, y una unidad sin placa
  // no se puede cruzar después con una multa, una caseta ni un GPS.
  if (!placas) throw new CampoInvalido('placas', '`placas` es obligatorio en el alta por lote.');

  const crudo: UnidadCrudaImportada = {
    numeroEconomico: texto(cuerpo, 'numeroEconomico', { max: 40 }),
    placas,
    marca: texto(cuerpo, 'marca', { max: 60 }),
    modelo: texto(cuerpo, 'modelo', { max: 60 }),
    anio: texto(cuerpo, 'anio', { max: 10 }),
    polizaVence: texto(cuerpo, 'polizaVence', { max: 10 }),
    permisoSictVence: texto(cuerpo, 'permisoSictVence', { max: 10 }),
    verificacionVence: texto(cuerpo, 'verificacionVence', { max: 10 }),
  };
  return validarUnidadImportada(crudo, fila, hoy);
}

async function postLote(
  tenantId: string,
  rol: string,
  llave: string,
  cuerpo: Record<string, unknown>,
): Promise<NextResponse> {
  const crudo = cuerpo.unidades;
  if (!Array.isArray(crudo)) {
    return errorApi('parametro_invalido', '`unidades` tiene que ser una lista. Para dar de alta una sola, manda sus campos en la raíz del cuerpo.');
  }
  if (crudo.length === 0) {
    // Un lote vacío no es un no-op silencioso: es casi siempre un bug del
    // integrador (el filtro de su lado devolvió 0). Se dice.
    return errorApi('parametro_invalido', '`unidades` llegó vacío. Un lote sin filas no da de alta nada; revisa el filtro de tu lado.');
  }
  if (crudo.length > FILAS_POR_TANDA) {
    return errorApi('parametro_invalido', `\`unidades\` trae ${crudo.length} filas y el máximo por petición es ${FILAS_POR_TANDA}. Pártelo en tandas de ${FILAS_POR_TANDA}, cada una con su \`Idempotency-Key\` propia.`);
  }
  for (const f of crudo) {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) {
      return errorApi('parametro_invalido', 'Cada elemento de `unidades` tiene que ser un objeto con los campos de la fila.');
    }
  }

  // El patio (terminal) es del LOTE, no de la fila: una carga masiva es
  // típicamente el parque de un patio. Opcional; sin él las unidades nacen sin
  // patio asignado, que es la verdad y no un patio inventado.
  //
  // SE RESUELVE AQUÍ, ANTES DE `escribir`, y no adentro de `importarUnidades`:
  // un patio que no es de esta flota es un error del INTEGRADOR y merece un
  // 400 que lo diga. Si se dejara reventar dentro de `crear()`, el
  // `DatoInvalido` caería en `traducirFalla`, que no lo conoce, y saldría un
  // 500 — «me falló algo» en vez de «ese patio no es tuyo».
  let terminalId: string | null;
  try {
    terminalId = await resolverTerminalDeFlota(tenantId, texto(cuerpo, 'terminalId', { max: 40 }));
  } catch (e) {
    if (e instanceof DatoInvalido) return errorApi('parametro_invalido', e.message);
    return fallo('v1.unidades.lote', e, { tenant: tenantId });
  }

  // Se valida TODO el lote antes de escribir NADA. `fila` empieza en 1 y es la
  // posición en la lista que mandó el integrador — el mismo índice que él
  // puede señalar en su propio arreglo.
  const buenas: UnidadImportada[] = [];
  const errores: Array<{ fila: number; motivo: string }> = [];
  for (let i = 0; i < crudo.length; i++) {
    try {
      buenas.push(normalizarUnidadDelLote(crudo[i] as Record<string, unknown>, i + 1));
    } catch (e) {
      // Los DOS errores que se le enseñan al integrador son los que se
      // escribieron para que alguien los lea, igual que en `validar()`.
      // Cualquier otra excepción es una falla NUESTRA y no se convierte en
      // «esta fila venía mal»: se va por `fallo()`, que corta el mensaje.
      if (!(e instanceof CampoInvalido || e instanceof DatoInvalido)) {
        return fallo('v1.unidades.lote', e, { tenant: tenantId, fila: i + 1 });
      }
      errores.push({ fila: i + 1, motivo: e.message });
    }
  }

  const recibidas = crudo.length;

  // Ni una sola fila válida: no hay escritura que hacer, y contestar 201 con
  // `creadas: []` haría que el integrador tachara el lote como entregado.
  if (buenas.length === 0) {
    const cuerpoError: CuerpoErrorPorFila = {
      error: {
        codigo: 'parametro_invalido',
        mensaje: `Ninguna de las ${recibidas} filas del lote es válida; no se dio de alta ninguna unidad. Corrige lo que dice cada fila y reintenta con una \`Idempotency-Key\` nueva.`,
        filas: errores,
      },
    };
    return NextResponse.json(cuerpoError, { status: 400 });
  }

  // Dos filas del MISMO lote con la misma placa o el mismo económico: se
  // atrapa aquí y no en la base, porque `importarUnidades` compara contra el
  // parque que leyó ANTES del upsert y las dos le parecerían nuevas. La
  // segunda es la que se acusa: la primera es la que se queda.
  const vistasPlaca = new Map<string, number>();
  const vistasEco = new Map<string, number>();
  const sinChoqueInterno: UnidadImportada[] = [];
  for (const f of buenas) {
    const yaPlaca = vistasPlaca.get(f.placas);
    if (yaPlaca !== undefined) {
      errores.push({ fila: f.fila, motivo: `la placa ${f.placas} ya viene en la fila ${yaPlaca} de este mismo lote; una placa es de un solo camión` });
      continue;
    }
    const yaEco = vistasEco.get(f.numeroEconomico);
    if (yaEco !== undefined) {
      errores.push({ fila: f.fila, motivo: `el número económico ${f.numeroEconomico} ya viene en la fila ${yaEco} de este mismo lote` });
      continue;
    }
    vistasPlaca.set(f.placas, f.fila);
    vistasEco.set(f.numeroEconomico, f.fila);
    sinChoqueInterno.push(f);
  }

  return escribir<LoteUnidadesCreado>({
    evento: 'v1.unidades.lote',
    tenantId,
    llave,
    // La huella es del LOTE NORMALIZADO: reintentarlo con las llaves del JSON
    // en otro orden sigue siendo la misma operación, y un `tenant_id` colado
    // en el cuerpo no la cambia porque no entra aquí.
    huella: huella({
      filas: sinChoqueInterno.map((f) => [
        f.numeroEconomico, f.placas, f.marca ?? '', f.modelo ?? '', f.anio ?? '',
        f.polizaVence ?? '', f.permisoSictVence ?? '', f.verificacionVence ?? '',
      ].join('|')).join('\n'),
      terminalId: terminalId ?? '',
      invalidas: errores.length,
      recibidas,
    }),
    // El lote no choca contra el unique: el upsert lleva `ignoreDuplicates`.
    // Esta restricción existe para el contrato de `escribir` y no se dispara.
    restriccion: 'unidad_economico_unico',
    // No hay "llave natural del lote": la dedup por fila la hace
    // `importarUnidades` contra el parque. Aquí solo manda el recuerdo.
    buscar: async () => null,
    mensajeConflicto: 'Ese lote ya se procesó con otro contenido. Consulta tu parque con `GET /v1/unidades`.',
    crear: async () => {
      const r = await importarUnidades(tenantId, sinChoqueInterno, {
        origen: 'api',
        terminalId,
        actor: { id: `llave:${rol}` },
      });
      // `importarUnidades` solo pone `error` cuando NO escribió nada porque no
      // pudo leer el parque. Fallar cerrado: se lanza para que salga un 503 con
      // cuerpo, no un 201 con `creadas: []` que se leería como "ya está".
      if (r.error) throw new Error(`importarUnidades: ${r.error}`);
      return {
        creadas: r.creadas,
        duplicadas: r.duplicadas,
        // Los errores de forma (de aquí) y los de escritura (de la
        // importación) son la misma lista para quien lee el acuse: lo que le
        // importa es qué filas no quedaron.
        errores: [...errores, ...r.errores].sort((a, b) => a.fila - b.fila),
        recibidas,
      };
    },
  });
}
