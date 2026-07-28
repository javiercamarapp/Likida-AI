import Link from 'next/link';
import { getKpis, getAcreditables, detectarAnomalias, type DashboardKpis, type Acreditables, type Anomalia } from '@/lib/cuadra/analytics';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mxn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TENANT = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

const ESTATUS = {
  cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' },
  con_diferencias: { label: 'Con diferencias', color: 'var(--color-warn)' },
  revisar: { label: 'Por revisar', color: 'var(--color-bad)' },
} as const;

/** Resiliencia por sección: si una consulta falla, devuelve null y la tarjeta
 *  muestra un fallback en vez de tirar toda la pantalla. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

interface LiqRow { id: string; folio: string; fecha: string; comprobado: number; diferencia: number; estatus: string }

async function getLiquidaciones(tenantId: string): Promise<LiqRow[]> {
  const { data } = await supabaseAdmin()
    .from('liquidacion')
    .select('id, estatus, total_comprobado, diferencia, created_at, viaje:viaje_id(folio)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    folio: ((r.viaje as { folio?: string } | null)?.folio) ?? (r.id as string).slice(0, 8),
    fecha: (r.created_at as string).slice(0, 10),
    comprobado: Number(r.total_comprobado ?? 0),
    diferencia: Number(r.diferencia ?? 0),
    estatus: r.estatus as string,
  }));
}

export default async function DashboardPage() {
  const tenantId = TENANT();
  const [acred, kpis, liqs, anomalias] = await Promise.all([
    safe<Acreditables>(() => getAcreditables(tenantId)),
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<LiqRow[]>(() => getLiquidaciones(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
  ]);

  // Distinguir un FALLO de carga (todo null) de un cero real: si las 3 consultas
  // fallaron, es error de datos, no "aún no hay liquidaciones" (frontend #1).
  const errorCarga = acred === null && kpis === null && liqs === null;
  const sinDatos = !errorCarga && (kpis?.viajesLiquidados ?? 0) === 0 && (liqs?.length ?? 0) === 0;

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-6xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-semibold tracking-tight text-xl">Likida</span>
            <span className="text-base" style={{ color: 'var(--muted)' }}>· Panel de liquidación</span>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full" style={{ color: 'var(--muted)', background: 'color-mix(in srgb, var(--muted) 10%, transparent)' }}>
            datos de demostración
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-10 space-y-10">
        {errorCarga ? (
          <div className="card p-12 text-center">
            <p className="text-2xl font-semibold tracking-tight">No se pudieron cargar los datos</p>
            <p className="mt-3 text-base" style={{ color: 'var(--muted)' }}>
              Hubo un problema al leer del sistema. Recarga la página en un momento.
            </p>
          </div>
        ) : sinDatos ? (
          <div className="card p-12 text-center">
            <p className="text-2xl font-semibold tracking-tight">Aún no hay liquidaciones</p>
            <p className="mt-3 text-base" style={{ color: 'var(--muted)' }}>
              En cuanto un operador cierre su primer viaje por WhatsApp, aquí aparecerán los acreditables y el detalle.
            </p>
            <Link href="/demo" className="inline-block mt-6 px-5 py-2.5 rounded-xl text-base font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Ver el demo</Link>
          </div>
        ) : (
          <>
            {/* ── HERO: acreditables del periodo (lo que hace enderezarse al contralor) ── */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
                Estímulos acreditables del periodo
              </h2>
              {acred === null ? (
                <div className="card p-8" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <Acred titulo="IEPS de diésel" valor={acred.ieps} base="Acreditable vs ISR · LIF 2026, Art. 20" destacar />
                  <Acred titulo="IVA acreditable" valor={acred.iva} base="LIVA, Art. 5 — CFDI con IVA desglosado" />
                  <Acred titulo="Peaje (50%)" valor={acred.peaje} base="Estímulo de autopistas · LIF 2026, Art. 20-A" />
                </div>
              )}
            </section>

            {/* ── Liquidaciones del periodo ── */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
                Liquidaciones del periodo
              </h2>
              {kpis === null ? (
                <div className="card p-8" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                  <Kpi label="Viajes liquidados" value={String(kpis.viajesLiquidados)} />
                  <Kpi label="Monto comprobado" value={mxn(kpis.montoComprobado)} />
                  <Kpi label="Con diferencia" value={String(kpis.conDiferencias + kpis.porRevisar)} />
                  <Kpi label="Tasa de cuadre" value={`${kpis.tasaCuadre}%`} />
                </div>
              )}
            </section>

            {/* ── Mismo comprobante en dos viajes ──
                Cada liquidación se ve impecable por separado: esto solo se ve
                mirando TODAS juntas. Se muestra únicamente si hay algo — una
                sección vacía que dice "0 anomalías" entrena a ignorarla. */}
            {anomalias !== null && anomalias.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
                  Revisar · mismo comprobante en varios viajes
                </h2>
                <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
                  {anomalias.map((a, i) => (
                    <div key={i} className="flex items-center justify-between gap-4 p-4">
                      <div>
                        <div className="text-sm">{a.detalle}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                          Viajes: {a.viajes.join(' · ')}
                        </div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums whitespace-nowrap">{mxn(a.monto)}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                  Coincidencia detectada, no un veredicto: verifica antes de conversarlo con el operador.
                </p>
              </section>
            )}

            {/* ── Tabla (cada fila abre el detalle) ── */}
            <section>
              {liqs === null ? (
                <div className="card p-8" style={{ color: 'var(--muted)' }}>No se pudo cargar el listado.</div>
              ) : (
                <div className="card overflow-hidden">
                  <table className="w-full text-base">
                    <thead>
                      <tr style={{ color: 'var(--muted)' }} className="text-left text-sm">
                        <th className="px-6 py-3 font-medium">Folio</th>
                        <th className="px-6 py-3 font-medium">Fecha</th>
                        <th className="px-6 py-3 font-medium text-right">Comprobado</th>
                        <th className="px-6 py-3 font-medium text-right">Diferencia</th>
                        <th className="px-6 py-3 font-medium">Estatus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liqs.map((l) => {
                        const e = ESTATUS[l.estatus as keyof typeof ESTATUS] ?? { label: l.estatus, color: 'var(--muted)' };
                        return (
                          <tr key={l.id} className="border-t hover:opacity-80" style={{ borderColor: 'var(--line)' }}>
                            <td className="px-6 py-4 font-medium">
                              <Link href={`/dashboard/${l.id}`} className="hover:underline">{l.folio}</Link>
                            </td>
                            <td className="px-6 py-4" style={{ color: 'var(--muted)' }}>{l.fecha}</td>
                            <td className="px-6 py-4 text-right tabular">{mxn(l.comprobado)}</td>
                            <td className="px-6 py-4 text-right tabular">{l.diferencia === 0 ? '—' : mxn(Math.abs(l.diferencia))}</td>
                            <td className="px-6 py-4">
                              <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: e.color }} />
                              {e.label}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Acred({ titulo, valor, base, destacar }: { titulo: string; valor: number; base: string; destacar?: boolean }) {
  return (
    <div className="card p-7" style={destacar ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="text-sm font-medium" style={{ color: 'var(--muted)' }}>{titulo}</div>
      <div className="text-4xl md:text-5xl font-semibold tracking-tight tabular mt-2"
        style={{ color: destacar ? 'var(--accent)' : 'var(--ink)' }}>{mxn(valor)}</div>
      <div className="text-xs mt-3" style={{ color: 'var(--muted)' }}>{base}</div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-6">
      <div className="text-3xl font-semibold tracking-tight tabular">{value}</div>
      <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}
