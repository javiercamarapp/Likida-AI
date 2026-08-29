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
//
// ═══════════════════════════════════════════════════════════════════════════
// RECONOCIMIENTO DE CAMPO (28-ago-2026) — SE VISITARON LOS 37, UNO POR UNO.
// ═══════════════════════════════════════════════════════════════════════════
//
// Chromium real vía Playwright, una visita por portal, volcado del DOM. Sin
// resolver un solo CAPTCHA, sin crear una sola cuenta, sin teclear una sola
// contraseña y SIN ENVIAR NINGÚN FORMULARIO. Donde el camino se cortó ahí, la
// ficha dice qué falta y por qué en vez de rellenarlo. Actas completas con HTML
// crudo y capturas: `RECON-PORTALES-20.md` y `RECON-PORTALES-17.md`.
//
// LO QUE MIDIÓ, Y ES INCÓMODO: **el 30% de las URLs que este archivo daba por
// buenas no llevaban a ningún portal.** Seis de veinte, en la muestra que se
// contó: tres sin registro DNS, una estacionada en GoDaddy, una que es un
// directorio de nueve operadores y una en 502. Tres se recuperaron aquí; las
// otras tres pasaron a `portalPendiente` porque no hay URL honesta que escribir.
//
// Ninguna estaba mal el día que se escribió. Se pudrieron solas, en silencio, y
// nadie se iba a enterar hasta que un ticket real fallara — que es por qué esta
// ronda además dejó un vigilante que las vuelve a comprobar sola
// (`portales_vivos.ts`), y por qué ese vigilante NO se conforma con un 200: la
// URL de OXXO devolvía 200 con el cuerpo vacío.
//
// LAS OTRAS TRES COSAS QUE CAMBIARON DE FONDO:
//
//   · **Los plazos dejaron de ser todos `'mes_natural'` sin verificar.** Este
//     archivo no tenía NI UN `plazoVerificado: true` salido de un portal. Ahora
//     hay nueve, cada uno con la cita literal de la página. Dos de ellos —ADO y
//     Primera Plus— no cabían en el tipo `Plazo` y obligaron a ampliarlo en vez
//     de forzarlos al valor más parecido (ver `mesDeCompraMas` en
//     `caducidad.ts`). El default optimista se estaba equivocando en las DOS
//     direcciones: Grupo Centra da 3 días y decíamos un mes; Circuito Exterior
//     da 30 y decíamos "vence el 31".
//
//   · **Apareció un plazo por el PRINCIPIO**, no solo por el final: un portal
//     avisa que el ticket no existe hasta 2 h después de la carga. Ver
//     `disponibleTrasHoras`.
//
//   · **Tres portales no se pueden automatizar por razones que no se arreglan
//     escribiendo código** —uno sin TLS donde viaja la contraseña, tres que
//     facturan mensual contra la cuenta y no por ticket, tres detrás de muros
//     anti-bot—. Eso ahora es un dato (`noAutomatizable`) que el motor consulta,
//     no una nota que alguien lea.
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

/**
 * POR QUÉ ESTE PORTAL NO LO PUEDE HACER LA MÁQUINA — y no es «todavía no lo
 * escribimos», que es lo que ya dicen `camposPendientes` y `portalPendiente`.
 *
 * Las tres razones de abajo tienen algo en común: **no se arreglan escribiendo
 * más código**. Un adaptador perfecto para cualquiera de ellas seguiría estando
 * mal. Por eso son un dato del catálogo y no una tarea pendiente.
 *
 * Se añadió con el reconocimiento de campo del 28-ago-2026, que visitó los 37
 * portales uno por uno y encontró los tres casos.
 */
export type RazonNoAutomatizable =
  /**
   * EL PORTAL NO OFRECE TLS Y AHÍ SE TECLEA UNA CONTRASEÑA.
   *
   * Medido, no supuesto (megasur/G500 Sureste, 27-ago-2026): el puerto 8029 no
   * habla TLS —`https://` ni siquiera hace el handshake—, su `login.js` hace
   * `POST /Account/Login` con `{RFC, Password}` en JSON sobre HTTP plano, y la
   * cookie de sesión se emite SIN `Secure`. Cualquiera en la ruta —el wifi de
   * una gasolinera, el hotspot del celular del operador— la lee.
   *
   * Automatizar eso significaría que Likida custodia la contraseña de una flota
   * para escribirla en claro por la red. Esa decisión no se toma en silencio: se
   * le dice al cliente. Hasta que el portal exponga HTTPS, va con el encargado.
   */
  | 'sin_tls'
  /**
   * NO SE FACTURA TICKET POR TICKET: EL CFDI ES MENSUAL CONTRA LA CUENTA.
   *
   * Es el modelo del TAG de peaje, y lo dicen los propios portales. TeleVía,
   * literal: «La facturación se genera de manera mensual con base en los viajes
   * realizados durante el periodo correspondiente.»
   *
   * No hay campos de ticket que capturar porque no hay un formulario de ticket.
   * Escribirle un adaptador sería automatizar algo que no existe; lo que esta
   * marca evita es que alguien lo intente y que el extractor gaste visión
   * buscando en el papel un folio que el portal nunca va a pedir. El problema
   * real de estos comercios no es facturar, es CONCILIAR lo que llega mensual
   * contra los cruces — que es otro producto.
   */
  | 'factura_mensual_por_cuenta'
  /**
   * EL SITIO BLOQUEA NAVEGADORES AUTOMATIZADOS, POR DECISIÓN SUYA.
   *
   * Radware Bot Manager con hCaptcha (PASE), Akamai 403 (Mobil), un WAF que
   * sirve 403 con `noindex` (CargoGas). Los tres detectaron y bloquearon a un
   * Chromium con UA de Chrome real haciendo UNA SOLA visita.
   *
   * Insistir con reintentos o técnicas de evasión es rodear el control de acceso
   * de un tercero —lo que este módulo no hace nunca— y se gana el bloqueo de la
   * IP y, en PASE, potencialmente el de la cuenta DEL CLIENTE.
   */
  | 'muro_anti_bot';

