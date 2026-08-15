import { LifeBuoy, AlertTriangle, Timer, CheckCircle2 } from 'lucide-react';
import { getTicketsCruzados, type TicketCruzado } from '@/lib/admin/soporte';
import { ahoraMs } from '@/lib/saludo';
import { fechaMx, numero } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, StatusPill, EstadoVacio, EstadoError, type Estado } from '../ui/kit';

export const dynamic = 'force-dynamic';

/** `ticket_soporte.estado` (dominio de la 0051) como pill. Un valor fuera del
 *  dominio se pinta crudo en neutro — visible, no roto (mismo criterio que
 *  `PILL_ESTATUS` en resumen-visual). */
const PILL_TICKET: Record<string, { estado: Estado; etiqueta: string }> = {
  abierto: { estado: 'warn', etiqueta: 'Abierto' },
  en_proceso: { estado: 'warn', etiqueta: 'En proceso' },
  esperando: { estado: 'neutral', etiqueta: 'Esperando' },
  resuelto: { estado: 'ok', etiqueta: 'Resuelto' },
  cerrado: { estado: 'ok', etiqueta: 'Cerrado' },
};

const CERRADOS = new Set(['resuelto', 'cerrado']);

/** "hace 3 h" / "hace 2 d" — la edad del ticket contra el reloj del SERVIDOR
 *  (`ahoraMs()`), el mismo contra el que se resta el SLA: dos relojes en la
 *  misma fila terminan contándose historias distintas. */
