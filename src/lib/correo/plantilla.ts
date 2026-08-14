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
// EL LOGO. Va arriba a la izquierda, como pidió Javier y como lo hace cualquier
// correo enterprise. Dos decisiones que no son estéticas:
//
//   1. Va sobre una banda de fondo CLARO EXPLÍCITO. El PNG de la marca es negro
//      sobre transparente, y en un cliente con tema oscuro un logo negro sobre
//      fondo transparente desaparece. La banda garantiza contraste siempre.
//   2. Lleva `alt="Likida"` y ancho/alto en atributos HTML además del estilo.
//      Con las imágenes bloqueadas —el estado por defecto en Outlook
//      corporativo— el lector ve la palabra "Likida" y el hueco conserva su
//      tamaño, en vez de un renglón roto.
//
// PIE OBLIGATORIO. Todo correo transaccional lleva por qué le llegó y cómo
// dejar de recibirlo. No es cortesía: es lo que separa un correo transaccional
// de uno que los filtros tratan como marketing.
// ═══════════════════════════════════════════════════════════════════════════

/** La URL pública de la app. El logo se sirve de ahí — un correo no puede
 *  llevar rutas relativas. */
const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://app.likida.ai';

/** Los tokens de `globals.css`, copiados como literales porque un correo no
 *  entiende `var()`. Si la marca cambia, se cambia AQUÍ además de allá. */
const C = {
  marca: '#c2410c',      // --marca
  tinta: '#1c1917',      // el texto principal
  muted: '#57534e',      // --muted
  faint: '#78716c',      // --faint
  linea: '#e7e5e4',      // --line
  lienzo: '#fafaf9',     // el fondo del correo
  papel: '#ffffff',      // la tarjeta
  bad: '#b91c1c',
  warn: '#b45309',
  ok: '#15803d',
} as const;

export type TonoCorreo = 'neutral' | 'atencion' | 'urgente';

const TONO: Record<TonoCorreo, string> = {
  neutral: C.marca,
  atencion: C.warn,
  urgente: C.bad,
};

export interface Boton { texto: string; href: string }

export interface Correo {
  /** Lo que va en la barra del cliente de correo. */
  asunto: string;
  /** El renglón bajo el asunto en la bandeja (preheader). Si no se pone, Gmail
   *  toma la primera línea del cuerpo, que suele ser el texto del logo. */
  avance: string;
  titulo: string;
  /** Párrafos del cuerpo. Se escapan: pueden traer nombres de operador o folios
   *  que vienen de la base. */
  parrafos: string[];
  /** Renglones de datos (etiqueta → valor). Opcional. */
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
  const lineas = [c.titulo, '', ...c.parrafos];
  if (c.datos?.length) {
    lineas.push('');
    for (const [k, v] of c.datos) lineas.push(`${k}: ${v}`);
  }
  if (c.boton) lineas.push('', `${c.boton.texto}: ${c.boton.href}`);
  lineas.push('', '—', c.porQueLoRecibes, `Likida · ${BASE}`);
  return lineas.join('\n');
}

export function armarHtml(c: Correo): string {
  const acento = TONO[c.tono ?? 'neutral'];

  const datos = c.datos?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 4px 0;border-collapse:collapse;">
${c.datos.map(([k, v], i) => `        <tr>
          <td style="padding:9px 0;${i === 0 ? '' : `border-top:1px solid ${C.linea};`}font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:${C.muted};">${esc(k)}</td>
          <td align="right" style="padding:9px 0;${i === 0 ? '' : `border-top:1px solid ${C.linea};`}font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:${C.tinta};font-weight:600;">${esc(v)}</td>
        </tr>`).join('\n')}
      </table>`
    : '';

  const boton = c.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px 0;">
        <tr><td bgcolor="${acento}" style="border-radius:8px;">
          <a href="${hrefSeguro(c.boton.href)}" style="display:inline-block;padding:11px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(c.boton.texto)}</a>
        </td></tr>
      </table>`
    : '';

  const parrafos = c.parrafos
    .map((p) => `<p style="margin:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:${C.muted};">${esc(p)}</p>`)
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
  <tr><td align="center" style="padding:28px 12px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;border-collapse:collapse;">

      <!-- BANDA DEL LOGO — arriba a la IZQUIERDA, sobre fondo claro explícito
           para que el PNG negro no desaparezca en un cliente con tema oscuro. -->
      <tr><td align="left" bgcolor="${C.papel}" style="padding:20px 28px;border:1px solid ${C.linea};border-bottom:none;border-radius:12px 12px 0 0;">
        <img src="${BASE}/images/logo.png" alt="Likida" width="104" height="21" style="display:block;border:0;outline:none;text-decoration:none;height:21px;width:104px;">
      </td></tr>

      <!-- Filo de color: el único acento de marca del correo. -->
      <tr><td bgcolor="${acento}" style="height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>

      <tr><td bgcolor="${C.papel}" style="padding:28px;border:1px solid ${C.linea};border-top:none;border-radius:0 0 12px 12px;">
        <h1 style="margin:0 0 14px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:19px;line-height:26px;font-weight:600;color:${C.tinta};">${esc(c.titulo)}</h1>
      ${parrafos}
      ${datos}
      ${boton}
      </td></tr>

      <tr><td align="left" style="padding:18px 28px 0 28px;">
        <p style="margin:0 0 6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;line-height:17px;color:${C.faint};">${esc(c.porQueLoRecibes)}</p>
        <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;line-height:17px;color:${C.faint};">
          Likida · <a href="${BASE}" style="color:${C.faint};text-decoration:underline;">${esc(BASE.replace(/^https?:\/\//, ''))}</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
