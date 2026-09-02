import {
  probarConGuardas, sinApiQueProbar, veredictoHttp, type Conector,
} from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// TAG DE CASETAS Y MONEDEROS DE DIÉSEL.
//
// ── LO QUE HAY QUE DECIR ANTES QUE NADA ─────────────────────────────────
//
// **Ningún TAG de casetas publica una API para terceros.** Ni IAVE, ni PASE,
// ni TeleVía, ni ViaPass, ni EasyTrip. No es que no la hayamos encontrado: es
// que su producto es un portal para el titular de la cuenta, no una plataforma
// de integración. Y hay evidencia de que ni siquiera ENTRE ELLOS usan API — el
// Manual de Procedimientos del Sistema de Telepeaje de CAPUFE describe que el
// intercambio diario entre operadores va por archivo y correo electrónico, con
// el layout que pactaron en sus convenios bilaterales.
//
// De los monederos de diésel, de ocho revisados solo uno publica documentación
// de API (PowerGAS), y ni ese publica su host de producción. Los grandes
// —Edenred, Sí Vale, Pluxee, Efectivale, Toka, Petro-7, Broxel— no.
//
// Escribir aquí un `https://api.pase.com.mx/v1/movimientos` sería inventar. Se
// vería idéntico a un endpoint correcto hasta que alguien lo llamara delante de
// un cliente. Hay un caso que ilustra la tentación: `televia.com.mx` tiene un
// subdominio `api_gateway_appcore` que responde con la página por omisión de
// IIS. Es el gateway interno de su app: sin documentación, sin contrato y sin
// autenticación conocida. NO se usa y se deja escrito para que nadie lo
// "descubra" otra vez y crea que encontró la API de TeleVía.
//
// ── Y SIN EMBARGO ESTA ES LA CATEGORÍA QUE MÁS DINERO MUEVE ─────────────
//
// Diésel por monedero y peaje por TAG son, por estimación interna SIN FUENTE
// CONFIRMADA (ver la nota en `intake/cfdi_xml.ts`), una fracción grande del
// gasto real de una flota. O sea que la categoría sin APIs es justo la que
// decide si la liquidación cuadra.
//
// De ahí que el escalón real NO sea "esperamos a que saquen API". Es el
// ARCHIVO, y está construido y funcionando:
//
//   · `peajes/desglose.ts` lee el desglose de cruces que el proveedor manda
//     cada ~10 días (fecha, caseta, importe, tag) y normaliza cada fila,
//     detectando las columnas por nombre.
//   · `intake/cfdi_xml.ts` lee el CFDI consolidado. Y aquí está el hallazgo que
//     cambia la categoría entera: el complemento **ECC12** (Estado de Cuenta de
//     Combustibles) trae, POR TRANSACCIÓN, la fecha real de la compra, el RFC
//     de la gasolinera —distinto del emisor, que es el monedero—, la clave de
//     estación, el importe y el folio de operación. Para monedero de diésel eso
//     ES la integración: el estándar del SAT da la granularidad que la API
//     inexistente daría.
//
// La asimetría importa y hay que decirla en la venta: para MONEDERO el archivo
// llega completo (ECC12 tiene fecha por línea); para TAG DE CASETAS no, porque
// CFDI 4.0 no declara fecha por concepto y el desglose de cruces viene aparte.
// Por eso el monedero está `por_archivo` (terminado) y los TAG también, pero
// dependiendo de que el cliente baje su desglose del portal.
//
// ── LO QUE NO SE VA A HACER, Y POR QUÉ SE DICE ──────────────────────────
//
// Automatizar la descarga del portal con un navegador (lo que ya hace el agente
// de facturación con CAPUFE) es posible y es el siguiente escalón real. NO se
// promete aquí porque cada portal cambia sin avisar y porque un scraper que se
// rompe en silencio es peor que una descarga manual: el contralor deja de subir
// el archivo creyendo que llega solo, y el mes cierra sin conciliar.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lo que un TAG o monedero puede entregar HOY, y no es poco.
 *
 * Las tres capacidades son de LECTURA a propósito: en esta categoría Likida
 * nunca escribe. Un monedero de diésel y un TAG mueven saldo de verdad, y un
 * adaptador que pudiera escribir es un adaptador que un día recarga de más.
 */
