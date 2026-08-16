import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListTree, Bot, MessageCircle, ArrowLeft, ExternalLink } from 'lucide-react';
import { trazaDeCorrida, type TrazaCorrida } from '@/lib/admin/corridas-cruzadas';
import { fechaHoraMx, numero } from '@/lib/formato';
import { usd } from '@/lib/utils';
import { StatusPill, EstadoError, EstadoVacio, type Estado } from '../../ui/kit';
import { BarraPagina, TituloSeccion } from '../../../dashboard/resumen-visual';
import { etiquetaInterruptor } from '../../observabilidad/etiquetas';

export const dynamic = 'force-dynamic';

const PILL: Record<string, { estado: Estado; etiqueta: string }> = {
  ok: { estado: 'ok', etiqueta: 'OK' },
  parcial: { estado: 'warn', etiqueta: 'Parcial' },
  fallo: { estado: 'bad', etiqueta: 'Fallo' },
};

const DISPARO: Record<string, string> = {
  cron: 'Programado (cron)',
  manual: 'Manual («Ejecutar ahora»)',
  correo: 'Por correo entrante',
  whatsapp: 'Confirmado por WhatsApp (0115)',
};

function duracion(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * LA TRAZA DE UNA CORRIDA — anatomía FlowAI (misma factura que
 * /admin/soporte): una fila de `agente_corrida` (0102) abierta con todo lo
 * que se puede AFIRMAR de ella: agente, flota, estado, duración, tareas, su
 * resumen, su error redactado, y el costo de IA de esa flota EN LA VENTANA
 * de la corrida.
 *
 * El costo es CORRELACIÓN POR TIEMPO, no un join: `llm_costo` no tiene
 * `corrida_id` y no se le inventa — la cifra se rotula "en la ventana", con
 * su supuesto a la vista (ver corridas-cruzadas.ts). `requireSuperadmin()`
 * ya lo hizo el layout de /admin.
 */
export default async function TrazaCorridaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Un id que ni siquiera es uuid es un 404, no un error de consulta.
  if (!UUID.test(id)) notFound();

  // Error DICHO, no tragado: una traza en blanco sobre una base caída
  // afirmaría "esta corrida no dejó nada", que es lo contrario de una traza.
  let traza: TrazaCorrida | null | undefined;
  try {
    traza = await trazaDeCorrida(id);
  } catch {
    traza = undefined;
  }
  if (traza === null) notFound();

  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

  if (traza === undefined) {
    return (
      <main className="h-full">
        <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
          <BarraPagina icono={<ListTree {...ICONO} style={{ color: 'var(--muted)' }} />} titulo="Traza de corrida" />
          <div className="px-5 py-5">
            <EstadoError mensaje="No se pudo leer la corrida. La consulta falló — no es que no exista, es que no se pudo mirar." />
          </div>
        </div>
      </main>
    );
  }

  const { corrida: c, costo, costoNoDisponible } = traza;
  const pill = PILL[c.estado] ?? { estado: 'neutral' as Estado, etiqueta: c.estado };
  const flota = c.tenantNombre ?? (c.tenantId === null ? 'Likida (negocio)' : '—');

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ListTree {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo={`Traza — ${etiquetaInterruptor(`agente:${c.agente}`)}`}
          derecha={
            <Link href="/admin/observabilidad" className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--muted)' }}>
              <ArrowLeft width={12} height={12} strokeWidth={1.75} /> Observabilidad
            </Link>
          }
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {/* ── El renglón de referencia: Estado · Tareas · Duración · Costo ──── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Estado</div>
              <div className="mt-1"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></div>
            </div>
            <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Tareas</div>
              {/* NULL ≠ 0: una corrida que no se mide en tareas dice «—», no 0/0. */}
              <div className="mt-1 text-sm font-medium tabular">
                {c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas}/${c.tareasTotal}` : '—'}
              </div>
            </div>
            <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Duración</div>
              <div className="mt-1 text-sm font-medium tabular">{duracion(c.duracionMs)}</div>
              {c.fin === null && (
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>sin fin registrado</div>
              )}
            </div>
            <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Costo IA en la ventana</div>
              <div className="mt-1 text-sm font-medium tabular">{costo ? usd(costo.costoUsd) : '—'}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>
                {costo ? 'correlación por tiempo, no un join' : 'no correlacionable — ver abajo'}
              </div>
            </div>
          </div>

          {/* ── La corrida, abierta ───────────────────────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>La corrida</TituloSeccion>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 mt-2 text-sm">
              <div className="flex justify-between gap-3 py-1 border-b" style={{ borderColor: 'var(--line2)' }}>
                <span style={{ color: 'var(--muted)' }}>Agente</span>
                <span className="font-medium inline-flex items-center gap-1.5">
                  <Bot width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                  {etiquetaInterruptor(`agente:${c.agente}`)}
                </span>
              </div>
              <div className="flex justify-between gap-3 py-1 border-b" style={{ borderColor: 'var(--line2)' }}>
                <span style={{ color: 'var(--muted)' }}>Flota</span>
                <span className="font-medium">{flota}</span>
              </div>
              <div className="flex justify-between gap-3 py-1 border-b" style={{ borderColor: 'var(--line2)' }}>
                <span style={{ color: 'var(--muted)' }}>Disparo</span>
                <span>{DISPARO[c.disparo] ?? c.disparo}</span>
              </div>
              <div className="flex justify-between gap-3 py-1 border-b" style={{ borderColor: 'var(--line2)' }}>
                <span style={{ color: 'var(--muted)' }}>Inicio</span>
                <span className="tabular">{fechaHoraMx(c.inicio)}</span>
              </div>
              <div className="flex justify-between gap-3 py-1 border-b" style={{ borderColor: 'var(--line2)' }}>
                <span style={{ color: 'var(--muted)' }}>Fin</span>
                <span className="tabular">{c.fin ? fechaHoraMx(c.fin) : 'sin fin registrado'}</span>
              </div>
              <div className="flex justify-between gap-3 py-1 border-b" style={{ borderColor: 'var(--line2)' }}>
                <span style={{ color: 'var(--muted)' }}>Id de la corrida</span>
                <code className="font-mono text-xs">{c.id}</code>
              </div>
            </div>

            {c.error && (
              <div className="mt-3 text-sm rounded-lg px-3 py-2.5" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
                {/* El motivo YA redactado para una persona (0102) — nunca el stack. */}
                {c.error}
              </div>
            )}

            {c.resumen && Object.keys(c.resumen).length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Resumen de la corrida</div>
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <tbody>
                      {Object.entries(c.resumen).map(([k, v]) => (
                        <tr key={k}>
                          <td className="pr-4 py-0.5" style={{ color: 'var(--muted)' }}>{k}</td>
                          <td className="py-0.5"><code className="font-mono text-xs break-all">{JSON.stringify(v)}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── El costo de IA, con su supuesto a la vista ────────────────── */}
          <div className="card p-3">
            <TituloSeccion>Costo de IA en la ventana de la corrida</TituloSeccion>
            {costo ? (
              <>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Llamadas al modelo</div>
                    <div className="mt-1 text-sm font-medium tabular">{numero(costo.llamadas)}</div>
                  </div>
                  <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Tokens (in / out)</div>
                    <div className="mt-1 text-sm font-medium tabular">{numero(costo.tokensIn)} / {numero(costo.tokensOut)}</div>
                  </div>
                  <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Costo</div>
                    <div className="mt-1 text-sm font-medium tabular">{usd(costo.costoUsd)}</div>
                  </div>
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                  Cifra honesta con su supuesto: son las llamadas de ESTA flota registradas en{' '}
                  <code className="font-mono">llm_costo</code> DENTRO de [inicio, fin] de esta corrida —
                  correlación por tiempo, no un join exacto, porque <code className="font-mono">llm_costo</code> no
                  tiene <code className="font-mono">corrida_id</code>. Si otro proceso de la misma flota gastó IA
                  en ese lapso (p. ej. un mensaje de WhatsApp), su costo cae en la ventana.
                </p>
              </>
            ) : (
              <div className="mt-2">
                <EstadoVacio icono={<ListTree width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  {costoNoDisponible ?? 'El costo de esta corrida no se puede correlacionar.'}
                </EstadoVacio>
              </div>
            )}
          </div>

          {/* ── A dónde seguir desde aquí ─────────────────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>Seguir la pista</TituloSeccion>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mt-2">
              {c.tenantId !== null && (
                <Link href={`/dashboard?tenant=${c.tenantId}`}
                  className="hairline rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--canvas)]"
                  style={{ background: 'var(--surface)' }}>
                  <div className="text-[13px] font-medium inline-flex items-center gap-1.5">
                    <ExternalLink width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                    Abrir el panel de esta flota
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    Ver como {flota}. El acceso queda firmado en la bitácora (0110).
                  </div>
                </Link>
              )}
              <Link href="/admin/conversaciones"
                className="hairline rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--canvas)]"
                style={{ background: 'var(--surface)' }}>
                <div className="text-[13px] font-medium inline-flex items-center gap-1.5">
                  <MessageCircle width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                  Conversaciones de WhatsApp
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  La consola cruza todas las flotas — la columna de flota dice cuáles son de {flota}.
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