function edadDe(abiertoEn: string, ahora: number): string {
  const horas = (ahora - new Date(abiertoEn).getTime()) / 3_600_000;
  if (horas < 1) return 'hace menos de 1 h';
  if (horas < 48) return `hace ${Math.floor(horas)} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

/** El reloj de SLA de la fila — mismas tres verdades que /dashboard/soporte:
 *  sin SLA no hay reloj, vencido se dice con cuánto, y lo demás es lo que falta. */
function slaDe(t: TicketCruzado): { texto: string; vencido: boolean } {
  if (t.horasRestantes == null) return { texto: 'sin SLA', vencido: false };
  if (t.horasRestantes < 0) return { texto: `vencido hace ${Math.abs(Math.round(t.horasRestantes))} h`, vencido: true };
  return { texto: `${Math.round(t.horasRestantes)} h`, vencido: false };
}

/**
 * SOPORTE — la cola de tickets del SUPERADMIN: `ticket_soporte` (0051) de
 * TODAS las flotas, con flota, edad y reloj de SLA por fila.
 *
 * Esta página decía "Likida no tiene un sistema de tickets hoy... sin tabla,
 * sin cola, sin SLA que medir" — FALSO (auditoría del 14-ago): la tabla existe
 * desde la 0051 y el panel del CLIENTE ya la lee con reloj de SLA
 * (`/dashboard/soporte` + `getTickets` en comercial.ts). Lo que esta pantalla
 * enseña es esa misma cola cruzada por todos los tenants
 * (`lib/admin/soporte.ts` — el permiso de cruzar vive en lib/admin, como
 * negocio.ts).
 *
 * El matiz honesto: el ESCRITOR de tickets no existe todavía — ninguna
 * pantalla ni endpoint inserta en `ticket_soporte` (verificado por grep,
 * 14-ago-2026): el panel del cliente la LEE pero no tiene botón de "abrir
 * ticket". Así que "0 tickets" es la verdad de hoy, y el estado vacío la
 * explica sin prometer fechas.
 */
export default async function SoportePage() {
  const ahora = ahoraMs();
  // Error DICHO, no tragado: getTicketsCruzados lanza si la lectura no se
  // completó (el error de supabase-js llega por valor y ya se comprobó allá).
  // Aquí se atrapa para pintar el estado de error DENTRO del marco de la
  // página — una cola vacía sobre una base caída afirmaría "nadie necesita
  // nada", que es lo contrario de lo que una cola de soporte promete.
  let tickets: TicketCruzado[] | null = null;
  try {
    tickets = await getTicketsCruzados(ahora);
  } catch {
    tickets = null;
  }

  const abiertos = tickets?.filter((t) => !CERRADOS.has(t.estado)) ?? [];
  const vencidos = abiertos.filter((t) => t.horasRestantes != null && t.horasRestantes < 0);
  const sinSla = abiertos.filter((t) => t.horasRestantes == null);
  const resueltos = tickets?.filter((t) => CERRADOS.has(t.estado)) ?? [];

  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<LifeBuoy {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Soporte — todas las flotas"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {tickets === null ? (
            <EstadoError mensaje="No se pudo leer la cola de tickets. La consulta falló — no es que no haya tickets, es que no se pudo mirar." />
          ) : (
            <>
              {/* ── KPIs — conteos reales de la cola cross-tenant ─────────── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <StatCard icono={<LifeBuoy {...ICONO} />}
                  etiqueta="Tickets abiertos — todas las flotas" valor={abiertos.length} formato="entero"
                />
                <StatCard icono={<AlertTriangle {...ICONO} />}
                  etiqueta="Con SLA vencido" valor={vencidos.length} formato="entero"
                />
                <StatCard icono={<Timer {...ICONO} />}
                  etiqueta="Sin SLA pactado" valor={sinSla.length} formato="entero"
                  nota="No están vencidos: nadie les puso plazo"
                />
                <StatCard icono={<CheckCircle2 {...ICONO} />}
                  etiqueta="Resueltos o cerrados — histórico" valor={resueltos.length} formato="entero"
                />
              </div>

              {tickets.length === 0 ? (
                <EstadoVacio icono={<LifeBuoy width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  <span className="font-semibold">La cola existe y está vacía de verdad.</span>{' '}
                  La tabla de tickets (con prioridad, categoría y reloj de SLA) está en la base desde la
                  migración 0051, y el panel del cliente ya la lee en su página de Soporte. Lo que falta
                  es el otro extremo: <strong>todavía no hay ninguna pantalla donde se abra un ticket</strong> —
                  ni en el panel del cliente ni aquí. Por eso este 0 es la verdad de hoy: no hay tickets
                  escondidos en otro lado, hay una cola sin quien la llene. Mientras tanto, lo que las
                  flotas necesiten sigue llegando por WhatsApp, que es donde ya está su operación.
                </EstadoVacio>
              ) : (
                <div className="card overflow-hidden">
                  <div className="px-4 pt-3 pb-1">
                    <TituloSeccion>La cola — lo más urgente primero, sin-SLA al final</TituloSeccion>
                  </div>
                  <div className="overflow-x-auto mt-1">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ color: 'var(--muted)' }} className="text-left">
                          <th className="px-4 py-2 font-medium">Asunto</th>
                          <th className="px-4 py-2 font-medium">Flota</th>
                          <th className="px-4 py-2 font-medium">Categoría</th>
                          <th className="px-4 py-2 font-medium">Prioridad</th>
                          <th className="px-4 py-2 font-medium">Estado</th>
                          <th className="px-4 py-2 font-medium">Abierto</th>
                          <th className="px-4 py-2 font-medium text-right">SLA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map((t) => {
                          const pill = PILL_TICKET[t.estado] ?? { estado: 'neutral' as Estado, etiqueta: t.estado };
                          const sla = slaDe(t);
                          return (
                            <tr key={t.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                              <td className="px-4 py-2.5 font-medium">{t.asunto}</td>
                              <td className="px-4 py-2.5">{t.tenantNombre}</td>
                              <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{t.categoria}</td>
                              <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{t.prioridad}</td>
                              <td className="px-4 py-2.5"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-xs" style={{ color: 'var(--muted)' }}>
                                {fechaMx(t.abiertoEn)} · {edadDe(t.abiertoEn, ahora)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-xs tabular whitespace-nowrap"
                                style={{ color: sla.vencido ? 'var(--bad)' : 'var(--muted)' }}>
                                {sla.texto}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs px-4 pt-2 pb-3" style={{ color: 'var(--muted)' }}>
                    {numero(tickets.length)} {tickets.length === 1 ? 'ticket' : 'tickets'} en total, de todas
                    las flotas. El reloj se deriva de <code className="font-mono">vence_en</code> contra el
                    reloj del servidor — un ticket sin SLA pactado dice &quot;sin SLA&quot;, nunca &quot;vencido&quot;.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
