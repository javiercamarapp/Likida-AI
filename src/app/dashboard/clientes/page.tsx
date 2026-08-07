import { Users2, TrendingUp, Layers } from 'lucide-react';
import { exigirVerRuta } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getCartera, type Cartera } from '@/lib/likida/comercial';
import { EstadoVacio, KpiTile } from '../../admin/ui/kit';
import { mxn } from '@/lib/formato';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * CLIENTES — dejó de ser una pantalla "todavía no existe" el 4-ago-2026, cuando
 * la 0048 creó `cliente` y `viaje.cliente_id`.
 *
 * LO QUE NO HACE, Y ES DELIBERADO: no rellena el ingreso de un cliente con el
 * anticipo de sus viajes. Un viaje sin `ingreso_flete` capturado se cuenta
 * APARTE, no como cero — si se sumara como 0, el ingreso del cliente saldría
 * bajo, su margen negativo, y los dos números se verían plausibles. La columna
 * "sin capturar" es la que dice cuánto de esta pantalla se puede creer.
 */
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  await exigirVerRuta('/dashboard/clientes');
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/clientes', sp);
  const cartera = await safe<Cartera>(() => getCartera(tenantId));

  const vacia = !cartera || cartera.clientes.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Users2 width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Clientes</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Quién te da carga y cuánto pesa cada uno
          </span>
        </div>
      </header>

      {!cartera ? (
        <div className="glass-panel p-5">
          <EstadoVacio>
            No se pudo leer la cartera. No es que no haya clientes: es que la consulta falló, y
            enseñar cero aquí se leería como una flota sin clientes.
          </EstadoVacio>
        </div>
      ) : vacia ? (
        <div className="glass-panel p-5">
          <EstadoVacio icono={<Users2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">Aún no hay clientes dados de alta.</span> La tabla ya
            existe; falta capturar a quién se le mueve la carga y ligarlo a sus viajes. En cuanto
            haya uno, aquí sale cuánto deja cada quien y qué tanto depende la operación de uno solo.
          </EstadoVacio>
        </div>
      ) : (
        <>
          <div className="glass-panel p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              La cartera
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiTile
                icono={<Users2 width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Clientes activos"
                valor={cartera.clientes.filter((c) => c.activo).length}
              />
              <KpiTile
                icono={<TrendingUp width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Ingreso capturado"
                valor={cartera.ingresoTotal}
                formato="mxn"
              />
              {/* La concentración es el número que de verdad importa: si un
                  cliente es el 60% del ingreso, perderlo quiebra a la flota.
                  Sin ingreso capturado NO se pinta: un 0% se leería como "no
                  dependes de nadie", que es la conclusión contraria. */}
              {cartera.concentracion != null ? (
                <KpiTile
                  icono={<Layers width={15} height={15} strokeWidth={1.75} />}
                  etiqueta={`Depende de ${cartera.clientes[0].nombre}`}
                  valor={cartera.concentracion}
                  formato="porcentaje"
                  destacar
                  nota="Si tu cliente más grande se va, esto es lo que se va con él"
                />
              ) : (
                <div className="card p-3.5 text-xs" style={{ color: 'var(--muted)' }}>
                  La concentración necesita el ingreso del flete capturado. Sin él no se calcula:
                  un 0% se leería como que no dependes de nadie.
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    <th className="text-left font-medium px-5 py-3">Cliente</th>
                    <th className="text-left font-medium px-5 py-3">RFC</th>
                    <th className="text-right font-medium px-5 py-3">Viajes</th>
                    <th className="text-right font-medium px-5 py-3">Ingreso</th>
                    <th className="text-right font-medium px-5 py-3">Sin capturar</th>
                  </tr>
                </thead>
                <tbody>
                  {cartera.clientes.map((c) => (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="px-5 py-3 font-medium">{c.nombre}</td>
                      <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{c.rfc ?? '—'}</td>
                      <td className="px-5 py-3 text-right tabular">{c.viajes}</td>
                      <td className="px-5 py-3 text-right tabular">{mxn(c.ingreso)}</td>
                      <td className="px-5 py-3 text-right tabular" style={{ color: c.viajesSinIngreso ? 'var(--warn)' : 'var(--muted)' }}>
                        {c.viajesSinIngreso || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {cartera && cartera.viajesSinCliente > 0 && (
        <div className="glass-panel p-5">
          <EstadoVacio>
            <span className="font-semibold">{cartera.viajesSinCliente} viaje
            {cartera.viajesSinCliente === 1 ? '' : 's'} sin cliente asignado.</span> No entran en
            ningún renglón de arriba. Los viajes que llegan por WhatsApp no preguntan por cliente,
            así que hay que ligarlos desde Despacho.
          </EstadoVacio>
        </div>
      )}
    </div>
  );
}
