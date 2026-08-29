import type { GuionPortal } from './guion';

// ═══════════════════════════════════════════════════════════════════════════
// LOS PORTALES, COMO TABLAS. Un portal nuevo se escribe aquí y en ningún otro
// sitio: no hay una clase por portal, no hay un archivo por portal.
//
// ═══════════════════════════════════════════════════════════════════════════
// ── CÓMO SE ELIGIERON ESTOS CUATRO, Y POR QUÉ NO POR VOLUMEN ──────────────
// ═══════════════════════════════════════════════════════════════════════════
//
// SE MIRÓ EL DATO PRIMERO Y NO ALCANZA. Consultado contra producción el
// 27-ago-2026 (MCP de Supabase, solo lectura):
//
//     select count(*), count(distinct tenant_id) from gasto;   →  8 gastos, 1 flota
//     select concepto, rfc_emisor, count(*) from gasto …       →  6 combinaciones
//
// Los RFC emisores que hay en esas ocho filas (NWM9709244W4, PORV860925N52,
// BME0203185LA, SEY0704139A8, y una fila sin RFC) NO corresponden a NINGUNA de
// las 37 fichas de `comercios.ts` — se comprobó por grep contra el catálogo.
//
// O sea: HOY NO HAY DATOS DE VOLUMEN CON LOS QUE RANKEAR PORTALES. Fabricar
// un «top 4 por número de tickets» a partir de ocho filas de una sola flota, o
// peor, de la intuición, sería inventar una cifra — la regla número uno de
// esta casa. Así que el criterio se declara y es OTRO:
//
//   CRITERIO (declarado, no derivado de volumen):
//   los comercios que (a) NO exigen cuenta y (b) ya tienen sus etiquetas de
//   campo leídas —o sea, sin `camposPendientes`—.
//
//   Por qué ese y no otro:
//     · SIN CUENTA = automatizable HOY, de punta a punta, sin que una persona
//       tenga que vincular nada y sin tocar el cofre de credenciales. Es el
//       tramo barato, y es la cola larga: 26 de los 37 comercios del catálogo
//       no piden cuenta.
//     · CON ETIQUETAS LEÍDAS = hay de dónde derivar los selectores candidatos.
//       Un comercio con `camposPendientes` no sabe ni cómo se llaman sus
//       campos; escribirle una tabla sería inventarla entera.
//
//   Aplicado al catálogo, eso deja diez elegibles (CAPUFE ya tiene adaptador):
//   enerser, gogas, libramientos_meta, oxxo, office_depot, megasur, controlnet,
//   ado, primera_plus, autozone.
//
//   DE ESOS DIEZ SE TOMAN CUATRO, y el desempate también se declara: que entre
//   los cuatro se ejercite TODA la superficie del motor, para que la
//   generalización quede probada y no solo escrita.
//     1. `office_depot`  — el único cuyo HTML se leyó DE VERDAD (consta en su
//        ficha: `<input formcontrolname="itu" maxlength="30" uppercase>`), y el
//        único con `plazoVerificado: true`. Ejercita `mayusculas` y `monto`.
//     2. `controlnet`    — multi-comercio: una sola tabla cubre Walmart, Alsea,
//        OXXO y gasolineras. El mejor rendimiento por línea del catálogo.
//        Ejercita `fecha_dmy` + `monto`.
//     3. `enerser`       — un campo y nada más. Es la demostración de que un
//        portal nuevo cabe en diez líneas.
//     4. `autozone`      — tres campos con transacción, fecha y monto: el
//        segundo formato de fecha y el paso de BUSCAR separado del de emitir.
//
// ═══════════════════════════════════════════════════════════════════════════
// ── DE DÓNDE SALEN LOS SELECTORES, Y POR QUÉ NINGUNO DICE «VERIFICADO» ────
// ═══════════════════════════════════════════════════════════════════════════
//
// LOS CUATRO GUIONES LLEVAN `verificado: null`, Y ESO NO ES UN PENDIENTE QUE
// SE OLVIDÓ: ES EL ESTADO HONESTO.
//
// Los 16 selectores de CAPUFE se midieron abriendo el portal con un arnés que
// solo lee (`pruebas-manuales/capufe-prevuelo.prueba.ts`, 5-ago-2026), y su
// propio comentario dice cuáles resolvieron y cuáles siguen siendo apuestas.
// Estos cuatro portales NO se han visitado. Escribir `'#folio'` como si
// alguien lo hubiera visto sería inventar un hecho.
//
// Lo que SÍ hay es un dato real del que derivar candidatos: la
// `etiquetaPortal` de cada campo en `comercios.ts` —«Número de ticket (ITU)»,
// «Monto total», «Fecha de compra»—, cosechada de las guías del comercio y,
// en Office Depot, del HTML. De ahí salen los candidatos de abajo, y son eso:
// CANDIDATOS. Cada campo declara dos o tres formas plausibles de nombrarlo y
// el pre-vuelo elige la que exista en la página de verdad.
//
// CONSECUENCIA, QUE ES EL PUNTO: con `verificado: null` estos portales
// ENSAYAN (abren, llenan, capturan la pantalla, y el pre-vuelo reporta
// selector por selector qué existe y qué no) y SE NIEGAN A EMITIR. El motor lo
// impide en código —`motivoSinVerificar`, en `guion.ts`—, no con una nota.
//
// CÓMO SE GRADÚA UNO. Se corre el arnés genérico:
//
//     set -a; source .env.local; set +a
//     PORTAL=office_depot npx vitest run --config vitest.manual.config.ts \
//       pruebas-manuales/guion-prevuelo.prueba.ts
//
// y se pega aquí, en `verificado`, lo que reportó: la fecha, el arnés y los
// selectores que resolvieron. A partir de esa línea el portal emite. Es una
// visita de lectura y cuesta dos segundos.
//
// ═══════════════════════════════════════════════════════════════════════════
// ── SEGUNDA TANDA (28-ago-2026): DIEZ PORTALES MÁS, Y AHORA CON EL DOM ────
// ═══════════════════════════════════════════════════════════════════════════
//
// Todo lo de arriba sigue valiendo, con UNA diferencia que cambia el valor de
// las tablas nuevas: **los selectores de los diez que se añaden abajo NO son
// candidatos derivados de la etiqueta — se copiaron del DOM del portal.**
//
// Se visitaron los 37 portales del catálogo uno por uno con Chromium real,
// volcando todos los `<form>`, los inputs sueltos de las SPA y los iframes.
// Las actas, con el HTML crudo y una captura por portal, están en
// `RECON-PORTALES-20.md` y `RECON-PORTALES-17.md`. Cada guion nuevo apunta a su
// sección con `lecturaDeCampo`, para que cualquiera pueda cotejar el selector
// contra el volcado sin volver a visitar nada.
//
// LO QUE ESO CAMBIA, Y LO QUE NO:
//   · SÍ cambia qué significa que el pre-vuelo falle. Con un selector leído, un
//     fallo dice «el portal cambió desde el 28-ago», que se arregla releyendo.
//     Con un candidato adivinado decía «probamos tres formas y ninguna era»,
//     que manda a mirar el portal desde cero.
//   · NO cambia el permiso para emitir. Los catorce guiones siguen con
//     `verificado: null`. El recon **no envió ni un formulario**, así que en
//     casi todos no llegó a ver la pantalla del receptor ni el botón que emite:
//     los campos del ticket están leídos y el resto del camino no. Ascender eso
//     a `verificado` sería justo el fraude que la política 1 impide.
//
// LAS PLATAFORMAS SON EL ATAJO, y es el hallazgo que abarata el frente entero:
// varios comercios corren el MISMO software con los MISMOS `id`, así que
// **automatizar N portales no cuesta N adaptadores**. Dos de los diez de abajo
// son UNA LÍNEA cada uno porque su plataforma ya está escrita como fábrica.
// Ver el bloque «LAS PLATAFORMAS» más abajo.
//
// ── LO QUE QUEDA ANOTADO Y NO SE PUDO APROVECHAR TODAVÍA ──────────────────
//
// **Circle K y Supercarreteras leen el QR del ticket desde una imagen subida**
// (`input[type=file]`, `button.btn-camera`). Subir la foto que el operador ya
// mandó por WhatsApp eliminaría el riesgo de OCR por completo en esos dos. El
// motor todavía no sabe subir archivos —`PaginaPortal` no tiene ese paso—, así
// que hoy van por el camino de teclear. Es la mejora de mayor rendimiento que
// admiten estos dos portales y por eso queda escrita donde se va a leer.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El input que cuelga de una etiqueta con este texto.
 *
 * CSS no sabe decir «el input cuyo label dice X» —no hay selector de
 * ascendiente ni de hermano anterior—, así que va por XPath, que es lo que
 * `PaginaPlaywright` admite con prefijo `xpath=`. Casa por SUBCADENA
 * (`contains`) a propósito: los portales adornan sus etiquetas con asteriscos
 * de obligatorio, dos puntos y espacios, y un match exacto fallaría por un
 * carácter que nadie ve.
 *
 * `following::input[1]` y no `following-sibling`: en la mitad de estos
 * formularios el input vive dentro de un `<div>` hermano, no como hermano
 * directo del label.
 */
