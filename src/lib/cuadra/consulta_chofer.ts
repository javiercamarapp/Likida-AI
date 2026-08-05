import { supabaseAdmin } from '@/lib/supabase/admin';
import { mxn } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL CHOFER PREGUNTA A MEDIO VIAJE.
//
// Hoy el agente entiende fotos y "ya acabé". Si el chofer escribe "¿cuánto
// llevo?" o "¿me falta algo?", no hay respuesta — y ese chofer levanta el
// teléfono y le pregunta a la oficina, que es exactamente lo que el producto
// vende evitar.
//
// ── SIN MODELO, Y NO POR AHORRAR ─────────────────────────────────────────
//
// Contestar "llevas $8,400 de $10,600" no requiere razonar: requiere una
// consulta y una plantilla. Un modelo aquí costaría dinero, agregaría latencia
// y —lo peor— podría INVENTAR la cifra. En un producto cuya regla número uno es
// no inventar números, meter un modelo entre la base y el chofer es exponerse
// gratis.
//
// El reconocimiento va por expresión regular porque un chofer pregunta de cinco
// formas, no de mil. Lo que la regla no entienda cae al agente de siempre, que
// ya existe: esto es un ATAJO delante de él, no un reemplazo.
//
// ── POR QUÉ EL SALDO CORRIENTE CAMBIA EL PRODUCTO ────────────────────────
//
// Con el saldo a la mano, el chofer sabe que le falta comprobar MIENTRAS sigue
// en ruta y todavía trae los tickets en la guantera. Hoy se entera al cerrar,
// cuando ya no puede hacer nada y la conversación se vuelve un reclamo. Es la
// misma información un día antes, y cambia quién resuelve el problema.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoConsulta = 'saldo' | 'faltantes' | 'ultimo' | 'ayuda';

/**
 * ¿Qué está preguntando el chofer?
 *
 * Devuelve `null` cuando no es una consulta — y ese `null` importa tanto como
 * los aciertos: si esto se traga un mensaje que era otra cosa, el agente de
 * verdad nunca lo ve. Ante la duda, no se contesta aquí.
 */
export function interpretarPregunta(texto: string): TipoConsulta | null {
  const t = texto.trim().toLowerCase();
  if (!t || t.length > 120) return null;

  // "cuánto llevo", "cuanto va", "como voy", "cuánto he comprobado"
  if (/\b(cu[áa]nto|como|c[óo]mo)\b.*\b(llevo|voy|va|comprobado|gastado|abonado)\b/.test(t)) return 'saldo';
  if (/\bmi\s+saldo\b|\bsaldo\b/.test(t)) return 'saldo';

  // "me falta algo", "qué me falta", "falta algo"
  if (/\bfalta(n|rme)?\b|\bpendiente/.test(t)) return 'faltantes';

  // "qué recibiste", "cuál fue el último", "llegó mi ticket"
  if (/\b([úu]ltimo|recib(iste|ido)|lleg[óo])\b/.test(t)) return 'ultimo';

  if (/^\s*(ayuda|help|men[úu]|opciones|qu[ée] puedo)\b/.test(t)) return 'ayuda';
  return null;
}

export interface EstadoViaje {
  anticipo: number;
  comprobado: number;
  comprobantes: number;
  ultimoConcepto: string | null;
  ultimoMonto: number | null;
  /** Comprobantes que el motor mandó a revisar. */
  enRevision: number;
}

export async function estadoDelViaje(tenantId: string, viajeId: string): Promise<EstadoViaje | null> {
  const admin = supabaseAdmin();
  const [{ data: viaje }, { data: gastos }] = await Promise.all([
    admin.from('viaje').select('anticipo').eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle(),
    admin.from('gasto').select('concepto, monto, ocr_confianza, created_at')
      .eq('viaje_id', viajeId).eq('tenant_id', tenantId).order('created_at', { ascending: false }),
  ]);
  if (!viaje) return null;

  const lista = gastos ?? [];
  const comprobado = lista.reduce((s, g) => s + Number(g.monto ?? 0), 0);
  const ultimo = lista[0];

  return {
    anticipo: Number(viaje.anticipo ?? 0),
    comprobado,
    comprobantes: lista.length,
    ultimoConcepto: (ultimo?.concepto as string) ?? null,
    ultimoMonto: ultimo ? Number(ultimo.monto) : null,
    // Confianza baja = el motor lo va a mandar a revisión. Decírselo ahora le
    // da la oportunidad de reenviar la foto mientras sigue en ruta.
    enRevision: lista.filter((g) => g.ocr_confianza !== null && Number(g.ocr_confianza) < 0.7).length,
  };
}

/**
 * La respuesta, armada con datos y sin adornos.
 *
 * NUNCA se dice "vas bien" ni "todo en orden": eso es una interpretación, y la
 * hace el motor de cuadre con la política de la flota, no un mensaje de estado.
 * Aquí solo se reportan cifras que existen.
 */
export function armarRespuesta(tipo: TipoConsulta, e: EstadoViaje | null): string {
  if (!e) return 'Todavía no tienes un viaje abierto. En cuanto te asignen uno te aviso.';

  const falta = e.anticipo - e.comprobado;

  switch (tipo) {
    case 'saldo': {
      if (e.anticipo <= 0) {
        // Un anticipo en 0 puede ser "no le dieron nada" o "nadie lo capturó".
        // No se afirma ninguna de las dos: se dice lo que sí se sabe.
        return `Llevas ${e.comprobantes} comprobante(s) por ${mxn(e.comprobado)}. Este viaje no tiene anticipo registrado, así que no te puedo decir cuánto te falta.`;
      }
      const linea = falta > 0
        ? `Te faltan ${mxn(falta)} por comprobar.`
        : falta < 0
          ? `Comprobaste ${mxn(-falta)} más que el anticipo.`
          : 'Vas justo con el anticipo.';
      return `Llevas ${mxn(e.comprobado)} de ${mxn(e.anticipo)} — ${e.comprobantes} comprobante(s). ${linea}`;
    }

    case 'faltantes': {
      const partes: string[] = [];
      if (e.anticipo > 0 && falta > 0) partes.push(`Te faltan ${mxn(falta)} por comprobar.`);
      if (e.enRevision > 0) partes.push(`${e.enRevision} foto(s) se leyeron mal; si puedes, vuelve a mandarlas.`);
      if (partes.length === 0) return 'Por mi parte no falta nada. Cuando acabes, escribe que terminaste y cierro tu liquidación.';
      return partes.join(' ');
    }

    case 'ultimo':
      return e.ultimoConcepto
        ? `El último que recibí fue ${e.ultimoConcepto} por ${mxn(e.ultimoMonto ?? 0)}. Van ${e.comprobantes} en total.`
        : 'Todavía no me llega ningún comprobante de este viaje.';

    case 'ayuda':
      return 'Mándame la foto de cada ticket y te la voy acusando. Puedes preguntarme "¿cuánto llevo?" cuando quieras. Cuando acabes, escribe que terminaste y te mando tu liquidación en PDF.';
  }
}

/** El atajo completo: interpreta, consulta y contesta. `null` = no era consulta. */
export async function responderConsulta(
  texto: string,
  tenantId: string,
  viajeId: string | null,
): Promise<string | null> {
  const tipo = interpretarPregunta(texto);
  if (!tipo) return null;
  const estado = viajeId ? await estadoDelViaje(tenantId, viajeId) : null;
  return armarRespuesta(tipo, estado);
}