const CAPACIDADES_TAG = ['leer_estado_cuenta', 'leer_movimientos', 'leer_cfdi'] as const;

/**
 * El texto que comparten los tres TAG. Escrito una vez a propósito: tres copias
 * se despegan, y la primera que se despegue va a ser la que un vendedor infle.
 */
function comoConectaTag(portal: string, seccion: string): string {
  return `Bajas tu desglose de cruces del portal (${portal}, en ${seccion}) y lo subes: Excel, CSV o PDF. El Agente de Peajes lo cruza contra los viajes línea por línea y arma la bitácora que pide el estímulo del 50% de peaje.`;
}

const SUBIR_DE_ESCALON_TAG =
  'Que el proveedor publique una API, que hoy no existe. El escalón intermedio realista es que Likida entre a tu portal con tus credenciales y baje el desglose sola —igual que ya hace con CAPUFE para facturar—; se evalúa portal por portal y no se promete antes de probarlo, porque un portal que cambia rompe la descarga en silencio.';

/** Un `probar()` honesto para quien no tiene API. Idéntico para los cinco. */
function noHayApi(nombre: string): Conector['probar'] {
  return async () => sinApiQueProbar(
    `${nombre} no publica una API para terceros, así que no hay credencial que probar. La conexión de hoy es el archivo que tú bajas de su portal, y ese camino ya funciona.`,
  );
}

// ── Los tres TAG ───────────────────────────────────────────────────────────

