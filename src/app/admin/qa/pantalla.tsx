import Link from 'next/link';
import { Bug, Camera, DollarSign, ListChecks, AlertTriangle, History } from 'lucide-react';
import { fechaHoraMx, numero, usd, usd4 } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, StatusPill, EstadoVacio, type Estado } from '../ui/kit';
import { resumenVeredicto, type CorridaQA, type EstadoCorrida } from '@/lib/admin/qa-tipos';
import { LanzarForm, type FotoConUrl } from './lanzar-form';

const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

export const PILL_CORRIDA: Record<EstadoCorrida, { estado: Estado; etiqueta: string }> = {
  pendiente: { estado: 'neutral', etiqueta: 'Pendiente' },
  corriendo: { estado: 'neutral', etiqueta: 'Corriendo' },
  ok: { estado: 'ok', etiqueta: 'OK' },
  parcial: { estado: 'warn', etiqueta: 'Parcial' },
  fallo: { estado: 'bad', etiqueta: 'Fallo' },
  abortada: { estado: 'bad', etiqueta: 'Abortada' },
};

/**
 * LA PANTALLA de /admin/qa — presentacional a propósito (la página server le
 * pasa los datos ya leídos): así el preview de verificación visual importa el
 * componente REAL, nunca una copia. Anatomía FlowAI del resto de /admin
 * (molde: escalaciones/page.tsx): BarraPagina + tarjetas sobre --g1, errores
 * POR FUENTE dichos — jamás un 0 sobre una lectura que falló.
 */
export function PantallaQa({ fotos, bancoError, corridas, historialError, gastoHoy, gastoError, topeDiaUsd }: {
  fotos: FotoConUrl[];
  bancoError: string | null;
  corridas: CorridaQA[];
  historialError: string | null;
  gastoHoy: number | null;
  gastoError: string | null;
  topeDiaUsd: number;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Bug {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="QA autónomo — fotos reales contra el pipeline real"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {/* ── Los tres números del panel ─────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {bancoError === null ? (
              <StatCard icono={<Camera {...ICONO} />} etiqueta="Fotos en el banco" valor={fotos.length} formato="entero" />
            ) : (
              <TarjetaFuenteCaida titulo="Banco de fotos" error={bancoError} />
            )}
            {historialError === null ? (
              <StatCard icono={<ListChecks {...ICONO} />} etiqueta="Corridas lanzadas" valor={corridas.length} formato="entero" />
            ) : (
              <TarjetaFuenteCaida titulo="Historial" error={historialError} />
            )}
            {gastoError === null && gastoHoy !== null ? (
              <div className="card p-2 h-full flex flex-col min-w-0">
                <div className="rounded-xl px-3 py-2 min-w-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                      <DollarSign {...ICONO} />
                    </div>
                    <div className="text-[13px] min-w-0 flex-1" style={{ color: 'var(--muted)' }}>Gasto real de hoy</div>
                  </div>
                  <div className="font-display text-[20px] leading-tight font-semibold tabular mt-0.5">{usd4(gastoHoy)}</div>
                </div>
                <div className="grow" />
                <p className="text-xs mx-1.5 mt-1.5 pt-1.5 pb-0" style={{ borderTop: '1px dashed var(--line2)', color: 'var(--faint)' }}>
                  de {usd(topeDiaUsd)} de tope diario — suma de llm_costo por corrida, nunca estimado
                </p>
              </div>
            ) : (
              <TarjetaFuenteCaida titulo="Gasto de hoy" error={gastoError ?? 'sin dato'} />
            )}
          </div>

          {/* ── Lanzar una corrida ─────────────────────────────────────────── */}
          <LanzarForm
            fotosIniciales={fotos}
            bancoError={bancoError}
            gastoHoyUsd={gastoHoy}
            gastoError={gastoError}
            topeDiaUsd={topeDiaUsd}
          />

          {/* ── El historial ───────────────────────────────────────────────── */}
          {historialError !== null ? null : corridas.length === 0 ? (
            <EstadoVacio icono={<History width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              <span className="font-semibold">Todavía no hay corridas.</span>{' '}
              Elige un escenario arriba, marca tus fotos y aprieta «Lanzar corrida» — el veredicto
              con su evidencia queda aquí, con su costo real.
            </EstadoVacio>
          ) : (
            <div className="card overflow-hidden">
              <div className="px-4 pt-3 pb-1">
                <TituloSeccion>Historial de corridas — más nuevas primero</TituloSeccion>
              </div>
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-4 py-2 font-medium">Corrida</th>
                      <th className="px-4 py-2 font-medium">Escenario</th>
                      <th className="px-4 py-2 font-medium">Lanzada</th>
                      <th className="px-4 py-2 font-medium">Estado</th>
                      <th className="px-4 py-2 font-medium text-right">Veredicto</th>
                      <th className="px-4 py-2 font-medium text-right">Costo real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corridas.map((c) => {
                      const pill = PILL_CORRIDA[c.estado] ?? { estado: 'neutral' as Estado, etiqueta: c.estado };
                      const res = resumenVeredicto(c.veredicto);
                      return (
                        <tr key={c.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                          <td className="px-4 py-2.5">
                            <Link href={`/admin/qa/${c.id}`} className="font-mono text-xs font-medium hover:opacity-70">
                              {c.id.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5">{c.escenario === 'demo_guion' ? 'Guion del demo' : 'Feliz'}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs" style={{ color: 'var(--muted)' }}>{fechaHoraMx(c.creadaEn)}</td>
                          <td className="px-4 py-2.5"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular text-xs">
                            {res ? `✅ ${res.ok} · ⚠️ ${res.noVerificado} · ❌ ${res.fallo}` : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular text-xs">{usd4(c.costoUsdTotal ?? 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs px-4 pt-2 pb-3" style={{ color: 'var(--muted)' }}>
                {numero(corridas.length)} {corridas.length === 1 ? 'corrida' : 'corridas'}. Cada una corrió contra un
                tenant sintético «ZZZ QA …» propio, borrado al terminar salvo retención — jamás contra datos reales.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/** Una fuente que no se pudo leer se dice — nunca un 0 con cara de medición. */
function TarjetaFuenteCaida({ titulo, error }: { titulo: string; error: string }) {
  return (
    <div className="card p-3 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--badbg)' }}>
        <AlertTriangle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />
      </div>
      <p className="text-sm pt-1">
        <span className="font-semibold">{titulo}: no se pudo leer.</span>
        <span className="block text-xs mt-0.5 font-mono" style={{ color: 'var(--muted)' }}>{error}</span>
      </p>
    </div>
  );
}
