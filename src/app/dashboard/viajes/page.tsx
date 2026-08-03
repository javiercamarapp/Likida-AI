import { Truck, MapPin, Wallet, Clock } from 'lucide-react';
import { getViajes, type ViajeRow } from '@/lib/cuadra/analytics';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { fechaMx } from '../formato';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../admin/ui/kit';

export const dynamic = 'force-dynamic';

/** Los TRES estatus que `viaje` de verdad admite — el dominio está fijado en
 *  la base (`viaje_estatus_dominio`, 0025_dominios_check.sql:112:
 *  `estatus in ('abierto','en_cuadre','liquidado')`), no es una convención.
 *  Un cuarto valor cae al `??` de abajo y sale con su clave cruda: nunca
 *  `undefined` ni una etiqueta inventada. */
const ESTATUS_VIAJE: Record<string, { label: string; estado: Estado }> = {
  abierto: { label: 'Abierto', estado: 'warn' },
  en_cuadre: { label: 'En cuadre', estado: 'warn' },
  liquidado: { label: 'Liquidado', estado: 'ok' },
};

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Viajes (PASO 12 del documento) — la tabla real de `viaje`.
 *
 * El PASO 12 pide columnas de unidad, POD y margen por viaje: NINGUNA existe
 * en el esquema (`viaje` no tiene `unidad_id`, no hay tabla de vehículos, no
 * hay campo de POD, y no hay ingreso registrado contra el cual calcular un
 * margen). Enseñar esas columnas vacías haría ver el producto más completo y
 * la pantalla más inútil, así que se dice abajo qué falta y por qué.
 */
export default async function ViajesPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/viajes', sp);
  const viajes = await safe<ViajeRow[]>(() => getViajes(tenantId));

  // "Sin liquidar" son los DOS estatus previos al cierre (`abierto` y
  // `en_cuadre`), no solo `abierto`: contar uno solo dejaría fuera justo los
  // viajes que están a media liquidación, que son los que el dueño persigue.
  const sinLiquidar = viajes?.filter((v) => v.estatus !== 'liquidado') ?? [];
  const abiertos = sinLiquidar.length;
  const anticipoAbierto = sinLiquidar.reduce((s, v) => s + v.anticipo, 0);
  const conPendientes = viajes?.filter((v) => v.intakePendientes > 0).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Truck width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Viajes</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Cada viaje, su operador y su anticipo</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        {viajes === null ? (
          <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el listado de viajes.</div>
        ) : (
          <>
            <section className="p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Estado de la operación
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <KpiTile icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                  etiqueta="Viajes registrados" valor={viajes.length} formato="entero" />
                <KpiTile icono={<MapPin width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                  etiqueta="Abiertos (sin liquidar)" valor={abiertos} formato="entero" />
                <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                  etiqueta="Anticipo en viajes abiertos" valor={anticipoAbierto} formato="mxn" />
                <KpiTile icono={<Clock width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                  etiqueta="Con comprobantes en camino" valor={conPendientes} formato="entero"
                  nota="Fotos que el operador mandó y el agente todavía está procesando" />
              </div>
            </section>

            <div className="pt-5 pb-2 px-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Todos los viajes
              </h2>
            </div>
            {viajes.length === 0 ? (
              <div className="px-5 pb-5">
                <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
                  Aún no hay viajes registrados para esta flota.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-5 py-2.5 font-medium">Folio</th>
                      <th className="px-5 py-2.5 font-medium">Ruta</th>
                      <th className="px-5 py-2.5 font-medium">Operador</th>
                      <th className="px-5 py-2.5 font-medium">Inicio</th>
                      <th className="px-5 py-2.5 font-medium text-right">Anticipo</th>
                      <th className="px-5 py-2.5 font-medium">Estatus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viajes.map((v) => {
                      const e = ESTATUS_VIAJE[v.estatus] ?? { label: v.estatus, estado: 'neutral' as Estado };
                      return (
                        <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                          <td className="px-5 py-3 font-medium">{v.folio}</td>
                          <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
                            {v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? '—')}
                          </td>
                          <td className="px-5 py-3">{v.operadorNombre ?? '—'}</td>
                          <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</td>
                          <td className="px-5 py-3 text-right tabular">{v.anticipo > 0 ? mxn(v.anticipo) : '—'}</td>
                          <td className="px-5 py-3">
                            <StatusPill estado={e.estado}>{e.label}</StatusPill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <EstadoVacio>
                Unidad asignada, POD (evidencia de entrega) y margen por viaje no aparecen porque no existen en el
                sistema: `viaje` no guarda unidad, no hay tabla de vehículos, no hay campo de POD, y no se registra
                el ingreso del flete contra el cual calcular un margen. Crear y asignar viajes desde aquí (hoy se
                hace por WhatsApp), el estimador de casetas+combustible y OTIF necesitan esas mismas piezas.
              </EstadoVacio>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
