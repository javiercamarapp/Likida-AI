import { Gauge } from 'lucide-react';
import { getTechosIa, TECHO_IA_MAX_USD, TECHO_IA_MIN_USD, type FilaTechoIa, type TechosIa } from '@/lib/admin/techo_ia';
import { usd } from '@/lib/utils';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoError, StatusPill, type Estado } from '../ui/kit';
import { guardarTechoIa } from './acciones';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/techo-ia — EL TECHO DIARIO DE IA DE CADA FLOTA (Ola 9). La puerta es la del layout de /admin
// (`requireSuperadmin`) y otra vez la de la acción. Cada fila dice DE DÓNDE sale el techo que de verdad
// se aplica (declarado por el superadmin, derivado del plan o el piso global) y cuánto lleva hoy.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGEN: Record<FilaTechoIa['origen'], { estado: Estado; rotulo: string }> = {
  tenant: { estado: 'ok', rotulo: 'Declarado' },
  plan: { estado: 'neutral', rotulo: 'Del plan' },
  piso: { estado: 'warn', rotulo: 'Piso global' },
  explicito: { estado: 'neutral', rotulo: 'Explícito' },
};

const MENSAJE_OK: Record<string, string> = {
  fijado: 'Techo guardado. Esta instancia lo aplica ya; las demás en menos de un minuto.',
  quitado: 'Declaración quitada: la flota vuelve al techo de su plan (o al piso).',
};

export default async function TechoIaPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  let datos: TechosIa | null = null;
  try {
    datos = await getTechosIa();
  } catch {
    datos = null;
  }
  if (datos === null) {
    return (
      <main className="p-5">
        <EstadoError mensaje="No se pudo leer la lista de flotas ni sus techos — la base no respondió. Esto NO significa que no haya techos: la IA sigue frenada por el techo que cada flota ya tiene." />
      </main>
    );
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Gauge width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Techo diario de IA — por flota" />
        <div className="px-5 py-4 flex-1 space-y-3">
          {sp.ok && MENSAJE_OK[sp.ok] && (
            <p role="status" className="text-sm rounded-xl px-4 py-2.5 m-0" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>{MENSAJE_OK[sp.ok]}</p>
          )}
          {sp.error && (
            <p role="alert" className="text-sm rounded-xl px-4 py-2.5 m-0" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>{sp.error}</p>
          )}

          <div className="card p-4">
            <TituloSeccion>Cómo se decide el techo de una flota</TituloSeccion>
            <p className="text-[12.5px] mt-1.5 m-0" style={{ color: 'var(--muted)' }}>
              1) el que declares aquí; 2) si no hay, el que le toca por el tamaño de su plan; 3) si tampoco, el piso global de{' '}
              <span className="tabular">{usd(datos.pisoUsd)}</span> al día. Pasado el techo, la IA de esa flota se frena hasta el día siguiente
              (el camino del chofer conserva una reserva). Rango declarable: {usd(TECHO_IA_MIN_USD)} a {usd(TECHO_IA_MAX_USD)} por día;
              para apagar la IA de una flota usa el interruptor, no un techo de cero.
            </p>
            {datos.gastoIlegible && (
              <p className="text-[12.5px] mt-2 m-0" style={{ color: 'var(--bad)' }}>
                El gasto de hoy no se pudo leer ahora mismo: la columna «Hoy» queda en blanco, que NO significa cero.
              </p>
            )}
            {datos.truncado && (
              <p className="text-[12.5px] mt-2 m-0" style={{ color: 'var(--muted)' }}>Hay más flotas de las que caben en esta pantalla; se muestran las primeras por nombre.</p>
            )}
          </div>

          <div className="card p-4">
            <TituloSeccion>Flotas</TituloSeccion>
            {datos.filas.length === 0 ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>Todavía no hay flotas dadas de alta.</p>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: 'var(--line)' }}>
                      <th scope="col" className="py-1.5 text-[11px] uppercase font-semibold" style={{ color: 'var(--muted)' }}>Flota</th>
                      <th scope="col" className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Techo que aplica</th>
                      <th scope="col" className="py-1.5 text-[11px] uppercase font-semibold" style={{ color: 'var(--muted)' }}>Origen</th>
                      <th scope="col" className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Hoy</th>
                      <th scope="col" className="py-1.5 text-[11px] uppercase font-semibold" style={{ color: 'var(--muted)' }}>Declarar techo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.filas.map((f) => {
                      const o = ORIGEN[f.origen];
                      return (
                        <tr key={f.tenantId} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                          <td className="py-2">{f.nombre}</td>
                          <td className="py-2 text-right tabular">{usd(f.topeUsd)}</td>
                          <td className="py-2"><StatusPill estado={o.estado}>{o.rotulo}</StatusPill></td>
                          <td className="py-2 text-right">
                            {f.usadoHoyUsd === null ? (
                              <span style={{ color: 'var(--muted)' }}>sin medir</span>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <span className="inline-block w-16 h-1 rounded-full overflow-hidden align-middle" style={{ background: 'var(--line2)' }}>
                                  <span className="block h-full rounded-full" style={{ width: `${f.pctUsado ?? 0}%`, background: (f.pctUsado ?? 0) >= 80 ? 'var(--bad)' : 'var(--marca)' }} />
                                </span>
                                <span className="tabular text-[11.5px]">{usd(f.usadoHoyUsd)} · {f.pctUsado ?? 0}%</span>
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            <form action={guardarTechoIa} className="flex items-center gap-1.5">
                              <input type="hidden" name="tenantId" value={f.tenantId} />
                              <label className="sr-only" htmlFor={`techo-${f.tenantId}`}>Techo diario en dólares para {f.nombre}</label>
                              <input
                                id={`techo-${f.tenantId}`} name="techoUsd" inputMode="decimal" autoComplete="off"
                                defaultValue={f.declaradoUsd === null ? '' : String(f.declaradoUsd)}
                                placeholder="sin declarar"
                                className="w-24 rounded-md px-2 py-1 text-[12.5px] tabular"
                                style={{ border: '1px solid var(--line)', background: 'var(--g1)' }}
                              />
                              <button type="submit" className="rounded-md px-2.5 py-1 text-[12px] font-medium" style={{ border: '1px solid var(--line)' }}>
                                {f.declaradoUsd === null ? 'Fijar' : 'Cambiar'}
                              </button>
                            </form>
                            {f.declaradoUsd !== null && (
                              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>Déjalo vacío y guarda para quitar la declaración.</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
