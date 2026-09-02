import Link from 'next/link';
import { Building2, Wallet, Cpu, Receipt, LifeBuoy, Activity, Sprout } from 'lucide-react';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { usd } from '@/lib/utils';
import { StatCard, StatusPill, type Estado } from '../../ui/kit';
import { BarraPagina, TituloSeccion } from '../../../dashboard/resumen-visual';
import type { FichaCliente } from '@/lib/admin/ficha-cliente';
import type { InterruptorPipelineTenant } from '@/lib/admin/negocio';
import type { AccionDeForma } from '../../ui/forma';
import { SeccionInterruptores } from '../../observabilidad/interruptores-ui';

// ═══════════════════════════════════════════════════════════════════════════
// LA FICHA 360 — el contenido, exportado (patrón page+contenido para poder
// mirarlo en preview sin sesión). Une por PRIMERA vez lo que vivía en tres
// pantallas: /admin/flotas (onboarding/PMF), /admin/soporte (tickets) y
// /admin/observabilidad (costo) — el hueco que el plan hacia el 90% nombró.
// Cada sección degrada POR SU LADO a "no se pudo leer" — jamás un cero con
// cara de medición (los null vienen del lector, sección por sección).
// ═══════════════════════════════════════════════════════════════════════════

const ESTADO_SUSCRIPCION: Record<string, Estado> = {
  activa: 'ok', prueba: 'neutral', morosa: 'bad', pausada: 'warn', cancelada: 'bad',
};
const ESTADO_CORRIDA: Record<string, Estado> = { ok: 'ok', parcial: 'warn', fallo: 'bad' };

function NoSePudo({ que }: { que: string }) {
  return <p className="text-[12.5px] m-0" style={{ color: 'var(--muted)' }}>No se pudo leer {que} ahora mismo — reintenta.</p>;
}

