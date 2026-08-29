// ═══════════════════════════════════════════════════════════════════════════
// LA COLA DE SOPORTE, VISTA DESDE ARRIBA — `ticket_soporte` (0051) cruzada por
// TODOS los tenants, para /admin/soporte.
//
// Vive en lib/admin (el barrio con permiso de cruzar tenants, ver negocio.ts)
// y NO en lib/likida/comercial.ts a propósito: `getTickets` de allá es
// tenant-scoped en su primera línea (`.eq('tenant_id', ...)`), y mezclar en un
// mismo archivo lecturas con y sin filtro es como se copia un patrón de
// superadmin a una consulta de cliente y se filtra de menos.
//
// El CÁLCULO del reloj sí es el mismo que el del cliente adrede: `vence_en` se
// escribió una vez al abrir el ticket (0051 — el SLA se deriva, no se guarda) y
// lo que falta se resta contra un `ahoraMs` INYECTADO, nunca contra el reloj de
// quien renderiza. Un ticket sin SLA pactado da `horasRestantes: null` — un 0
// se leería como "vencido" y acusaría a quien nunca pactó plazo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { round2 } from '@/lib/formato';

/** Cuántos tickets se LISTAN de una vez. Es un tope de pantalla, no un total:
 *  los conteos salen de `contarTickets` y la cola dice "N de M". */
export const TOPE_TICKETS = 200;

/** Los dos estados TERMINALES del dominio de `ticket_soporte.estado` (0051).
 *  Vive aquí —junto a la lectura— y no en cada pantalla, para que "abierto"
 *  no se calcule distinto en /admin/soporte y en la bandeja de escalaciones. */
export const ESTADOS_TICKET_CERRADO: ReadonlySet<string> = new Set(['resuelto', 'cerrado']);

export interface TicketCruzado {
  id: string;
  asunto: string;
  categoria: string;
  prioridad: string;
  estado: string;
  abiertoEn: string;
  resueltoEn: string | null;
  venceEn: string | null;
  /** Horas que faltan para el SLA (negativo = vencido). `null` = sin SLA
   *  pactado, y la pantalla dice "sin SLA", nunca "vencido". */
  horasRestantes: number | null;
  /** De QUÉ flota es el ticket — una cola cross-tenant que no diga la flota
   *  mezclaría los pendientes de clientes distintos como si fueran uno. */
  tenantId: string;
  tenantNombre: string;
  /** Quién de Likida lo tomó (0268). `null` = SIN TOMAR — que no es lo mismo
   *  que "en proceso": la cola lo dice con esas palabras. */
  asignadoA: string | null;
  asignadoNombre: string | null;
}

/**
 * La cola de tickets, ordenada por urgencia: lo que vence antes primero, los
 * "sin SLA" al final.
 *
 * ── FE-11 (22-ago-2026): ERA `traerTodo` DE LA TABLA ENTERA ────────────────
 *
 * Traía TODOS los tickets de TODAS las flotas —hasta 100,000 filas por el
 * techo de `traerTodo`— para pintar una tabla y sumar cuatro KPIs. Tres
 * pantallas la llamaban en cada carga (/admin/soporte, la bandeja de
 * escalaciones y la ficha de cliente), y la ficha además la pedía SIN filtro
 * de tenant para quedarse con los de uno solo: la flota con 12 tickets pagaba
 * la lectura de los 40,000 de todas.
 *
 * Ahora: `.limit(TOPE_TICKETS)` y `tenantId` opcional que va al `.eq()`, no a
 * un `.filter()` de JavaScript. El ORDEN se pide a la base (`vence_en` asc,
 * nulls al final) — es el mismo criterio que el `.sort()` de antes, y tiene
 * que serlo: con un tope, ordenar después de recortar enseñaría los 200
 * tickets equivocados.
 *
 * LANZA si la lectura falla: el error de supabase-js llega POR VALOR y una
 * cola vacía sobre una base caída afirmaría "nadie necesita nada", que es lo
 * contrario de lo que una cola de soporte promete.
 */
export async function getTicketsCruzados(
  ahoraMs: number,
  opciones: { tenantId?: string; limite?: number } = {},
): Promise<TicketCruzado[]> {
  let consulta = supabaseAdmin()
    .from('ticket_soporte')
    .select('id, asunto, categoria, prioridad, estado, abierto_en, resuelto_en, vence_en, tenant_id, '
      + 'asignado_a, tenant:tenant_id(nombre), asignado:asignado_a(nombre)');
  if (opciones.tenantId) consulta = consulta.eq('tenant_id', opciones.tenantId);

  const { data, error } = await consulta
    // `nullsFirst: false` = los sin SLA al final, igual que el sort viejo
    // mandaba `Infinity` al fondo. `id` desempata para que dos cargas de la
    // misma cola no barajen filas con el mismo vencimiento.
    .order('vence_en', { ascending: true, nullsFirst: false })
    .order('id')
    .limit(Math.max(1, Math.min(TOPE_TICKETS, opciones.limite ?? TOPE_TICKETS)));
  if (error) throw new Error(`getTicketsCruzados: ${error.message}`);

  return (data ?? []).map((f): TicketCruzado => {
    // Por `unknown`: con DOS embeds (`tenant:tenant_id` y `asignado:asignado_a`
    // — dos FKs distintas a app_user desde la misma tabla) el tipo que
    // supabase-js infiere es una unión con `GenericStringError`. Se lee campo
    // por campo abajo, como ya se hacía.
    const t = f as unknown as Record<string, unknown>;
    const vence = (t.vence_en as string | null) ?? null;
    return {
      id: t.id as string,
      asunto: String(t.asunto),
      categoria: String(t.categoria),
      prioridad: String(t.prioridad),
      estado: String(t.estado),
      abiertoEn: String(t.abierto_en),
      resueltoEn: (t.resuelto_en as string | null) ?? null,
      venceEn: vence,
      // Sin SLA pactado no se calcula: un 0 se leería como "vencido". Mismo
      // criterio (y misma aritmética) que `getTickets` en comercial.ts.
      horasRestantes: vence ? round2((new Date(vence).getTime() - ahoraMs) / 3_600_000) : null,
      tenantId: t.tenant_id as string,
      // El join sin nombre se pinta '—' — visible, no inventado (mismo
      // criterio que `mapearCorrida` en negocio.ts).
      tenantNombre: ((t.tenant as { nombre?: string } | null)?.nombre) ?? '—',
      asignadoA: (t.asignado_a as string | null) ?? null,
      asignadoNombre: ((t.asignado as { nombre?: string | null } | null)?.nombre) ?? null,
    };
  });
}

