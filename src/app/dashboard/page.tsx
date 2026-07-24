import Link from 'next/link';
import { getSessionTenant } from '@/lib/auth/session';
import { getKpis, detectarAnomalias, type DashboardKpis, type Anomalia } from '@/lib/cuadra/analytics';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mxn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ESTATUS_COLOR: Record<string, string> = {
  cuadrada: 'var(--color-ok)',
  con_diferencias: 'var(--color-warn)',
  revisar: 'var(--color-bad)',
};

export default async function DashboardPage() {
  const session = await getSessionTenant();
  const tenantId = session?.tenantId ?? null;

  let kpis: DashboardKpis | null = null;
  let anomalias: Anomalia[] = [];
  let liquidaciones: Array<{ id: string; estatus: string; total_comprobado: number; diferencia: number; created_at: string; folio: string }> = [];

  if (tenantId) {
    try {
      [kpis, anomalias] = await Promise.all([getKpis(tenantId), detectarAnomalias(tenantId)]);
      const { data } = await supabaseAdmin()
        .from('liquidacion')
        .select('id, estatus, total_comprobado, diferencia, created_at, viaje:viaje_id(folio)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(12);
      liquidaciones = (data ?? []).map((r) => ({
        id: r.id as string, estatus: r.estatus as string,
        total_comprobado: Number(r.total_comprobado), diferencia: Number(r.diferencia),
        created_at: (r.created_at as string).slice(0, 10),
        folio: ((r.viaje as { folio?: string } | null)?.folio) ?? r.id.slice(0, 8),
      }));
    } catch { /* datos aún no disponibles */ }
  }

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-semibold tracking-tight">Cuadra</span>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>· Panel</span>
          </div>
          <a href="/api/export/liquidaciones"
            className="text-sm px-3 py-1.5 rounded-lg hairline font-medium">Exportar a Excel</a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 animate-in">
        {!kpis && (
          <div className="card p-8 text-center" style={{ color: 'var(--muted)' }}>
            <p className="text-lg font-medium" style={{ color: 'var(--ink)' }}>Aún no hay liquidaciones.</p>
            <p className="mt-2 text-sm">Conecta tu cuenta y da de alta operadores. En cuanto cierren su primer viaje por WhatsApp, aquí verás todo.</p>
            <Link href="/demo" className="inline-block mt-5 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'var(--color-accent-fg)' }}>Ver el demo</Link>
          </div>
        )}

        {kpis && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Kpi label="Viajes liquidados" value={String(kpis.viajesLiquidados)} />
              <Kpi label="Monto comprobado" value={mxn(kpis.montoComprobado)} />
              <Kpi label="Diferencias detectadas" value={mxn(kpis.diferenciaDetectada)} accent />
              <Kpi label="Tasa de cuadre" value={`${kpis.tasaCuadre}%`} />
            </div>

            {anomalias.length > 0 && (
              <div className="card p-5 mt-6" style={{ borderColor: 'var(--color-warn)' }}>
                <div className="font-medium mb-3">⚠ Anomalías detectadas</div>
                <ul className="space-y-2 text-sm">
                  {anomalias.map((a, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{a.detalle}</span>
                      <span className="tabular font-medium">{mxn(a.monto)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card mt-6 overflow-hidden">
              <div className="px-5 py-3 border-b font-medium" style={{ borderColor: 'var(--line)' }}>Liquidaciones recientes</div>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-5 py-2 font-medium">Folio</th>
                    <th className="px-5 py-2 font-medium">Fecha</th>
                    <th className="px-5 py-2 font-medium text-right">Comprobado</th>
                    <th className="px-5 py-2 font-medium text-right">Diferencia</th>
                    <th className="px-5 py-2 font-medium">Estatus</th>
                  </tr>
                </thead>
                <tbody>
                  {liquidaciones.map((l) => (
                    <tr key={l.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-5 py-2.5">{l.folio}</td>
                      <td className="px-5 py-2.5" style={{ color: 'var(--muted)' }}>{l.created_at}</td>
                      <td className="px-5 py-2.5 text-right tabular">{mxn(l.total_comprobado)}</td>
                      <td className="px-5 py-2.5 text-right tabular">{mxn(l.diferencia)}</td>
                      <td className="px-5 py-2.5">
                        <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: ESTATUS_COLOR[l.estatus] ?? 'var(--muted)' }} />
                        {l.estatus.replace('_', ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-5">
      <div className="text-2xl font-semibold tracking-tight tabular" style={accent ? { color: 'var(--accent)' } : undefined}>{value}</div>
      <div className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}
