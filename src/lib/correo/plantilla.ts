// ═══════════════════════════════════════════════════════════════════════════
// LA PLANTILLA DE CORREO — el design system de Likida, en HTML de 1999.
//
// Un correo no es una página web. Gmail borra el <style> del <head>, Outlook
// renderiza con el motor de Word (sin flexbox, sin grid, sin border-radius
// fiable), y casi todos los clientes bloquean las imágenes hasta que el lector
// las autoriza. Por eso aquí NO se reusan los componentes de la app:
//
//   · todo el CSS va EN LÍNEA, atributo por atributo;
//   · la estructura son <table> anidadas, no <div>;
//   · el ancho es fijo (600px), el estándar que todos los clientes respetan;
//   · nada de var(--marca): los custom properties no existen en Outlook, así
//     que los colores van copiados como literales y con su token anotado al
//     lado, para que un cambio de marca se pueda rastrear hasta aquí.
//
// ── EL LOGO VA INCRUSTADO, NO ENLAZADO. Es la decisión más importante de este
// archivo.
//
// La primera versión servía `/images/logo.png` desde producción. El archivo
// estaba ahí y respondía HTTP 200 incluso sin user-agent — o sea, el proxy de
// Gmail SÍ podía bajarlo. Aun así el correo llegó con un ícono de imagen rota:
// el cliente tenía bloqueadas las imágenes externas, que es el default para un
// remitente nuevo. Un logo enlazado depende de un permiso que no controlamos.
//
// Ahora viaja DENTRO del correo como adjunto en línea (`cid:`). Son 4.5 KB por
// envío y no hay red que fallar.
//
// Y el texto alterno LLEVA ESTILO, que es la mitad que faltaba: cuando un
// cliente no pinta una imagen, la mayoría aplica los estilos del `<img>` a su
// alt. Así el peor caso no es un ícono roto — es "LIKIDA" en versalitas
// espaciadas, que es el wordmark de la marca de todos modos. No queda un
// estado feo posible.
//
// ── LA PALETA ES NEUTRA, NO NARANJA. Las dos consolas de la app corren bajo la
// clase `.tema-neutro` de globals.css, que pivota `--marca` a #18181b: el
// naranja #c2410c vive en los tokens pero no es lo que el usuario ve. Un correo
// naranja con botón rojo no se parecía en nada al producto.
//
// PIE OBLIGATORIO. Todo correo transaccional lleva por qué le llegó y cómo
// dejar de recibirlo. No es cortesía: es lo que separa un correo transaccional
// de uno que los filtros tratan como marketing.
// ═══════════════════════════════════════════════════════════════════════════

import { appUrl } from '@/lib/env';
import { LOGO_CID } from './logo';

/**
 * La URL pública de la app, para los enlaces y para el logo enlazado.
 *
 * SE LEE AL ARMAR, no al importar. La diferencia se vio mirando el render: el
 * generador de plantillas corre en la máquina de desarrollo, donde
 * `NEXT_PUBLIC_APP_URL` vale `http://localhost:3000`, y con la constante
 * capturada en el import no había forma de pisarla — las plantillas salieron
 * con el logo apuntando a localhost y el pie diciendo «localhost:3000». En
 * producción daba igual; en el archivo que se pega en el panel de Supabase,
 * no.
 */
function base(): string {
  return appUrl();
}

/**
 * Los tokens de `globals.css` bajo `.tema-neutro`, copiados como literales
 * porque un correo no entiende `var()`. Si la paleta cambia, se cambia AQUÍ
 * además de allá.
 */
const C = {
  marca: '#18181b',   // --marca bajo .tema-neutro (el negro de las consolas)
  tinta: '#17100d',   // --color-ink, el negro cálido de los titulares
  muted: '#6b7280',   // --color-muted
  faint: '#73737c',   // --faint
  linea: '#ececef',   // --color-line
  lienzo: '#f9f9fa',  // --canvas
  papel: '#ffffff',   // --color-surface
  g1: '#f4f4f5',      // --g1 neutro, para zonas de reposo
  bad: '#b91c1c',
  warn: '#b45309',
} as const;

