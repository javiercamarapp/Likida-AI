import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { ConsultaFallida } from './conv';
import { esAfirmacion, esNegacion } from './intake/huerfanos';
import {
  interpretarPeticionViaje, resumenParaConfirmar, resolverOperadorPorNombre,
  OperadorNombreAmbiguo,
} from './crear_viaje_wa';
import { crearViaje } from './operacion';
import { puedeAsignar } from '@/lib/auth/permisos';
import { TZ_MX } from '@/lib/formato';
import type { RolOficina } from './contactos';

// ═══════════════════════════════════════════════════════════════════════════
// EL JEFE DESPACHA POR WHATSAPP (F4 del plan) — el cableado que
// crear_viaje_wa.ts esperaba desde que se escribió: parser puro → resumen →
// confirmación humana → crearViaje (que ya avisa al chofer solo).
//
// ── DÓNDE VIVE LA CONFIRMACIÓN PENDIENTE ───────────────────────────────────
// En `wa_conversacion.estado` de la fila de la OFICINA (tenant + teléfono;
// `operador_id` es nullable a propósito desde la 0001). No se usa
// `loadConversation`: su contrato descarta el estado cuando el viaje no
// coincide (`desdeFila`), y aquí el viaje AÚN NO EXISTE — ese descarte
// borraría la intención pendiente en cada mensaje. La fila de oficina jamás
// choca con la de un chofer: si el teléfono fuera de un operador,
// `resolveOperador` lo habría atrapado antes de llegar aquí.
//
// ── LA VIGENCIA ────────────────────────────────────────────────────────────
// Un "sí" suelto tres horas después de un resumen que ya nadie recuerda es
// EXACTAMENTE el falso positivo que el parser se cuida de no crear. La
// intención expira a los 30 minutos; después, el "sí" recibe el saludo de
// siempre y no crea nada.
// ═══════════════════════════════════════════════════════════════════════════

export interface CuentaDespacho {
  tenantId: string;
  rol: RolOficina;
}

interface PendienteViaje {
  operadorId: string;
  operadorNombre: string;
  origen: string | null;
  destino: string | null;
  anticipo: number | null;
  unidad: string | null;
  /** ISO de cuándo se propuso — la vigencia se mide contra esto. */
  en: string;
}

export const VIGENCIA_PENDIENTE_MS = 30 * 60_000;

async function cargarPendiente(tenantId: string, telefono: string, ahora: Date): Promise<PendienteViaje | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .select('estado')
    .eq('tenant_id', tenantId).eq('telefono', telefono)
    .maybeSingle(), 'despachoWa.cargarPendiente');
  if (error) {
    // Perder el estado cuesta re-preguntar; inventarlo costaría crear un
    // viaje que nadie confirmó. Se pierde.
    logger.warn('despacho_wa.pendiente_ilegible', { err: error.message });
    return null;
  }
  const p = (data?.estado as { viajePendiente?: PendienteViaje } | null)?.viajePendiente;
  if (!p || typeof p.operadorId !== 'string' || typeof p.en !== 'string') return null;
  if (ahora.getTime() - Date.parse(p.en) > VIGENCIA_PENDIENTE_MS) return null;
  return p;
}

async function guardarPendiente(tenantId: string, telefono: string, p: PendienteViaje | null): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .upsert({
      tenant_id: tenantId,
      operador_id: null,
      telefono,
      viaje_id: null,
      estado: p ? { viajePendiente: p } : {},
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,telefono' }), 'despachoWa.guardarPendiente');
  if (error) {
    // Si el pendiente no se pudo guardar, el "sí" que venga no va a
    // encontrar nada — el flujo re-pide en vez de crear a ciegas. Se grita
    // para el diagnóstico, no se detiene la respuesta.
    logger.error('despacho_wa.pendiente_sin_guardar', { err: error.message });
  }
}

/** El día de México — `fecha_inicio` del viaje despachado por WhatsApp. */
function hoyMx(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX }).format(ahora);
}

function resumenDePendiente(p: PendienteViaje): string {
  return resumenParaConfirmar({
    tipo: 'crear',
    operador: p.operadorNombre,
    origen: p.origen,
    destino: p.destino,
    anticipo: p.anticipo,
    unidad: p.unidad,
  });
}

