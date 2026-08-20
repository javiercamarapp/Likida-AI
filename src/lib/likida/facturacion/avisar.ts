import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendText, sendTemplate, motivoDeFalloWhatsApp } from '@/lib/meta/client';
import { logger } from '@/lib/logger';
import { getPorFacturar, type TicketPorFacturar } from './pendientes';
import { enrutar, mensajeParaEncargado, repartir } from './enrutar';
import { PORTALES_CONOCIDOS } from './adaptadores/registro';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO POR WHATSAPP DE LO QUE HAY QUE FACTURAR.
//
// Cierra el camino que empieza en el OCR: se leyó la liga del ticket, se
// reconoció el portal, se calculó el plazo, y ahora sale por el mismo canal por
// el que entró la foto.
//
// ── SE AVISA POR LOTE, NO POR TICKET ─────────────────────────────────────
//
// Un viaje de 22 comprobantes generaría 21 mensajes. Nadie lee 21 mensajes, y
// WhatsApp cobra cada plantilla. Va UNO por flota con lo que urge, ordenado por
// plazo. El encargado abre el teléfono una vez y ve toda su tarea.
//
// ── QUÉ SE AVISA Y QUÉ NO ────────────────────────────────────────────────
//
// Solo lo que la persona puede resolver: los que piden cuenta (tiene la sesión)
// y los que urgen. Lo que la máquina puede hacer sola no se le manda — avisarle
// de algo que ya se está haciendo entrena a ignorar el aviso.
//
// Y lo VENCIDO no va: ya no se puede facturar. Se ve en la pantalla, con su
// monto perdido, pero no se le manda a alguien a intentar lo imposible.
// ═══════════════════════════════════════════════════════════════════════════

/** Plantilla de Meta para el aviso de plazo. Tiene que estar aprobada. */
const PLANTILLA_PLAZO = 'plazo_factura';

export interface ResultadoAviso {
  enviado: boolean;
  /** A cuántos tickets se refiere el aviso. */
  tickets: number;
  /** Por qué no salió, en palabras que digan qué arreglar. */
  motivo?: string;
  /** El texto que se armó, para poder enseñarlo aunque el envío falle. */
  texto: string;
  /**
   * Por cuál de los dos caminos salió. `texto` es el bueno —lleva la liga, los
   * campos y el plazo—; `plantilla` es el plan B y solo dice el conteo, así que
   * quien lea `via: 'plantilla'` sabe que el encargado NO tiene el detalle en
   * el teléfono y lo va a buscar en el panel.
   */
  via?: 'texto' | 'plantilla';
}

/**
 * Arma el aviso de una flota: qué falta por facturar y qué urge.
 *
 * NO MANDA NADA si no hay nada que la persona pueda hacer. Un aviso vacío —"no
 * tienes pendientes"— gasta una plantilla de pago y enseña a ignorar el canal.
 */
/**
 * `sabeOperarlo` sale de `PORTALES_CONOCIDOS`, que es «qué sé hacer» y no «qué
 * puedo hacer ahora con la flota cargada» (eso es `portalesAutomatizados`). La
 * distinción importa aquí: al encargado hay que avisarle de un portal sin
 * adaptador ESCRITO —eso no se va a arreglar solo—, no de uno que simplemente
 * no está registrado en esta invocación.
 */
export function armarAviso(
  tickets: TicketPorFacturar[],
  sabeOperarlo: (clave: string) => boolean = (c) => PORTALES_CONOCIDOS.includes(c),
): { texto: string; cuantos: number } {
  const { mensajes, incompletos } = repartir(tickets, sabeOperarlo);

  // Los que necesitan a una persona: los de cuenta, y los incompletos que aún
  // no vencen (esos sí se pueden salvar buscando el dato en el papel).
  const paraPersona = [
    ...mensajes.map((x) => x.t),
    ...incompletos.filter((x) => !x.t.caducidad.vencido && !x.t.caducidad.desconocido).map((x) => x.t),
  ];

  if (paraPersona.length === 0) return { texto: '', cuantos: 0 };

  // Lo que vence primero, arriba. Es lo único con remedio.
  const orden = [...paraPersona].sort((a, b) => a.caducidad.diasRestantes - b.caducidad.diasRestantes);

  const urgentes = orden.filter((t) => t.caducidad.urgente);
  const lineas: string[] = [];

  lineas.push(
    urgentes.length > 0
      ? `Tienes ${orden.length} comprobante(s) sin factura, y ${urgentes.length} vence(n) en 2 días o menos.`
      : `Tienes ${orden.length} comprobante(s) sin factura.`,
  );
  lineas.push('');

  // Máximo 6 en el cuerpo: lo que cabe en una pantalla de teléfono. El resto se
  // cuenta al final — decir "y 14 más" es honesto; listar 20 hace que no se lea
  // ninguno.
  for (const t of orden.slice(0, 6)) {
    const r = enrutar(t, t.comercio ? sabeOperarlo(t.comercio.clave) : false);
    if (r.via === 'mensaje') {
      lineas.push(mensajeParaEncargado(t, r));
    } else {
      const falta = r.via === 'incompleto' ? r.falta.join('; ') : '';
      const dias = t.caducidad.urgente
        ? (t.caducidad.diasRestantes === 0 ? '⚠️ VENCE HOY' : `⚠️ ${t.caducidad.diasRestantes} día(s)`)
        : `${t.caducidad.diasRestantes} días`;
      lineas.push(`${t.concepto} — ${dias}${falta ? ` · falta: ${falta}` : ''}`);
    }
    lineas.push('');
  }

  if (orden.length > 6) lineas.push(`…y ${orden.length - 6} más en el panel.`);

  return { texto: lineas.join('\n').trim(), cuantos: orden.length };
}