const porEtiqueta = (texto: string) =>
  `xpath=//label[contains(normalize-space(.), ${comillas(texto)})]/following::input[1]`;

/** El botón que enseña este texto. `:has-text` casa por subcadena y sin acentos de caja. */
const botonQueDice = (texto: string) => `button:has-text("${texto}"), input[type="submit"][value*="${texto}" i]`;

/**
 * Un literal para XPath 1.0, que NO tiene escape de comillas.
 *
 * Si el texto trae comillas dobles se usa el otro delimitador; si trae de las
 * dos, hay que partirlo con `concat()`. Ninguna etiqueta de este archivo lo
 * necesita hoy, pero la función se niega a construir un XPath roto en silencio
 * — un selector mal formado se descubriría como «el campo no existe», que
 * manda a mirar el portal cuando el error está aquí.
 */
function comillas(texto: string): string {
  if (!texto.includes('"')) return `"${texto}"`;
  if (!texto.includes("'")) return `'${texto}'`;
  const partes = texto.split('"').map((p) => `"${p}"`).join(`, '"', `);
  return `concat(${partes})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · OFFICE DEPOT
//
// El único del catálogo cuyo HTML se leyó directamente: su campo de ITU es
// `<input formcontrolname="itu" maxlength="30" uppercase>`. `formcontrolname`
// es de Angular reactive forms, así que ese candidato va PRIMERO — es el único
// que no es una hipótesis. Los otros dos son la red por si el portal migró.
//
// `mayusculas` en el ITU no es cosmética: el atributo `uppercase` del input
// dice que el portal lo espera así, y un ITU en minúsculas rebota.
// ═══════════════════════════════════════════════════════════════════════════
export const OFFICE_DEPOT: GuionPortal = {
  comercio: 'office_depot',
  portal: 'https://facturacion.officedepot.com.mx/#/generaF',
  verificado: null,
  campos: {
    // `#ituTxt` es el `id` real, leído del DOM el 28-ago-2026; el
    // `formcontrolname` se conserva como segundo candidato porque es el que no
    // depende de que el `id` sobreviva a un rediseño de Angular.
    numeroTicket: {
      selector: ['#ituTxt', 'input[formcontrolname="itu"]', porEtiqueta('ITU')],
      formato: 'mayusculas',
    },
    // ⚠️ `sucursal` SALIÓ DE AQUÍ, y no por limpieza. El recon abrió el
    // desplegable: `Tienda` no es una sucursal, es el CANAL DE COMPRA
    // (`Tienda` · `Sitio Web y APP Movil` · `Telemarketing` · `Mercado Libre`).
    // No se lee del ticket — para un ticket de papel siempre vale `Tienda` —, así
    // que es una constante del portal y no un campo del comprobante. Declararlo
    // aquí mandaba al extractor a buscar en el papel algo que nunca está.
    monto: {
      selector: ['#inlineFormInputName3', 'input[formcontrolname="monto"]', porEtiqueta('MONTO')],
      formato: 'monto',
    },
  },
  receptor: {
    rfc: { selector: ['input[formcontrolname="rfc"]', porEtiqueta('RFC'), '#rfc'], formato: 'mayusculas' },
    correo: { selector: ['input[formcontrolname="correo"]', porEtiqueta('Correo'), 'input[type="email"]'] },
  },
  // El paso 4 del asistente se llama literalmente `Descarga`: el CFDI se baja en
  // el navegador. No hace falta esperar un correo.
  botonEmitir: [botonQueDice('Facturar'), botonQueDice('Generar')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, .invalid-feedback, mat-error, .error-message',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 2 · CONTROLNET
//
// Multi-comercio: su ficha dice que cubre Walmart, Alsea, OXXO y gasolineras
// con un solo portal, y que no pide cuenta. Es el mejor rendimiento por línea
// del catálogo y por eso entra, aunque —también según su ficha— nadie lo ha
// facturado todavía.
//
// La fecha va como `fecha_dmy`: es el formato que usa el 100% de los portales
// mexicanos que este repo ha leído. Es una hipótesis igual que los selectores,
// y falla RUIDOSAMENTE si es la equivocada: el portal rechaza y el rechazo se
// lee del cuadro de error, no se disimula.
// ═══════════════════════════════════════════════════════════════════════════
export const CONTROLNET: GuionPortal = {
  comercio: 'controlnet',
  // La raíz redirige (302) al sitio corporativo, sin un solo campo. El portal
  // está en `/Factura`.
  portal: 'https://www.controlnet.com.mx/Factura',
  verificado: null,
  campos: {
    // ⚠️ UN CAMPO, NO TRES. Este guion declaraba `fecha` y `monto` porque la
    // ficha del catálogo los afirmaba; el recon leyó el formulario y solo existe
    // `IDTran` (`#txtNumeroTicket01`, maxlength=24, placeholder
    // `0000.0000.0000.0000.0000`). Buscar los otros dos habría hecho fallar el
    // pre-vuelo por selectores que no pueden existir.
    numeroTicket: {
      selector: ['#txtNumeroTicket01', 'input[name="txtNumeroTicket01"]', porEtiqueta('IDTran')],
    },
  },
  receptor: {
    rfc: { selector: [porEtiqueta('RFC'), 'input[name*="rfc" i]', '#rfc'], formato: 'mayusculas' },
    correo: { selector: [porEtiqueta('Correo'), 'input[type="email"]', 'input[name*="mail" i]'] },
  },
  buscar: {
    // `#btnConsultarTicket` es el `id` real leído del DOM. El formulario aparece
    // detrás de `#btnFacturarTicket` («Factura tu Ticket(s)»), que solo abre un
    // panel — no envía nada.
    boton: ['#btnConsultarTicket', botonQueDice('Consultar'), botonQueDice('Buscar')],
    que: 'el botón de consultar el ticket',
    esperar: '.resultado, table tbody tr, [class*="resultado" i]',
    sinResultados: '.alert-warning, .sin-resultados, .no-results',
  },
  botonEmitir: [botonQueDice('Facturar'), botonQueDice('Generar factura')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, .invalid-feedback, .error-message',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 3 · ENERSER
//
// Un solo campo del ticket. ESTE ES EL EJEMPLO de lo corto que quedó declarar
// un portal: quince líneas, sin una sola de lógica.
//
// El `https://` no es un detalle de estilo: la ficha era `http://` y la
// Auditoría 19 lo cambió porque la credencial de la flota viajaba en claro.
// Se lee de `comercios.ts` conceptualmente y se repite aquí porque el guion
// tiene que poder correr sin cargar el catálogo — pero si alguna vez difieren,
// manda el catálogo y esto es el bug.
// ═══════════════════════════════════════════════════════════════════════════
export const ENERSER: GuionPortal = {
  comercio: 'enerser',
  // La raíz es el LOGIN. El camino de invitado se abre con un BOTÓN («Facturar
  // sin registro»), no con un enlace, así que se guarda la URL de destino: un
  // adaptador que buscara un `<a href>` no la encontraría.
  portal: 'https://facturacion.enerser.com.mx/invitado/facturacion-lote',
  verificado: null,
  campos: {
    // El campo de la referencia es el 2.º `input` del bloque «COLA DE TICKETS» y
    // NO trae `id` ni `formcontrolname` — por eso el primer candidato va por
    // etiqueta, que es lo único estable que se le observó.
    referencia: { selector: [porEtiqueta('REFERENCIA'), 'input[name*="referencia" i]', '#referencia'] },
  },
  receptor: {
    rfc: { selector: [porEtiqueta('RFC'), 'input[name*="rfc" i]', '#rfc'], formato: 'mayusculas' },
    correo: { selector: [porEtiqueta('Correo'), 'input[type="email"]', 'input[name*="mail" i]'] },
  },
  botonEmitir: [botonQueDice('Facturar'), botonQueDice('Generar')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, .invalid-feedback, .error-message',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 4 · AUTOZONE
//
// Tres campos y el paso de BUSCAR separado del de emitir, que es la forma más
// común entre los portales de retail: primero se localiza el consumo, después
// aparece el formulario fiscal. Está declarado como `buscar` justo para probar
// que esa forma cabe en la tabla sin escribir código.
//
// Ojo con lo que `buscar.esperar` significa: sin él, «el ticket no existe» y
// «la página tarda» son indistinguibles, y se arreglan en sitios distintos.
// ═══════════════════════════════════════════════════════════════════════════
export const AUTOZONE: GuionPortal = {
  comercio: 'autozone',
  portal: 'https://www.autozone.com.mx/factura-electronica',
  verificado: null,
  campos: {
    transaccion: { selector: [porEtiqueta('transacción'), porEtiqueta('folio'), 'input[name*="transaccion" i]'] },
    fecha: { selector: [porEtiqueta('Fecha'), 'input[type="date"]', 'input[name*="fecha" i]'], formato: 'fecha_dmy' },
    monto: { selector: [porEtiqueta('Monto'), 'input[name*="monto" i]', 'input[name*="total" i]'], formato: 'monto' },
  },
  receptor: {
    rfc: { selector: [porEtiqueta('RFC'), 'input[name*="rfc" i]', '#rfc'], formato: 'mayusculas' },
    correo: { selector: [porEtiqueta('Correo'), 'input[type="email"]', 'input[name*="mail" i]'] },
  },
  buscar: {
    boton: [botonQueDice('Buscar'), botonQueDice('Consultar')],
    que: 'el botón de buscar la transacción',
    esperar: '.resultado, table tbody tr, [class*="resultado" i]',
    sinResultados: '.alert-warning, .sin-resultados, .no-results',
  },
  botonEmitir: [botonQueDice('Facturar'), botonQueDice('Generar factura')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, .invalid-feedback, .error-message',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// ── LAS PLATAFORMAS: DONDE UN ADAPTADOR VALE POR VARIOS ────────────────────
// ═══════════════════════════════════════════════════════════════════════════
//
// El hallazgo de arquitectura del recon del 28-ago-2026: **automatizar N
// portales no cuesta N adaptadores**, porque varios comercios corren el MISMO
// software con los MISMOS identificadores de campo.
//
// No es una corazonada: se comprobó comparando los DOM. Shell, BP y FacturaGAS
// declaran exactamente `#formLogin`, `#mailUser`, `#pwdUser`, `#form_nw_account`,
// `#a_name`, `#a_lastName`, `#a_phoneNumber` (maxlength 15 en los tres),
// `#a_email`, `#a_confEmail`, `#recoverPasstLost`, `#r_pass` y
// `#btnCreateNwAccount`. El pie de FacturaGAS lo dice: «Powered by ControlGAS®».
//
// Las funciones de abajo son eso: una tabla parametrizada por host. Añadir un
// comercio de una plataforma ya conocida es UNA LÍNEA, no una tabla nueva — que
// es la misma promesa que este archivo le hizo a los portales sueltos, un nivel
// más arriba.
//
// ⚠️ Y TIENEN UN LÍMITE QUE HAY QUE RESPETAR: compartir plataforma NO es
// compartir configuración. Shell y BP corren ControlGAS y aun así NO tienen el
// camino «sin usuario» que sí tiene FacturaGAS (en Shell devuelve pantalla de
// error; en BP, 404 limpio). Por eso la fábrica recibe la URL completa y el
// llamador decide, en vez de componerla a partir del host.

/**
 * ControlGAS® — la vía «Facturar sin Usuario`, la única sin captcha.
 *
 * Los tres campos y sus `maxlength` se leyeron en `app.facturagas.net`, que es
 * el único de los tres hermanos que deja mirar sin cuenta. Shell y BP tienen los
 * mismos `id` EN EL LOGIN; que su formulario de ticket sea idéntico es una
 * inferencia razonable y NO está verificada — por eso hoy esta fábrica solo se
 * usa para FacturaGAS y los otros dos siguen con el encargado.
 */
function controlGas(comercio: string, portal: string): GuionPortal {
  return {
    comercio,
    portal,
    verificado: null,
    lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-20.md §2.2' },
    campos: {
      // Combo con botón: el `id` del input real lleva el sufijo `_Input`.
      sucursal: { selector: ['#rstation_Input', 'input[name="rstation"]', porEtiqueta('Estación')] },
      folio: { selector: ['#despacho', 'input[name="despacho"]', porEtiqueta('Folio')] },
      webId: { selector: ['#webId', 'input[name="webId"]', porEtiqueta('WebID')], formato: 'mayusculas' },
    },
    receptor: {
      rfc: { selector: ['#inputRfc2', porEtiqueta('RFC')], formato: 'mayusculas' },
      nombre: { selector: ['#inputRazon', porEtiqueta('Razón')] },
      correo: { selector: ['#inputCorreo', 'input[type="email"]'] },
      codigoPostal: { selector: ['#inputCp', porEtiqueta('Postal')] },
      regimenFiscal: { selector: ['#cmbRegimen'], como: 'seleccionar' },
      usoCfdi: { selector: ['#cmbUsos'], como: 'seleccionar' },
    },
    // «Consultar Ticket» trae los datos del consumo ANTES de pedir nada fiscal:
    // es el oráculo que dice si lo que leyó la visión existe de verdad.
    buscar: {
      boton: ['#btnSerchTk', botonQueDice('Consultar Ticket')],
      que: 'el botón de consultar el ticket',
      esperar: '#inputRfc2, #btnGenFacUs',
      sinResultados: '.alert-danger, .swal2-container, [class*="error" i]',
    },
    botonEmitir: ['#btnGenFacUs', botonQueDice('Generar Factura')],
    uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
    error: '.alert-danger, .swal2-html-container, [class*="error" i]',
    // `#btnReSerch` («Descarga de Factura») y `#nroCheck` (No. rastreo) son el
    // camino para volver por el CFDI después. No se ejercitó.
    xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
  };
}

/**
 * `facturacionestacion.com` — UNA tabla, N comercios, solo cambia el subdominio.
 *
 * El apex está estacionado en GoDaddy (ver la ficha `facturacion_estacion`);
 * la plataforma vive por subdominio de comercio. Los `id` son de la PLATAFORMA
 * —se leyeron en `sevafusa.facturacionestacion.com`— así que sirven para
 * cualquier estación que la use.
 *
 * Ningún input trae `name` ni `maxlength`: los `id` son la única señal, y son
 * estables y descriptivos. Por eso aquí NO hay candidatos por etiqueta como
 * red de seguridad — inventarlos daría una falsa sensación de respaldo.
 */
function facturacionEstacion(comercio: string, subdominio: string): GuionPortal {
  return {
    comercio,
    portal: `https://${subdominio}.facturacionestacion.com/`,
    verificado: null,
    lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-20.md §2.5' },
    campos: {
      referencia: { selector: ['#txtReferencia'] },
      folio: { selector: ['#txtFolio'] },
      monto: { selector: ['#txtAmount'], formato: 'monto' },
    },
    receptor: {
      // El RFC va en el PRIMER paso, junto a los datos del ticket: esta
      // plataforma identifica al receptor antes de buscar el consumo.
      rfc: { selector: ['#txtRFC'], formato: 'mayusculas' },
      nombre: { selector: ['#txtName'] },
      correo: { selector: ['#txtEmail', 'input[type="email"]'] },
      codigoPostal: { selector: ['#txtZipcode'] },
      regimenFiscal: { selector: ['#selFiscalRegime'], como: 'seleccionar' },
      usoCfdi: { selector: ['#selVoucherUse'], como: 'seleccionar' },
    },
    buscar: {
      boton: ['#btnNext', botonQueDice('Buscar')],
      que: 'el botón de buscar el ticket',
      esperar: '#txtName, #selFiscalRegime',
      sinResultados: '.alert-danger, [class*="error" i]',
    },
    botonEmitir: [botonQueDice('Facturar'), botonQueDice('Generar')],
    uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
    error: '.alert-danger, [class*="error" i]',
    xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · FACTURAGAS  (ControlGAS®, una línea gracias a la fábrica)
// ═══════════════════════════════════════════════════════════════════════════
export const FACTURAGAS: GuionPortal = controlGas('facturagas', 'https://app.facturagas.net/generar_factura.aspx');

// ═══════════════════════════════════════════════════════════════════════════
// 6 · SEVAFUSA  (facturacionestacion.com, otra línea)
// ═══════════════════════════════════════════════════════════════════════════
export const SEVAFUSA: GuionPortal = facturacionEstacion('sevafusa', 'sevafusa');

// ═══════════════════════════════════════════════════════════════════════════
// 7 · GOGAS
//
// La ficha del catálogo era CORRECTA de punta a punta —una de solo dos—, y el
// formulario es un `POST` clásico con `id` estables. Un campo del ticket y el
// resto son los datos fiscales de la flota.
//
// El propio portal declara la entrega: el `data-content` del campo Email dice
// que es «la dirección de correo electrónico a la que se enviará la factura».
// O sea que aquí NO hay XML que bajar de la pantalla — llega por correo—, y por
// eso este guion no declara `xml`: prometer un botón que no existe haría que el
// motor reportara un fallo de descarga en una emisión que salió bien.
// ═══════════════════════════════════════════════════════════════════════════
export const GOGAS: GuionPortal = {
  comercio: 'gogas',
  portal: 'https://facturasgas.com/facturacion/autofactura.php',
  verificado: null,
  lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-17.md §2.3' },
  campos: {
    referencia: { selector: ['#Ticket', 'input[name="Ticket"]', porEtiqueta('Rastreo')] },
  },
  receptor: {
    rfc: { selector: ['#RFC', 'input[name="RFC"]'], formato: 'mayusculas' },
    nombre: { selector: ['#RazonSocial'] },
    correo: { selector: ['#Email'] },
    codigoPostal: { selector: ['#CP'] },
    regimenFiscal: { selector: ['#CdCfdiRegimen', 'select[name="CdCfdiRegimen"]'], como: 'seleccionar' },
    usoCfdi: { selector: ['#CdUsoCfdi'], como: 'seleccionar' },
  },
  buscar: {
    // `#Button_Add` («Agregar») mete el ticket a la lista; `#Button_Insert`
    // («Solicitar Factura») es el que ENVÍA. Son dos botones distintos y
    // confundirlos emitiría con la lista vacía.
    boton: ['#Button_Add', botonQueDice('Agregar')],
    que: 'el botón de agregar el ticket a la lista',
    esperar: 'table tbody tr, .resultado, [class*="lista" i]',
    sinResultados: '.alert-danger, .error, [class*="error" i]',
  },
  botonEmitir: ['#Button_Insert', botonQueDice('Solicitar Factura')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, .error, [class*="error" i]',
};

// ═══════════════════════════════════════════════════════════════════════════
// 8 · OXXO
//
// JSF/PrimeFaces. Los `id` llevan el prefijo `form:` y son ESTABLES: los genera
// el árbol de componentes del servidor, no un bundler. Los dos puntos hay que
// escaparlos en CSS (`form\\:folio`), que es de las pocas veces que el escape
// importa de verdad en este archivo.
//
// ⚠️ LA URL LLEVA `/views/layout/inicio.do` Y NO SE PUEDE ACORTAR: la raíz
// responde 200 con un cuerpo de JSF sin procesar y cero campos. Es el modo de
// falla que un chequeo por código HTTP da por sano.
//
// La fecha es un datepicker `readonly`: el motor escribe en el `_input`, que es
// lo que PrimeFaces deja teclear.
// ═══════════════════════════════════════════════════════════════════════════
export const OXXO: GuionPortal = {
  comercio: 'oxxo',
  portal: 'https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do',
  verificado: null,
  lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-17.md §2.5' },
  campos: {
    fecha: { selector: ['#form\\:fecha_input', porEtiqueta('Fecha de venta')], formato: 'fecha_dmy' },
    folio: { selector: ['#form\\:folio', porEtiqueta('Folio de venta')] },
    transaccion: { selector: ['#form\\:venta', porEtiqueta('ID de venta')] },
    monto: { selector: ['#form\\:total', porEtiqueta('Total')], formato: 'monto' },
  },
  receptor: {
    rfc: { selector: ['#form\\:rfc'], formato: 'mayusculas' },
    nombre: { selector: ['#form\\:razon'] },
    codigoPostal: { selector: ['#form\\:codigo'] },
    regimenFiscal: { selector: ['#form\\:selectOneMenuRegFis'], como: 'seleccionar' },
    usoCfdi: { selector: ['#form\\:selectOneMenuCFDI'], como: 'seleccionar' },
  },
  buscar: {
    // `#form:continuar` valida el ticket y abre el paso fiscal. Es el oráculo:
    // si el consumo no existe, aquí se sabe antes de tocar nada fiscal.
    boton: ['#form\\:continuar', botonQueDice('Continuar')],
    que: 'el botón de continuar que valida el ticket',
    esperar: '#form\\:rfc, #form\\:generarFactura',
    sinResultados: '.ui-messages-error, .ui-message-error, [class*="error" i]',
  },
  botonEmitir: ['#form\\:generarFactura', botonQueDice('Generar Factura')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.ui-messages-error, .ui-message-error, [class*="error" i]',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 9 · RED ESTATAL DE AUTOPISTAS (REANL)
//
// La corrección de más valor del recon: la ficha decía «exige cuenta, no
// automatizable» y el portal ofrece «Factura Express — sin necesidad de
// registro». Este guion existe porque esa corrección lo hizo posible.
//
// ⚠️ DOS TRAMPAS DEL STACK, las dos anotadas por el recon:
//   · ASP.NET WebForms con `__VIEWSTATE`/`__EVENTTARGET`: hay que reenviar el
//     ViewState, o sea que NO sirve un POST directo. Se navega y se envía desde
//     la página, que es justo lo que hace `PaginaPlaywright`.
//   · Los `id` son larguísimos pero ESTABLES (los genera el árbol de controles
//     del servidor). El sufijo `_I` es el input real del control DevExpress.
//
// UN SOLO CAMPO REQUERIDO. El portal lo dice: «Si no cuenta con WebID ingrese
// los datos del ticket.» Los demás son el plan B y por eso no se declaran aquí:
// un guion que los exija haría fallar el pre-vuelo por campos que el camino
// principal ni siquiera muestra.
// ═══════════════════════════════════════════════════════════════════════════
const REA = 'MainPane_Content_MainContent_PageControl_Factura_exampleFormLayout';

export const RED_ESTATAL_AUTOPISTAS: GuionPortal = {
  comercio: 'red_estatal_autopistas',
  portal: 'https://www.qrplus.com.mx/REA_Facturacion/FormsFacturacion/FWizExprFacturacion.aspx',
  verificado: null,
  lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-17.md §2.15' },
  campos: {
    webId: { selector: [`#${REA}_txtFolioUnico_I`, porEtiqueta('Web ID')], formato: 'mayusculas' },
  },
  receptor: {
    rfc: { selector: [porEtiqueta('RFC'), 'input[id*="txtRFC"]'], formato: 'mayusculas' },
    correo: { selector: [porEtiqueta('Correo'), 'input[type="email"]', 'input[id*="Correo"]'] },
  },
  buscar: {
    boton: [`#${REA}_btnRegistraTicketFU_I`, botonQueDice('Registrar WebId')],
    que: 'el botón de registrar el Web ID',
    esperar: 'table tbody tr, [id*="Grid"], [class*="dxgv"]',
    sinResultados: '[class*="dxeErrorCell"], .alert-danger, [class*="error" i]',
  },
  botonEmitir: [botonQueDice('Facturar'), botonQueDice('Generar')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '[class*="dxeErrorCell"], .alert-danger, [class*="error" i]',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 10 · SUPERCARRETERAS DEL NORTE
//
// El otro comercio que el recon movió de «asistido» a «automatizable»: su ficha
// decía que exige cuenta y el portal nuevo no pide login ni captcha. Y de paso
// el `http://` del catálogo desapareció solo — el reemplazo sirve TLS.
//
// UN SOLO DATO DEL TICKET, el NRU («Número de Referencia Único», así lo llama la
// página). Es multi-ticket nativo y el portal resuelve subtotal, IVA, tarifa,
// fecha y hora a partir de él.
//
// ⚠️ El botón «Facturar» NO tiene `id`: el selector estable es la clase o el
// rol. Se anota porque es exactamente el tipo de cosa que alguien "arregla"
// poniendo un `#facturar` que no existe.
// ═══════════════════════════════════════════════════════════════════════════
export const SUPERCARRETERAS: GuionPortal = {
  comercio: 'supercarreteras',
  portal: 'https://supercarreteras.haz-factura.com/blk_varios_tickets/blk_varios_tickets.php',
  verificado: null,
  lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-20.md §2.6' },
  campos: {
    referencia: { selector: ['#inputNRU', porEtiqueta('NRU')] },
  },
  receptor: {
    rfc: { selector: ['#inputRFC', porEtiqueta('RFC')], formato: 'mayusculas' },
  },
  botonEmitir: ['button.btn-success', botonQueDice('Facturar')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, [class*="error" i]',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 11 · ARCO CHIHUAHUA (Petrol / ADFSA)
//
// Tres campos del ticket, form `#form1` con `id` propios. Ningún input declara
// `maxlength`, así que no se le pone restricción a nada.
//
// ⚠️ ESTE PORTAL TIENE UNA VENTANA MUERTA AL PRINCIPIO: «su ticket se encuentra
// disponible 2 horas despues de haber realizado la carga». No se maneja aquí
// —es del reloj, no del guion— pero está en la ficha como `disponibleTrasHoras`
// para que el motor no intente antes de tiempo y lea el «no existe» del portal
// como si fuera un selector roto.
// ═══════════════════════════════════════════════════════════════════════════
export const ARCO_CHIHUAHUA: GuionPortal = {
  comercio: 'arco_chihuahua',
  portal: 'https://www.petrol.com.mx/facturacionpetrol/',
  verificado: null,
  lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-20.md §2.1' },
  campos: {
    sucursal: { selector: ['#txSucursal', 'input[name="txSucursal"]'] },
    folio: { selector: ['#txNota', 'input[name="txNota"]'] },
    monto: { selector: ['#txTotal', 'input[name="txTotal"]'], formato: 'monto' },
  },
  receptor: {
    // OJO: hay DOS RFC en este flujo. `#txRFCC` es el del modal que identifica
    // al cliente («Siguiente») y `#txRFC` el del formulario fiscal. Se declara
    // el segundo, que es el que acaba en el CFDI.
    rfc: { selector: ['#txRFC', '#txRFCC'], formato: 'mayusculas' },
    nombre: { selector: ['#txRSocial'] },
    correo: { selector: ['#txCorreoP'] },
    codigoPostal: { selector: ['#txtCP_4'] },
    regimenFiscal: { selector: ['#ddlRegimenFiscal_4'], como: 'seleccionar' },
    usoCfdi: { selector: ['#ddlUsoCDFI'], como: 'seleccionar' },
  },
  buscar: {
    boton: ['#addTicket', 'input[type="submit"][value="Agregar"]'],
    que: 'el botón de agregar el ticket',
    esperar: 'table tbody tr, #txRFCC, [class*="modal" i]',
    sinResultados: '.alert-danger, [class*="error" i]',
  },
  botonEmitir: ['#BtnFacturar', 'input[value="Generar Factura"]'],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, [class*="error" i]',
  // Pide correo principal Y secundario, lo que apunta a entrega por correo. No
  // se verificó, así que no se promete un botón de XML que quizá no existe.
};

// ═══════════════════════════════════════════════════════════════════════════
// 12 · CIRCLE K
//
// Portal ESTRENADO EN 2026 (su pie dice `v1.0.0 · 2026-04-17`) y el más frágil
// de selectores del lote entero:
//
// ⚠️ NINGÚN INPUT TIENE `id` NI `name`. Es React controlado. Lo único estable
// es el `placeholder`, el `type=date` y el texto de la etiqueta — y por eso
// aquí NO hay ni un candidato `#algo`: inventarlo sería peor que no tener red,
// porque parecería que alguien lo comprobó.
//
// Además es una SPA: el HTML inicial son 1.9 KB y el formulario no existe hasta
// navegar a «Generar Factura» desde la portada.
//
// 🎁 EL REGALO: esta pantalla acepta LEER EL QR DEL TICKET desde una imagen
// subida («Arrastra una imagen del ticket o selecciona una foto del código»),
// vía `button.btn-ticket-image` / `button.btn-ticket-camera` y dos
// `input[type=file]`. Subir la foto que el operador YA mandó por WhatsApp
// elimina el riesgo de OCR por completo en este comercio. El motor todavía no
// sabe subir archivos, así que hoy va por el camino de teclear; queda anotado
// porque es la mejora de mayor rendimiento que este portal admite.
// ═══════════════════════════════════════════════════════════════════════════
export const CIRCLE_K: GuionPortal = {
  comercio: 'circle_k',
  portal: 'https://facturacion.portalcck.com/',
  verificado: null,
  lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-20.md §2.3' },
  campos: {
    sucursal: { selector: ['input[placeholder="Ej. 001"]', porEtiqueta('NO. DE TIENDA')] },
    folio: { selector: ['input[placeholder="Ej. 123456"]', porEtiqueta('FOLIO')] },
    fecha: { selector: ['input[type="date"]', porEtiqueta('FECHA DE COMPRA')], formato: 'fecha_dmy' },
  },
  receptor: {
    // El paso 2 (Receptor) no se leyó: el portal dice «El Uso CFDI se solicita
    // en el siguiente paso», y llegar ahí exigía enviar. Van candidatos
    // genéricos y el pre-vuelo dirá qué existe.
    rfc: { selector: [porEtiqueta('RFC'), 'input[name*="rfc" i]'], formato: 'mayusculas' },
    correo: { selector: [porEtiqueta('Correo'), 'input[type="email"]'] },
  },
  buscar: {
    boton: ['button.btn-primary.btn-lg', botonQueDice('Consultar ticket')],
    que: 'el botón de consultar el ticket',
    esperar: '[class*="receptor" i], [class*="resumen" i], input[name*="rfc" i]',
    sinResultados: '.alert-danger, [class*="error" i]',
  },
  botonEmitir: [botonQueDice('Facturar'), botonQueDice('Generar')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, [class*="error" i]',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 13 · RED VÍA CORTA (RCO)
//
// ⚠️ LA TRAMPA MÁS ESPECÍFICA DEL LOTE: es Liferay y el `action` del formulario
// incluye un token de sesión `p_auth=…` DISTINTO EN CADA VISITA. No se puede
// hacer un POST directo con una URL guardada — hay que cargar la página y
// enviar desde ella. Este motor siempre navega, así que cumple por
// construcción; se anota para que nadie "optimice" saltándose la carga.
//
// Segundo aviso: los sufijos `_fukp` / `_hhsb` de los botones parecen generados
// por Liferay, así que el botón de emitir va por TEXTO y el de agregar por
// `#Agregar`, que es el único id corto y por tanto probablemente escrito a mano.
//
// El plazo de este portal es el más largo del catálogo —«vigencia dentro del
// año fiscal al cruce o compra»— y está en la ficha como `{ dias: 365 }`.
// ═══════════════════════════════════════════════════════════════════════════
const RCO = '_com_rco_facturacion_solicitudFacturacionPortlet';

export const REDVIACORTA: GuionPortal = {
  comercio: 'redviacorta',
  portal: 'https://redviacorta.mx/es/factura',
  verificado: null,
  lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-20.md §2.4' },
  campos: {
    folio: { selector: [`#${RCO}_ticket`, `input[name="${RCO}_uuid"]`], formato: 'mayusculas' },
    monto: { selector: [`#${RCO}_tickettotal`, `input[name="${RCO}_total"]`], formato: 'monto' },
  },
  receptor: {
    rfc: { selector: [`#${RCO}_rfc`], formato: 'mayusculas' },
    nombre: { selector: [`#${RCO}_nombre_razon_social`] },
    correo: { selector: [`#${RCO}_email`] },
    codigoPostal: { selector: [`#${RCO}_cp`] },
    regimenFiscal: { selector: [`#${RCO}_solicitudRegimen`], como: 'seleccionar' },
    usoCfdi: { selector: [`#${RCO}_cfdi_select`], como: 'seleccionar' },
  },
  buscar: {
    boton: ['#Agregar', botonQueDice('Agregar')],
    que: 'el botón de agregar el ticket',
    esperar: `table tbody tr, #${RCO}_rfc`,
    sinResultados: '.alert-danger, .portlet-msg-error, [class*="error" i]',
  },
  botonEmitir: [botonQueDice('Generar Factura')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, .portlet-msg-error, [class*="error" i]',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 14 · LIBRAMIENTOS META  (Quadrum — la misma plataforma que CAPUFE)
//
// CAPUFE y este portal los opera **Quadrum**: mismo pie de página, misma
// dirección, mismos teléfonos, mismo asistente. CAPUFE ya tiene su adaptador
// dedicado (`capufe.ts`, anterior a este motor), así que aquí NO se rehace —
// lo que se aprovecha es el CONOCIMIENTO de la plataforma para escribir este.
//
// ⚠️ Y HAY UN LÍMITE QUE SE RESPETA: el selector del campo del CÓDIGO vive en
// el PASO 2 del asistente, y el paso 1 no avanza sin capturar los datos
// fiscales — o sea, sin enviar, que el recon no hace. El campo equivalente de
// CAPUFE sí se leyó (`#codigo` / `[name="ticket.codigo"]`), pero eso es una
// INFERENCIA DE PLATAFORMA, no una lectura de ESTE portal. Va como candidato
// junto a la etiqueta, y el pre-vuelo dirá cuál existe.
//
// Los del paso 1 (los fiscales) SÍ se leyeron y van con su `id` real.
// ═══════════════════════════════════════════════════════════════════════════
export const LIBRAMIENTOS_META: GuionPortal = {
  comercio: 'libramientos_meta',
  portal: 'https://facturacionquadrum.com.mx/valoran/#/sinregistro',
  verificado: null,
  lecturaDeCampo: { fecha: '2026-08-28', acta: 'RECON-PORTALES-17.md §2.4 (paso 1); el paso 2 NO se leyó' },
  campos: {
    codigo: { selector: ['#codigo', '[name="ticket.codigo"]', porEtiqueta('digo')] },
  },
  receptor: {
    rfc: { selector: ['#rfc', '[name="rfc"]'], formato: 'mayusculas' },
    nombre: { selector: ['#nombre'] },
    correo: { selector: ['#correo'] },
    codigoPostal: { selector: ['#domicilioFiscalReceptor'] },
    regimenFiscal: { selector: ['#regimenFiscalReceptor'], como: 'seleccionar' },
    usoCfdi: { selector: ['#usoCfdi'], como: 'seleccionar' },
  },
  buscar: {
    boton: [botonQueDice('Siguiente')],
    que: 'el botón de avanzar al paso de capturar códigos',
    esperar: '#codigo, [name="ticket.codigo"], [class*="paso" i]',
    sinResultados: '.alert-danger, [class*="error" i]',
  },
  botonEmitir: [botonQueDice('Facturar'), botonQueDice('Generar')],
  uuid: '.uuid, [class*="folio-fiscal" i], [data-uuid]',
  error: '.alert-danger, [class*="error" i]',
  xml: { boton: [botonQueDice('XML'), 'a[href$=".xml"]'] },
};

/**
 * TODOS LOS GUIONES ESCRITOS. De aquí se deriva la tabla de `registro.ts`.
 *
 * Es UNA lista y no una lista más un `switch`: una segunda lista escrita a
 * mano es la que alguien olvida al agregar el quinto portal, que es
 * exactamente lo que `PORTALES_CONOCIDOS` ya evita derivándose de `TABLA`.
 */
export const GUIONES: readonly GuionPortal[] = [
  // Los cuatro primeros (PR #163), escritos desde la `etiquetaPortal` del
  // catálogo. AutoZone sigue aquí aunque su ficha lo marque `noAutomatizable`:
  // «sé operarlo» y «lo voy a intentar» son preguntas distintas, y quitarlo de
  // esta lista borraría la tabla en vez de declarar el bloqueo. `registro.ts`
  // lo saca de los que emiten, que es donde importa.
  OFFICE_DEPOT, CONTROLNET, ENERSER, AUTOZONE,
  // Los diez del reconocimiento de campo del 28-ago-2026, con los selectores
  // copiados del DOM. Dos de ellos son UNA LÍNEA porque su plataforma ya está
  // escrita como fábrica (FACTURAGAS y SEVAFUSA).
  FACTURAGAS, SEVAFUSA, GOGAS, OXXO, RED_ESTATAL_AUTOPISTAS,
  SUPERCARRETERAS, ARCO_CHIHUAHUA, CIRCLE_K, REDVIACORTA, LIBRAMIENTOS_META,
];

/** Un guion por su clave de comercio, o `null`. No lanza: quien pregunta decide. */
export function guionDe(comercio: string): GuionPortal | null {
  return GUIONES.find((g) => g.comercio === comercio) ?? null;
}
