import {
  probarConGuardas, sinApiQueProbar, veredictoHttp,
  type Conector, type ResultadoPrueba,
} from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LOS SISTEMAS DE LA OFICINA — ERP, contabilidad, TMS y el archivo.
//
// ── EL ORDEN LO DECIDE EL CENSO, NO EL PRESTIGIO ────────────────────────
//
// Censo de vacantes de autotransporte (1,987 empresas, 14-ago-2026). Cuántas
// nombran cada sistema al contratar gente:
//
//     Excel 723 (36.4%) · SAP 191 (9.6%) · CONTPAQi 110 (5.5%)
//     Oracle 62 (3.1%) · Aspel 36 (1.8%) · TMS 22 (1.1%) · Odoo 22 (1.1%)
//
// Dos consecuencias que cambian el catálogo entero:
//
//   1. EXCEL ES EL INCUMBENTE, no el premio de consuelo. Lo nombran 33 veces
//      más empresas que a cualquier TMS y 3.8 veces más que a SAP. La ruta de
//      archivo va PRIMERA y se declara terminada, porque lo está: el export
//      CSV existe y funciona (`/api/export/liquidaciones`,
//      `/api/export/facturas-proveedor`). Enterrarla al final describiría un
//      mercado que no es el mexicano.
//   2. NINGÚN TMS TIENE MERCADO. 22 empresas de 1,987 nombran uno, y ninguna
//      marca se repite lo suficiente para valer un adaptador. El prospecto real
//      —Transportes Innovativos— está reescribiendo el suyo. Por eso hay UN
//      conector genérico de TMS y no seis con nombre propio.
//
// ── QUÉ SE PUEDE PROMETER DE UN ERP SIN TENER UNA INSTANCIA ─────────────
//
// De cada uno se verificó la AUTENTICACIÓN contra la documentación del
// fabricante (URL y fecha en su `fuente`). Lo que NO se verificó es una sola
// escritura: no hay ninguna instancia de ningún cliente. `escribir_asiento`
// declara lo que el sistema sabe hacer, no algo que ya hayamos hecho.
//
// Y hay una asimetría que conviene decir en voz alta: LEER un ERP es barato de
// prometer, ESCRIBIR en él no. Una póliza mal armada no falla ruidosamente —
// importa mal y ensucia un cierre contable, que alguien descubre en la
// declaración. Por eso ningún adaptador de aquí escribe en `probar()`, y por
// eso los layouts de CONTPAQi y Aspel siguen sin escribirse: se harán contra el
// archivo de ejemplo de la primera flota que los pida, no adivinando el formato
// (la misma decisión que ya está tomada en `ajustes_operativos.ts`).
// ═══════════════════════════════════════════════════════════════════════════

function base(v: string | undefined, porDefecto = ''): string {
  const b = (v ?? '').trim() || porDefecto;
  return b.replace(/\/+$/, '');
}

