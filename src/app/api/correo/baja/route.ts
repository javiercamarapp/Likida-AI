import { verificarBaja } from '@/lib/correo/baja';
import { suprimirCorreo } from '@/lib/likida/agentes/enviador';
import { esc } from '@/lib/correo/plantilla';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /api/correo/baja — la LIGA de un clic (LFPDPPP art. 16 fr. II + `List-
// Unsubscribe` de un clic para remitente masivo). La firma cola.ts, la
// procesa aquí.
//
// GET NO SUPRIME NADA — muestra una tarjeta de confirmación. Esta casa ya
// aprendió esa lección con los códigos de un solo uso (ver el comentario de
// `plantilla.ts` sobre Defender/Proofpoint): un escáner corporativo VISITA
// los enlaces de un correo antes de que la persona lo abra, y si el GET diera
// de baja de una vez, ese escaneo —no el destinatario— sería quien pide la
// baja. La mutación real solo ocurre en POST.
//
// ESE MISMO POST es el que RFC 8058 exige para el botón nativo "Cancelar
// suscripción" de Gmail/Yahoo/Outlook (cabecera `List-Unsubscribe-Post`,
// ver `enviar.ts`): esos clientes llaman a esta URL exacta por POST sin
// pasar por la tarjeta — el cuerpo que mandan (`List-Unsubscribe=One-Click`)
// no importa, el correo y el token viajan en la URL que YA firmó cola.ts.
// La tarjeta de confirmación (GET) sirve a quien no tiene ese botón: abre el
// enlace en el navegador y confirma con un clic ahí.
// ═══════════════════════════════════════════════════════════════════════════

function pagina(titulo: string, cuerpo: string): Response {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · Likida</title>
</head>
<body style="margin:0;padding:0;background:#f9f9fa;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:56px 16px;">
<table role="presentation" width="440" style="max-width:100%;background:#fff;border:1px solid #ececef;border-radius:16px;padding:36px;">
<tr><td>
<p style="margin:0 0 18px 0;font-size:11px;font-weight:600;letter-spacing:0.2em;color:#6b7280;">LIKIDA</p>
<h1 style="margin:0 0 14px 0;font-size:21px;color:#17100d;">${esc(titulo)}</h1>
<div style="font-size:14px;line-height:22px;color:#3f3f46;">${cuerpo}</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function paginaError(status: number, mensaje: string): Response {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Enlace no válido · Likida</title></head>` +
    `<body style="font-family:sans-serif;padding:48px;color:#3f3f46;"><p>${esc(mensaje)}</p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function leerParametros(req: Request): { correo: string | null; token: string | null } {
  const url = new URL(req.url);
  return { correo: url.searchParams.get('e'), token: url.searchParams.get('t') };
}

/** GET — la tarjeta de confirmación. No suprime nada (ver cabecera del
 *  archivo): un escáner de correo corporativo que prefetchea el enlace no
 *  puede dar de baja a nadie por sí solo. */
export async function GET(req: Request) {
  const { correo, token } = leerParametros(req);
  if (!correo || !token || !verificarBaja(correo, token)) {
    return paginaError(400, 'Este enlace de baja no es válido o ya expiró. Si quieres dejar de recibir correos, responde a cualquiera de ellos con la palabra BAJA.');
  }
  return pagina('¿Ya no quieres recibir estos correos?', `
    <p style="margin:0 0 22px 0;">Un clic y dejamos de escribirte.</p>
    <form method="POST" action="${esc(req.url)}">
      <button type="submit" style="appearance:none;border:0;border-radius:999px;background:#18181b;color:#fff;font-size:14px;font-weight:600;padding:13px 26px;cursor:pointer;">Sí, darme de baja</button>
    </form>`);
}

/** POST — la única vía que de verdad suprime. La llama el botón nativo de
 *  Gmail/Yahoo (RFC 8058, sin visitar la página) y el formulario de la
 *  tarjeta de arriba (un humano que confirmó). */
export async function POST(req: Request) {
  const { correo, token } = leerParametros(req);
  if (!correo || !token || !verificarBaja(correo, token)) {
    return paginaError(400, 'Este enlace de baja no es válido.');
  }
  try {
    await suprimirCorreo(correo, 'baja solicitada por liga de correo (un clic)');
  } catch (e) {
    // `suprimirCorreo` ya atrapa y registra sus propios errores (best-effort,
    // nunca lanza) — este catch es una segunda red por si acaso, no la
    // primera. Un 500 aquí haría que Gmail reintente el one-click, que es lo
    // correcto ante una duda real de si la baja se guardó.
    logger.error('correo.baja.fallo_inesperado', { err: e instanceof Error ? e.message : String(e) });
    return paginaError(500, 'No se pudo procesar la baja. Vuelve a intentar en un momento.');
  }
  logger.info('correo.baja.procesada', {});
  return pagina('Listo', '<p style="margin:0;">No volverás a recibir estos correos de Likida.</p>');
}
