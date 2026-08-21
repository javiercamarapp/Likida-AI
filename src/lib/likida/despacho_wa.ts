import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { ConsultaFallida } from './conv';
import { esAfirmacion, esNegacion } from './intake/huerfanos';
import {
  interpretarPeticionViaje, resumenParaConfirmar, resolverOperadorPorNombre,
  resolverUnidadPorEconomico, OperadorNombreAmbiguo,
} from './crear_viaje_wa';
import { crearViaje } from './operacion';
import { violaIndice } from './pg_errores';
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
//
// ── LA FUSIÓN, NO EL REEMPLAZO (auditoría 2, ronda 2) ───────────────────────
// Esta fila la escriben TRES módulos bajo la MISMA llave única (tenant,
// teléfono): este archivo (`viajePendiente`), `asignar_wa.ts`
// (`asignacionPendiente`) y `conv.ts::saveConversation` (`turns` y sus
// marcas). Chocan cuando el mismo teléfono es OFICINA y CHOFER a la vez —el
// dueño-que-maneja que `contactos.ts` documenta como caso normal en una
// flota chica—, y antes cada uno REEMPLAZABA `estado` entero: un despacho
// pendiente armado un instante antes de que el chofer mandara "ya llegué" se
// comía sus `turns` y nulificaba el `viaje_id` que `saveConversation` acababa
// de poner.
//
// `incluirDespacho=!viajeId` (processor.ts) ya evita el peor caso —despachar
// mientras el chofer trae un viaje abierto—, así que lo que queda es más
// angosto: el dueño SIN viaje abierto que aun así trae una charla en curso
// (p. ej. "¿cuál viaje arrancas?" a medio responder). Esta ronda cierra eso:
// cada escritor LEE la fila, fusiona SOLO su propia llave sobre lo que haya, y
// escribe el objeto completo — nunca un objeto con una sola llave.
//
// `viaje_id` NO lo toca este módulo (se omite del payload a propósito): el
// que de verdad lo maneja es `saveConversation`, y con `.upsert()` una
// columna ausente del payload no entra al `SET` del `ON CONFLICT` —queda
// intacta—. Antes se mandaba `viaje_id: null` en cada escritura, y ESO era lo
// que nulificaba el viaje real del chofer.
//
// LA CARRERA QUE QUEDA: el SELECT de abajo y el UPDATE/UPSERT que le sigue no
// son un solo statement —un merge `estado || jsonb` de Postgres SÍ lo sería,
// pero exige una función (RPC) nueva, fuera del alcance de este fix—. Entre
// los dos, otro escritor puede meter su cambio y perderlo cuando este aterrice.
// Se acepta: hace falta el MISMO teléfono en dos roles Y dos mensajes casi
// simultáneos —una ventana de milisegundos—, y lo peor que pasa es perder un
// turno de charla o una marca de conteo (se re-pregunta), no un cobro ni un
// despacho duplicado. El claim de `reclamarPendiente` —que si tiene que ser
// atómico, porque decide si `crearViaje` corre una vez o dos— sigue siéndolo:
// ver su comentario.
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
  /** El número económico como está en la BASE cuando se amarró, o como lo
   *  tecleó el jefe cuando no. Es lo que el resumen enseña. */
  unidad: string | null;
  /** El id resuelto contra `unidad.numero_economico` AL ARMAR el pendiente.
   *  `null` = el jefe dictó una unidad que no está dada de alta (y el resumen
   *  ya se lo dijo); ausente en pendientes anteriores a este campo. */
  unidadId?: string | null;
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

