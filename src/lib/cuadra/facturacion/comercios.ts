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
  | 'monto' | 'caja' | 'transaccion' | 'referencia' | 'codigo';

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
    portal: 'https://g500network.com/facturacion-en-linea/',
    // G500 ES UNA RED DE FRANQUICIAS CON PORTALES REGIONALES, y el ticket lo
    // dice él mismo. Uno de G500 MEGASUR (Mérida, 29-jul-2026) imprime
    // "FACTURA FACIL EN NUESTRA PAGINA WEB WWW.G500SURESTE.COM.MX", no el
    // portal de la red. Mandar al operador al genérico es mandarlo a un sitio
    // donde su folio puede no existir.
    //
    // El portal de arriba se conserva como default porque es el de la red; los
    // regionales conocidos se reconocen abajo para que la identificación no
    // falle. Cuando haya tickets de más regiones, esto pide un campo
    // `portalPorRegion` en vez de una lista de dominios.
    requiereCuenta: true,
    plazo: 'mes_natural',
    // VERIFICADO CONTRA UN TICKET REAL (G500 MEGASUR, Mérida, 29-jul-2026):
    // "TICKET FACTURABLE EN EL MES DE EMISION", impreso en el propio
    // comprobante. Fuente primaria, no la web del comercio.
    plazoVerificado: true,
    campos: [
      // El caso que rompe un extractor genérico: DOS identificadores distintos
      // del mismo ticket, y el portal no acepta uno solo.
      { clave: 'folio', etiquetaPortal: 'Folio', requerido: true },
      { clave: 'webId', etiquetaPortal: 'Web ID', requerido: true },
      { clave: 'sucursal', etiquetaPortal: 'Permiso CRE o Nombre de la Estación', requerido: true },
    ],
    reconocer: { dominios: ['g500network.com', 'g500sureste.com.mx', 'miappg500.g500network.com'], texto: ['G500'] },
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
];

export function comercio(clave: string): Comercio | undefined {
  return COMERCIOS.find((c) => c.clave === clave);
}