export function Ficha360({ f, interruptoresPipeline, accionInterruptorPipeline }: {
  f: FichaCliente;
  /**
   * ADM-6 (auditoría 24): las palancas del pipeline del chofer de ESTA
   * flota (`interruptor_tenant`, mig. 0297) — `undefined` (props opcionales,
   * mismo criterio que el resto de la ficha) para no romper un preview que
   * siga montando `<Ficha360 f={...} />` sin las props nuevas. `null` =
   * no se pudo leer.
   */
  interruptoresPipeline?: InterruptorPipelineTenant[] | null;
  accionInterruptorPipeline?: AccionDeForma;
}) {
  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;
  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Building2 {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo={`Ficha del cliente — ${f.tenant.nombre}`}
          derecha={
            <Link href={`/dashboard?tenant=${f.tenant.id}&rol=flota_admin`}
              className="hairline text-[12px] font-medium px-3 py-1.5 rounded-full transition-colors hover:bg-[var(--canvas)]"
              style={{ background: 'var(--surface)', color: 'var(--ink2)' }}>
              Ver su panel →
            </Link>
          }
        />

        <div className="px-5 py-4 flex-1 space-y-2.5">
          {/* ── El encabezado: quién es y de dónde vino ─────────────────── */}
          <div className="card p-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="font-display text-[18px] font-semibold tracking-tight truncate">{f.tenant.nombre}</div>
              <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                Plan <span className="cifra-mono">{f.tenant.plan}</span>
                {f.tenant.creadoEn && <> · alta {fechaCorta(f.tenant.creadoEn)}</>}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2 text-[12px]" style={{ color: 'var(--muted)' }}>
              <Sprout {...ICONO} style={{ color: 'var(--muted)' }} />
              {!f.origenLegible ? (
                <span>origen ilegible ahora mismo</span>
              ) : f.origen ? (
                <span>
                  Nació del pipeline: <b>{f.origen.empresa}</b> ({f.origen.fuente}
                  {f.origen.cerradoEn ? `, cerrado ${fechaCorta(f.origen.cerradoEn)}` : ''})
                </span>
              ) : (
                <span>No nació del pipeline de prospectos — alta directa.</span>
              )}
            </div>
          </div>

          {/* ── Operación + consumo, con dato real ──────────────────────── */}
          {f.operacion ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatCard icono={<Activity {...ICONO} />} etiqueta="Viajes liquidados" valor={f.operacion.viajesLiquidados} formato="entero" />
              <StatCard icono={<Wallet {...ICONO} />} etiqueta="Monto comprobado" valor={f.operacion.montoComprobado} formato="mxn" />
              <StatCard icono={<Receipt {...ICONO} />} etiqueta="Liquidaciones por revisar" valor={f.operacion.porRevisar} formato="entero" />
              {f.consumoIa ? (
                <StatCard icono={<Cpu {...ICONO} />} etiqueta="Costo de IA — 30 días" valor={f.consumoIa.d30Usd} formato="usd"
                  nota={`${usd(f.consumoIa.historicoUsd)} histórico`} />
              ) : (
                <div className="card p-3.5"><NoSePudo que="el costo de IA" /></div>
              )}
            </div>
          ) : (
            <div className="card p-3.5"><NoSePudo que="la operación de la flota" /></div>
          )}

          {/* ── Señales de PMF — las tres, con su discriminante honesto ── */}
          <div className="card p-3.5">
            <TituloSeccion>Señales de PMF</TituloSeccion>
            {f.pmf ? (
              <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-[12.5px]">
                <div>
                  <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>PDF descargado</div>
                  {f.pmf.descargas.medida
                    ? <p className="m-0 mt-1">{numero(f.pmf.descargas.porCliente)} de {numero(f.pmf.descargas.liquidaciones)} liquidaciones descargadas por el CLIENTE{f.pmf.descargas.soloDemo > 0 ? ` (${numero(f.pmf.descargas.soloDemo)} solo demo — no cuentan)` : ''}</p>
                    : <p className="m-0 mt-1" style={{ color: 'var(--muted)' }}>No se pudo medir.</p>}
                </div>
                <div>
                  <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Comprobación sola</div>
                  {f.pmf.comprobacionSola.medida
                    ? <p className="m-0 mt-1">{numero(f.pmf.comprobacionSola.sinRecordatorio)} de {numero(f.pmf.comprobacionSola.liquidados)} viajes cerraron sin recordatorio</p>
                    : <p className="m-0 mt-1" style={{ color: 'var(--muted)' }}>No se pudo medir.</p>}
                </div>
                <div>
                  <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Tickets del cliente</div>
                  {f.pmf.tickets.medida
                    ? <p className="m-0 mt-1">{numero(f.pmf.tickets.delCliente)} abiertos por la flota · {numero(f.pmf.tickets.deLikida)} por Likida</p>
                    : <p className="m-0 mt-1" style={{ color: 'var(--muted)' }}>No se pudo medir.</p>}
                </div>
              </div>
            ) : <div className="mt-2"><NoSePudo que="las señales de PMF" /></div>}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {/* ── Facturación SaaS ───────────────────────────────────────── */}
            <div className="card p-3.5">
              <TituloSeccion>Facturación SaaS</TituloSeccion>
              <div className="mt-2 space-y-1.5 text-[12.5px]">
                {!f.suscripcionLegible ? (
                  <NoSePudo que="la suscripción" />
                ) : f.suscripcion ? (
                  <div className="flex items-center gap-2">
                    <StatusPill estado={ESTADO_SUSCRIPCION[f.suscripcion.estado] ?? 'neutral'}>{f.suscripcion.estado}</StatusPill>
                    <span>{f.suscripcion.planNombre}</span>
                    <span style={{ color: 'var(--faint)' }}>desde {fechaCorta(f.suscripcion.inicio)}</span>
                  </div>
                ) : (
                  <p className="m-0" style={{ color: 'var(--muted)' }}>Sin suscripción — todavía no es cliente de pago.</p>
                )}
                {f.facturasSaas === null ? (
                  <NoSePudo que="las facturas SaaS" />
                ) : f.facturasSaas.length === 0 ? (
                  <p className="m-0" style={{ color: 'var(--faint)' }}>Cero facturas SaaS emitidas.</p>
                ) : (
                  // FE-19: scrollea dentro de la tarjeta — un periodo largo o
                  // una cifra de muchos dígitos no puede estirar la página.
                  <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {f.facturasSaas.map((x) => (
                        <tr key={x.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                          <td className="py-1.5">{fechaCorta(x.periodoInicio)} — {fechaCorta(x.periodoFin)}</td>
                          <td className="py-1.5 cifra-mono text-right">{mxn(x.monto)}</td>
                          <td className="py-1.5 text-right" style={{ color: 'var(--muted)' }}>{x.estado}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </div>

            {/* ── Soporte ────────────────────────────────────────────────── */}
            <div className="card p-3.5">
              <TituloSeccion>Soporte</TituloSeccion>
              <div className="mt-2 text-[12.5px]">
                {f.tickets === null ? (
                  <NoSePudo que="los tickets" />
                ) : f.tickets.length === 0 ? (
                  <div className="flex items-center gap-2" style={{ color: 'var(--faint)' }}>
                    <LifeBuoy {...ICONO} /> Cero tickets de esta flota.
                  </div>
                ) : (
                  // FE-19: mismo criterio — el asunto de un ticket es texto
                  // libre y ya viene truncado, pero el pill puede desbordar.
                  <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {f.tickets.slice(0, 5).map((x) => (
                        <tr key={x.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                          <td className="py-1.5 max-w-[220px] truncate">{x.asunto}</td>
                          <td className="py-1.5 text-right">
                            <StatusPill estado={x.estado === 'resuelto' ? 'ok' : x.horasRestantes !== null && x.horasRestantes < 0 ? 'bad' : 'neutral'}>{x.estado}</StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── ADM-6 (auditoría 24): interruptores del pipeline del chofer,
              POR FLOTA — a diferencia de las 58 palancas de Observabilidad
              (agentes de back office + 'global', que apagarían TODAS las
              flotas a la vez), estas tres cortan solo whatsapp/ocr/cuadre
              de ESTA flota. Mismo componente que Observabilidad
              (SeccionInterruptores): la firma solo necesita
              id/apagado/motivo/cambiadoPorNombre/cambiadoEn. */}
          {interruptoresPipeline !== undefined && accionInterruptorPipeline && (
            <div className="card p-3.5">
              <TituloSeccion>Pipeline del chofer — palancas de esta flota</TituloSeccion>
              <div className="mt-2">
                {interruptoresPipeline === null ? (
                  <NoSePudo que="los interruptores del pipeline" />
                ) : (
                  <SeccionInterruptores
                    interruptores={interruptoresPipeline.map((i) => ({
                      id: `pipeline:${i.pipeline}`,
                      apagado: i.apagado,
                      motivo: i.motivo,
                      cambiadoPorNombre: i.cambiadoPorNombre,
                      cambiadoEn: i.cambiadoEn,
                    }))}
                    accion={accionInterruptorPipeline}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── El pulso: últimas corridas de agentes de ESTA flota ──────── */}
          <div className="card p-3.5">
            <TituloSeccion>Últimas corridas de agentes</TituloSeccion>
            <div className="mt-2 text-[12.5px]">
              {f.corridas === null ? (
                <NoSePudo que="las corridas" />
              ) : f.corridas.length === 0 ? (
                <p className="m-0" style={{ color: 'var(--faint)' }}>Cero corridas de agentes para esta flota.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {f.corridas.map((c, i) => (
                    <div key={i} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2" style={{ background: 'var(--surface)' }}>
                      <StatusPill estado={ESTADO_CORRIDA[c.estado] ?? 'neutral'}>{c.estado}</StatusPill>
                      <span className="cifra-mono">{c.agente}</span>
                      <span style={{ color: 'var(--faint)' }}>{c.disparo} · {fechaCorta(c.fin)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
