import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { CreditCard, ExternalLink, TriangleAlert, FileText, Landmark } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantPedido } from '@/lib/auth/tenant-api';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import {
  getPlanes, getSuscripcion, getFacturasSaas, getUso,
  type Plan, type Suscripcion, type FacturaSaas, type UsoDelPlan,
} from '@/lib/saas/suscripcion';
import { crearSuscripcionPorTransferencia, crearPortal, stripeConfigurado, modoStripe } from '@/lib/saas/stripe';
import { datosBancarios } from '@/lib/saas/transferencia';
import {
  getDatosFiscales, guardarDatosFiscales, estanCompletos, REGIMENES, USOS_CFDI,
  type DatosFiscalesFlota,
} from '@/lib/saas/fiscal';
import { mxn } from '@/lib/utils';
import { fechaMx } from '../formato';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { FormaConAviso, Campo, Selector, type ResultadoAccion } from '../../admin/ui/forma';
import { Uso, TarjetaPlan, InstruccionesTransferencia } from './vista';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

const ESTADO_PILL: Record<Suscripcion['estado'], { tono: 'ok' | 'warn' | 'bad' | 'neutral'; texto: string }> = {
  prueba: { tono: 'neutral', texto: 'En prueba' },
  activa: { tono: 'ok', texto: 'Activa' },
  morosa: { tono: 'bad', texto: 'Pago pendiente' },
  pausada: { tono: 'warn', texto: 'Pausada' },
  cancelada: { tono: 'neutral', texto: 'Cancelada' },
};

/**
 * Plan & Facturación — lo que Likida le cobra a ESTA flota.
 *
 * OJO CON EL NOMBRE: `/dashboard/cobranza` es lo contrario (lo que la flota le
 * cobra a SUS clientes). Son dos negocios distintos en la misma base y
 * mezclarlos haría que "ingresos" sumara el flete de un transportista con la
 * mensualidad del SaaS.
 *
 * TRES FORMAS DE DEGRADAR, Y LAS TRES SE DICEN EN PANTALLA:
 *
 *  1. Sin `STRIPE_SECRET_KEY` no hay botón de pago. Un "Suscribirme" que no
 *     hace nada es peor que no tenerlo: el cliente cree que ya pagó.
 *  2. Un plan sin `stripe_price_id` no se puede contratar y lo dice, en vez de
 *     ofrecer un botón que reventaría al hacer clic.
 *  3. Con llave de PRUEBA se avisa arriba. Cobrar de a de veras con una llave
 *     de test deja al cliente creyendo que pagó y a Likida sin el dinero.
 *
 * El límite del plan SE ENSEÑA, NO BLOQUEA. Cortarle la liquidación a una flota
 * a medio mes es el peor momento para descubrir un tope: sus choferes ya
 * mandaron los comprobantes y el contralor ya cuenta con el cierre.
 */
