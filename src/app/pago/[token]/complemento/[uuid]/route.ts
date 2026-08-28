import { rateLimit, clientIp } from '@/lib/ratelimit';
import { TEXTO_LIGA_NO_VALIDA } from '@/lib/likida/portal_pago';
import { resolverLiga, xmlDelRep, anotarAcceso } from '@/lib/likida/portal_pago_lectura';
import { sellarRepEntregado } from '@/lib/likida/portal_pago_escritura';

// ═══════════════════════════════════════════════════════════════════════════
// EL XML DE UN COMPLEMENTO DE PAGO — la descarga, y nada más.
//
// Vive aparte de la página porque un documento fiscal no tiene por qué viajar
// en cada render: la página solo pregunta SI existe, y esta ruta lo entrega.
//
// El token va en la ruta porque es un enlace que el navegador sigue (un `href`
// no manda cuerpo). Es el mismo token que ya abrió la página, así que no
// amplía nada: se resuelve otra vez, entero, contra la base — no se confía en
// que "venía de la página".
//
// ── POR QUÉ AHORA HAY UN SEGUNDO SEGMENTO, Y POR QUÉ NO ABRE NADA ────────
//
// AUDITORÍA 7, `c7-16`: una factura pagada en parcialidades tiene un REP por
// parcialidad, y esta ruta entregaba SOLO el más reciente. Los complementos 1 y
// 2 —los que el contador del cliente necesita para acreditar el IVA de esos
// meses— no tenían ninguna ruta que los sirviera, mientras la página afirmaba
// «Tu complemento de pago ya está listo», en singular.
//
// El folio va en el PATH y no en un `?uuid=`: el `searchParams` de esta ruta
// sigue sin existir, que es la forma en que este portal declara que no hay
// parámetros sueltos. Y el folio NO es una llave de alcance: `xmlDelRep` sigue
// filtrando por el `factura_id` y el `tenant_id` de la liga resuelta, así que
// un folio de otra flota —o de otra factura de la misma— no encuentra nada y
// contesta lo mismo que un folio inventado. Lo único que el segmento elige es
// CUÁL de los complementos de ESTA factura se baja.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ token: string; uuid: string }> }) {
  if (!(await rateLimit(`portal-pago-xml:${clientIp(req)}`, 30, 10 * 60_000))) {
    return new Response('Demasiadas peticiones. Espera unos minutos.', { status: 429 });
  }

  const { token, uuid } = await ctx.params;
  const resolucion = await resolverLiga(token);
  if (!resolucion.ok) {
    // 503 cuando no se pudo preguntar, 404 cuando el token no vale — la misma
    // distinción que hace la página, por la misma razón.
    return resolucion.motivo === 'no_disponible'
      ? new Response('No se pudo consultar. Vuelve a intentarlo en unos minutos.', { status: 503 })
      : new Response(TEXTO_LIGA_NO_VALIDA, { status: 404 });
  }
  const liga = resolucion.liga;

  const rep = await xmlDelRep(liga, uuid);
  if (!rep.ok) {
    // `c7-24`: «no se pudo preguntar» NO se contesta como «no hay». Antes los
    // dos casos salían por el mismo 404 diciendo «Todavía no hay un XML de
    // complemento para esta factura» — una afirmación de hecho FALSA cuando lo
    // que pasó fue un hipo de la base, y que manda al cliente a molestar a la
    // flota por un archivo que sí está ahí.
    if (rep.motivo === 'no_disponible') {
      return new Response('No se pudo consultar. Vuelve a intentarlo en unos minutos.', { status: 503 });
    }
    // Sin REP con ese folio, o con REP sin XML. No se inventa un archivo vacío:
    // eso le daría al cliente un documento que su contador no puede usar y que
    // parece el bueno.
    return new Response(
      'No hay un XML de complemento con ese folio en esta factura. Vuelve a la página del enlace: ahí está la lista de los que sí hay y en qué estado están.',
      { status: 404 },
    );
  }

  // Sellos tras el hecho: el archivo ya se va a entregar cuando esto corre. Se
  // sella EXACTAMENTE el complemento que se entrega, no todos los de la factura.
  await anotarAcceso(liga, 'rep_mostrado', { cfdiUuid: rep.uuid, via: 'xml' });
  await sellarRepEntregado(liga.tenantId, liga.facturaId, [rep.uuid]);

  return new Response(rep.xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // El nombre es el UUID, que es como el contador lo va a archivar. Ya
      // viene validado contra `rep_emitido_uuid_forma` (0228) y contra la
      // propia expresión de `xmlDelRep`: 36 caracteres hex y guiones, así que
      // no puede traer comillas ni saltos de línea que rompan esta cabecera.
      'Content-Disposition': `attachment; filename="${rep.uuid}.xml"`,
      // Un CFDI no se cachea en un proxy compartido.
      'Cache-Control': 'private, no-store',
    },
  });
}