/**
 * El turno de un mensaje de TEXTO de la oficina. Devuelve la respuesta a
 * mandar, o `null` si el mensaje no es de despacho (el processor cae a su
 * saludo de siempre).
 *
 * Quien llama YA verificó que el remitente es cuenta de oficina; aquí se
 * re-verifica el ROL antes de escribir nada (`puedeAsignar`): el contador ve
 * liquidaciones, no manda choferes a carretera.
 */
export async function atenderDespachoOficina(
  cuenta: CuentaDespacho,
  telefono: string,
  texto: string,
  ahora: Date = new Date(),
): Promise<string | null> {
  if (!texto?.trim() || !cuenta.tenantId) return null;

  const pendiente = await cargarPendiente(cuenta.tenantId, telefono, ahora);

  if (pendiente) {
    if (esAfirmacion(texto)) {
      if (!puedeAsignar(cuenta.rol)) {
        await guardarPendiente(cuenta.tenantId, telefono, null);
        return 'Tu rol no asigna viajes — eso le toca al dueño o al jefe de tráfico.';
      }
      try {
        await crearViaje(cuenta.tenantId, {
          operadorId: pendiente.operadorId,
          origen: pendiente.origen ?? undefined,
          destino: pendiente.destino ?? undefined,
          anticipo: pendiente.anticipo ?? undefined,
          fechaInicio: hoyMx(ahora),
        });
        await guardarPendiente(cuenta.tenantId, telefono, null);
        const ruta = pendiente.origen && pendiente.destino
          ? `${pendiente.origen} → ${pendiente.destino}` : (pendiente.origen ?? pendiente.destino ?? 'sin ruta');
        return [
          `Viaje creado ✅ ${pendiente.operadorNombre} · ${ruta}.`,
          'El aviso a su WhatsApp va en camino — en Despacho ves si ya aceptó.',
          ...(pendiente.unidad
            ? [`(La unidad «${pendiente.unidad}» no la amarré: por aquí todavía no; se captura en el panel.)`]
            : []),
        ].join('\n');
      } catch (e) {
        // El pendiente SE CONSERVA: el jefe puede reintentar con otro "sí".
        logger.error('despacho_wa.crear_fallo', { tenant: cuenta.tenantId, err: e instanceof Error ? e.message : String(e) });
        return 'No se pudo crear el viaje ahorita. Vuelve a responder SÍ en un momento, o créalo desde Despacho.';
      }
    }

    if (esNegacion(texto)) {
      await guardarPendiente(cuenta.tenantId, telefono, null);
      return 'Listo, no creé nada. 👍';
    }

    // Ni sí ni no: si es una petición NUEVA reemplaza a la pendiente (cae al
    // flujo de abajo); cualquier otra cosa re-enseña lo que está en juego.
    if (!interpretarPeticionViaje(texto)) {
      return `Tengo este viaje esperando tu confirmación:\n\n${resumenDePendiente(pendiente)}`;
    }
  }

  const intencion = interpretarPeticionViaje(texto);
  if (!intencion) return null;

  if (!puedeAsignar(cuenta.rol)) {
    return 'Ese despacho no lo puedo hacer con tu rol — los viajes los asigna el dueño o el jefe de tráfico.';
  }

  if (intencion.tipo === 'incompleto') return resumenParaConfirmar(intencion);

  let candidato;
  try {
    candidato = await resolverOperadorPorNombre(cuenta.tenantId, intencion.operador);
  } catch (e) {
    if (e instanceof OperadorNombreAmbiguo) {
      const nombres = e.candidatos.map((c) => `• ${c.nombre}`).join('\n');
      return `«${intencion.operador}» me da ${e.candidatos.length} choferes:\n${nombres}\n\nEscríbeme el nombre completo y lo armamos.`;
    }
    if (e instanceof ConsultaFallida) {
      return 'No pude consultar a los operadores ahorita — inténtalo de nuevo en un momento.';
    }
    throw e;
  }

  if (!candidato) {
    return `No tengo un operador activo que se llame «${intencion.operador}». Revisa el nombre, o dalo de alta en Despacho.`;
  }

  await guardarPendiente(cuenta.tenantId, telefono, {
    operadorId: candidato.operadorId,
    operadorNombre: candidato.nombre,
    origen: intencion.origen,
    destino: intencion.destino,
    anticipo: intencion.anticipo,
    unidad: intencion.unidad,
    en: ahora.toISOString(),
  });

  // El resumen enseña el nombre RESUELTO de la base, no el texto del jefe:
  // lo que va a confirmar es a quién le llega el aviso de verdad.
  return resumenParaConfirmar({ ...intencion, operador: candidato.nombre });
}