/**
 * DE QUÉ FLOTA ES ESTE TICKET — la única función de todo el ciclo de soporte
 * que cruza tenants, y por eso vive aquí y no en `lib/likida/soporte.ts`.
 *
 * El superadmin de /admin/soporte atiende una cola de TODAS las flotas: para
 * responder o cerrar un ticket necesita saber a cuál pertenece. En vez de
 * darle a `lib/likida/soporte.ts` un modo "sin filtro de tenant" —que sería
 * un `.eq('tenant_id')` opcional, o sea un aislamiento que depende de que
 * nadie olvide pasar el parámetro—, el permiso de cruzar se aísla en ESTA
 * consulta, que solo LEE el tenant al que el ticket ya pertenece. Todo lo que
 * escribe entra después por la puerta tenant-scoped, con este id en la mano.
 *
 * `null` = ese id no es un ticket. LANZA si la lectura falla: "no se pudo
 * mirar" no puede confundirse con "no existe" cuando lo que sigue es cerrar
 * el ticket de alguien.
 */
export async function resolverTicketCruzado(
  ticketId: string,
): Promise<{ id: string; tenantId: string; tenantNombre: string } | null> {
  const id = ticketId.trim();
  if (!id) return null;
  const { data, error } = await supabaseAdmin()
    .from('ticket_soporte')
    .select('id, tenant_id, tenant:tenant_id(nombre)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`resolverTicketCruzado: ${error.message}`);
  if (!data) return null;
  // Doble casteo a propósito: con un embed (`tenant:tenant_id(nombre)`) el
  // tipo que supabase-js infiere para `.maybeSingle()` es una unión con
  // `GenericStringError`, que no solapa con un Record. Se pasa por `unknown` y
  // se lee campo por campo abajo, como el resto del archivo.
  const t = data as unknown as Record<string, unknown>;
  return {
    id: String(t.id),
    tenantId: String(t.tenant_id),
    // El join sin nombre se pinta '—' — visible, no inventado (mismo criterio
    // que `getTicketsCruzados` arriba).
    tenantNombre: ((t.tenant as { nombre?: string } | null)?.nombre) ?? '—',
  };
}

export interface ConteosTickets {
  abiertos: number | null;
  vencidos: number | null;
  sinSla: number | null;
  cerrados: number | null;
}

/** Los estados terminales, como los quiere el filtro de PostgREST. */
const CERRADOS_PG = `(${[...ESTADOS_TICKET_CERRADO].join(',')})`;

/**
 * Los cuatro conteos de la cola, CONTADOS EN LA BASE (`count exact, head`:
 * cero filas de vuelta) — FE-11.
 *
 * Salían de `.filter().length` sobre la tabla entera traída a memoria. Con el
 * tope de 200 de arriba, ese mismo cálculo diría "200 tickets abiertos"
 * pasara lo que pasara; contarlos es lo que permite acotar la lista sin
 * mentir sobre el tamaño de la cola.
 *
 * `null` en cualquiera = esa cuenta no se pudo hacer, y la tarjeta pinta "—".
 * Nunca 0: un cero aquí se lee como "nadie necesita nada".
 */
export async function contarTickets(
  ahoraMs: number,
  opciones: { tenantId?: string } = {},
): Promise<ConteosTickets> {
  const base = () => {
    const q = supabaseAdmin().from('ticket_soporte').select('id', { count: 'exact', head: true });
    return opciones.tenantId ? q.eq('tenant_id', opciones.tenantId) : q;
  };
  const contar = async (
    afinar: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
    nombre: string,
  ): Promise<number | null> => {
    const { count, error } = await afinar(base());
    if (error) {
      logger.warn('contarTickets', { nombre, err: error.message });
      return null;
    }
    return count ?? null;
  };

  const ahoraIso = new Date(ahoraMs).toISOString();
  const [abiertos, vencidos, sinSla, cerrados] = await Promise.all([
    contar((q) => q.not('estado', 'in', CERRADOS_PG), 'abiertos'),
    contar((q) => q.not('estado', 'in', CERRADOS_PG).lt('vence_en', ahoraIso), 'vencidos'),
    contar((q) => q.not('estado', 'in', CERRADOS_PG).is('vence_en', null), 'sinSla'),
    contar((q) => q.in('estado', [...ESTADOS_TICKET_CERRADO]), 'cerrados'),
  ]);
  return { abiertos, vencidos, sinSla, cerrados };
}