/**
 * Manda el aviso al encargado de una flota.
 *
 * PRIMERO EL TEXTO COMPLETO, y la plantilla solo de respaldo. Dentro de la
 * ventana de 24 h WhatsApp entrega texto libre, y ese texto lleva lo que el
 * encargado necesita para facturar desde el teléfono: la liga, los campos y el
 * plazo. Fuera de la ventana Meta lo rechaza y entra `sendTemplate` con la
 * plantilla aprobada — que solo puede decir el conteo. Si la plantilla tampoco
 * sale, se DICE: un aviso que falla en silencio deja al encargado sin saber
 * que tiene tickets venciéndose.
 */
export async function avisarPorFacturar(args: {
  tenantId: string;
  /** Teléfono del encargado. Sin él no hay a quién escribirle. */
  telefono: string;
  hoy?: string;
}): Promise<ResultadoAviso> {
  const tickets = await getPorFacturar(args.tenantId, args.hoy);
  const { texto, cuantos } = armarAviso(tickets);

  if (cuantos === 0) {
    return { enviado: false, tickets: 0, texto: '', motivo: 'No hay nada que una persona tenga que facturar.' };
  }
  if (!args.telefono) {
    return { enviado: false, tickets: cuantos, texto, motivo: 'Esa flota no tiene un teléfono de encargado registrado.' };
  }

  // ── EL TEXTO BUENO PRIMERO, LA PLANTILLA DESPUÉS ─────────────────────────
  //
  // `armarAviso` construye el mensaje completo —la liga del portal, el WebID y
  // cada campo que ese portal pide, el plazo— y hasta el 20-ago-2026 ese texto
  // SE TIRABA: lo único que salía era la plantilla con el conteo, y el
  // encargado recibía "tienes 3 comprobantes" sin la liga ni los datos que son
  // el punto del aviso. El mismo bug que `escalar_viaje.ts` ya pagó con
  // `armarAvisoJefe`: el texto que sí se escribió para esto, sin un llamador.
  //
  // El texto libre solo lo entrega WhatsApp dentro de la ventana de 24 h desde
  // el último mensaje del destinatario. Fuera de ella Meta lo rechaza (131047)
  // y ahí entra la plantilla, que es lo único que sí se entrega — dice el
  // conteo y deja el detalle en el panel. Por eso se intenta en este orden y
  // no al revés: el aviso rico cuando se puede, el pobre solo como respaldo.
  const wamidTexto = await sendText(args.telefono, texto);
  const via: 'texto' | 'plantilla' = wamidTexto ? 'texto' : 'plantilla';
  let wamid = wamidTexto;

  if (!wamid) {
    const r = await sendTemplate(args.telefono, PLANTILLA_PLAZO, {
      parametros: [String(cuantos)],
    });
    if (!r.ok) {
      logger.warn('facturacion.aviso_no_salio', { tenantId: args.tenantId, codigo: r.codigo });
      return { enviado: false, tickets: cuantos, texto, motivo: motivoDeFalloWhatsApp(r.error, r.codigo) };
    }
    wamid = r.id ?? null;
  }

  // Queda constancia de a quién se le avisó, de cuántos, y POR CUÁL camino: un
  // aviso por plantilla no llevó el detalle, y mañana eso explica por qué el
  // encargado preguntó "¿cuáles?" en vez de facturar.
  const { error } = await supabaseAdmin().from('bitacora_auditoria').insert({
    tenant_id: args.tenantId,
    accion: 'facturacion.aviso_enviado',
    entidad: 'gasto',
    entidad_id: args.tenantId,
    detalle: { tickets: cuantos, wamid, via },
  });
  if (error) logger.warn('facturacion.bitacora', { err: error.message });

  return { enviado: true, tickets: cuantos, texto, via };
}
