// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/openapi — el contrato de la API, en OpenAPI 3.1.
//
// Sin este documento la API no es vendible. Un integrador de un TMS no lee
// prosa: pega una URL en su generador de clientes y quiere el SDK del otro
// lado. Es lo que convierte "tenemos una API" en "conectas Likida en una tarde
// y sigue conectada cuando cambies de TMS".
//
// ── POR QUÉ ESTA RUTA NO PIDE CREDENCIAL, Y LAS OTRAS CUATRO SÍ ──────────
//
// Es una decisión, no un descuido. El documento es una CONSTANTE: no toca la
// base, no recibe `tenantId` y no puede filtrar el dato de una flota porque no
// tiene acceso a ninguno. Y hay un huevo-y-gallina real: no se puede generar el
// cliente que sabe autenticarse antes de tener el esquema. Exigir la cookie
// aquí mataría el único uso que justifica el archivo.
//
// Lo que sí revela es la FORMA de la API (nombres de rutas y campos). Eso ya lo
// revela cualquier 401 de las rutas reales, y ninguna de ellas se abre por
// conocerlas: `abrir()` cierra por credencial, por flota y por área antes de
// tocar un dato. Queda acotado por IP para que no sea un amplificador barato.
//
// ── LAS DOS CREDENCIALES, Y POR QUÉ EN ESE ORDEN ─────────────────────────
//
// Cuando este archivo se escribió, la única autenticación era la cookie del
// panel, y el documento lo decía tal cual en vez de dibujar un `Bearer` que no
// existía — un esquema que promete una credencial inexistente hace que el
// generador produzca un cliente que compila y nunca autentica, y el integrador
// descubre el hueco a mitad de su sprint.
//
// La llave por flota YA existe (mig. 0093 + `lib/auth/llave-api.ts`), así que
// ahora sí se declara, y PRIMERO: es la que debe usar un sistema ajeno. La
// cookie queda documentada para el propio panel. El orden de `security` no es
// cosmético — varios generadores toman el primer esquema como el default.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { DIAS_AVISO } from '@/lib/likida/vigencias';
import { CABECERA_IDEMPOTENCIA, LARGO_MIN_LLAVE, LARGO_MAX_LLAVE, ANIO_MIN_UNIDAD } from '../_escritura';
// El tope de filas por POST en las altas por lote. Se importa del MISMO sitio
// que lo aplica: un número copiado aquí a mano documentaría un límite que no
// es el que valida, y eso enseña a mandar peticiones que rebotan.
import { FILAS_POR_TANDA } from '@/lib/likida/importacion/archivo';
import { MAX_BUSQUEDA_OPERADORES } from '@/lib/likida/administracion';
import {
  LIMITE_DEFECTO,
  LIMITE_MAXIMO,
  VENTANA_MAXIMA,
  TASA_ANONIMA,
  TASA_POR_FLOTA,
  errorApi,
} from '../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Un tipo anulable de JSON Schema 2020-12 (lo que usa OpenAPI 3.1). El `null`
 *  NO es decorativo: es lo que hace que un generador produzca `number | null` y
 *  el integrador tenga que decidir a mano qué hace cuando no hay cifra. */
const anulable = (tipo: string, descripcion: string) => ({
  type: [tipo, 'null'],
  description: descripcion,
});

const REGLA_NULL = [
  'REGLA DE TODA LA API: `null` significa NO SE PUDO CALCULAR o NO SE CAPTURÓ. Nunca significa cero.',
  '',
  'Likida existe porque un contralor cruza lo que ve contra su PDF y su contador. Un 0 en lugar de un hueco',
  'es una cifra inventada: un viaje sin ingreso capturado que devolviera `contribucion: 0` afirmaría que salió',
  'a mano —una medición— cuando lo que pasa es que nadie tecleó lo que se le cobró al cliente. Los dos casos',
  'se ven idénticos aplastados a 0 y significan cosas opuestas.',
  '',
  'Por eso: no escribas `?? 0` sobre estos campos. Cuando venga `null`, la respuesta trae normalmente un campo',
  'hermano que dice QUÉ falta (`falta`, `queVence`, `rotulo`), y eso es lo que se le enseña al usuario.',
].join('\n');

const documental = {
  type: 'object',
  description: 'Cuánto del viaje viene respaldado con CFDI. Son CONTEOS, no importes.',
  properties: {
    estado: {
      type: 'string',
      enum: ['sin_comprobantes', 'sin_cfdi', 'parcial', 'con_cfdi'],
      description: '`sin_comprobantes` NO es `sin_cfdi`: el primero es un viaje al que nadie mandó una foto; el segundo, uno con tickets y sin respaldo fiscal. Se resuelven con dos personas distintas.',
    },
    comprobantes: { type: 'integer' },
    conCfdi: { type: 'integer' },
    sinCfdi: { type: 'integer' },
    rotulo: { type: 'string', description: 'La frase ya conjugada, la misma que ve el usuario en el panel.' },
  },
  required: ['estado', 'comprobantes', 'conCfdi', 'sinCfdi', 'rotulo'],
} as const;

const factura = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    folio: anulable('string', 'Folio de la factura, si lo trae.'),
    fecha: anulable('string', 'Fecha de emisión, AAAA-MM-DD.'),
    estatus: { type: 'string', enum: ['borrador', 'emitida', 'pagada', 'cancelada'] },
    total: anulable('number', 'Total facturado.'),
    pagado: anulable('number', 'Abonado. `null` = no se pudo leer su saldo — NO "no ha pagado".'),
    saldo: anulable('number', 'Pendiente. `null` = no se pudo leer — NO "ya está saldada".'),
    venceEn: anulable('string', '`null` = el cliente no tiene días de crédito pactados.'),
    amparaVarios: {
      type: 'boolean',
      description: 'La factura cubre MÁS viajes que éste. Cuando es `true`, sus importes NO son atribuibles a este viaje.',
    },
  },
  required: ['id', 'folio', 'fecha', 'estatus', 'total', 'pagado', 'saldo', 'venceEn', 'amparaVarios'],
} as const;

const cobro = {
  type: 'object',
  description: 'Estado de facturación y cobro del viaje.',
  properties: {
    estadoFacturacion: { type: 'string', enum: ['sin_factura', 'solo_borrador', 'facturado', 'cancelada'] },
    estadoCobro: {
      type: 'string',
      enum: ['sin_factura', 'sin_dato', 'sin_cobrar', 'parcial', 'cobrado'],
      description: '`sin_dato` no es un estado de la cobranza sino de la LECTURA: la factura existe y su saldo no se pudo leer. Sin él, ese caso caería en `sin_cobrar` y se acusaría de moroso a un cliente que quizá ya pagó.',
    },
    totalFacturado: anulable('number', 'Suma de las facturas vivas. `null` si alguna no se pudo leer.'),
    totalCobrado: anulable('number', 'Ídem.'),
    saldo: anulable('number', 'Ídem.'),
    diasPorCobrar: anulable('integer', 'Días que lleva sin cobrarse la factura viva más antigua con saldo.'),
    diasVencida: anulable('integer', 'Días que lleva vencida la más atrasada. `null` si ninguna pasó su fecha.'),
    sinCondiciones: { type: 'boolean', description: 'Hay factura viva sin fecha de vencimiento: su cliente no tiene crédito pactado.' },
    importesCompartidos: { type: 'boolean', description: 'Alguna factura ampara varios viajes: los importes de arriba no son sólo de éste.' },
    facturas: { type: 'array', items: factura },
  },
  required: ['estadoFacturacion', 'estadoCobro', 'totalFacturado', 'totalCobrado', 'saldo', 'diasPorCobrar', 'diasVencida', 'sinCondiciones', 'importesCompartidos', 'facturas'],
} as const;

