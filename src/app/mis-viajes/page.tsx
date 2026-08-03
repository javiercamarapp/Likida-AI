import { requireOperador } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { mxn } from '@/lib/utils';
import { fechaMx } from '../dashboard/formato';

export const dynamic = 'force-dynamic';

const ESTATUS: Record<string, { label: string; color: string }> = {
  cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' },
  con_diferencias: { label: 'Con diferencias', color: 'var(--color-warn)' },
  revisar: { label: 'Por revisar', color: 'var(--color-bad)' },
};

interface ViajeChofer { id: string; folio: string; creadoEn: string; comprobado: number; estatus: string | null }

/**
 * Cliente CON sesión (`supabaseServer`), no `supabaseAdmin`: aquí el
 * aislamiento lo hace RLS de verdad (mig. 0045, policy `operador_ve_su_viaje`
 * / `operador_ve_sus_liquidaciones`), no un `.eq()` de cortesía. Un `.eq()`
 * que se le olvide a alguien en este archivo seguiría sin filtrar de más:
 * la base ya no tiene los viajes de otro chofer que enseñarle.
 */
async function getMisViajes(): Promise<ViajeChofer[]> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('viaje')
    .select('id, folio, created_at, liquidacion(total_comprobado, estatus)')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`getMisViajes: ${error.message}`);
  return (data ?? []).map((v) => {
    const liq = (Array.isArray(v.liquidacion) ? v.liquidacion[0] : v.liquidacion) as
      { total_comprobado?: number; estatus?: string } | null;
    return {
      id: v.id as string,
      folio: (v.folio as string) || (v.id as string).slice(0, 8),
      creadoEn: v.created_at as string,
      comprobado: Number(liq?.total_comprobado ?? 0),
      estatus: liq?.estatus ?? null,
    };
  });
}

export default async function MisViajes() {
  const { nombre } = await requireOperador();
  const viajes = await getMisViajes();

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-3xl mx-auto px-8 h-16 flex items-center justify-between">
          <span className="font-semibold tracking-tight text-xl">Likida</span>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>{nombre ?? 'Mis viajes'}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-8 py-10 space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mis viajes</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Solo lectura — para mandar comprobantes, sigue usando WhatsApp.
        </p>

        {viajes.length === 0 ? (
          <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>
            Todavía no tienes viajes cerrados.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr style={{ color: 'var(--muted)' }} className="text-left text-sm">
                  <th className="px-6 py-3 font-medium">Folio</th>
                  <th className="px-6 py-3 font-medium">Fecha</th>
                  <th className="px-6 py-3 font-medium text-right">Comprobado</th>
                  <th className="px-6 py-3 font-medium">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {viajes.map((v) => {
                  const e = v.estatus ? (ESTATUS[v.estatus] ?? { label: v.estatus, color: 'var(--muted)' }) : null;
                  return (
                    <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-6 py-4 font-medium">{v.folio}</td>
                      <td className="px-6 py-4" style={{ color: 'var(--muted)' }}>{fechaMx(v.creadoEn)}</td>
                      <td className="px-6 py-4 text-right tabular">{mxn(v.comprobado)}</td>
                      <td className="px-6 py-4">
                        {e ? (
                          <>
                            <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: e.color }} />
                            {e.label}
                          </>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>Sin liquidar</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
