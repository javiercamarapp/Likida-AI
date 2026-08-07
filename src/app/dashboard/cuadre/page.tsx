import Link from 'next/link';
import { ReceiptText, Wallet, AlertTriangle, Copy } from 'lucide-react';
import {
  getKpis, detectarAnomalias, type DashboardKpis, type Anomalia,
} from '@/lib/likida/analytics';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mxn } from '@/lib/utils';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeExportar } from '@/lib/auth/permisos';
import { fechaMx } from '../formato';
import { etiquetaEstatus } from '../estatus';
import { sufijoTenant } from '../sufijo';
import { KpiTile, EstadoVacio } from '../../admin/ui/kit';
import { Gauge } from '../../admin/ui/graficas';

export const dynamic = 'force-dynamic';

interface LiqRow { id: string; folio: string; creadoEn: string; comprobado: number; diferencia: number; estatus: string }

async function getLiquidaciones(tenantId: string): Promise<LiqRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('liquidacion')
    .select('id, estatus, total_comprobado, diferencia, created_at, viaje:viaje_id(folio)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);
  // supabase-js reporta el fallo POR VALOR: sin este throw, una lectura caída
  // devolvía `[]` y la tabla salía con encabezados y cero filas bajo unos KPIs
  // que decían "12 viajes liquidados" (auditoría 5, frontend, CRÍTICO).
  if (error) throw new Error(`getLiquidaciones: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    folio: ((r.viaje as { folio?: string } | null)?.folio) ?? (r.id as string).slice(0, 8),
    creadoEn: r.created_at as string,
    comprobado: Number(r.total_comprobado ?? 0),
    diferencia: Number(r.diferencia ?? 0),
    estatus: r.estatus as string,
  }));
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Cuadre / Liquidación — el núcleo real del producto (PASO 18 del
 * documento). Todo aquí tiene dato real: `liquidacion` + el motor de cuadre
 * + `detectarAnomalias` (fraude entre viajes), lo que antes estaba apretado
 * al fondo de Inicio y ahora tiene su propia página con espacio.
 *
 * Lo que el PASO 18 pide y NO existe todavía se dice al final, no se
 * inventa: el cruce de estado de cuenta del monedero de combustible / TAG de
 * casetas contra el CFDI necesita esas dos integraciones, y Likida no las
 * tiene conectadas.
 */
export default async function CuadrePage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/cuadre', sp);
  const sufijo = sufijoTenant(sp);

  const [kpis, liqs, anomalias] = await Promise.all([
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<LiqRow[]>(() => getLiquidaciones(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ReceiptText width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Cuadre / Liquidación</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Anticipo contra comprobado, viaje por viaje — con lo que el motor detectó
          </span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Comprobación del periodo
          </h2>
          {kpis === null ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <KpiTile icono={<ReceiptText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Liquidaciones cerradas" valor={kpis.viajesLiquidados} formato="entero" />
                <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Monto comprobado" valor={kpis.montoComprobado} formato="mxn" />
                <KpiTile icono={<AlertTriangle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Con diferencia o por revisar" valor={kpis.conDiferencias + kpis.porRevisar} formato="entero" />
                <KpiTile icono={<Copy width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Dinero observado por el motor" valor={kpis.diferenciaDetectada} formato="mxn"
                  nota="Sobre política + duplicados — lo que el cuadre marcó, no un cargo" />
              </div>

              {/* Gauge (design system v2) — la tasa de cuadre es justo la forma
                  de dato para la que existe: un porcentaje contra un máximo
                  conocido (100%). Solo con liquidaciones reales: un gauge en 0%
                  sobre 0 liquidaciones se lee como "reprobado", no como "todavía
                  no hay nada". */}
              {kpis.viajesLiquidados > 0 && (
                <div className="mt-4 card p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
                    Tasa de cuadre
                  </h3>
                  <Gauge valor={kpis.tasaCuadre} />
                  <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                    Liquidaciones que cerraron sin ninguna diferencia, sobre el total del periodo.
                  </p>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Mismo comprobante en varios viajes ──
            Cada liquidación se ve impecable por separado: esto solo se ve
            mirando TODAS juntas. Se muestra únicamente si hay algo — una
            sección vacía que dice "0 anomalías" entrena a ignorarla. */}
        {anomalias !== null && anomalias.length > 0 && (
          <section id="anomalias" className="p-5 border-t scroll-mt-4" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Revisar · mismo comprobante en varios viajes
            </h2>
            <div className="divide-y mt-3" style={{ borderColor: 'var(--line)' }}>
              {anomalias.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm">{a.detalle}</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                      Viajes: {a.viajes.join(' · ')}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular whitespace-nowrap shrink-0">{mxn(a.monto)}</div>
                </div>
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              Coincidencia detectada, no un veredicto: verifica antes de conversarlo con el operador.
            </p>
          </section>
        )}

        {/* ── Tabla (cada fila abre el detalle) ── */}
        <div className="pt-5 pb-2 px-5 border-t flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
            Detalle por liquidación
          </h2>
          {puedeExportar(rol) && (
            <a href="/api/export/liquidaciones" download
              className="text-sm px-3.5 py-2 rounded-lg hairline hover:opacity-70">
              Exportar CSV
            </a>
          )}
        </div>
        {liqs === null ? (
          <div className="px-5 pb-5" style={{ color: 'var(--muted)' }}>No se pudo cargar el listado.</div>
        ) : liqs.length === 0 ? (
          <div className="px-5 pb-5">
            <EstadoVacio icono={<ReceiptText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Aún no hay liquidaciones cerradas. En cuanto un operador cierre su primer viaje por WhatsApp, aparece aquí.
            </EstadoVacio>
          </div>
        ) : (
          <div className="overflow-x-auto mt-1 pb-2">
            <table className="w-full text-base">
              <thead>
                <tr style={{ color: 'var(--muted)' }} className="text-left text-sm">
                  <th className="px-5 py-2.5 font-medium">Folio</th>
                  <th className="px-5 py-2.5 font-medium">Fecha</th>
                  <th className="px-5 py-2.5 font-medium text-right">Comprobado</th>
                  <th className="px-5 py-2.5 font-medium text-right">Diferencia</th>
                  <th className="px-5 py-2.5 font-medium">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {liqs.map((l) => {
                  const e = etiquetaEstatus(l.estatus);
                  return (
                    // `relative` + el pseudo-elemento estirado del <Link>: la
                    // fila entera es el blanco de toque, no un texto de ~20px
                    // dentro de una celda — en tableta no hay hover, así que el
                    // único blanco quedaba muy por debajo de los 44px de toque
                    // (auditoría 5, frontend, BAJO 1).
                    <tr key={l.id} className="relative border-t hover:opacity-80" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-5 py-3 font-medium">
                        <Link href={`/dashboard/${l.id}${sufijo}`}
                          className="hover:underline after:absolute after:inset-0 after:content-['']">{l.folio}</Link>
                      </td>
                      <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{fechaMx(l.creadoEn)}</td>
                      <td className="px-5 py-3 text-right tabular">{mxn(l.comprobado)}</td>
                      {/* La dirección va PEGADA a la cifra: `Math.abs()` sin más
                          borraba el signo que el motor define (+ sobró anticipo,
                          − el operador puso de su bolsa), y dos liquidaciones
                          opuestas imprimían el MISMO "$1,500.00" con el mismo
                          estatus. El contralor escanea la lista y lee todo como
                          dinero a favor de la empresa; en la mitad de los casos
                          la empresa DEBE ese dinero (auditoría 5, ALTO 1). */}
                      <td className="px-5 py-3 text-right">
                        {l.diferencia === 0 ? (
                          <span className="tabular">—</span>
                        ) : (
                          <>
                            <span className="tabular block">{mxn(Math.abs(l.diferencia))}</span>
                            <span className="text-xs block whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                              {l.diferencia > 0 ? 'a favor de la empresa' : 'a favor del operador'}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: e.color }} />
                        {e.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {liqs.length >= 50 && (
              <p className="text-xs px-5 pt-2" style={{ color: 'var(--muted)' }}>
                Se muestran las 50 más recientes. El CSV trae todas.
              </p>
            )}
          </div>
        )}

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            El cruce automático del estado de cuenta del monedero de combustible y del TAG de casetas contra el CFDI
            (para marcar &quot;posible ordeña&quot;) necesita esas dos integraciones conectadas, y hoy no lo están —
            lo que sí existe es la detección de comprobantes repetidos entre viajes, arriba, que corre sobre los
            comprobantes que ya entraron por WhatsApp.
          </EstadoVacio>
        </div>

        <p className="text-xs px-5 pb-5" style={{ color: 'var(--muted)' }}>{LEYENDA_CORTA}</p>
      </div>
    </div>
  );
}
