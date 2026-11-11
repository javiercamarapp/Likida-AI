import { getT } from '@/lib/i18n/servidor';
import { type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import { appUrl } from '@/lib/env';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { TriangleAlert } from 'lucide-react';
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
  Aviso, CampoSelect, CampoTexto, EstadoError, EstadoVacio, FormaConAviso, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import { EsqueletoPortada } from '@/app/ui-v2/esqueletos';
import './suscripcion.css';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.suscripcion') };
}

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

const estadoPill = (tr: Tr): Record<Suscripcion['estado'], { tono: 'ok' | 'warn' | 'bad' | 'neutral'; texto: string }> => ({
  prueba: { tono: 'neutral', texto: tr('suscripcion.page.enPrueba') },
  activa: { tono: 'ok', texto: tr('suscripcion.page.activa') },
  morosa: { tono: 'bad', texto: tr('suscripcion.page.pagoPendiente') },
  pausada: { tono: 'warn', texto: tr('suscripcion.page.pausada') },
  cancelada: { tono: 'neutral', texto: tr('suscripcion.page.cancelada') },
});
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
  const { t: tr } = await getT('dinero');
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
    const { t: tr } = await getT('dinero');
    const clave = String(fd.get('plan') ?? '');
    let destino: string | null;
    let huboCambioDePrice: boolean;
    try {
      // H26: `tenantDelAction` ahora lanza si falla la lectura del correo —
      // dentro del try se convierte en un aviso, no en la pantalla caída.
      const { t, email, rol: r } = await tenantDelAction(sp, tenantId);
      if (!puedeAdministrar(r)) return { error: tr('suscripcion.page.soloElDuenoDe') };
      const f = await getDatosFiscales(t);
      if (!estanCompletos(f)) {
        return { error: tr('suscripcion.page.antesDeContratarHay') };
      }
      const p = (await getPlanes()).find((x) => x.clave === clave);
      if (!p) return { error: tr('suscripcion.page.esePlanYaNo') };
      if (!p.stripePriceId) {
        return { error: tr('suscripcion.page.elPlanTodaviaNo', { nombre: p.nombre }) };
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
      return { ok: tr('suscripcion.page.planCambiadoElAjuste') };
    }
    // Sin URL la suscripción SÍ quedó creada: se dice, en vez de fingir que
    // falló y provocar que la contrate dos veces.
    if (!destino) {
      return { ok: tr('suscripcion.page.suscripcionCreadaStripeTe') };
    }
    redirect(destino);
  }

  /** Guarda con qué datos se le va a facturar a esta flota. */
  async function accionFiscales(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const { t, rol: r } = await tenantDelAction(sp, tenantId);
    if (!puedeAdministrar(r)) return { error: tr('suscripcion.page.soloElDuenoDe2') };
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
    return { ok: tr('suscripcion.page.datosFiscalesGuardadosCon') };
  }

  async function accionPortal(): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const { t, rol: r } = await tenantDelAction(sp, tenantId);
    if (!puedeAdministrar(r)) return { error: tr('suscripcion.page.soloElDuenoDe3') };

    let destino: string;
    try {
      const s = await getSuscripcion(t);
      if (!s?.stripeCustomerId) return { error: tr('suscripcion.page.estaFlotaTodaviaNo') };
      destino = await crearPortal(s.stripeCustomerId, `${appUrl()}/dashboard/suscripcion`);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'abrir el portal de cobro') };
    }
    redirect(destino);
  }

  const pill = suscripcion ? estadoPill(tr)[suscripcion.estado] : null;

  const columnasFacturas: ColumnaBase<FacturaSaas>[] = [
    { id: 'periodo', titulo: tr('suscripcion.page.periodo'), principal: true, celda: (f) => `${fechaMx(f.periodoInicio)} — ${fechaMx(f.periodoFin)}` },
    { id: 'monto', titulo: tr('suscripcion.page.monto'), alinear: 'der', celda: (f) => mxn(f.monto) },
    {
      id: 'estado', titulo: tr('suscripcion.page.estado'),
      celda: (f) => (
        <>
          <StatusChip tono={f.estado === 'pagada' ? 'ok' : f.estado === 'fallida' ? 'bad' : 'neutral'}>
            {f.estado === 'pagada' ? tr('suscripcion.page.pagada') : f.estado === 'fallida' ? tr('suscripcion.page.falloElCobro') : f.estado === 'pendiente' ? tr('suscripcion.page.pendiente') : tr('suscripcion.page.cancelada')}
          </StatusChip>
          {f.estado !== 'pagada' && f.urlPago && (
            <a href={f.urlPago} target="_blank" rel="noopener noreferrer" className="rv-sus__enlace">{tr('suscripcion.page.verDatosParaTransferir')}</a>
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
          ? <StatusChip tono="warn">{tr('suscripcion.page.sinTimbrar')}</StatusChip>
          : <span className="rv-sus__tenue">—</span>),
    },
  ];

  return (
    <EsqueletoPortada titulo={tr('suscripcion.page.planYFacturacion')} apoyo={tr('suscripcion.page.tuPlanDeLikida')}
      etiquetaCifras={tr('suscripcion.page.tuPlan')}
      cifras={suscripcionCaida || suscripcion === null ? undefined : [
        { etiqueta: 'Plan', valor: suscripcion.planNombre },
        { etiqueta: tr('suscripcion.page.mensualidad'), valor: planActual?.precioMensual === null || planActual === null || planActual === undefined ? tr('suscripcion.page.sinPrecioConfigurado') : mxn(planActual.precioMensual) },
        { etiqueta: 'Desde', valor: fechaMx(suscripcion.inicio) },
        { etiqueta: tr('suscripcion.page.proximoCorte'), valor: suscripcion.periodoFin ? fechaMx(suscripcion.periodoFin) : tr('suscripcion.page.sinFechaDeCorte') },
      ]}
      acciones={<>
        {/* H8 (auditoría 24): aquí decía "Pago recibido" solo porque la URL traía `?ok=contratado` — un query string lo escribe cualquiera, no una lectura del cobro. El estado real se pinta con `pill` (lee `suscripcion.estado` de la base). */}
        {/* La fecha de corte ya pasó (DAT-40): una prueba con corte vencido se leía como cliente al corriente y nadie le cobraba nunca. Se DICE, no se apaga nada — el mismo criterio que el límite del plan. */}
        {suscripcion?.vencida && <StatusChip tono="warn">{tr('suscripcion.page.vencioEl', { v: fechaMx(suscripcion.periodoFin!) })}</StatusChip>}
        {pill && <StatusChip tono={pill.tono}>{pill.texto}</StatusChip>}
      </>}>
      {modo === 'prueba' && (
        <Aviso tono="warn">
          {rico(tr('suscripcion.page.stripeEstaEnModo'), { strong: (c) => <strong>{c}</strong>, code: (c) => <code>{c}</code> })}
        </Aviso>
      )}

      {/* ── Cómo pagar: lo primero cuando hay algo pendiente ── */}
      {porPagar && (
        <Tarjeta titulo={tr('suscripcion.page.comoPagarTuMensualidad')} info="suscripcion.como_pagar" acciones={<StatusChip tono="warn">{tr('suscripcion.page.pendiente')}</StatusChip>}>
          {banco === null ? (
            <EstadoVacio titulo={tr('suscripcion.page.datosDePagoSin')} icono={TriangleAlert} contenido>
              {tr('suscripcion.page.losDatosParaTransferir')}
            </EstadoVacio>
          ) : !porPagar.referencia ? (
            <EstadoVacio titulo={tr('suscripcion.page.facturaSinReferenciaDe')} contenido>
              {tr('suscripcion.page.pideselaALikidaAntes')}
            </EstadoVacio>
          ) : (
            <>
              <InstruccionesTransferencia tr={tr}
                beneficiario={banco.beneficiario} banco={banco.banco} clabe={banco.clabe}
                monto={porPagar.monto} subtotal={porPagar.subtotal} iva={porPagar.iva}
                moneda={porPagar.moneda} referencia={porPagar.referencia}
              />
              <p className="rv-sus__nota">
                {tr('suscripcion.page.unBancoNoNos')}
              </p>
            </>
          )}
        </Tarjeta>
      )}

      {/* ── Estado: las cifras del plan viven en la tira de arriba; aquí solo lo que NO hay (lectura caída o sin suscripción). ── */}
      {suscripcionCaida ? (
        <Tarjeta titulo={tr('suscripcion.page.tuPlan')} info="suscripcion.plan" estado="error" mensaje={tr('suscripcion.page.noSePudoLeer')} reintentar />
      ) : suscripcion === null ? (
        <Tarjeta titulo={tr('suscripcion.page.tuPlan')} info="suscripcion.plan">
          {/* Vacío de una línea (Rovaq `.empty dotted`, 12x14): sin icono ni 200 px de aire. */}
          <p className="rv-sus__vacio" role="status"><strong>{tr('suscripcion.page.sinSuscripcionTodavia')}</strong> {tr('suscripcion.page.estaFlotaTodaviaNo2')}</p>
        </Tarjeta>
      ) : null}

      {/* ── Uso ── */}
      {uso && (
        <Tarjeta titulo={tr('suscripcion.page.loQueLlevasEste')} info="suscripcion.uso">
          <div className="rv-sus__usos">
            <Uso tr={tr} etiqueta={tr('suscripcion.page.viajesCreadosEsteMes')} usado={uso.viajesMes} limite={uso.limiteViajesMes} />
            <Uso tr={tr} etiqueta={tr('suscripcion.page.operadoresActivos')} usado={uso.operadores} limite={uso.limiteOperadores} />
          </div>
          <p className="rv-sus__nota">
            {tr('suscripcion.page.pasarseDelLimiteNo')}
          </p>
        </Tarjeta>
      )}

      {/* ── Datos fiscales ── */}
      <Tarjeta titulo={tr('suscripcion.page.datosParaTuFactura')} info="suscripcion.datos_factura"
        acciones={puedeFacturar ? <StatusChip tono="ok">{tr('suscripcion.page.completos')}</StatusChip> : <StatusChip tono="warn">{tr('suscripcion.page.faltan')}</StatusChip>}>
        <p className="rv-sus__nota">
          {rico(tr('suscripcion.page.conEstosSeEmite'), { strong: (c) => <strong>{c}</strong> })}
        </p>

        {!puedeContratar ? (
          <EstadoVacio titulo={tr('suscripcion.page.soloElDuenoLos')} contenido>
            {!puedeFacturar ? tr('suscripcion.page.todaviaFaltanAsiQue') : tr('suscripcion.page.losDatosYaEstan')}
          </EstadoVacio>
        ) : (
          <FormaConAviso accion={accionFiscales} boton="Guardar datos fiscales">
            <CampoTexto id="rfc" name="rfc" etiqueta="RFC" obligatorio defaultValue={fiscales?.rfc ?? ''}
              placeholder="TIN010101AB1" ayuda={tr('suscripcion.page.seValidaElDigito')} />
            <CampoTexto id="razonSocial" name="razonSocial" etiqueta={tr('suscripcion.page.razonSocial')} obligatorio
              defaultValue={fiscales?.razonSocial ?? ''} placeholder={tr('suscripcion.page.miFlotaSaDe')}
              ayuda={tr('suscripcion.page.exactaComoEnTu')} />
            <CampoTexto id="codigoPostal" name="codigoPostal" etiqueta={tr('suscripcion.page.codigoPostalFiscal')} obligatorio
              defaultValue={fiscales?.codigoPostal ?? ''} placeholder="97000" />
            <CampoSelect id="regimenFiscal" name="regimenFiscal" etiqueta={tr('suscripcion.page.regimenFiscal')} obligatorio
              defaultValue={fiscales?.regimenFiscal ?? '601'}>
              {REGIMENES.map((r) => <option key={r.clave} value={r.clave}>{`${r.clave} — ${r.nombre}`}</option>)}
            </CampoSelect>
            <CampoSelect id="usoCfdi" name="usoCfdi" etiqueta={tr('suscripcion.page.usoDelCfdi')} obligatorio
              defaultValue={fiscales?.usoCfdi ?? 'G03'}
              ayuda={tr('suscripcion.page.g03EsComoSe')}>
              {USOS_CFDI.map((u) => <option key={u.clave} value={u.clave}>{`${u.clave} — ${u.nombre}`}</option>)}
            </CampoSelect>
            <CampoTexto id="emailFacturacion" name="emailFacturacion" etiqueta={tr('suscripcion.page.correoParaTuFactura')}
              defaultValue={fiscales?.email ?? ''} placeholder="contabilidad@miflota.com"
              ayuda={tr('suscripcion.page.ahiTeLlegaEl')} />
            {/* AUDITORÍA 19, CRÍTICO (legal C3 / C.16): la columna existía desde la 0018 y ninguna pantalla la llenaba, así que el aviso de privacidad de TODA flota real respondía 404. Este es el lugar: los mismos datos de la constancia, capturados juntos. */}
            <CampoTexto id="domicilioFiscal" name="domicilioFiscal" etiqueta={tr('suscripcion.page.domicilioFiscal')}
              defaultValue={fiscales?.domicilioFiscal ?? ''}
              placeholder={tr('suscripcion.page.calle60123Col')}
              ayuda={tr('suscripcion.page.completoComoEnTu')} />
          </FormaConAviso>
        )}
      </Tarjeta>

      {/* ── Planes ── */}
      <Tarjeta titulo={tr('suscripcion.page.planes')} info="suscripcion.planes">
        {!hayStripe ? (
          <EstadoVacio titulo={tr('suscripcion.page.cobroEnLineaSin')} icono={TriangleAlert} contenido>
            {tr('suscripcion.page.aquiNoHayBoton')}
          </EstadoVacio>
        ) : planes === null ? (
          <EstadoError reintentar>{tr('suscripcion.page.noSePudieronLeer')}</EstadoError>
        ) : (
          <div className="rv-sus__rejilla">
            {planes.map((p) => {
              const esActual = p.clave === suscripcion?.planClave;
              return (
                <TarjetaPlan tr={tr} key={p.clave} plan={p} esActual={esActual}>
                  {esActual ? null : !puedeContratar ? (
                    <p className="rv-sus__tenue">{tr('suscripcion.page.soloElDuenoDe4')}</p>
                  ) : !puedeFacturar ? (
                    <p className="rv-sus__tenue">{tr('suscripcion.page.capturaPrimeroTusDatos')}</p>
                  ) : (
                    <FormaConAviso accion={accionContratar} boton={suscripcion ? tr('suscripcion.page.cambiarA', { nombre: p.nombre }) : tr('suscripcion.page.contratarPorTransferencia')} columnas="md:grid-cols-1">
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
              {tr('suscripcion.page.cambiarTarjetaVerRecibos')}
            </p>
          </FormaConAviso>
        )}
      </Tarjeta>

      {/* ── Facturas ── */}
      <Tarjeta titulo={tr('suscripcion.page.tusFacturasDeLikida')} info="suscripcion.facturas">
        {facturas === null ? (
          <EstadoError reintentar>{tr('suscripcion.page.noSePudieronLeer2')}</EstadoError>
        ) : facturas.length === 0 ? (
          <EstadoVacio titulo={tr('suscripcion.page.sinFacturasTodavia')} contenido>
            {tr('suscripcion.page.aparecenAquiEnCuanto')}
          </EstadoVacio>
        ) : (
          <>
            <TablaBase<FacturaSaas> etiqueta={tr('suscripcion.page.pagosPorPeriodoY')} columnas={columnasFacturas} filas={facturas}
              idFila={(f) => f.id} altoMaximo={false} tarjetaMovil />
            {/* H41 (auditoría 24): `getFacturasSaas` topa a 12 sin decirlo — el tope se declara, como en el resto del panel. */}
            {facturas.length >= LIMITE_FACTURAS_SAAS && (
              <p className="rv-sus__nota">{tr('suscripcion.page.seMuestranLasMas', { LIMITE_FACTURAS_SAAS })}</p>
            )}
          </>
        )}
      </Tarjeta>

      {/* H27 (auditoría 24): antes esta leyenda decía "el CFDI no se timbra todavía" SIEMPRE, aunque la columna CFDI ya mostrara un UUID real — dos rótulos contradiciéndose sobre el mismo dato. La leyenda genérica solo aparece cuando de verdad ninguna factura trae CFDI; si alguna sí lo tiene, la columna ya lo dice por fila. */}
      {facturas !== null && facturas.length > 0 && facturas.some((f) => f.cfdiUuid) ? null : (
        <Aviso tono="info">
          {tr('suscripcion.page.elCfdiDeEstas')}
          {suscripcion?.stripeCustomerId && (
            <> {tr('suscripcion.page.losRecibosDeStripe')}</>
          )}
        </Aviso>
      )}
    </EsqueletoPortada>
  );
}
