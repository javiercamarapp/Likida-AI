import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { strip_accents } from './cuadre/util';
import { esAfirmacion, esNegacion } from './intake/huerfanos';
import { ConsultaFallida, getOpenViaje } from './conv';
import {
  resolverOperadorPorNombre, resolverUnidadPorEconomico, OperadorNombreAmbiguo,
} from './crear_viaje_wa';
import { VIGENCIA_PENDIENTE_MS } from './despacho_wa';
import { asignarUnidad, avisarAlChofer } from './operacion';
import { reasignarOperador } from './repo';
import { violaIndice } from './pg_errores';
import { puedeAsignar } from '@/lib/auth/permisos';
import type { RolOficina } from './contactos';

// ═══════════════════════════════════════════════════════════════════════════
// EL JEFE ASIGNA POR WHATSAPP (F4): "asígnale la unidad 12 al viaje de Juan",
// "reasigna el VJ-2026-0847 a Pedro". El hermano de despacho_wa.ts, con su
// misma columna vertebral: parser cerrado → todo RESUELTO contra la base →
// resumen → SÍ/NO → el motor real (asignarUnidad / reasignarOperador).
//
// ── UN PENDIENTE A LA VEZ, Y QUIÉN VA PRIMERO ──────────────────────────────
// El estado vive en la MISMA fila de oficina de `wa_conversacion` que usa
// despacho_wa, bajo su propia llave (`asignacionPendiente`). Guardar un
// pendiente REEMPLAZA al que hubiera (de cualquiera de los dos módulos): la
// última propuesta es la que espera confirmación, igual que dentro del
// propio despacho. Y el ORDEN del processor decide los empates: despacho
// corre primero, así que mientras haya un viaje esperando SÍ/NO, ese "sí"
// es del viaje — este módulo ni se entera. Es el mismo trato que despacho
// se da a sí mismo, y evita el peor error posible aquí: aplicar un "sí" a
// una pregunta distinta de la que el jefe está viendo.
//
// ── EL CLAIM, IGUAL QUE BE-A2 ──────────────────────────────────────────────
// Dos "sí" en la misma ventana no pueden ejecutar dos veces: el claim es un
// UPDATE condicional sobre `estado->asignacionPendiente` — leer-y-borrar en
// un statement, gana exactamente uno.
//
// ── LA FUSIÓN, NO EL REEMPLAZO (auditoría 2, ronda 2) ───────────────────────
// "Guardar un pendiente REEMPLAZA al que hubiera" (arriba) es correcto ENTRE
// `viajePendiente` y `asignacionPendiente` —un solo pendiente a la vez, por
// diseño—. El bug real era que ese reemplazo se hacía escribiendo `estado`
// ENTERO, así que también se llevaba lo que NO le tocaba: los `turns` que
// `conv.ts::saveConversation` puso para el chofer, cuando el mismo teléfono
// es oficina Y chofer (dueño-que-maneja, ver `contactos.ts`). Ahora cada
// escritor LEE la fila y fusiona SOLO su llave — este módulo puede seguir
// reemplazando `viajePendiente` con su propio `asignacionPendiente` (ES la
// regla de arriba), pero ya no toca `turns` ni marcas ajenas.
//
// `viaje_id` NO lo toca este módulo: se omite del payload del `.upsert()`
// para que, en el `ON CONFLICT`, la columna quede intacta en vez de
// nulificarse — lo maneja `saveConversation`, no aquí.
//
// LA CARRERA QUE QUEDA es la misma que documenta `despacho_wa.ts`: el SELECT
// y el UPDATE/UPSERT no son un solo statement (eso exigiría un merge
// `estado || jsonb` vía RPC, fuera de alcance). Se acepta por la misma razón:
// ventana de milisegundos, exige el mismo teléfono en dos roles y dos
// mensajes casi simultáneos, y lo peor que se pierde es un turno o una marca
// — no un cobro ni una asignación duplicada. El claim de `reclamarPendiente`
// sigue siendo el UPDATE condicional atómico de siempre.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_LARGO = 160;

/** minúsculas y sin acentos; la puntuación se vuelve espacio para que
 *  "unidad 12, al viaje de Juan" no pegue la coma al número. */
function aplanar(texto: string): string {
  return strip_accents(texto.toLowerCase())
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')   // el guion se queda: es parte del folio
    .replace(/\s+/g, ' ')
    .trim();
}

