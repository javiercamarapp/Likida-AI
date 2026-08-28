// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE COMERCIOS — qué pide cada portal para emitir el CFDI.
//
// Es DATOS, no código, a propósito: son cientos de comercios y cada uno cambia
// su portal cuando se le antoja. Un comercio nuevo debe ser una entrada en esta
// lista, nunca una función nueva.
//
// De dónde salen estos datos (27-jul-2026): 60 guías paso-a-paso publicadas por
// Zumma Financial, más el HTML del portal de Office Depot leído directamente.
// Lo que se midió al cosecharlas cambió el diseño del módulo entero:
//
//   - Los portales piden sobre todo datos del RECEPTOR (RFC 29 veces, código
//     postal 22, razón social 17, régimen 17, uso de CFDI 14). Todo eso Likida
//     YA lo tiene por flota y es constante: NO se lee del ticket.
//   - Del ticket solo salen 2–4 campos: número de ticket, folio, sucursal,
//     fecha, monto, Web ID. Por eso el extractor va dirigido por comercio en
//     vez de intentar leer el ticket entero bien.
//   - Solo 7 de 60 guías mencionan un QR en el ticket. El QR es la EXCEPCIÓN;
//     el camino normal es OCR + validación contra la restricción del campo.
//   - LA MAYORÍA NO EXIGE CUENTA: 26 de los 37 comercios registrados (70%) se
//     facturan solo con los datos del ticket. Los 11 que sí la piden son casi
//     todos de PEAJE —IAVE, PASE, TeleVía, PINFRA, REA, Super Carreteras— más
//     cinco gasolineras (OXXO Gas, G500, Petromax, GORM, La Gas).
//
//     Este renglón decía "42 de 60 exigen crear cuenta" y estaba INVERTIDO:
//     42/60 es 70%, la misma proporción que 26/37, pero es la de los que NO la
//     exigen. Javier lo cazó el 4-ago-2026 por conocimiento de campo, y el
//     registro de abajo le dio la razón. Importa porque decide la arquitectura:
//     con cuenta obligatoria en el 70%, automatizar portales sería administrar
//     contraseñas de 42 sitios; sin ella, la mayoría se factura con lo que ya
//     se leyó del ticket.
//
//     El peaje además no se factura ticket por ticket: el TAG factura mensual
//     contra la cuenta. Así que entre lo que un chofer FOTOGRAFÍA, la
//     proporción sin cuenta es todavía mayor que ese 70%.
//
// TERCERA AMPLIACIÓN (27-ago-2026) — y la corrección que trajo. Las cifras de
// arriba ("37 comercios registrados", "26 de 37") describen el catálogo tal
// como estaba antes de mirar comprobantes reales; se dejan intactas porque son
// lo que se midió entonces y sobre esa medición se decidió la arquitectura.
//
// Lo que cambió: se leyeron una por una las 91 fotos de tickets REALES del
// banco de QA (`qa_foto`), y solo 17 correspondían a estos 37 comercios. Las
// otras 66 venían de 24 emisores que este registro no conocía. O sea que el
// catálogo cubría el 19% de lo que una flota de verdad fotografía — no porque
// estuviera mal hecho, sino porque se armó desde un directorio de portales y no
// desde el bolsillo de un chofer.
//
// Las 18 entradas del bloque final salen de ahí. Los otros 6 emisores nuevos NO
// están: sus tickets no imprimen liga de facturación, y `portal` se usa para
// ABRIR una página. Están anotados con su conteo en la lista de portales por
// construir, para verificarlos antes de escribirlos.
// ═══════════════════════════════════════════════════════════════════════════

import type { Plazo } from './caducidad';

/**
 * Restricción del campo EN EL PORTAL. No es cosmética: es un validador gratis y
 * determinista sobre lo que leyó la visión. Verificado en Office Depot, cuyo
 * campo de ITU es `maxlength="30"`: una lectura de 31 caracteres es
 * demostrablemente inválida sin necesidad de volver a mirar la foto.
 */
export interface RestriccionCampo {
  largoMin?: number;
  largoMax?: number;
  /** Regex como string, para que el registro siga siendo datos serializables. */
  patron?: string;
  mayusculas?: boolean;
  soloDigitos?: boolean;
}

/** Los datos que SÍ hay que sacar del ticket (el resto los pone la flota). */
export type ClaveCampo =
  | 'numeroTicket' | 'folio' | 'webId' | 'sucursal' | 'fecha'
  | 'monto' | 'caja' | 'transaccion' | 'referencia' | 'codigo'
  // `hora` entró con PINFRA: su portal la pide como campo SEPARADO de la fecha
  // en las 17 autopistas que opera, y sin ella el ticket no valida.
  | 'hora';

export interface CampoTicket {
  clave: ClaveCampo;
  /** Cómo lo llama el portal, literal. Va en el prompt del extractor. */
  etiquetaPortal: string;
  requerido: boolean;
  restriccion?: RestriccionCampo;
}

export interface Comercio {
  clave: string;
  nombre: string;
  /**
   * La página donde se factura. Cadena VACÍA únicamente cuando
   * `portalPendiente` está puesto — ver ahí por qué existe ese caso.
   */
  portal: string;
  requiereCuenta: boolean;
  /**
   * PLAZO SIN VERIFICAR POR COMERCIO. Lo documentado de forma general es:
   * gasolineras 7–15 días y "dentro del mes natural" para la mayoría. Aquí se
   * asienta el default conservador —'mes_natural'— y se marca `plazoVerificado`
   * en falso hasta comprobarlo contra el portal. Un plazo inventado por comercio
   * sería peor que ninguno: haría que el sistema jure que un ticket está vigente.
   */
  plazo: Plazo;
  plazoVerificado: boolean;
  campos: CampoTicket[];
  /**
   * El portal se conoce; sus etiquetas de campo NO se han leído todavía.
   *
   * Existe para que "no sabemos" sea un dato explícito y no un array vacío que
   * parece un descuido. Lo que se le enseña al contralor sale de `etiquetaPortal`
   * literal, así que rellenarlas de memoria pondría nombres inventados en un
   * documento que alguien va a teclear. Con esta marca el aviso dice a dónde ir
   * y se calla sobre qué pide; al leerlas en el portal, se llenan `campos` y se
   * quita la marca.
   */
  camposPendientes?: true;
  /**
   * EL EMISOR SE RECONOCE, PERO SU PÁGINA DE FACTURACIÓN NO SE HA VERIFICADO.
   * Con esta marca —y SOLO con ella— `portal` va en cadena vacía.
   *
   * Existe por lo que enseñaron las 91 fotos del banco de QA: el emisor MÁS
   * fotografiado de todos (la familia Walmart / Sam's Club / Bodega Aurrera,
   * 11 tickets con el mismo RFC) NO IMPRIME liga de facturación en el ticket.
   * Ni él ni otros tres. Eso dejaba una disyuntiva mala:
   *
   *   · inventar la URL — y `portal` se usa para ABRIR una página
   *     (`vinculacion_asistida.ts` hace `pagina.abrir(ficha.portal)`, y
   *     `mensajeParaEncargado` la manda por WhatsApp): una URL supuesta lleva
   *     al robot, o a una persona, a un sitio que nadie comprobó; o
   *   · dejar al emisor FUERA del catálogo — y entonces `identificarComercio`
   *     no lo reconoce, y once tickets al mes salen como "el portal no está en
   *     el registro todavía" sin poder siquiera decir de quién son.
   *
   * Esta marca parte la disyuntiva: el emisor entra —con su RFC y su texto, que
   * es lo que SÍ está impreso y verificado— para que el sistema pueda NOMBRARLO
   * y agruparlo, y al mismo tiempo declara que su portal es una tarea abierta.
   * `enrutar` lo trata como incompleto y lo DICE con el nombre del comercio;
   * nunca como automático ni como mensaje con una liga en blanco.
   *
   * Se quita el día que alguien vaya al portal, lo compruebe, y escriba la URL.
   */
  portalPendiente?: true;
  reconocer: {
    /** Dominio de la liga de facturación: la señal más fuerte (viene del QR). */
    dominios?: string[];
    rfc?: string[];
    /** Cadenas que aparecen impresas en el ticket, en mayúsculas. */
    texto?: string[];
  };
}