/**
 * Las dos familias de la app. En correo los webfonts casi nunca cargan (solo
 * Apple Mail y algún cliente), así que se NOMBRAN primero y el sistema resuelve
 * el resto: quien las tenga instaladas ve el tipo del producto, y quien no, una
 * pila neutra que se le parece. Nunca se cae a Times.
 */
const DISPLAY = `'Inter Tight',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const SANS = `Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
/** La mono de los micro-rótulos de la app. Un código en proporcional se
 *  transcribe mal: el 1 y la l, el 0 y la O. */
const MONO = `'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace`;

export type TonoCorreo = 'neutral' | 'atencion' | 'urgente';

/**
 * El tono NO pinta bandas de color.
 *
 * La versión anterior ponía un filo rojo de 3px y un botón rojo, y el correo
 * gritaba. Un aviso premium se distingue por su MICRO-RÓTULO, no por el
 * volumen: el color queda para una sola palabra y el resto del correo se
 * mantiene neutro. Así, además, el día que lleguen tres avisos seguidos no
 * parecen tres alarmas.
 */
const TONO: Record<TonoCorreo, { rotulo: string | null; color: string }> = {
  neutral: { rotulo: null, color: C.muted },
  atencion: { rotulo: 'Requiere atención', color: C.warn },
  urgente: { rotulo: 'Urgente', color: C.bad },
};

export interface Boton { texto: string; href: string }

export interface Correo {
  asunto: string;
  /** El renglón bajo el asunto en la bandeja (preheader). Si no se pone, Gmail
   *  toma la primera línea del cuerpo, que sería el wordmark. */
  avance: string;
  titulo: string;
  /** Párrafos del cuerpo. Se escapan: pueden traer nombres de operador o folios
   *  que vienen de la base. */
  parrafos: string[];
  /** Renglones de datos (etiqueta → valor). */
  datos?: Array<[string, string]>;
  boton?: Boton;
  /**
   * El código de un solo uso, cuando el correo lleva uno. Se pinta en mono,
   * grande y espaciado: un código que hay que TECLEAR se lee dígito por
   * dígito, y agrupado apretado se teclea mal.
   */
  codigo?: string;
  /**
   * Imprime la URL del botón también como texto seleccionable.
   *
   * NO es adorno y no es opcional en un correo de acceso: los escaneadores de
   * correo corporativo (Defender, Proofpoint) reescriben el href y a veces lo
   * VISITAN antes que la persona — y un enlace de un solo uso visitado por un
   * robot ya no sirve cuando el humano hace clic. Con la liga literal a la
   * vista, el peor caso es copiar y pegar; sin ella, es no poder entrar.
   */
  enlaceLiteral?: boolean;
  /** Nota al pie DE LA TARJETA (no del correo): qué hacer si no lo pediste.
   *  Va en un bloque aparte para que no se lea como parte del cuerpo. */
  nota?: string;
  tono?: TonoCorreo;
  /** Por qué le llegó este correo. Va al pie. */
  porQueLoRecibes: string;
}

/**
 * Escapa para HTML. Los folios, nombres y descripciones vienen de la base y de
 * mensajes de WhatsApp: son DATOS, nunca marcado. Un operador que se registre
 * con un nombre que traiga `<img onerror=...>` no puede inyectar nada en el
 * correo que le llega al dueño de la flota.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Un href seguro para el correo. Solo se dejan pasar http(s): un `javascript:`
 * o un `data:` en el botón sería una inyección con nuestro remitente como aval.
 */
