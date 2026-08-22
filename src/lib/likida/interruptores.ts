// ═══════════════════════════════════════════════════════════════════════════
// EL KILL SWITCH (0110) — la palanca que apaga un agente en cinco segundos.
//
// SIN FILA = ENCENDIDO: el default seguro es que el sistema corre, y una fila
// solo existe cuando alguien tocó la palanca. Los crons preguntan aquí antes
// de trabajar; /admin/observabilidad y el ⌘K son quienes la mueven.
//
// ── POR QUÉ `estaApagado` FALLA CERRADO (error de lectura = APAGADO) ───────
//
// Es la decisión central del módulo y va al revés de casi todo el repo, a
// propósito. En una LECTURA de panel, fallar cerrado es LANZAR para que la
// pantalla diga "no pude mirar". Pero este interruptor existe para un
// incidente: un agente portándose mal con un cliente real en WhatsApp. Si
// Javier lo apaga y un bache de red le esconde la fila al cron, "no pude leer
// el interruptor = corre" ejecutaría EXACTAMENTE lo que se acaba de apagar —
// mensajes a personas reales, CFDIs, cobranza. El costo del otro error (la
// base caída salta una corrida que de todos modos iba a morir contra la misma
// base) es una hora de retraso en un cron que reintenta solo. Se elige el
// error barato, y el log lo grita para que el salto no pase desapercibido.
//
// GLOBAL POR AGENTE EN V1, NO POR TENANT: los crons barren todas las flotas
// en una corrida; la palanca corta el barrido entero (ver 0110).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { DatoInvalido } from './errores';
import { acotada } from './presupuesto';

/** El catálogo completo: 'global' + los 7 agentes del dominio de
 *  `agente_corrida` (0102 + ventas en 0105). El CHECK de la 0110 vigila lo
 *  mismo en la base — un nombre fuera de esta lista no apaga nada. */
export const INTERRUPTORES = [
  'global',
  'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
  'agente:conductores', 'agente:peajes', 'agente:proveedores',
  'agente:ventas', 'agente:redactor',
] as const;

export type NombreInterruptor = (typeof INTERRUPTORES)[number];

export interface EstadoInterruptor {
  id: NombreInterruptor;
  apagado: boolean;
  motivo: string | null;
  cambiadoPor: string | null;
  /** Nombre o correo de quién movió la palanca — resuelto contra app_user
   *  para que la pantalla diga "quién", no un uuid. `null` si nunca se tocó
   *  o si la cuenta ya no existe. */
  cambiadoPorNombre: string | null;
  cambiadoEn: string | null;
}

function esNombreValido(nombre: string): nombre is NombreInterruptor {
  return (INTERRUPTORES as readonly string[]).includes(nombre);
}

/** Lo que una lectura puede decir. `ilegible` es el tercer estado que
 *  `estaApagado` colapsa en "apagado" (fail-closed) y que los crons
 *  necesitan DISTINGUIR: apagado a propósito no es un fallo; no haber
 *  podido saberlo SÍ lo es (AUDITORÍA 18, A17). */
export type LecturaInterruptor = 'encendido' | 'apagado' | 'ilegible';

/**
 * Lee el interruptor y dice una de tres cosas. NUNCA lanza.
 *
 * El camino `ilegible` GRITA con un `codigo` estable de la causa —sin él el
 * fingerprint de Sentry era `['interruptores.lectura_fallo','error']` para
 * todas las causas y, nacido una vez, no volvía a notificar— y manda la
 * alerta al operador por el único canal push del sistema: cinco crons
 * saltándose corridas sobre una base con hipo se ven, en Vercel, como cinco
 * crons verdes sin trabajo.
 */