const paginaSobre = {
  type: 'object',
  properties: {
    limite: { type: 'integer' },
    desplazamiento: { type: 'integer' },
    devueltos: { type: 'integer', description: 'Cuántas filas trae ESTA respuesta.' },
    total: anulable('integer', 'Cuántas hay en total del otro lado del filtro. `null` = no se pudo contar; jamás 0.'),
    hayMas: {
      type: 'boolean',
      description: 'Si vale la pena pedir la siguiente página. En `/v1/viajes` es EXACTO siempre (se lee una fila de más); en las demás, con `total` conocido es exacto y sin él es conservador (dice que quizá falta antes que esconder el resto).',
    },
    siguiente: anulable(
      'string',
      'El cursor de la página siguiente: mándalo tal cual en `?despues=`. `null` = no hay más. Sólo lo emiten las rutas que paginan por cursor (`/v1/viajes`); es OPACO — no lo armes ni lo interpretes, su forma puede cambiar.',
    ),
  },
  required: ['limite', 'desplazamiento', 'devueltos', 'total', 'hayMas'],
} as const;

const cuerpoError = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        codigo: {
          type: 'string',
          enum: [
            'no_autenticado', 'sin_permiso', 'no_encontrado', 'parametro_invalido', 'conflicto',
            'demasiadas_peticiones', 'lectura_incompleta', 'error_interno', 'dependencia_no_disponible',
          ],
          description: 'Ramifica sobre esto, no sobre `mensaje` (que se puede reescribir sin previo aviso). `lectura_incompleta` y `error_interno` son ambos 500 y significan cosas distintas: el primero NO se arregla reintentando. `conflicto` (409) significa que la llave natural ya existe con OTRO contenido y TUS DATOS NO SE GUARDARON.',
        },
        mensaje: {
          type: 'string',
          description: 'En español y para un humano. NUNCA lleva el mensaje del motor de base de datos: nombres de tablas, columnas y constraints se quedan en nuestros registros.',
        },
      },
      required: ['codigo', 'mensaje'],
    },
  },
  required: ['error'],
} as const;

const parametrosPagina = [
  {
    name: 'limite',
    in: 'query',
    required: false,
    description: `Cuántas filas devolver. Default ${LIMITE_DEFECTO}, máximo ${LIMITE_MAXIMO}. Un valor mayor devuelve 400: NO se recorta en silencio, porque un límite clavado sin avisar hace que escribas el bucle creyendo que pediste más de lo que recibiste.`,
    schema: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_DEFECTO },
  },
  {
    name: 'desplazamiento',
    in: 'query',
    required: false,
    description: `Desde qué fila. \`desplazamiento\` + \`limite\` no puede pasar de ${VENTANA_MAXIMA} en una petición: es el \`max_rows\` del servidor de datos, o sea lo máximo que puede entregar demostrando que no recortó. Para recorrer un histórico más largo, en \`/v1/viajes\` usa \`despues\` (cursor).`,
    schema: { type: 'integer', minimum: 0, default: 0 },
  },
] as const;

// ── El cursor de /v1/viajes ────────────────────────────────────────────────
//
// `desplazamiento` sigue existiendo y sigue funcionando igual para quien ya lo
// use: lo que agrega el cursor es poder pasar de la ventana de 1,000 sin que
// una fila nueva desalinee las páginas. A 50k viajes/mes, 1,000 es menos de un
// día de operación.
const parametrosCursor = [
  {
    name: 'despues',
    in: 'query',
    required: false,
    description:
      'Cursor de la página siguiente: el `pagina.siguiente` de la respuesta anterior, tal cual. Es la forma de recorrer TODO el histórico — `desplazamiento` se topa en la ventana de '
      + `${VENTANA_MAXIMA} filas. Es OPACO: no lo armes a mano (uno inválido es 400). No se combina con \`desplazamiento\` > 0: el cursor ya dice desde dónde seguir. `
      + 'A diferencia del desplazamiento, no se desalinea cuando entran viajes nuevos mientras recorres.',
    schema: { type: 'string' },
  },
  {
    name: 'conteo',
    in: 'query',
    required: false,
    description:
      'Pide el total de la flota (`pagina.total`). Sin él, `total` viene `null` y `hayMas` sigue siendo exacto. Cuesta un `count(*)` sobre todos los viajes de la flota EN CADA petición: pídelo en la primera vuelta de la sincronización, no en las 500 siguientes.',
    schema: { type: 'integer', enum: [0, 1], default: 0 },
  },
] as const;

const respuestasError = {
  '400': { description: 'Parámetro inválido.', content: { 'application/json': { schema: cuerpoError } } },
  '401': { description: 'Sin credencial válida. No se devuelven datos parciales.', content: { 'application/json': { schema: cuerpoError } } },
  '403': { description: 'La credencial es válida pero el rol no ve esta área.', content: { 'application/json': { schema: cuerpoError } } },
  '429': { description: `Límite de tasa: ${TASA_ANONIMA}/min por IP antes de identificar, ${TASA_POR_FLOTA}/min por flota después.`, content: { 'application/json': { schema: cuerpoError } } },
  '500': { description: 'Error interno, o `lectura_incompleta` si la flota rebasó lo que una lectura puede demostrar completo.', content: { 'application/json': { schema: cuerpoError } } },
  '503': { description: 'No se pudo verificar la credencial contra la base. Reintenta.', content: { 'application/json': { schema: cuerpoError } } },
} as const;

// ── LO QUE COMPARTEN LAS DOS ESCRITURAS ───────────────────────────────────
//
// `Idempotency-Key` es OBLIGATORIA, no opcional, y ésa es la decisión que esta
// documentación tiene que dejar clarísima: sin ella, un timeout de red —el
// caso normal, no el raro— deja al integrador sin saber si el viaje se creó, y
// el reintento lo crea dos veces. Que sea obligatoria convierte «reintentar»
// en la respuesta correcta a cualquier fallo, en vez de en una apuesta.
const cabeceraIdempotencia = {
  name: CABECERA_IDEMPOTENCIA,
  in: 'header',
  required: true,
  description: `Identificador único de ESTA operación (un uuid sirve). Repítelo EXACTO al reintentar: la respuesta original se vuelve a servir tal cual, con \`Idempotent-Replayed: true\`. Entre ${LARGO_MIN_LLAVE} y ${LARGO_MAX_LLAVE} caracteres ASCII imprimibles.`,
  schema: { type: 'string', minLength: LARGO_MIN_LLAVE, maxLength: LARGO_MAX_LLAVE },
} as const;

/** El 200 de una escritura: NO se creó nada nuevo, ya existía. */
function yaExistia(que: string, esquema: Record<string, unknown>) {
  return {
    description: `${que} ya existía CON EL MISMO CONTENIDO y se devuelve el mismo. Pasa por reintento con la misma \`Idempotency-Key\`, o porque otro camino ya lo había creado con la misma clave natural. Si la clave natural existe con contenido DISTINTO, la respuesta es 409 \`conflicto\` — nunca este 200. \`idempotente: true\` lo dice en el cuerpo además del status, para que un cliente generado desde este esquema pueda distinguirlo sin leer el código HTTP.`,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { dato: esquema, idempotente: { type: 'boolean', enum: [true] } },
          required: ['dato', 'idempotente'],
        },
      },
    },
  };
}

/** El 409 de una escritura: la llave natural existe con OTRO contenido. */
function conflictoNatural(que: string, llave: string) {
  return {
    description: `Ya existe ${que} con ese ${llave} en tu flota, con contenido DISTINTO al del cuerpo. TUS DATOS NO SE GUARDARON — esta API no actualiza registros; las correcciones se capturan en el panel. Un reintento con el MISMO contenido no cae aquí: recibe el 200 idempotente.`,
    content: { 'application/json': { schema: cuerpoError } },
  };
}

function seCreo(que: string, esquema: Record<string, unknown>) {
  return {
    description: `${que} quedó creado en esta llamada.`,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { dato: esquema, idempotente: { type: 'boolean', enum: [false] } },
          required: ['dato', 'idempotente'],
        },
      },
    },
  };
}

const VIAJE_CREADO = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    folio: { type: 'string' },
    estatus: { type: 'string', enum: ['abierto'], description: 'Todo viaje nace `abierto`. No se relee de la base: se escribe literal en el mismo insert que devolvió el id.' },
  },
  required: ['id', 'folio', 'estatus'],
} as const;

