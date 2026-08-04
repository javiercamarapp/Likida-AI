import { revalidatePath } from 'next/cache';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd, mxn } from '@/lib/utils';
import { DollarSign, Calculator, CreditCard, TriangleAlert } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/cuadra/administracion';
import { getPlanes, guardarPriceDePlan, type Plan } from '@/lib/saas/suscripcion';
import { stripeConfigurado, modoStripe, webhookConfigurado } from '@/lib/saas/stripe';
import { AreaChartSimple, Dona } from '../charts';
import { IconoProveedor } from '../proveedor-icono';
import { ChartCard, EstadoVacio, KpiTile, StatusPill } from '../ui/kit';
import { FormaConAviso, Campo, type ResultadoAccion } from '../ui/forma';

export const dynamic = 'force-dynamic';

/**
 * Liga un plan con su price de Stripe.
 *
 * EL MONTO NO SE TECLEA AQUÍ, y esa es la decisión de diseño de esta pantalla.
 * Si el precio de la base y el de Stripe se capturaran por separado, el panel
 * podría decir "$2,400/mes" mientras Stripe cobra otra cosa — y esa diferencia
 * la descubre el cliente en su estado de cuenta, con toda la razón de reclamar.
 * `guardarPriceDePlan` LEE el monto de Stripe y lo espeja en la base.
 */
async function accionPrecio(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  await requireSuperadmin();
  const clave = String(fd.get('plan') ?? '');
  const price = String(fd.get('price') ?? '');
  try {
    const { montoMensual, moneda } = await guardarPriceDePlan(clave, price);
    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    return { ok: `Plan ${clave}: ${mxn(montoMensual)} ${moneda} al mes, leído de Stripe. Ya se puede contratar.` };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'guardar el precio del plan') };
  }
}

// Mismo diccionario de admin/page.tsx (no se exporta de ahí) — solo las
// etiquetas legibles para la dona de "Costo por fase".
const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

/**
 * Costos & Facturación — todo lo real que existe hoy sobre el gasto de IA
 * (`getResumenNegocio()`), más un costo unitario honesto (costo total de
 * IA ÷ viajes procesados, presentado como estimación, no como precisión
 * falsa). Likida no cobra a ningún cliente todavía: margen por cliente,
 * MRR/ARR, límites de gasto y cobros no tienen fuente de datos real en
 * este esquema — se enseñan como honest empty-state, Fase 3 del roadmap.
 *
 * Ni `Waterfall` ni `MarginDivergingBars` (graficas.tsx) aplican aquí a
 * propósito: ambos piden una forma de dato que Likida no tiene — un saldo
 * que se reconcilia paso a paso (Waterfall, tipo MRR bridge) o un valor
 * con signo ± (margen de rentabilidad por cliente) — y hoy solo existen
 * magnitudes no-negativas por fase/modelo. `Dona` y la lista con
 * `IconoProveedor` ya son el mejor ajuste real para esa forma de dato.
 */