export async function leerInterruptor(nombre: NombreInterruptor): Promise<LecturaInterruptor> {
  try {
    // AUDITORÍA 2 (backend): el kill switch es la red de seguridad manual — no
    // puede colgarse. Con `acotada` un socket que Supabase acepta y no contesta
    // corta en el tope (no en el default de undici de 300 s), y el timeout cae
    // por la rama `if (error)` de abajo → fail-closed (apagado). El backstop del
    // cliente (admin.ts) ya lo acotaba a 25 s; esto lo baja al tope de consulta.
    const { data, error } = await acotada(supabaseAdmin()
      .from('interruptor')
      .select('apagado')
      .eq('id', nombre)
      .maybeSingle(), 'estaApagado');
    if (error) {
      await gritarIlegible(nombre, error.message, codigoDeError(error));
      return 'ilegible';
    }
    return data?.apagado === true ? 'apagado' : 'encendido';
  } catch (e) {
    await gritarIlegible(nombre, e instanceof Error ? e.message : String(e), codigoDeError(e));
    return 'ilegible';
  }
}

/** Se GRITA: el salto por fail-closed no puede pasar desapercibido — un cron
 *  saltándose corridas por una base con hipo se parece demasiado a un cron
 *  sano sin trabajo. Log con código (Sentry notifica por causa nueva) Y correo
 *  al operador (`alertarOperador` nunca lanza y ya trae su piso de una hora). */
async function gritarIlegible(nombre: NombreInterruptor, err: string, codigo: string): Promise<void> {
  logger.error('interruptores.lectura_fallo', { interruptor: nombre, err, codigo });
  await alertarOperador('interruptores.lectura_fallo', { interruptor: nombre, error: err, codigo });
}

/**
 * ¿Está apagado este interruptor? SIN FILA = ENCENDIDO (false).
 *
 * FAIL-CLOSED: un error de lectura devuelve `true` (apagado) con log — si no
 * se puede saber si está apagado, no se corre. El porqué completo está en la
 * cabecera del archivo: ejecutar lo que alguien acaba de apagar es el error
 * caro; saltar una corrida que la misma base caída iba a matar es el barato.
 *
 * Quien necesite distinguir "apagado" de "no pude leer" (los crons, para no
 * contestar 200 sobre un fallo) usa `leerInterruptor`.
 */
export async function estaApagado(nombre: NombreInterruptor): Promise<boolean> {
  return (await leerInterruptor(nombre)) !== 'encendido';
}

/**
 * Apaga un interruptor. El MOTIVO es obligatorio y no vacío (el CHECK de la
 * 0110 lo rebota igual en la base; validarlo aquí da el mensaje que la
 * pantalla puede enseñar). LANZA si la escritura falla: un "apagué" que no
 * apagó es el peor resultado posible de esta función.
 */
export async function apagar(nombre: string, motivo: string, userId: string): Promise<void> {
  if (!esNombreValido(nombre)) {
    throw new DatoInvalido(`"${nombre}" no es un interruptor del catálogo.`);
  }
  const m = motivo.trim();
  if (!m) {
    throw new DatoInvalido('Apagar exige un motivo: sin nota, en tres semanas nadie sabe si ya se puede encender.');
  }
  const { error } = await supabaseAdmin()
    .from('interruptor')
    .upsert(
      { id: nombre, apagado: true, motivo: m, cambiado_por: userId, cambiado_en: new Date().toISOString() },
      { onConflict: 'id' },
    );
  if (error) throw new Error(`apagar(${nombre}): ${error.message}`);
  await anotarEnBitacora('interruptor.apagado', nombre, userId, { motivo: m });
}

/**
 * Enciende un interruptor (vuelve al default). El motivo del apagón anterior
 * se limpia: la fila dice el estado VIGENTE; el historial vive en la
 * bitácora. LANZA si la escritura falla, por la misma razón que `apagar`.
 */