const UNIDAD_CREADA = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    numeroEconomico: { type: 'string' },
  },
  required: ['id', 'numeroEconomico'],
} as const;

// ── Las altas por lote (auditoría 24) ──────────────────────────────────────
//
// Una flota que estrena Likida llega con 800 tractos y cientos de choferes ya
// capturados en su TMS. El alta de a uno los obliga a 800 POST, y un TMS al
// que se le cae la red a media captura no tiene forma de saber por dónde iba.

const ALTA_UNIDAD = {
  type: 'object',
  title: 'Una unidad',
  properties: {
    numeroEconomico: { type: 'string', maxLength: 40, description: 'Como le dice la flota a esa unidad (T-042). Único por flota: es su clave natural.' },
    placas: { type: 'string', maxLength: 20, nullable: true },
    marca: { type: 'string', maxLength: 60, nullable: true },
    modelo: { type: 'string', maxLength: 60, nullable: true },
    anio: {
      type: 'integer',
      minimum: ANIO_MIN_UNIDAD,
      nullable: true,
      description: `Entre ${ANIO_MIN_UNIDAD} y el año en curso + 2 (las unidades se compran con modelo adelantado). Acepta también su forma de texto ("2018"), porque un CSV exportado por un TMS manda todo como texto; "2018.5" no pasa.`,
    },
  },
  required: ['numeroEconomico'],
  additionalProperties: false,
} as const;

const FILA_UNIDAD_LOTE = {
  type: 'object',
  properties: {
    numeroEconomico: { type: 'string', maxLength: 40, description: 'Clave natural de la unidad dentro de la flota. Repetirlo manda la fila a `duplicadas` sin tocar lo que ya está.' },
    placas: { type: 'string', maxLength: 20, description: 'OBLIGATORIA en el lote (a diferencia del alta de una). Se guarda en MAYÚSCULAS y con los separadores normalizados: «abc 123 4» y «ABC-123-4» son la misma placa, y la segunda que llegue es un error de fila que nombra a la unidad que ya la tiene.' },
    marca: { type: 'string', maxLength: 60, nullable: true },
    modelo: { type: 'string', maxLength: 60, nullable: true },
    anio: { type: 'string', nullable: true, description: `Entre ${ANIO_MIN_UNIDAD} y el año en curso + 2.` },
    polizaVence: { type: 'string', format: 'date', nullable: true, description: 'ISO AAAA-MM-DD. Solo el lote captura vigencias: vienen de una exportación donde ya existen, no de un tecleo.' },
    permisoSictVence: { type: 'string', format: 'date', nullable: true },
    verificacionVence: { type: 'string', format: 'date', nullable: true },
  },
  required: ['placas'],
  additionalProperties: false,
} as const;

const LOTE_UNIDADES = {
  type: 'object',
  title: 'Un lote de unidades',
  properties: {
    unidades: { type: 'array', minItems: 1, maxItems: FILAS_POR_TANDA, items: FILA_UNIDAD_LOTE },
    terminalId: { type: 'string', format: 'uuid', nullable: true, description: 'El patio al que entra TODO el lote (una carga masiva suele ser el parque de un patio). Tiene que ser un patio de TU flota: uno ajeno es 400. Sin él las unidades nacen sin patio, que es la verdad y no un patio inventado.' },
  },
  required: ['unidades'],
  additionalProperties: false,
} as const;

const FILA_OPERADOR_LOTE = {
  type: 'object',
  properties: {
    nombre: { type: 'string', minLength: 3, maxLength: 120 },
    telefono: { type: 'string', maxLength: 25, description: 'El WhatsApp del chofer. Se normaliza a E.164 de México (`52` + 10 dígitos): «55 1234 5678», «+52 55 1234 5678» y «5215512345678» son el mismo número. Es ÚNICO por flota y es LA IDENTIDAD del chofer frente al bot — un dedazo en un dígito no produce un registro incompleto, produce un chofer que nunca puede reportar un gasto.' },
    numeroEmpleado: { type: 'string', maxLength: 40, nullable: true },
    rfc: { type: 'string', maxLength: 13, nullable: true, description: 'Se acepta al dar de alta (viene de la nómina del TMS) pero NO se devuelve en el `GET`: es dato fiscal de una persona física y ningún integrador de tráfico lo necesita.' },
    licencia: { type: 'string', maxLength: 40, nullable: true },
    licenciaTipo: { type: 'string', maxLength: 10, nullable: true },
    licenciaVence: { type: 'string', format: 'date', nullable: true, description: 'ISO AAAA-MM-DD.' },
  },
  required: ['nombre', 'telefono'],
  additionalProperties: false,
} as const;

const LOTE_OPERADORES = {
  type: 'object',
  title: 'Un lote de operadores',
  properties: {
    operadores: { type: 'array', minItems: 1, maxItems: FILAS_POR_TANDA, items: FILA_OPERADOR_LOTE },
    terminalId: { type: 'string', format: 'uuid', nullable: true, description: 'El patio al que entra TODO el lote. Tiene que ser un patio de TU flota: uno ajeno es 400.' },
  },
  required: ['operadores'],
  additionalProperties: false,
} as const;

const FILAS_CON_MOTIVO = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      fila: { type: 'integer', minimum: 1, description: 'La posición en la lista que mandaste, empezando en 1. Es el índice que puedes señalar en tu propio arreglo.' },
      motivo: { type: 'string', description: 'Qué corregir, en español y ya redactado para una persona.' },
    },
    required: ['fila', 'motivo'],
  },
} as const;

function loteCreado(que: string, creadas: Record<string, unknown>, nombreCreadas: string, nombreDuplicadas: string, extra: Record<string, unknown> = {}) {
  return {
    description: `El lote de ${que} se procesó. Revisa los tres arreglos: NO todas las filas tuvieron que quedar creadas.`,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            dato: {
              type: 'object',
              properties: {
                [nombreCreadas]: { type: 'array', items: creadas, description: 'Las filas que quedaron dadas de alta en ESTA llamada, con el id que les tocó.' },
                [nombreDuplicadas]: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      fila: { type: 'integer', minimum: 1 },
                      id: { type: 'string', format: 'uuid', nullable: true, description: '`null` cuando otra carga simultánea la creó entre la lectura y la escritura: es un duplicado, no un error.' },
                      motivo: { type: 'string' },
                    },
                    required: ['fila', 'motivo'],
                  },
                  description: 'Las que YA ESTABAN en tu flota. No se tocó nada de lo que tenían: el alta masiva da de alta, corregir se hace en el panel.',
                },
                errores: { ...FILAS_CON_MOTIVO, description: 'Las que NO quedaron, con el porqué. Una fila mala no tira el lote.' },
                ...extra,
                recibidas: { type: 'integer', description: `Cuántas filas traía el cuerpo. \`${nombreCreadas} + ${nombreDuplicadas} + errores\` siempre suma esto: si no sumara, alguna fila se habría perdido en silencio.` },
              },
              required: [nombreCreadas, nombreDuplicadas, 'errores', 'recibidas'],
            },
            idempotente: { type: 'boolean', description: '`true` = este lote ya se había procesado con esta misma `Idempotency-Key` y se te devuelve la respuesta EXACTA de la primera vez.' },
          },
          required: ['dato', 'idempotente'],
        },
      },
    },
  };
}

const loteTodoInvalido = (que: string) => ({
  description: `NINGUNA fila del lote es válida y NO se dio de alta ${que}. El detalle viene fila por fila en \`error.filas\`: un lote de ${FILAS_POR_TANDA} que rebota entero sin decir cuáles fallaron obliga a bisecar a mano. Corrige y reintenta con una \`${CABECERA_IDEMPOTENCIA}\` NUEVA.`,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              codigo: { type: 'string', enum: ['parametro_invalido'] },
              mensaje: { type: 'string' },
              filas: FILAS_CON_MOTIVO,
            },
            required: ['codigo', 'mensaje', 'filas'],
          },
        },
        required: ['error'],
      },
    },
  },
});

