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
  portal: 'https://facturacion.officedepot.com.mx/',
  verificado: null,
  campos: {
    numeroTicket: {
      selector: ['input[formcontrolname="itu"]', porEtiqueta('ticket'), 'input[name*="itu" i]'],
      formato: 'mayusculas',
    },
    sucursal: { selector: [porEtiqueta('Tienda'), 'input[formcontrolname="tienda"]', 'select[name*="tienda" i]'] },
    monto: { selector: [porEtiqueta('Monto'), 'input[formcontrolname="monto"]', 'input[name*="monto" i]'], formato: 'monto' },
  },
  receptor: {
    rfc: { selector: ['input[formcontrolname="rfc"]', porEtiqueta('RFC'), '#rfc'], formato: 'mayusculas' },
    correo: { selector: ['input[formcontrolname="correo"]', porEtiqueta('Correo'), 'input[type="email"]'] },
  },
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
  portal: 'https://www.controlnet.com.mx/',
  verificado: null,
  campos: {
    numeroTicket: { selector: [porEtiqueta('ticket'), 'input[name*="ticket" i]', '#ticket'] },
    fecha: { selector: [porEtiqueta('Fecha'), 'input[type="date"]', 'input[name*="fecha" i]'], formato: 'fecha_dmy' },
    monto: { selector: [porEtiqueta('Monto'), 'input[name*="monto" i]', 'input[name*="total" i]'], formato: 'monto' },
  },
  receptor: {
    rfc: { selector: [porEtiqueta('RFC'), 'input[name*="rfc" i]', '#rfc'], formato: 'mayusculas' },
    correo: { selector: [porEtiqueta('Correo'), 'input[type="email"]', 'input[name*="mail" i]'] },
  },
  buscar: {
    boton: [botonQueDice('Buscar'), botonQueDice('Consultar')],
    que: 'el botón de buscar el ticket',
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
  portal: 'https://facturacion.enerser.com.mx/',
  verificado: null,
  campos: {
    referencia: { selector: [porEtiqueta('referencia'), 'input[name*="referencia" i]', '#referencia'] },
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

/**
 * TODOS LOS GUIONES ESCRITOS. De aquí se deriva la tabla de `registro.ts`.
 *
 * Es UNA lista y no una lista más un `switch`: una segunda lista escrita a
 * mano es la que alguien olvida al agregar el quinto portal, que es
 * exactamente lo que `PORTALES_CONOCIDOS` ya evita derivándose de `TABLA`.
 */
export const GUIONES: readonly GuionPortal[] = [OFFICE_DEPOT, CONTROLNET, ENERSER, AUTOZONE];

/** Un guion por su clave de comercio, o `null`. No lanza: quien pregunta decide. */
export function guionDe(comercio: string): GuionPortal | null {
  return GUIONES.find((g) => g.comercio === comercio) ?? null;
}