export async function encender(nombre: string, userId: string): Promise<void> {
  if (!esNombreValido(nombre)) {
    throw new DatoInvalido(`"${nombre}" no es un interruptor del catálogo.`);
  }
  const { error } = await supabaseAdmin()
    .from('interruptor')
    .upsert(
      { id: nombre, apagado: false, motivo: null, cambiado_por: userId, cambiado_en: new Date().toISOString() },
      { onConflict: 'id' },
    );
  if (error) throw new Error(`encender(${nombre}): ${error.message}`);
  await anotarEnBitacora('interruptor.encendido', nombre, userId, {});
}

/**
 * El estado de TODOS los interruptores del catálogo, con los que no tienen
 * fila en su estado default (encendidos). LANZA ante un error de lectura:
 * esta lista es de PANEL, y pintar "todo encendido" sobre una base caída
 * afirmaría que nada está apagado sin haber podido mirar.
 *
 * Sin paginar a propósito: la tabla tiene a lo sumo 8 filas (el CHECK del
 * dominio lo garantiza).
 */
export async function listarInterruptores(): Promise<EstadoInterruptor[]> {
  const { data, error } = await supabaseAdmin()
    .from('interruptor')
    .select('id, apagado, motivo, cambiado_por, cambiado_en');
  if (error) throw new Error(`listarInterruptores: ${error.message}`);

  const filas = new Map<string, Record<string, unknown>>();
  for (const f of (data ?? []) as Array<Record<string, unknown>>) {
    filas.set(String(f.id), f);
  }

  // "Quién" con nombre, no con uuid. Una sola consulta por el conjunto; si
  // falla, la lista sale igual con el uuid — el nombre es cortesía, el estado
  // de la palanca es el dato.
  const actores = [...new Set(
    [...filas.values()].map((f) => f.cambiado_por as string | null).filter((v): v is string => v !== null),
  )];
  const nombrePorId = new Map<string, string>();
  if (actores.length > 0) {
    const { data: usuarios, error: errUsuarios } = await supabaseAdmin()
      .from('app_user')
      .select('id, nombre, email')
      .in('id', actores);
    if (errUsuarios) {
      logger.warn('interruptores.actores_sin_nombre', { err: errUsuarios.message });
    } else {
      for (const u of (usuarios ?? []) as Array<Record<string, unknown>>) {
        nombrePorId.set(String(u.id), String(u.nombre ?? u.email ?? ''));
      }
    }
  }

  return INTERRUPTORES.map((id): EstadoInterruptor => {
    const f = filas.get(id);
    if (!f) {
      return { id, apagado: false, motivo: null, cambiadoPor: null, cambiadoPorNombre: null, cambiadoEn: null };
    }
    const cambiadoPor = (f.cambiado_por as string | null) ?? null;
    return {
      id,
      apagado: f.apagado === true,
      motivo: (f.motivo as string | null) ?? null,
      cambiadoPor,
      cambiadoPorNombre: cambiadoPor ? (nombrePorId.get(cambiadoPor) ?? null) : null,
      cambiadoEn: (f.cambiado_en as string | null) ?? null,
    };
  });
}

/**
 * Cada toque de palanca queda en `bitacora_auditoria` (0053) — es el
 * historial que la fila no guarda. Best-effort A PROPÓSITO (mismo criterio
 * que `anotar` en administracion.ts): el interruptor YA se movió; tirar el
 * apagado de un agente porque la bitácora no pudo escribir dejaría al agente
 * corriendo en pleno incidente. El fallo se loguea para que no muera en
 * silencio.
 */
async function anotarEnBitacora(
  accion: 'interruptor.apagado' | 'interruptor.encendido',
  nombre: string,
  userId: string,
  detalle: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin().from('bitacora_auditoria').insert({
    tenant_id: null, // la palanca es de PLATAFORMA, no de una flota
    actor_id: userId,
    accion,
    entidad: 'interruptor',
    entidad_id: nombre,
    detalle,
  });
  if (error) logger.warn('interruptores.bitacora_no_escribio', { accion, interruptor: nombre, err: error.message });
}
