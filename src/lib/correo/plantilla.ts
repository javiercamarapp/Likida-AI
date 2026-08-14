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

import { LOGO_CID } from './logo';

/** La URL pública de la app, para los enlaces. */
const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://app.likida.ai';

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
  if (!/^https?:\/\//i.test(limpio)) return BASE;
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
  if (c.boton) lineas.push('', `${c.boton.texto}: ${c.boton.href}`);
  lineas.push('', '—', c.porQueLoRecibes, `Likida · ${BASE}`);
  return lineas.join('\n');
}

export function armarHtml(c: Correo): string {
  const tono = TONO[c.tono ?? 'neutral'];

  // Micro-rótulo en versalitas espaciadas: el mismo recurso que la app usa en
  // `etiqueta-mono` para los rótulos de tarjeta.
  const rotulo = tono.rotulo
    ? `<p style="margin:0 0 10px 0;font-family:${SANS};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:${tono.color};">${esc(tono.rotulo)}</p>`
    : '';

  const datos = c.datos?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 6px 0;border-collapse:collapse;">
${c.datos.map(([k, v], i) => `        <tr>
          <td style="padding:11px 0;${i === 0 ? `border-top:1px solid ${C.linea};` : `border-top:1px solid ${C.linea};`}font-family:${SANS};font-size:13px;line-height:19px;color:${C.muted};">${esc(k)}</td>
          <td align="right" style="padding:11px 0;border-top:1px solid ${C.linea};font-family:${SANS};font-size:13px;line-height:19px;color:${C.tinta};font-weight:600;">${esc(v)}</td>
        </tr>`).join('\n')}
        <tr><td colspan="2" style="border-top:1px solid ${C.linea};font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>`
    : '';

  // Botón NEGRO, como los primarios de la app bajo .tema-neutro.
  const boton = c.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 2px 0;">
        <tr><td bgcolor="${C.marca}" style="border-radius:8px;">
          <a href="${hrefSeguro(c.boton.href)}" style="display:inline-block;padding:11px 20px;font-family:${SANS};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(c.boton.texto)}</a>
        </td></tr>
      </table>`
    : '';

  const parrafos = c.parrafos
    .map((p) => `<p style="margin:0 0 14px 0;font-family:${SANS};font-size:14px;line-height:23px;color:${C.muted};">${esc(p)}</p>`)
    .join('\n      ');

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
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(c.avance)}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.lienzo};">
  <tr><td align="center" style="padding:40px 12px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;border-collapse:collapse;">

      <!-- EL LOGO REAL, arriba a la izquierda, INCRUSTADO (cid:) y no enlazado.
           Un <img src="https://…"> depende de que el cliente autorice imágenes
           externas, y Gmail las bloquea por defecto: así llegó roto la primera
           vez, aunque el archivo respondía 200. Incrustado viaja con el correo.

           Y EL TEXTO ALTERNO LLEVA ESTILO. Es la mitad que faltaba: cuando un
           cliente no pinta la imagen, la mayoría aplica los estilos del <img>
           a su texto alterno. Así, en el peor caso, no se ve un ícono roto:
           se ve LIKIDA en versalitas espaciadas, que es el wordmark de todos
           modos. Nunca hay un estado feo. -->
      <tr><td align="left" style="padding:0 0 24px 2px;">
        <img src="cid:${LOGO_CID}" alt="LIKIDA" width="112" height="23"
          style="display:block;border:0;outline:none;text-decoration:none;height:23px;width:112px;font-family:${DISPLAY};font-size:15px;font-weight:600;letter-spacing:0.34em;color:${C.marca};">
      </td></tr>

      <tr><td bgcolor="${C.papel}" style="padding:34px 34px 32px 34px;border:1px solid ${C.linea};border-radius:14px;">
        ${rotulo}
        <h1 style="margin:0 0 16px 0;font-family:${DISPLAY};font-size:22px;line-height:29px;font-weight:600;letter-spacing:-0.015em;color:${C.tinta};">${esc(c.titulo)}</h1>
      ${parrafos}
      ${datos}
      ${boton}
      </td></tr>

      <tr><td align="left" style="padding:22px 4px 0 4px;">
        <p style="margin:0 0 5px 0;font-family:${SANS};font-size:11px;line-height:18px;color:${C.faint};">${esc(c.porQueLoRecibes)}</p>
        <p style="margin:0;font-family:${SANS};font-size:11px;line-height:18px;color:${C.faint};">
          <a href="${BASE}" style="color:${C.faint};text-decoration:none;">${esc(BASE.replace(/^https?:\/\//, ''))}</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