export const IAVE: Conector = {
  id: 'iave',
  nombre: 'IAVE (TAG de CAPUFE)',
  categoria: 'Peaje y monederos',
  queHace: 'Concilia cada cruce de caseta contra el viaje que lo causó, para que el peaje deje de cuadrarse a ojo contra un estado de cuenta consolidado.',
  formaDeConectar: 'por_archivo',
  comoConectaHoy: comoConectaTag('iave.capufe.gob.mx', 'Transacciones → Cruces'),
  // EL TOPE DE 31 DÍAS ES UNA RESTRICCIÓN OPERATIVA, NO UN DETALLE. Un cierre
  // mensual no cabe en una sola consulta si el mes tiene 31 días y el filtro es
  // por fecha de emisión: hay que bajarlo en dos tramos. Quien no lo sepa cierra
  // el mes con el peaje incompleto y no se entera, porque el archivo corto se ve
  // igual que uno completo.
  paraSubirDeEscalon: `${SUBIR_DE_ESCALON_TAG} Y para IAVE hay que contar con que el portal solo deja consultar rangos de 31 días: cualquier automatización tiene que partir el periodo, no pedirlo de un jalón.`,
  capacidades: [...CAPACIDADES_TAG],
  // No hay tabla donde guardar credenciales de peaje: `rastreo_credencial` solo
  // admite proveedores de GPS (constraint `rastreo_proveedor_dominio`, mig.
  // 0050). Hoy no hace falta —el archivo no lleva credencial—, y el día que se
  // automatice la descarga del portal habrá que crearla. Está en el reporte.
  claveAlmacen: null,
  // La fuente NO documenta una API —no existe—: documenta quién opera el TAG y
  // por dónde sale el dato. El portal ya está registrado además como comercio de
  // facturación (`facturacion/comercios.ts`, clave `iave`), que es otra cosa:
  // sirve para timbrar, no para leer cruces.
  fuente: {
    url: 'https://iave.capufe.gob.mx/assets/Doc/GUIA-IAVE.pdf',
    queConfirma: 'El Portal IAVE es el medio por el que el titular administra su TAG y descarga el detalle de sus cruces, con secciones «Transacciones → Cruces», «Saldos → Balance de Movimientos» y «Saldos → Facturación Electrónica»; las consultas están topadas a rangos de 31 días. No se documenta ninguna API, web service ni intercambio de datos con terceros. Los Lineamientos del Servicio de Telepeaje IAVE (DOF, jul-2026) confirman que hoy lo opera CAPUFE directamente, después de haberlo delegado a proveedores privados entre 2014 y 2020.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [],
  probar: noHayApi('IAVE'),
};

export const PASE: Conector = {
  id: 'pase',
  nombre: 'TAG PASE',
  categoria: 'Peaje y monederos',
  queHace: 'Lo mismo que IAVE pero para las autopistas donde PASE es el TAG aceptado, que en la práctica es la mayoría de las concesionadas.',
  formaDeConectar: 'por_archivo',
  comoConectaHoy: comoConectaTag('apps.pase.com.mx', 'Cierres → Detalle de cruces'),
  // De los tres TAG, este es el de mejor archivo y conviene saberlo antes de
  // arrancar un piloto: su Excel de cruces trae plaza, tramo carretero, fecha y
  // hora al segundo, e importe. Con la hora al segundo el cruce se puede pegar
  // a un viaje sin ambigüedad; con solo la fecha, dos viajes del mismo día por
  // la misma caseta se vuelven un empate que alguien tiene que romper a mano.
  paraSubirDeEscalon: SUBIR_DE_ESCALON_TAG,
  capacidades: [...CAPACIDADES_TAG],
  claveAlmacen: null,
  fuente: {
    url: 'https://www.pase.com.mx/wp-content/uploads/2019/04/CORPORATIVOS_TDC_PASE.pdf',
    queConfirma: 'El portal corporativo de PASE permite descargar en la sección «Cierres» el detalle de cruces en formato de archivo Excel, y tiene además secciones de TAGs, Cruces (con plaza de cobro, tramo carretero, fecha y hora al segundo, e importe), Facturas y Aclaraciones. No documenta API ni web service para terceros.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [],
  probar: noHayApi('PASE'),
};

export const TELEVIA: Conector = {
  id: 'televia',
  nombre: 'TeleVía',
  categoria: 'Peaje y monederos',
  queHace: 'Concilia los cruces de TeleVía, que es el TAG de buena parte del peaje concesionado y del Circuito Exterior.',
  formaDeConectar: 'por_archivo',
  comoConectaHoy: comoConectaTag('televia.com.mx', 'el portal de flotillas'),
  // Lo que NO se pudo verificar y por eso NO se promete: si el botón "Exportar
  // a Excel" del portal cubre también los MOVIMIENTOS o solo el listado de
  // facturas. Se confirmó en la vista de facturas y nada más. Asumir lo otro
  // sería prometer una conciliación de cruces que quizá haya que teclear.
  paraSubirDeEscalon: `${SUBIR_DE_ESCALON_TAG} De TeleVía falta confirmar algo concreto en una cuenta real: si su «Exportar a Excel» incluye los movimientos o nada más las facturas.`,
  capacidades: [...CAPACIDADES_TAG],
  claveAlmacen: null,
  fuente: {
    url: 'https://www.televia.com.mx/flotillas',
    queConfirma: 'TeleVía ofrece a flotillas un portal web para reportes donde se administra en línea el detalle de cruces, más un portal de facturas con filtro por fecha y botón «Exportar a Excel». No publica API, web service ni portal de desarrolladores. La razón social es Operadora Concesionaria Mexiquense, del grupo Aleatica.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [],
  probar: noHayApi('TeleVía'),
};

// ── Monedero de diésel ─────────────────────────────────────────────────────

export const MONEDERO_DIESEL: Conector = {
  id: 'monedero_diesel',
  nombre: 'Monedero de diésel (Edenred, Efectivale, Si Vale, Petro y demás)',
  categoria: 'Peaje y monederos',
  queHace: 'Convierte el CFDI consolidado del monedero en una carga por transacción —con su fecha real, su estación y su importe— y la cruza contra el viaje y el rendimiento de la unidad.',
  formaDeConectar: 'por_archivo',
  // Este es el único de la categoría donde el archivo NO es un escalón
  // intermedio: es la integración completa, y por eso `paraSubirDeEscalon` va
  // en `null`. El complemento ECC12 del SAT trae por transacción lo mismo que
  // daría una API —fecha, RFC de la estación, clave de estación, importe,
  // folio— y además viene firmado. Prometer "API del monedero" encima de eso
  // sería vender un escalón que no agrega nada.
  comoConectaHoy: 'Reenvías el XML del CFDI que te manda tu monedero y ya está: su complemento ECC12 trae cada carga con su fecha real, la gasolinera donde se hizo y su importe. No hace falta que nos des acceso a su portal.',
  paraSubirDeEscalon: null,
  capacidades: [...CAPACIDADES_TAG],
  claveAlmacen: null,
  // LA FUENTE ES EL SAT Y NO UN PROVEEDOR, y esa es toda la gracia. De ocho
  // monederos revistados (Edenred, Sí Vale, Pluxee, Efectivale, Toka, Petro-7,
  // Broxel y PowerGAS) solo uno publica documentación de API. Pero TODOS los
  // emisores autorizados están obligados al mismo complemento, así que el
  // estándar del SAT es la única integración que sirve para los ocho a la vez.
  // Es más robusta que una API por proveedor, no menos: no depende de que
  // ninguno de ellos decida algo.
  fuente: {
    url: 'http://omawww.sat.gob.mx/informacion_fiscal/factura_electronica/Documents/Complementoscfdi/ecc.pdf',
    queConfirma: 'El complemento «Estado de Cuenta de Combustibles» (ECC, espacio de nombres ecc12) obliga al emisor del monedero a declarar, POR CADA consumo, el identificador del monedero, la fecha y hora de la operación, el RFC del enajenante —la gasolinera, distinta del emisor—, la clave de estación, la cantidad, el tipo de combustible (3 = Diesel), el folio de operación, el valor unitario, el importe y los traslados de IVA e IEPS.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [],
  probar: noHayApi('Tu monedero de diésel'),
};

export const POWERGAS: Conector = {
  id: 'powergas',
  nombre: 'PowerGAS (monedero con API)',
  categoria: 'Peaje y monederos',
  queHace: 'Baja los consumos de diésel solos, sin esperar al CFDI del mes: litros, precio, estación, kilometraje y número económico por cada carga.',
  // NO es `api_en_vivo`, y por una razón concreta y verificable: su
  // documentación pública solo publica el host de DEMO. El de producción no
  // aparece en ningún lado. Cablear `api.powergas.mx` sería inventar el dato
  // más importante de la conexión, así que lo pide el formulario y lo da el
  // proveedor del cliente. Es el mismo trato que `gps_generico`.
  formaDeConectar: 'requiere_piloto',
  comoConectaHoy: 'De los monederos que revisamos, es el único con API documentada. Necesita que tu ejecutivo de PowerGAS nos dé la dirección de producción y una llave de solo lectura — su documentación pública solo publica el servidor de pruebas. Mientras tanto, el camino del CFDI de arriba ya funciona.',
  paraSubirDeEscalon: 'La dirección del servidor de producción y una API key de lectura, las dos de tu ejecutivo de PowerGAS. La documentación de la API es pública, pero el acceso no es de autoservicio: la llave la entrega el proveedor.',
  capacidades: ['leer_movimientos', 'leer_cfdi'],
  claveAlmacen: null,
  fuente: {
    url: 'https://api.powergas.mx/',
    queConfirma: 'La API de PowerGAS se autentica con HTTP Basic, donde el usuario es el nombre de usuario y la contraseña es la API key, con permisos de lectura o escritura por endpoint. Expone consultas de solo lectura como ConsultaConsumos (con fechaInicio y fechaFinal, y el catálogo de combustibles donde 1 = Diesel), ConsultaCFDI (que devuelve el XML del estado de cuenta o de la factura), ConsultaTarjetas, ConsultaRendimientos y Vehiculos. La documentación publica el host de demostración; el de producción no aparece en ella.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [
    {
      clave: 'base_url',
      rotulo: 'Dirección del servidor de PowerGAS',
      forma: 'url',
      requerida: true,
      // Requerida y sin default a propósito: no hay uno publicado. Poner el de
      // demo como valor por omisión sería peor que no ponerlo — alguien
      // conectaría producción contra el ambiente de pruebas y vería consumos
      // de mentira sin darse cuenta.
      ayuda: 'Pídesela a tu ejecutivo de PowerGAS. No la ponemos por omisión: su documentación solo publica el servidor de pruebas, y conectar tu cuenta real contra pruebas daría consumos falsos que se ven verdaderos.',
    },
    {
      clave: 'usuario',
      rotulo: 'Usuario de la API',
      forma: 'texto',
      requerida: true,
      ayuda: 'El nombre de usuario que PowerGAS asigna a tu integración, junto con la llave.',
    },
    {
      clave: 'api_key',
      rotulo: 'API key de PowerGAS',
      forma: 'secreto',
      requerida: true,
      ayuda: 'La entrega PowerGAS. Pide que sea de SOLO LECTURA: su API también permite transferir saldo, y Likida no necesita ese permiso.',
    },
  ],
  probar: (v, http) => probarConGuardas(POWERGAS, v, async () => {
    // `ConsultaTarjetas` y no `ConsultaConsumos`: es la lectura más barata que
    // confirma que la llave pertenece a una cuenta, sin traerse el histórico de
    // cargas de nadie ni pedir un rango de fechas que habría que inventar.
    const endpoint = `${(v.base_url ?? '').trim().replace(/\/+$/, '')}/Cliente/V2/ConsultaTarjetas`;
    const auth = Buffer.from(`${v.usuario ?? ''}:${v.api_key ?? ''}`).toString('base64');
    const r = await http({ url: endpoint, metodo: 'GET', encabezados: { Authorization: `Basic ${auth}` } });
    return veredictoHttp(r, endpoint, 'PowerGAS');
  }),
};

// ── El genérico ────────────────────────────────────────────────────────────

export const PEAJE_GENERICO: Conector = {
  id: 'peaje_generico',
  nombre: 'Otro TAG o convenio de caseta',
  categoria: 'Peaje y monederos',
  queHace: 'Lee el desglose de cualquier otro proveedor de peaje —o del convenio directo con una concesionaria— con el mismo lector, aunque sus columnas se llamen distinto.',
  formaDeConectar: 'por_archivo',
  comoConectaHoy: 'Nos mandas su archivo tal cual viene. El lector detecta las columnas por nombre y ya reconoce los encabezados que usan IAVE, PASE, TeleVía y varios convenios; uno nuevo es una línea de código, no un proyecto.',
  // Sí tiene siguiente escalón, y es distinto al de los TAG con nombre: aquí lo
  // que falta no es una API, es haber visto el archivo. Decirlo evita que
  // alguien prometa que "ya lee cualquier formato" — el lector avisa qué
  // encabezados leyó y se niega a adivinar cuál columna era el dinero.
  paraSubirDeEscalon: 'Un archivo de ejemplo del proveedor. Si sus encabezados no están en la lista, el lector lo dice con los nombres que sí encontró en vez de conciliar con la columna equivocada.',
  capacidades: ['leer_movimientos'],
  claveAlmacen: null,
  fuente: null,
  credenciales: [],
  probar: noHayApi('Tu proveedor de peaje'),
};

/**
 * Peaje y monederos, con lo más común primero.
 *
 * El monedero genérico va antes que PowerGAS aunque PowerGAS tenga API: la
 * ruta del CFDI sirve para los ocho proveedores y la API sirve para uno. Poner
 * arriba lo que tiene API describiría el catálogo por lo que es bonito de
 * construir, no por lo que le sirve a la flota que está leyendo.
 */
export const CONECTORES_PEAJE: readonly Conector[] = [
  MONEDERO_DIESEL,
  IAVE,
  PASE,
  TELEVIA,
  POWERGAS,
  PEAJE_GENERICO,
];