export default async function CostosFacturacionPage() {
  const r = await getResumenNegocio();
  const costoPorViaje = r.viajesProcesados > 0 ? r.costoIaUsd / r.viajesProcesados : null;

  const hayStripe = stripeConfigurado();
  const modo = modoStripe();
  // Sin Stripe no se pide la lista: la sección entera se reemplaza por el aviso
  // de qué falta, y una consulta que nadie va a mirar solo puede fallar.
  let planes: Plan[] = [];
  if (hayStripe) {
    try { planes = await getPlanes(); } catch { planes = []; }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <DollarSign width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Costos & Facturación</span>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Costo total de IA
          </h2>
          {/* KpiTile necesita un `valor` numérico real siempre — cuando
              `costoPorViaje` es `null` (sin viajes procesados) no hay
              número honesto que mostrarle (ni siquiera 0: 0 viajes ÷ 0
              costo no es "costo por viaje = $0", es indefinido), así que
              ese caso se queda con el card original en vez de forzar un
              0 engañoso dentro de KpiTile. */}
          {costoPorViaje !== null ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <KpiTile
                icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Gastado en IA — todo el histórico" valor={r.costoIaUsd} formato="usd"
              />
              <KpiTile
                icono={<Calculator width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Costo estimado de IA por viaje procesado (costo total ÷ viajes procesados)"
                valor={costoPorViaje} formato="usd"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="card p-4">
                <div className="text-2xl font-semibold tracking-tight tabular">{usd(r.costoIaUsd)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Gastado en IA — todo el histórico</div>
              </div>
              <div className="card p-4">
                <div className="text-2xl font-semibold tracking-tight tabular">—</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Sin viajes procesados todavía para estimar un costo por viaje
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {r.porDia.length > 1 ? (
            <ChartCard titulo="Costo de IA en el tiempo" tamano="L">
              <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={usd} />
            </ChartCard>
          ) : (
            <ChartCard titulo="Costo de IA en el tiempo" tamano="L">
              <EstadoVacio icono={<DollarSign width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Sin historial suficiente todavía.
              </EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {r.porFase.length > 0 ? (
            <ChartCard titulo="Costo por fase" tamano="S">
              <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
            </ChartCard>
          ) : (
            <ChartCard titulo="Costo por fase" tamano="S">
              <EstadoVacio>Todavía no hay actividad de IA registrada.</EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {r.porModelo.length === 0 ? (
            <ChartCard titulo="Costo por modelo" tamano="S">
              <EstadoVacio>Sin llamadas registradas todavía.</EstadoVacio>
            </ChartCard>
          ) : (
            <ChartCard titulo="Costo por modelo" tamano="M">
              <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {r.porModelo.map((m) => (
                  <div key={m.modelo} className="py-3 flex items-center gap-3">
                    <IconoProveedor modelo={m.modelo} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-mono truncate">{m.modelo}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas</div>
                    </div>
                    <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                  </div>
                ))}
              </div>
            </ChartCard>
          )}
        </section>

        {/* ── Planes y precios ── */}
        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard width={15} height={15} strokeWidth={1.75} />
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Planes y precios
            </h2>
            {modo === null ? (
              <StatusPill estado="bad">Stripe sin conectar</StatusPill>
            ) : modo === 'prueba' ? (
              <StatusPill estado="warn">Llave de prueba</StatusPill>
            ) : (
              <StatusPill estado="ok">Producción</StatusPill>
            )}
            {modo !== null && !webhookConfigurado() && <StatusPill estado="bad">Sin webhook</StatusPill>}
          </div>

          {!hayStripe ? (
            <div className="mt-3">
              <EstadoVacio icono={<TriangleAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />}>
                Falta <code>STRIPE_SECRET_KEY</code>. Sin ella no se puede leer un price ni cobrar, y la pantalla del
                cliente esconde el botón de pago a propósito — uno que no cobra es peor que ninguno.
              </EstadoVacio>
            </div>
          ) : (
            <>
              {!webhookConfigurado() && (
                <div className="mt-3">
                  <EstadoVacio icono={<TriangleAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />}>
                    Falta <code>STRIPE_WEBHOOK_SECRET</code>. Se puede mandar a pagar, pero NADIE se entera del pago:
                    el webhook contesta 503 y la suscripción nunca pasa a activa. El cliente pagaría y seguiría
                    viéndose sin plan.
                  </EstadoVacio>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                {planes.map((p) => (
                  <div key={p.clave} className="card p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{p.nombre}</span>
                      {p.stripePriceId
                        ? <StatusPill estado="ok">Se puede contratar</StatusPill>
                        : <StatusPill estado="neutral">Sin precio</StatusPill>}
                    </div>
                    <div className="text-xl font-semibold tabular">
                      {p.precioMensual === null
                        ? <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>Sin configurar</span>
                        : <>{mxn(p.precioMensual)}<span className="text-xs font-normal" style={{ color: 'var(--muted)' }}> /mes</span></>}
                    </div>
                    <FormaConAviso accion={accionPrecio} boton="Guardar price" columnas="md:grid-cols-1">
                      <input type="hidden" name="plan" value={p.clave} />
                      <Campo nombre="price" etiqueta="Price ID de Stripe" requerido
                        valorInicial={p.stripePriceId ?? ''} placeholder="price_1Abc..." />
                    </FormaConAviso>
                  </div>
                ))}
              </div>
              <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                El monto <strong>no se teclea</strong>: se lee de Stripe al guardar el price. Dos cifras capturadas
                aparte pueden divergir, y esa diferencia la descubre el cliente en su estado de cuenta.
              </p>
            </>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <ChartCard titulo="Lo que todavía no es real" tamano="S">
            <EstadoVacio>
              MRR/ARR, waterfall de MRR y margen por cliente ya tienen de dónde salir (planes, suscripcion y
              factura_saas) pero necesitan clientes cobrando de verdad: con cero suscripciones activas, cualquier
              cifra aquí sería un cero de encuadre.
              <br /><br />
              El CFDI de la facturación de Likida a sus flotas sigue sin timbrarse: Stripe cobra, la factura fiscal
              mexicana se emite aparte. Dunning y conciliación tampoco están automatizados.
            </EstadoVacio>
          </ChartCard>
        </section>
      </div>
    </div>
  );
}
