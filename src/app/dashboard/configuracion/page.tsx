import { Settings, Fuel, Building2, BookOpen } from 'lucide-react';
import { getConfig } from '@/lib/cuadra/config';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { EstadoVacio } from '../../admin/ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Configuración (PASO 23) — lo que de verdad está configurado para esta
 * flota, leído con `getConfig()` (la misma función que usa el motor).
 *
 * Las "integraciones" del PASO 23 (monedero de combustible, TAG de casetas,
 * ERP) no se listan como si fueran interruptores apagados: no existe el
 * concepto de integración conectable en el esquema, así que un panel de
 * toggles apagados sería una promesa de UI, no un estado.
 */
export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/configuracion', sp);

  let config;
  try {
    config = await getConfig(tenantId);
  } catch {
    config = null;
  }

  const unidades = config ? Object.entries(config.unidades) : [];
  const cuentas = config ? Object.entries(config.catalogoCuentas) : [];

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Settings width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Configuración</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Lo que el motor usa para cuadrar tus viajes</span>
        </div>
      </header>

      {config === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer la configuración de esta flota.
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <section className="p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              La empresa
            </h2>
            <div className="card p-4 mt-3 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                <Building2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
              </div>
              <div>
                <div className="text-sm font-mono">{config.empresa.rfc}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  RFC contra el que se valida que un CFDI de gasto sea tuyo. Si no coincide con el receptor del
                  comprobante, el motor lo marca como no verificable.
                </div>
                {config.empresa.rfcsAdicionales && config.empresa.rfcsAdicionales.length > 0 && (
                  <div className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                    También se aceptan: {config.empresa.rfcsAdicionales.join(', ')}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Combustible
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{config.tabulador.rendimientoPorDefecto} km/L</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Rendimiento supuesto si la placa no está en el catálogo</div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{mxn(config.tabulador.precioDieselPorDefecto)}/L</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Precio de diésel de referencia</div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{config.tabulador.factorCarga}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Factor de consumo cargado vs. vacío</div>
              </div>
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-wide mt-5" style={{ color: 'var(--muted)' }}>
              Unidades calibradas
            </h3>
            {unidades.length === 0 ? (
              <div className="mt-3">
                <EstadoVacio icono={<Fuel width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
                  Ninguna placa tiene calibración propia todavía — todas usan el rendimiento por defecto de arriba.
                  Esto NO es un registro de unidades (no existe): es solo el consumo esperado por placa.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="py-2.5 font-medium">Placa</th>
                      <th className="py-2.5 font-medium text-right">Rendimiento base</th>
                      <th className="py-2.5 font-medium text-right">Capacidad de tanque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unidades.map(([placa, u]) => (
                      <tr key={placa} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="py-3 font-mono">{placa}</td>
                        <td className="py-3 text-right tabular">{u.rendimientoBase} km/L</td>
                        <td className="py-3 text-right tabular">{u.capacidadTanque} L</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Catálogo de cuentas
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              A qué cuenta contable va cada concepto en la exportación que recibe tu contador.
            </p>
            {cuentas.length === 0 ? (
              <div className="mt-3">
                <EstadoVacio icono={<BookOpen width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
                  Sin catálogo configurado.
                </EstadoVacio>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                {cuentas.map(([concepto, cuenta]) => (
                  <div key={concepto} className="card px-3.5 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-sm truncate">{etiquetaConcepto(concepto)}</span>
                    <span className="text-sm font-mono shrink-0" style={{ color: 'var(--muted)' }}>{cuenta}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Formato de exportación: <span className="font-mono">{config.salida}</span>
            </p>
          </section>

          <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <EstadoVacio>
              Esta pantalla es de lectura: editar la configuración desde aquí todavía no existe. Las integraciones
              (monedero de combustible, TAG de casetas, ERP) tampoco aparecen como interruptores porque no existen
              como tales en el sistema — enseñarlas apagadas sería prometer una conexión que no está construida.
            </EstadoVacio>
          </div>
        </div>
      )}
    </div>
  );
}
