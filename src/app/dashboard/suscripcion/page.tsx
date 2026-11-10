import { appUrl } from '@/lib/env';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { CreditCard, TriangleAlert } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import {
  getPlanes, getSuscripcion, getFacturasSaas, getUso, cambiarPlan, LIMITE_FACTURAS_SAAS,
  type Plan, type Suscripcion, type FacturaSaas, type UsoDelPlan,
} from '@/lib/saas/suscripcion';
import { crearPortal, stripeConfigurado, modoStripe } from '@/lib/saas/stripe';
import { datosBancarios } from '@/lib/saas/transferencia';
import {
  getDatosFiscales, guardarDatosFiscales, estanCompletos, REGIMENES, USOS_CFDI,
  type DatosFiscalesFlota,
} from '@/lib/saas/fiscal';
import { mxn } from '@/lib/utils';
import { fechaMx } from '../formato';
import { Uso, TarjetaPlan, InstruccionesTransferencia } from './vista';
import type { Metadata } from 'next';
import {
  Aviso, CamposSistema, CampoSelect, CampoTexto, EstadoError, EstadoVacio, FormaConAviso, MarcoPagina, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import './suscripcion.css';
export const metadata: Metadata = { title: 'Plan y facturación' };

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * A qué tenant escribe la Server Action. Vive a nivel de MÓDULO, no dentro del
 * componente: una función anidada capturada por el closure de un `'use
 * server'` cuenta como valor a serializar hacia el cliente, y una función
 * plana no lo es — "Functions cannot be passed directly to Client
 * Components". Por eso recibe `tenantPedido` como parámetro en vez de
 * cerrarlo del render.
 */
async function tenantDelAction(
  sp: { vista?: string; tenant?: string; rol?: string } | undefined,
  tenantId: string,
): Promise<{ t: string; email: string | null; rol: string }> {
  // A37-S20-02: el MISMO resolutor que la página (con `sp`), no la sesión
  // sola: con `?vista=demo` la página enseñaba la demo y la action contrataba
  // plan o guardaba datos fiscales en la flota de la cookie del selector.
  // MX-002: la flota que se pintó es la que contrata y guarda (la de la cookie del selector puede ser otra en otra pestaña).
  const s = await resolverTenantAtadoOLanza('/dashboard/suscripcion', sp, tenantId);
  const t = s.tenantId;
  // H26 (auditoría 24): sin comprobar `error`, una lectura caída de
  // `app_user` se veía IGUAL que un usuario sin correo — y `accionContratar`
  // manda ese correo a Stripe como el destinatario del CFDI de la mensualidad.
  // Silenciarlo mandaba la suscripción con el correo vacío por una falla de
  // base, no porque el usuario de verdad no tuviera uno.
  const { data: u, error } = await supabaseAdmin().from('app_user').select('email').eq('id', s.userId).maybeSingle();
  if (error) throw new Error(`tenantDelAction: no se pudo leer el correo de la cuenta (${error.message})`);
  return { t, email: (u?.email as string) ?? null, rol: s.rol };
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

  // H9 (auditoría 24): `getSuscripcion` puede devolver `null` DE VERDAD (esta
  // flota no tiene suscripción) — un valor legítimo, no una falla. `safe()`
  // (como el resto de las lecturas de esta página) también convierte una
  // base caída en `null`, y entonces las dos cosas se ven IGUAL: "no tiene
  // suscripción" y "no se pudo leer si tiene" no pueden confundirse, porque
  // la primera manda al cliente a los planes y la segunda es una falla que
  // hay que reintentar. Se marca aparte.
  const [planes, [suscripcion, suscripcionCaida], facturas] = await Promise.all([
    safe<Plan[]>(() => getPlanes()),
    getSuscripcion(tenantId).then((v): [Suscripcion | null, boolean] => [v, false])
      .catch((): [Suscripcion | null, boolean] => [null, true]),
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

  /**
   * Abre el pago. `requireSessionTenant` y el `redirect` final van FUERA del
   * try: los dos redirigen LANZANDO, y atraparlos convertiría el envío a Stripe
   * en un aviso rojo — el cliente vería "no se pudo" de un cobro que sí iba.
   */
  /**
   * Contrata el plan, O CAMBIA AL PLAN NUEVO si ya había una suscripción —
   * PAGADO POR TRANSFERENCIA.
   *
   * No es un checkout: la documentación de Stripe dice que las transferencias
   * bancarias no son compatibles con Checkout en modo suscripción. Se crea la
   * suscripción con `send_invoice` y Stripe emite la factura con la CLABE y la
   * referencia; el webhook `invoice.paid` avisa cuando el dinero cae.
   *
   * SE EXIGEN LOS DATOS FISCALES ANTES. Cobrarle a una flota a la que después
   * no le puedes facturar es el peor orden posible: ya tienes su dinero y su
   * contador no tiene con qué deducirlo.
   *
   * "CAMBIAR DE PLAN" VA POR `cambiarPlan`, no por `crearSuscripcionPorTransferencia`
   * directo (auditoría 2, hallazgo real). Ese atajo creaba una SEGUNDA
   * suscripción de Stripe cada vez que alguien apretaba "Cambiar a…" sin
   * cancelar la primera: la flota terminaba pagando dos mensualidades, y la
   * base solo se enteraba cuando el webhook de la segunda reventaba el índice
   * único de la 0052 — para entonces las dos ya habían cobrado.
   * `cambiarPlan` decide adentro: si ya hay una suscripción viva de Stripe le
   * cambia el price a ESA MISMA, y solo crea una nueva si no había ninguna.
   */
  async function accionContratar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const clave = String(fd.get('plan') ?? '');
    let destino: string | null;
    let huboCambioDePrice: boolean;
    try {
      // H26: `tenantDelAction` ahora lanza si falla la lectura del correo —
      // dentro del try se convierte en un aviso, no en la pantalla caída.
      const { t, email, rol: r } = await tenantDelAction(sp, tenantId);
      if (!puedeAdministrar(r)) return { error: 'Solo el dueño de la flota puede contratar o cambiar de plan.' };
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
      const r2 = await cambiarPlan({
        priceId: p.stripePriceId,
        tenantId: t,
        suscripcionActual: s,
        fiscales: {
          rfc: f!.rfc!, razonSocial: f!.razonSocial!, regimenFiscal: f!.regimenFiscal!,
          codigoPostal: f!.codigoPostal!,
          // A37-S20-05: el correo que la flota declaró para su factura gobierna al customer de
          // Stripe; el de quien hace clic (p. ej. un superadmin que contrata por la flota) es
          // solo el respaldo.
          email: f!.email ?? email ?? '',
        },
      });
      destino = r2.urlFactura;
      huboCambioDePrice = r2.huboCambioDePrice;
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'cambiar de plan') };
    }

    revalidatePath('/dashboard/suscripcion');
    // Cambiar el price de una suscripción existente no genera una URL de pago
    // nueva a la que mandar al cliente: se actualizó, no se creó.
    if (huboCambioDePrice) {
      return { ok: 'Plan cambiado. El ajuste llega en tu próxima factura de Likida.' };
    }
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
    const { t, rol: r } = await tenantDelAction(sp, tenantId);
    if (!puedeAdministrar(r)) return { error: 'Solo el dueño de la flota puede cambiar los datos fiscales.' };
    try {
      await guardarDatosFiscales(t, {
        rfc: String(fd.get('rfc') ?? ''),
        razonSocial: String(fd.get('razonSocial') ?? ''),
        regimenFiscal: String(fd.get('regimenFiscal') ?? ''),
        codigoPostal: String(fd.get('codigoPostal') ?? ''),
        usoCfdi: String(fd.get('usoCfdi') ?? ''),
        // A dónde llega el CFDI (DAT-33). Opcional a propósito: sin él se puede
        // timbrar, solo que el papel no le llega a nadie — y eso lo dice la
        // pantalla, en vez de bloquear la contratación por un dato que se puede
        // capturar después.
        email: String(fd.get('emailFacturacion') ?? ''),
        // El domicilio del aviso de privacidad (auditoría 19, legal C3 /
        // C.16): sin él, /aviso/<flota> no puede decir dónde reclamarle al
        // responsable y el tratamiento de datos de los operadores se queda
        // frenado en el primer mensaje.
        domicilioFiscal: String(fd.get('domicilioFiscal') ?? ''),
      });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar los datos fiscales') };
    }
    revalidatePath('/dashboard/suscripcion');
    return { ok: 'Datos fiscales guardados. Con estos se te va a emitir el CFDI de cada mensualidad.' };
  }

  async function accionPortal(): Promise<ResultadoAccion> {
    'use server';
    const { t, rol: r } = await tenantDelAction(sp, tenantId);
    if (!puedeAdministrar(r)) return { error: 'Solo el dueño de la flota puede administrar el cobro.' };

    let destino: string;
    try {
      const s = await getSuscripcion(t);
      if (!s?.stripeCustomerId) return { error: 'Esta flota todavía no tiene un cliente en Stripe: no hay nada que administrar.' };
      destino = await crearPortal(s.stripeCustomerId, `${appUrl()}/dashboard/suscripcion`);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'abrir el portal de cobro') };
    }
    redirect(destino);
  }

  const pill = suscripcion ? ESTADO_PILL[suscripcion.estado] : null;

  const columnasFacturas: ColumnaBase<FacturaSaas>[] = [
    { id: 'periodo', titulo: 'Periodo', principal: true, celda: (f) => `${fechaMx(f.periodoInicio)} — ${fechaMx(f.periodoFin)}` },
    { id: 'monto', titulo: 'Monto', alinear: 'der', celda: (f) => mxn(f.monto) },
    {
      id: 'estado', titulo: 'Estado',
      celda: (f) => (
        <>
          <StatusChip tono={f.estado === 'pagada' ? 'ok' : f.estado === 'fallida' ? 'bad' : 'neutral'}>
            {f.estado === 'pagada' ? 'Pagada' : f.estado === 'fallida' ? 'Falló el cobro' : f.estado === 'pendiente' ? 'Pendiente' : 'Cancelada'}
          </StatusChip>
          {f.estado !== 'pagada' && f.urlPago && (
            <a href={f.urlPago} target="_blank" rel="noopener noreferrer" className="rv-sus__enlace">Ver datos para transferir</a>
          )}
        </>
      ),
    },
    {
      id: 'cfdi', titulo: 'CFDI',
      // Cobrada SIN timbrar es un estado real y hay que verlo: el dinero entró y el cliente no puede deducirlo.
      celda: (f) => (f.cfdiUuid
        ? <span className="rv-sus__mono">{f.cfdiUuid.slice(0, 8)}…</span>
        : f.estado === 'pagada'
          ? <StatusChip tono="warn">Sin timbrar</StatusChip>
          : <span className="rv-sus__tenue">—</span>),
    },
  ];

  return (
    <MarcoPagina titulo="Plan y facturación" apoyo="Tu plan de Likida, lo que llevas usado y tus facturas." acciones={<>
        {/* H8 (auditoría 24): aquí decía "Pago recibido" solo porque la URL traía `?ok=contratado` — un query string lo escribe cualquiera, no una lectura del cobro. El estado real se pinta con `pill` (lee `suscripcion.estado` de la base). */}
        {/* La fecha de corte ya pasó (DAT-40): una prueba con corte vencido se leía como cliente al corriente y nadie le cobraba nunca. Se DICE, no se apaga nada — el mismo criterio que el límite del plan. */}
        {suscripcion?.vencida && <StatusChip tono="warn">Venció el {fechaMx(suscripcion.periodoFin!)}</StatusChip>}
        {pill && <StatusChip tono={pill.tono}>{pill.texto}</StatusChip>}
      </>}>
      {modo === 'prueba' && (
        <Aviso tono="warn">
          Stripe está en modo <strong>prueba</strong>: los pagos de esta pantalla no cobran dinero real. Es lo
          correcto para ensayar, y hay que cambiar la llave a <code>sk_live</code> antes de cobrarle a un cliente.
        </Aviso>
      )}

      {/* ── Cómo pagar: lo primero cuando hay algo pendiente ── */}
      {porPagar && (
        <Tarjeta titulo="Cómo pagar tu mensualidad" info="suscripcion.como_pagar" acciones={<StatusChip tono="warn">Pendiente</StatusChip>}>
          {banco === null ? (
            <EstadoVacio titulo="Datos de pago sin configurar" icono={TriangleAlert} contenido>
              Los datos para transferir todavía no están configurados, así que no se muestran a medias: una
              cuenta incompleta manda el dinero al vacío. Escríbele a Likida para que te los pase.
            </EstadoVacio>
          ) : !porPagar.referencia ? (
            <EstadoVacio titulo="Factura sin referencia de pago" contenido>
              Pídesela a Likida antes de transferir: sin ella no se puede saber de qué mes es tu depósito.
            </EstadoVacio>
          ) : (
            <>
              <InstruccionesTransferencia
                beneficiario={banco.beneficiario} banco={banco.banco} clabe={banco.clabe}
                monto={porPagar.monto} subtotal={porPagar.subtotal} iva={porPagar.iva}
                moneda={porPagar.moneda} referencia={porPagar.referencia}
              />
              <p className="rv-sus__nota">
                Un banco no nos avisa cuando entra un depósito, así que tu factura pasa a &quot;pagada&quot; en
                cuanto Likida lo ve en el estado de cuenta — normalmente el mismo día hábil.
              </p>
            </>
          )}
        </Tarjeta>
      )}

      {/* ── Estado ── */}
      <Tarjeta titulo="Tu plan" info="suscripcion.plan">
        {suscripcionCaida ? (
          <EstadoError reintentar>No se pudo leer tu suscripción ahora mismo. Esto no significa que no tengas una: vuelve a intentarlo antes de contratar un plan nuevo.</EstadoError>
        ) : suscripcion === null ? (
          <EstadoVacio titulo="Sin suscripción todavía" icono={CreditCard} contenido>
            Esta flota todavía no tiene una suscripción. Abajo están los planes disponibles.
          </EstadoVacio>
        ) : (
          <CamposSistema etiqueta="Tu plan" campos={[
            { etiqueta: 'Plan', valor: suscripcion.planNombre },
            { etiqueta: 'Mensualidad', valor: planActual?.precioMensual === null || planActual === null || planActual === undefined ? 'Sin precio configurado' : mxn(planActual.precioMensual) },
            { etiqueta: 'Desde', valor: fechaMx(suscripcion.inicio) },
            { etiqueta: 'Próximo corte', valor: suscripcion.periodoFin ? fechaMx(suscripcion.periodoFin) : 'Sin fecha de corte' },
          ]} />
        )}
      </Tarjeta>

      {/* ── Uso ── */}
      {uso && (
        <Tarjeta titulo="Lo que llevas este mes" info="suscripcion.uso">
          <div className="rv-sus__rejilla">
            <Uso etiqueta="Viajes creados este mes" usado={uso.viajesMes} limite={uso.limiteViajesMes} />
            <Uso etiqueta="Operadores activos" usado={uso.operadores} limite={uso.limiteOperadores} />
          </div>
          <p className="rv-sus__nota">
            Pasarse del límite no apaga nada: tus choferes siguen mandando comprobantes y el motor sigue
            liquidando. Es la señal para hablar de subir de plan, no un candado.
          </p>
        </Tarjeta>
      )}

      {/* ── Datos fiscales ── */}
      <Tarjeta titulo="Datos para tu factura" info="suscripcion.datos_factura"
        acciones={puedeFacturar ? <StatusChip tono="ok">Completos</StatusChip> : <StatusChip tono="warn">Faltan</StatusChip>}>
        <p className="rv-sus__nota">
          Con estos se emite el CFDI de cada mensualidad. Cópialos <strong>tal cual</strong> de tu Constancia de
          Situación Fiscal: el SAT los compara contra tu RFC y rechaza el timbrado por diferencias que se ven
          inofensivas.
        </p>

        {!puedeContratar ? (
          <EstadoVacio titulo="Solo el dueño los captura" contenido>
            {!puedeFacturar ? 'Todavía faltan, así que no se puede facturar la mensualidad.' : 'Los datos ya están completos.'}
          </EstadoVacio>
        ) : (
          <FormaConAviso accion={accionFiscales} boton="Guardar datos fiscales">
            <CampoTexto id="rfc" name="rfc" etiqueta="RFC" obligatorio defaultValue={fiscales?.rfc ?? ''}
              placeholder="TIN010101AB1" ayuda="Se valida el dígito verificador." />
            <CampoTexto id="razonSocial" name="razonSocial" etiqueta="Razón social" obligatorio
              defaultValue={fiscales?.razonSocial ?? ''} placeholder="MI FLOTA SA DE CV"
              ayuda="Exacta, como en tu constancia." />
            <CampoTexto id="codigoPostal" name="codigoPostal" etiqueta="Código postal fiscal" obligatorio
              defaultValue={fiscales?.codigoPostal ?? ''} placeholder="97000" />
            <CampoSelect id="regimenFiscal" name="regimenFiscal" etiqueta="Régimen fiscal" obligatorio
              defaultValue={fiscales?.regimenFiscal ?? '601'}>
              {REGIMENES.map((r) => <option key={r.clave} value={r.clave}>{`${r.clave} — ${r.nombre}`}</option>)}
            </CampoSelect>
            <CampoSelect id="usoCfdi" name="usoCfdi" etiqueta="Uso del CFDI" obligatorio
              defaultValue={fiscales?.usoCfdi ?? 'G03'}
              ayuda="G03 es como se deduce una suscripción de software.">
              {USOS_CFDI.map((u) => <option key={u.clave} value={u.clave}>{`${u.clave} — ${u.nombre}`}</option>)}
            </CampoSelect>
            <CampoTexto id="emailFacturacion" name="emailFacturacion" etiqueta="Correo para tu factura"
              defaultValue={fiscales?.email ?? ''} placeholder="contabilidad@miflota.com"
              ayuda="Ahí te llega el CFDI de cada mensualidad. Si lo dejas vacío, se timbra igual pero no te llega a nadie." />
            {/* AUDITORÍA 19, CRÍTICO (legal C3 / C.16): la columna existía desde la 0018 y ninguna pantalla la llenaba, así que el aviso de privacidad de TODA flota real respondía 404. Este es el lugar: los mismos datos de la constancia, capturados juntos. */}
            <CampoTexto id="domicilioFiscal" name="domicilioFiscal" etiqueta="Domicilio fiscal"
              defaultValue={fiscales?.domicilioFiscal ?? ''}
              placeholder="Calle 60 #123, Col. Centro, 97000 Mérida, Yuc."
              ayuda="Completo, como en tu constancia. Es el que aparece en el aviso de privacidad de tus operadores; sin él, tus choferes no pueden mandar comprobantes — la ley obliga a decirles quién es responsable de sus datos y dónde." />
          </FormaConAviso>
        )}
      </Tarjeta>

      {/* ── Planes ── */}
      <Tarjeta titulo="Planes" info="suscripcion.planes">
        {!hayStripe ? (
          <EstadoVacio titulo="Cobro en línea sin conectar" icono={TriangleAlert} contenido>
            Aquí no hay botón de pago: uno que no cobra es peor que ninguno. Los planes y sus límites sí son reales. Para contratar, escríbele a Likida.
          </EstadoVacio>
        ) : planes === null ? (
          <EstadoError reintentar>No se pudieron leer los planes.</EstadoError>
        ) : (
          <div className="rv-sus__rejilla">
            {planes.map((p) => {
              const esActual = p.clave === suscripcion?.planClave;
              return (
                <TarjetaPlan key={p.clave} plan={p} esActual={esActual}>
                  {esActual ? null : !puedeContratar ? (
                    <p className="rv-sus__tenue">Solo el dueño de la flota puede cambiar de plan.</p>
                  ) : !puedeFacturar ? (
                    <p className="rv-sus__tenue">Captura primero tus datos fiscales, arriba.</p>
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
          <FormaConAviso accion={accionPortal} boton="Administrar cobro y tarjeta" columnas="md:grid-cols-1">
            <p className="rv-sus__tenue">
              Cambiar tarjeta, ver recibos de Stripe o cancelar — sin escribirle a nadie.
            </p>
          </FormaConAviso>
        )}
      </Tarjeta>

      {/* ── Facturas ── */}
      <Tarjeta titulo="Tus facturas de Likida" info="suscripcion.facturas">
        {facturas === null ? (
          <EstadoError reintentar>No se pudieron leer las facturas.</EstadoError>
        ) : facturas.length === 0 ? (
          <EstadoVacio titulo="Sin facturas todavía" contenido>
            Aparecen aquí en cuanto se cobre el primer periodo.
          </EstadoVacio>
        ) : (
          <>
            <TablaBase<FacturaSaas> etiqueta="Pagos por periodo y monto" columnas={columnasFacturas} filas={facturas}
              idFila={(f) => f.id} altoMaximo={false} tarjetaMovil />
            {/* H41 (auditoría 24): `getFacturasSaas` topa a 12 sin decirlo — el tope se declara, como en el resto del panel. */}
            {facturas.length >= LIMITE_FACTURAS_SAAS && (
              <p className="rv-sus__nota">Se muestran las {LIMITE_FACTURAS_SAAS} más recientes.</p>
            )}
          </>
        )}
      </Tarjeta>

      {/* H27 (auditoría 24): antes esta leyenda decía "el CFDI no se timbra todavía" SIEMPRE, aunque la columna CFDI ya mostrara un UUID real — dos rótulos contradiciéndose sobre el mismo dato. La leyenda genérica solo aparece cuando de verdad ninguna factura trae CFDI; si alguna sí lo tiene, la columna ya lo dice por fila. */}
      {facturas !== null && facturas.length > 0 && facturas.some((f) => f.cfdiUuid) ? null : (
        <Aviso tono="info">
          El CFDI de estas facturas no se timbra todavía: Stripe cobra, pero la factura fiscal mexicana se emite
          aparte. Si necesitas CFDI de tu mensualidad, pídeselo a Likida.
          {suscripcion?.stripeCustomerId && (
            <> Los recibos de Stripe sí están en el portal de arriba.</>
          )}
        </Aviso>
      )}
    </MarcoPagina>
  );
}