/** Lo que se acusa de una unidad creada DENTRO de un lote: además del id, la
 *  `fila` para poder casarla con el renglón que mandó el integrador. */
const UNIDAD_CREADA_EN_LOTE = {
  type: 'object',
  properties: {
    fila: { type: 'integer', minimum: 1 },
    id: { type: 'string', format: 'uuid' },
    numeroEconomico: { type: 'string' },
    placas: { type: 'string', description: 'Ya normalizada (MAYÚSCULAS): es como quedó guardada, no como la mandaste.' },
  },
  required: ['fila', 'id', 'numeroEconomico', 'placas'],
} as const;

const OPERADOR_CREADO_EN_LOTE = {
  type: 'object',
  properties: {
    fila: { type: 'integer', minimum: 1 },
    id: { type: 'string', format: 'uuid' },
    telefono: { type: 'string', description: 'Ya normalizado a `52` + 10 dígitos: es como quedó guardado, no como lo mandaste.' },
  },
  required: ['fila', 'id', 'telefono'],
} as const;

/** Un chofer como lo devuelve `GET /v1/operadores`. SIN RFC: ver la prosa de
 *  la ruta. */
const OPERADOR = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    nombre: { type: 'string' },
    telefono: { type: 'string', nullable: true, description: '`52` + 10 dígitos. `null` = a este chofer NADIE le capturó teléfono, y entonces no puede usar el bot. No es `""` ni 0.' },
    numeroEmpleado: { type: 'string', nullable: true },
    activo: { type: 'boolean' },
    viajes: { type: 'integer', description: 'Viajes que ya trae encima, para no dar de baja al que está en ruta.' },
    terminalId: { type: 'string', format: 'uuid', nullable: true },
    terminalNombre: { type: 'string', nullable: true },
    licencia: {
      type: 'object',
      properties: {
        numero: { type: 'string', nullable: true },
        tipo: { type: 'string', nullable: true },
        vence: { type: 'string', format: 'date', nullable: true },
        estado: { type: 'string', enum: ['vencido', 'por_vencer', 'vigente', 'sin_dato'], description: '`sin_dato` NO es `vigente`: a ese chofer nadie le capturó la licencia.' },
        diasAlVencimiento: { type: 'integer', nullable: true, description: 'NEGATIVO = ya venció. `null` = sin capturar, nunca 0.' },
        rotulo: { type: 'string', description: 'La frase ya conjugada, la misma que ve el gerente en el panel.' },
      },
      required: ['numero', 'tipo', 'vence', 'estado', 'diasAlVencimiento', 'rotulo'],
    },
    avisoPrivacidadEn: { type: 'string', format: 'date-time', nullable: true, description: 'Cuándo se le entregó el aviso de privacidad. `null` = TODAVÍA NO.' },
  },
  required: ['id', 'nombre', 'telefono', 'activo', 'viajes', 'licencia', 'avisoPrivacidadEn'],
} as const;

const noEncontrado = {
  description: 'No hay nada con ese id EN TU FLOTA. "No existe" y "no es tuyo" contestan lo mismo a propósito: distinguirlos convertiría la ruta en un oráculo para enumerar los uuids de otras flotas.',
  content: { 'application/json': { schema: cuerpoError } },
} as const;

const parametroIdViaje = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'uuid del viaje. Se resuelve SIEMPRE contra la flota de tu credencial.',
  schema: { type: 'string', format: 'uuid' },
} as const;