/** `true` si la escritura quedó. Quien restaura un pendiente NECESITA saberlo. */
async function guardarPendiente(tenantId: string, telefono: string, p: PendienteViaje | null): Promise<boolean> {
  // LEE-MODIFICA-ESCRIBE (ver el encabezado del archivo): se trae lo que haya
  // en la fila y se fusiona SOLO `viajePendiente` encima — nunca se reemplaza
  // `estado` entero. Un fallo de lectura no bloquea el despacho por un
  // tropiezo transitorio: se degrada al comportamiento previo a esta ronda
  // (escribir solo la llave propia), y queda anotado para diagnóstico.
  const { data: filaActual, error: errLectura } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .select('estado')
    .eq('tenant_id', tenantId).eq('telefono', telefono)
    .maybeSingle(), 'despachoWa.guardarPendiente.leer');
  if (errLectura) {
    logger.warn('despacho_wa.pendiente_fusion_ilegible', { err: errLectura.message });
  }
  const previo = (filaActual?.estado as Record<string, unknown> | null) ?? {};
  const fusionado: Record<string, unknown> = { ...previo };
  if (p) fusionado.viajePendiente = p; else delete fusionado.viajePendiente;

  // `viaje_id` y `operador_id` NO van en el payload: con `.upsert()`, una
  // columna ausente no entra al `SET` del `ON CONFLICT` y queda intacta —eso
  // es lo que evita nulificar el `viaje_id` real que puso `saveConversation`.
  // En un INSERT (fila nueva) quedan en su default de columna (`null`), que
  // es el mismo valor que se mandaba antes explícito.
  const { error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .upsert({
      tenant_id: tenantId,
      telefono,
      estado: fusionado,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,telefono' }), 'despachoWa.guardarPendiente');
  if (error) {
    // Si el pendiente no se pudo guardar, el "sí" que venga no va a
    // encontrar nada — el flujo re-pide en vez de crear a ciegas. Se grita
    // para el diagnóstico, no se detiene la respuesta.
    logger.error('despacho_wa.pendiente_sin_guardar', { err: error.message });
    return false;
  }
  return true;
}

/**
 * EL CLAIM ATÓMICO DEL PENDIENTE (auditoría 3, BE-A2).
 *
 * Leer el pendiente y borrarlo eran DOS viajes a la base, y entre uno y otro
 * cabía el segundo "sí" del jefe: ambos leían el mismo pendiente y ambos
 * llegaban a `crearViaje`. Este UPDATE condicional es leer-y-borrar en UN solo
 * statement — la condición `estado->viajePendiente is not null` solo puede
 * cumplirse para uno, así que gana exactamente uno y el claim ES el borrado.
 *
 * FUSIÓN, RONDA 2: lo que hace el claim atómico es el `WHERE`
 * (`not('estado->viajePendiente', 'is', null)`) — eso es lo único que decide
 * quién gana, sin importar QUÉ valor de `estado` se escriba. Antes se
 * escribía `{}` a ciegas, y eso se llevaba `asignacionPendiente`/`turns`/
 * marcas si el mismo teléfono los traía puestos (dueño-que-maneja). Ahora se
 * lee la fila primero y se quita SOLO `viajePendiente` de lo que haya — el
 * `UPDATE` condicional de abajo sigue siendo el mismo statement atómico, nada
 * más cambia el valor que entra en su `SET`. Si la lectura falla, se falla
 * cerrado (sin ella no se sabe qué preservar): el pendiente queda intacto y
 * el jefe reintenta.
 */
async function reclamarPendiente(tenantId: string, telefono: string): Promise<'reclamado' | 'ya_reclamado' | 'fallo'> {
  const { data: filaActual, error: errLectura } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .select('estado')
    .eq('tenant_id', tenantId).eq('telefono', telefono)
    .maybeSingle(), 'despachoWa.reclamarPendiente.leer');
  if (errLectura) {
    logger.error('despacho_wa.reclamo_lectura_fallo', { err: errLectura.message });
    return 'fallo';
  }
  const sinPendiente: Record<string, unknown> = { ...((filaActual?.estado as Record<string, unknown> | null) ?? {}) };
  delete sinPendiente.viajePendiente;

  const { data, error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .update({ estado: sinPendiente, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('telefono', telefono)
    .not('estado->viajePendiente', 'is', null)
    .select('telefono'), 'despachoWa.reclamarPendiente');
  if (error) {
    logger.error('despacho_wa.reclamo_fallo', { err: error.message });
    return 'fallo';
  }
  return (data?.length ?? 0) > 0 ? 'reclamado' : 'ya_reclamado';
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

      // ── EL CLAIM VA ANTES DE crearViaje (auditoría 3, BE-A2) ─────────────
      // Dos "sí" en la misma ventana leían el MISMO pendiente y ambos
      // llegaban a crearViaje: el 0029 salvaba los datos rechazando al
      // segundo, pero la conversación mentía («todavía tiene un viaje
      // abierto» por un choque consigo mismo). Y el clear post-éxito que
      // fallaba solo se logueaba: quedaba un pendiente fantasma que
      // re-disparaba ese mismo choque con el siguiente "sí". Reclamando
      // ANTES, gana exactamente un "sí" y el borrado ya ocurrió.
      const reclamo = await reclamarPendiente(cuenta.tenantId, telefono);
      if (reclamo === 'ya_reclamado') {
        return 'Esa confirmación ya la estoy procesando — dame un momento.';
      }
      if (reclamo === 'fallo') {
        // Fallar cerrado: sin claim no hay crearViaje. El pendiente quedó
        // intacto, así que el reintento del jefe sí lo va a encontrar.
        return 'No pude tomar tu confirmación — mándame el SÍ otra vez en un momento.';
      }

      try {
        const viajeId = await crearViaje(cuenta.tenantId, {
          operadorId: pendiente.operadorId,
          origen: pendiente.origen ?? undefined,
          destino: pendiente.destino ?? undefined,
          anticipo: pendiente.anticipo ?? undefined,
          // Ya resuelta AL ARMAR el pendiente (contra `numero_economico`, de
          // esta flota) — `crearViaje` la re-verifica igual (`unidadPropia`).
          unidadId: pendiente.unidadId ?? undefined,
          fechaInicio: hoyMx(ahora),
        });
        // El pendiente ya lo limpió el claim — aquí no queda nada que borrar.

        // ¿EL AVISO SALIÓ DE VERDAD? (auditoría 3, AG-A4). `crearViaje`
        // espera a `avisarAlChofer` pero se TRAGA el resultado — "el aviso va
        // en camino" se afirmaba también cuando el envío ya había fallado o
        // ni se intentó (sin teléfono, plantilla pausada). Y ese viaje, con
        // `avisado_en` NULL, es invisible para la escalación de 5 h
        // (`viajesSinAceptar` filtra por el sello): el jefe cree que avisó,
        // el chofer nunca se entera, y nadie vigila. Para cuando crearViaje
        // devuelve, el sello ya está puesto o no — se LEE y se dice la
        // verdad; si la lectura falla, se dice que no se pudo verificar.
        // Nunca se afirma una entrega sin el dato.
        let lineaAviso = 'No pude verificar si el aviso salió — revísalo en Despacho.';
        const { data: sello, error: errSello } = await acotada(supabaseAdmin()
          .from('viaje')
          .select('avisado_en')
          .eq('id', viajeId).eq('tenant_id', cuenta.tenantId)
          .maybeSingle(), 'despachoWa.avisadoEn');
        if (errSello) {
          logger.warn('despacho_wa.aviso_ilegible', { viaje: viajeId, err: errSello.message });
        } else if (sello) {
          lineaAviso = (sello as { avisado_en?: string | null }).avisado_en
            ? 'El aviso ya salió a su WhatsApp — en Despacho ves si aceptó.'
            : '⚠️ El viaje quedó creado pero el aviso NO salió (revisa su teléfono); mándalo desde Despacho — sin aviso, la escalación de 5 h no lo vigila.';
        }

        const ruta = pendiente.origen && pendiente.destino
          ? `${pendiente.origen} → ${pendiente.destino}` : (pendiente.origen ?? pendiente.destino ?? 'sin ruta');
        // La unidad SE DICE con su resultado real: amarrada con su ✓, o la
        // verdad de que no está dada de alta — nunca un "va incluida" sin dato.
        const conUnidad = pendiente.unidadId && pendiente.unidad ? ` · unidad ${pendiente.unidad} ✓` : '';
        return [
          `Viaje creado ✅ ${pendiente.operadorNombre} · ${ruta}${conUnidad}.`,
          lineaAviso,
          ...(pendiente.unidad && !pendiente.unidadId
            ? [`La unidad «${pendiente.unidad}» no está dada de alta — el viaje quedó sin unidad; asígnala en Despacho.`]
            : []),
        ].join('\n');
      } catch (e) {
        // EL CHOQUE 0029 ES PERMANENTE, NO UN TROPIEZO (auditoría 3, AG-A3).
        // El estado NORMAL de un chofer entre liquidaciones es traer un viaje
        // abierto (los tiers de cobranza son 3/7/14 días), y el índice
        // `uq_viaje_abierto_por_operador` lo rechaza hoy y mañana igual —
        // "vuelve a responder SÍ en un momento" era una instrucción falsa que
        // armaba un bucle de reintentos durante los 30 min de vigencia.
        //
        // `crearViaje` (operacion.ts:570) envuelve el error de Postgres en un
        // Error plano: el `code` 23505 no sobrevive y `violaIndice` solo no
        // basta. Por eso además se busca el nombre del índice en el mensaje
        // envuelto — ese nombre solo puede venir del propio Postgres, así que
        // no reabre el falso positivo del que `violaIndice` se cuida.
        const chocaViajeAbierto = violaIndice(e, 'uq_viaje_abierto_por_operador')
          || (e instanceof Error && e.message.includes('uq_viaje_abierto_por_operador'));
        if (chocaViajeAbierto) {
          // El pendiente ya quedó limpio por el claim: otro "sí" no repite
          // el choque. No hay nada más que borrar aquí.
          logger.info('despacho_wa.operador_con_viaje_abierto', { tenant: cuenta.tenantId, operador: pendiente.operadorId });
          return `«${pendiente.operadorNombre}» todavía tiene un viaje abierto — ciérralo o despacha a otro operador. No creé nada.`;
        }
        // Lo transitorio de verdad: el claim ya consumió el pendiente, así
        // que para que el reintento con otro "sí" funcione hay que
        // DEVOLVERLO a su lugar antes de prometer nada.
        logger.error('despacho_wa.crear_fallo', { tenant: cuenta.tenantId, err: e instanceof Error ? e.message : String(e) });
        const restaurado = await guardarPendiente(cuenta.tenantId, telefono, pendiente);
        if (!restaurado) {
          // Sin pendiente restaurado, el "sí" de reintento no va a encontrar
          // nada — pedirlo sería mentir. Se dice la verdad: hay que re-armar.
          return 'No se pudo crear el viaje y tampoco pude guardar tu confirmación para reintentar. Díctame el viaje otra vez, o créalo desde Despacho.';
        }
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

  // La unidad se resuelve AQUÍ, no al confirmar: así el resumen ya dice la
  // verdad de lo que va a pasar — amarrada (con el número como está en la
  // base) o no encontrada, ANTES de que el jefe responda SÍ. Un error de
  // consulta corta el armado: prometer un amarre que no se pudo verificar
  // sería afirmar sin dato.
  let unidadId: string | null = null;
  let unidadEnsenada = intencion.unidad;
  let avisoUnidad = '';
  if (intencion.unidad) {
    let u;
    try {
      u = await resolverUnidadPorEconomico(cuenta.tenantId, intencion.unidad);
    } catch (e) {
      if (e instanceof ConsultaFallida) {
        return 'No pude consultar las unidades ahorita — inténtalo de nuevo en un momento.';
      }
      throw e;
    }
    if (u) {
      unidadId = u.unidadId;
      unidadEnsenada = u.numeroEconomico;
    } else {
      avisoUnidad = `\n\n⚠️ La unidad «${intencion.unidad}» no está dada de alta — si confirmas, el viaje queda sin unidad.`;
    }
  }

  await guardarPendiente(cuenta.tenantId, telefono, {
    operadorId: candidato.operadorId,
    operadorNombre: candidato.nombre,
    origen: intencion.origen,
    destino: intencion.destino,
    anticipo: intencion.anticipo,
    unidad: unidadEnsenada,
    unidadId,
    en: ahora.toISOString(),
  });

  // El resumen enseña el nombre RESUELTO de la base, no el texto del jefe:
  // lo que va a confirmar es a quién le llega el aviso de verdad. La unidad,
  // igual: si se amarró, sale con su número canónico.
  return resumenParaConfirmar({ ...intencion, operador: candidato.nombre, unidad: unidadEnsenada }) + avisoUnidad;
}
