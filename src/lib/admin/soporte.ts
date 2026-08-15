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
import { conteo, traerTodo } from '@/lib/likida/pg';
import { round2 } from '@/lib/formato';

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
}

/**
 * TODOS los tickets de TODAS las flotas, ordenados como una cola: lo más
 * urgente primero (menos horas de SLA restantes), los "sin SLA" al final.
 *
 * `traerTodo` + `conteo` como todo lib/admin: el error de supabase-js llega
 * POR VALOR y una base caída sin comprobarlo se leería "0 tickets, nadie
 * necesita nada" — que es exactamente lo que una cola de soporte existe para
 * desmentir. Si la lectura no se puede completar, LANZA; el llamador enseña
 * su estado de error, no una cola vacía.
 */
export async function getTicketsCruzados(ahoraMs: number): Promise<TicketCruzado[]> {
  const admin = supabaseAdmin();
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => admin.from('ticket_soporte')
      .select('id, asunto, categoria, prioridad, estado, abierto_en, resuelto_en, vence_en, tenant_id, tenant:tenant_id(nombre)', conteo(d))
      .order('id').range(d, h),
    'getTicketsCruzados',
  );

  return filas.map((t): TicketCruzado => {
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
    };
  }).sort((a, b) => (a.horasRestantes ?? Infinity) - (b.horasRestantes ?? Infinity));
}