function documento(servidor: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Likida API v1',
      version: '1.0.0',
      summary: 'Lectura de la operación de una flota de carga: viajes, contribución por viaje, unidades con sus vigencias de ley y cartera de clientes.',
      description: [
        'Likida es una capa independiente encima del TMS que use la flota. Esta API es de SOLO LECTURA:',
        'no crea ni modifica nada, así que conectarla no puede romper lo que ya opera.',
        '',
        '## De qué flota habla una petición',
        '',
        'SIEMPRE de la flota de la credencial. No hay ningún parámetro para elegir flota: un `?tenant=` en la',
        'query se BORRA en el borde antes de resolver la autorización, incluso para una cuenta de superadmin.',
        '',
        '## Autenticación (estado real, agosto 2026)',
        '',
        'Hay DOS formas, y para un sistema propio la buena es la primera:',
        '',
        '1. **Llave de flota** — `Authorization: Bearer lk_live_…`. No necesita navegador ni cookie, así que es',
        '   la que usa un TMS, un tablero o cualquier proceso headless. Se emite desde el panel, se enseña UNA',
        '   vez y solo se guarda su hash: si se pierde, se revoca y se emite otra. Cada llave trae su propia',
        '   área (`operacion`, `dinero` o `administracion`), más angosta que la de una persona — una llave de',
        '   operación no puede leer el margen de la flota. Cuando mandas una llave, la cookie se ignora.',
        '   El área que exige cada operación va en su extensión `x-likida-area` (legible por máquina) y en su',
        '   descripción (legible por persona); una prueba las ata al `abrir()` del código de cada ruta para que',
        '   el contrato no diverja del código en silencio.',
        '',
        '2. **Cookie de sesión** (Supabase Auth) — la del propio panel. Sirve para un agente que ya opere con',
        '   una sesión abierta; no sirve para un proceso sin navegador.',
        '',
        '## Qué ve cada rol',
        '',
        'Las rutas están partidas por ÁREA, igual que el panel:',
        '',
        '- `operacion` — `/viajes`, `/viajes/{id}`, `/unidades`. **No devuelven un peso.** Las consume el jefe de',
        '  tráfico (rol `encargado`) además del dueño.',
        '- `dinero` — `/viajes/{id}/contribucion`, `/clientes`. Sólo dueño (`flota_admin`) y contador.',
        '',
        'El anticipo de un viaje NO viaja en `/viajes` a propósito: es dinero, y el registro de viajes es área de',
        'operación.',
        '',
        '## Llaves en español',
        '',
        '`folio`, `viaje`, `unidad`, `operador`, `comprobado`: son los nombres de la cosa en el negocio y en la',
        'base, no traducciones. Traducirlas en el borde crearía un segundo vocabulario para las mismas cifras.',
        '',
        `## ${REGLA_NULL.split('\n')[0]}`,
        '',
        REGLA_NULL.split('\n').slice(2).join('\n'),
      ].join('\n'),
      contact: { name: 'Likida', url: 'https://likida.ai' },
    },
    servers: [{ url: servidor, description: 'Producción' }],
    // Los dos, en orden de preferencia: un integrador debe usar la llave. La
    // cookie queda para el propio panel.
    security: [{ llaveDeFlota: [] }, { sesionLikida: [] }],
    components: {
      securitySchemes: {
        llaveDeFlota: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Llave de API de la flota, en `Authorization: Bearer lk_live_…`. Es la forma de consumir esta API desde un sistema propio (un TMS, un tablero): no necesita navegador ni cookie. La llave se emite desde el panel, se enseña UNA vez y se guarda solo su hash — si se pierde, se revoca y se emite otra. Cada llave trae su propia área (`operacion`, `dinero` o `administracion`), más angosta que la de una persona: una llave de operación no puede leer el margen de la flota. Cuando se manda una llave, la cookie se ignora.',
        },
        sesionLikida: {
          type: 'apiKey',
          in: 'cookie',
          // El nombre real lo genera @supabase/ssr a partir del ref del
          // proyecto (`sb-<ref>-auth-token`), así que aquí va el patrón y la
          // verdad completa en la descripción. Inventar un nombre fijo haría
          // que el generador produjera un cliente que manda una cookie que
          // nadie lee.
          name: 'sb-access-token',
          description: 'Cookie de sesión de Supabase Auth, emitida al iniciar sesión en app.likida.ai. El nombre real es `sb-<ref-del-proyecto>-auth-token`. Sirve para consumir la API desde el propio panel; para un sistema ajeno usa `llaveDeFlota`, que no necesita navegador.',
        },
      },
      schemas: {
        Error: cuerpoError,
        // ── BLOQ-6 (mig. 0299): el CIERRE de un viaje, con su firma ────────
        Liquidacion: {
          type: 'object',
          description:
            'El cierre de un viaje. TIENE DOS ESTADOS Y NO UNO: `estatus` es el veredicto del MOTOR y `revision` el de la PERSONA. '
            + 'Contabilizar por `estatus` asienta cierres que nadie firmó.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            viajeId: { type: 'string', format: 'uuid' },
            folio: anulable('string', 'Folio del viaje.'),
            creadaEn: { type: 'string', description: 'ISO-8601.' },
            estatus: { type: 'string', enum: ['cuadrada', 'con_diferencias', 'revisar'], description: 'Lo que concluyó el motor.' },
            revision: { type: 'string', enum: ['pendiente', 'aprobada', 'ajustada', 'rechazada'], description: 'Lo que firmó una persona. `pendiente` = nadie la ha firmado: no la asientes.' },
            revisadaPor: anulable('string', 'Correo de quien firmó. `null` con `revision` distinta de `pendiente` = la firmó el motor (cuadró sola), que NO es lo mismo que "la firmó alguien".'),
            revisadaEn: anulable('string', 'ISO-8601 de la firma.'),
            motivo: anulable('string', 'Lo que se escribió al ajustar o rechazar (la base lo exige en esos dos).'),
            ajustes: {
              type: 'array',
              description: 'Montos que la persona corrigió al ajustar: el comprobante mal leído, de cuánto a cuánto.',
              items: {
                type: 'object',
                properties: {
                  gastoId: { type: 'string' }, concepto: { type: 'string' },
                  montoAnterior: { type: 'number' }, montoNuevo: { type: 'number' },
                },
                required: ['gastoId', 'concepto', 'montoAnterior', 'montoNuevo'],
              },
            },
            anticipo: { type: 'number' },
            comprobado: { type: 'number' },
            diferencia: { type: 'number', description: 'anticipo − comprobado. Positivo = el operador debe; negativo = se le repone.' },
            ivaAcreditable: { type: 'number' },
            iepsAcreditable: { type: 'number' },
            litrosDieselAcreditables: { type: 'number' },
            hallazgos: { type: 'integer', description: 'Cuántas observaciones levantó el motor. El detalle vive en el PDF.' },
          },
          required: ['id', 'viajeId', 'folio', 'creadaEn', 'estatus', 'revision', 'revisadaPor', 'revisadaEn', 'motivo', 'ajustes', 'anticipo', 'comprobado', 'diferencia', 'hallazgos'],
        },
        Pagina: paginaSobre,
        AltaUnidad: ALTA_UNIDAD,
        LoteUnidades: LOTE_UNIDADES,
        AltaOperador: FILA_OPERADOR_LOTE,
        Operador: OPERADOR,
        LoteOperadores: LOTE_OPERADORES,
        Documental: documental,
        FacturaDelViaje: factura,
        Cobro: cobro,
        ObservacionFiscal: {
          type: 'object',
          description: 'Lo que el motor de liquidación señaló en el cuadre.',
          properties: {
            tipo: { type: 'string', description: 'Código del motor: `sin_cfdi`, `rfc_receptor`, `efectivo_sobre_tope`…' },
            nota: anulable('string', 'La frase en español que escribió el motor, con su fundamento.'),
            monto: anulable('number', 'El importe señalado. `null` cuando la observación no lleva importe.'),
          },
          required: ['tipo', 'nota', 'monto'],
        },
        Viaje: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            folio: { type: 'string', description: 'El folio de la flota, o los 8 primeros del uuid si no lo captura.' },
            origen: anulable('string', ''),
            destino: anulable('string', ''),
            estatus: { type: 'string', enum: ['abierto', 'en_cuadre', 'liquidado'] },
            fechaInicio: anulable('string', 'AAAA-MM-DD.'),
            operador: anulable('string', 'Nombre del chofer asignado.'),
            intakePendientes: { type: 'integer', description: 'Comprobantes recibidos por WhatsApp que el motor aún no procesa.' },
            avisadoEn: anulable('string', 'Sello del aviso al chofer. `null` = no hay REGISTRO del aviso, que no es lo mismo que `avisosEnviados: 0`, un conteo real.'),
            aceptadoEn: anulable('string', ''),
            escaladoEn: anulable('string', ''),
            avisosEnviados: { type: 'integer' },
          },
          required: ['id', 'folio', 'origen', 'destino', 'estatus', 'fechaInicio', 'operador', 'intakePendientes', 'avisadoEn', 'aceptadoEn', 'escaladoEn', 'avisosEnviados'],
        },
        ViajeDetalle: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            folio: { type: 'string' },
            ruta: anulable('string', '`Monterrey → Querétaro`, o el único extremo capturado.'),
            fechaInicio: anulable('string', ''),
            estatus: { type: 'string', enum: ['abierto', 'en_cuadre', 'liquidado'] },
            cliente: anulable('string', ''),
            unidad: anulable('string', 'Número económico. `null` = el viaje entró por WhatsApp y no trae unidad.'),
            operador: anulable('string', ''),
            liquidacionId: anulable('string', '`null` = el viaje todavía no se cuadró.'),
            documental,
          },
          required: ['id', 'folio', 'ruta', 'fechaInicio', 'estatus', 'cliente', 'unidad', 'operador', 'liquidacionId', 'documental'],
        },
        Contribucion: {
          type: 'object',
          description: 'El renglón del libro mayor de un viaje. Es donde más importa la regla del `null`.',
          properties: {
            viajeId: { type: 'string', format: 'uuid' },
            folio: { type: 'string' },
            estatus: { type: 'string', enum: ['abierto', 'en_cuadre', 'liquidado'] },
            cliente: anulable('string', ''),
            ingreso: anulable('number', 'Lo que se le cobra al cliente por el flete. `null` = NO SE CAPTURÓ, no "cobró cero". El anticipo no sirve de sustituto: ése es el dinero que se le adelanta al operador.'),
            comprobado: anulable('number', 'Lo comprobado en la liquidación. `null` = el viaje no tiene liquidación. Un 0 aquí SÍ es un cero medido: se cuadró y no se comprobó nada.'),
            contribucion: anulable('number', 'ingreso − comprobado. `null` si falta cualquiera de las dos mitades.'),
            margenPct: anulable('number', 'Contribución como % del ingreso. `null` también con ingreso 0: eso es una división entre cero, no un margen de 0%.'),
            falta: anulable('string', 'QUÉ falta para que los dos de arriba existan, en español y con el siguiente paso. `null` = no falta nada. Éste es el campo que se le enseña al usuario cuando la cifra viene `null`.'),
            liquidacionId: anulable('string', ''),
            documental,
            observaciones: {
              type: ['array', 'null'],
              items: { $ref: '#/components/schemas/ObservacionFiscal' },
              description: '`null` = NO HAY liquidación. `[]` = la hay y salió limpia. No es lo mismo.',
            },
            cobro,
          },
          required: ['viajeId', 'folio', 'estatus', 'cliente', 'ingreso', 'comprobado', 'contribucion', 'margenPct', 'falta', 'liquidacionId', 'documental', 'observaciones', 'cobro'],
        },
        Unidad: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            numeroEconomico: { type: 'string' },
            placas: anulable('string', ''),
            marca: anulable('string', ''),
            modelo: anulable('string', ''),
            anio: anulable('integer', ''),
            estado: { type: 'string', description: 'Dominio de `unidad.estado`: disponible, en_viaje, taller, baja.' },
            kmActual: anulable('number', 'Odómetro. `null` = no se ha capturado; nunca 0 por defecto.'),
            activo: { type: 'boolean' },
            ordenesAbiertas: { type: 'integer', description: 'Órdenes de mantenimiento sin cerrar.' },
            vigencia: {
              type: 'object',
              description: 'El papel MÁS PRÓXIMO a vencer de los tres que la ley le pide a una unidad de carga federal: póliza, permiso SICT y verificación.',
              properties: {
                estado: {
                  type: 'string',
                  enum: ['vencido', 'por_vencer', 'vigente', 'sin_dato'],
                  description: '`sin_dato` NO ES `vigente`. Una unidad a la que nadie le capturó papeles no está en regla: está sin verificar. Pintarla en verde es cómo el gerente se entera del problema cuando lo para un inspector.',
                },
                diasAlVencimiento: anulable('integer', 'Días al vencimiento más próximo. NEGATIVO = ya venció. `null` = ningún papel capturado.'),
                queVence: anulable('string', 'Cuál de los tres papeles vence antes.'),
                rotulo: { type: 'string', description: 'La frase ya conjugada, la misma que ve el gerente en el panel.' },
                pide: { type: 'boolean', description: 'Si esto le pide algo a una persona HOY.' },
              },
              required: ['estado', 'diasAlVencimiento', 'queVence', 'rotulo', 'pide'],
            },
          },
          required: ['id', 'numeroEconomico', 'placas', 'marca', 'modelo', 'anio', 'estado', 'kmActual', 'activo', 'ordenesAbiertas', 'vigencia'],
        },
        Cliente: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            nombre: { type: 'string' },
            rfc: anulable('string', ''),
            diasCredito: anulable('integer', '`null` = no hay condiciones pactadas, que no es "paga de contado".'),
            activo: { type: 'boolean' },
            contacto: anulable('string', ''),
            correo: anulable('string', ''),
            telefono: anulable('string', ''),
            viajes: { type: 'integer' },
            viajesSinIngreso: { type: 'integer', description: 'De esos viajes, cuántos NO traen ingreso capturado. Es el tamaño del hueco de `ingreso`, y viaja pegado a él a propósito.' },
            ingreso: { type: 'number', description: 'Suma del ingreso de flete DE LOS VIAJES QUE LO TIENEN CAPTURADO. No es la facturación del cliente ni una estimación.' },
            saldoPorCobrar: anulable('number', '`null` = el cliente NO TIENE FACTURAS REGISTRADAS. No es que deba $0.00: un cliente que pagó todo y uno al que nunca se le facturó se ven idénticos en cero, y a uno le hablas hoy y al otro no.'),
            vencido: anulable('number', 'Del saldo, lo que ya pasó su fecha pactada. `null` por lo mismo.'),
            facturas: { type: 'integer' },
            tarifas: { type: 'integer', description: 'Tarifas capturadas para este cliente, vigentes o no.' },
          },
          required: ['id', 'nombre', 'rfc', 'diasCredito', 'activo', 'contacto', 'correo', 'telefono', 'viajes', 'viajesSinIngreso', 'ingreso', 'saldoPorCobrar', 'vencido', 'facturas', 'tarifas'],
        },
      },
    },
    paths: {
      '/v1/viajes': {
        post: {
          operationId: 'crearViaje',
          'x-likida-area': 'administracion',
          summary: 'Da de alta un viaje.',
          description:
            'Requiere el área `administracion`. El viaje nace `abierto`.\n\n'
            + 'EL TENANT NO SE MANDA. Sale de la credencial y de ningún otro lado: un `tenantId` en el cuerpo se ignora, no da error — leerlo convertiría la llave de una flota en una puerta para escribir en otra.\n\n'
            + 'EL INGRESO DISTINGUE VACÍO DE CERO. `ingresoFlete` ausente se guarda `null` («todavía no se sabe cuánto dejó»), jamás 0 («no dejó nada»): son lecturas opuestas de la rentabilidad y el motor se niega a confundirlas. El `anticipo` es la única excepción declarada — su columna es NOT NULL, y un viaje sin anticipo es un viaje donde no se adelantó efectivo, que es lo que 0 mide de verdad.\n\n'
            + 'El `folio` es único por flota: repetirlo devuelve 200 con el viaje que ya existía, no un segundo viaje.',
          tags: ['viajes'],
          parameters: [cabeceraIdempotencia],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    folio: { type: 'string', maxLength: 64, description: 'Único por flota. Es la clave natural del viaje.' },
                    operadorId: { type: 'string', format: 'uuid', description: 'OBLIGATORIO: la columna no admite nulos. Un viaje sin chofer no se puede guardar.' },
                    origen: { type: 'string', maxLength: 120, nullable: true },
                    destino: { type: 'string', maxLength: 120, nullable: true },
                    fechaInicio: { type: 'string', format: 'date', nullable: true },
                    unidadId: { type: 'string', format: 'uuid', nullable: true },
                    clienteId: { type: 'string', format: 'uuid', nullable: true, description: 'De quién es el flete. Sin él no hay a quién facturarle.' },
                    ingresoFlete: { type: 'number', nullable: true, description: 'Lo que la flota COBRA por el viaje, en MXN. Ausente = `null`, nunca 0.' },
                    kmRecorridos: { type: 'number', nullable: true },
                    anticipo: { type: 'number', minimum: 0, default: 0, description: 'Efectivo adelantado al operador, MXN. Ausente = 0, y esto sí es una medición.' },
                  },
                  required: ['folio', 'operadorId'],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            '201': seCreo('El viaje', VIAJE_CREADO),
            '200': yaExistia('Un viaje con ese folio', VIAJE_CREADO),
            '409': conflictoNatural('un viaje', 'folio'),
            ...respuestasError,
          },
        },
        get: {
          operationId: 'listarViajes',
          'x-likida-area': 'operacion',
          summary: 'Los viajes de la flota, el más reciente primero.',
          description:
            'Área `operacion`: no devuelve un peso. El anticipo por viaje se queda fuera a propósito — es dinero, y el jefe de tráfico ve esta ruta.\n\n'
            + 'PARA RECORRER EL HISTÓRICO, USA EL CURSOR. Pide la primera página (con `?conteo=1` si quieres el total una vez) y después repite con '
            + '`?despues=` + el `pagina.siguiente` que venga en la respuesta, hasta que `siguiente` sea `null`. `desplazamiento` sigue funcionando para '
            + `quien ya lo usa, pero se topa en ${VENTANA_MAXIMA} filas y se desalinea si entran viajes mientras recorres.`,
          tags: ['viajes'],
          parameters: [...parametrosPagina, ...parametrosCursor],
          responses: {
            '200': {
              description: 'Página de viajes.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      datos: { type: 'array', items: { $ref: '#/components/schemas/Viaje' } },
                      pagina: paginaSobre,
                    },
                    required: ['datos', 'pagina'],
                  },
                },
              },
            },
            ...respuestasError,
          },
        },
      },
      '/v1/viajes/{id}': {
        get: {
          operationId: 'obtenerViaje',
          'x-likida-area': 'operacion',
          summary: 'Un viaje por su uuid.',
          description: 'Área `operacion`: identidad y estado operativo, sin dinero. El dinero del viaje está en `/v1/viajes/{id}/contribucion`.',
          tags: ['viajes'],
          parameters: [parametroIdViaje],
          responses: {
            '200': {
              description: 'El viaje.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { datos: { $ref: '#/components/schemas/ViajeDetalle' } },
                    required: ['datos'],
                  },
                },
              },
            },
            '404': noEncontrado,
            ...respuestasError,
          },
        },
      },
      '/v1/viajes/{id}/contribucion': {
        get: {
          operationId: 'obtenerContribucionDeViaje',
          'x-likida-area': 'dinero',
          summary: 'Cuánto dejó el viaje, y qué falta para poder decirlo.',
          description: 'Área `dinero`. Casi todas sus cifras pueden venir `null`: lee la regla del `null` en la descripción de la API antes de graficar esto.',
          tags: ['viajes', 'dinero'],
          parameters: [parametroIdViaje],
          responses: {
            '200': {
              description: 'El renglón del libro mayor del viaje.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { datos: { $ref: '#/components/schemas/Contribucion' } },
                    required: ['datos'],
                  },
                },
              },
            },
            '404': noEncontrado,
            ...respuestasError,
          },
        },
      },
      '/v1/unidades': {
        post: {
          operationId: 'crearUnidad',
          'x-likida-area': 'administracion',
          summary: 'Da de alta una unidad del parque vehicular.',
          description:
            'Requiere el área `administracion`. Es la ruta con la que se carga el parque desde un TMS o un CSV sin teclearlo a mano.\n\n'
            + 'EL TENANT NO SE MANDA: sale de la credencial, igual que en `POST /v1/viajes`.\n\n'
            + `DOS FORMAS DE CUERPO, Y NO CAPTURAN LO MISMO:\n\n`
            + '· **Una unidad** — los campos en la raíz. NO captura vigencias: la póliza, el permiso SICT y la verificación se cargan por su propia pantalla. Una unidad creada así aparece en el panel como `sin_dato`, que es lo que de verdad se sabe de ella, y NO como `vigente`.\n\n'
            + `· **Un lote** — \`{ "unidades": [ … ] }\`, hasta ${FILAS_POR_TANDA} filas. Es el camino del alta masiva (una flota que estrena Likida llega con cientos de tractos ya capturados). El lote SÍ escribe las tres vigencias, porque viene de una exportación del TMS donde esas fechas ya existen y no de un tecleo, y a cambio EXIGE \`placas\`: una unidad sin placa no se puede cruzar después con una multa, una caseta ni un GPS.\n\n`
            + 'Las dos formas no se mezclan: mandar `unidades` y `numeroEconomico` en el mismo cuerpo es 400.\n\n'
            + 'EN EL LOTE, UNA FILA MALA NO TIRA LAS DEMÁS. Cada fila inválida sale en `errores` con su número de fila (empezando en 1) y el qué corregir; las buenas se escriben. `creadas + duplicadas + errores` siempre suma `recibidas`: si no sumara, alguna fila se habría perdido en silencio. Si NINGUNA fila sirve, es 400 con el detalle en `error.filas` y no se escribe nada.\n\n'
            + 'LO QUE YA ESTABA NO SE PISA. Una unidad cuyo `numeroEconomico` ya existe sale en `duplicadas` con su id y se queda como está. Es deliberado: si el TMS remanda el lote con la póliza vieja de su exportación, sobrescribir borraría un dato bueno con uno viejo. El alta masiva DA DE ALTA; corregir se hace en el panel.\n\n'
            + 'El `numeroEconomico` es único por flota: repetirlo en la forma de una unidad devuelve 200 con la unidad que ya existía.',
          tags: ['unidades'],
          parameters: [cabeceraIdempotencia],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/AltaUnidad' },
                    { $ref: '#/components/schemas/LoteUnidades' },
                  ],
                },
              },
            },
          },
          responses: {
            // Las dos formas del cuerpo contestan con la suya. El 201 del lote
            // NO significa «las N quedaron»: significa que el lote se procesó,
            // y cuántas quedaron lo dicen los tres arreglos.
            '201': {
              description: 'Se procesó el alta. Con una unidad: quedó creada. Con un lote: revisa `creadas`, `duplicadas` y `errores` — no todas las filas tuvieron que quedar.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      seCreo('La unidad', UNIDAD_CREADA).content['application/json'].schema,
                      loteCreado('unidades', UNIDAD_CREADA_EN_LOTE, 'creadas', 'duplicadas').content['application/json'].schema,
                    ],
                  },
                },
              },
            },
            '200': yaExistia('Una unidad con ese número económico', UNIDAD_CREADA),
            '409': conflictoNatural('una unidad', 'número económico'),
            ...respuestasError,
            // Va DESPUÉS del spread a propósito: pisa el 400 genérico con el
            // que sí trae el detalle por fila del lote.
            '400': loteTodoInvalido('ninguna unidad'),
          },
        },
        get: {
          operationId: 'listarUnidades',
          'x-likida-area': 'operacion',
          summary: 'El parque vehicular con sus vigencias de ley.',
          description: `Área \`operacion\`. \`resumen\` cuenta la FLOTA ENTERA, no la página: un semáforo calculado sobre 50 de 300 unidades diría que no hay nada vencido porque los vencidos cayeron en la página 3. \`diasAviso\` (${DIAS_AVISO}) es la anticipación con la que una vigencia pasa a \`por_vencer\`.`,
          tags: ['unidades'],
          parameters: [...parametrosPagina],
          responses: {
            '200': {
              description: 'Página de unidades más el resumen de la flota.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      datos: { type: 'array', items: { $ref: '#/components/schemas/Unidad' } },
                      pagina: paginaSobre,
                      resumen: {
                        type: 'object',
                        properties: {
                          vencidos: { type: 'integer' },
                          porVencer: { type: 'integer' },
                          vigentes: { type: 'integer' },
                          sinDato: { type: 'integer', description: 'Unidades sin un solo papel capturado. NO son "vigentes".' },
                          diasAviso: { type: 'integer' },
                        },
                        required: ['vencidos', 'porVencer', 'vigentes', 'sinDato', 'diasAviso'],
                      },
                    },
                    required: ['datos', 'pagina', 'resumen'],
                  },
                },
              },
            },
            ...respuestasError,
          },
        },
      },
      '/v1/operadores': {
        post: {
          operationId: 'crearOperadores',
          'x-likida-area': 'administracion',
          summary: 'Da de alta choferes, de uno o en lote.',
          description:
            'Requiere el área `administracion`. Un chofer nuevo es una persona con contrato y su alta dispara el aviso de privacidad; por eso escribir es `administracion` aunque LEER el padrón sea `operacion`.\n\n'
            + 'EL TENANT NO SE MANDA: sale de la credencial, igual que en el resto de /v1.\n\n'
            + `DOS FORMAS DE CUERPO, la misma por dentro: los campos en la raíz (un chofer) o \`{ "operadores": [ … ] }\` (hasta ${FILAS_POR_TANDA} filas). Un padrón de 800 son cuatro POST, cada uno con su \`${CABECERA_IDEMPOTENCIA}\`.\n\n`
            + 'EL TELÉFONO ES LA IDENTIDAD. Se normaliza a E.164 de México y es único por flota. Tres desenlaces, y los tres se dicen: si el número ya es de un chofer de TU flota, la fila sale en `duplicados` con el id del que ya estaba; si es de un chofer ACTIVO de OTRA flota, la fila sale en `errores` y no se escribe —dos flotas no pueden compartir la identidad de un chofer sin cruzar el dinero de las dos—; si es de uno tuyo dado de baja, la fila sale en `errores` pidiendo que lo reactives en vez de crear un segundo registro de la misma persona.\n\n'
            + 'UNA FILA MALA NO TIRA EL LOTE. Cada fila inválida sale en `errores` con su número de fila (empezando en 1) y el qué corregir. `creados + duplicados + errores` siempre suma `recibidas`. Si NINGUNA fila sirve, es 400 con el detalle en `error.filas` y no se escribe nada.\n\n'
            + 'EL AVISO DE PRIVACIDAD SE ENCOLA, NO SE DA POR ENTREGADO. `avisoPendiente` dice a cuántos de los recién creados les falta recibirlo; se les entrega en su primer contacto con el bot. Un alta masiva NO es un consentimiento masivo, y esta API no finge que lo sea.',
          tags: ['operadores'],
          parameters: [cabeceraIdempotencia],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/AltaOperador' },
                    { $ref: '#/components/schemas/LoteOperadores' },
                  ],
                },
              },
            },
          },
          responses: {
            '201': loteCreado('operadores', OPERADOR_CREADO_EN_LOTE, 'creados', 'duplicados', {
              avisoPendiente: { type: 'integer', description: 'Cuántos de los recién creados traen el aviso de privacidad POR ENTREGAR. Se les entrega en su primer mensaje al bot; aquí solo se dice cuántos son.' },
            }),
            ...respuestasError,
            // Va DESPUÉS del spread a propósito: pisa el 400 genérico con el
            // que sí trae el detalle por fila del lote.
            '400': loteTodoInvalido('a ningún chofer'),
          },
        },
        get: {
          operationId: 'listarOperadores',
          'x-likida-area': 'operacion',
          summary: 'El padrón de choferes con la vigencia de su licencia.',
          description: `Área \`operacion\`: el jefe de tráfico es exactamente quien debe enterarse de que a un chofer se le venció la licencia y hoy no puede salir.\n\n`
            + `\`licencia.estado\` vale \`vencido\`, \`por_vencer\`, \`vigente\` o \`sin_dato\`, y **\`sin_dato\` NO ES \`vigente\`**: significa que a ese chofer NADIE le capturó la licencia, no que esté en regla. \`diasAlVencimiento\` es negativo cuando ya venció y \`null\` cuando no hay dato — nunca 0. \`diasAviso\` (${DIAS_AVISO}) es la anticipación con la que se pasa a \`por_vencer\`.\n\n`
            + 'EL `total` DE `pagina` ES UN CONTEO REAL sobre todo el padrón, no el largo de esta página: la base pagina y cuenta en la misma consulta, así que a cientos de choferes el padrón entero no viaja.\n\n'
            + 'EL RFC NO SE DEVUELVE, aunque se acepte al dar de alta: es dato fiscal de una persona física y ningún integrador de tráfico lo necesita para despachar un viaje. Lo que no se manda no se puede filtrar.\n\n'
            + '`desplazamiento` tiene que ser múltiplo de `limite` en esta ruta (el padrón se pagina por páginas completas).',
          tags: ['operadores'],
          parameters: [
            ...parametrosPagina,
            {
              name: 'q',
              in: 'query',
              required: false,
              description: 'Busca por nombre, teléfono o número de empleado. Sin acentos y sin distinguir mayúsculas: «ramirez» encuentra a «Ramírez».',
              schema: { type: 'string', maxLength: MAX_BUSQUEDA_OPERADORES },
            },
          ],
          responses: {
            '200': {
              description: 'Página del padrón.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      datos: { type: 'array', items: { $ref: '#/components/schemas/Operador' } },
                      pagina: paginaSobre,
                      diasAviso: { type: 'integer', description: 'Con cuántos días de anticipación una licencia pasa a `por_vencer`. Viaja en la respuesta para que no lo fijes por tu cuenta en otro número.' },
                    },
                    required: ['datos', 'pagina', 'diasAviso'],
                  },
                },
              },
            },
            ...respuestasError,
          },
        },
      },
      '/v1/clientes': {
        get: {
          operationId: 'listarClientes',
          'x-likida-area': 'dinero',
          summary: 'A quién le factura la flota, cuánto le debe y cuánto está vencido.',
          description: 'Área `dinero`. `resumen` es de la CARTERA ENTERA, no de la página: la concentración de una página no significa nada, y es la cifra con la que se decide si la flota depende de un solo cliente.',
          tags: ['clientes', 'dinero'],
          parameters: [...parametrosPagina],
          responses: {
            '200': {
              description: 'Página de clientes más el resumen de la cartera.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      datos: { type: 'array', items: { $ref: '#/components/schemas/Cliente' } },
                      pagina: paginaSobre,
                      resumen: {
                        type: 'object',
                        properties: {
                          ingresoTotal: { type: 'number', description: 'Suma del ingreso capturado. NO incluye lo no capturado — mira `sinIngresoTotal`.' },
                          concentracion: anulable('number', '% del ingreso que depende del cliente más grande. `null` sin ingreso capturado: no hay contra qué medir, y un 0% afirmaría que ningún cliente pesa.'),
                          viajesSinCliente: { type: 'integer' },
                          conIngreso: { type: 'integer', description: 'Viajes que SÍ traen ingreso capturado — el denominador honesto de `ingresoTotal`.' },
                          sinIngresoTotal: { type: 'integer' },
                          tarifasCapturadas: { type: 'integer' },
                          hoy: { type: 'string', description: 'El día (America/Mexico_City) contra el que se juzgó vigencia y vencimiento. Compara contra esto, no contra el reloj de tu servidor.' },
                        },
                        required: ['ingresoTotal', 'concentracion', 'viajesSinCliente', 'conIngreso', 'sinIngresoTotal', 'tarifasCapturadas', 'hoy'],
                      },
                    },
                    required: ['datos', 'pagina', 'resumen'],
                  },
                },
              },
            },
            ...respuestasError,
          },
        },
      },
      '/v1/liquidaciones': {
        get: {
          operationId: 'listarLiquidaciones',
          'x-likida-area': 'dinero',
          summary: 'El cierre de cada viaje, con la firma de quien lo revisó.',
          description:
            'Área `dinero`: anticipo, comprobado y diferencia por viaje.\n\n'
            + 'POR OMISIÓN TRAE SOLO LO ASENTABLE (`?revision=firmadas`: aprobada o ajustada). Las que esperan firma y las rechazadas —cuyas cifras el motor va a '
            + 'recalcular en cuanto llegue el comprobante bueno— se piden explícito con `?revision=pendiente` o `?revision=rechazada`; `?revision=todas` las trae todas. '
            + 'El filtro aplicado viaja en `filtro.revision` de la respuesta, para que nadie confunda "no hay" con "no lo pedí".\n\n'
            + 'Recorre el histórico con el cursor: `?despues=` + el `pagina.siguiente` de la respuesta anterior, hasta que `siguiente` sea `null`.',
          tags: ['liquidaciones', 'dinero'],
          parameters: [
            ...parametrosPagina, ...parametrosCursor,
            {
              name: 'revision', in: 'query', required: false,
              description: 'Qué revisiones traer. Un valor desconocido es 400 — no se cae al default en silencio.',
              schema: { type: 'string', enum: ['firmadas', 'todas', 'pendiente', 'aprobada', 'ajustada', 'rechazada'], default: 'firmadas' },
            },
          ],
          responses: {
            '200': {
              description: 'Página de liquidaciones más el filtro que se aplicó.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      datos: { type: 'array', items: { $ref: '#/components/schemas/Liquidacion' } },
                      pagina: paginaSobre,
                      filtro: {
                        type: 'object',
                        properties: {
                          revision: { type: 'string' },
                          significado: { type: 'string', description: 'El corte, en español: qué entró y qué no.' },
                        },
                        required: ['revision', 'significado'],
                      },
                    },
                    required: ['datos', 'pagina', 'filtro'],
                  },
                },
              },
            },
            ...respuestasError,
          },
        },
      },
      '/v1/openapi': {
        get: {
          operationId: 'obtenerOpenapi',
          summary: 'Este documento.',
          description: 'La única ruta de /v1 que no pide credencial: es una constante, no toca la base y no puede filtrar el dato de ninguna flota. Sin ella no se puede generar el cliente que sabe autenticarse.',
          tags: ['meta'],
          security: [],
          responses: {
            '200': { description: 'El documento OpenAPI 3.1.', content: { 'application/json': { schema: { type: 'object' } } } },
            '429': respuestasError['429'],
          },
        },
      },
    },
  };
}

export async function GET(req: Request) {
  // Acotado por IP aunque sea público: un documento estático que cualquiera
  // puede pedir sin límite es un amplificador barato, y el costo de servirlo lo
  // paga la función serverless.
  if (!(await rateLimit(`v1:openapi:${clientIp(req)}`, 30, 60_000))) {
    return errorApi('demasiadas_peticiones', 'Máximo 30 peticiones por minuto. El documento no cambia entre despliegues: guárdalo.');
  }

  // `NEXT_PUBLIC_APP_URL` tiene que ser `https://app.likida.ai` (ver CLAUDE.md).
  // Se cae al origen de la petición si no está puesta, en vez de escribir un
  // dominio a mano: un `servers` equivocado manda el cliente generado a un host
  // que no existe, y ese fallo aparece hasta la primera llamada del integrador.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  return NextResponse.json(documento(base), {
    headers: {
      // El documento sólo cambia con un despliegue. Es público y sin datos de
      // ninguna flota, así que se puede cachear en el CDN sin riesgo de
      // servirle la respuesta de un tenant a otro.
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
