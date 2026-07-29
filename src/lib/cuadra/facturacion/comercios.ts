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
//   - 42 de 60 exigen crear cuenta en el portal.
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
    portal: 'http://facturacion.enerser.com.mx/',
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
    nombre: 'Libramientos META',
    portal: 'https://facturacionquadrum.com.mx/valoran/#/sinregistro',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [{ clave: 'codigo', etiquetaPortal: 'código del ticket', requerido: true }],
    reconocer: { dominios: ['facturacionquadrum.com.mx'], texto: ['LIBRAMIENTO'] },
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
    portal: 'http://megasur.com.mx:8029/',
    // Se entra con el RFC y NADA MÁS: sin contraseña. Hay alta para un RFC
    // nuevo, pero los datos fiscales quedan guardados y después solo se
    // confirman. Para el operador en carretera eso es la diferencia entre poder
    // facturar desde el celular y no poder.
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
    portal: 'http://www.pinfrafacturacion.com.mx/',
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
];

export function comercio(clave: string): Comercio | undefined {
  return COMERCIOS.find((c) => c.clave === clave);
}
