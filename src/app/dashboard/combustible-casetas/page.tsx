import { Fuel, Route as RouteIcon, Receipt, Copy } from 'lucide-react';
import {
  getGastoPorConcepto, getAcreditables, detectarAnomalias, getDocumentos,
  type GastoPorConcepto, type Acreditables, type Anomalia, type DocumentoRow,
} from '@/lib/cuadra/analytics';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { KpiTile, EstadoVacio, ChartCard } from '../../admin/ui/kit';
import { HBars } from '../../admin/ui/graficas';
import { Dona } from '../../admin/charts';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Combustible & Casetas (PASO 11) — el gasto real de `gasto`, agrupado.
 *
 * El rendimiento km/l NO se calcula aquí aunque el PASO 11 lo pida: `viaje`
 * no guarda kilómetros recorridos, y el `tabulador` de la config del tenant
 * es una CALIBRACIÓN por placa (litros esperados), no una medición de campo.
 * Dividir gasto entre un kilometraje que nadie capturó daría un número con
 * apariencia de medición y sin nada detrás.
 *
 * La detección de "ordeña" que sí existe es la de comprobantes repetidos
 * entre viajes (`detectarAnomalias`, probada) — no el cruce contra el estado
 * de cuenta del monedero, que necesita una integración que no está conectada.
 */
export default async function CombustibleCasetasPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/combustible-casetas', sp);

  const [porConcepto, acred, anomalias, docs] = await Promise.all([
    safe<GastoPorConcepto[]>(() => getGastoPorConcepto(tenantId)),
    safe<Acreditables>(() => getAcreditables(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
    safe<DocumentoRow[]>(() => getDocumentos(tenantId, 1000)),
  ]);

  const diesel = porConcepto?.find((c) => c.concepto === 'diesel');
  const caseta = porConcepto?.find((c) => c.concepto === 'caseta');
  // "Sin CFDI" solo se puede afirmar sobre los comprobantes que SÍ se leyeron;
  // si la consulta falló, no se afirma nada.
  const combustibleYCasetas = docs?.filter((d) => d.concepto === 'diesel' || d.concepto === 'caseta') ?? [];
  const sinCfdi = combustibleYCasetas.filter((d) => !d.cfdiUuid).length;
  const pctSinCfdi = combustibleYCasetas.length > 0 ? Math.round((sinCfdi / combustibleYCasetas.length) * 100) : null;
  const anomaliasCombustible = anomalias?.filter((a) => /diesel|caseta/i.test(a.detalle)) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Fuel width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Combustible & Casetas</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Los dos conceptos que más pesan en un viaje, y qué tanto están facturados
          </span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            El gasto
          </h2>
          {porConcepto === null ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiTile icono={<Fuel width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="Gastado en combustible" valor={diesel?.total ?? 0} formato="mxn"
                nota={diesel ? `${diesel.n} cargas registradas` : 'Sin cargas registradas todavía'} />
              <KpiTile icono={<RouteIcon width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="Gastado en casetas" valor={caseta?.total ?? 0} formato="mxn"
                nota={caseta ? `${caseta.n} casetas registradas` : 'Sin casetas registradas todavía'} />
              <KpiTile icono={<Fuel width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="Litros elegibles para el estímulo" valor={acred?.litrosDiesel ?? 0} formato="litros"
                nota="LIF 2026, Art. 20-A" />
              <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="Sin CFDI (combustible y casetas)" valor={pctSinCfdi ?? 0} formato="porcentaje"
                vacio={pctSinCfdi === null ? 'Sin comprobantes de estos conceptos todavía' : undefined}
                nota={pctSinCfdi === null ? undefined : `${sinCfdi} de ${combustibleYCasetas.length} sin factura — es deducible que se pierde`} />
            </div>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {porConcepto && porConcepto.length > 1 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard titulo="Gasto por concepto" tamano="M">
                <HBars datos={porConcepto.map((c) => ({ etiqueta: etiquetaConcepto(c.concepto), valor: c.total }))} formato="mxn" />
              </ChartCard>
              <ChartCard titulo="Reparto del gasto" tamano="M">
                <Dona segmentos={porConcepto.map((c) => ({ etiqueta: etiquetaConcepto(c.concepto), valor: c.total }))} />
              </ChartCard>
            </div>
          ) : (
            <ChartCard titulo="Gasto por concepto" tamano="S">
              <EstadoVacio icono={<Fuel width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
                Hace falta más de un concepto de gasto registrado para comparar.
              </EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Posible carga repetida
          </h2>
          {anomalias === null ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo revisar.</div>
          ) : anomaliasCombustible.length === 0 ? (
            <div className="mt-3">
              <EstadoVacio icono={<Copy width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
                Ningún comprobante de combustible o caseta aparece cargado en más de un viaje.
              </EstadoVacio>
            </div>
          ) : (
            <>
              <div className="divide-y mt-3" style={{ borderColor: 'var(--line)' }}>
                {anomaliasCombustible.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm">{a.detalle}</div>
                      <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Viajes: {a.viajes.join(' · ')}</div>
                    </div>
                    <div className="text-sm font-semibold tabular whitespace-nowrap shrink-0">{mxn(a.monto)}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                Coincidencia detectada, no un veredicto: verifica antes de conversarlo con el operador.
              </p>
            </>
          )}
        </section>

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            El rendimiento en km/l no aparece porque nadie captura el kilometraje: `viaje` no lo guarda, y el
            tabulador de la configuración es una calibración de litros esperados por placa, no una medición de
            campo. Dividir el gasto entre un kilometraje inventado daría un número con cara de medición.
            <br /><br />
            El cruce del estado de cuenta del monedero de combustible y del TAG de casetas contra el CFDI —el que
            detecta la ordeña de verdad, litros comprados contra litros ingresados— necesita esas dos
            integraciones conectadas, y hoy no lo están.
          </EstadoVacio>
        </div>
      </div>
    </div>
  );
}
