import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { variantesTelefono } from './conv';

// ═══════════════════════════════════════════════════════════════════════════
// QUIÉN ES EL NÚMERO QUE ESCRIBE — Y A QUÉ NÚMERO SE LE ESCRIBE.
//
// Las dos caras del mismo dato, y por eso viven juntas.
//
// Hasta la 0059 el agente solo sabía reconocer CHOFERES: `operador` tenía
// teléfono, `app_user` no. Cualquier otro número recibía "no te tengo
// registrado como operador" y se acababa la conversación. Consecuencia que
// costó encontrar: los avisos que salen hacia la oficina —"tu chofer no aceptó
// el viaje", "tienes tickets por facturar"— llegaban a un teléfono que el
// sistema no reconocía de vuelta. El jefe podía contestar "cámbialo a Pérez" y
// nadie estaba escuchando. Un aviso que no se puede contestar no es una
// conversación, es una alerta.
//
// ── UN NÚMERO PUEDE SER LAS DOS COSAS ────────────────────────────────────
//
// En una flota chica el dueño maneja. No se elige por él ni se falla: se
// devuelven LAS DOS caras y quien llama decide con su propio contexto (si trae
// viaje abierto, es chofer; si pregunta por su flota, es oficina). Colapsarlo
// aquí obligaría a adivinar sin la información que hace falta para acertar.
//
// ── LO QUE SÍ SE NIEGA ───────────────────────────────────────────────────
//
// Que un número apunte a DOS flotas. Ahí no hay contexto que desempate: el
// mensaje entrante trae solo el número, y es el número el que determina de qué
// flota se habla. `resolveOperador` ya se niega ante eso; aquí se aplica el
// mismo criterio, y la 0059 lo vuelve imposible desde la base para `app_user`.
// ═══════════════════════════════════════════════════════════════════════════

export type RolOficina = 'flota_admin' | 'contador' | 'encargado' | 'superadmin';

export interface CuentaOficina {
  userId: string;
  /** `null` solo en superadmin: no pertenece a una flota. */
  tenantId: string | null;
  rol: RolOficina;
  nombre: string | null;
  email: string;
}

export class TelefonoAmbiguo extends Error {}

/**
 * La cuenta de oficina detrás de un número. `null` = no hay ninguna.
 *
 * Lanza `ConsultaFallida` implícita vía throw si la base no contesta: "no está
 * dado de alta" y "no pude preguntar" NO son lo mismo, y confundirlos le diría
 * a un jefe que su cuenta no existe por un fallo transitorio de red.
 */
export async function resolverCuentaOficina(telefono: string): Promise<CuentaOficina | null> {
  const { data, error } = await supabaseAdmin()
    .from('app_user')
    .select('id, tenant_id, rol, nombre, email, telefono')
    .in('telefono', variantesTelefono(telefono))
    .limit(2); // dos, para poder DETECTAR la ambigüedad en vez de recortarla

  if (error) throw new Error(`cuenta de oficina por teléfono: ${error.message}`);

  const filas = data ?? [];
  if (filas.length === 0) return null;
  if (filas.length > 1) {
    logger.error('cuenta.ambigua', {
      telefono,
      tenants: [...new Set(filas.map((f) => f.tenant_id as string | null))],
      usuarios: filas.map((f) => f.id as string),
    });
    throw new TelefonoAmbiguo(`el teléfono ${telefono} corresponde a más de una cuenta`);
  }

  const f = filas[0];
  return {
    userId: f.id as string,
    tenantId: (f.tenant_id as string) ?? null,
    rol: f.rol as RolOficina,
    nombre: (f.nombre as string) ?? null,
    email: f.email as string,
  };
}

// ── LA OTRA CARA: A QUIÉN SE LE ESCRIBE ────────────────────────────────────

/**
 * Los roles que reciben los avisos de operación de una flota, en orden.
 *
 * El encargado va PRIMERO y no es un detalle: es quien opera el día a día y
 * quien puede reasignar un viaje o entrar a un portal a facturar. El
 * flota_admin es el dueño — avisarle a él de cada ticket por vencer lo entrena
 * a ignorar el canal. El contador no está: no despacha.
 */
const ORDEN_AVISO: RolOficina[] = ['encargado', 'flota_admin'];

/** E.164 sin `+`. `null` si esa flota no tiene a quién escribirle. */
export async function telefonoJefeDe(tenantId: string): Promise<string | null> {
  const mapa = await telefonosJefe([tenantId]);
  return mapa[tenantId] ?? null;
}

/**
 * El mapa que consume la escalación: flota → teléfono de quien decide.
 *
 * UNA sola consulta para todas las flotas. La alternativa —un viaje a la base
 * por viaje vencido— multiplica las consultas por un dato que no cambia entre
 * un viaje y otro dentro de la misma corrida.
 *
 * Devuelve el mapa INCOMPLETO cuando una flota no tiene contacto, en vez de
 * inventar un default: quien llama ya trata la ausencia como "no hay a quién
 * avisar" y lo dice en su reporte. Un fallback a otro número mandaría la
 * operación de una flota al teléfono de otra.
 */
export async function telefonosJefe(tenantIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(tenantIds)].filter(Boolean);
  if (ids.length === 0) return {};

  const { data, error } = await supabaseAdmin()
    .from('app_user')
    .select('tenant_id, rol, telefono')
    .in('tenant_id', ids)
    .in('rol', ORDEN_AVISO)
    .not('telefono', 'is', null);

  if (error) throw new Error(`telefonosJefe: ${error.message}`);

  const mapa: Record<string, string> = {};
  // Se recorre en el orden de preferencia, no en el que devolvió la base: sin
  // esto, qué persona recibe el aviso dependería del orden de inserción.
  for (const rol of ORDEN_AVISO) {
    for (const u of data ?? []) {
      const t = u.tenant_id as string | null;
      const tel = u.telefono as string | null;
      if (t && tel && u.rol === rol && !mapa[t]) mapa[t] = tel;
    }
  }
  return mapa;
}
