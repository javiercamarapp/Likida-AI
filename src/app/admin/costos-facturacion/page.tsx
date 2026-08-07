import { revalidatePath } from 'next/cache';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd, mxn } from '@/lib/utils';
import { DollarSign, Calculator, CreditCard, TriangleAlert, Landmark } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { getPlanes, guardarPriceDePlan, type Plan } from '@/lib/saas/suscripcion';
import { stripeConfigurado, modoStripe, webhookConfigurado } from '@/lib/saas/stripe';
import {
  datosBancarios, emitirMensualidad, conciliar, timbrarFactura, getPorCobrar, type FacturaPorCobrar,
} from '@/lib/saas/transferencia';
import { etiquetaIva } from '@/lib/saas/iva';
import { facturapiConfigurado, modoFacturapi } from '@/lib/saas/facturapi';
import { logger } from '@/lib/logger';
import { AreaChartSimple, Dona } from '../charts';
import { IconoProveedor } from '../proveedor-icono';
import { ChartCard, EstadoVacio, KpiTile, StatusPill } from '../ui/kit';
import { FormaConAviso, Campo, Selector, type ResultadoAccion } from '../ui/forma';

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
    const { montoMensual, moneda, ivaIncluido } = await guardarPriceDePlan(clave, price);
    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    // El criterio del IVA se dice en el mismo mensaje que el monto: son la misma
    // pregunta ("cuánto se cobra") y verlos juntos es lo que permite notar que
    // falta uno. Sin criterio no se puede emitir, y eso se dice aquí y no
    // cuando alguien apriete "Emitir" y no entienda por qué se negó.
    if (ivaIncluido === null) {
      return {
        ok: `Plan ${clave}: ${mxn(montoMensual)} ${moneda} al mes, leído de Stripe. OJO: ese price no declara si el `
          + 'precio incluye IVA (tax_behavior = "unspecified"), así que TODAVÍA NO SE PUEDE EMITIR la mensualidad — '
          + 'no se sabría si cobrar el precio o el precio × 1.16. Ponle "inclusive" o "exclusive" en Stripe y vuelve '
          + 'a guardar el price.',
      };
    }
    return {
      ok: `Plan ${clave}: ${mxn(montoMensual)} ${moneda} al mes ${ivaIncluido ? 'IVA INCLUIDO' : 'MÁS IVA'}, leído `
        + 'de Stripe. Ya se puede contratar.',
    };
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
/**
 * Emite la mensualidad de una flota.
 *
 * El periodo es el MES EN CURSO y se calcula aquí, no se captura: una fecha
 * tecleada a mano es la forma más fácil de cobrar dos veces el mismo mes con
 * periodos que no cuadran, y el índice único de la 0057 solo protege si las
 * fechas son las mismas.
 */
async function accionEmitir(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  await requireSuperadmin();
  const tenantId = String(fd.get('tenantId') ?? '');
  if (!tenantId) return { error: 'Elige una flota.' };

  const hoy = new Date();
  const ini = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const fin = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0));

  try {
    const r = await emitirMensualidad(
      tenantId, ini.toISOString().slice(0, 10), fin.toISOString().slice(0, 10),
    );
    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    // Se dicen las TRES cifras. El total es lo que la flota transfiere y el
    // desglose es lo que va a salir en su CFDI: verlos juntos en la misma frase
    // es lo que permite cachar el día uno que el IVA quedó del lado equivocado.
    return {
      ok: `Mensualidad emitida por ${mxn(r.monto)} (base ${mxn(r.subtotal)} + IVA ${mxn(r.iva)}). La flota ya ve a `
        + `dónde transferir, con la referencia ${r.referencia}.`,
    };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'emitir la mensualidad') };
  }
}

/**
 * Da una factura por pagada. Es el paso que ningún webhook puede hacer: BBVA no
 * le avisa a la app, así que alguien mira el estado de cuenta y lo marca — y
 * queda registrado quién y con qué movimiento.
 */
async function accionConciliar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  const s = await requireSuperadmin();
  try {
    const id = String(fd.get('facturaId') ?? '');
    await conciliar(id, String(fd.get('referenciaBanco') ?? ''), s.userId);

    // El timbrado va DESPUÉS y con su propio try: el pago ya quedó registrado y
    // un PAC caído no puede deshacer un hecho del banco.
    let nota = '';
    try {
      const r = await timbrarFactura(id);
      nota = 'uuid' in r ? ` CFDI timbrado: ${r.uuid.slice(0, 8)}…` : ` ${r.pendiente}`;
    } catch (e) {
      nota = ` El pago quedó registrado, pero el CFDI NO se timbró: ${mensajeParaPantalla(e, 'timbrar')}`;
    }

    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    return { ok: `Factura marcada como pagada, con su referencia del banco.${nota}` };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'conciliar el pago') };
  }
}