export interface NoAutomatizable {
  razon: RazonNoAutomatizable;
  /**
   * QUÉ SE MIDIÓ Y CUÁNDO, en una línea. Va literal en lo que lee una persona,
   * así que dice el hecho observado —no la conclusión— para que quien lo lea
   * pueda discutirlo con el dato delante.
   */
  nota: string;
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
  /**
   * ESTE PORTAL NO LO PUEDE HACER LA MÁQUINA, Y NO POR FALTA DE CÓDIGO.
   *
   * Ausente = no hay impedimento conocido. Ver `RazonNoAutomatizable` para las
   * tres razones y por qué ninguna se arregla escribiendo un adaptador.
   *
   * Lo consume `registro.ts`: un comercio con esta marca NO entra a
   * `COMERCIOS_PILOTABLES` ni emite por guion. Es una restricción, no un aviso
   * en un comentario — sin ella, el piloto de visión encendido volaría el portal
   * sin TLS con la credencial de la flota, que es precisamente lo que la marca
   * existe para impedir.
   */
  noAutomatizable?: NoAutomatizable;
  /**
   * VENTANA MUERTA AL PRINCIPIO: el ticket no existe en el portal hasta pasadas
   * estas horas desde la compra.
   *
   * El plazo se vigilaba solo por el final —cuándo VENCE— y resulta que también
   * lo tiene por el principio. Petrol/ADFSA lo dice literal en su página:
   * «Generalmente su ticket se encuentra disponible 2 horas despues de haber
   * realizado la carga.»
   *
   * Importa porque el caso normal es justo el que cae dentro: el operador
   * fotografía el ticket AL MOMENTO de cargar y lo manda por WhatsApp. Intentar
   * facturarlo entonces es un fallo garantizado que además se DISFRAZA de bug
   * del adaptador —el portal contesta «no existe ese ticket»— y manda a revisar
   * los selectores cuando lo único que había que hacer era esperar.
   *
   * Solo se pone donde el portal lo declara con sus propias palabras. El aviso
   * de 24 h de megasur NO está aquí a propósito: su ficha documenta que el
   * propio portal aceptó un ticket de DOS HORAS, así que repetirlo mandaría al
   * operador a esperar un día por una regla que el sistema no aplica.
   */
  disponibleTrasHoras?: number;
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
    // URL CORREGIDA (recon 28-ago-2026): `/Capufe/` es la pantalla de LOGIN de
    // usuarios registrados, no el formulario. La de facturar sin registro —que
    // es el modo que esta ficha dice usar, y con razón— está un nivel adentro,
    // enlazada literalmente como "Facturación sin registro" en el pie.
    //
    // HALLAZGO DE PLATAFORMA: el portal lo opera **Quadrum**
    // (`contacto@quadrum.com.mx`), el MISMO operador y la MISMA plataforma que
    // `libramientos_meta` — mismo pie de página, misma dirección, mismos
    // teléfonos. Un adaptador cubre los dos cambiando el host.
    portal: 'https://facturacioncapufe.com.mx/Capufe/facturacionrapida',
    requiereCuenta: false, // "Facturación sin registro"
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal no declara plazo
    campos: [
      // El portal trae botón "Validar Código": un oráculo gratis para saber si
      // se leyó bien ANTES de intentar facturar. VERIFICADO que existe con ese
      // texto literal. Y el placeholder añade una restricción que faltaba:
      // «Código de 18 caracteres» (el input declara `size=18`).
      {
        clave: 'codigo',
        etiquetaPortal: 'Concepto a facturar (Ticket)',
        requerido: true,
        restriccion: { largoMax: 18, largoMin: 18 },
      },
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
    // ── URL CORREGIDA (recon 28-ago-2026) ──────────────────────────────────
    // La raíz es el LOGIN, no el formulario. Y el camino sin cuenta es un
    // **botón**, no un enlace: `button` con texto «Facturar sin registro», que
    // lleva a `/invitado/facturacion-lote`. Un adaptador que buscara un
    // `<a href>` no lo encontraría nunca — por eso se guarda la URL final.
    // Flujo: 1 Datos Fiscales → 2 Referencia → 3 Previsualización → 4 Descarga,
    // y admite lote de hasta 20 tickets («0/20 TICKETS AGREGADOS»).
    portal: 'https://facturacion.enerser.com.mx/invitado/facturacion-lote',
    requiereCuenta: false, // «Facturar sin registro»; sin captcha en ningún paso
    plazo: 'mes_natural',
    // ✅ VERIFICADO — literal de la portada, bajo «IMPORTANTE»:
    // «Por disposición oficial, deberá facturar su consumo dentro del mes de la
    // expedición de su ticket, de lo contrario, éste será facturado al público
    // en general por la estación de servicio, en cumplimiento con las
    // disposiciones fiscales.»
    plazoVerificado: true,
    campos: [{ clave: 'referencia', etiquetaPortal: 'REFERENCIA', requerido: true }],
    reconocer: { dominios: ['facturacion.enerser.com.mx', 'enerser.com.mx'], texto: ['ENERSER'] },
  },
  {
    clave: 'gogas',
    nombre: 'Gogas',
    portal: 'https://facturasgas.com/facturacion/autofactura.php',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    // ✅ FICHA CORRECTA DE PUNTA A PUNTA (recon 28-ago-2026) — una de solo dos.
    // URL exacta y campo exacto. El portal hasta regala el formato en el
    // `data-content` de su botón de ayuda, literal: «No. Rastreo que desea
    // facturar, por ejemplo 1234-5678-9101-1». Y dice a dónde va el CFDI: el
    // campo Email es «la dirección de correo electrónico a la que se enviará la
    // factura» — entrega por CORREO, confirmada por el propio portal.
    campos: [{ clave: 'referencia', etiquetaPortal: 'No. Rastreo', requerido: true, restriccion: { largoMax: 1024 } }],
    reconocer: { dominios: ['facturasgas.com'], texto: ['GOGAS'] },
  },
  {
    clave: 'libramientos_meta',
    nombre: 'Libramientos META / Quadrum / Valoran (San Luis Potosí)',
    portal: 'https://facturacionquadrum.com.mx/valoran/#/sinregistro',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    // ✅ FICHA CORRECTA DE PUNTA A PUNTA (recon 28-ago-2026) — la otra de las
    // dos. URL exacta incluida la ruta `#/sinregistro`, y el encabezado del
    // portal confirma `requiereCuenta: false` con sus palabras: «Facturación de
    // tickets de peaje sin registro». Cero referencias a captcha en todo el HTML.
    //
    // MISMA PLATAFORMA Y MISMO OPERADOR QUE `capufe` (Quadrum): mismo pie de
    // página, misma dirección, mismos teléfonos. Un adaptador cubre los dos
    // cambiando el host — ver el guion compartido en `portales.ts`.
    //
    // La etiqueta del campo se queda GENÉRICA a propósito: el código vive en el
    // paso 2 del asistente y el paso 1 no avanza sin capturar los datos
    // fiscales, o sea sin enviar. Se conoce el campo equivalente de `capufe`,
    // pero eso es una INFERENCIA de plataforma, no una lectura de este portal.
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
    // URL del catálogo CORRECTA (verificada 28-ago-2026). La raíz ES el login;
    // no hay ningún camino "sin registro" en el menú.
    portal: 'https://facturacion.oxxogas.com/',
    requiereCuenta: true,
    // ⚠️ CAPTCHA QUE EL CATÁLOGO NO REGISTRABA, y es el dato que decide si este
    // portal se automatiza: **reCAPTCHA v2 de Google EN EL LOGIN**, con sitekey
    // visible `6LffM8gUAAAAAFIRetb-JWSrQFPIZ--N6ptkY1WY`. No lo es.
    //
    // Sin este dato, el piloto de visión mandaba el ticket a la cola automática
    // y descubría el muro después de gastar la llamada; con él, sale a mano
    // desde el principio. Es el mismo razonamiento que la ficha de `megasur` ya
    // aplicaba — aquí sencillamente faltaba.
    //
    // Segundo factor: NO hay. Usuario + contraseña + captcha. (Portal v1.2.5.)
    plazo: 'mes_natural',
    plazoVerificado: false, // no visible sin sesión
    campos: [
      { clave: 'sucursal', etiquetaPortal: 'Estación', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Monto', requerido: true },
    ],
    reconocer: { dominios: ['facturacion.oxxogas.com', 'oxxogas.com'], texto: ['OXXO GAS'] },
  },
  {
    clave: 'g500',
    nombre: 'G500 (red nacional de franquicias)',
    // ── EL ERROR DE COPIADO, CONFIRMADO EN VIVO EL 28-ago-2026 ─────────────
    //
    // Esta ficha apuntaba a `http://megasur.com.mx:8029/` — EL PORTAL DEL
    // SURESTE, no el de la red G500. El recon visitó `g500` y `megasur` por
    // separado, con contexto de navegador limpio cada uno, y devolvieron LA
    // MISMA PÁGINA byte por byte: mismo 302 a /Account/Login?ReturnUrl=%2F,
    // mismo título, mismos tres campos, mismos avisos. No eran "dos marcas en
    // un portal": era la MISMA entrada duplicada.
    //
    // El comentario de esta ficha YA DECÍA «esta entrada queda para la RED
    // G500; el sureste tiene la suya», y `reconocer.dominios` sí se había
    // limpiado a `g500network.com` — pero el campo `portal` nunca se cambió.
    // O sea: el diagnóstico estaba escrito y la corrección a medias, que es
    // peor que no haber empezado, porque el comentario decía que ya estaba.
    //
    // QUÉ COSTABA: cualquier ticket G500 de cualquier región que no fuera el
    // sureste mandaba al operador a Mérida, donde su WebID no existe. Y las dos
    // fichas se contradecían en `requiereCuenta` —esta `true`, `megasur`
    // `false`— PARA LA MISMA PÁGINA: el operador veía "necesitas cuenta" o "no
    // la necesitas" según cuál ganara el enrutamiento.
    //
    // NO SE CONOCE EL PORTAL DE FACTURAR DE LA RED, y no se inventa. De
    // `g500network.com` el recon SOLO comprobó que responde 200 (con `curl`;
    // `www` redirige al apex y `miappg500.g500network.com` también responde):
    // no se abrió, no se leyó su HTML y NO está verificado que sea un portal de
    // facturación — es el sitio de la red. Se pone porque es la única liga viva
    // que se conoce de G500, y mandar al operador al sitio de su propia red es
    // mucho mejor que mandarlo al portal de otra región. Hasta que aparezca un
    // ticket G500 de otra región y se siga su liga, `campos` va vacío y
    // `camposPendientes` dice el "no sabemos" en voz alta.
    portal: 'https://g500network.com/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    // BAJA DE `true` A `false`, y es una corrección, no una pérdida: el plazo
    // verificado ("tickets del mes vigente") se leyó en el portal DEL SURESTE,
    // que ya no es el de esta ficha. Sostenerlo aquí sería heredar la prueba de
    // otra página — exactamente el error que creó este bug.
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['g500network.com', 'miappg500.g500network.com'], texto: ['G500'] },
  },
  {
    clave: 'petromax',
    nombre: 'Petromax (grupo Petro Seven)',
    // ── DOMINIO SIN DNS, PORTAL RECUPERADO (recon 28-ago-2026) ─────────────
    //
    // `facturacion.petromax.mx` no resuelve, y no es solo el subdominio: el apex
    // `petromax.mx` TAMPOCO tiene registro A (los NS existen en AWS, o sea que
    // el dominio está registrado pero sin apuntar). Se probaron sin éxito
    // `www.`, `portal.`, `factura.`, `autofactura.`, `facturas.petromax.mx`,
    // `petromax.com.mx`, `www.petromax.com.mx`, `facturacion.petromax.com.mx` y
    // `facturacionpetromax.com.mx`.
    //
    // Petromax pertenece al grupo PETRO SEVEN y COMPARTE PORTAL con la ficha
    // `petro_7`: es el mismo `KPortalExterno`. Es el mismo patrón que
    // g500/megasur —dos entradas, un sistema— con la diferencia de que aquí las
    // dos apuntan ya al mismo sitio y con los mismos campos, así que no pueden
    // contradecirse. Se dejan separadas porque el ticket dice una marca u otra
    // y `reconocer` necesita las dos.
    //
    // ⚠️ EL PUERTO NO ES COSMÉTICO: el 8443 responde 200 y sirve el formulario;
    // el 443 del mismo host devuelve 502 (ver `petro_7`). Quitar `:8443` rompe.
    portal: 'https://tarjetapetro-7.com.mx:8443/KPortalExterno/',
    // Se queda en `true` a propósito. La portada ofrece una pestaña «FACTURA
    // EXPRESS» y su `#formAddTicket` está en el DOM SIN sesión con los cuatro
    // campos — pero comprobar que el express funciona de punta a punta exigía
    // ENVIAR el formulario, que el recon no hace. Bajarlo a `false` por lo que
    // se ve en el DOM sería afirmar más de lo que se midió.
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal no lo dice
    campos: [
      // LOS CUATRO ESTABAN EXACTOS — de lo poco que el recon confirmó sin
      // corregir. Ahora además con las restricciones leídas del DOM.
      {
        clave: 'sucursal',
        etiquetaPortal: 'No. Estación',
        requerido: true,
        // REGALO DE VALIDACIÓN: el input trae `pattern="\d{4}"` y
        // `maxlength="4"`. Es un validador determinista y gratis sobre lo que
        // leyó la visión — una lectura de 5 dígitos es demostrablemente mala
        // sin volver a mirar la foto.
        restriccion: { largoMax: 4, soloDigitos: true, patron: '^\\d{4}$' },
      },
      { clave: 'folio', etiquetaPortal: 'Folio', requerido: true },
      { clave: 'webId', etiquetaPortal: 'Web ID', requerido: true, restriccion: { mayusculas: true } },
      { clave: 'fecha', etiquetaPortal: 'Fecha de Ticket', requerido: true },
    ],
    // ⚠️ EL DOMINIO COMPARTIDO SE LO QUEDA `petro_7`, A PROPÓSITO.
    //
    // Las dos fichas usan la misma página, así que las dos podrían reclamar
    // `tarjetapetro-7.com.mx` — y ahí volvería a existir la ambigüedad que causó
    // el bug de g500/megasur: dos comercios reclamando un dominio, y el
    // enrutamiento decidiendo por orden de lista. La prueba de dominios ambiguos
    // lo atrapa, y con razón.
    //
    // Petromax se reconoce por el TEXTO impreso en el ticket, que es lo que de
    // verdad distingue una marca de la otra; el dominio identifica al grupo, o
    // sea a `petro_7`. Como las dos fichas ya apuntan al mismo portal con los
    // mismos campos, caer en cualquiera de las dos lleva al mismo sitio.
    reconocer: { texto: ['PETROMAX'] },
  },
  {
    clave: 'red_estatal_autopistas',
    nombre: 'Red Estatal de Autopistas de Nuevo León (REANL)',
    // ── VERIFICADO CONTRA EL PORTAL, 28-ago-2026 ───────────────────────────
    //
    // EL DOMINIO ESTABA MUERTO **Y ADEMÁS ERA AJENO**, que es la parte fea:
    // `facturacion.rea.com.mx` no tiene registro A (ni `factura.`, `portal.`,
    // `autofactura.`, `facturacion2.`), pero `rea.com.mx` SÍ resuelve — y sirve
    // una plantilla corporativa genérica de KeenThemes ("Metronic Asentus") que
    // no tiene nada que ver con la Red Estatal de Autopistas. O sea que el
    // catálogo mandaba al operador al sitio de un tercero cualquiera.
    // La operadora real es REANL y su portal lo desarrolla QRPLUS / AIDE.
    //
    // ⚠️ `requiereCuenta` ESTABA INVERTIDO — y es la corrección de más valor
    // práctico del lote, porque mueve un comercio entero de "asistido" a
    // "automatizable". La portada ofrece tres caminos y el primero dice, literal:
    //   «Factura Express — Genera tu factura al instante SIN NECESIDAD DE
    //    REGISTRO. Rápido, simple y sin historial.»
    // `Iniciar Sesión` y `Crear Cuenta` son los otros dos, y son OPCIONALES. El
    // asistente express se recorrió entero sin sesión y sin captcha.
    //
    // Stack ASP.NET WebForms + DevExpress: hay `__VIEWSTATE`/`__EVENTTARGET`, o
    // sea que un adaptador tiene que reenviar el ViewState y NO puede hacer POST
    // directo. Los `id` son largos pero ESTABLES (los genera el árbol de
    // controles del servidor, no un bundler). Prefijo común:
    //   MainPane_Content_MainContent_PageControl_Factura_exampleFormLayout_
    // Asistente: Paso 1 Registrar Ticket(s) → Paso 2 Datos Fiscales → Paso 3 Facturar.
    portal: 'https://www.qrplus.com.mx/REA_Facturacion/FormsFacturacion/FWizExprFacturacion.aspx',
    requiereCuenta: false, // «Factura Express … sin necesidad de registro»
    plazo: 'mes_natural',
    // El portal NO menciona plazo en el flujo express. Las guías de terceros
    // hablan de 30 días; no se vio en la página, no se asienta.
    plazoVerificado: false,
    campos: [
      // ⚠️ BASTA UN CAMPO, NO CUATRO. El portal lo dice con sus palabras:
      // «Si no cuenta con WebID ingrese los datos del ticket.» El WebID solo es
      // el camino principal; los otros cinco son el plan B. Tenerlos todos como
      // `requerido: true` hacía que el extractor exigiera del ticket datos que
      // el portal no necesita, y bloqueara por "faltan datos" cuando no faltan.
      { clave: 'webId', etiquetaPortal: 'Web ID', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio', requerido: false },
      { clave: 'sucursal', etiquetaPortal: 'Caseta', requerido: false },
      // El plan B pide DOS campos que el catálogo no tenía: Carril y Hora.
      // «Carril» está verificado como etiqueta, pero `ClaveCampo` no tiene
      // 'carril' y 'caja' es la más cercana (es la que PINFRA usa para
      // "Maquina"). MAPEO NUESTRO, no lectura del portal — se anota para que
      // nadie lo lea como si el portal dijera "caja".
      { clave: 'caja', etiquetaPortal: 'Carril', requerido: false },
      { clave: 'fecha', etiquetaPortal: 'Fecha', requerido: false },
      { clave: 'hora', etiquetaPortal: 'Hora', requerido: false },
    ],
    reconocer: {
      dominios: ['qrplus.com.mx', 'reanl.com.mx'],
      texto: ['RED ESTATAL DE AUTOPISTAS', 'REANL'],
    },
  },
  {
    clave: 'oxxo',
    nombre: 'OXXO (tienda)',
    // ── EL MODO DE FALLA MÁS PELIGROSO DEL CATÁLOGO (recon 28-ago-2026) ────
    //
    // `…/facturacionElectronica-web/` responde **200 OK** — y el cuerpo es JSF
    // SIN PROCESAR, literalmente:
    //   <f:view …><html><h:head></h:head><h:body>Pagina inicio</h:body></html></f:view>
    // Ni un solo campo. Un chequeo de salud por código HTTP la da por sana, y
    // por eso este caso es el que justifica que el vigilante de portales exija
    // **que siga habiendo un formulario** y no solo un 200 (ver `vigilante`).
    //
    // La real, verificada con sus 56 campos, es `/views/layout/inicio.do`.
    // (`/faces/index.xhtml` también da 200 y también está vacía; `/index.jsf`
    // da 404. `factura.oxxo.com` y `facturacion.oxxo.com` no tienen registro A.)
    portal: 'https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    // LOS CUATRO CAMPOS ESTABAN EXACTOS — se confirman y solo se les ajusta la
    // etiqueta a la literal del portal y se les añaden los `maxlength` leídos
    // del DOM, que son cuatro validadores gratis sobre lo que leyó la visión.
    // Stack JSF/PrimeFaces, `id` con prefijo `form:` y estables (los genera el
    // árbol de componentes, no un bundler).
    campos: [
      { clave: 'fecha', etiquetaPortal: 'Fecha de venta', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio de venta', requerido: true, restriccion: { largoMax: 9 } },
      { clave: 'transaccion', etiquetaPortal: 'ID de venta', requerido: true, restriccion: { largoMax: 12 } },
      { clave: 'monto', etiquetaPortal: 'Total (2 Decimales)', requerido: true, restriccion: { largoMax: 9 } },
    ],
    // RFC leído de un ticket real (Itzaes, Mérida, 16-jul-2026) y COMPROBADO con
    // el dígito verificador: el papel se lee "CCO-8605?3-1N4" y de los diez
    // candidatos solo este cierra. No es una transcripción, es una verificación.
    reconocer: { dominios: ['oxxo.com'], rfc: ['CCO8605231N4'], texto: ['CADENA COMERCIAL OXXO'] },
  },
  {
    clave: 'office_depot',
    nombre: 'Office Depot',
    // Redirige sola a `#/generaF`; se guarda la ruta final. Angular Material.
    portal: 'https://facturacion.officedepot.com.mx/#/generaF',
    requiereCuenta: false,
    // OJO CON LA FUENTE DE ESTE PLAZO: se leyó en el PAPEL DEL TICKET, no en el
    // portal — la página no declara ninguno. Se dice explícito porque la ficha
    // se leía como si se hubiera verificado en la web, y el vigilante de
    // portales no puede reconfirmarlo visitando el sitio.
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
      // ⚠️ «TIENDA» NO ERA UNA SUCURSAL, Y POR ESO SALE DE AQUÍ.
      //
      // La ficha decía `{ sucursal, etiquetaPortal: 'Tienda', requerido: true }`,
      // lo que instruía al extractor a sacar del ticket el número o el nombre de
      // la sucursal. El recon abrió el desplegable: es un
      // `mat-select[formcontrolname="typeOrder"]` con CUATRO opciones fijas —
      // `Tienda`, `Sitio Web y APP Movil`, `Telemarketing`, `Mercado Libre`.
      //
      // Es el CANAL DE COMPRA, no una sucursal, y para un ticket de papel vale
      // siempre `Tienda`. O sea: es una constante del adaptador, no un dato del
      // comprobante. Dejarlo aquí gastaba visión buscando algo que no está y
      // podía bloquear la facturación por "faltan datos" cuando no faltaba
      // ninguno. El valor a seleccionar vive en el guion de `portales.ts`.
      { clave: 'monto', etiquetaPortal: 'INGRESA EL MONTO', requerido: true },
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
    nombre: 'Pemex franquicia / Grupo CargoGas',
    // ── EL SITIO SE REDISEÑÓ (recon 29-ago-2026); EL PROBLEMA DE FONDO NO ──
    //
    // `cargogas.com/facturacion/` ya NO da 403: el WAF de SiteGround que
    // bloqueaba el recon del 28-ago-2026 desapareció junto con el sitio viejo.
    // Hoy es una página nueva (Elementor, `dateModified: 2026-05-28`) con DOS
    // botones "¡Factura aquí!":
    //
    //   · Ticket normal → sigue siendo `http://cargogas.dyndns.ws:8080/facturacion/`,
    //     EL MISMO host de DNS dinámico y puerto no estándar del recon anterior.
    //   · «Facturación para créditos y flotillas» (la sección que aplicaría a
    //     Likida) → un proveedor NUEVO, `http://factura.cargogas.warelan.com/`.
    //     Se midió su formulario real con Chrome headless (Playwright,
    //     29-ago-2026), sin escribir ni enviar nada: pide `bill[billing_code]`
    //     ("código de facturación"), `bill[client_id]` ("número de cliente",
    //     obligatorio), `bill[rfc]` y `bill[email]` — ningún password en ESTA
    //     pantalla, pero el subdominio entero es HTTP puro: el puerto 443 ni
    //     siquiera acepta conexión (`curl` a `https://factura.cargogas.warelan.com/`
    //     falla con "Failed to connect... Couldn't connect to server"). El
    //     `client_id` es el identificador de la cuenta de crédito de la
    //     flotilla — mandarlo en claro por HTTP es la misma exposición que
    //     `sin_tls` existe para bloquear, aunque no haya un campo llamado
    //     literalmente "password".
    //
    // CONCLUSIÓN: el bloqueo por `muro_anti_bot` de la ronda anterior ya no
    // describe el sitio de hoy, pero la ficha sigue sin poder automatizarse —
    // por la MISMA familia de razón (sin TLS) con evidencia fresca. Se cambia
    // `razon` a `sin_tls` para que la nota diga lo que se midió HOY, no lo que
    // ya no es cierto.
    portal: '',
    portalPendiente: true,
    requiereCuenta: false, // NO VERIFICADO: el de flotillas pide "número de cliente", no se creó cuenta
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    noAutomatizable: {
      razon: 'sin_tls',
      nota:
        'Recon 29-ago-2026 (el sitio se rediseñó desde el 28-ago-2026, el 403 de SiteGround ya no ' +
        'aplica): cargogas.com/facturacion/ ofrece dos rutas, ninguna con TLS. Ticket normal → ' +
        'http://cargogas.dyndns.ws:8080/facturacion/ (DNS dinámico, puerto no estándar, igual que ' +
        'antes). Créditos y flotillas → http://factura.cargogas.warelan.com/, medido con Chrome ' +
        'headless: formulario real (billing_code, client_id obligatorio, rfc, email) servido sobre ' +
        'HTTP puro — el puerto 443 de warelan.com no acepta conexión. El client_id de la cuenta de ' +
        'crédito de la flotilla viajaría en claro por la red; no se automatiza hasta que exponga HTTPS.',
    },
    reconocer: {
      dominios: [
        'cargogas.com', 'cargogas.dyndns.ws', 'facturagas.com', 'hidrolitro.com',
        'warelan.com', 'cargogas.warelan.com',
      ],
      texto: ['CARGOGAS', 'CARGO GAS'],
    },
  },
  {
    clave: 'arco_chihuahua',
    nombre: 'ARCO Chihuahua (Petrol / ADFSA)',
    // URL corregida: la home es corporativa y no factura; el formulario vive un
    // nivel adentro. El enlace en la home está escrito como `http://`, pero el
    // servidor entrega HTTPS — se guarda la forma `https://` para no depender
    // del redirect.
    portal: 'https://www.petrol.com.mx/facturacionpetrol/',
    requiereCuenta: false, // sin cuenta y sin captcha de ningún tipo
    plazo: 'mes_natural',
    // ✅ VERIFICADO — literal: «Solamente se podran facturar tickets del mes en
    // curso o tickets cuya vigencia se haya realizado en las ultimas 72 horas.»
    // El portal ofrece DOS ventanas y se asienta la más restrictiva de las dos:
    // el mes en curso. La de 72 h es una extensión, no un recorte, así que
    // 'mes_natural' nunca promete de más.
    plazoVerificado: true,
    // ⚠️ LA VENTANA MUERTA AL PRINCIPIO. Literal del portal: «Generalmente su
    // ticket se encuentra disponible 2 horas despues de haber realizado la
    // carga.» Es el primer comercio del catálogo que declara un plazo por el
    // COMIENZO, y es el caso normal el que cae dentro: el operador fotografía
    // el ticket al momento de cargar. Ver `disponibleTrasHoras` en el tipo.
    disponibleTrasHoras: 2,
    campos: [
      // Form `#form1`; ningún input declara `maxlength`, así que no se inventa
      // ninguna restricción. Se capturan uno o varios tickets → "Agregar" →
      // modal de cliente → modal fiscal → "Generar Factura".
      { clave: 'sucursal', etiquetaPortal: 'Sucursal', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Nota Ó Despacho', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Monto Total', requerido: true },
    ],
    reconocer: {
      dominios: ['petrol.com.mx', 'facturacionadfsa.com'],
      texto: ['PETROL', 'ADFSA', 'ALMACENES DISTRIBUIDORES DE LA FRONTERA'],
    },
  },
  {
    clave: 'arco_sonora',
    nombre: 'ARCO Sonora / BuzonFacturas (Octane Systems)',
    // URL corregida: la home ya trae el menú de facturación y no exige login,
    // pero el formulario está un nivel adentro. `?avanzada=0` factura UNA nota;
    // `?avanzada=1` permite varias en un solo CFDI — útil para un lote de flota.
    portal: 'https://www.buzonfacturas.com/GenerarCFDI/Index?avanzada=0',
    requiereCuenta: false, // sin cuenta y sin captcha
    plazo: 'mes_natural',
    plazoVerificado: false, // no declarado en las páginas leídas
    campos: [],
    // Del paso 1 se leyó el receptor (`#RFC`), pero LOS CAMPOS DEL TICKET viven
    // en un paso posterior al que solo se llega ENVIANDO el formulario — y el
    // recon no envía formularios. Se sabe que existen (el menú dice "Facture su
    // nota de venta"); no se sabe cómo se llaman, así que no se escriben.
    // Pista para quien lo retome: el propio portal publica su manual en
    // `/Images/Manual%20Buzon%20Facturas.pdf`.
    camposPendientes: true,
    reconocer: {
      dominios: ['buzonfacturas.com'],
      texto: ['BUZON FACTURAS', 'BUZONFACTURAS', 'OCTANE SYSTEMS'],
    },
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
    // SEGURIDAD — el puerto 8029 no habla TLS y el 443 del dominio es un sitio
    // distinto (marketing de WordPress), así que cambiar el esquema no arregla
    // nada: apuntar al 443 rompería el piloto en silencio en vez de protegerlo.
    // La medición completa está en `noAutomatizable`, abajo.
    portal: 'http://megasur.com.mx:8029/',
    // ── POR QUÉ ESTE PORTAL NO LO TOCA LA MÁQUINA ──────────────────────────
    //
    // El recon del 27-ago-2026 midió las tres cosas, no las supuso:
    //
    //   1. `https://megasur.com.mx:8029/` NO CONECTA (código 000): el puerto no
    //      hace ni el handshake. Solo hay `http://`.
    //   2. `http://megasur.com.mx:8029/Content/wJS/login.js?v=26.3.24` contiene
    //      `LogIn()`, que arma `JSON.stringify({RFC, Password, TokenReCaptcha})`
    //      y lo manda por `POST /Account/Login` — la CONTRASEÑA en claro.
    //   3. La cookie se emite `ASP.NET_SessionId=…; path=/; HttpOnly;
    //      SameSite=Lax` — SIN `Secure`, sobre HTTP plano. La sesión es
    //      interceptable tal cual.
    //
    // Y la ficha decía «se entra con el RFC y NADA MÁS: sin contraseña». Es más
    // de lo que la página sostiene: hay un `#login_pass` de tipo password, un
    // modal `#modal_password` y un endpoint `/Account/SignInUser` que manda
    // `validPass`. La contraseña existe en el flujo.
    //
    // Custodiar la credencial de una flota para escribirla en claro por la red
    // no es una decisión que se tome en silencio. Hasta que el portal exponga
    // HTTPS, el ticket va con el encargado y el cliente se entera del porqué.
    noAutomatizable: {
      razon: 'sin_tls',
      nota:
        'Medido el 27-ago-2026: el puerto 8029 no negocia TLS (https no conecta), ' +
        'login.js manda {RFC, Password} en JSON por HTTP plano a /Account/Login, ' +
        'y la cookie de sesión se emite sin Secure.',
    },
    // Se entra con el RFC y NADA MÁS: sin contraseña. Hay alta para un RFC
    // nuevo, pero los datos fiscales quedan guardados y después solo se
    // confirman. Para el operador en carretera eso es la diferencia entre poder
    // facturar desde el celular y no poder.
    //
    // ── EL CAPTCHA ES UNA BANDERA DEL SERVIDOR, NO UN HECHO FIJO ───────────
    //
    // El pre-vuelo del 20-ago-2026 asentó «la entrada trae reCAPTCHA … para la
    // MÁQUINA el captcha es techo». El recon del 27-ago encontró la página
    // sirviendo, literal:
    //
    //     <script> const enableCaptcha = 'False'; const publicKey = ''; </script>
    //
    // y en `login.js`, `onloadCallback` solo renderiza el widget
    // `if (enableCaptcha === "True")`. O sea: el script sigue cargado pero el
    // widget NO se dibuja, porque el propio portal lo tiene apagado y sin
    // sitekey.
    //
    // LA CONCLUSIÓN CORRECTA NO ES «YA NO HAY CAPTCHA». Es una bandera que el
    // servidor puede volver a poner en `'True'` cuando quiera, sin avisar.
    // Cablear cualquiera de las dos respuestas es apostar: cablear "sí hay"
    // renuncia a automatizar de gratis cuando está apagado, y cablear "no hay"
    // hace que el adaptador choque contra un widget el día que lo reenciendan.
    // Lo que corresponde es LEER LA BANDERA EN VIVO y declarar `requiereCaptcha`
    // según lo que se encuentre — un techo fijo convertido en condición medible.
    //
    // Hoy da igual para el enrutamiento porque `noAutomatizable: sin_tls` saca
    // a este portal de la cola automática por una razón anterior y más grave.
    // Se deja escrito para el día que el portal exponga HTTPS y esta ficha
    // vuelva a estar en juego.
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
    // RECONFIRMADO el 28-ago-2026: `#email`, `#phone` (maxlength 10) y
    // `#password`, los tres exactos como decía esta ficha. Sin segundo factor,
    // aunque el teléfono actúa como tercer dato de identidad. (Portal v1.0.4.)
    //
    // ⚠️ CAPTCHA NUEVO que esta ficha no registraba: el `<head>` del login carga
    // **Cloudflare Turnstile** (`challenges.cloudflare.com/turnstile/v0/api.js`).
    // No se observó el widget renderizado en la carga inicial, así que se declara
    // la PRESENCIA DEL SCRIPT y no el comportamiento — la misma disciplina que
    // obligó a leer `enableCaptcha` en vivo en megasur. Es el segundo motivo,
    // después de la contraseña, para no automatizar este portal.
    //
    // Y el portal viene con FORMA DE PAGO "01 Efectivo" preseleccionada. En un
    // CFDI de combustible eso es falso y además dispara el límite de efectivo de
    // LISR 27-III. Quien automatice esto tiene que corregirla a mano.
    // ⚠️ SE QUEDA LA RAÍZ, AUNQUE REDIRIJA A `/auth/login`. Se intentó guardar
    // el destino («la URL final, para no depender del redirect») y rompió la
    // vinculación asistida: `pantallaDeLogin` decide si la persona YA ENTRÓ
    // comparando la URL contra `RUTAS_DE_LOGIN`, así que con `/auth/login` en la
    // ficha el sistema creía que seguía en la pantalla de entrar PARA SIEMPRE, y
    // la vinculación expiraba sin guardar la sesión de alguien que sí había
    // entrado.
    //
    // LA REGLA QUE SALE DE AHÍ, y vale para todo el catálogo: `portal` es la
    // página donde se quiere TERMINAR, no la puerta. En un portal con cuenta,
    // apuntar al login convierte la señal de "ya entré" en una condición que
    // nunca se cumple.
    portal: 'https://facturacion.lagas.com.mx/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    // ✅ CONFIRMADO — el VALOR era correcto, la CITA no era textual. La ficha
    // decía «Solo se podrá facturar dentro del mes de consumo»; lo que el bloque
    // «AVISO IMPORTANTE» del login dice hoy, palabra por palabra, es:
    //   «Solo se pueden facturar tickets del mes en curso.»
    // Mismo sentido, así que `'mes_natural'` y `plazoVerificado` se quedan — se
    // actualiza la cita para que el día que alguien la compare contra la página
    // la encuentre igual y no crea que el portal cambió.
    plazoVerificado: true,
    campos: [
      // ⚠️ NO SE PUDIERON RECONFIRMAR el 28-ago-2026: están detrás de la sesión y
      // no se inició ninguna. Se conservan como los dejó la verificación del
      // 29-jul, que sí facturó de verdad — que es la mejor prueba que existe de
      // estos dos campos, pero es de hace un mes.
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
    //
    // RECONFIRMADO 28-ago-2026: la URL es correcta y la cuenta es LIGERA — el
    // login pide RFC (`#rfc`, maxlength 50) + correo (`#correo`, maxlength 50) y
    // NO contraseña; sin captcha. `/Registro` devuelve 200 con cuerpo vacío, o
    // sea que el alta es un modal JS: NO VERIFICADO qué pide.
    //
    // Texto literal del portal, útil para el mensaje al humano cuando el portal
    // falle — son los cuatro caminos que PINFRA reconoce, en su orden:
    //   «Solicitarlo personalmente en la plaza de cobro · Solicitarlo en la
    //    siguiente página web: www.pinfrafacturacion.com.mx · Solicitarlo al
    //    siguiente correo: facturacion@pinfra.com.mx · Número de contacto,
    //    (55)90882953»
    portal: 'https://www.pinfrafacturacion.com.mx/',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false, // no declarado
    campos: [
      // Los siete campos vienen de la prosa del directorio, no de leer el
      // portal. Se dejan porque son inusualmente específicos —una caseta pide
      // máquina y consecutivo, que ningún otro comercio pide— pero hay que
      // cotejarlos facturando. El recon del 28-ago tampoco pudo: están detrás de
      // la sesión, y en particular NO se pudo confirmar que el portal pida la
      // HORA aparte de la fecha, que es el motivo por el que `ClaveCampo` tiene
      // 'hora'. Sigue siendo la afirmación menos respaldada de esta ficha.
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
    // EL HALLAZGO SUELTO MÁS VALIOSO: plataforma multi-comercio que NO pide
    // cuenta. VERIFICADO contra el portal el 28-ago-2026, y confirmado que es
    // el más automatizable del catálogo: sin cuenta, sin captcha, UN campo, y un
    // botón "Consultar" que hace de oráculo antes de facturar.
    //
    // URL CORREGIDA: la raíz `https://www.controlnet.com.mx/` REDIRIGE (302) a
    // `controlnet.mx`, el sitio corporativo (venta de sistemas para
    // gasolineras), sin un solo campo. El portal está en `/Factura`, y el
    // formulario aparece detrás del botón `#btnFacturarTicket`
    // («Factura tu Ticket(s)»); el otro botón es `#btnConsultaTuTicket`.
    // Asistente: Ticket → Ticket(s) → Datos Cliente → Vista Previa → Factura.
    portal: 'https://www.controlnet.com.mx/Factura',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal no lo dice
    campos: [
      // ⚠️ TRES CAMPOS INVENTADOS DONDE EL PORTAL PIDE UNO.
      //
      // La ficha exigía `Número de ticket` + `Fecha de compra` + `Monto total`.
      // El formulario real tiene UN input, etiquetado `IDTran`,
      // `maxlength="24"`, placeholder `0000.0000.0000.0000.0000`. Ni fecha ni
      // monto. Un extractor entrenado con la ficha vieja gastaba visión en dos
      // datos que nadie pide, y podía bloquear por "faltan datos" cuando no
      // faltaba ninguno.
      //
      // La restricción es DERIVABLE y verificada: 20 dígitos en 5 grupos de 4
      // separados por puntos = 24 caracteres, que es exactamente el `maxlength`
      // que declara el input. El portal da su propio ejemplo:
      // `4321.6431.8567.9341.8031`.
      {
        clave: 'numeroTicket',
        etiquetaPortal: 'IDTran',
        requerido: true,
        restriccion: { largoMax: 24, largoMin: 24, patron: '^\\d{4}(\\.\\d{4}){4}$' },
      },
    ],
    reconocer: { dominios: ['controlnet.com.mx', 'controlnet.mx'], texto: ['CONTROLNET'] },
  },
  {
    clave: 'gorm_brentec',
    nombre: 'GORM / Brentec (estaciones Pemex en franquicia)',
    // Pemex NO tiene portal central: 8,000+ estaciones en franquicia, cada
    // franquiciatario elige su sistema. GORM es el más extendido en grupos
    // medianos y grandes. La URL lleva el nombre de la estación:
    //   gorm.gasolinamexico.net/facturacion_[nombre]
    // así que el `portal` de aquí es la raíz y el sufijo sale del ticket.
    //
    // ✅ LA MECÁNICA DEL SUFIJO, CONFIRMADA (recon 28-ago-2026): la raíz sirve
    // una página VACÍA (665 bytes, título `CVMX`, cero campos) y `/facturacion`
    // da 404, pero `…/facturacion_caballero/` y `…/facturacion_gomez/` devuelven
    // 200 con ~179 KB de formulario. Esta ficha lo tenía bien.
    //
    // ⚠️ Y EL SUFIJO NO ES COSMÉTICO, es la clave de enrutamiento. Aviso literal
    // de la instancia leída: «SI USTED NO CARGO EN LA GASOLINERA DE TLALPAN
    // COLONIA CENTINELA, NO PODRÁ FACTURAR EN ÉSTE PORTAL!!» Cada instancia
    // sirve UNA estación: mandar el ticket a la equivocada garantiza el fallo.
    portal: 'https://gorm.gasolinamexico.net/',
    // CONFIRMADO: se entra con el RFC como usuario y **sin contraseña visible**
    // —no hay campo `password` en el DOM—. Login `#txt1USer` + `#btnIniciaSesion2`,
    // ASP.NET WebForms, `Version 1.2.0.45`, «Copyright © Brentec». Sin captcha.
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false, // no visible sin sesión
    campos: [
      { clave: 'sucursal', etiquetaPortal: 'estación (va en la URL del portal)', requerido: true },
      { clave: 'numeroTicket', etiquetaPortal: 'número de facturación del ticket', requerido: true },
    ],
    // NO lleva `camposPendientes`: los dos campos de arriba SÍ están declarados
    // (vienen de la cosecha de guías). Lo que no se pudo es RECONFIRMARLOS —
    // están detrás del RFC y no se inició sesión—, y eso lo dice este comentario,
    // no una marca que significa otra cosa ("no sabemos ni cómo se llaman").
    // ⚠️ FALTABAN DOS HOSTS: la misma plataforma vive también en
    // `cvmx.gasolinamexico.mx` (verificada, 200) y `cvmx.brentec.mx` (existe,
    // pero hoy no conecta: timeout en 443). Sin ellos, un ticket que imprima esa
    // URL no se reconocía y salía como emisor desconocido.
    reconocer: {
      dominios: [
        'gorm.gasolinamexico.net', 'gasolinamexico.net',
        'cvmx.gasolinamexico.mx', 'gasolinamexico.mx', 'cvmx.brentec.mx', 'brentec.mx',
      ],
      texto: ['GORM', 'BRENTEC', 'CVMX'],
    },
  },
  {
    clave: 'facturacion_estacion',
    nombre: 'FacturacionEstacion (Pemex: El Roble, Los Pinos, La Morena…)',
    // ── EL APEX ESTÁ ESTACIONADO EN GODADDY (recon 28-ago-2026) ────────────
    //
    // `https://facturacionestacion.com/` responde 200 y redirige a `/lander`:
    // es una página de APARCAMIENTO de GoDaddy, literal — «facturacionestacion.com
    // está estacionado en forma gratuita por cortesía de GoDaddy.com», con un
    // botón "Obtén este dominio". No hay portal, no hay formulario, no hay nada.
    // Y como responde 200, un chequeo de salud por código HTTP la daría por sana.
    //
    // LA PLATAFORMA SÍ EXISTE Y FUNCIONA — se comprobó
    // `https://sevafusa.facturacionestacion.com/`, que es un portal de
    // autofacturación real y completo (ver la ficha `sevafusa`). Lo que está
    // muerto es únicamente el apex.
    //
    // POR ESO ESTA FICHA YA NO TIENE URL: la entrada correcta no es una URL,
    // es un PATRÓN — `https://<comercio>.facturacionestacion.com/` —, y `portal`
    // se usa para ABRIR una página. Guardar el apex mandaba al operador (y al
    // robot) a una página de venta de dominios. `portalPendiente` deja la ficha
    // viva para NOMBRAR al emisor —que es lo que sí está verificado— y declara
    // que falta resolver el subdominio desde el QR del ticket.
    //
    // Los `id` del formulario (`#txtReferencia`, `#txtFolio`, `#txtAmount`,
    // `#txtRFC`, `#btnNext`) son de la PLATAFORMA, no de la estación: un solo
    // adaptador sirve para todos los comercios que la usen cambiando el host.
    portal: '',
    portalPendiente: true,
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    reconocer: { dominios: ['facturacionestacion.com'], texto: ['FACTURACIONESTACION'] },
  },
  {
    clave: 'facturagas',
    nombre: 'FacturaGAS® / ControlGAS (estaciones Pemex independientes)',
    // ── LA PIEDRA ROSETTA DE LA PLATAFORMA ControlGAS® ─────────────────────
    //
    // URL CORREGIDA: la raíz `app.facturagas.net/` es un LOGIN **con CAPTCHA de
    // imagen** (`#loginCaptcha_CaptchaTextBox`, maxlength=5). Pero hay una
    // segunda puerta, enlazada desde la home como "FACTURACIÓN SIN USUARIO", y
    // esa NO tiene captcha: `generar_factura.aspx`, titulada literalmente
    // «Facturar sin Usuario». Es la que se guarda.
    //
    // POR QUÉ ESTA FICHA VALE POR TRES: el pie declara «Powered by ControlGAS®
    // | Versión 2.0.4.5», y `shell` y `bp` corren EXACTAMENTE el mismo software
    // — mismos `id` de formulario (`#formLogin`, `#mailUser`, `#pwdUser`,
    // `#form_nw_account`, `#a_name`, `#a_phoneNumber`…). FacturaGAS es el único
    // de los tres que deja mirar sin cuenta, así que este formulario es la mejor
    // pista disponible de cómo se ven Shell y BP por dentro, y un solo adaptador
    // parametrizado cubre a los tres.
    portal: 'https://app.facturagas.net/generar_factura.aspx',
    requiereCuenta: false, // por la vía "sin usuario"; el login sí pide captcha
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal NO declara plazo
    campos: [
      { clave: 'sucursal', etiquetaPortal: 'Estación', requerido: true },
      // Los dos `maxlength` son validadores gratis y deterministas: una lectura
      // de 11 caracteres en el folio, o de 9 en el WebID, es demostrablemente
      // inválida sin volver a mirar la foto.
      { clave: 'folio', etiquetaPortal: 'Folio', requerido: true, restriccion: { largoMax: 10 } },
      { clave: 'webId', etiquetaPortal: 'WebID', requerido: true, restriccion: { largoMax: 8 } },
    ],
    // Aviso literal del portal, útil para el mensaje al humano: «Revise que los
    // datos de su ticket correspondan con los ingresados: (Estación/Folio/WebId).»
    reconocer: {
      dominios: ['facturagas.net', 'app.facturagas.net'],
      texto: ['FACTURAGAS', 'CONTROLGAS', 'WEB ID', 'WEBID'],
    },
  },
  {
    clave: 'shell',
    nombre: 'Shell México (ControlGAS®)',
    portal: 'https://facturacion.shell.com.mx/',
    // ⚠️ `requiereCuenta` ESTABA MAL: era `false` y la cuenta es OBLIGATORIA.
    // El recon probó por GET la ruta que en la plataforma hermana (FacturaGAS)
    // es la de "sin usuario" —`/generar_factura.aspx`— y devolvió «Ocurrió un
    // error — Disculpa las molestias». No hay camino sin registro visible.
    // Login: `#formLogin` con `#mailUser` + `#pwdUser`, sin captcha.
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false, // no declarado en la pantalla pública
    campos: [],
    // Los campos del ticket están detrás de la sesión y NO se creó cuenta ni se
    // tecleó contraseña. Lo que se sabe de la plataforma está en `facturagas`,
    // que es el mismo software y sí deja mirar — pero eso es una INFERENCIA, no
    // una lectura de este portal, y por eso aquí no se escribe ningún campo.
    camposPendientes: true,
    reconocer: { dominios: ['facturacion.shell.com.mx', 'shell.com.mx'], texto: ['SHELL'] },
  },
  {
    clave: 'bp',
    nombre: 'BP México / BPme Web (ControlGAS®)',
    // URL CORREGIDA: `www.gasolineriabp.com.mx` REDIRIGE quitando el `www` y
    // añadiendo la ruta de la app. Se guarda la URL final para no depender del
    // redirect.
    portal: 'https://gasolineriabp.com.mx/facturagasbpme/',
    // ⚠️ `requiereCuenta` ESTABA MAL, igual que en Shell. Y aquí el probe fue
    // más concluyente: `…/facturagasbpme/generar_factura.aspx` devuelve un 404
    // limpio de ASP.NET — la ruta "sin usuario" de la plataforma hermana
    // sencillamente NO EXISTE en esta instalación.
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false, // no declarado en la pantalla pública
    campos: [],
    // Detrás de cuenta **y** de un CAPTCHA de imagen PROPIO en el login
    // (`#loginCaptcha_CaptchaTextBox`, maxlength=5, con `#btnRefreshImage`).
    // No se resolvió ni se rodeó: es modo asistido por definición.
    camposPendientes: true,
    reconocer: { dominios: ['gasolineriabp.com.mx'], texto: ['BP ', 'BPME', 'BP ME', 'GASOLINERIA BP'] },
  },
  {
    clave: 'mobil',
    nombre: 'Mobil México (marca, NO portal: 9 operadores)',
    // ── NO ES UN PORTAL, ES UN DIRECTORIO DE NUEVE (recon 28-ago-2026) ─────
    //
    // La ficha ya sospechaba que «el operador de cada estación varía». El recon
    // lo confirmó y lo hizo peor de lo que se creía:
    //
    //   1. `www.mobil.com.mx` devuelve **403 "Access Denied" de Akamai** al
    //      navegador automatizado, en la raíz y en `/es-mx/gasolina/facturacion`.
    //   2. Leído por otra vía, `/es-mx/gasolina/facturacion` **no tiene
    //      formulario de autofacturación**: instruye a identificar el logo del
    //      operador impreso en el ticket y hacer clic para ser redirigido, y
    //      lista NUEVE portales distintos — ORSAN, Combured, Red Gasolin,
    //      TopGas, Policon, GasIslo, Mobil Golfo, Cañada Real y PETROMAX.
    //
    // O sea que el catálogo prometía un portal que no existe. Un ticket de
    // Mobil no se puede facturar sin saber ANTES cuál de los nueve operadores
    // lo emitió, y eso se decide por el logo/RFC del papel.
    //
    // `portalPendiente` en vez de una URL inventada o de borrar la ficha: el
    // emisor se sigue RECONOCIENDO —que es lo que permite nombrarlo y agruparlo
    // en vez de sacarlo como "emisor desconocido"— y queda declarado que hace
    // falta partirlo en nueve, o resolver el operador antes de poder facturar.
    // Ninguno de los nueve se visitó, así que ninguno se escribe.
    portal: '',
    portalPendiente: true,
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    noAutomatizable: {
      razon: 'muro_anti_bot',
      nota:
        'Recon 28-ago-2026: mobil.com.mx devuelve 403 de Akamai a un navegador automatizado en ' +
        'una sola visita. Y el contenido real no es un portal: es un directorio de 9 operadores ' +
        '(ORSAN, Combured, Red Gasolin, TopGas, Policon, GasIslo, Mobil Golfo, Cañada Real, PETROMAX), ' +
        'cada uno con su propio portal, elegible solo por el logo impreso en el ticket.',
    },
    reconocer: { dominios: ['mobil.com.mx'], texto: ['MOBIL'] },
  },
  {
    clave: 'hidrosina',
    nombre: 'Hidrosina',
    // URL corregida: la raíz redirige a `/facturaciontranseunte/` («transeúnte»
    // = sin cuenta). Se guarda el destino.
    portal: 'https://facturacionelectronica.hidrosina.com.mx/facturaciontranseunte/',
    requiereCuenta: false, // pide RFC, no usuario/contraseña
    plazo: 'mes_natural',
    plazoVerificado: false, // no declarado en la pantalla pública
    campos: [],
    // ⚠️ TRES CAPAS DE CAPTCHA antes del formulario, que es el récord del
    // catálogo: **Cloudflare Turnstile** en el interstitial de entrada (la
    // primera visita cayó en «Un momento…»), un **CAPTCHA aritmético propio** en
    // la pantalla (`#captchaInput`, con enunciados tipo «1 + 7 =» que cambian en
    // cada carga) y **reCAPTCHA v3** cargado en la página.
    //
    // Ninguno se resolvió ni se rodeó, así que los campos del ticket quedan sin
    // leer. Es modo asistido por definición y no va a dejar de serlo escribiendo
    // código.
    camposPendientes: true,
    reconocer: {
      dominios: ['facturacionelectronica.hidrosina.com.mx', 'hidrosina.com.mx'],
      texto: ['HIDROSINA'],
    },
  },
  {
    clave: 'circle_k',
    nombre: 'Circle K México',
    // ── DOMINIO MUERTO, PORTAL RECUPERADO (recon 28-ago-2026) ──────────────
    // `facturacion.circlekmexico.com.mx` da ERR_NAME_NOT_RESOLVED, y no es solo
    // el subdominio: `dig` no devuelve ni A ni CNAME tampoco para el apex
    // `circlekmexico.com.mx`. El dominio ya no existe.
    // El portal vivo, enlazado desde `circlek.com.mx/facturacion/`, es este —
    // y es NUEVO: su pie dice `v1.0.0 · 2026-04-17`.
    portal: 'https://facturacion.portalcck.com/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal no declara plazo
    campos: [
      // Leídos de la pantalla «Consulta tu ticket» (SPA React; el formulario no
      // existe en el HTML inicial, aparece al entrar a "Generar Factura").
      { clave: 'sucursal', etiquetaPortal: 'NO. DE TIENDA', requerido: true, restriccion: { largoMax: 10 } },
      { clave: 'folio', etiquetaPortal: 'FOLIO / NÚMERO DE TICKET', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'FECHA DE COMPRA', requerido: true },
    ],
    reconocer: {
      dominios: ['facturacion.portalcck.com', 'portalcck.com', 'circlek.com.mx', 'circlekmexico.com.mx'],
      texto: ['CIRCLE K', 'CIRCULO K', 'CCK'],
    },
  },
  {
    clave: 'petro_7',
    nombre: 'Petro-7 / Petro Seven',
    // ── EL 502 ERA DEL PUERTO EQUIVOCADO (recon 28-ago-2026) ───────────────
    //
    // `https://www.tarjetapetro-7.com.mx/` redirige a `/KPortalExterno/` y
    // devuelve **502 Bad Gateway** — tres intentos, dos momentos distintos. El
    // DNS resuelve a través de Radware Cloud, así que el CDN está vivo y el
    // origen no responde. Desde fuera no se podía distinguir "caída pasajera"
    // de "portal retirado", y esta ficha iba camino de declararse muerta.
    //
    // La respondió el OTRO lote: al buscar el portal de `petromax` —misma
    // empresa, grupo Petro Seven— apareció **el mismo `KPortalExterno` vivo en
    // el puerto 8443**, con 200, título `Facturación Petro Seven` y el
    // formulario legible. O sea que el portal nunca murió: lo que está caído es
    // el 443. Los dos lotes por separado no lo habrían visto.
    //
    // Los cuatro campos son los que se leyeron ahí; ver `petromax`, que es
    // literalmente la misma página.
    portal: 'https://tarjetapetro-7.com.mx:8443/KPortalExterno/',
    requiereCuenta: true, // mismo portal que `petromax`; ver su nota sobre FACTURA EXPRESS
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal no lo dice
    campos: [
      { clave: 'sucursal', etiquetaPortal: 'No. Estación', requerido: true, restriccion: { largoMax: 4, soloDigitos: true, patron: '^\\d{4}$' } },
      { clave: 'folio', etiquetaPortal: 'Folio', requerido: true },
      { clave: 'webId', etiquetaPortal: 'Web ID', requerido: true, restriccion: { mayusculas: true } },
      { clave: 'fecha', etiquetaPortal: 'Fecha de Ticket', requerido: true },
    ],
    reconocer: { dominios: ['tarjetapetro-7.com.mx', 'petro-7.com.mx'], texto: ['PETRO 7', 'PETRO-7', 'PETRO SEVEN'] },
  },
  {
    clave: 'iave',
    nombre: 'IAVE (TAG de CAPUFE)',
    // SISTEMA DE TAG, no de ticket: la factura llega CONSOLIDADA por periodo.
    // Aquí el problema no es facturar, es conciliar lo que llega contra los
    // cruces. Es el camino "aguas arriba" que a una flota le conviene.
    //
    // URL corregida (recon 28-ago-2026): `iave.capufe.gob.mx` es el portal
    // INFORMATIVO de gob.mx y no tiene formulario — los 13 "inputs" que
    // aparecen son los checkboxes del widget de accesibilidad. El acceso a la
    // cuenta está en `/PortalIAVE/` (login `#usuario` maxlength=20 = número de
    // cuenta o de dispositivo, más `#password`).
    portal: 'https://iave.capufe.gob.mx/PortalIAVE/',
    requiereCuenta: true, // la cuenta del TAG
    plazo: 'mes_natural',
    plazoVerificado: false,
    // `campos` VACÍO A PROPÓSITO, y esto es un cambio de fondo. Antes decía
    // `{ referencia: 'Número de tag IAVE' }`, que no es un campo de TICKET: es
    // el identificador del dispositivo, y el portal no lo pide para emitir nada
    // — factura mensual contra la cuenta. Dejarlo ahí instruía al extractor a
    // buscar en el papel un dato que no sirve para facturar.
    campos: [],
    camposPendientes: true,
    noAutomatizable: {
      razon: 'factura_mensual_por_cuenta',
      nota:
        'Recon 28-ago-2026: IAVE es telepeaje con TAG — el CFDI se emite consolidado ' +
        'por periodo contra la cuenta, no por ticket. No hay formulario de ticket que llenar.',
    },
    reconocer: { dominios: ['iave.capufe.gob.mx'], texto: ['IAVE'] },
  },
  {
    clave: 'tag_pase',
    nombre: 'TAG PASE (peaje)',
    // URL corregida (recon 28-ago-2026): la raíz `www.pase.com.mx` REDIRIGE al
    // muro de bots de Radware (`validate.perfdrive.com`, hCaptcha). La página de
    // facturación sí carga por URL directa, y es informativa: su único `<form>`
    // es el buscador del sitio. Se apunta ahí porque es lo que una PERSONA
    // necesita abrir; la máquina no va a entrar (ver `noAutomatizable`).
    portal: 'https://www.pase.com.mx/facturacion/facturacion-pase/',
    requiereCuenta: true, // literal: «únicamente deberás registrarte y capturar tus datos»
    plazo: 'mes_natural',
    // ✅ VERIFICADO — el portal cita la disposición fiscal completa, literal:
    // «Podrás solicitar el comprobante fiscal de tus cruces pagados dentro del
    // mes en el que se efectuaron dichos cruces. Por disposiciones fiscales a
    // partir de diciembre 2021, deberás solicitar las facturas del ejercicio del
    // mes en curso, a más tardar el último día del mismo, ya que no podrán ser
    // emitidos los comprobantes fiscales de cruces pagados si se solicitan en un
    // ejercicio fiscal posterior.»
    plazoVerificado: true,
    // Vacío por lo mismo que IAVE: «Número de tag» no es un campo de ticket.
    campos: [],
    camposPendientes: true,
    // DOS RAZONES INDEPENDIENTES, cada una suficiente. Se asienta la de producto
    // —no hay ticket que facturar— y la operativa va en la nota porque cambia el
    // riesgo: aquí no solo "no funcionaría", es que insistir tiene consecuencias.
    noAutomatizable: {
      razon: 'factura_mensual_por_cuenta',
      nota:
        'Recon 28-ago-2026: PASE es telepeaje con TAG — el CFDI se emite por los cruces del ' +
        'periodo contra la cuenta, no por ticket. Además la raíz redirige al muro de bots de ' +
        'Radware con hCaptcha: golpearlo con reintentos arriesga bloquear la IP y la cuenta DEL CLIENTE. ' +
        'La página separa dos flujos que el catálogo trata como uno: «Facturación PASE» (TAG) y «Facturación TPV».',
    },
    reconocer: { dominios: ['pase.com.mx'], texto: ['TAG PASE', 'PASE'] },
  },
  {
    clave: 'televia',
    nombre: 'TeleVía (peaje concesionado)',
    // URL corregida (recon 28-ago-2026): la página de facturación es
    // informativa y el login real vive en OTRO host — el form `#contacto` hace
    // POST a `https://www.televiaweb.mx/Logon/cuenta` (`#userName` maxlength=10
    // = número de cuenta, `#password` maxlength=10, reCAPTCHA v2 en la home).
    portal: 'https://www.televia.com.mx/tag-televia/facturacion',
    requiereCuenta: true,
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal no declara plazo más allá de la periodicidad
    // Vacío por lo mismo que IAVE y PASE: «Número de tag» no es dato de ticket.
    campos: [],
    camposPendientes: true,
    // ESTA ES LA CITA QUE CIERRA EL CASO DE LOS TRES TAG, y confirma con
    // palabras del portal lo que el encabezado de este archivo ya sospechaba
    // sobre el peaje. Literal:
    //   «Puedes facturar los cruces realizados con tu TAG TeleVía. La
    //    facturación se genera de manera MENSUAL con base en los viajes
    //    realizados durante el periodo correspondiente.»
    noAutomatizable: {
      razon: 'factura_mensual_por_cuenta',
      nota:
        'Literal del portal (recon 28-ago-2026): «La facturación se genera de manera mensual ' +
        'con base en los viajes realizados durante el periodo correspondiente.» No hay campos ' +
        'de ticket que capturar. Además: cuenta obligatoria + reCAPTCHA v2.',
    },
    reconocer: { dominios: ['televia.com.mx', 'televiaweb.mx'], texto: ['TELEVIA', 'TELEVÍA'] },
  },
  {
    clave: 'circuito_exterior',
    nombre: 'Circuito Exterior Mexiquense (CONMEX / Aleatica)',
    // URL corregida: `www.circuitoexterior.mx` es la home y su
    // `/facturacion-en-linea/` NO tiene formulario — solo enlaza. El portal
    // ("Ir al nuevo portal de facturación") es este.
    portal: 'https://portalfacturacion.circuitoexterior.mx/PortalWEBCONMEX/',
    // Anuncia «Facturación sin registro» junto a «¿Eres usuario nuevo?», pero el
    // `href` de ese enlace se dispara por JS y no se pudo extraer sin
    // interactuar: NO VERIFICADO dónde vive esa ruta. Se queda en `true`, que es
    // lo que la pantalla observada sostiene (login `#usuario` maxlength=30 +
    // `#password`). Bajarlo por un texto de mercadotecnia sería afirmar de más.
    requiereCuenta: true,
    // ✅ VERIFICADO — el plazo más largo y más explícito del lote. Literal:
    //   «Estimado usuario: Recuerda que cuentas con 30 días a partir de la fecha
    //    de emisión de tu ticket de peaje para realizar tu factura.»
    //
    // El default `'mes_natural'` era PESIMISTA aquí: un ticket del 28 habría
    // salido como "vence en 3 días" cuando de verdad tiene 30. Ese error cuesta
    // en la dirección contraria al de Grupo Centra — no pierde la factura, hace
    // correr a la oficina para nada y le quita prioridad a lo que sí urge.
    plazo: { dias: 30 },
    plazoVerificado: true,
    campos: [],
    camposPendientes: true, // los campos del ticket están detrás del login
    reconocer: {
      dominios: ['portalfacturacion.circuitoexterior.mx', 'circuitoexterior.mx'],
      texto: ['CIRCUITO EXTERIOR MEXIQUENSE', 'CIRCUITO EXTERIOR', 'CONMEX', 'ALEATICA'],
    },
  },
  {
    clave: 'ado',
    nombre: 'ADO (autobuses)',
    // ── EL PORTAL DEL CATÁLOGO NO ERA UN PORTAL DE FACTURACIÓN ─────────────
    // `www.ado.com.mx` es LA TIENDA DE BOLETOS: sus campos son Origen, Destino
    // y Fecha y hora de ida — un buscador de viajes. El de facturar es este,
    // enlazado como "Factura electrónica" desde el pie de ado.com.mx.
    portal: 'https://factura.grupoado.com.mx/FETFS/',
    requiereCuenta: false,
    // ✅ VERIFICADO, y es el caso que obligó a ampliar el tipo `Plazo`. Literal,
    // dos veces en la página:
    //   «La vigencia para facturar tus boletos es durante el mes que los
    //    compraste y como máximo 07 días del siguiente mes para obtener tu
    //    factura electrónica en el portal. Una vez concluido el plazo ya no
    //    será posible obtenerla.»
    //
    // Ni `'mes_natural'` (perdería 7 días buenos) ni `'mes_siguiente'` (daría
    // por vigente un ticket hasta 23 días después de muerto) lo expresan. Ver
    // el comentario de `mesDeCompraMas` en `caducidad.ts`.
    plazo: { mesDeCompraMas: { dias: 7 } },
    plazoVerificado: true,
    campos: [
      { clave: 'folio', etiquetaPortal: 'NÚM. FOLIO', requerido: true },
      // ⚠️ EL CATÁLOGO PEDÍA EL DATO EQUIVOCADO. Decía `Fecha del viaje`, y ese
      // campo NO EXISTE en el portal. Lo que pide —y es obligatorio— es el
      // NÚMERO DE ASIENTO, que no estaba. Un extractor entrenado con la ficha
      // vieja habría sacado del boleto la fecha y no el asiento: el dato bueno
      // ni se buscaba.
      { clave: 'transaccion', etiquetaPortal: 'NÚM. ASIENTO', requerido: true, restriccion: { soloDigitos: true } },
    ],
    // CAPTCHA PROPIO, de imagen, servido por el mismo host
    // (`/FETFS/svt/captcha/mobility`) y EN EL MISMO PASO que los datos del
    // boleto: se resuelve o no se factura. Eso pone a ADO en modo asistido por
    // definición — no se resuelve ni se rodea. El RFC (maxlength 13) también va
    // en ese paso. Aviso literal del portal, que conviene repetirle al humano:
    // «Verifica que tus datos sean correctos una vez emitida la factura no se
    // puede cancelar.»
    reconocer: {
      dominios: ['factura.grupoado.com.mx', 'grupoado.com.mx', 'ado.com.mx'],
      texto: ['ADO', 'AUTOBUSES DE ORIENTE'],
    },
  },
  {
    clave: 'primera_plus',
    nombre: 'Primera Plus / Grupo Flecha Amarilla (autobuses)',
    // ── FALTABA EL `www`, Y NO ES COSMÉTICO ────────────────────────────────
    // `https://facturaelectronicagfa.mx/` (sin `www`) NO CONECTA: el apex
    // resuelve a 138.91.152.211 (Azure) y ni el 80 ni el 443 aceptan conexión
    // (timeout por las dos vías, dos intentos). Con `www` responde 200 por
    // CloudFront. La ruta de facturar es `#/emision/servicio`.
    portal: 'https://www.facturaelectronicagfa.mx/#/emision/servicio',
    requiereCuenta: false,
    // ✅ VERIFICADO — el segundo caso que obligó a ampliar `Plazo`. Literal:
    //   «La factura se puede generar durante todo el mes de compra, hasta
    //    72 hrs. posterior al cierre de mes de compra. Si tu compra se realiza
    //    el último día del mes, solo tendrás hasta el día 3 del mes siguiente
    //    para solicitar tu factura.»
    //
    // Esa segunda frase es un regalo: el portal publica su propio caso de borde
    // ya resuelto, así que la implementación tiene un oráculo externo contra el
    // que probarse (compra del 31 → límite el día 3). Está en la prueba de
    // `caducidad.test.ts`.
    plazo: { mesDeCompraMas: { horas: 72 } },
    plazoVerificado: true,
    campos: [],
    // ⚠️ LOS CAMPOS SE BORRAN, no se corrigen: NO SE PUDIERON LEER. El portal
    // carga pero su API devuelve **503 en bucle**, el desplegable «Selecciona la
    // opción que deseas facturar» nunca se llena y el asistente no monta los
    // campos del boleto. Dos rutas probadas, una visita cada una; no se martilleó.
    //
    // Lo que había (`folio` + `fecha del viaje`) es de un directorio, no del
    // portal, y el propio aviso del sitio lo contradice: habla de un **TOKEN
    // alfanumérico sensible a mayúsculas** («Respetar mayúsculas y minúsculas ·
    // Evite espacios antes y después del token · Puede contener letras y
    // números»), que no es un folio ni una fecha. Dejar los dos campos viejos
    // habría mandado al extractor a buscar datos que casi seguro no son.
    camposPendientes: true,
    reconocer: {
      dominios: ['facturaelectronicagfa.mx', 'www.facturaelectronicagfa.mx'],
      texto: ['PRIMERA PLUS', 'FLECHA AMARILLA', 'GRUPO FLECHA AMARILLA'],
    },
  },
  {
    clave: 'autozone',
    nombre: 'AutoZone México (refacciones)',
    // ── 403 ANTI-BOT, TRES VECES, TRES CONFIGURACIONES (recon 28-ago-2026) ──
    //
    // Responde **403 Forbidden** a: Chromium headless con UA de Chrome 140; el
    // mismo más `Accept-Language: es-MX`, `Upgrade-Insecure-Requests` y
    // `navigator.webdriver` neutralizado; y `WebFetch`. Las tres. Es bloqueo del
    // borde y no una caída — la respuesta llega rápida y con título propio.
    //
    // Se DESCARTÓ deliberadamente insistir con técnicas de evasión: es
    // exactamente el control de acceso de un tercero que la regla de este módulo
    // prohíbe rodear. Un adaptador headless choca contra el mismo 403.
    //
    // ⚠️ LOS TRES CAMPOS DE ABAJO NO ESTÁN VERIFICADOS NI DESMENTIDOS: no hubo
    // forma de ver la página. Se conservan tal como estaban —vienen de la
    // cosecha de guías— y este comentario es lo que dice que nadie los ha leído
    // en el portal. No llevan `camposPendientes` porque esa marca significa una
    // cosa distinta y más fuerte: "no sabemos ni cómo se llaman". Aquí sí hay
    // tres nombres propuestos; lo que falta es confirmarlos, y no se va a poder
    // mientras el borde devuelva 403.
    portal: 'https://www.autozone.com.mx/factura-electronica',
    requiereCuenta: false, // NO VERIFICADO
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [
      { clave: 'transaccion', etiquetaPortal: 'Número de folio de transacción', requerido: true },
      { clave: 'fecha', etiquetaPortal: 'Fecha de compra', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Monto total', requerido: true },
    ],
    noAutomatizable: {
      razon: 'muro_anti_bot',
      nota:
        'Recon 28-ago-2026: 403 Forbidden en tres intentos con tres configuraciones distintas ' +
        '(Chromium headless con UA real; el mismo con Accept-Language es-MX y navigator.webdriver ' +
        'neutralizado; WebFetch). Bloqueo del borde, no caída. No se insistió con evasión.',
    },
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
    // URL corregida: `/es/facturacion` es el AVISO; el formulario está en
    // `/es/factura`.
    portal: 'https://redviacorta.mx/es/factura',
    requiereCuenta: false, // sin cuenta y sin captcha
    // ✅ VERIFICADO — literal: «Los tickets de peaje o consumo de Red de
    // Carreteras de Occidente tienen vigencia dentro del año fiscal al cruce o
    // compra.» Es el plazo más largo del catálogo, y `'mes_natural'` lo estaba
    // recortando a semanas.
    //
    // Se codifica `{ dias: 365 }` y no una variante "año fiscal": el tipo no la
    // tiene, y a diferencia de los dos casos de ADO/Primera Plus —donde forzar
    // habría hecho jurar vigente un ticket muerto— aquí 365 días desde la compra
    // se queda CORTO respecto del año fiscal en el peor caso (un ticket de enero
    // vencería el enero siguiente, no el 31-dic). Errar hacia el lado que avisa
    // antes es el error que no cuesta una factura.
    plazo: { dias: 365 },
    plazoVerificado: true,
    campos: [
      { clave: 'folio', etiquetaPortal: 'No. de ticket (UUID)', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Total', requerido: true },
    ],
    // ⚠️ TRAMPA PARA EL ADAPTADOR: es Liferay y el `action` del form incluye un
    // token de sesión `p_auth=…` distinto en cada visita. NO se puede hacer POST
    // directo con una URL guardada: hay que cargar la página y enviar desde ella.
    // Los sufijos `_fukp`/`_hhsb` de los botones parecen generados por Liferay;
    // conviene ir por `#Agregar` y por el texto "Generar Factura".
    //
    // DATO DE CAMPO: la propia página manda el peaje pagado con TAG a PASE
    // («Si tu pago fue realizado con telepeaje, factura aquí»). O sea: efectivo
    // se factura en RCO, TAG en PASE — que es la ficha `tag_pase`, mensual.
    reconocer: {
      dominios: ['redviacorta.mx'],
      texto: ['RED VIA CORTA', 'RCO', 'RED DE CARRETERAS DE OCCIDENTE', 'CARRETERAS DE OCCIDENTE'],
    },
  },
  {
    clave: 'sevafusa',
    nombre: 'Sevafusa (24 estaciones de servicio del noroeste)',
    // Veinticuatro gasolineras bajo un portal: Bienestar I y II, Centenario I y
    // II, Country, Degollado, Grullas, ASB Tijuana, Corerepe, Dren Juárez… Es el
    // patrón de grupo gasolinero regional que ningún directorio agrupa por marca,
    // porque cada estación tiene nombre propio.
    // ── SUBDOMINIO MUERTO, PORTAL RECUPERADO (recon 28-ago-2026) ───────────
    // `facturacion.sevafusa.mx` no tiene DNS (el apex `sevafusa.mx` sí resuelve,
    // 92.112.189.235). El portal vivo, enlazado desde el botón "FACTURACIÓN /
    // Facturar" del sitio corporativo, corre sobre la plataforma
    // `facturacionestacion.com` — la misma cuyo apex está estacionado en GoDaddy
    // (ver la ficha `facturacion_estacion`).
    portal: 'https://sevafusa.facturacionestacion.com/',
    requiereCuenta: false,
    plazo: 'mes_natural',
    // ✅ VERIFICADO, literal del portal: «Recuerde que solo puede facturar
    // consumos del mismo mes. La fecha de la factura será la del día en que se
    // realice.»
    plazoVerificado: true,
    campos: [
      // Ningún input trae `name` ni `maxlength`; los `id` sí son estables y
      // descriptivos, así que el adaptador se dirige solo por `id`.
      { clave: 'referencia', etiquetaPortal: 'Referencia', requerido: true },
      { clave: 'folio', etiquetaPortal: 'Folio / Ticket', requerido: true },
      { clave: 'monto', etiquetaPortal: 'Importe Total', requerido: true },
    ],
    reconocer: {
      dominios: ['sevafusa.facturacionestacion.com', 'sevafusa.mx'],
      texto: ['SEVAFUSA', 'SERVICIOS DEL VALLE DEL FUERTE', 'CHEVRON'],
    },
  },
  {
    clave: 'supercarreteras',
    nombre: 'Super Carreteras del Norte (Allende–Agujita, Premier)',
    // ── EL DDNS MURIÓ Y EL PORTAL APARECIÓ MEJOR (recon 28-ago-2026) ───────
    //
    // `supercarreteras.ddns.net` no tiene registro DNS, y `supercarreteras.com`
    // tampoco resuelve. La Auditoría 19 ya lo había encontrado sin responder y
    // lo atribuyó a "un router de oficina apagado"; no era eso, el host ya no
    // existe. El portal vivo está en `haz-factura.com`, y trae DOS mejoras:
    //
    //   1. **HTTPS de verdad.** El único `http://` de este lote se resolvió
    //      solo: el reemplazo sirve TLS. Se cierra el riesgo que la Auditoría 19
    //      había aceptado como residual.
    //   2. **NO PIDE CUENTA.** `requiereCuenta: true` era falso. La página es
    //      `#inputNRU` + `#inputRFC` + `#formaPago` + botón "Facturar": sin
    //      login y sin captcha. Eso mueve este comercio de la columna "asistido"
    //      a la de "automatizable", y de paso ya no hay contraseña que custodiar.
    portal: 'https://supercarreteras.haz-factura.com/blk_varios_tickets/blk_varios_tickets.php',
    requiereCuenta: false, // el catálogo decía true; el portal lo desmiente
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal no declara plazo
    campos: [
      // UN SOLO DATO DEL TICKET. El portal lo llama NRU con todas sus letras:
      // "Número de Referencia Único". Es multi-ticket nativo: «Esta herramienta
      // le permite facturar uno o múltiples tickets de peaje en una sola
      // factura», y la tabla de resultados enseña NRU · Subtotal · IVA · Tarifa
      // · Fecha · Hora, o sea que el resto lo resuelve el portal.
      { clave: 'referencia', etiquetaPortal: 'NRU (Número de Referencia Único)', requerido: true },
    ],
    reconocer: {
      dominios: ['supercarreteras.haz-factura.com', 'haz-factura.com', 'supercarreteras.ddns.net'],
      texto: ['SUPER CARRETERAS', 'SUPERCARRETERAS DEL NORTE', 'AUTOPISTA PREMIER', 'ALLENDE AGUJITA', 'NRU'],
    },
  },
  {
    clave: 'grupo_centra',
    nombre: 'Grupo Centra (Gasolinera 76, Vip Gas, Vip Market…)',
    portal: 'https://facturacion.grupocentra.mx/Karmi_FacturacionWeb',
    requiereCuenta: false, // NO VERIFICADO: la app no deja ver más que el aviso
    // ⚠️ EL PLAZO MÁS CORTO DE TODO EL CATÁLOGO, y es el hallazgo más valioso
    // del recon. Literal del portal:
    //   «Tiene 3 dias para realizar su factura a partir de la fecha de su compra.»
    //
    // El default `'mes_natural'` que tenía era DIEZ VECES más optimista. Si el
    // operador manda la foto el viernes de un viaje del lunes, ya no hay CFDI —
    // y hasta hoy ninguna parte del sistema lo sabía: el panel habría dicho "te
    // quedan 27 días". Es exactamente el caso para el que existe `plazoVerificado`.
    plazo: { dias: 3 },
    plazoVerificado: true,
    campos: [],
    // App **WEBDEV (PC SOFT)**: el `action` lleva un token de sesión en la ruta
    // que cambia en cada visita, los cinco inputs son `hidden` y del framework
    // (`WD_BUTTON_CLICK_`, `WD_ACTION_`, `M3`…), la navegación va por
    // `javascript:_JSL(...)` y los ids son generados (`#M11`, `#tzA8`). No hay
    // un solo selector estable que capturar sin interactuar, así que no se
    // escribe ninguno: un selector inventado falla en producción con cara de
    // estar bien.
    camposPendientes: true,
    reconocer: {
      dominios: ['facturacion.grupocentra.mx', 'grupocentra.mx'],
      texto: ['GRUPO CENTRA', 'CENTRA', 'VIP GAS', 'VIP MARKET'],
    },
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
    //
    // ── SEGUNDO DOMINIO, MISMO COMERCIO (corrida de producción, 28-ago-2026) ──
    //
    // El pipeline real corrió contra las 90 fotos del banco y el OCR leyó
    // `https://www.lbb.com.mx/factura` con el emisor «LOS BISQUETS BISQUETS
    // OBREGON BB DEL SUR, SA DE CV» — la MISMA empresa de esta ficha, que
    // imprime unas veces `lbbo.com.mx` y otras `lbb.com.mx`.
    //
    // ⚠️ SE AÑADE AQUÍ Y NO COMO ENTRADA NUEVA, a propósito. Dos fichas para el
    // mismo emisor son dos candidatos EMPATADOS cuando el ticket trae además el
    // texto —«BISQUETS OBREGON» casaría con las dos— y `identificarComercio`
    // devuelve UNO: el desempate lo decidiría el orden de la lista. Es
    // exactamente el bug de g500/megasur que esta misma ronda vino a arreglar, y
    // la razón por la que Walmart / Sam's / Bodega Aurrera entraron como UNA
    // sola entrada y no como tres.
    reconocer: { dominios: ['lbbo.com.mx', 'lbb.com.mx'], texto: ['BISQUETS OBREGON', 'BB DEL SUR'] },
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
    // EL TICKET NO IMPRIME LIGA — pero eso ya no significa que el portal no se
    // pueda escribir. Ninguno de los 11 tickets del banco trae dominio de
    // facturación (imprimen `miopinionwmx.com`, la encuesta de satisfacción, y
    // un `bit.ly` de aviso de privacidad — las dos son trampas y van en
    // `dominios` de NADIE). Lo que cambió (29-ago-2026): investigación web +
    // Chrome headless (Playwright) encontró y MIDIÓ el portal CENTRALIZADO real
    // que Walmart de México opera para las tres marcas, el mismo que describen
    // fuentes públicas independientes (guías de terceros que coinciden en la
    // URL y en los campos TR/TC).
    //
    // RECORRIDO MEDIDO, sin escribir ni enviar nada:
    //   1. `https://facturacion.walmartmexico.com.mx` → 307 a
    //      `https://facturacion-clientes.walmart.com/` (confirmado con `curl` Y
    //      con Chrome headless — mismo destino).
    //   2. La landing tiene un aviso modal con botón `#popup_btn_accept`
    //      ("Aceptar"); hay que cerrarlo.
    //   3. Sección "Tengo un ticket" → enlace "Obtener factura" → navega a
    //      `/ticket`, que NO es visitable de forma directa (redirige de vuelta a
    //      la landing si no se pasó por el flujo — es guardia de cliente, no
    //      login).
    //   4. El formulario en `/ticket` pide CUATRO campos, con estos `id`
    //      literales: `membershipOrRFC` ("MEMBRESÍA O RFC"), `postalCode`
    //      ("Código Postal", maxlength 5), `ticketNumber` ("Número de Ticket",
    //      maxlength 25) y `transactionNumber` ("# Transacción", maxlength 5).
    //      Botones: `invoice_tab_facturar` ("Facturar") e
    //      `invoice_tab_consulta` ("Consulta o reenvía tu factura").
    //
    // `membershipOrRFC` y `postalCode` son datos del RECEPTOR (la flota), no del
    // ticket — por eso no entran a `campos`, igual que el resto del catálogo.
    // `ticketNumber` y `transactionNumber` sí son del papel y sí se listan abajo.
    //
    // NO SE COMPLETÓ UNA FACTURACIÓN REAL: no hay ticket de Walmart del banco de
    // QA con folio vigente a mano para probar el flujo de punta a punta, así que
    // esto documenta lo que el formulario PIDE, no que el flujo entero funcione.
    portal: 'https://facturacion.walmartmexico.com.mx',
    requiereCuenta: false, // sin login visible: ticket + membresía/RFC, sin crear cuenta
    plazo: 'mes_natural',
    plazoVerificado: false, // el portal no declara plazo en esta pantalla; fuentes de terceros dicen 30 días, sin confirmar en el papel
    campos: [
      {
        clave: 'numeroTicket',
        etiquetaPortal: 'Número de Ticket',
        requerido: true,
        restriccion: { largoMax: 25 },
      },
      {
        clave: 'transaccion',
        etiquetaPortal: '# Transacción',
        requerido: true,
        restriccion: { largoMax: 5 },
      },
    ],
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
    //
    // SE BUSCÓ (29-ago-2026) Y SIGUE SIN URL CONFIABLE. La búsqueda web
    // encuentra "Grupo Vaqueiro Ferretero, S.A. de C.V." en Mérida (nótese la
    // ORTOGRAFÍA distinta: "Vaqueiro", no "Vaquero") con checkout de facturación
    // en `vaqueiros.mx/finalizar-compra/` — pero es una TIENDA EN LÍNEA con
    // facturación al momento de la compra, no un portal de "sube tu ticket
    // después", y nada confirma que su RFC sea TAF170929C58: podría ser un
    // negocio distinto con nombre parecido. El propio ticket ya dice cuál es el
    // canal real —el correo de Hotmail—, así que inventar aquí un dominio de
    // una empresa sin RFC confirmado sería peor que dejarlo pendiente.
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
    //
    // SE BUSCÓ (29-ago-2026) Y SIGUE SIN URL CONFIABLE. `amghg.com` (el sitio
    // corporativo) no tiene ninguna sección ni liga de facturación — se
    // inspeccionó su HTML completo y no aparece la palabra "factura" en ningún
    // lado. Un resultado de búsqueda apuntaba a un portal de Pago Fácil
    // (`manager.pagofacil.net/tpvc/...` con un código atado a AMG), pero ese
    // subdominio hoy da NXDOMAIN — no resuelve. SÍ se encontró un canal real y
    // vigente por otra vía: el correo `facturacion@amghg.com`, publicado con
    // instrucciones de qué adjuntar (constancia fiscal, uso de CFDI, foto del
    // ticket, forma de pago, sucursal). No es un portal —`portal` sirve para
    // ABRIR una página, y un correo no es eso—, así que no se escribe ahí; se
    // deja anotado por si el producto en algún momento factura por correo en
    // vez de portal para estos casos.
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

  // ═══════════════════════════════════════════════════════════════════════
  // CUARTA AMPLIACIÓN (28-ago-2026) — LO QUE DIJO EL PIPELINE CORRIENDO DE VERDAD.
  //
  // De dónde salen: Javier corrió el pipeline completo contra las 90 fotos del
  // banco. De los 68 gastos que se crearon, **42 traían el dominio de
  // facturación impreso y el OCR lo leyó** — 31 dominios distintos. Cruzados
  // contra este archivo, 22 ya estaban (los 21 que agregó la tercera ampliación
  // hicieron su trabajo) y quedaron tres por resolver.
  //
  // DE ESOS TRES, SOLO DOS SON COMERCIOS NUEVOS. El tercero —`lbb.com.mx`— es
  // un SEGUNDO DOMINIO de `lbbo`, que ya estaba: misma razón social impresa,
  // misma empresa. Se añadió a su ficha en vez de crear una entrada, porque dos
  // fichas para un emisor son dos candidatos empatados y el desempate lo
  // decidiría el orden de la lista. Ver la nota en `lbbo`.
  //
  // Los dos de abajo entran con `portalPendiente`: el dominio está IMPRESO y
  // verificado —es como se detectaron— pero **nadie ha abierto su formulario**.
  // `portal` se usa para ABRIR una página, así que guardar una URL cuyo
  // formulario no se ha visto mandaría al robot, o a una persona, a un sitio sin
  // comprobar. Con la marca, `enrutar` los devuelve incompletos DICIENDO EL
  // NOMBRE del comercio, que es infinitamente mejor que "emisor desconocido".
  // ═══════════════════════════════════════════════════════════════════════
  {
    clave: 'gasolineria_mallorca',
    nombre: 'Gasolinería Mallorca',
    // EL MÁS IMPORTANTE DE LOS TRES, y no por volumen: su concepto es DIÉSEL.
    // Un CFDI de combustible es el que ampara el estímulo de IEPS, así que un
    // ticket de aquí que se quede sin facturar no solo pierde el IVA — pierde
    // también el acreditamiento del estímulo. Es la categoría donde un gasto sin
    // comprobante cuesta más caro.
    portal: '',
    portalPendiente: true,
    // Dominio impreso y leído por el OCR: `https://WWW.FACTURASCAS.COM`. Se
    // guarda en minúsculas y sin `www` porque así se compara el dominio de la
    // liga; el papel lo imprime en mayúsculas.
    //
    // ⚠️ SE INTENTÓ VERIFICAR (29-ago-2026) Y EL DOMINIO ESTÁ MUERTO:
    // `facturascas.com` (y `.com.mx`, `.mx`, con y sin `www`) da NXDOMAIN — no
    // resuelve, punto. La Wayback Machine tampoco tiene NUNCA un snapshot de
    // ese host, lo que apunta a que nunca existió públicamente y no a que se
    // dio de baja hace poco. Hipótesis con evidencia parcial, NO confirmada:
    // `facturasgas.com` SÍ existe y SÍ es una plataforma real de autofacturación
    // de gasolineras (formulario con búsqueda por RFC, en
    // `facturasgas.com/facturacion/autofactura.php`) — C↔G es una confusión de
    // OCR plausible sobre un ticket térmico en mayúsculas. Pero esa plataforma
    // es MULTI-COMERCIO (no muestra "GASOLINERIA MALLORCA" en ningún lado
    // visible) y no se pudo confirmar que esta razón social/RFC facture ahí
    // sin teclear el RFC real en su buscador — que es precisamente lo que este
    // recon evita hacer sin un ticket real en la mano. SIN URL CONFIABLE
    // ENCONTRADA todavía: se deja anotado para que quien tenga el ticket físico
    // (o uno nuevo del banco de QA) confirme si el dominio impreso hoy sigue
    // siendo `FACTURASCAS.COM` o si cambió, antes de escribir cualquiera de
    // los dos como `portal`.
    requiereCuenta: false, // NO VERIFICADO: nadie ha abierto el portal
    plazo: 'mes_natural',
    plazoVerificado: false,
    campos: [],
    camposPendientes: true,
    // RFC LEÍDO DEL TICKET Y VERIFICADO. Es la señal más fuerte que existe para
    // un emisor —no depende de cómo el OCR parta la razón social— y por eso va
    // aunque el portal siga sin verificarse.
    reconocer: {
      dominios: ['facturascas.com'],
      rfc: ['GMA031203PV9'],
      texto: ['GASOLINERIA MALLORCA'],
    },
  },
  {
    clave: 'los_taquitos_pm',
    nombre: 'Los Taquitos de PM',
    // ── EL DOMINIO DEL CATÁLOGO TENÍA UNA "L" DE MÁS (recon 29-ago-2026) ────
    //
    // `facturacion.lostaquitosdelpm.com` / `lostaquitosdelpm.com` (DEL pm) NO
    // RESUELVEN — NXDOMAIN, y la Wayback Machine no tiene ni un snapshot de
    // ninguno de los dos: nunca existieron públicamente. Es casi seguro un
    // error de transcripción de la OCR original ("del pm" vs "de pm"), y es un
    // bug real: con el dominio malo, `identificarComercio` NUNCA iba a
    // reconocer un ticket real de este comercio por dominio.
    //
    // El dominio correcto, encontrado por búsqueda web y confirmado navegando
    // con Chrome headless (Playwright, sin escribir ni enviar nada):
    // `https://www.lostaquitosdepm.com/facturacion` (DE pm, sin "l"). Es un
    // restaurante real de Mérida (tacos, cochinita) con SIETE sucursales, y esa
    // página lista un enlace "Facturación Sucursal <nombre>" por cada una,
    // apuntando a `https://admin.softrestaurant.com/Facturacion/MenuCliente/<id>`
    // — la plataforma es Soft Restaurant®, no un desarrollo propio.
    //
    // SE MIDIÓ EL FORMULARIO REAL de una sucursal (Prol. Paseo de Montejo, id
    // 25158; las siete comparten la misma plantilla, a reserva de confirmarlo
    // en más de una). Campos con `id` literal: `CodigoUnicoTicket` ("Código de
    // facturación", maxlength 30) y `FolioTicket` ("Folio", maxlength 30) —
    // alternos, con un botón por cada uno (`btn_addon_codigounico` /
    // `btn_addon_folio`) que decide cuál se captura — más dos campos de RFC del
    // receptor (`RFC` maxlength 13, `RFCReceptor` maxlength 30 — datos de la
    // flota, no del ticket). Botón `btn_facturar` ("Facturar"). Sin captcha
    // visible.
    //
    // EL TICKET IMPRIME UN PLAZO: la página de facturación dice literal
    // «para realizar sus facturas en línea debe ser dentro de las primeras 24
    // hrs. después del consumo» — el mismo plazo más corto del catálogo
    // (ver `conekta360`, otra ferretería de Mérida con el mismo límite). Este
    // dato SÍ se escribe abajo: es el mismo para las siete sucursales y está en
    // la página que se guarda como `portal`, no en el formulario de una en
    // particular.
    //
    // POR QUÉ `camposPendientes` SIGUE EN `true` AUNQUE EL FORMULARIO YA SE
    // MIDIÓ: `campos` describe lo que pide LA PÁGINA GUARDADA EN `portal`, y
    // `portal` es el selector de sucursales —real, vivo, corrige el dominio
    // muerto— no el formulario de `MenuCliente/<id>` en sí. Cuál de los siete
    // IDs es el correcto depende de qué sucursal imprimió el ticket, y nada en
    // este archivo resuelve hoy ese cruce. Escribir aquí los campos del
    // formulario profundo como si vivieran en `portal` sería inexacto del
    // mismo modo que inventar una URL — y además volvería este comercio
    // "pilotable" (`COMERCIOS_PILOTABLES` solo mira `campos.length` y
    // `camposPendientes`) para un portal donde esos campos no están. Quedan
    // documentados arriba en prosa para que quien resuelva el cruce de
    // sucursal → id no tenga que remedir el formulario.
    portal: 'https://www.lostaquitosdepm.com/facturacion',
    requiereCuenta: false, // sin login: ticket + folio/código, confirmado en el formulario medido
    // PLAZO VERIFICADO EN EL PROPIO PORTAL, literal: «dentro de las primeras 24
    // hrs. después del consumo» (`www.lostaquitosdepm.com/facturacion`, leído
    // 29-ago-2026).
    plazo: { horas: 24 },
    plazoVerificado: true,
    campos: [],
    camposPendientes: true,
    // SIN `rfc` A PROPÓSITO: el OCR no lo leyó en este ticket. Un RFC "deducido"
    // del nombre sería inventado, y el RFC es justamente el campo donde una
    // invención se propaga sin ruido hasta un CFDI. El reconocimiento se sostiene
    // en el dominio impreso —ya corregido— y en la razón social.
    reconocer: {
      dominios: ['lostaquitosdepm.com', 'admin.softrestaurant.com'],
      texto: ['LOS TAQUITOS DE PM'],
    },
  },
];

export function comercio(clave: string): Comercio | undefined {
  return COMERCIOS.find((c) => c.clave === clave);
}
