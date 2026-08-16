import { revalidatePath } from 'next/cache';
import { LifeBuoy, AlertTriangle, Timer, Plus } from 'lucide-react';
import { exigirVerRuta } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getTickets, abrirTicket, CATEGORIAS_TICKET, PRIORIDADES_TICKET, type TicketRow } from '@/lib/likida/comercial';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { FormaConAviso, Campo, type ResultadoAccion } from '../../admin/ui/forma';
import { ahoraMs } from '@/lib/saludo';
import { EstadoVacio, KpiTile, StatusPill } from '../../admin/ui/kit';
import { fechaMx } from '@/lib/formato';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * SOPORTE — cola de tickets con reloj de SLA, sobre `ticket_soporte` (0051).
 *
 * EL RELOJ SE DERIVA, no se guarda. `vence_en` se escribe una vez al abrir el
 * ticket; lo que falta se resta contra el reloj del SERVIDOR, que llega como
 * prop (`ahoraMs()`): un `Date.now()` en el render lo bloquea
 * `react-hooks/purity`, y además haría que dos usuarios vieran relojes
 * distintos según su máquina.
 *
 * UN TICKET SIN SLA NO ESTÁ VENCIDO. `horasRestantes` es `null` y la fila dice
 * "sin SLA" — un 0 se leería como incumplido, y acusaría de incumplimiento a
 * quien nunca pactó un plazo.
 */
export default async function SoportePage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  await exigirVerRuta('/dashboard/soporte');
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/soporte', sp);

  // ── Abrir un ticket — la puerta de la señal de PMF #3 (auditoría externa
  // 16-ago-2026: la señal estaba instrumentada y nada podía producirla).
  // El chequeo se repite ADENTRO (patrón del repo): POST directo posible.
  // La convención 0051 protege la señal: superadmin abre con abierto_por
  // NULL ("lo abrió Likida"), un usuario real de la flota con su id —
  // un demo de Javier jamás cuenta como queja del cliente.
  async function accionAbrirTicket(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const sesion = await resolverTenantEfectivo('/dashboard/soporte', sp);
    try {
      await abrirTicket(
        sesion.tenantId,
        sesion.rol === 'superadmin' ? null : sesion.userId,
        {
          asunto: String(fd.get('asunto') ?? ''),
          descripcion: String(fd.get('descripcion') ?? ''),
          categoria: String(fd.get('categoria') ?? 'otro'),
          prioridad: String(fd.get('prioridad') ?? 'media'),
        },
      );
      revalidatePath('/dashboard/soporte');
      return { ok: 'Ticket abierto — el equipo de Likida lo ve en su bandeja de escalaciones.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'abrir el ticket') };
    }
  }
  const ahora = ahoraMs();
  const tickets = await safe<TicketRow[]>(() => getTickets(tenantId, ahora));

  const abiertos = tickets?.filter((t) => t.estado !== 'resuelto' && t.estado !== 'cerrado') ?? [];
  const vencidos = abiertos.filter((t) => t.horasRestantes != null && t.horasRestantes < 0);
  const sinSla = abiertos.filter((t) => t.horasRestantes == null);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <LifeBuoy width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Soporte &amp; Quejas</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Tickets, prioridad y reloj de SLA
          </span>
        </div>
      </header>

      {!tickets ? (
        <div className="glass-panel p-5">
          <EstadoVacio>
            No se pudo leer la cola. La consulta falló — no es que no haya tickets.
          </EstadoVacio>
        </div>
      ) : tickets.length === 0 ? (
        <div className="glass-panel p-5">
          <EstadoVacio icono={<LifeBuoy width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">No hay tickets abiertos.</span> La cola ya existe y
            registra prioridad, categoría y reloj de SLA. Si necesitas algo de Likida ahora, sigue
            siendo por WhatsApp — que es donde ya está tu operación.
          </EstadoVacio>
        </div>
      ) : (
        <>
          <div className="glass-panel p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiTile
                icono={<LifeBuoy width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Abiertos"
                valor={abiertos.length}
              />
              <KpiTile
                icono={<AlertTriangle width={15} height={15} strokeWidth={1.75} />}
                etiqueta="SLA vencido"
                valor={vencidos.length}
                destacar={vencidos.length > 0}
              />
              <KpiTile
                icono={<Timer width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Sin SLA pactado"
                valor={sinSla.length}
                nota="No están vencidos: nadie les puso plazo"
              />
            </div>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    <th className="text-left font-medium px-5 py-3">Asunto</th>
                    <th className="text-left font-medium px-5 py-3">Categoría</th>
                    <th className="text-left font-medium px-5 py-3">Prioridad</th>
                    <th className="text-left font-medium px-5 py-3">Estado</th>
                    <th className="text-left font-medium px-5 py-3">Abierto</th>
                    <th className="text-right font-medium px-5 py-3">SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="px-5 py-3 font-medium">{t.asunto}</td>
                      <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{t.categoria}</td>
                      <td className="px-5 py-3">{t.prioridad}</td>
                      <td className="px-5 py-3">
                        <StatusPill estado={t.estado === 'resuelto' || t.estado === 'cerrado' ? 'ok' : 'warn'}>
                          {t.estado}
                        </StatusPill>
                      </td>
                      <td className="px-5 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fechaMx(t.abiertoEn)}</td>
                      <td className="px-5 py-3 text-right text-xs tabular"
                        style={{ color: t.horasRestantes != null && t.horasRestantes < 0 ? 'var(--bad)' : 'var(--muted)' }}>
                        {t.horasRestantes == null
                          ? 'sin SLA'
                          : t.horasRestantes < 0
                            ? `vencido hace ${Math.abs(Math.round(t.horasRestantes))} h`
                            : `${Math.round(t.horasRestantes)} h`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <Plus width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          <span className="text-sm font-medium">Abrir un ticket</span>
        </div>
        <FormaConAviso accion={accionAbrirTicket} boton="Abrir ticket">
          <Campo nombre="asunto" etiqueta="Asunto" requerido placeholder="Qué pasó, en una línea" />
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            Categoría
            <select name="categoria" className="text-sm" defaultValue="otro">
              {CATEGORIAS_TICKET.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            Prioridad
            <select name="prioridad" className="text-sm" defaultValue="media">
              {PRIORIDADES_TICKET.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <Campo nombre="descripcion" etiqueta="Detalle" placeholder="Opcional — folios, pantalla, qué esperabas" />
        </FormaConAviso>
      </div>
    </div>
  );
}