export default async function SuscripcionPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/suscripcion', sp);
  const puedeContratar = puedeAdministrar(rol);
  const hayStripe = stripeConfigurado();
  const modo = modoStripe();

  const [planes, suscripcion, facturas] = await Promise.all([
    safe<Plan[]>(() => getPlanes()),
    safe<Suscripcion | null>(() => getSuscripcion(tenantId)),
    safe<FacturaSaas[]>(() => getFacturasSaas(tenantId)),
  ]);

  const fiscales = await safe<DatosFiscalesFlota | null>(() => getDatosFiscales(tenantId));
  const banco = datosBancarios();
  // La factura que hay que pagar AHORA. Es la que manda en esta pantalla: si
  // hay uno pendiente, lo primero que el cliente necesita es a dónde transferir.
  const porPagar = facturas?.find((f) => f.estado === 'pendiente' || f.estado === 'fallida') ?? null;
  const puedeFacturar = estanCompletos(fiscales);
  const planActual = planes?.find((p) => p.clave === suscripcion?.planClave) ?? null;
  const uso = await safe<UsoDelPlan>(() => getUso(tenantId, planActual));

  async function tenantDelAction(): Promise<{ t: string; email: string | null; rol: string }> {
    const s = await requireSessionTenant('/dashboard/suscripcion');
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }
    const { data: u } = await supabaseAdmin().from('app_user').select('email').eq('id', s.userId).maybeSingle();
    return { t, email: (u?.email as string) ?? null, rol: s.rol };
  }

  /**
   * Abre el pago. `requireSessionTenant` y el `redirect` final van FUERA del
   * try: los dos redirigen LANZANDO, y atraparlos convertiría el envío a Stripe
   * en un aviso rojo — el cliente vería "no se pudo" de un cobro que sí iba.
   */
  /**
   * Contrata el plan PARA PAGARSE POR TRANSFERENCIA.
   *
   * No es un checkout: la documentación de Stripe dice que las transferencias
   * bancarias no son compatibles con Checkout en modo suscripción. Se crea la
   * suscripción con `send_invoice` y Stripe emite la factura con la CLABE y la
   * referencia; el webhook `invoice.paid` avisa cuando el dinero cae.
   *
   * SE EXIGEN LOS DATOS FISCALES ANTES. Cobrarle a una flota a la que después
   * no le puedes facturar es el peor orden posible: ya tienes su dinero y su
   * contador no tiene con qué deducirlo.
   */
  async function accionContratar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t, email, rol: r } = await tenantDelAction();
    if (!puedeAdministrar(r)) return { error: 'Solo el dueño de la flota puede contratar o cambiar de plan.' };

    const clave = String(fd.get('plan') ?? '');
    let destino: string | null;
    try {
      const f = await getDatosFiscales(t);
      if (!estanCompletos(f)) {
        return { error: 'Antes de contratar hay que capturar los datos fiscales de arriba: sin ellos no se te puede emitir el CFDI de la mensualidad.' };
      }
      const p = (await getPlanes()).find((x) => x.clave === clave);
      if (!p) return { error: 'Ese plan ya no existe.' };
      if (!p.stripePriceId) {
        return { error: `El plan ${p.nombre} todavía no tiene precio configurado en Stripe. Avísale a Likida.` };
      }
      const s = await getSuscripcion(t);
      const r2 = await crearSuscripcionPorTransferencia({
        priceId: p.stripePriceId,
        tenantId: t,
        customerId: s?.stripeCustomerId ?? undefined,
        fiscales: {
          rfc: f!.rfc!, razonSocial: f!.razonSocial!, regimenFiscal: f!.regimenFiscal!,
          codigoPostal: f!.codigoPostal!, email: email ?? '',
        },
      });
      destino = r2.urlFactura;
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'generar la factura para transferencia') };
    }

    revalidatePath('/dashboard/suscripcion');
    // Sin URL la suscripción SÍ quedó creada: se dice, en vez de fingir que
    // falló y provocar que la contrate dos veces.
    if (!destino) {
      return { ok: 'Suscripción creada. Stripe te va a mandar la factura con los datos para la transferencia por correo.' };
    }
    redirect(destino);
  }

  /** Guarda con qué datos se le va a facturar a esta flota. */
  async function accionFiscales(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t, rol: r } = await tenantDelAction();
    if (!puedeAdministrar(r)) return { error: 'Solo el dueño de la flota puede cambiar los datos fiscales.' };
    try {
      await guardarDatosFiscales(t, {
        rfc: String(fd.get('rfc') ?? ''),
        razonSocial: String(fd.get('razonSocial') ?? ''),
        regimenFiscal: String(fd.get('regimenFiscal') ?? ''),
        codigoPostal: String(fd.get('codigoPostal') ?? ''),
        usoCfdi: String(fd.get('usoCfdi') ?? ''),
      });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar los datos fiscales') };
    }
    revalidatePath('/dashboard/suscripcion');
    return { ok: 'Datos fiscales guardados. Con estos se te va a emitir el CFDI de cada mensualidad.' };
  }

  async function accionPortal(): Promise<ResultadoAccion> {
    'use server';
    const { t, rol: r } = await tenantDelAction();
    if (!puedeAdministrar(r)) return { error: 'Solo el dueño de la flota puede administrar el cobro.' };

    let destino: string;
    try {
      const s = await getSuscripcion(t);
      if (!s?.stripeCustomerId) return { error: 'Esta flota todavía no tiene un cliente en Stripe: no hay nada que administrar.' };
      destino = await crearPortal(s.stripeCustomerId, `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard/suscripcion`);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'abrir el portal de cobro') };
    }
    redirect(destino);
  }

  const pill = suscripcion ? ESTADO_PILL[suscripcion.estado] : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <CreditCard width={16} height={16} strokeWidth={1.75} />
        <div className="flex-1">
          <span className="text-sm font-medium block">Plan &amp; Facturación</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Tu plan de Likida, lo que llevas usado y tus facturas
          </span>
        </div>
        {sp.ok === 'contratado' && <StatusPill estado="ok">Pago recibido</StatusPill>}
        {pill && <StatusPill estado={pill.tono}>{pill.texto}</StatusPill>}
      </header>

      {modo === 'prueba' && (
        <div className="glass-panel px-5 py-3 flex items-start gap-2.5 text-sm" style={{ color: 'var(--warn)' }}>
          <TriangleAlert width={16} height={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            Stripe está en modo <strong>prueba</strong>: los pagos de esta pantalla no cobran dinero real. Es lo
            correcto para ensayar, y hay que cambiar la llave a <code>sk_live</code> antes de cobrarle a un cliente.
          </span>
        </div>
      )}

      <div className="glass-panel overflow-hidden">
        {/* ── Cómo pagar: lo primero cuando hay algo pendiente ── */}
        {porPagar && (
          <section className="p-5 border-b" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Landmark width={15} height={15} strokeWidth={1.75} />
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Cómo pagar tu mensualidad
              </h2>
              <StatusPill estado="warn">Pendiente</StatusPill>
            </div>
            {banco === null ? (
              <div className="mt-3">
                <EstadoVacio icono={<TriangleAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />}>
                  Los datos para transferir todavía no están configurados, así que no se muestran a medias — una
                  cuenta incompleta manda el dinero al vacío. Escríbele a Likida para que te los pase.
                </EstadoVacio>
              </div>
            ) : !porPagar.referencia ? (
              <div className="mt-3">
                <EstadoVacio>
                  Esta factura no trae referencia de pago. Pídesela a Likida antes de transferir: sin ella no se
                  puede saber de qué mes es tu depósito.
                </EstadoVacio>
              </div>
            ) : (
              <div className="mt-3">
                <InstruccionesTransferencia
                  beneficiario={banco.beneficiario} banco={banco.banco} clabe={banco.clabe}
                  monto={porPagar.monto} moneda={porPagar.moneda} referencia={porPagar.referencia}
                />
                <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                  Un banco no nos avisa cuando entra un depósito, así que tu factura pasa a &quot;pagada&quot; en
                  cuanto Likida lo ve en el estado de cuenta — normalmente el mismo día hábil.
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── Estado ── */}
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Tu plan
          </h2>
          {suscripcion === null ? (
            <div className="mt-3">
              <EstadoVacio icono={<CreditCard width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Esta flota todavía no tiene una suscripción. Abajo están los planes disponibles.
              </EstadoVacio>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <div className="card p-4">
                <div className="text-lg font-semibold">{suscripcion.planNombre}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Plan</div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold">
                  {planActual?.precioMensual === null || planActual === null
                    ? <span className="text-sm" style={{ color: 'var(--muted)' }}>Sin precio configurado</span>
                    : `${mxn(planActual.precioMensual)}`}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Mensualidad</div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold">{fechaMx(suscripcion.inicio)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Desde</div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold">
                  {suscripcion.periodoFin ? fechaMx(suscripcion.periodoFin)
                    : <span className="text-sm" style={{ color: 'var(--muted)' }}>Sin fecha de corte</span>}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Próximo corte</div>
              </div>
            </div>
          )}
        </section>

        {/* ── Uso ── */}
        {uso && (
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Lo que llevas este mes
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Uso etiqueta="Viajes creados este mes" usado={uso.viajesMes} limite={uso.limiteViajesMes} />
              <Uso etiqueta="Operadores activos" usado={uso.operadores} limite={uso.limiteOperadores} />
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Pasarse del límite no apaga nada: tus choferes siguen mandando comprobantes y el motor sigue
              liquidando. Es la señal para hablar de subir de plan, no un candado.
            </p>
          </section>
        )}

        {/* ── Datos fiscales ── */}
        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2 mb-1">
            <FileText width={15} height={15} strokeWidth={1.75} />
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Datos para tu factura
            </h2>
            {puedeFacturar
              ? <StatusPill estado="ok">Completos</StatusPill>
              : <StatusPill estado="warn">Faltan</StatusPill>}
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Con estos se emite el CFDI de cada mensualidad. Cópialos <strong>tal cual</strong> de tu Constancia de
            Situación Fiscal: el SAT los compara contra tu RFC y rechaza el timbrado por diferencias que se ven
            inofensivas.
          </p>

          {!puedeContratar ? (
            <EstadoVacio>
              Solo el dueño de la flota puede capturarlos.
              {!puedeFacturar && ' Todavía faltan, así que no se puede facturar la mensualidad.'}
            </EstadoVacio>
          ) : (
            <FormaConAviso accion={accionFiscales} boton="Guardar datos fiscales">
              <Campo nombre="rfc" etiqueta="RFC" requerido valorInicial={fiscales?.rfc ?? ''}
                placeholder="TIN010101AB1" ayuda="Se valida el dígito verificador." />
              <Campo nombre="razonSocial" etiqueta="Razón social" requerido
                valorInicial={fiscales?.razonSocial ?? ''} placeholder="MI FLOTA SA DE CV"
                ayuda="Exacta, como en tu constancia." />
              <Campo nombre="codigoPostal" etiqueta="Código postal fiscal" requerido
                valorInicial={fiscales?.codigoPostal ?? ''} placeholder="97000" />
              <Selector nombre="regimenFiscal" etiqueta="Régimen fiscal" requerido
                valorInicial={fiscales?.regimenFiscal ?? '601'}
                opciones={REGIMENES.map((r) => ({ valor: r.clave, texto: `${r.clave} — ${r.nombre}` }))} />
              <Selector nombre="usoCfdi" etiqueta="Uso del CFDI" requerido
                valorInicial={fiscales?.usoCfdi ?? 'G03'}
                opciones={USOS_CFDI.map((u) => ({ valor: u.clave, texto: `${u.clave} — ${u.nombre}` }))}
                ayuda="G03 es como se deduce una suscripción de software." />
            </FormaConAviso>
          )}
        </section>

        {/* ── Planes ── */}
        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Planes
          </h2>

          {!hayStripe ? (
            <div className="mt-3">
              <EstadoVacio icono={<TriangleAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />}>
                El cobro en línea todavía no está conectado, así que aquí no hay botón de pago — uno que no cobra es
                peor que ninguno. Los planes y sus límites sí son reales. Para contratar, escríbele a Likida.
              </EstadoVacio>
            </div>
          ) : planes === null ? (
            <div className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudieron leer los planes.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              {planes.map((p) => {
                const esActual = p.clave === suscripcion?.planClave;
                return (
                  <TarjetaPlan key={p.clave} plan={p} esActual={esActual}>
                    {esActual ? null : !puedeContratar ? (
                      <p className="text-xs m-0" style={{ color: 'var(--muted)' }}>
                        Solo el dueño de la flota puede cambiar de plan.
                      </p>
                    ) : !puedeFacturar ? (
                      <p className="text-xs m-0" style={{ color: 'var(--muted)' }}>
                        Captura primero tus datos fiscales, arriba.
                      </p>
                    ) : (
                      <FormaConAviso accion={accionContratar} boton={suscripcion ? `Cambiar a ${p.nombre}` : `Contratar por transferencia`} columnas="md:grid-cols-1">
                        <input type="hidden" name="plan" value={p.clave} />
                      </FormaConAviso>
                    )}
                  </TarjetaPlan>
                );
              })}
            </div>
          )}

          {hayStripe && puedeContratar && suscripcion?.stripeCustomerId && (
            <div className="mt-4">
              <FormaConAviso accion={accionPortal} boton="Administrar cobro y tarjeta" columnas="md:grid-cols-1">
                <p className="text-xs m-0" style={{ color: 'var(--muted)' }}>
                  Cambiar tarjeta, ver recibos de Stripe o cancelar — sin escribirle a nadie.
                </p>
              </FormaConAviso>
            </div>
          )}
        </section>

        {/* ── Facturas ── */}
        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Tus facturas de Likida
          </h2>
          {facturas === null ? (
            <div className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudieron leer las facturas.</div>
          ) : facturas.length === 0 ? (
            <div className="mt-3">
              <EstadoVacio>
                Todavía no hay ninguna. Aparecen aquí en cuanto se cobre el primer periodo.
              </EstadoVacio>
            </div>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="py-2.5 pr-4 font-medium">Periodo</th>
                    <th className="py-2.5 pr-4 font-medium text-right">Monto</th>
                    <th className="py-2.5 pr-4 font-medium">Estado</th>
                    <th className="py-2.5 font-medium">CFDI</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map((f) => (
                    <tr key={f.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="py-2.5 pr-4">{fechaMx(f.periodoInicio)} — {fechaMx(f.periodoFin)}</td>
                      <td className="py-2.5 pr-4 text-right tabular">{mxn(f.monto)}</td>
                      <td className="py-2.5 pr-4">
                        <StatusPill estado={f.estado === 'pagada' ? 'ok' : f.estado === 'fallida' ? 'bad' : 'neutral'}>
                          {f.estado === 'pagada' ? 'Pagada' : f.estado === 'fallida' ? 'Falló el cobro' : f.estado === 'pendiente' ? 'Pendiente' : 'Cancelada'}
                        </StatusPill>
                        {f.estado !== 'pagada' && f.urlPago && (
                          <a href={f.urlPago} target="_blank" rel="noopener noreferrer"
                            className="block text-xs underline mt-1">Ver datos para transferir</a>
                        )}
                      </td>
                      <td className="py-2.5">
                        {/* Cobrada SIN timbrar es un estado real y hay que verlo:
                            el dinero entró y el cliente no puede deducirlo. */}
                        {f.cfdiUuid
                          ? <span className="font-mono text-xs">{f.cfdiUuid.slice(0, 8)}…</span>
                          : f.estado === 'pagada'
                            ? <StatusPill estado="warn">Sin timbrar</StatusPill>
                            : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            El CFDI de estas facturas no se timbra todavía: Stripe cobra, pero la factura fiscal mexicana se emite
            aparte. Si necesitas CFDI de tu mensualidad, pídeselo a Likida.
            {suscripcion?.stripeCustomerId && (
              <> Los recibos de Stripe sí están en el portal de arriba <ExternalLink width={11} height={11} strokeWidth={2} className="inline" />.</>
            )}
          </EstadoVacio>
        </div>
      </div>
    </div>
  );
}
