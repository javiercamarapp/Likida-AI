import { rateLimit, clientIp } from '@/lib/ratelimit';
import { TEXTO_LIGA_NO_VALIDA } from '@/lib/likida/portal_pago';
import { resolverLiga, xmlDelRep, anotarAcceso } from '@/lib/likida/portal_pago_lectura';
import { sellarRepEntregado } from '@/lib/likida/portal_pago_escritura';

// ═══════════════════════════════════════════════════════════════════════════
// EL XML DEL COMPLEMENTO DE PAGO — la descarga, y nada más.
//
// Vive aparte de la página porque un documento fiscal no tiene por qué viajar
// en cada render: la página solo pregunta SI existe, y esta ruta lo entrega.
//
// El token va en la ruta porque es un enlace que el navegador sigue (un `href`
// no manda cuerpo). Es el mismo token que ya abrió la página, así que no
// amplía nada: se resuelve otra vez, entero, contra la base — no se confía en
// que "venía de la página".
//
// Y el alcance sigue siendo la factura de la liga: `xmlDelRep(liga)` filtra por
// su `factura_id` y su `tenant_id`. No hay parámetro que pida otro REP.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!(await rateLimit(`portal-pago-xml:${clientIp(req)}`, 30, 10 * 60_000))) {
    return new Response('Demasiadas peticiones. Espera unos minutos.', { status: 429 });
  }

  const { token } = await ctx.params;
  const resolucion = await resolverLiga(token);
  if (!resolucion.ok) {
    // 503 cuando no se pudo preguntar, 404 cuando el token no vale — la misma
    // distinción que hace la página, por la misma razón.
    return resolucion.motivo === 'no_disponible'
      ? new Response('No se pudo consultar. Vuelve a intentarlo en unos minutos.', { status: 503 })
      : new Response(TEXTO_LIGA_NO_VALIDA, { status: 404 });
  }
  const liga = resolucion.liga;

  const rep = await xmlDelRep(liga);
  if (!rep) {
    // Sin REP, o con REP sin XML. No se inventa un archivo vacío: eso le daría
    // al cliente un documento que su contador no puede usar y que parece el
    // bueno.
    return new Response(
      'Todavía no hay un XML de complemento para esta factura. Vuelve a la página del enlace: ahí dice en qué estado está.',
      { status: 404 },
    );
  }

  // Sellos tras el hecho: el archivo ya se va a entregar cuando esto corre.
  await anotarAcceso(liga, 'rep_mostrado', { cfdiUuid: rep.uuid, via: 'xml' });
  await sellarRepEntregado(liga.tenantId, liga.facturaId);

  return new Response(rep.xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // El nombre es el UUID, que es como el contador lo va a archivar. Ya
      // viene validado contra `rep_emitido_uuid_forma` (0228): 36 caracteres
      // hex y guiones, así que no puede traer comillas ni saltos de línea que
      // rompan esta cabecera.
      'Content-Disposition': `attachment; filename="${rep.uuid}.xml"`,
      // Un CFDI no se cachea en un proxy compartido.
      'Cache-Control': 'private, no-store',
    },
  });
}
