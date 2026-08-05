import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { sendText, sendDocument } from '@/lib/meta/client';
import { armarAvisoJefe, type ResumenLiquidacion, type DiferenciaResumen } from './cierre_aviso';
import { telefonoJefeDe } from './contactos';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LA OFICINA SE ENTERA CUANDO UN CHOFER CIERRA.
//
// `cierre_aviso.ts` decide QUÉ decir y es puro (30 pruebas, con un mapa
// exhaustivo de los 31 tipos de diferencia). Aquí va el resto: leer la
// liquidación recién cerrada, armar el resumen y mandarlo.
//
// ── POR QUÉ EL JEFE RECIBE EL PDF Y NO UN "ENTRA AL PANEL" ───────────────
//
// El PDF es el documento que va a archivar y que le va a dar a su contador. Si
// para tenerlo hay que entrar a una pantalla, la mitad de las veces no entra —
// y la liquidación existe pero nadie la mira. Mandarlo por el mismo canal por
// el que entró el trabajo es lo que cierra el circuito.
//
// ── NO SE LE AVISA DE TODO ───────────────────────────────────────────────
//
// `armarAvisoJefe` devuelve `requiereDecision`. Cuando es `false` —la
// liquidación cuadró y no hay nada que resolver— NO se manda mensaje de texto,
// solo el PDF. Avisarle con urgencia de algo que no la tiene es como se quema
// un canal: en dos semanas deja de abrir los mensajes, y el que sí importaba
// llega igual que los demás.
//
// ── FALLA HACIA ADELANTE, SIEMPRE ────────────────────────────────────────
//
// Todo esto corre DESPUÉS de que la liquidación quedó cerrada y el chofer ya
// tiene su PDF. Nada de aquí puede tumbar ese camino: un jefe sin teléfono
// registrado o un WhatsApp caído no pueden costar una liquidación.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoAvisoCierre {
  enviado: boolean;
  /** Por qué no salió, en palabras que digan qué arreglar. */
  motivo?: string;
}

/**
 * Arma el resumen desde la liquidación guardada.
 *
 * SE LEE DE LA BASE, no se recibe del que llama. Es a propósito: lo que se le
 * manda al jefe tiene que ser lo mismo que quedó asentado y lo mismo que dice
 * el PDF. Un resumen armado en memoria puede diverger de la fila por un bug de
 * orden, y entonces el jefe estaría leyendo una cifra que no existe en ningún
 * lado.
 */
export async function resumenDeCierre(tenantId: string, viajeId: string): Promise<ResumenLiquidacion | null> {
  const admin = supabaseAdmin();
  const [rLiq, rViaje] = await Promise.all([
    admin.from('liquidacion')
      .select('total_comprobado, total_anticipo, diferencia, diferencias')
      .eq('viaje_id', viajeId).eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('viaje')
      .select('folio, operador(nombre)')
      .eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle(),
  ]);

  // Fallar cerrado: sin esto, un error de lectura se leería como "no hay
  // liquidación" y el jefe simplemente no recibiría nada, sin que quede rastro.
  if (rLiq.error) throw new Error(`resumenDeCierre/liquidacion: ${rLiq.error.message}`);
  if (rViaje.error) throw new Error(`resumenDeCierre/viaje: ${rViaje.error.message}`);
  if (!rLiq.data || !rViaje.data) return null;

  const l = rLiq.data;
  const rel = rViaje.data.operador as { nombre?: string } | Array<{ nombre?: string }> | null;
  const nombre = Array.isArray(rel) ? rel[0]?.nombre : rel?.nombre;

  return {
    folio: (rViaje.data.folio as string) ?? 'sin folio',
    operador: nombre ?? 'Operador sin nombre',
    anticipo: Number(l.total_anticipo ?? 0),
    totalComprobado: Number(l.total_comprobado ?? 0),
    diferencia: Number(l.diferencia ?? 0),
    diferencias: (Array.isArray(l.diferencias) ? l.diferencias : []) as DiferenciaResumen[],
  };
}

/**
 * Le manda al jefe el cierre: el PDF siempre, el texto solo si hay que decidir.
 *
 * `urlPdf` viene firmada y de vida corta — se pasa desde el cierre en vez de
 * volver a firmarla aquí para no duplicar el criterio del TTL, que ya está
 * decidido en un solo lugar.
 */
export async function avisarCierreAlJefe(args: {
  tenantId: string;
  viajeId: string;
  urlPdf?: string | null;
}): Promise<ResultadoAvisoCierre> {
  const tel = await telefonoJefeDe(args.tenantId);
  if (!tel) {
    // ERROR y no WARN: esta flota no se va a enterar de NINGÚN cierre hasta que
    // alguien capture el teléfono, y no hay otro lugar donde se note.
    logger.error('cierre.sin_telefono_de_jefe', { tenantId: args.tenantId, viaje: args.viajeId });
    return { enviado: false, motivo: 'Esa flota no tiene un teléfono de oficina registrado.' };
  }

  const resumen = await resumenDeCierre(args.tenantId, args.viajeId);
  if (!resumen) return { enviado: false, motivo: 'No se encontró la liquidación cerrada.' };

  const { texto, requiereDecision } = armarAvisoJefe(resumen);

  if (requiereDecision) {
    const id = await sendText(tel, texto);
    if (!id) return { enviado: false, motivo: 'WhatsApp no aceptó el mensaje al jefe.' };
  }

  if (args.urlPdf) {
    // En su propio try: el texto ya salió, y perder el adjunto no debe borrar
    // el aviso que sí llegó.
    try {
      await sendDocument(tel, args.urlPdf, `liquidacion-${resumen.folio}.pdf`,
        `Liquidación de ${resumen.operador} — ${resumen.folio}`);
    } catch (e) {
      logger.warn('cierre.pdf_al_jefe_falló', { viaje: args.viajeId, err: e instanceof Error ? e.message : String(e) });
    }
  }

  logger.info('cierre.avisado_al_jefe', { viaje: args.viajeId, requiereDecision });
  return { enviado: true };
}