function json(cuerpo: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(cuerpo);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cuerpoIlegible(endpoint: string, nombre: string): ResultadoPrueba {
  return {
    ok: false,
    detalle: `${nombre} contestó 200 pero no con la respuesta que documenta su API. Suele ser un portal web o un proxy en medio, no el endpoint. NO se puede afirmar que la credencial sirva.`,
    verificadoContra: endpoint,
  };
}

// ── El archivo: el incumbente ──────────────────────────────────────────────

export const ARCHIVO_CONTABLE: Conector = {
  id: 'archivo_contable',
  nombre: 'Excel o CSV para tu contabilidad',
  categoria: 'Hoja de cálculo y archivo',
  queHace: 'Cada liquidación y cada factura de proveedor sale como archivo con su cuenta contable, el UUID del CFDI, su estado ante el SAT y el desglose de IVA e IEPS. Lo abre Excel y lo importa casi cualquier sistema.',
  // `por_archivo` es un estado LEGÍTIMO Y TERMINADO, no un "a medias". El
  // Agente de Peajes concilia de verdad; el contador importa de verdad. Pintar
  // esto ámbar diría que falta algo, y no falta: es la ruta que más flotas
  // pueden usar HOY sin pedirle una sola credencial a nadie.
  formaDeConectar: 'por_archivo',
  comoConectaHoy: 'Ya funciona. Descargas el archivo del panel y lo importas. No hace falta que nos des acceso a ningún sistema tuyo, que es justo por lo que 723 de las 1,987 flotas del censo trabajan así.',
  paraSubirDeEscalon: null,
  capacidades: ['escribir_asiento'],
  claveAlmacen: null,
  // Sin fuente y sin que haga falta: no hay endpoint de nadie que citar. El
  // archivo lo genera este repo, y su prueba es la suite, no una URL.
  fuente: null,
  credenciales: [],
  probar: async () => sinApiQueProbar(
    'No hay nada que probar: el archivo lo genera Likida y se descarga del panel. Si el archivo no baja, el problema está en el panel, no en una credencial.',
  ),
};

export const TMS_GENERICO: Conector = {
  id: 'tms_generico',
  nombre: 'Tu TMS o sistema propio',
  categoria: 'Hoja de cálculo y archivo',
  queHace: 'Trae los viajes que ya capturaste en tu sistema para no recapturarlos en Likida, por archivo hoy y por su API cuando la tenga.',
  // NO se marca `api_en_vivo` aunque muchos TMS tengan API: sin saber CUÁL
  // sistema es, no hay endpoint que citar, y esta ficha existe justamente
  // porque el sistema cambia con cada flota.
  formaDeConectar: 'requiere_piloto',
  comoConectaHoy: 'Exportas los viajes de tu sistema a Excel o CSV y se importan. El lector ya existe (`importar_viajes.ts`) y se calibra contra TU archivo, no contra uno adivinado.',
  paraSubirDeEscalon: 'Si tu sistema tiene API, su documentación y una credencial de lectura. Solo 22 de las 1,987 flotas del censo nombran un TMS y ninguna marca se repite, así que no hay adaptador de fábrica que sirva: se escribe contra el tuyo.',
  // `leer_viajes` y no `escribir_asiento`: un TMS es de dónde SALEN los viajes,
  // no dónde entra la póliza. Confundirlos haría que la pantalla de captura le
  // pidiera a la flota permisos de escritura sobre su sistema de operación,
  // que es justo el permiso que nadie firma.
  capacidades: ['leer_viajes'],
  claveAlmacen: null,
  fuente: null,
  credenciales: [],
  probar: async () => sinApiQueProbar(
    'No hay API que probar todavía: el camino de hoy es el archivo. Si tu TMS tiene API, mándanos su documentación y una credencial de lectura y lo conectamos.',
  ),
};

// ── SAP Business One ───────────────────────────────────────────────────────

export const SAP_B1: Conector = {
  id: 'sap_b1',
  nombre: 'SAP Business One',
  categoria: 'ERP y contabilidad',
  queHace: 'Que las facturas de proveedor dejen de capturarse a mano: el Agente de Proveedores las extrae y las deja listas para el asiento, y la liquidación entra como póliza.',
  formaDeConectar: 'api_en_vivo',
  // LA ADVERTENCIA QUE NO SE PUEDE OMITIR EN LA VENTA. El Administrator's
  // Guide de SAP dice, palabra por palabra, que el Service Layer «is for
  // internal component calls only and you do not need to expose it to the
  // Internet». O sea que en un B1 instalado en la oficina —que es el caso
  // normal— Likida NO puede llamarlo desde la nube sin que el cliente abra una
  // ruta: VPN, túnel o proxy inverso. El adaptador está completo; lo que falta
  // es de red, y eso lo decide su área de sistemas, no nosotros. Prometerlo sin
  // decirlo es cómo se pierde la segunda reunión.
  comoConectaHoy: 'Con la dirección de tu Service Layer, el nombre de tu base de datos de compañía y un usuario de SAP. OJO: SAP recomienda NO exponer el Service Layer a internet, así que si tu B1 está en la oficina hace falta primero una ruta de red (VPN, túnel o proxy) que abra tu área de sistemas.',
  paraSubirDeEscalon: null,
  capacidades: ['leer_catalogo_cuentas', 'leer_proveedores', 'escribir_asiento', 'escribir_factura_proveedor'],
  claveAlmacen: null,
  fuente: {
    url: 'https://help.sap.com/doc/0d2533ad95ba4ad7a702e83570a21c32/9.3/en-US/Working_with_SAP_Business_One_Service_Layer.pdf',
    queConfirma: 'El Service Layer se publica en https://<servidor>:<puerto>/b1s/<versión>, con 50000 como puerto del balanceador. La sesión se abre con `POST /b1s/v1/Login` cuyo cuerpo JSON son exactamente `CompanyDB`, `UserName` y `Password`; la respuesta 200 trae `{"SessionId": …}` y las cookies `B1SESSION` y `ROUTEID`, que la doc marca como OBLIGATORIAS AMBAS en cada petición posterior (sin ellas, 401 "Invalid session"). `SessionTimeout` son 30 minutos por omisión y `POST /Logout` devuelve 204. `/b1s/v1` es OData v3 y `/b1s/v2` es OData v4; el API Reference 10.0 declara OData v3 obsoleto a partir de FP 2405. El Administrator\'s Guide dice que el Service Layer es para llamadas internas y no hace falta exponerlo a internet.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [
    {
      clave: 'base_url',
      rotulo: 'Dirección de tu Service Layer',
      forma: 'url',
      requerida: true,
      // Nunca hay un host que cablear: B1 es on-premise o de un socio, y el
      // puerto se cambia seguido. Lo que sí se puede es dar el patrón exacto.
      ayuda: 'Te la da tu socio de SAP. Tiene la forma https://tuservidor:50000 — 50000 es el puerto normal del Service Layer, pero puede ser otro.',
      ejemplo: 'https://sap.tuempresa.com:50000',
    },
    {
      clave: 'ruta',
      rotulo: 'Versión del Service Layer',
      forma: 'texto',
      requerida: false,
      // Configurable porque las dos rutas conviven en la misma instalación y no
      // son la misma API: v1 es OData v3 y v2 es OData v4. El default es v1
      // porque es la que existe en TODAS las versiones —v2 no está en las
      // viejas— y porque el cuerpo del Login es idéntico en las dos, así que
      // probar contra v1 verifica la credencial igual. Cablear v2 haría que un
      // B1 viejo devolviera 404 y ese 404 se leería como "credencial mala".
      ayuda: 'Déjalo vacío para b1s/v1, que existe en todas las versiones. Pon b1s/v2 si tu socio te dijo que uses OData v4 — SAP marcó OData v3 como obsoleto a partir de FP 2405, así que v2 es el camino a futuro.',
      ejemplo: 'b1s/v1',
    },
    {
      clave: 'company_db',
      rotulo: 'Base de datos de la compañía',
      forma: 'texto',
      requerida: true,
      ayuda: 'Es la que eliges al entrar a SAP Business One. Si manejas varias empresas, es la de la que vamos a liquidar.',
    },
    {
      clave: 'usuario',
      rotulo: 'Usuario de SAP',
      forma: 'texto',
      requerida: true,
      ayuda: 'Mejor un usuario creado para Likida y no el de una persona. Ojo: si tienes Single Sign-On encendido, este login no funciona con el usuario de B1 y hay que usar el del SLD.',
    },
    {
      clave: 'password',
      rotulo: 'Contraseña de ese usuario',
      forma: 'secreto',
      requerida: true,
      ayuda: 'La de ese usuario de SAP.',
    },
  ],
  probar: (v, http) => probarConGuardas(SAP_B1, v, async () => {
    const raiz = `${base(v.base_url)}/${(v.ruta ?? '').trim().replace(/^\/+|\/+$/g, '') || 'b1s/v1'}`;
    const endpoint = `${raiz}/Login`;
    const r = await http({
      url: endpoint,
      metodo: 'POST',
      encabezados: { 'Content-Type': 'application/json' },
      cuerpo: JSON.stringify({
        CompanyDB: v.company_db,
        UserName: v.usuario,
        Password: v.password,
      }),
    });
    const veredicto = veredictoHttp(r, endpoint, 'SAP Business One');
    if (!veredicto.ok) return veredicto;

    const d = json(r.cuerpo);
    // Un 200 sin `SessionId` no es una sesión: es un portal, un proxy o una
    // página de error de IIS. Aceptarlo daría por buena una credencial que SAP
    // nunca vio.
    if (d === null || typeof d.SessionId !== 'string' || d.SessionId === '') {
      return cuerpoIlegible(endpoint, 'SAP Business One');
    }

    // SE CIERRA LA SESIÓN, y no por limpieza: cada sesión del Service Layer
    // vive 30 minutos por omisión (`SessionTimeout`). Un botón de "Probar
    // conexión" que alguien pica cinco veces dejaría cinco sesiones colgadas
    // media hora en el SAP del cliente — la peor primera impresión posible.
    //
    // ES UN INTENTO, NO UNA GARANTÍA, y hay que decir por qué: SAP exige que
    // `B1SESSION` **y** `ROUTEID` viajen en cada petición, y `ROUTEID` solo
    // llega en un `Set-Cookie` que este transporte no expone (`RespuestaHttp`
    // trae estado y cuerpo, a propósito, para no arrastrar cabeceras de una
    // flota a otra). Así que detrás de un balanceador este Logout puede
    // devolver 401 y la sesión se cerrará sola a los 30 minutos. Se deja el
    // intento porque en la instalación de un solo nodo —la común en una flota
    // mediana— sí funciona, y porque el costo de intentarlo es una petición.
    try {
      await http({
        url: `${raiz}/Logout`,
        metodo: 'POST',
        encabezados: { Cookie: `B1SESSION=${d.SessionId}` },
      });
    } catch {
      // Que no se pueda cerrar no invalida lo que ya se comprobó.
    }
    return { ok: true, detalle: 'SAP Business One aceptó las credenciales y abrió sesión (y se cerró enseguida).', verificadoContra: endpoint };
  }),
};

// ── CONTPAQi y Aspel ───────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOS MEXICANOS: LA RESPUESTA ES QUE NO HAY API, Y ESTÁ VERIFICADA.
//
// No es "no la encontramos". Se buscó en la documentación de los dos
// fabricantes y lo que hay es esto:
//
//   · CONTPAQi publica un portal de desarrolladores real
//     (developers.contpaqinube.com), pero lo único que expone son las APIs de
//     TIMBRADO (Timbra v2 y v3). No hay API de Contabilidad ni de Comercial.
//     Su SDK es de DLLs locales (`MGWServicios`, `MGW_SDK.dll`) que exigen el
//     sistema instalado en la misma máquina que el programa que las llama.
//   · Aspel —hoy Siigo Aspel— no publica SDK ni API para COI de escritorio.
//     OJO CON EL FALSO POSITIVO: sí existe una "Siigo API" documentada y
//     pública, pero es de SIIGO NUBE, otro producto. Confundirlas es la trampa
//     obvia y costaría prometer una integración que no aplica al COI que la
//     flota tiene instalado.
//
// Que exista un SDK local NO convierte esto en integrable: instalarle software
// al servidor de la flota ya no es "capturar credenciales", es un proyecto en
// su infraestructura con su propio riesgo y su propio contrato. Por eso los dos
// van `no_construido` con su `paraSubirDeEscalon` escrito, y por eso SÍ llevan
// `fuente`: lo verificado aquí no es un endpoint, es el CAMINO REAL —el archivo
// y su layout—, que es exactamente lo que hay que saber para escribirlo.
// ═══════════════════════════════════════════════════════════════════════════

const NO_HAY_API_MEXICANA =
  'No existe una API pública a la que un tercero pueda conectarse desde fuera: lo verificamos con su propia documentación. Lo que hay es un SDK que se instala junto a tu sistema, y eso ya no es "capturar credenciales", es un proyecto en tu servidor. Por eso no se promete.';

export const CONTPAQI: Conector = {
  id: 'contpaqi',
  nombre: 'CONTPAQi',
  categoria: 'ERP y contabilidad',
  queHace: 'El layout de póliza que tu contador importa sin retecleo, con la cuenta contable, el UUID y el desglose de impuestos ya puestos.',
  // `no_construido` y no `por_archivo`, aunque el CSV genérico ya sirva: lo que
  // falta es SU layout, y decir "por archivo" haría creer que ya está el
  // formato de CONTPAQi. Coherente con `ajustes_operativos.ts`, donde
  // `contpaqi_txt` está marcado `implementado: false`, y con `integraciones.ts`.
  formaDeConectar: 'no_construido',
  comoConectaHoy: `Por ahora, el CSV genérico: lo abre Excel y CONTPAQi lo importa con trabajo de tu contador. ${NO_HAY_API_MEXICANA}`,
  // Se nombra el esquema exacto porque es la diferencia entre "algún día" y
  // "está a días de distancia": el layout no se adivina, se lee del archivo
  // Excel que define la estructura del TXT y que ya vive en la máquina del
  // contador. Pedirle el suyo es una frase, no un descubrimiento.
  paraSubirDeEscalon: 'Dos archivos de tu contador: una póliza de ejemplo exportada de TU CONTPAQi, y el esquema de carga que ya usa (los `CT_EST_Poliza_WIN_*.xls` de C:\\Compac\\Empresas\\Esquemas\\Contpaq, que son los que definen el TXT que entra). Con eso el layout se escribe en días. Un layout adivinado no falla ruidosamente: importa mal y ensucia el cierre, y eso se descubre en la declaración.',
  capacidades: ['escribir_asiento'],
  claveAlmacen: null,
  fuente: {
    url: 'https://developers.contpaqinube.com/',
    queConfirma: 'El portal de desarrolladores de CONTPAQi expone únicamente las APIs de timbrado y cancelación de CFDI (Timbra v2 y v3). No publica API de Contabilidad ni de Comercial: la integración documentada con esos productos es por SDK de DLLs locales (MGWServicios, MGW_SDK.dll), que exige el sistema instalado en la misma terminal, o por carga de pólizas con un esquema de datos (archivo TXT cuya estructura define un Excel del propio CONTPAQi).',
    consultadaEn: '2026-08-14',
  },
  credenciales: [],
  probar: async () => sinApiQueProbar(
    `No hay credencial que probar para CONTPAQi. ${NO_HAY_API_MEXICANA} El camino de hoy es el archivo.`,
  ),
};

export const ASPEL_COI: Conector = {
  id: 'aspel_coi',
  nombre: 'Aspel COI',
  categoria: 'ERP y contabilidad',
  queHace: 'La hoja de pólizas que Aspel COI importa, con las mismas cuentas y el mismo desglose que ya usa tu contador.',
  formaDeConectar: 'no_construido',
  comoConectaHoy: `Por ahora, el CSV genérico. ${NO_HAY_API_MEXICANA} Y no confundir: la "Siigo API" que sí está documentada es de Siigo Nube, no del COI que tienes instalado.`,
  paraSubirDeEscalon: 'Tu plantilla de importación de COI (las que trae el propio sistema en Plantillas\\Importacion, o la que baja el botón «Descargar plantilla de importación») y una hoja de pólizas de ejemplo. Mismo criterio que CONTPAQi: no se adivina un formato contable.',
  capacidades: ['escribir_asiento'],
  claveAlmacen: null,
  fuente: {
    url: 'https://coiportaldeclientes.aspel.com.mx/realizar-el-proceso-de-integracion-de-polizas/',
    queConfirma: 'Aspel COI importa pólizas por archivo de Excel, desde «Procesos → Integración de pólizas» y desde «Cuentas y Pólizas → Importación de movimientos», con plantillas que el propio sistema provee y un resumen de inconsistencias en TXT al terminar. El portal de clientes de Aspel no documenta ninguna API ni SDK para COI de escritorio; la «Siigo API» que sí está documentada cubre Siigo Nube, que es otro producto.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [],
  probar: async () => sinApiQueProbar(
    `No hay credencial que probar para Aspel COI. ${NO_HAY_API_MEXICANA} El camino de hoy es el archivo.`,
  ),
};

// ── Oracle ─────────────────────────────────────────────────────────────────

/**
 * LA PREGUNTA QUE HAY QUE HACER ANTES DE PROMETER NADA DE "ORACLE".
 *
 * 62 empresas del censo nombran "Oracle", y esa palabra cubre cinco productos
 * que NO comparten una sola API: Fusion Cloud ERP, E-Business Suite, NetSuite,
 * JD Edwards, y —muy común— nada más la base de datos abajo de un TMS mexicano
 * hecho a la medida. Adivinar mal no cuesta un endpoint: cuesta el adaptador
 * entero.
 *
 * No se pudo encontrar fuente primaria sobre cuál de los cinco predomina en el
 * autotransporte mexicano (solo blogs de integradores, sin metodología), así
 * que no se inventa un porcentaje. Se pregunta.
 */
export const PREGUNTA_ORACLE =
  '¿Tu Oracle es Fusion Cloud, E-Business Suite, NetSuite, JD Edwards, o es un sistema propio que corre sobre base de datos Oracle? Los cinco se conectan distinto y solo los dos primeros están en este catálogo.';

export const ORACLE_FUSION: Conector = {
  id: 'oracle_fusion',
  nombre: 'Oracle Fusion Cloud ERP',
  categoria: 'ERP y contabilidad',
  queHace: 'Deja el asiento de la liquidación y la factura de proveedor en Oracle Cloud, y lee tu catálogo de cuentas para que la póliza no se adivine.',
  formaDeConectar: 'api_en_vivo',
  comoConectaHoy: `Con la dirección de tu instancia (tu "pod"), un usuario de servicio y su contraseña. Es el único Oracle que se conecta sin proyecto de infraestructura. ${PREGUNTA_ORACLE}`,
  paraSubirDeEscalon: null,
  capacidades: ['leer_catalogo_cuentas', 'escribir_asiento', 'escribir_factura_proveedor'],
  claveAlmacen: null,
  fuente: {
    url: 'https://docs.oracle.com/en/cloud/saas/financials/26b/farfa/Quick_Start.html',
    queConfirma: 'Los recursos REST viven en https://<servidor>.fa.<región>.oraclecloud.com/fscmRestApi/resources/11.13.18.05/<recurso>. La política `oracle/multi_token_over_ssl_rest_service_policy` acepta Basic sobre SSL, SAML 2.0, JWT y OAuth 2.0. `GET <recurso>/describe` devuelve solo metadatos —cero filas— y es la forma documentada de comprobar acceso sin leer datos de nadie.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [
    {
      clave: 'base_url',
      rotulo: 'Dirección de tu Oracle Cloud',
      forma: 'url',
      requerida: true,
      // Cablear el host es imposible: cada tenant de Oracle Cloud vive en su
      // propio "pod" y la región cambia. Oracle la manda en el correo de
      // bienvenida al administrador del servicio.
      ayuda: 'Viene en el correo de bienvenida que Oracle le mandó a tu administrador. Tiene la forma https://algo.fa.us2.oraclecloud.com.',
      ejemplo: 'https://tuempresa.fa.us2.oraclecloud.com',
    },
    {
      clave: 'recurso',
      rotulo: 'Módulo contra el que probamos',
      forma: 'texto',
      requerida: false,
      // No hay un "ping" universal en Fusion: `/describe` necesita un recurso
      // que EXISTA en ese pod. `invoices` vive en Financials; un tenant que
      // solo tenga SCM no lo tiene, y su 404 se leería como credencial mala si
      // el campo no fuera configurable.
      ayuda: 'Déjalo vacío para probar contra «invoices» (Financials). Si tu instancia no tiene ese módulo, pon uno que sí, porque un módulo inexistente responde igual que una credencial mala.',
      ejemplo: 'invoices',
    },
    {
      clave: 'usuario',
      rotulo: 'Usuario de Oracle Cloud',
      forma: 'texto',
      requerida: true,
      ayuda: 'Mejor un usuario de servicio creado para Likida, con permisos solo sobre los módulos que vamos a tocar, y no el de una persona.',
    },
    {
      clave: 'password',
      rotulo: 'Contraseña de ese usuario',
      forma: 'secreto',
      requerida: true,
      ayuda: 'La de ese usuario de servicio. Oracle también admite OAuth 2.0; si tu área de sistemas lo prefiere, se conecta así y no guardamos contraseña.',
    },
  ],
  probar: (v, http) => probarConGuardas(ORACLE_FUSION, v, async () => {
    const recurso = (v.recurso ?? '').trim() || 'invoices';
    const endpoint = `${base(v.base_url)}/fscmRestApi/resources/11.13.18.05/${recurso}/describe`;
    // `/describe` y no una colección: devuelve METADATOS, cero filas. La
    // primera petición que Likida le hace al ERP de un cliente no debería
    // traerse las facturas de nadie — ni siquiera una.
    const auth = Buffer.from(`${v.usuario ?? ''}:${v.password ?? ''}`).toString('base64');
    const r = await http({
      url: endpoint,
      metodo: 'GET',
      encabezados: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/vnd.oracle.adf.resourcecollection+json',
      },
    });
    if (r.estado === 404) {
      return {
        ok: false,
        detalle: `Oracle no encontró el módulo «${recurso}» en tu instancia. Eso NO dice que la credencial sea mala: dice que ese módulo no está ahí. Prueba con otro que sí tengas.`,
        verificadoContra: endpoint,
      };
    }
    const veredicto = veredictoHttp(r, endpoint, 'Oracle Fusion');
    if (veredicto.ok && json(r.cuerpo) === null) return cuerpoIlegible(endpoint, 'Oracle Fusion');
    return veredicto;
  }),
};

export const ORACLE_EBS: Conector = {
  id: 'oracle_ebs',
  nombre: 'Oracle E-Business Suite',
  categoria: 'ERP y contabilidad',
  queHace: 'Lo mismo que Fusion —póliza y factura de proveedor— pero contra un EBS instalado en tu casa.',
  // NO es `api_en_vivo` aunque su autenticación esté documentada, y la razón no
  // es técnica sino de honestidad: en EBS no hay catálogo de endpoints. Un
  // administrador tuyo tiene que DESPLEGAR cada interfaz una por una desde el
  // Integration Repository y él decide el alias. Hasta que eso pase, no existe
  // la dirección a la que llamaríamos. Marcarlo verde prometería una conexión
  // que depende de trabajo que no es nuestro.
  formaDeConectar: 'requiere_piloto',
  comoConectaHoy: 'Por el archivo, como casi todos. Un EBS normalmente ni siquiera está expuesto a internet.',
  paraSubirDeEscalon: 'Tres cosas de tu área de sistemas, en este orden: que Integrated SOA Gateway esté habilitado, que desplieguen las interfaces que vamos a usar y nos den sus alias, y una ruta de red (VPN o proxy). Sin las tres no hay nada que llamar.',
  capacidades: ['escribir_asiento'],
  claveAlmacen: null,
  fuente: {
    url: 'https://docs.oracle.com/cd/E26401_01/doc.122/e20927/T511473T634173.htm',
    queConfirma: 'Los servicios REST de EBS se invocan en http(s)://<host>:<puerto>/webservices/rest/<alias>/<método>/, con Basic o con un token que se pide en /webservices/rest/login. El <alias> lo elige el administrador al desplegar cada interfaz desde el Integration Repository: no hay un catálogo de endpoints fijo que un tercero pueda conocer de antemano.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [],
  probar: async () => sinApiQueProbar(
    'Todavía no hay dirección que probar: en E-Business Suite cada interfaz la despliega tu administrador y él le pone el nombre. En cuanto nos den ese nombre y una ruta de red, se prueba.',
  ),
};

// ── Odoo ───────────────────────────────────────────────────────────────────

export const ODOO: Conector = {
  id: 'odoo',
  nombre: 'Odoo',
  categoria: 'ERP y contabilidad',
  queHace: 'Deja el asiento y la factura de proveedor en Odoo, y lee tu catálogo de cuentas y tus proveedores para casar el RFC de cada factura.',
  formaDeConectar: 'api_en_vivo',
  comoConectaHoy: 'Con una API key de Odoo. DOS ADVERTENCIAS antes de prometer nada: la API externa NO está disponible en los planes One App Free ni Standard de Odoo Online —solo en Custom—, y si tu Odoo es 18 o anterior el camino es el XML-RPC viejo, que Odoo va a eliminar en la versión 22.',
  paraSubirDeEscalon: null,
  capacidades: ['leer_catalogo_cuentas', 'leer_proveedores', 'escribir_asiento', 'escribir_factura_proveedor'],
  claveAlmacen: null,
  fuente: {
    url: 'https://www.odoo.com/documentation/19.0/developer/reference/external_api.html',
    queConfirma: 'La API JSON-2 de Odoo 19 se invoca con POST https://<host>/json/2/<modelo>/<método> y la credencial viaja como `Authorization: bearer <API key>`; `X-Odoo-Database` hace falta cuando un servidor hospeda varias bases. `res.users/context_get` sin ids resuelve al usuario dueño de la key. La doc también dice que el acceso a la API externa solo existe en planes Custom, que las API keys duran 3 meses como máximo, y que /xmlrpc, /xmlrpc/2 y /jsonrpc quedan eliminados en Odoo 22.',
    consultadaEn: '2026-08-14',
  },
  credenciales: [
    {
      clave: 'base_url',
      rotulo: 'Dirección de tu Odoo',
      forma: 'url',
      requerida: true,
      ayuda: 'La misma con la que entras: https://tuempresa.odoo.com, o la de tu servidor si lo tienes en casa.',
      ejemplo: 'https://tuempresa.odoo.com',
    },
    {
      clave: 'database',
      rotulo: 'Nombre de la base de datos',
      forma: 'texto',
      requerida: false,
      ayuda: 'Solo si tu servidor hospeda varias bases. En Odoo Online normalmente se deja vacío.',
    },
    {
      clave: 'api_key',
      rotulo: 'API key de Odoo',
      forma: 'secreto',
      requerida: true,
      // Se dice lo de los 3 meses AQUÍ y no en una nota al pie: es un
      // vencimiento que tira la integración sin avisar, y el cliente tiene que
      // saber desde el día uno que alguien la va a tener que rotar.
      ayuda: 'Se genera en Preferencias → Seguridad de la cuenta → Nueva API key. Ojo: Odoo no permite keys de más de 3 meses, así que hay que rotarla — la conexión se cae sola el día que venza.',
    },
  ],
  probar: (v, http) => probarConGuardas(ODOO, v, async () => {
    const endpoint = `${base(v.base_url)}/json/2/res.users/context_get`;
    const encabezados: Record<string, string> = {
      Authorization: `bearer ${v.api_key ?? ''}`,
      'Content-Type': 'application/json',
    };
    const db = (v.database ?? '').trim();
    if (db !== '') encabezados['X-Odoo-Database'] = db;
    // `context_get` no recibe ids: el usuario sale de la propia API key. Es la
    // consulta más barata que confirma "esta key es de alguien" sin leer una
    // sola fila de datos del cliente.
    const r = await http({ url: endpoint, metodo: 'POST', encabezados, cuerpo: JSON.stringify({}) });
    const veredicto = veredictoHttp(r, endpoint, 'Odoo');
    if (veredicto.ok && json(r.cuerpo) === null) return cuerpoIlegible(endpoint, 'Odoo');
    if (!veredicto.ok && (r.estado === 401 || r.estado === 403)) {
      return {
        ...veredicto,
        detalle: `${veredicto.detalle} Antes de regenerarla, revisa el plan: la API externa de Odoo no existe en One App Free ni en Standard, solo en Custom. Y recuerda que las keys caducan a los 3 meses.`,
      };
    }
    if (r.estado === 404) {
      return {
        ok: false,
        detalle: 'Tu Odoo no reconoce la API JSON-2, lo que casi siempre significa que es versión 18 o anterior. Ese camino es el XML-RPC viejo y se conecta, pero se escribe contra tu instancia — dinos qué versión tienes.',
        verificadoContra: endpoint,
      };
    }
    return veredicto;
  }),
};

/**
 * El catálogo de la oficina, en el orden que manda el censo.
 *
 * Excel primero (723 empresas), luego el TMS genérico —que es la otra cara del
 * archivo—, y después los ERP por cuántas flotas los nombran: SAP 191,
 * CONTPAQi 110, Oracle 62, Aspel 36, Odoo 22. Ordenarlos por qué tan bonita es
 * su API los pondría al revés.
 */
export const CONECTORES_ERP: readonly Conector[] = [
  ARCHIVO_CONTABLE,
  TMS_GENERICO,
  SAP_B1,
  CONTPAQI,
  ORACLE_FUSION,
  ORACLE_EBS,
  ASPEL_COI,
  ODOO,
];
