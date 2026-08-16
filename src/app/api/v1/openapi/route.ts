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
      description: 'Si vale la pena pedir la siguiente página. Con `total` conocido es exacto; sin él es conservador (dice que quizá falta antes que esconder el resto).',
    },
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
    description: `Desde qué fila. \`desplazamiento\` + \`limite\` no puede pasar de ${VENTANA_MAXIMA} en una petición: es el \`max_rows\` del servidor de datos, o sea lo máximo que puede entregar demostrando que no recortó.`,
    schema: { type: 'integer', minimum: 0, default: 0 },
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
        Pagina: paginaSobre,
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
          summary: 'Los viajes de la flota, el más reciente primero.',
          description: 'Área `operacion`: no devuelve un peso. El anticipo por viaje se queda fuera a propósito — es dinero, y el jefe de tráfico ve esta ruta.',
          tags: ['viajes'],
          parameters: [...parametrosPagina],
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
          summary: 'Da de alta una unidad del parque vehicular.',
          description:
            'Requiere el área `administracion`. Es la ruta con la que se carga el parque desde un TMS o un CSV sin teclearlo a mano.\n\n'
            + 'EL TENANT NO SE MANDA: sale de la credencial, igual que en `POST /v1/viajes`.\n\n'
            + 'NO SE CAPTURAN VIGENCIAS AQUÍ. La póliza, el permiso SICT y la verificación se cargan por su propia pantalla: son fechas cuya caducidad dispara alertas, y aceptarlas en el alta masiva es la forma más rápida de llenar la flota de vencimientos inventados por un CSV mal mapeado. Una unidad recién creada aparece en el panel como `sin_dato`, que es lo que de verdad se sabe de ella.\n\n'
            + 'El `numeroEconomico` es único por flota: repetirlo devuelve 200 con la unidad que ya existía.',
          tags: ['unidades'],
          parameters: [cabeceraIdempotencia],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
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
                },
              },
            },
          },
          responses: {
            '201': seCreo('La unidad', UNIDAD_CREADA),
            '200': yaExistia('Una unidad con ese número económico', UNIDAD_CREADA),
            '409': conflictoNatural('una unidad', 'número económico'),
            ...respuestasError,
          },
        },
        get: {
          operationId: 'listarUnidades',
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
      '/v1/clientes': {
        get: {
          operationId: 'listarClientes',
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
