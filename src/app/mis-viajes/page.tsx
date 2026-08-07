import { requireOperador } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { mxn } from '@/lib/utils';
import { fechaMx } from '../dashboard/formato';
import { Marco, AltaIncompleta, SinViajesCerrados } from './vista';

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
 * / `operador_ve_sus_liquidaciones`), no un `.eq()` de cortesía.
 *
 * Y aun así los `.eq()` van explícitos, igual que en `lib/likida/chofer.ts`:
 * las dos capas tienen que fallar a la vez para que un chofer vea el viaje de
 * otro. `operador_ve_su_viaje` filtra SOLO por `operador_id` —comprobado
 * contra la base el 4-ago-2026: su `qual` es `operador_id =
 * get_user_operador_id()`, sin tenant—, así que el `.eq('tenant_id')` de aquí
 * no es redundante con ella: es la única línea que ata la lista a la flota.
 *
 * ── EL FK VA NOMBRADO, Y SIN ESO ESTA PÁGINA NO CARGA ────────────────────
 *
 * La 0028 le puso a `liquidacion` una SEGUNDA llave foránea hacia `viaje` —la
 * compuesta `(viaje_id, tenant_id)`—, así que hay dos caminos entre las dos
 * tablas y PostgREST se niega a elegir. `liquidacion(...)` a secas devuelve
 * PGRST201, el `throw` de abajo se dispara y la pantalla entera revienta: no
 * era una lista incompleta, era el panel del chofer caído en producción.
 * Comprobado contra la base real el 4-ago-2026 (`curl` al PostgREST del
 * proyecto): sin nombrar el FK, `PGRST201 "Could not embed because more than
 * one relationship was found"`; nombrándolo, responde. `lib/likida/chofer.ts`
 * ya lo nombraba — esta página se quedó atrás.
 */
async function getMisViajes(tenantId: string, operadorId: string): Promise<ViajeChofer[]> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('viaje')
    .select('id, folio, created_at, liquidacion!liquidacion_viaje_id_fkey(total_comprobado, estatus)')
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
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
  const s = await requireOperador('/mis-viajes');

  // ── ALTA A MEDIAS ≠ "NO TIENES VIAJES" ──────────────────────────────────
  //
  // `app_user.tenant_id` es nullable, y `requireOperador` no lo exige: solo
  // exige `operador_id`. Un chofer al que le crearon la cuenta de Auth y le
  // ligaron su fila de `operador`, pero nunca le pusieron la flota, pasa la
  // puerta con `tenantId` en null. Con el `.eq('tenant_id', null)` de arriba
  // la consulta sale vacía SIEMPRE, y la pantalla le diría "todavía no tienes
  // viajes cerrados" — que es falso y además lo manda a esperar en vez de a
  // hablarle a su oficina. Se dice qué falta, como en /chofer.
  if (!s.tenantId) {
    return (
      <Marco nombre={s.nombre}>
        <AltaIncompleta />
      </Marco>
    );
  }

  const viajes = await getMisViajes(s.tenantId, s.operadorId);

  return (
    <Marco nombre={s.nombre}>
        {viajes.length === 0 ? (
          <SinViajesCerrados />
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
    </Marco>
  );
}

