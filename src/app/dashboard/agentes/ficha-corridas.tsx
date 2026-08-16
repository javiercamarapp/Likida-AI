import { History } from 'lucide-react';
import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { duracionLegible } from '@/lib/likida/agentes/corridas';
import { fechaHoraMx } from '@/lib/formato';

/**
 * LA FICHA DE CORRIDAS — el «Periodo · Estado · Tareas · Duración · Fecha»
 * (B3, auditoría 4), compartida por las seis páginas de agentes.
 *
 * Server component puro-props: la página trae las corridas (o el error) y
 * esto solo pinta. Tres estados, como todo en este panel: historial real,
 * vacío que dice desde cuándo se anota, o el error DICHO.
 */

const PILL: Record<string, { fg: string; bg: string; rotulo: string }> = {
  ok: { fg: 'var(--ok)', bg: 'var(--okbg)', rotulo: 'OK' },
  parcial: { fg: 'var(--warn)', bg: 'var(--warnbg, var(--canvas))', rotulo: 'Parcial' },
  fallo: { fg: 'var(--bad)', bg: 'var(--badbg)', rotulo: 'Falló' },
};

export function FichaCorridas({ corridas }: { corridas: CorridaRegistrada[] | null }) {
  return (
    <section className="card p-4 space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
        <History width={13} height={13} strokeWidth={1.75} />
        Corridas del agente
      </h2>

      {corridas === null ? (
        <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
          No pude leer el historial de corridas. No se pinta «sin corridas» sobre una consulta
          caída: es exactamente la mentira que este historial existe para evitar.
        </p>
      ) : corridas.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Sin corridas registradas todavía. El historial se anota desde el 14 de agosto de 2026 —
          si el agente corrió antes de esa fecha, esas corridas no aparecen aquí.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="px-2 py-1.5 font-medium">Fecha</th>
                <th className="px-2 py-1.5 font-medium">Estado</th>
                <th className="px-2 py-1.5 font-medium text-right">Tareas</th>
                <th className="px-2 py-1.5 font-medium text-right">Duración</th>
                <th className="px-2 py-1.5 font-medium">Disparo</th>
              </tr>
            </thead>
            <tbody>
              {corridas.map((c) => {
                const pill = PILL[c.estado];
                const dur = duracionLegible(c.duracionMs);
                return (
                  <tr key={c.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                      {fechaHoraMx(c.inicio)}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10.5px] font-medium"
                        style={{ color: pill.fg, background: pill.bg }}>
                        {pill.rotulo}
                      </span>
                      {c.error && (
                        <span className="block text-[10.5px] mt-0.5 max-w-[380px]" style={{ color: 'var(--bad)' }}>
                          {c.error}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular whitespace-nowrap">
                      {/* NULL no es 0/0: una corrida que no se mide en tareas lo dice con un guion. */}
                      {c.tareasHechas === null || c.tareasTotal === null
                        ? <span style={{ color: 'var(--faint)' }}>—</span>
                        : `${c.tareasHechas}/${c.tareasTotal}`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular whitespace-nowrap">
                      {dur === null ? <span style={{ color: 'var(--faint)' }}>—</span> : dur}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                      {/* Cada disparo con su verdad: 'correo' (0108) NO es programado —
                          lo disparó un correo que llegó al buzón — y 'whatsapp'
                          (0115) lo confirmó el operador por chat. */}
                      {c.disparo === 'manual' ? 'Ejecutar ahora'
                        : c.disparo === 'correo' ? 'Llegó un correo'
                          : c.disparo === 'whatsapp' ? 'Confirmado por WhatsApp'
                            : 'Programado'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