export const COMERCIOS: Comercio[] = [
  {
    clave: 'capufe',
    nombre: 'CAPUFE (casetas federales)',
    portal: 'https://facturacioncapufe.com.mx/Capufe/',
    requiereCuenta: false, // "Facturación sin registro"
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      // El portal trae botón "Validar código": un oráculo gratis para saber si
      // se leyó bien ANTES de intentar facturar.
      { clave: 'codigo', etiquetaPortal: 'código del ticket', requerido: true },
    ],
    reconocer: {
      dominios: ['facturacioncapufe.com.mx'],
      rfc: ['CPU970326PZ4'],
      texto: ['CAPUFE', 'CAMINOS Y PUENTES FEDERALES'],
    },
  },
  {
    clave: 'enerser',
    nombre: 'Enerser (gasolineras: Efigas, Palmira, Bahía Asunción…)',
    // SEGURIDAD (Auditoría 19): era http:// — la credencial de la flota
    // viajaba en claro. Verificado en vivo (26-ago-2026): el mismo host y
    // ruta responde 200 con TLS válido en el puerto estándar.
    portal: 'https://facturacion.enerser.com.mx/',
    requiereCuenta: false, // permite "continuar sin registro"
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [{ clave: 'referencia', etiquetaPortal: 'número de referencia', requerido: true }],
    reconocer: { dominios: ['facturacion.enerser.com.mx', 'enerser.com.mx'], texto: ['ENERSER'] },
  },
  {
    clave: 'gogas',
    nombre: 'Gogas',
    portal: 'https://facturasgas.com/facturacion/autofactura.php',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [{ clave: 'referencia', etiquetaPortal: 'No. de rastreo del ticket', requerido: true }],
    reconocer: { dominios: ['facturasgas.com'], texto: ['GOGAS'] },
  },
  {
    clave: 'libramientos_meta',
    nombre: 'Libramientos META / Quadrum / Valoran (San Luis Potosí)',
    portal: 'https://facturacionquadrum.com.mx/valoran/#/sinregistro',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [{ clave: 'codigo', etiquetaPortal: 'código del ticket', requerido: true }],
    // La cosecha del 29-jul confirmó que este portal cubre SEIS libramientos de
    // San Luis Potosí —Oriente, Norte, Arco Poniente y Avenida Horizontes— bajo
    // las marcas Quadrum y Valoran. Se intentó añadirlo como comercio nuevo y la
    // prueba de dominios ambiguos lo atrapó: ya estaba aquí, y esta entrada es
    // MEJOR —trae la ruta `/valoran/#/sinregistro`, sabe que no pide cuenta y
    // declara el campo—. Lo que faltaba eran los nombres impresos, que es por
    // donde se reconoce un ticket de caseta.
    reconocer: {
      dominios: ['facturacionquadrum.com.mx'],
      texto: ['LIBRAMIENTO', 'QUADRUM', 'VALORAN', 'ARCO PONIENTE', 'AVENIDA HORIZONTES'],
    },
  },
  {
    clave: 'oxxo_gas',
    nombre: 'OXXO Gas',
    portal: 'https://facturacion.oxxogas.com/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'sucursal', etiquetaPortal: 'Estación', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Monto', requerido: true },
    ],
    reconocer: { dominios: ['facturacion.oxxogas.com', 'oxxogas.com'], texto: ['OXXO GAS'] },
  },
  {
    clave: 'g500',
    nombre: 'G500',
    // ── VERIFICADO EN VIVO CONTRA EL PORTAL, 29-jul-2026 ────────────────────
    //
    // Facturando un ticket real de G500 MEGASUR (Mérida, folio 1000724). Tres
    // saltos hasta el portal de verdad, y el catálogo se quedaba en el primero:
    //
    //   g500network.com  (el de la red, lo que teníamos)
    //   g500sureste.com.mx  (lo que imprime el ticket)  → solo redirige
    //   megasur.com.mx:8029  ← AQUÍ se factura
    //
    // G500 es una red de franquicias y cada región monta su propio sistema. El
    // de la red se conserva como fallback porque no todas las estaciones son
    // del sureste; cuando aparezca un ticket de otra región, esto pide un campo
    // `portalPorRegion` en vez de una lista de dominios.
    //
    // SEGURIDAD (Auditoría 19) — investigado, NO se pudo arreglar cambiando
    // el esquema: el puerto 8029 no habla TLS (verificado en vivo, 26-ago-2026
    // — la conexión ni siquiera hace el handshake). El puerto 443 estándar del
    // mismo dominio SÍ responde HTTPS, pero sirve el sitio de WordPress de
    // Megasur (marketing), NO el sistema de facturación — apuntar ahí rompería
    // el piloto en silencio, no lo protegería. Riesgo residual aceptado: viaja
    // el RFC en claro (sin contraseña real, ver nota de abajo).
    portal: 'http://megasur.com.mx:8029/',
    // NO ES "CUENTA" EN EL SENTIDO HABITUAL. Se entra con el RFC y nada más:
    // sin contraseña. Si el RFC no está dado de alta hay un "Regístrate", pero
    // los datos fiscales quedan guardados del primer registro y en las
    // siguientes facturas solo se confirman. Para el operador en carretera esto
    // es la diferencia entre poder facturar desde el celular y no poder.
    requiereCuenta: true,
    plazo: 'mes_natural',
    // VERIFICADO POR PARTIDA DOBLE: impreso en el ticket ("TICKET FACTURABLE EN
    // EL MES DE EMISION") y en los avisos del portal ("Solo podremos facturarle
    // tickets del mes vigente").
    plazoVerificado: true,
    campos: [
      // LO QUE EL PORTAL PIDE DE VERDAD ES UNO SOLO. La ficha anterior exigía
      // folio + webId + sucursal —"el caso que rompe un extractor genérico"—, y
      // con el ticket delante el formulario tiene UN campo, "Autorización/WebID".
      // Con el WebID solo, el portal trajo estación, litros, producto, precio,
      // importe y forma de pago ya resueltos.
      //
      // Los otros dos se conservan como `requerido: false` a propósito: sirven
      // para que el operador coteje que la línea que le trajo el portal es la de
      // SU ticket —el folio aparece dentro de la descripción— y porque no está
      // verificado que el portal de la red se comporte igual.
      { clave: 'webId', etiquetaPortal: 'Autorización/WebID', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio (viene en la descripción)', requerido: false },
      { clave: 'sucursal', etiquetaPortal: 'Permiso CRE o Nombre de la Estación', requerido: false },
    ],
    // EL AVISO DE LAS 24 h NO SE CUMPLE, y conviene no repetírselo al operador.
    // El portal anuncia "facturar tickets de combustible despues de 24 hrs de
    // emitidos" y aceptó uno de DOS HORAS. Decirle a un operador que espere un
    // día por un aviso que el propio sistema no aplica es mandarlo a perder el
    // plazo. Lo que sí es real y sí hay que avisarle: el portal recomienda
    // facturar en ventanilla o en la terminal en las últimas horas del mes.
    // LOS DOMINIOS DEL SURESTE SE FUERON A `megasur`, que es la ficha
    // verificada. Tenerlos en las dos hacía ambigua la identificación —dos
    // comercios reclamando `megasur.com.mx`— y una ambigüedad aquí manda al
    // operador al portal equivocado. Esta entrada queda para la RED G500; el
    // sureste tiene la suya, más específica y comprobada.
    reconocer: { dominios: ['g500network.com', 'miappg500.g500network.com'], texto: ['G500'] },
  },
  {
    clave: 'petromax',
    nombre: 'Petromax',
    portal: 'https://facturacion.petromax.mx/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'sucursal', etiquetaPortal: 'número de estación', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio', requerido: true },
      { clave: 'webId', etiquetaPortal: 'Web ID', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'Fecha de compra', requerido: true },
    ],
    reconocer: { texto: ['PETROMAX'] },
  },
  {
    clave: 'red_estatal_autopistas',
    nombre: 'Red Estatal de Autopistas',
    portal: 'https://facturacion.rea.com.mx/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'webId', etiquetaPortal: 'WEB ID', requerido: true },
      { clave: 'folio', etiquetaPortal: 'folio', requerido: true },
      { clave: 'sucursal', etiquetaPortal: 'caseta', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'fecha', requerido: true },
    ],
    reconocer: { texto: ['RED ESTATAL DE AUTOPISTAS'] },
  },
  {
    clave: 'oxxo',
    nombre: 'OXXO (tienda)',
    portal: 'https://www4.oxxo.com:9443/facturacionElectronica-web/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'fecha', etiquetaPortal: 'Fecha del ticket', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio de venta', requerido: true },
      { clave: 'transaccion', etiquetaPortal: 'ID de venta', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Monto total con IVA', requerido: true },
    ],
    // RFC leído de un ticket real (Itzaes, Mérida, 16-jul-2026) y COMPROBADO con
    // el dígito verificador: el papel se lee "CCO-8605?3-1N4" y de los diez
    // candidatos solo este cierra. No es una transcripción, es una verificación.
    reconocer: { dominios: ['oxxo.com'], rfc: ['CCO8605231N4'], texto: ['CADENA COMERCIAL OXXO'] },
  },
  {
    clave: 'office_depot',
    nombre: 'Office Depot',
    portal: 'https://facturacion.officedepot.com.mx/',
    requiereCuenta: false,
    // VERIFICADO en el papel (ticket del 25-jul-2026, foto de campo). Impreso al
    // pie: "ESTIMADO CLIENTE, DE REQUERIR FACTURA DEBERÁ SOLICITARLA A MÁS
    // TARDAR DENTRO DEL MES SIGUIENTE A LA FECHA DE EMISIÓN DEL TICKET".
    // No es el mes natural, y la diferencia son semanas: ese ticket vence el
    // 31-AGO. Con el default habríamos avisado "te quedan 3 días" — falso, y
    // exactamente el tipo de afirmación que `plazoVerificado` existe para evitar.
    plazo: 'mes_siguiente',
    plazoVerificado: true,
    campos: [
      {
        clave: 'numeroTicket',
        etiquetaPortal: 'Número de ticket (ITU)',
        requerido: true,
        // VERIFICADO en el HTML del portal: <input formcontrolname="itu"
        // maxlength="30" uppercase>. No es una suposición.
        restriccion: { largoMax: 30, mayusculas: true },
      },
      { clave: 'sucursal', etiquetaPortal: 'Tienda', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Monto', requerido: true },
    ],
    reconocer: {
      dominios: ['facturacion.officedepot.com.mx', 'officedepot.com.mx'],
      rfc: ['ODM950324V2A'],
      texto: ['OFFICE DEPOT'],
    },
  },

  // ── Portadas de la tabla `portales` de config.ts, que era un SEGUNDO catálogo
  // en paralelo y no lo leía nadie. De aquella tabla se conserva lo verificable
  // —marca y dominio del portal— y se descarta lo que no:
  //
  //  · `campos` queda VACÍO. La tabla vieja guardaba llaves nuestras
  //    ('folio_norm', 'web_id', 'rfc'), no cómo llama el portal a cada casilla, y
  //    esas etiquetas se le enseñan a un contralor. Inventarlas es el mismo error
  //    que citar mal una ley. Se llenan cuando alguien abra el portal y las lea.
  //  · el reconocimiento es SOLO por dominio. La tabla vieja hacía `includes`
  //    sobre el texto del ticket con cadenas como 'arco', que casa con "MARCO" y
  //    con cualquier "ARCOS" impreso en la publicidad del papel.
  //  · `plazoHoras: 72` se descarta: venía sin verificar contra ningún portal, y
  //    el default honesto del módulo es el mes natural.
  {
    clave: 'pemex_franquicia',
    nombre: 'Pemex (franquicia / FACTURAGAS)',
    portal: 'https://www.cargogas.com',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['cargogas.com', 'facturagas.com', 'hidrolitro.com'] },
  },
  {
    clave: 'arco_chihuahua',
    nombre: 'ARCO (Chihuahua)',
    portal: 'https://www.petrol.com.mx',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['petrol.com.mx'] },
  },
  {
    clave: 'arco_sonora',
    nombre: 'ARCO (Sonora) / Buzón de Facturas',
    portal: 'https://www.buzonfacturas.com',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['buzonfacturas.com'] },
  },
  // ═══════════════════════════════════════════════════════════════════════
  // AMPLIACIÓN DEL 29-JUL-2026 — cosechada de tres directorios de facturación.
  //
  // TODO LO DE ABAJO ES HIPÓTESIS salvo `megasur` y `la_gas`, que se facturaron
  // de verdad. La investigación está en `docs/investigacion/`, con el nivel de
  // confianza de cada ficha. Los tres directorios tenían MAL los dos comercios
  // que sí verificamos, así que `plazoVerificado` queda en falso y los campos
  // que no se leyeron en el portal van como `camposPendientes`.
  //
  // Se modela EL PORTAL, no la marca, que es la lección de la investigación: un
  // portal cubre decenas de puntos de venta y modelar por marca multiplica
  // trabajo idéntico. PINFRA es el caso extremo: 17 autopistas, un solo sistema.
  // ═══════════════════════════════════════════════════════════════════════
  {
    clave: 'megasur',
    nombre: 'G500 Sureste / Megasur (Mérida, Campeche, Q. Roo)',
    // ✅ VERIFICADO facturando el ticket 1000724 de $839.70 el 29-jul-2026.
    // UUID resultante: B0800A68-8565-47D9-90E0-CDA7803C50E4.
    //
    // El catálogo apuntaba a `g500network.com` y NO es donde se factura: G500 es
    // red de franquicias y el sureste opera su propio sistema. Tres saltos hasta
    // el portal real, y los directorios se quedaban en el primero.
    //
    // SEGURIDAD (Auditoría 19) — mismo host que la entrada de arriba: el
    // puerto 8029 no habla TLS y el 443 del dominio es un sitio distinto
    // (marketing). Ver la nota completa en la primera aparición de este portal.
    portal: 'http://megasur.com.mx:8029/',
    // Se entra con el RFC y NADA MÁS: sin contraseña. Hay alta para un RFC
    // nuevo, pero los datos fiscales quedan guardados y después solo se
    // confirman. Para el operador en carretera eso es la diferencia entre poder
    // facturar desde el celular y no poder.
    //
    // ── PRE-VUELO DEL 20-AGO-2026: LA ENTRADA TRAE reCAPTCHA ────────────────
    // (`pruebas-manuales/ensayo/2026-08-20/megasur-prevuelo.txt`.) La raíz
    // redirige a /Account/Login: un campo #RFC, un password OCULTO y reCAPTCHA
    // de Google renderizado explícito. Para la PERSONA sigue siendo "RFC y ya"
    // —por eso `requiereCuenta` se queda en false y el aviso no la manda a
    // buscar contraseñas—, pero para la MÁQUINA el captcha es techo: el piloto
    // de visión lo declara (`requiereCaptcha`) sin gastar una llamada, el
    // ticket sale de la cola automática y el encargado recibe la liga con el
    // WebID listo. Ese captcha NO se rodea; es la regla de todo el módulo.
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: true, // impreso en el ticket Y en los avisos del portal
    campos: [
      // UN SOLO CAMPO, verificado: con el WebID el portal trajo estación,
      // litros, producto, precio, importe y forma de pago ya resueltos.
      { clave: 'webId', etiquetaPortal: 'Autorización/WebID', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio (aparece en la descripción)', requerido: false },
    ],
    reconocer: {
      dominios: ['megasur.com.mx', 'g500sureste.com.mx'],
      rfc: ['GME980817IX5'],
      texto: ['G500 MEGASUR', 'MEGASUR', 'GASOLINERA DE MERIDA'],
    },
  },
  {
    clave: 'la_gas',
    nombre: 'La Gas / Grupo GES (gasolineras del sureste)',
    // ✅ VERIFICADO facturando el ticket 1670001331723 de $714.75 el 29-jul-2026.
    // Serie-folio BOW-2025008.
    //
    // EXIGE CUENTA DE VERDAD: correo + teléfono + contraseña. Es el contraejemplo
    // de Megasur —dos gasolineras del mismo estado, dos modelos opuestos— y el
    // que marca el límite de la automatización sin custodiar credenciales.
    //
    // Y el portal viene con FORMA DE PAGO "01 Efectivo" preseleccionada. En un
    // CFDI de combustible eso es falso y además dispara el límite de efectivo de
    // LISR 27-III. Quien automatice esto tiene que corregirla a mano.
    portal: 'https://facturacion.lagas.com.mx/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: true, // "Solo se podrá facturar dentro del mes de consumo"
    campos: [
      { clave: 'folio', etiquetaPortal: '# de Referencia', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Importe Ticket', requerido: true },
    ],
    reconocer: {
      dominios: ['facturacion.lagas.com.mx', 'lagas.com.mx', 'gruges.com.mx'],
      rfc: ['AES0706049E2'],
      texto: ['LA GAS', 'ADMINISTRACION DE ESTACIONES DEL SURESTE'],
    },
  },
  {
    clave: 'pinfra',
    nombre: 'PINFRA (17+ autopistas de peaje concesionadas)',
    // EL MAYOR APALANCAMIENTO DEL CATÁLOGO. De 22 autopistas cosechadas con
    // portal identificado, 18 usan este sistema: Monterrey–Nuevo Laredo,
    // Tlaxcala–Puebla, Ecatepec–Pirámides, Armería–Manzanillo,
    // Atlixco–Jantetelco, México–La Marquesa, Peñón–Texcoco, Apizaco–Huachinango,
    // San Martín Texmelucan–Huejotzingo, Libramiento Aguascalientes…
    //
    // Un alta cubre las 17 con los MISMOS campos. Exige registro previo, pero es
    // UNA cuenta de la flota, no una por operador: encaja con sesión delegada.
    // SEGURIDAD (Auditoría 19): era http:// — esta es una cuenta CON
    // CONTRASEÑA real de la flota (`requiereCuenta: true`), viajaba en
    // claro. Verificado en vivo (26-ago-2026): TLS válido en el puerto
    // estándar, mismo host y ruta.
    portal: 'https://www.pinfrafacturacion.com.mx/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      // Los siete campos vienen de la prosa del directorio, no de leer el
      // portal. Se dejan porque son inusualmente específicos —una caseta pide
      // máquina y consecutivo, que ningún otro comercio pide— pero hay que
      // cotejarlos facturando.
      { clave: 'sucursal', etiquetaPortal: 'Caseta', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'Fecha', requerido: true },
      { clave: 'hora', etiquetaPortal: 'Hora', requerido: true },
      { clave: 'referencia', etiquetaPortal: 'Numero Id', requerido: true },
      { clave: 'caja', etiquetaPortal: 'Maquina', requerido: true },
      { clave: 'transaccion', etiquetaPortal: 'Consecutivo', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Total', requerido: true },
    ],
    reconocer: {
      dominios: ['pinfrafacturacion.com.mx', 'operadoradelasultana.com.mx'],
      texto: ['PINFRA', 'PROMOTORA Y OPERADORA DE INFRAESTRUCTURA'],
    },
  },
  {
    clave: 'controlnet',
    nombre: 'ControlNet (multi-comercio: Walmart, Alsea, OXXO, gasolineras)',
    // EL HALLAZGO SUELTO MÁS VALIOSO: plataforma multi-comercio que, según su
    // ficha, NO pide cuenta. Una integración tocaría varias cadenas grandes.
    // Sin verificar; es lo primero que hay que facturar para confirmarlo.
    portal: 'https://www.controlnet.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'numeroTicket', etiquetaPortal: 'Número de ticket', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'Fecha de compra', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Monto total', requerido: true },
    ],
    reconocer: { dominios: ['controlnet.com.mx'], texto: ['CONTROLNET'] },
  },
  {
    clave: 'gorm_brentec',
    nombre: 'GORM / Brentec (estaciones Pemex en franquicia)',
    // Pemex NO tiene portal central: 8,000+ estaciones en franquicia, cada
    // franquiciatario elige su sistema. GORM es el más extendido en grupos
    // medianos y grandes. La URL lleva el nombre de la estación:
    //   gorm.gasolinamexico.net/facturacion_[nombre]
    // así que el `portal` de aquí es la raíz y el sufijo sale del ticket.
    portal: 'https://gorm.gasolinamexico.net/',
    requiereCuenta: true, // se entra con el RFC como usuario
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'sucursal', etiquetaPortal: 'estación (va en la URL del portal)', requerido: true },
      { clave: 'numeroTicket', etiquetaPortal: 'número de facturación del ticket', requerido: true },
    ],
    reconocer: { dominios: ['gorm.gasolinamexico.net', 'gasolinamexico.net'], texto: ['GORM', 'BRENTEC'] },
  },
  {
    clave: 'facturacion_estacion',
    nombre: 'FacturacionEstacion (Pemex: El Roble, Los Pinos, La Morena…)',
    // Cada estación tiene su SUBDOMINIO: [nombre].facturacionestacion.com. La
    // URL viene impresa en el ticket, así que el reconocimiento por dominio es
    // la señal fuerte y el subdominio sale del QR.
    portal: 'https://facturacionestacion.com/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['facturacionestacion.com'], texto: ['FACTURACIONESTACION'] },
  },
  {
    clave: 'facturagas',
    nombre: 'FacturaGAS (estaciones Pemex independientes)',
    // Centraliza estaciones independientes bajo una interfaz: se elige la
    // estación de una lista y el sistema muestra las compras pendientes.
    portal: 'https://app.facturagas.net/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['facturagas.net', 'app.facturagas.net'], texto: ['FACTURAGAS'] },
  },
  {
    clave: 'shell',
    nombre: 'Shell México',
    portal: 'https://facturacion.shell.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['facturacion.shell.com.mx', 'shell.com.mx'], texto: ['SHELL'] },
  },
  {
    clave: 'bp',
    nombre: 'BP México',
    portal: 'https://www.gasolineriabp.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['gasolineriabp.com.mx'], texto: ['BP ', 'GASOLINERIA BP'] },
  },
  {
    clave: 'mobil',
    nombre: 'Mobil México',
    // OJO: según su ficha, el operador de cada estación varía y el portal
    // depende de él. El dominio de abajo es el de la marca, no necesariamente
    // el de facturación de la estación concreta.
    portal: 'https://www.mobil.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['mobil.com.mx'], texto: ['MOBIL'] },
  },
  {
    clave: 'hidrosina',
    nombre: 'Hidrosina',
    portal: 'https://facturacionelectronica.hidrosina.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['hidrosina.com.mx'], texto: ['HIDROSINA'] },
  },
  {
    clave: 'circle_k',
    nombre: 'Circle K México',
    portal: 'https://facturacion.circlekmexico.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['circlekmexico.com.mx'], texto: ['CIRCLE K'] },
  },
  {
    clave: 'petro_7',
    nombre: 'Petro-7 / Petro Seven',
    portal: 'https://www.tarjetapetro-7.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['tarjetapetro-7.com.mx', 'petro-7.com.mx'], texto: ['PETRO 7', 'PETRO-7', 'PETRO SEVEN'] },
  },
  {
    clave: 'iave',
    nombre: 'IAVE (TAG de CAPUFE)',
    // SISTEMA DE TAG, no de ticket: la factura llega CONSOLIDADA por periodo.
    // Aquí el problema no es facturar, es conciliar lo que llega contra los
    // cruces. Es el camino "aguas arriba" que a una flota le conviene.
    portal: 'https://iave.capufe.gob.mx/',
    requiereCuenta: true, // la cuenta del TAG
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'referencia', etiquetaPortal: 'Número de tag IAVE', requerido: true },
    ],
    reconocer: { dominios: ['iave.capufe.gob.mx'], texto: ['IAVE'] },
  },
  {
    clave: 'tag_pase',
    nombre: 'TAG PASE (peaje)',
    portal: 'https://www.pase.com.mx/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'referencia', etiquetaPortal: 'Número de tag TAG PASE', requerido: true },
    ],
    reconocer: { dominios: ['pase.com.mx'], texto: ['TAG PASE', 'PASE'] },
  },
  {
    clave: 'televia',
    nombre: 'TeleVía (peaje concesionado)',
    portal: 'https://www.televia.com.mx/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'referencia', etiquetaPortal: 'Número de tag TeleVía', requerido: true },
    ],
    reconocer: { dominios: ['televia.com.mx'], texto: ['TELEVIA', 'TELEVÍA'] },
  },
  {
    clave: 'circuito_exterior',
    nombre: 'Circuito Exterior Mexiquense',
    portal: 'https://www.circuitoexterior.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['circuitoexterior.mx'], texto: ['CIRCUITO EXTERIOR', 'CONMEX'] },
  },
  {
    clave: 'ado',
    nombre: 'ADO (autobuses)',
    portal: 'https://www.ado.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'folio', etiquetaPortal: 'Número de boleto o folio', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'Fecha del viaje', requerido: true },
    ],
    reconocer: { dominios: ['ado.com.mx'], texto: ['ADO', 'AUTOBUSES DE ORIENTE'] },
  },
  {
    clave: 'primera_plus',
    nombre: 'Primera Plus (autobuses)',
    portal: 'https://facturaelectronicagfa.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'folio', etiquetaPortal: 'Número de boleto o folio', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'Fecha del viaje', requerido: true },
    ],
    reconocer: { dominios: ['facturaelectronicagfa.mx'], texto: ['PRIMERA PLUS', 'FLECHA AMARILLA'] },
  },
  {
    clave: 'autozone',
    nombre: 'AutoZone México (refacciones)',
    portal: 'https://www.autozone.com.mx/factura-electronica',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'transaccion', etiquetaPortal: 'Número de folio de transacción', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'Fecha de compra', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Monto total', requerido: true },
    ],
    reconocer: { dominios: ['autozone.com.mx'], texto: ['AUTOZONE'] },
  },
  // ═══════════════════════════════════════════════════════════════════════
  // SEGUNDA AMPLIACIÓN (29-jul-2026) — los portales multi-comercio de flota que
  // salieron al cerrar la cosecha, ya sin los cinco artefactos de extracción.
  //
  // El criterio para entrar sigue siendo el mismo: **cubrir varios puntos de
  // venta con un solo sistema**. Un portal de una sola estación no paga su
  // mantenimiento; uno que cubre nueve autopistas, sí.
  //
  // Ninguno está verificado facturando, así que van con `camposPendientes` y
  // `plazoVerificado: false`. Lo que aportan hoy es mandar al operador al sitio
  // correcto en vez de dejarlo sin respuesta.
  // ═══════════════════════════════════════════════════════════════════════
  {
    clave: 'redviacorta',
    nombre: 'Red de Carreteras de Occidente (9 autopistas)',
    // El segundo sistema de peaje por cobertura, después de PINFRA: León–
    // Aguascalientes, Maravatío–Zapotlanejo, Tepic–San Blas, Zamora–Ecuándureo,
    // Zapotlanejo–Guadalajara, Zapotlanejo–Lagos de Moreno y el resto de la RCO.
    // Cubre el occidente, que es donde PINFRA no llega.
    portal: 'https://redviacorta.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['redviacorta.mx'], texto: ['RED VIA CORTA', 'RCO', 'CARRETERAS DE OCCIDENTE'] },
  },
  {
    clave: 'sevafusa',
    nombre: 'Sevafusa (24 estaciones de servicio del noroeste)',
    // Veinticuatro gasolineras bajo un portal: Bienestar I y II, Centenario I y
    // II, Country, Degollado, Grullas, ASB Tijuana, Corerepe, Dren Juárez… Es el
    // patrón de grupo gasolinero regional que ningún directorio agrupa por marca,
    // porque cada estación tiene nombre propio.
    portal: 'https://facturacion.sevafusa.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['sevafusa.mx'], texto: ['SEVAFUSA'] },
  },
  {
    clave: 'supercarreteras',
    nombre: 'Super Carreteras del Norte (Allende–Agujita, Premier)',
    // OJO CON EL DOMINIO: `ddns.net` es DNS dinámico, o sea la IP cambia y el
    // portal puede mudarse sin aviso. Se cataloga igual porque es la única forma
    // de facturar esas autopistas, pero es exactamente el caso donde el
    // reconocimiento por dominio se rompe solo — y por eso existe la tabla de
    // permisos CRE.
    //
    // SEGURIDAD (Auditoría 19) — investigado, NO se pudo verificar: el host no
    // respondió ni por HTTP ni por HTTPS al probarlo en vivo (26-ago-2026),
    // consistente con ser DNS dinámico detrás de un router de oficina que
    // puede estar apagado o haber cambiado de IP. Esta cuenta SÍ lleva
    // contraseña real (`requiereCuenta: true`) — riesgo aceptado hasta poder
    // confirmar si el portal ofrece HTTPS cuando esté disponible.
    portal: 'http://supercarreteras.ddns.net/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['supercarreteras.ddns.net'], texto: ['SUPER CARRETERAS', 'AUTOPISTA PREMIER', 'ALLENDE AGUJITA'] },
  },
  {
    clave: 'grupo_centra',
    nombre: 'Grupo Centra (Gasolinera 76, Vip Gas, Vip Market…)',
    portal: 'https://facturacion.grupocentra.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['grupocentra.mx'], texto: ['GRUPO CENTRA', 'VIP GAS', 'VIP MARKET'] },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // TERCERA AMPLIACIÓN (27-ago-2026) — LO QUE DIJERON LOS TICKETS DE VERDAD.
  //
  // De dónde salen: de mirar una por una las 91 fotos de comprobantes reales
  // que Javier tomó en campo entre marzo y agosto de 2026 (banco `qa_foto`).
  // Es la PRIMERA vez que el catálogo crece a partir de lo que un chofer
  // fotografía y no de un directorio de portales, y el resultado corrige una
  // suposición grande del módulo: de las 91 fotos, solo 17 son de los 37
  // comercios que ya estaban aquí. Las otras 66 son de 24 emisores que este
  // registro no conocía.
  //
  // EL CRITERIO DE ENTRADA, y por qué deja fuera al emisor más frecuente:
  // aquí solo entra el emisor cuyo DOMINIO DE FACTURACIÓN VIENE IMPRESO en el
  // comprobante. No es purismo — es que `portal` se usa para abrir una página
  // (`playwright_base.ts` hace `pagina.abrir(this.portal)`), y una URL supuesta
  // manda al robot, o al operador, a un sitio que nadie comprobó. Seis emisores
  // del banco NO imprimen liga y por eso no están abajo, incluida la familia
  // Walmart / Sam's Club / Bodega Aurrera, que con 11 tickets es el emisor MÁS
  // frecuente de todo el banco. Ese hueco está anotado, con su conteo, en la
  // lista de portales por construir: hay que ir a verificar la liga antes de
  // escribir la entrada, no adivinarla.
  //
  // TODAS van con `camposPendientes: true`: se leyó el TICKET, no el
  // FORMULARIO. Qué campos pide cada portal es la lectura que hacen los otros
  // dos frentes, y rellenar `etiquetaPortal` de memoria pondría nombres
  // inventados en un instructivo que alguien va a teclear.
  //
  // `plazoVerificado: true` solo donde el PROPIO TICKET imprime el plazo — que
  // resultó ser mucho más común de lo que el catálogo suponía: cuatro de estos
  // comercios lo dicen en el papel, y dos de ellos en HORAS, no en días.
  //
  // LO QUE ESTAS FOTOS ENSEÑARON, y que no estaba en ningún directorio: buena
  // parte de la facturación de la calle no la resuelve el comercio sino una
  // PLATAFORMA multi-comercio con una ruta por marca (mefacturo.mx/<marca>,
  // f.zetus.app/<marca>, facturacion.parrot.rest/<marca>/<código>). Es el mismo
  // patrón de `controlnet` y `facturacionestacion`, y es el que más rinde por
  // adaptador escrito: uno solo sirve a todos sus comercios.
  // ═══════════════════════════════════════════════════════════════════════
  {
    clave: 'lodemored',
    nombre: 'Lo de Mored (Fomento Gasolinero, Mérida)',
    // 6 tickets del banco, todos de Fomento Gasolinero suc. Santa Gertrudis.
    // Tres son el TICKET y tres el VOUCHER de la terminal encima del ticket:
    // el voucher NO es facturable por sí solo y aun así trae el mismo monto y
    // fecha, que es justo el par que confunde a un cuadre ingenuo.
    portal: 'https://www.lodemored.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    // El RFC sí se leyó limpio en tres tomas distintas del mismo emisor.
    reconocer: {
      dominios: ['lodemored.com.mx'],
      rfc: ['FGA091216EJ7'],
      texto: ['FOMENTO GASOLINERO'],
    },
  },
  {
    clave: 'home_depot',
    nombre: 'The Home Depot México',
    // 7 tickets: el comercio no-gasolinero más fotografiado del banco después
    // de la familia Walmart. El ticket manda a facturar por tres caminos
    // (módulo de servicio al cliente, el sitio, o los kioscos de la tienda).
    portal: 'https://www.homedepot.com.mx/',
    requiereCuenta: false,
    // PLAZO VERIFICADO EN EL PAPEL: "USTED TIENE 60 DIAS PARA ESTE TRAMITE",
    // impreso literal en los siete tickets. Es de los plazos más generosos que
    // ha visto este catálogo — el default conservador de 'mes_natural' lo
    // habría dado por vencido semanas antes de tiempo.
    plazo: { dias: 60 },
    plazoVerificado: true,
    campos: [],
    camposPendientes: true,
    reconocer: {
      dominios: ['homedepot.com.mx'],
      rfc: ['HDM001017AS1'],
      texto: ['HOME DEPOT'],
    },
  },
  {
    clave: 'farmacias_guadalajara',
    nombre: 'Farmacias Guadalajara / Super Farmacia',
    // 5 tickets, de tres sucursales de Mérida.
    //
    // OJO CON ESTE `portal`: el ticket ofrece la factura por QR ("Escanea el QR
    // para facturar") y NO imprime la liga de facturación en texto. El dominio
    // de abajo sí está impreso en el papel, pero en el párrafo de devoluciones
    // y en "haz tus compras en nuestra tienda en línea". O sea: es el sitio del
    // comercio, verificado en el ticket, y NO está comprobado que sea el
    // endpoint de facturación. Sirve para mandar a una persona al lugar
    // correcto; no sirve para apuntarle un robot, y por eso además va con
    // `camposPendientes`.
    portal: 'https://www.farmaciasguadalajara.com/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      dominios: ['farmaciasguadalajara.com'],
      rfc: ['FGU830930PD3'],
      texto: ['FARMACIA GUADALAJARA', 'SUPER FARMACIA'],
    },
  },
  {
    clave: 'costco',
    nombre: 'Costco de México',
    // 3 tickets (dos tomas del mismo consumo más un recorte). El de $7,881.05
    // es el gasto más alto del banco entero.
    //
    // El subdominio `www3` no es un dedazo: así viene impreso en el ticket
    // ("www3.costco.com.mx/facturacion"), y es exactamente la clase de detalle
    // que se pierde si alguien "normaliza" el dominio de memoria.
    portal: 'https://www3.costco.com.mx/facturacion',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      dominios: ['costco.com.mx', 'www3.costco.com.mx'],
      rfc: ['CME910715UB9'],
      texto: ['COSTCO'],
    },
  },
  {
    clave: 'tim_hortons',
    nombre: 'Tim Hortons México',
    portal: 'https://timhortonsmx.com/es/facturar',
    requiereCuenta: false,
    // PLAZO VERIFICADO EN EL PAPEL: "El ticket podrá facturarse hasta el último
    // día del mes". Es la primera vez que 'mes_natural' —el default que este
    // catálogo venía asumiendo sin comprobar en ningún comercio— aparece
    // CONFIRMADO por un comprobante.
    plazo: 'mes_natural',
    plazoVerificado: true,
    campos: [],
    camposPendientes: true,
    // El texto se reconoce por la MARCA, no por la razón social: "OPERADORA DE
    // CAFE PENINSULAR" es justo la cadena que ya rompió el reconocimiento de
    // ADO por subcadena (ver identificar.test.ts) y no se vuelve a meter aquí.
    reconocer: {
      dominios: ['timhortonsmx.com'],
      rfc: ['OCP250515CC7'],
      texto: ['TIM HORTONS'],
    },
  },
  {
    clave: 'paquetexpress',
    nombre: 'Paquetexpress (paquetería)',
    // 3 guías del CEDIS Tixcacal de Mérida. Primer comercio de PAQUETERÍA del
    // catálogo: para una flota, el flete de refacciones es gasto deducible tan
    // real como el diésel, y nadie lo había registrado.
    //
    // HALLAZGO PARA EL OCR, guardado en el banco: en una de las tres guías el
    // campo FACTURA viene impreso con la palabra literal "undefined" — un bug
    // del sistema del emisor. No es un campo ilegible ni ausente: está impreso
    // y es basura. Cualquier extractor que lo lea tal cual va a mandar
    // "undefined" al portal como folio.
    portal: 'https://www.paquetexpress.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      dominios: ['paquetexpress.com.mx'],
      rfc: ['PEC1411282LA'],
      texto: ['PAQUETEXPRESS'],
    },
  },
  {
    clave: 'el_globo',
    nombre: 'El Globo (Tradición en Pastelerías)',
    // 3 tickets: dos de Mérida y uno del Pedregal, CDMX. Las sucursales
    // facturan bajo razones sociales distintas —el ticket de CDMX dice
    // "Tradición en Pastelerías, S.A. de C.V."— así que el RFC de abajo es el
    // ÚNICO que se leyó limpio; el de las sucursales de Mérida salió quemado y
    // NO se completó de memoria.
    portal: 'https://www.elglobo.com.mx/',
    requiereCuenta: false,
    // El ticket no imprime plazo por comprobante, solo la leyenda de cierre de
    // ejercicio ("solicite su factura a más tardar el 31 de diciembre"), que es
    // otra cosa: un tope anual, no el plazo del ticket.
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      dominios: ['elglobo.com.mx'],
      rfc: ['TPA131111PM4'],
      texto: ['EL GLOBO', 'TRADICION EN PASTELERIAS'],
    },
  },
  {
    clave: 'conekta360',
    nombre: 'Conekta 360 (plataforma multi-comercio: ferreterías y tiendas)',
    // 3 tickets de una misma ferretería de Mérida, emitidos por una PERSONA
    // FÍSICA con actividad empresarial.
    //
    // POR QUÉ LA ENTRADA ES LA PLATAFORMA Y NO EL COMERCIO: el emisor imprime
    // su nombre y su RFC, y son datos personales de un individuo (LFPDPPP art.
    // 2 fr. VI). Este archivo vive en un repo PÚBLICO, así que ni el nombre ni
    // el RFC de la persona se copian aquí. Lo que Likida necesita para facturar
    // es el portal, y el portal es de Conekta 360, no suyo — igual que
    // `controlnet` cubre a decenas de comercios sin nombrar a ninguno.
    portal: 'https://facturacion.conekta360.mx/',
    requiereCuenta: false,
    // PLAZO VERIFICADO EN EL PAPEL: "Cuenta con un plazo máximo de 24 hrs para
    // facturar este ticket", impreso en los tres. Veinticuatro horas es el
    // plazo más corto del catálogo entero, y es exactamente el caso por el que
    // `Plazo` admite `{ horas }`: redondeado a un día daría por vigente un
    // ticket que ya no se puede facturar.
    plazo: { horas: 24 },
    plazoVerificado: true,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['conekta360.mx'], texto: ['CONEKTA 360', 'CONEKTA360'] },
  },
  {
    clave: 'fullgas',
    nombre: 'FullGas (Servicios Ecológicos de Yucatán)',
    // 2 tomas del mismo ticket de la estación Chuburna, Mérida.
    portal: 'https://www.fullgas.com.mx/',
    requiereCuenta: false,
    // El ticket menciona "24 HRS" junto a la instrucción de facturar, pero esa
    // línea quedó cortada por el reflejo del sol y no se leyó completa. Se
    // queda con el default conservador y sin verificar: un plazo a medio leer
    // haría que el sistema JURE que un ticket sigue vigente.
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    // Sin `rfc`: el del emisor no se leyó con claridad en ninguna de las dos
    // tomas y adivinar una homoclave rompe el dígito verificador de cfdi.ts.
    reconocer: { dominios: ['fullgas.com.mx'], texto: ['FULLGAS', 'FULL GAS'] },
  },
  {
    clave: 'mefacturo',
    nombre: 'MeFacturo (plataforma multi-comercio: restaurantes)',
    // 2 tomas de un ticket de taquería en Mérida. La liga impresa es
    // `mefacturo.mx/<marca>`: una ruta por comercio bajo un solo portal, el
    // patrón que más rinde por adaptador escrito.
    portal: 'https://mefacturo.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['mefacturo.mx'], texto: ['MEFACTURO'] },
  },
  {
    clave: 'mcdonalds',
    nombre: "McDonald's México",
    portal: 'https://www.facturacionmcdonalds.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      dominios: ['facturacionmcdonalds.com.mx'],
      rfc: ['RAD161031RK1'],
      texto: ['MCDONALDS', "MCDONALD'S"],
    },
  },
  {
    clave: 'lbbo',
    nombre: 'Los Bisquets Bisquets Obregón (BB del Sur)',
    portal: 'https://www.lbbo.com.mx/factura',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    // Sin `rfc`: la homoclave de BB del Sur no se distingue en ninguna de las
    // dos tomas.
    reconocer: { dominios: ['lbbo.com.mx'], texto: ['BISQUETS OBREGON', 'BB DEL SUR'] },
  },
  {
    clave: 'bptgroup',
    nombre: "BPT Group / Boston's Pizza (Grupo Bospatex)",
    portal: 'https://facturacion.bptgroup.mx/',
    requiereCuenta: false,
    // PLAZO VERIFICADO EN EL PAPEL: el ticket da 72 horas. Segundo plazo del
    // catálogo medido en horas, y el segundo caso que justifica `{ horas }`:
    // un ticket de viernes por la noche vence el lunes, no "a fin de mes".
    plazo: { horas: 72 },
    plazoVerificado: true,
    campos: [],
    camposPendientes: true,
    // Sin `rfc`: el de Grupo Bospatex se imprime con espacios intercalados y no
    // se leyó de forma inequívoca.
    reconocer: { dominios: ['bptgroup.mx'], texto: ["BOSTON'S", 'BOSTONS PIZZA', 'BOSPATEX'] },
  },
  {
    clave: 'zetus',
    nombre: 'Zetus (plataforma multi-comercio: cafeterías y restaurantes)',
    // La liga impresa es `f.zetus.app/<marca>` — mismo patrón de ruta por
    // comercio que mefacturo. Un solo ticket en el banco (una cafetería de
    // CDMX), pero la plataforma cubre muchas marcas.
    portal: 'https://f.zetus.app/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['zetus.app', 'f.zetus.app'], texto: ['ZETUS'] },
  },
  {
    clave: 'parrot',
    nombre: 'Parrot (plataforma de punto de venta para restaurantes)',
    // La liga impresa lleva el folio DENTRO de la URL:
    // `facturacion.parrot.rest/<marca>/<código de facturación>`. Es el primer
    // portal del catálogo donde el dato del ticket no se teclea en un campo
    // sino que viaja en la ruta — cuando se le escriba adaptador, el mapeo no
    // es "llenar un formulario" sino "construir la URL".
    portal: 'https://facturacion.parrot.rest/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['parrot.rest', 'facturacion.parrot.rest'], texto: ['PARROT'] },
  },
  {
    clave: 'fantasias_miguel',
    nombre: 'Fantasías Miguel',
    portal: 'https://www.fantasiasmiguel.com/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      dominios: ['fantasiasmiguel.com'],
      rfc: ['FMI650208CG9'],
      texto: ['FANTASIAS MIGUEL'],
    },
  },
  {
    clave: 'la_parisina',
    nombre: 'La Parisina (Grupo Parisina)',
    portal: 'https://www.laparisina.com.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      dominios: ['laparisina.com.mx'],
      rfc: ['GPA930101QI7'],
      texto: ['PARISINA'],
    },
  },
  {
    clave: 'dasagas',
    nombre: 'DasaGas (estaciones Pemex en franquicia)',
    // OTRO concentrador de estaciones Pemex, distinto de los tres que ya
    // conocía `pemex_franquicia` (cargogas.com, facturagas.com,
    // hidrolitro.com). Salió de un ticket de diésel de Atlixco, Puebla — el
    // único comprobante de combustible del banco fuera del sureste.
    //
    // Vale la pena por lo que significa: los concentradores de franquicias
    // Pemex no son tres, son muchos, y cada estación manda al suyo. El
    // reconocimiento por dominio es la única forma de distinguirlos, porque
    // TODOS imprimen la palabra "PEMEX".
    portal: 'https://dasagas.mx/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    // Sin `texto: ['PEMEX']` a propósito: casaría con cualquier ticket de
    // cualquier franquicia Pemex y mandaría al portal equivocado, que es
    // exactamente el modo de falla invisible que describe identificar.ts.
    reconocer: { dominios: ['dasagas.mx'], texto: ['DASAGAS'] },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LOS QUE NO IMPRIMEN LIGA — entran con `portalPendiente`
  //
  // Estos tres emisores salieron del mismo banco de 91 fotos, y los tres
  // comparten el rasgo que antes los dejaba fuera del catálogo: su ticket NO
  // IMPRIME dominio de facturación. Se quedaban en el limbo, y el limbo tenía
  // un costo medible: 13 de los 91 comprobantes —el 14% del banco, y entre
  // ellos el emisor más frecuente de todos— salían como "el portal no está en
  // el registro todavía", un mensaje que ni siquiera puede decir de quién es
  // el ticket.
  //
  // Ahora entran con lo que SÍ está impreso y verificado en el papel (RFC,
  // razón social, texto de marca) y con `portalPendiente: true`, que declara
  // la URL como tarea abierta en vez de inventarla. Ver el comentario de
  // `portalPendiente` en la interfaz para por qué esa es la mitad honesta.
  //
  // NO entra el cuarto emisor sin liga del banco: un restaurante de Mérida que
  // factura a nombre de una PERSONA FÍSICA. Su ticket dice "ESTE NO ES UN
  // COMPROBANTE FISCAL", no imprime portal ni plataforma, y su razón social ES
  // el nombre de un individuo junto a su RFC — dato personal del art. 2 fr. VI
  // de la LFPDPPP. Este archivo vive en un repo PÚBLICO. Copiarlo aquí para
  // ganar dos tickets de reconocimiento sería publicar el RFC de una persona
  // física; ahí no hay ni plataforma que nombrar en su lugar, como sí la hubo
  // con `conekta360`. Se queda fuera a propósito, y esta nota es el registro
  // de que se decidió, no de que se olvidó.
  // ═══════════════════════════════════════════════════════════════════════
  {
    clave: 'walmart',
    nombre: 'Walmart / Sam\'s Club / Bodega Aurrera (Nueva Wal-Mart de México)',
    // EL EMISOR MÁS FOTOGRAFIADO DEL BANCO: 11 de 91 tickets, más que cualquier
    // gasolinera. Las tres marcas comparten un solo RFC —NWM9709244W4— y por eso
    // van en UNA entrada y no en tres: `identificarComercio` mira el RFC, y tres
    // entradas con el mismo RFC serían tres candidatos empatados para el mismo
    // ticket, que es la forma de falla que describe identificar.ts.
    //
    // El `texto` distingue la marca para el humano que lee el aviso, pero no
    // cambia a quién se le factura: es el mismo contribuyente.
    //
    // POR QUÉ NO HAY PORTAL: ninguno de los 11 tickets imprime liga de
    // facturación. Imprimen `miopinionwmx.com` (la encuesta de satisfacción) y
    // un `bit.ly` de aviso de privacidad, y las dos son trampas — un extractor
    // ingenuo tomaría cualquiera de ellas como el portal y mandaría al operador
    // a contestar una encuesta. Por eso van en `dominios` de NADIE y el portal
    // queda declarado pendiente.
    portal: '',
    portalPendiente: true,
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      rfc: ['NWM9709244W4'],
      texto: ['NUEVA WAL MART', 'WAL-MART', 'BODEGA AURRERA', "SAM'S CLUB"],
    },
  },
  {
    clave: 'vaquero_montejo',
    nombre: 'Vaquero Montejo (Tiendas de Autoservicio Ferreteros de la Península)',
    // 3 tomas del mismo ticket de una ferretería de Mérida. El RFC
    // TAF170929C58 se lee limpio en la toma buena (IMG_9452).
    //
    // Lo que imprime en lugar de un portal es un CORREO DE HOTMAIL para pedir
    // la factura. Eso no es un portal —no hay página que abrir ni formulario
    // que llenar—, así que el camino de este comercio nunca va a ser el robot:
    // es un mensaje a una persona. `portalPendiente` lo deja dicho hasta que
    // alguien confirme si tienen portal o si el correo es el único camino.
    portal: '',
    portalPendiente: true,
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: {
      rfc: ['TAF170929C58'],
      texto: ['VAQUERO MONTEJO', 'AUTOSERVICIO FERRETEROS'],
    },
  },
  {
    clave: 'amg_hospitality',
    nombre: 'AMG Hospitality Group (restaurantes, CDMX)',
    // 2 tickets de la sucursal Polanco, el mismo día.
    //
    // CASO NOTABLE PARA EL OCR, y la razón de que valga la pena tenerlo: el
    // ticket NO IMPRIME RFC del emisor. Ni tapado ni cortado — no está. Un
    // extractor que "encuentre" un RFC aquí está alucinando, y por eso las dos
    // fichas del banco marcan `rfcEmisor` en `noAplica` y no en `ilegibles`:
    // es una de las pocas pruebas de alucinación que tiene el banco.
    //
    // Tampoco imprime dominio: manda a leer un QR y seguir instrucciones por
    // WhatsApp. Al pie identifica su punto de venta como "FoodBot v1.3.1.7.49",
    // que es software de terceros y probablemente la plataforma que factura —
    // pero eso es una hipótesis, no algo impreso, y por eso no se escribe como
    // dominio. Verificarla es justo la tarea que `portalPendiente` declara.
    portal: '',
    portalPendiente: true,
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    // Sin `rfc`: el papel no lo trae. El reconocimiento se sostiene solo en la
    // razón social impresa, que es la única señal fuerte que hay.
    reconocer: { texto: ['AMG HOSPITALITY'] },
  },
];

export function comercio(clave: string): Comercio | undefined {
  return COMERCIOS.find((c) => c.clave === clave);
}
