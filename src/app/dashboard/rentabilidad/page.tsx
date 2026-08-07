import { TrendingUp, ArrowDownRight, Percent, Wallet } from 'lucide-react';
import { exigirVerRuta } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getRentabilidad, type Rentabilidad } from '@/lib/likida/comercial';
import { EstadoVacio, KpiTile } from '../../admin/ui/kit';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * RENTABILIDAD — la pantalla que más fácil se vuelve mentira, y por eso la
 * regla aquí es más estricta que en el resto del panel.
 *
 * EL MARGEN NO SE CALCULA CON EL ANTICIPO. Es la tentación obvia porque
 * `viaje.anticipo` siempre está lleno, y produce números que se ven bien y
 * están mal: el anticipo es lo que la empresa le ADELANTA al operador, no lo
 * que le paga el cliente. Mientras falte `ingreso_flete`, esta pantalla dice
 * cuántos viajes le faltan en vez de completar el hueco.
 */
export default async function RentabilidadPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  await exigirVerRuta('/dashboard/rentabilidad');
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/rentabilidad', sp);
  const r = await safe<Rentabilidad>(() => getRentabilidad(tenantId));

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <TrendingUp width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Rentabilidad / Finanzas</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Lo que entra contra lo que sale
          </span>
        </div>
      </header>

      {!r ? (
        <div className="glass-panel p-5">
          <EstadoVacio>
            No se pudo calcular. La consulta falló — no es que el margen sea cero.
          </EstadoVacio>
        </div>
      ) : r.viajesConIngreso === 0 ? (
        <div className="glass-panel p-5">
          <EstadoVacio icono={<Wallet width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">Falta capturar el ingreso del flete.</span> La columna
            ya existe, pero ninguno de los {r.viajesSinIngreso} viajes tiene registrado lo que paga
            el cliente. Sin eso no hay utilidad ni margen: son restas que necesitan las dos
            cantidades, y calcularlas con el anticipo haciendo de ingreso daría números que se ven
            bien y están mal.
          </EstadoVacio>
        </div>
      ) : (
        <>
          <div className="glass-panel p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                icono={<TrendingUp width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Ingreso del flete"
                valor={r.ingreso}
                formato="mxn"
                nota={`De ${r.viajesConIngreso} viaje${r.viajesConIngreso === 1 ? '' : 's'} con ingreso capturado`}
              />
              <KpiTile
                icono={<ArrowDownRight width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Costo comprobado"
                valor={r.costoComprobado}
                formato="mxn"
                nota="Lo que los operadores comprobaron"
              />
              <KpiTile
                icono={<Wallet width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Utilidad"
                valor={r.utilidad}
                formato="mxn"
              />
              {r.margenPct != null && (
                <KpiTile
                  icono={<Percent width={15} height={15} strokeWidth={1.75} />}
                  etiqueta="Margen"
                  valor={r.margenPct}
                  formato="porcentaje"
                  destacar
                />
              )}
            </div>
          </div>

          {/* El tamaño del hueco, siempre a la vista. Sin esta línea, un margen
              calculado sobre 3 de 40 viajes se lee como el margen de la flota. */}
          {r.viajesSinIngreso > 0 && (
            <div className="glass-panel p-5">
              <EstadoVacio>
                <span className="font-semibold">
                  Estas cifras cubren {r.viajesConIngreso} de {r.viajesConIngreso + r.viajesSinIngreso} viajes.
                </span>{' '}
                A los otros {r.viajesSinIngreso} les falta el ingreso del flete, así que no entran
                en el cálculo — ni como cero. El margen de arriba es el de los viajes capturados,
                no el de la flota.
              </EstadoVacio>
            </div>
          )}
        </>
      )}
    </div>
  );
}
