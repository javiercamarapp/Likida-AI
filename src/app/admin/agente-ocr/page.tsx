import Link from 'next/link';
import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { leerUltimasLecturas } from '@/lib/admin/qa-storage';
import { agregar, agregarPorCampo, type Agregado, type AgregadoPorCampo } from '@/lib/admin/qa-verdad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd, numero } from '@/lib/formato';
import { ScanText, DollarSign, Repeat, ReceiptText, Crosshair } from 'lucide-react';
import { BarChartSimple } from '../charts';
import { IconoProveedor } from '../proveedor-icono';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard } from '../ui/kit';

export const dynamic = 'force-dynamic';

const ICONO_KPI = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/**
 * Agente OCR — la fase que lee la foto de un comprobante (diésel, caseta,
 * factura) y extrae monto/folio/CFDI, antes de que cualquier "agente" de
 * chat intervenga. Todo real: `llm_costo` filtrado por `fase === 'ocr'`
 * (`getResumenNegocio`/`getCostoPorFaseModelo`) y `gasto` para el histórico
 * de facturas.
 *
 * Re-envuelta en la anatomía de página (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts` + `StatCard` del kit (el histórico de facturas
 * que vivía en el `ContadorRetro` del header viejo es ahora el tercer KPI —
 * misma cifra, misma fuente). Un cero aquí es MEDIDO: cero filas en
 * `llm_costo` para la fase es cero gasto real, no un relleno.
 */
export default async function AgenteOcrPage() {
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo()]);
  // ── LA PRECISIÓN, EN LA PANTALLA CON EL NOMBRE CORRECTO (28-ago-2026) ────
  // El medidor existe (0239/0246) y su casa es /admin/qa — pero quien busca
  // «¿qué tan bien lee el OCR?» llega AQUÍ y solo veía dólares. El agregado se
  // calcula con las MISMAS funciones que el panel de QA (`agregar` /
  // `agregarPorCampo`), sobre la última lectura de cada foto del banco.
  // Fuente propia y fallo propio: que esta lectura caiga no tumba los costos,
  // y se dice — «no se pudo leer» no es «no hay medición».
  const lecturas = await leerUltimasLecturas(supabaseAdmin()).catch((e) => ({ ok: false as const, error: String(e) }));
  let precision: { global: Agregado; porCampo: AgregadoPorCampo[]; fotos: number } | null = null;
  if (lecturas.ok) {
    const mediciones = [...lecturas.datos.values()].map((l) => l.medicion);
    precision = { global: agregar(mediciones), porCampo: agregarPorCampo(mediciones), fotos: mediciones.length };
  }
  // Los tres campos que peor se leen, solo entre los que SÍ tienen medición:
  // `exactitud: null` es «sin medir», no 0%, y no compite en este ranking.
  const peores = precision === null
    ? []
    : precision.porCampo
      .filter((c): c is AgregadoPorCampo & { exactitud: number } => c.exactitud !== null)
      .sort((a, b) => a.exactitud - b.exactitud)
      .slice(0, 3);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const ocr = r.porFase.find((f) => f.fase === 'ocr');
  const modelosOcr = porFaseModelo.filter((m) => m.fase === 'ocr');
  // La tabla `llm_costo` sí trae `fase` y `modelo` juntos, pero cuando esa
  // combinación no tiene ninguna fila para OCR (o `llm_costo` no distingue
  // bien la fase en cada llamada), no hay forma honesta de aislar "solo
  // OCR" del desglose por modelo — se enseña el general, rotulado como tal,
  // en vez de fingir un corte que la base no sostiene.
  const desgloseSeparable = modelosOcr.length > 0;

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ScanText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Agente OCR"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Lectura de comprobantes — monto, folio y CFDI. Costo real, histórico</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <StatCard icono={<DollarSign {...ICONO_KPI} />}
              etiqueta="Gastado en OCR" valor={ocr ? ocr.costoUsd : 0} formato="usd"
            />
            <StatCard icono={<Repeat {...ICONO_KPI} />}
              etiqueta="Llamadas de OCR" valor={ocr ? ocr.n : 0} formato="entero"
            />
            <StatCard icono={<ReceiptText {...ICONO_KPI} />}
              etiqueta="Facturas procesadas — histórico" valor={r.facturasTotal} formato="entero"
            />
          </div>

          {/* ── Qué tan bien lee — la puerta a la medición (0239/0246) ── */}
          <div className="card p-4">
            <TituloSeccion>Qué tan bien lee — medido contra el banco de verdad</TituloSeccion>
            {precision === null ? (
              <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                No se pudo leer la medición de precisión — que no es lo mismo que «no hay medición».
                La fuente vive en <Link href="/admin/qa" className="underline underline-offset-2">QA</Link>.
              </p>
            ) : precision.global.exactitud === null ? (
              <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                El OCR todavía no se ha medido contra el banco de verdad — sin campos medidos no hay
                exactitud que reportar (esto NO es un 0%). La medición se corre desde{' '}
                <Link href="/admin/qa" className="underline underline-offset-2">QA</Link>, contra las
                fotos reales con verdad de terreno firmada.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-sm inline-flex items-center gap-2">
                  <Crosshair width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                  <span>
                    <strong>{pct(precision.global.exactitud)}</strong> de exactitud global —{' '}
                    {numero(precision.global.medidos)} campos medidos sobre {numero(precision.fotos)} fotos
                    (última lectura de cada una).
                  </span>
                </p>
                {peores.length > 0 && (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {/* El desglose por campo vale más que el global: un 94% general
                        esconde el folio que falla una de cada tres — y el folio es lo
                        que el portal de facturación exige. */}
                    Lo que peor se lee:{' '}
                    {peores.map((c, i) => (
                      <span key={c.clave}>
                        {i > 0 && ' · '}
                        <span className="font-medium" style={{ color: c.exactitud < 0.7 ? 'var(--bad)' : 'var(--ink)' }}>
                          {c.clave} {pct(c.exactitud)}
                        </span>{' '}
                        ({numero(c.medidos)} {c.medidos === 1 ? 'medición' : 'mediciones'})
                      </span>
                    ))}
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--faint)' }}>
                  La medición por corrida, el detalle por foto y el botón para volver a medir viven en{' '}
                  <Link href="/admin/qa" className="underline underline-offset-2">QA — banco de verdad</Link>.
                </p>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 pt-3 pb-1">
              <TituloSeccion>{desgloseSeparable ? 'Costo por modelo — OCR' : 'Costo por modelo'}</TituloSeccion>
              {!desgloseSeparable && (
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Todos los modelos, todas las fases — el desglose no se puede aislar de forma limpia solo para OCR con los datos de hoy.
                </p>
              )}
            </div>
            {(desgloseSeparable ? modelosOcr : r.porModelo).length === 0 ? (
              <div className="px-4 pb-3 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--line2)' }}>
                {(desgloseSeparable ? modelosOcr : r.porModelo).map((m) => (
                  <div key={m.modelo} className="px-4 py-2.5 flex items-center gap-3">
                    <IconoProveedor modelo={m.modelo} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-mono truncate">{m.modelo}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{numero(m.n)} llamadas</div>
                    </div>
                    <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4">
            <TituloSeccion>Facturas procesadas — últimos 7 días</TituloSeccion>
            <div className="mt-3">
              {r.facturasPorDia.some((d) => d.n > 0) ? (
                <BarChartSimple datos={r.facturasPorDia.map((d) => ({ dia: d.dia, valor: d.n }))} alto={220} />
              ) : (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                  Aún sin datos suficientes.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