export default async function CostosFacturacionPage() {
  const r = await getResumenNegocio();
  const costoPorViaje = r.viajesProcesados > 0 ? r.costoIaUsd / r.viajesProcesados : null;

  const hayStripe = stripeConfigurado();
  const modo = modoStripe();

  // ── `null` ES "NO SE PUDO LEER", `[]` ES "NO HAY NADA" ────────────────────
  //
  // Los dos `catch` de aquí devolvían `[]`, y con eso la pantalla decía "Nada
  // pendiente de cobro" con la base caída. Esa frase es una AFIRMACIÓN sobre el
  // dinero que Likida tiene por cobrar, y es exactamente la que hace que nadie
  // vaya a cobrar. `getPorCobrar` ya falla cerrado (lanza si PostgREST devuelve
  // error); el `catch` deshacía ese trabajo un piso más arriba.
  //
  // Sin Stripe no se piden los planes: la sección entera se reemplaza por el
  // aviso de qué falta, y una consulta que nadie va a mirar solo puede fallar.
  let planes: Plan[] | null = hayStripe ? null : [];
  if (hayStripe) {
    try { planes = await getPlanes(); } catch (e) { logger.error('admin.planes', { err: e instanceof Error ? e.message : String(e) }); }
  }

  const banco = datosBancarios();
  let porCobrar: FacturaPorCobrar[] | null = null;
  try { porCobrar = await getPorCobrar(); } catch (e) { logger.error('admin.por_cobrar', { err: e instanceof Error ? e.message : String(e) }); }

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

        {/* ── Cobro por transferencia ── */}
        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Landmark width={15} height={15} strokeWidth={1.75} />
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Cobro por transferencia
            </h2>
            {banco
              ? <StatusPill estado="ok">Cuenta ···{banco.clabeUltimos4}</StatusPill>
              : <StatusPill estado="bad">Sin cuenta configurada</StatusPill>}
          </div>

          {!banco ? (
            <div className="mt-3">
              <EstadoVacio icono={<TriangleAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />}>
                Faltan <code>LIKIDA_CLABE</code>, <code>LIKIDA_BANCO</code> y <code>LIKIDA_BENEFICIARIO</code> en el
                entorno, o la CLABE no pasa su dígito verificador. Sin las tres, la pantalla del cliente no enseña
                instrucciones de pago — una cuenta a medias manda el dinero al vacío.
              </EstadoVacio>
            </div>
          ) : (
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
              Las flotas transfieren a {banco.beneficiario} · {banco.banco} · CLABE terminada en{' '}
              <span className="font-mono">{banco.clabeUltimos4}</span>. Un banco no manda webhooks: cuando veas el
              depósito, márcalo aquí con su referencia.
            </p>
          )}

          <div className="mt-3">
            <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>Emitir la mensualidad de este mes</h3>
            <FormaConAviso accion={accionEmitir} boton="Emitir">
              <Selector nombre="tenantId" etiqueta="Flota" requerido
                opciones={[{ valor: '', texto: 'Elige…' }, ...r.flotas.map((f) => ({ valor: f.id, texto: f.nombre }))]} />
            </FormaConAviso>
          </div>

          <div className="mt-5">
            <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>Por cobrar</h3>
            {porCobrar === null ? (
              <EstadoVacio icono={<TriangleAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />}>
                No se pudo leer lo que está por cobrarse. Esto NO quiere decir que no haya nada pendiente: quiere decir
                que no se sabe. Recarga en un momento.
              </EstadoVacio>
            ) : porCobrar.length === 0 ? (
              <EstadoVacio>Nada pendiente de cobro. Aparece aquí en cuanto emitas una mensualidad.</EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="py-2.5 pr-4 font-medium">Flota</th>
                      <th className="py-2.5 pr-4 font-medium">Periodo</th>
                      <th className="py-2.5 pr-4 font-medium">Referencia</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Total a transferir</th>
                      <th className="py-2.5 font-medium">Marcar pagada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porCobrar.map((f) => (
                      <tr key={f.id} className="border-t align-top" style={{ borderColor: 'var(--line)' }}>
                        <td className="py-2.5 pr-4 font-medium">{f.tenantNombre}</td>
                        <td className="py-2.5 pr-4" style={{ color: 'var(--muted)' }}>{f.periodoInicio} — {f.periodoFin}</td>
                        <td className="py-2.5 pr-4 font-mono text-xs">{f.referencia ?? '—'}</td>
                        {/* El total manda (es lo que entra al banco) y el
                            desglose va debajo: es lo que va a salir en el CFDI,
                            y verlos juntos es lo que deja cachar un IVA del
                            lado equivocado antes de timbrar. Sin desglose se
                            dice, porque esa factura NO se va a poder timbrar. */}
                        <td className="py-2.5 pr-4 text-right tabular">
                          {mxn(f.monto)}
                          <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
                            {f.subtotal === null || f.iva === null
                              ? 'sin desglose: no se puede timbrar'
                              : `${mxn(f.subtotal)} + IVA ${mxn(f.iva)}`}
                          </span>
                        </td>
                        <td className="py-2.5" style={{ minWidth: 260 }}>
                          <FormaConAviso accion={accionConciliar} boton="Marcar pagada" columnas="md:grid-cols-1">
                            <input type="hidden" name="facturaId" value={f.id} />
                            <Campo nombre="referenciaBanco" etiqueta="Referencia del banco" requerido
                              placeholder="Folio del movimiento" />
                          </FormaConAviso>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
            {facturapiConfigurado()
              ? <StatusPill estado={modoFacturapi() === 'produccion' ? 'ok' : 'warn'}>
                  {modoFacturapi() === 'produccion' ? 'Timbra CFDI' : 'CFDI en prueba'}
                </StatusPill>
              : <StatusPill estado="warn">Sin timbrar CFDI</StatusPill>}
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
              {planes === null ? (
                <div className="mt-3">
                  <EstadoVacio icono={<TriangleAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />}>
                    No se pudieron leer los planes. Una grilla vacía diría que no hay planes configurados, y no es lo
                    mismo: es que no se sabe. Recarga en un momento.
                  </EstadoVacio>
                </div>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                {planes.map((p) => (
                  <div key={p.clave} className="card p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{p.nombre}</span>
                      {/* El criterio del IVA gatea el cobro igual que el price:
                          un plan con precio y sin criterio NO se puede emitir, y
                          "Se puede contratar" ahí sería falso. */}
                      {!p.stripePriceId
                        ? <StatusPill estado="neutral">Sin precio</StatusPill>
                        : p.precioIvaIncluido === null
                          ? <StatusPill estado="bad">IVA sin declarar</StatusPill>
                          : <StatusPill estado="ok">Se puede contratar</StatusPill>}
                    </div>
                    <div className="text-xl font-semibold tabular">
                      {p.precioMensual === null
                        ? <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>Sin configurar</span>
                        : <>{mxn(p.precioMensual)}<span className="text-xs font-normal" style={{ color: 'var(--muted)' }}> /mes {etiquetaIva(p.precioIvaIncluido)}</span></>}
                    </div>
                    {p.precioMensual !== null && p.precioIvaIncluido === null && (
                      <p className="text-xs m-0" style={{ color: 'var(--bad)' }}>
                        Su price de Stripe no dice si el precio trae el IVA (<code>tax_behavior</code> =
                        {' '}<code>unspecified</code>). Emitir la mensualidad está bloqueado: no se sabe si cobrar
                        {' '}{mxn(p.precioMensual)} o {mxn(p.precioMensual * 1.16)}.
                      </p>
                    )}
                    <FormaConAviso accion={accionPrecio} boton="Guardar price" columnas="md:grid-cols-1">
                      <input type="hidden" name="plan" value={p.clave} />
                      <Campo nombre="price" etiqueta="Price ID de Stripe" requerido
                        valorInicial={p.stripePriceId ?? ''} placeholder="price_1Abc..." />
                    </FormaConAviso>
                  </div>
                ))}
              </div>
              )}
              <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                El monto <strong>no se teclea</strong>: se lee de Stripe al guardar el price, junto con su{' '}
                <code>tax_behavior</code> — de qué lado del precio está el IVA es la otra mitad de &quot;cuánto se
                cobra&quot;, y capturada aparte diverge igual que el monto. Sin ese dato no se emite nada: un CFDI
                por 16% de más solo se corrige cancelándolo ante el SAT.
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