/** A qué viaje se refiere el jefe: por folio o por el chofer que lo trae. */
type RefViaje = { por: 'folio'; folio: string } | { por: 'operador'; nombre: string };

export type IntencionAsignacion =
  | { tipo: 'unidad'; unidad: string; ref: RefViaje }
  | { tipo: 'chofer'; nuevoOperador: string; ref: RefViaje }
  | { tipo: 'incompleto' }
  | null;

/**
 * "el viaje de juan" / "vj-2026-0847" / "de juan" → la referencia. `null` si
 * no se entendió — el llamador pide el formato en vez de adivinar.
 *
 * La regla folio-contra-nombre es determinística: un token único CON dígitos
 * es folio; lo demás es un nombre. "VJ-2026-0847" y "12" son folios; "juan
 * carlos" es un chofer. Un folio de dos palabras no se reconoce a propósito:
 * mejor pedirlo con guiones que amarrar la unidad al viaje equivocado.
 */
function leerRefViaje(crudo: string): RefViaje | null {
  let t = crudo.trim();
  t = t.replace(/^(?:al|del|el|a la|a)\s+/, '').replace(/^viaje\s+/, '').replace(/^de\s+/, '').trim();
  if (!t) return null;
  const tokens = t.split(' ');
  if (tokens.length === 1 && /\d/.test(tokens[0]) && /^[a-z0-9-]+$/.test(tokens[0])) {
    return { por: 'folio', folio: tokens[0] };
  }
  // Un nombre no trae dígitos. Si los trae, no se sabe qué es: `null`.
  if (/\d/.test(t)) return null;
  return { por: 'operador', nombre: t };
}

/**
 * ¿Qué pidió el jefe? `null` = no era una asignación (sigue su camino).
 * `incompleto` = lo era y no se entendió — se contesta con el formato.
 */
export function interpretarAsignacion(texto: string): IntencionAsignacion {
  if (!texto?.trim() || texto.length > MAX_LARGO) return null;
  const t = aplanar(texto);

  // ── Unidad: "asignale la unidad 12 al viaje de juan" ─────────────────────
  const mUnidad = /^(?:asignale|asigna|ponle|pon)\s+la\s+unidad\s+([a-z0-9-]+)\s+(.+)$/.exec(t);
  if (mUnidad) {
    const ref = leerRefViaje(mUnidad[2]);
    return ref ? { tipo: 'unidad', unidad: mUnidad[1], ref } : { tipo: 'incompleto' };
  }

  // ── Chofer: "reasigna el viaje de juan a pedro" ──────────────────────────
  const mChofer = /^(?:reasigna(?:le)?|pasale|cambia(?:le)?\s+(?:el\s+)?(?:chofer|operador)(?:\s+(?:de|del|al))?)\s+(.+)$/.exec(t);
  if (mChofer) {
    const resto = mChofer[1];
    // El separador es el ÚLTIMO " a ": los nombres reales traen "de la",
    // "los", pero no un " a " suelto — y el greedy del split lo respeta.
    const corte = resto.lastIndexOf(' a ');
    if (corte < 0) return { tipo: 'incompleto' };
    const ref = leerRefViaje(resto.slice(0, corte));
    const nuevo = resto.slice(corte + 3).trim();
    if (!ref || !nuevo || /\d/.test(nuevo)) return { tipo: 'incompleto' };
    return { tipo: 'chofer', nuevoOperador: nuevo, ref };
  }

  // Verbo de asignación sin estructura reconocible → se pide el formato. El
  // gate es angosto para no robarle mensajes al saludo ni al agente.
  if (/^(?:asignale|asigna|ponle|reasigna|reasignale|pasale|cambiale)\b/.test(t)) return { tipo: 'incompleto' };
  return null;
}

const FORMATO =
  'Dímelo así:\n• «asígnale la unidad 12 al viaje de Juan»\n• «asígnale la unidad 12 al VJ-2026-0847»\n• «reasigna el viaje de Juan a Pedro»';

// ── El pendiente y su claim (patrón despacho_wa/BE-A2) ─────────────────────

interface AsignacionPendiente {
  accion: 'unidad' | 'chofer';
  viajeId: string;
  /** Lo que el resumen enseña del viaje: folio, o "el viaje de X". */
  viajeEtiqueta: string;
  unidadId?: string;
  unidadEco?: string;
  nuevoOperadorId?: string;
  nuevoOperadorNombre?: string;
  en: string;
}