export function hrefSeguro(url: string): string {
  const limpio = url.trim();
  if (!/^https?:\/\//i.test(limpio)) return base();
  return esc(limpio);
}

/** El texto plano que acompaña al HTML. No es opcional: un correo sin parte de
 *  texto puntúa peor en los filtros de spam, y hay clientes que solo la leen. */
export function aTextoPlano(c: Correo): string {
  const lineas = ['LIKIDA', '', c.titulo, '', ...c.parrafos];
  if (c.datos?.length) {
    lineas.push('');
    for (const [k, v] of c.datos) lineas.push(`${k}: ${v}`);
  }
  if (c.codigo) lineas.push('', `Código: ${c.codigo}`);
  if (c.boton) lineas.push('', `${c.boton.texto}: ${c.boton.href}`);
  if (c.nota) lineas.push('', c.nota);
  lineas.push('', '—', c.porQueLoRecibes, `Likida · ${base()}`);
  return lineas.join('\n');
}

/** Cómo viaja el logo. Son dos mundos distintos y no hay uno que sirva para
 *  los dos, así que se elige al armar. */
export interface OpcionesHtml {
  /**
   * `'cid'` (el default) incrusta el logo como adjunto en línea: es lo que
   * manda `enviar.ts` por Resend y no depende de que el cliente autorice
   * imágenes externas.
   *
   * `'url'` lo enlaza a producción. Se usa SOLO para las plantillas que se
   * pegan en el panel de Supabase: ese correo sale por SMTP desde su
   * infraestructura y no hay forma de adjuntarle nada. Peor caso allá: el
   * cliente bloquea la imagen y el alt con estilo pinta el wordmark, que es
   * exactamente el mismo peor caso de siempre.
   */
  logo?: 'cid' | 'url';
}

export function armarHtml(c: Correo, op: OpcionesHtml = {}): string {
  const tono = TONO[c.tono ?? 'neutral'];
  const logoSrc = op.logo === 'url' ? `${base()}/images/logo.png` : `cid:${LOGO_CID}`;

  // Micro-rótulo con su punto de color: el mismo recurso `etiqueta-mono` de
  // las tarjetas de la app — el tono se dice en UNA palabra, no en bandas.
  const rotulo = tono.rotulo
    ? `<p style="margin:0 0 14px 0;font-family:${SANS};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.11em;text-transform:uppercase;color:${tono.color};"><span style="color:${tono.color};">&#9679;</span>&nbsp;&nbsp;${esc(tono.rotulo)}</p>`
    : '';

  // El grid de datos, nivel documento: etiqueta en versalitas espaciadas a la
  // izquierda, valor en seminegrita a la derecha, un pelo de línea por fila.
  const datos = c.datos?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:30px 0 4px 0;border-collapse:collapse;">
${c.datos.map(([k, v]) => `        <tr>
          <td style="padding:13px 0;border-top:1px solid ${C.linea};font-family:${SANS};font-size:10.5px;line-height:16px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:${C.faint};">${esc(k)}</td>
          <td align="right" style="padding:13px 0;border-top:1px solid ${C.linea};font-family:${SANS};font-size:14px;line-height:20px;color:${C.tinta};font-weight:600;">${esc(v)}</td>
        </tr>`).join('\n')}
        <tr><td colspan="2" style="border-top:1px solid ${C.linea};font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>`
    : '';

  // Botón NEGRO en píldora — el primario de la app bajo .tema-neutro.
  const boton = c.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 4px 0;">
        <tr><td bgcolor="${C.marca}" style="border-radius:999px;">
          <a href="${hrefSeguro(c.boton.href)}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(c.boton.texto)}</a>
        </td></tr>
      </table>`
    : '';

  // EL CÓDIGO DE UN SOLO USO. Mono, 27px y bien espaciado, sobre un bloque de
  // reposo: se teclea mirando el correo en el teléfono y tecleando en la
  // computadora, así que lo que importa es que NO se confundan 1/l ni 0/O.
  const codigo = c.codigo
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px 0;">
        <tr><td style="padding:0 0 9px 0;font-family:${SANS};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.11em;text-transform:uppercase;color:${C.faint};">C&oacute;digo de un solo uso</td></tr>
        <tr><td bgcolor="${C.g1}" align="center" style="padding:17px 30px;border:1px solid ${C.linea};border-radius:12px;font-family:${MONO};font-size:27px;line-height:33px;font-weight:600;letter-spacing:0.2em;color:${C.tinta};white-space:nowrap;">${esc(c.codigo)}</td></tr>
      </table>`
    : '';

  // LA LIGA LITERAL. `word-break:break-all` no es cosmético: una URL de
  // verificación pasa de los 200 caracteres y sin él desborda los 600px y
  // rompe la tarjeta en Outlook.
  const ligaLiteral = c.boton && c.enlaceLiteral
    ? `<p style="margin:24px 0 0 0;font-family:${SANS};font-size:11.5px;line-height:18px;color:${C.faint};">&iquest;El bot&oacute;n no abre? Copia esta liga en tu navegador:<br>
        <span style="word-break:break-all;">${esc(c.boton.href)}</span></p>`
    : '';

  // LA NOTA DE SEGURIDAD, en su propio bloque. Dentro del cuerpo se leería
  // como un párrafo más y es justo lo que no puede pasar: es la línea que le
  // dice a alguien que no pidió esto que no tiene que hacer nada.
  const nota = c.nota
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 0 0;border-collapse:collapse;">
        <tr><td bgcolor="${C.lienzo}" style="padding:15px 18px;border:1px solid ${C.linea};border-radius:10px;font-family:${SANS};font-size:12px;line-height:19px;color:${C.muted};">${esc(c.nota)}</td></tr>
      </table>`
    : '';

  const parrafos = c.parrafos
    .map((p) => `<p style="margin:0 0 16px 0;font-family:${SANS};font-size:15px;line-height:24px;color:#52525b;">${esc(p)}</p>`)
    .join('\n      ');

  // El relleno del avance: sin él, Gmail completa el preheader con el cuerpo
  // (y arrancaría con el alt del logo). Espacios de ancho cero, el estándar.
  const rellenoAvance = '&nbsp;&zwnj;'.repeat(90);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(c.asunto)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.lienzo};">
<!-- El avance: lo que se lee en la bandeja bajo el asunto. Se esconde del
     cuerpo con el truco estándar de altura cero y color transparente. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(c.avance)}${rellenoAvance}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.lienzo};">
  <tr><td align="center" style="padding:44px 16px 36px 16px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;border-collapse:collapse;">

      <!-- EL LOGO REAL, arriba a la izquierda, INCRUSTADO (cid:) y no enlazado.
           Un <img src="https://…"> depende de que el cliente autorice imágenes
           externas, y Gmail las bloquea por defecto: así llegó roto la primera
           vez, aunque el archivo respondía 200. Incrustado viaja con el correo.

           Y EL TEXTO ALTERNO LLEVA ESTILO: cuando un cliente no pinta la
           imagen, la mayoría aplica los estilos del <img> a su alt. El peor
           caso no es un ícono roto — es LIKIDA en versalitas espaciadas, el
           wordmark de todos modos. Nunca hay un estado feo. -->
      <tr><td align="left" style="padding:0 0 26px 2px;">
        <img src="${logoSrc}" alt="LIKIDA" width="112" height="23"
          style="display:block;border:0;outline:none;text-decoration:none;height:23px;width:112px;font-family:${DISPLAY};font-size:15px;font-weight:600;letter-spacing:0.34em;color:${C.marca};">
      </td></tr>

      <tr><td bgcolor="${C.papel}" style="padding:42px 44px 38px 44px;border:1px solid ${C.linea};border-radius:16px;">
        ${rotulo}
        <h1 style="margin:0 0 18px 0;font-family:${DISPLAY};font-size:26px;line-height:34px;font-weight:600;letter-spacing:-0.02em;color:${C.tinta};">${esc(c.titulo)}</h1>
      ${parrafos}
      ${codigo}
      ${datos}
      ${boton}
      ${ligaLiteral}
      ${nota}
      </td></tr>

      <!-- El pie: la casa editorial del correo. Primera línea, quiénes somos;
           segunda, por qué te llegó; tercera, a dónde volver. Sin gritos. -->
      <tr><td align="left" style="padding:26px 6px 0 6px;">
        <p style="margin:0 0 7px 0;font-family:${SANS};font-size:11px;line-height:17px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">Likida&nbsp;&nbsp;&#183;&nbsp;&nbsp;Liquidaci&oacute;n de viajes por WhatsApp</p>
        <p style="margin:0 0 5px 0;font-family:${SANS};font-size:11px;line-height:18px;color:${C.faint};">${esc(c.porQueLoRecibes)}</p>
        <p style="margin:0;font-family:${SANS};font-size:11px;line-height:18px;color:${C.faint};">
          <a href="${base()}" style="color:${C.faint};text-decoration:underline;text-decoration-color:${C.linea};">${esc(base().replace(/^https?:\/\//, ''))}</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
