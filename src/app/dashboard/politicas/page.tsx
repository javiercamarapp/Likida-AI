import { ScrollText, Info } from 'lucide-react';
import { getConfig } from '@/lib/cuadra/config';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Políticas (PASO 23) — los topes REALES contra los que el motor cuadra cada
 * viaje de esta flota, leídos de `tenant.config.politica` con `getConfig()`,
 * que es la misma función que usa el motor. No es una pantalla informativa:
 * es la regla que decide si un gasto sale marcado.
 *
 * `politica_gasto` (la tabla) NO se lee aquí a propósito: está MUERTA — su
 * propio comentario en el esquema lo dice, no la lee nadie. Enseñarla haría
 * que el dueño edite mentalmente una regla que el motor no aplica.
 */
export default async function PoliticasPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/politicas', sp);

  let config;
  try {
    config = await getConfig(tenantId);
  } catch {
    config = null;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ScrollText width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Políticas</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Los topes contra los que el motor cuadra cada viaje de tu flota
          </span>
        </div>
      </header>

      {config === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer la configuración de esta flota.
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <div className="pt-5 pb-2 px-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Topes por concepto
            </h2>
          </div>
          {config.politica.length === 0 ? (
            <div className="px-5 pb-5">
              <EstadoVacio>Esta flota no tiene topes configurados — el motor no marcará nada por política.</EstadoVacio>
            </div>
          ) : (
            <div className="overflow-x-auto mt-1 pb-2">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-5 py-2.5 font-medium">Concepto</th>
                    <th className="px-5 py-2.5 font-medium text-right">Tope por comprobante</th>
                    <th className="px-5 py-2.5 font-medium">Exige factura (CFDI)</th>
                  </tr>
                </thead>
                <tbody>
                  {config.politica.map((p) => (
                    <tr key={p.concepto} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-5 py-3 font-medium">{etiquetaConcepto(p.concepto)}</td>
                      <td className="px-5 py-3 text-right tabular">
                        {p.topeMonto === undefined
                          ? <span style={{ color: 'var(--muted)' }}>Sin tope</span>
                          : mxn(p.topeMonto)}
                      </td>
                      <td className="px-5 py-3">
                        {p.requiereCfdi
                          ? <StatusPill estado="warn">Sí</StatusPill>
                          : <span style={{ color: 'var(--muted)' }}>No</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Topes fiscales que aplica el motor
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{mxn(config.estimulos.viaticosTopeFiscalDiarioMxn)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Tope diario de alimentación nacional — LISR Art. 28-V. Lo que exceda sale marcado como no deducible.
                </div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{mxn(config.estimulos.efectivoTopeMxn)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Tope de gasto en efectivo (no combustible) — LISR Art. 27-III. Arriba de esto exige otra forma de pago.
                </div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{Math.round(config.estimulos.peajeFactor * 100)}%</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Del gasto de peaje es acreditable — estímulo de autopistas, LIF 2026 Art. 20-A.
                </div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{Math.round(config.tabulador.umbralDesviacion * 100)}%</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Desviación de consumo a partir de la cual el motor levanta la mano.
                </div>
              </div>
            </div>
          </section>

          <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <EstadoVacio icono={<Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Esta pantalla es de lectura: editar los topes desde aquí todavía no existe (hoy se cambian en la
              configuración del tenant). Los viáticos por ruta/día y el plazo de comprobación del anticipo tampoco
              están en el esquema como reglas configurables.
            </EstadoVacio>
          </div>
        </div>
      )}
    </div>
  );
}