async function cargarPendiente(tenantId: string, telefono: string, ahora: Date): Promise<AsignacionPendiente | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .select('estado')
    .eq('tenant_id', tenantId).eq('telefono', telefono)
    .maybeSingle(), 'asignarWa.cargarPendiente');
  if (error) {
    logger.warn('asignar_wa.pendiente_ilegible', { err: error.message });
    return null;   // perder el estado cuesta re-pedir; inventarlo ejecutaría sin confirmar
  }
  const p = (data?.estado as { asignacionPendiente?: AsignacionPendiente } | null)?.asignacionPendiente;
  if (!p || typeof p.viajeId !== 'string' || typeof p.en !== 'string') return null;
  if (ahora.getTime() - Date.parse(p.en) > VIGENCIA_PENDIENTE_MS) return null;
  return p;
}

async function guardarPendiente(tenantId: string, telefono: string, p: AsignacionPendiente | null): Promise<boolean> {
  // LEE-MODIFICA-ESCRIBE (ver el encabezado): se fusiona SOLO
  // `asignacionPendiente` sobre lo que ya haya en la fila. Un fallo de
  // lectura degrada al comportamiento previo (escribir solo la llave propia)
  // en vez de bloquear la asignación por un tropiezo transitorio.
  const { data: filaActual, error: errLectura } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .select('estado')
    .eq('tenant_id', tenantId).eq('telefono', telefono)
    .maybeSingle(), 'asignarWa.guardarPendiente.leer');
  if (errLectura) {
    logger.warn('asignar_wa.pendiente_fusion_ilegible', { err: errLectura.message });
  }
  const previo = (filaActual?.estado as Record<string, unknown> | null) ?? {};
  const fusionado: Record<string, unknown> = { ...previo };
  if (p) fusionado.asignacionPendiente = p; else delete fusionado.asignacionPendiente;

  // `viaje_id`/`operador_id` fuera del payload a propósito: en el
  // `ON CONFLICT` del `.upsert()`, una columna ausente queda intacta —no se
  // nulifica el `viaje_id` real de `saveConversation`.
  const { error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .upsert({
      tenant_id: tenantId,
      telefono,
      estado: fusionado,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,telefono' }), 'asignarWa.guardarPendiente');
  if (error) {
    logger.error('asignar_wa.pendiente_sin_guardar', { err: error.message });
    return false;
  }
  return true;
}

/**
 * Leer-y-borrar en un statement: gana exactamente un "sí". El `WHERE`
 * (`not('estado->asignacionPendiente', 'is', null)`) es lo que hace el claim
 * atómico, sin importar qué valor de `estado` se escriba — por eso se puede
 * leer la fila primero y quitar SOLO `asignacionPendiente` de lo que haya
 * (fusión, ronda 2) sin perder la garantía de "gana exactamente uno". Si la
 * lectura falla, se falla cerrado: el pendiente queda intacto.
 */
async function reclamarPendiente(tenantId: string, telefono: string): Promise<'reclamado' | 'ya_reclamado' | 'fallo'> {
  const { data: filaActual, error: errLectura } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .select('estado')
    .eq('tenant_id', tenantId).eq('telefono', telefono)
    .maybeSingle(), 'asignarWa.reclamarPendiente.leer');
  if (errLectura) {
    logger.error('asignar_wa.reclamo_lectura_fallo', { err: errLectura.message });
    return 'fallo';
  }
  const sinPendiente: Record<string, unknown> = { ...((filaActual?.estado as Record<string, unknown> | null) ?? {}) };
  delete sinPendiente.asignacionPendiente;

  const { data, error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .update({ estado: sinPendiente, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('telefono', telefono)
    .not('estado->asignacionPendiente', 'is', null)
    .select('telefono'), 'asignarWa.reclamarPendiente');
  if (error) {
    logger.error('asignar_wa.reclamo_fallo', { err: error.message });
    return 'fallo';
  }
  return (data?.length ?? 0) > 0 ? 'reclamado' : 'ya_reclamado';
}

function resumenDePendiente(p: AsignacionPendiente): string {
  return p.accion === 'unidad'
    ? `Vas a asignar la unidad *${p.unidadEco}* a ${p.viajeEtiqueta}.\n\nResponde *SÍ* para asignarla o *NO* para cancelar.`
    : `Vas a reasignar ${p.viajeEtiqueta} a *${p.nuevoOperadorNombre}*.\n\nResponde *SÍ* para reasignarlo o *NO* para cancelar.`;
}

// ── La resolución contra la base, ANTES del resumen ────────────────────────

/** El viaje referido, resuelto y CON SU ETIQUETA verdadera. Lanza
 *  ConsultaFallida si la base no contesta; devuelve string (mensaje) cuando
 *  la referencia no da un viaje — el texto ya explica por qué. */
async function resolverViaje(tenantId: string, ref: RefViaje): Promise<{ viajeId: string; etiqueta: string } | string> {
  if (ref.por === 'folio') {
    const { data, error } = await acotada(supabaseAdmin()
      .from('viaje')
      .select('id, folio')
      .eq('tenant_id', tenantId)
      .in('estatus', ['abierto', 'en_cuadre'])
      .ilike('folio', ref.folio)
      .limit(2), 'asignarWa.viajePorFolio');
    if (error) throw new ConsultaFallida(`viaje por folio: ${error.message}`);
    const filas = data ?? [];
    if (filas.length === 0) return `No encontré un viaje abierto con folio «${ref.folio}» en tu flota.`;
    // Con la 0092 el folio es único por tenant; dos filas serían datos por
    // arreglar, no una elección que este módulo pueda hacer.
    if (filas.length > 1) return `El folio «${ref.folio}» me da más de un viaje — revísalo en Despacho.`;
    return { viajeId: filas[0].id as string, etiqueta: `el viaje *${filas[0].folio as string}*` };
  }

  const candidato = await resolverOperadorPorNombre(tenantId, ref.nombre);
  if (!candidato) return `No tengo un operador activo que se llame «${ref.nombre}». Revisa el nombre, o usa el folio del viaje.`;
  const viajeId = await getOpenViaje(tenantId, candidato.operadorId);
  if (!viajeId) return `«${candidato.nombre}» no trae un viaje abierto ahorita.`;
  return { viajeId, etiqueta: `el viaje de *${candidato.nombre}*` };
}

// ── El turno completo ──────────────────────────────────────────────────────

export interface CuentaAsigna {
  tenantId: string;
  rol: RolOficina;
}

/**
 * El turno de un mensaje de texto de la oficina que puede ser una asignación
 * (o el SÍ/NO de una propuesta). `null` = no es de este módulo.
 *
 * Corre DESPUÉS de despacho_wa a propósito (ver encabezado): si hay un viaje
 * esperando confirmación, ese módulo ya se quedó con el mensaje.
 */
export async function atenderAsignacionOficina(
  cuenta: CuentaAsigna,
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
        return 'Tu rol no asigna — eso le toca al dueño o al jefe de tráfico.';
      }
      const reclamo = await reclamarPendiente(cuenta.tenantId, telefono);
      if (reclamo === 'ya_reclamado') return 'Esa confirmación ya la estoy procesando — dame un momento.';
      if (reclamo === 'fallo') return 'No pude tomar tu confirmación — mándame el SÍ otra vez en un momento.';

      try {
        if (pendiente.accion === 'unidad') {
          await asignarUnidad(cuenta.tenantId, pendiente.viajeId, pendiente.unidadId!);
          return `Unidad *${pendiente.unidadEco}* asignada a ${pendiente.viajeEtiqueta} ✅.`;
        }
        await reasignarOperador(cuenta.tenantId, pendiente.viajeId, pendiente.nuevoOperadorId!);
        // El aviso al chofer NUEVO es best-effort: la reasignación YA quedó, y
        // el resultado del envío no se puede afirmar (avisarAlChofer no lo
        // devuelve) — por eso el texto promete el intento, no la entrega.
        let lineaAviso = `Le mando su aviso a ${pendiente.nuevoOperadorNombre} — confirma en Despacho que lo acepte.`;
        try {
          await avisarAlChofer(cuenta.tenantId, pendiente.nuevoOperadorId!, pendiente.viajeId);
        } catch (e) {
          logger.error('asignar_wa.aviso_fallo', { viaje: pendiente.viajeId, err: e instanceof Error ? e.message : String(e) });
          lineaAviso = `⚠️ El aviso a ${pendiente.nuevoOperadorNombre} NO salió — mándalo desde Despacho.`;
        }
        return `${pendiente.viajeEtiqueta.replace(/^el viaje/, 'El viaje')} quedó reasignado a *${pendiente.nuevoOperadorNombre}* ✅.\n${lineaAviso}`;
      } catch (e) {
        // El choque PERMANENTE del reasignar: el nuevo chofer ya trae un viaje
        // abierto (uq_viaje_abierto_por_operador). Reintentar no lo arregla y
        // el claim ya limpió el pendiente — se dice y se acaba.
        const chocaAbierto = violaIndice(e, 'uq_viaje_abierto_por_operador')
          || (e instanceof Error && e.message.includes('uq_viaje_abierto_por_operador'));
        if (chocaAbierto && pendiente.accion === 'chofer') {
          logger.info('asignar_wa.nuevo_con_viaje_abierto', { tenant: cuenta.tenantId, operador: pendiente.nuevoOperadorId });
          return `«${pendiente.nuevoOperadorNombre}» ya trae un viaje abierto — ciérralo primero o elige a otro chofer. No cambié nada.`;
        }
        // Lo transitorio: se DEVUELVE el pendiente para que el reintento con
        // otro "sí" encuentre algo (mismo trato que despacho_wa).
        logger.error('asignar_wa.ejecutar_fallo', { tenant: cuenta.tenantId, err: e instanceof Error ? e.message : String(e) });
        const restaurado = await guardarPendiente(cuenta.tenantId, telefono, pendiente);
        return restaurado
          ? 'No se pudo aplicar el cambio ahorita. Vuelve a responder SÍ en un momento, o hazlo desde Despacho.'
          : 'No se pudo aplicar el cambio y tampoco pude guardar tu confirmación para reintentar. Dímelo otra vez, o hazlo desde Despacho.';
      }
    }

    if (esNegacion(texto)) {
      await guardarPendiente(cuenta.tenantId, telefono, null);
      return 'Listo, no cambié nada. 👍';
    }

    // Ni sí ni no: una petición NUEVA (de asignación) reemplaza a la
    // pendiente; cualquier otra cosa re-enseña lo que está en juego.
    if (!interpretarAsignacion(texto)) {
      return `Tengo esta asignación esperando tu confirmación:\n\n${resumenDePendiente(pendiente)}`;
    }
  }

  const intencion = interpretarAsignacion(texto);
  if (!intencion) return null;

  if (!puedeAsignar(cuenta.rol)) {
    return 'Esa asignación no la puedo hacer con tu rol — los viajes los asigna el dueño o el jefe de tráfico.';
  }
  if (intencion.tipo === 'incompleto') return `No entendí bien la asignación. ${FORMATO}`;

  try {
    const viaje = await resolverViaje(cuenta.tenantId, intencion.ref);
    if (typeof viaje === 'string') return viaje;

    if (intencion.tipo === 'unidad') {
      const u = await resolverUnidadPorEconomico(cuenta.tenantId, intencion.unidad);
      if (!u) return `La unidad «${intencion.unidad}» no está dada de alta en tu flota. Revisa el número, o dala de alta en el panel.`;
      const p: AsignacionPendiente = {
        accion: 'unidad', viajeId: viaje.viajeId, viajeEtiqueta: viaje.etiqueta,
        unidadId: u.unidadId, unidadEco: u.numeroEconomico, en: ahora.toISOString(),
      };
      await guardarPendiente(cuenta.tenantId, telefono, p);
      return resumenDePendiente(p);
    }

    const nuevo = await resolverOperadorPorNombre(cuenta.tenantId, intencion.nuevoOperador);
    if (!nuevo) return `No tengo un operador activo que se llame «${intencion.nuevoOperador}». Revisa el nombre, o dalo de alta en Despacho.`;
    const p: AsignacionPendiente = {
      accion: 'chofer', viajeId: viaje.viajeId, viajeEtiqueta: viaje.etiqueta,
      nuevoOperadorId: nuevo.operadorId, nuevoOperadorNombre: nuevo.nombre, en: ahora.toISOString(),
    };
    await guardarPendiente(cuenta.tenantId, telefono, p);
    return resumenDePendiente(p);
  } catch (e) {
    if (e instanceof OperadorNombreAmbiguo) {
      const nombres = e.candidatos.map((c) => `• ${c.nombre}`).join('\n');
      return `Ese nombre me da ${e.candidatos.length} choferes:\n${nombres}\n\nEscríbeme el nombre completo y lo armamos.`;
    }
    if (e instanceof ConsultaFallida) {
      return 'No pude consultar la flota ahorita — inténtalo de nuevo en un momento.';
    }
    throw e;
  }
}
