import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { hoyMx, mxn } from '@/lib/formato';
import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, pasoExtraSuperadmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { getPlanes, guardarPriceDePlan, listarSuscripcionesVivas, type Plan, type Suscripcion } from '@/lib/saas/suscripcion';
import { stripeConfigurado, modoStripe, webhookConfigurado } from '@/lib/saas/stripe';
import {
  datosBancarios, emitirMensualidad, conciliar, timbrarFactura, getPorCobrarTodas, tenantDeFacturaSaas, type FacturaPorCobrar,
} from '@/lib/saas/transferencia';
import { etiquetaIva } from '@/lib/saas/iva';
import { facturapiConfigurado, modoFacturapi } from '@/lib/saas/facturapi';
import { logger } from '@/lib/logger';
import { Aviso, BarraFiltros, CampoSelect, CampoTexto, Disclosure, EstadoError, FilaTarjetas, FiltroOpciones, MarcoPagina, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { accionGestionarPlan } from '../flotas/acciones-plan';
import { FormaEmitirMensualidad } from './forma-emitir';
import '../dinero.css';

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
  const s = await requireSuperadmin();
  // Confirmación extra (step-up reutilizado; apagada mientras no se encienda LIKIDA_TOTP_ESCALONADO): cambiar el price mueve lo que se cobra.
  const pasoMfa = await pasoExtraSuperadmin('dinero_saas', s);
  if (pasoMfa) return { error: pasoMfa };
  const clave = String(fd.get('plan') ?? '');
  const price = String(fd.get('price') ?? '');
  try {
    const { montoMensual, moneda, ivaIncluido } = await guardarPriceDePlan(clave, price);
    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    // Huella del acto (plan.price_guardado): quién ligó qué price a qué plan. El monto y el criterio de IVA son los LEÍDOS de Stripe.
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'plan.price_guardado', entidad: 'plan', entidadId: clave,
      detalle: { price_id: price.trim(), monto_mensual: montoMensual, moneda, iva_incluido: ivaIncluido },
    });
    const nota = anotado ? '' : AVISO_SIN_BITACORA;
    // El criterio del IVA se dice en el mismo mensaje que el monto: son la misma
    // pregunta ("cuánto se cobra") y verlos juntos es lo que permite notar que
    // falta uno. Sin criterio no se puede emitir, y eso se dice aquí y no
    // cuando alguien apriete "Emitir" y no entienda por qué se negó.
    if (ivaIncluido === null) {
      return {
        ok: `Plan ${clave}: ${mxn(montoMensual)} ${moneda} al mes, leído de Stripe. OJO: ese price no declara si el `
          + 'precio incluye IVA (tax_behavior = "unspecified"), así que TODAVÍA NO SE PUEDE EMITIR la mensualidad — '
          + 'no se sabría si cobrar el precio o el precio × 1.16. Ponle "inclusive" o "exclusive" en Stripe y vuelve '
          + 'a guardar el price.' + nota,
      };
    }
    return {
      ok: `Plan ${clave}: ${mxn(montoMensual)} ${moneda} al mes ${ivaIncluido ? 'IVA INCLUIDO' : 'MÁS IVA'}, leído `
        + 'de Stripe. Ya se puede contratar.' + nota,
    };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'guardar el precio del plan') };
  }
}

/**
 * El periodo del MES EN CURSO (México) — compartido entre `accionEmitir` (el
 * cálculo real que se emite) y la página (lo que el diálogo de confirmación
 * le anuncia al superadmin ANTES de emitir, vía `FormaEmitirMensualidad`).
 * Una fecha tecleada a mano es la forma más fácil de cobrar dos veces el
 * mismo mes con periodos que no cuadran, y el índice único de la 0057 solo
 * protege si las fechas son las mismas — por eso se calcula en un solo lugar.
 *
 * DAT-23 (auditoría prod): el mes salía de `getUTCMonth()`. El 31 de
 * diciembre a las 18:01 hora de México ya es 1 de enero en UTC, así que
 * "emitir la mensualidad de este mes" emitía la de ENERO — con el periodo
 * equivocado, el índice `una_por_periodo` (0057) sin nada contra qué chocar,
 * y diciembre sin cobrar. El mes es el de México, como el resto del panel.
 */
function periodoMesActualMx(): { ini: string; fin: string } {
  const [anio, mes] = hoyMx().split('-').map(Number);
  const ini = `${anio}-${String(mes).padStart(2, '0')}-01`;
  // Día 0 del mes SIGUIENTE = último del actual. La aritmética va en UTC a
  // propósito: ya opera sobre un año y un mes resueltos en México, no sobre el
  // reloj.
  const fin = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  return { ini, fin };
}

/**
 * Emite la mensualidad de una flota.
 */
async function accionEmitir(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  const s = await requireSuperadmin();
  const tenantId = String(fd.get('tenantId') ?? '');
  if (!tenantId) return { error: 'Elige una flota.' };
  // Confirmación extra (step-up reutilizado): emitir es decirle a una flota cuánto transferir.
  const pasoMfa = await pasoExtraSuperadmin('dinero_saas', s, tenantId);
  if (pasoMfa) return { error: pasoMfa };

  const { ini, fin } = periodoMesActualMx();

  try {
    const r = await emitirMensualidad(tenantId, ini, fin);
    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId, accion: 'mensualidad.emitida', entidad: 'factura_saas', entidadId: r.id,
      detalle: { periodo_inicio: ini, periodo_fin: fin, monto: r.monto, subtotal: r.subtotal, iva: r.iva, referencia: r.referencia },
    });
    // Se dicen las TRES cifras. El total es lo que la flota transfiere y el
    // desglose es lo que va a salir en su CFDI: verlos juntos en la misma frase
    // es lo que permite cachar el día uno que el IVA quedó del lado equivocado.
    return {
      ok: `Mensualidad emitida por ${mxn(r.monto)} (base ${mxn(r.subtotal)} + IVA ${mxn(r.iva)}). La flota ya ve a `
        + `dónde transferir, con la referencia ${r.referencia}.` + (anotado ? '' : AVISO_SIN_BITACORA),
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
  // Confirmación extra (step-up reutilizado): marcar pagada dispara además el timbrado de un CFDI real.
  const pasoMfa = await pasoExtraSuperadmin('dinero_saas', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const id = String(fd.get('facturaId') ?? '');
    await conciliar(id, String(fd.get('referenciaBanco') ?? ''), s.userId);
    // Huella del pago (pago.conciliado). La flota se lee DESPUÉS, solo para atribuir el asiento; si no se pudo leer, el asiento
    // sale sin flota (la factura va en `entidad_id`) en vez de perderse. La referencia del banco queda en la propia factura.
    const tenantFactura = await tenantDeFacturaSaas(id).catch(() => null);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: tenantFactura, accion: 'pago.conciliado', entidad: 'factura_saas', entidadId: id,
      detalle: { con_referencia_banco: true },
    });

    // El timbrado va DESPUÉS y con su propio try: el pago ya quedó registrado y
    // un PAC caído no puede deshacer un hecho del banco.
    let nota = '';
    try {
      const r = await timbrarFactura(id);
      nota = 'uuid' in r ? ` CFDI timbrado: ${r.uuid.slice(0, 8)}…` : ` ${r.pendiente}`;
    } catch (e) {
      // A37-L-03: timeout/5xx/respuesta ilegible del PAC = el CFDI PUDO crearse. Decir
      // «NO se timbró» mandaba a timbrar a mano y emitía un segundo CFDI real.
      nota = (e as { ambiguo?: boolean } | null)?.ambiguo === true
        ? ` El pago quedó registrado, pero NO se sabe si el CFDI se emitió (el PAC no contestó). NO lo timbres a mano todavía: ${mensajeParaPantalla(e, 'timbrar')}`
        : ` El pago quedó registrado, pero el CFDI NO se timbró: ${mensajeParaPantalla(e, 'timbrar')}`;
    }

    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    return { ok: `Factura marcada como pagada, con su referencia del banco.${nota}${anotado ? '' : AVISO_SIN_BITACORA}` };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'conciliar el pago') };
  }
}


const ESTADOS_SUSCRIPCION = ['prueba', 'activa', 'morosa', 'pausada'] as const;
const TONO_SUSCRIPCION: Record<Suscripcion['estado'], TonoEstado> = { prueba: 'info', activa: 'ok', morosa: 'bad', pausada: 'warn', cancelada: 'muted' };
const ROTULO_SUSCRIPCION: Record<Suscripcion['estado'], string> = { prueba: 'En prueba', activa: 'Activa', morosa: 'Morosa', pausada: 'Pausada', cancelada: 'Cancelada' };

const sinDato = (s: unknown): s is null => s === null;

/**
 * Facturación › Planes y cobro. Lo que Likida cobra a sus flotas: asignar y mover el plan de una flota, emitir la mensualidad del
 * mes, marcar un pago recibido (que dispara el timbrado del CFDI) y ligar cada plan con su precio de Stripe. El gasto de IA vive en
 * Consumo de IA. Las acciones de servidor NO cambiaron: solo se les agregó su huella en la bitácora (ver `acciones_bitacora.test.tsx`).
 *
 * `null` es «no se pudo leer», `[]` es «no hay nada»: cada lectura cae por su lado y se dice.
 */
export default async function CostosFacturacionPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const filtroEstado = sp.estado ?? '';
  const r = await getResumenNegocio().catch((e) => { logger.error('admin.resumen_negocio', { err: e instanceof Error ? e.message : String(e) }); return null; });
  const flotas = r ? r.flotas.map((f) => ({ id: f.id, nombre: f.nombre })) : null;
  // Mismo cálculo que corre `accionEmitir` — el diálogo de confirmación le anuncia al superadmin el periodo REAL que se va a emitir.
  const periodoActual = periodoMesActualMx();

  const hayStripe = stripeConfigurado();
  const modo = modoStripe();

  // ── `null` ES "NO SE PUDO LEER", `[]` ES "NO HAY NADA" ────────────────────
  // Esa frase («Nada pendiente de cobro») es una AFIRMACIÓN sobre el dinero que Likida tiene por cobrar, y es exactamente la que hace
  // que nadie vaya a cobrar. Sin Stripe no se piden los planes: la sección se reemplaza por el aviso de qué falta.
  let planes: Plan[] | null = hayStripe ? null : [];
  if (hayStripe) {
    try { planes = await getPlanes(); } catch (e) { logger.error('admin.planes', { err: e instanceof Error ? e.message : String(e) }); }
  }
  let suscripciones: Suscripcion[] | null = null;
  try { suscripciones = await listarSuscripcionesVivas(); } catch (e) { logger.error('admin.suscripciones', { err: e instanceof Error ? e.message : String(e) }); }

  const banco = datosBancarios();
  let porCobrar: FacturaPorCobrar[] | null = null;
  // A37-S06-07: la lectura completa trae además el total exacto de la base; si rebasa lo mostrado, se avisa.
  let totalPorCobrar = 0;
  try { const lectura = await getPorCobrarTodas(); porCobrar = lectura.facturas; totalPorCobrar = lectura.total; } catch (e) { logger.error('admin.por_cobrar', { err: e instanceof Error ? e.message : String(e) }); }
  const recortada = porCobrar !== null && totalPorCobrar > porCobrar.length;

  const porTenant = new Map((suscripciones ?? []).map((s) => [s.tenantId, s]));
  const filasFlota = (flotas ?? []).map((f) => ({ ...f, suscripcion: porTenant.get(f.id) ?? null }))
    .filter((f) => (filtroEstado === 'sin' ? f.suscripcion === null : filtroEstado ? f.suscripcion?.estado === filtroEstado : true));
  const conSuscripcion = (flotas ?? []).filter((f) => porTenant.has(f.id)).length;
  const contables = planes ? planes.filter((p) => p.stripePriceId && p.precioIvaIncluido !== null).length : null;
  const sumaPorCobrar = porCobrar && !recortada ? porCobrar.reduce((s, f) => s + f.monto, 0) : null;

  return (
    <MarcoPagina titulo="Facturación" apoyo="Lo que Likida cobra a sus flotas: planes, mensualidad, pagos recibidos y su CFDI.">
      {!banco ? (
        <Aviso tono="warn" titulo="Sin cuenta de cobro configurada">
          Faltan la CLABE, el banco o el beneficiario de la cuenta de Likida, o la CLABE no es válida. Sin las tres, la pantalla del cliente no muestra
          instrucciones de pago, para no mandar un depósito a una cuenta incompleta.
        </Aviso>
      ) : null}
      {!hayStripe ? (
        <Aviso tono="warn" titulo="Stripe sin conectar">Sin la llave de Stripe no se puede leer un precio ni cobrar con tarjeta, y la pantalla del cliente esconde el botón de pago a propósito.</Aviso>
      ) : !webhookConfigurado() ? (
        <Aviso tono="error" titulo="Falta el secreto del webhook de Stripe">
          Se puede mandar a pagar, pero Likida no se entera del pago y la suscripción nunca pasa a activa: el cliente pagaría y seguiría viéndose sin plan.
        </Aviso>
      ) : null}

      <TiraCifras etiqueta="Cobro de la mensualidad" items={[
        porCobrar === null
          ? { etiqueta: 'Por cobrar', valor: null, estado: 'error', mensaje: 'No se pudo leer lo que está por cobrarse.', reintentar: true }
          : recortada
            ? { etiqueta: 'Por cobrar', valor: null, estado: 'error', mensaje: 'La lista está recortada: no se suma un total parcial.', reintentar: true }
            : { etiqueta: 'Por cobrar', valor: sumaPorCobrar, formato: 'mxn', nota: `${totalPorCobrar} ${totalPorCobrar === 1 ? 'factura pendiente o fallida' : 'facturas pendientes o fallidas'}.`, tono: totalPorCobrar > 0 ? 'warn' : undefined },
        sinDato(suscripciones) || flotas === null
          ? { etiqueta: 'Flotas con plan asignado', valor: null, estado: 'error', mensaje: 'No se pudo leer las suscripciones.', reintentar: true }
          : { etiqueta: 'Flotas con plan asignado', valor: `${conSuscripcion} de ${flotas.length}`, nota: 'Sin plan asignado no hay mensualidad que emitir.', tono: conSuscripcion < flotas.length ? 'warn' : 'ok' },
        sinDato(planes) || contables === null
          ? { etiqueta: 'Planes que se pueden contratar', valor: null, estado: 'error', mensaje: 'No se pudieron leer los planes.', reintentar: true }
          : !hayStripe
            ? { etiqueta: 'Planes que se pueden contratar', valor: null, estado: 'vacio', mensaje: 'Stripe sin conectar' }
            : { etiqueta: 'Planes que se pueden contratar', valor: `${contables} de ${planes.length}`, nota: 'Necesitan precio ligado y criterio de IVA.' },
        {
          etiqueta: 'Timbrado de CFDI',
          valor: facturapiConfigurado() ? (modoFacturapi() === 'produccion' ? 'Producción' : 'En prueba') : 'Sin conectar',
          nota: facturapiConfigurado() ? 'Se timbra al marcar un pago como recibido.' : 'El pago queda válido con el CFDI pendiente.',
          tono: facturapiConfigurado() && modoFacturapi() === 'produccion' ? 'ok' : 'warn',
        },
      ]} />

      <FilaTarjetas variante="8-4">
        <Tarjeta titulo="Por cobrar" estado={porCobrar === null ? 'error' : porCobrar.length === 0 ? 'vacio' : 'ok'} contenida={porCobrar !== null && porCobrar.length === 0} mensaje={porCobrar === null ? 'No se pudo leer lo que está por cobrarse' : 'Nada pendiente de cobro'}
          detalle={porCobrar === null ? 'Esto NO quiere decir que no haya nada pendiente: quiere decir que no se sabe. Recarga en un momento.' : 'Aparece aquí en cuanto emitas una mensualidad.'} reintentar>
          {porCobrar !== null ? (
            <>
              {recortada ? (
                <Aviso tono="warn">Se muestran {porCobrar.length} de {totalPorCobrar} facturas por cobrar: la lista está recortada. Las más viejas no aparecen aquí.</Aviso>
              ) : null}
              {/* El total manda (es lo que entra al banco) y el desglose va debajo: es lo que va a salir en el CFDI. Sin desglose se dice, porque esa factura NO se va a poder timbrar. */}
              <TablaBase
                etiqueta="Facturas por cobrar" idFila={(f) => f.id} tarjetaMovil densa filas={porCobrar}
                columnas={[
                  { id: 'flota', titulo: 'Flota', principal: true, celda: (f) => f.tenantNombre },
                  { id: 'periodo', titulo: 'Periodo', celda: (f) => `${f.periodoInicio} a ${f.periodoFin}` },
                  { id: 'ref', titulo: 'Referencia', celda: (f) => f.referencia ?? '—' },
                  { id: 'estado', titulo: 'Estado', celda: (f) => <StatusChip tono={f.estado === 'fallida' ? 'bad' : 'warn'}>{f.estado === 'fallida' ? 'Fallida' : 'Pendiente'}</StatusChip> },
                  {
                    id: 'total', titulo: 'Total a transferir', alinear: 'der',
                    celda: (f) => (
                      <>
                        {mxn(f.monto)}
                        <span className="adm-din-sub">{f.subtotal === null || f.iva === null ? 'sin desglose: no se puede timbrar' : `${mxn(f.subtotal)} + IVA ${mxn(f.iva)}`}</span>
                      </>
                    ),
                  },
                ]}
              />
              <div className="adm-din-forma">
                <FormaConAviso accion={accionConciliar} boton="Marcar pagada" columnas="md:grid-cols-1">
                  <CampoSelect etiqueta="Factura que ya se pagó" name="facturaId" obligatorio defaultValue="">
                    <option value="">Elige…</option>
                    {porCobrar.map((f) => <option key={f.id} value={f.id}>{f.tenantNombre} · {f.periodoInicio} a {f.periodoFin} · {mxn(f.monto)}</option>)}
                  </CampoSelect>
                  <CampoTexto etiqueta="Referencia del banco" name="referenciaBanco" obligatorio placeholder="Folio del movimiento" ayuda="Un banco no manda avisos: cuando veas el depósito en el estado de cuenta, márcalo aquí." />
                </FormaConAviso>
              </div>
            </>
          ) : null}
        </Tarjeta>

        <Tarjeta titulo="Emitir la mensualidad de este mes" estado={flotas === null ? 'error' : flotas.length === 0 ? 'vacio' : 'ok'} mensaje={flotas === null ? 'No se pudo leer la lista de flotas' : 'Sin flotas dadas de alta'} detalle="Cada flota aparece aquí cuando se da de alta." reintentar>
          {flotas !== null ? (
            <>
              <p className="adm-din-nota">Genera el cobro del periodo con el precio del plan de la flota. Hay un solo cobro por periodo y no se deshace desde aquí.</p>
              <FormaEmitirMensualidad accion={accionEmitir} flotas={flotas} periodoIni={periodoActual.ini} periodoFin={periodoActual.fin} />
            </>
          ) : null}
        </Tarjeta>
      </FilaTarjetas>

      <Tarjeta titulo="Plan de cada flota" estado={flotas === null || suscripciones === null ? 'error' : flotas.length === 0 ? 'vacio' : 'ok'}
        mensaje={flotas === null || suscripciones === null ? 'No se pudo leer el plan de las flotas' : 'Sin flotas dadas de alta'} detalle="Cada flota aparece aquí cuando se da de alta." reintentar>
        {flotas !== null && suscripciones !== null ? (
          <>
            <BarraFiltros accion="/admin/costos-facturacion" enLinea etiqueta="Filtrar flotas por estado del plan" nActivos={filtroEstado ? 1 : 0} limpiarHref="/admin/costos-facturacion">
              <FiltroOpciones
                etiqueta="Estado del plan" nombre="estado" valor={filtroEstado}
                opciones={[{ valor: 'sin', rotulo: 'Sin plan asignado' }, ...ESTADOS_SUSCRIPCION.map((e) => ({ valor: e, rotulo: ROTULO_SUSCRIPCION[e] }))]}
              />
            </BarraFiltros>
            <TablaBase
              etiqueta="Plan y estado de cada flota" idFila={(f) => f.id} tarjetaMovil densa filas={filasFlota}
              vacio={{ titulo: 'Ninguna flota con ese estado', texto: 'Quita el filtro para ver todas.' }}
              columnas={[
                { id: 'flota', titulo: 'Flota', principal: true, celda: (f) => f.nombre },
                { id: 'plan', titulo: 'Plan', celda: (f) => f.suscripcion?.planNombre ?? '—' },
                {
                  id: 'estado', titulo: 'Estado',
                  celda: (f) => (f.suscripcion
                    ? <StatusChip tono={TONO_SUSCRIPCION[f.suscripcion.estado]}>{ROTULO_SUSCRIPCION[f.suscripcion.estado]}</StatusChip>
                    : <StatusChip tono="muted">Sin plan asignado</StatusChip>),
                },
                { id: 'corte', titulo: 'Corte del periodo', celda: (f) => (f.suscripcion?.periodoFin ? <>{f.suscripcion.periodoFin}{f.suscripcion.vencida ? <StatusChip tono="warn">Vencido</StatusChip> : null}</> : '—') },
                { id: 'gestion', titulo: 'Se gestiona', celda: (f) => (f.suscripcion ? (f.suscripcion.stripeSubscriptionId ? 'En Stripe' : 'Aquí') : '—') },
              ]}
            />
            <Disclosure titulo="Asignar, activar, pausar o cancelar un plan" resumen="Con huella en la bitácora">
              <div className="adm-din-forma">
                <p className="adm-din-nota">
                  Asignar crea la suscripción en estado «prueba»: ya se le puede emitir la mensualidad, pero no cuenta como ingreso recurrente hasta activarla.
                  Una suscripción que se cobra con Stripe se gestiona en Stripe, no aquí.
                </p>
                {planes === null ? (
                  <Aviso tono="warn">No se pudieron leer los planes: reintenta antes de asignar uno.</Aviso>
                ) : (
                  <FormaConAviso accion={accionGestionarPlan} boton="Asignar o cambiar plan" columnas="md:grid-cols-1">
                    <input type="hidden" name="operacion" value="asignar" />
                    <CampoSelect etiqueta="Flota" name="tenantId" obligatorio defaultValue="">
                      <option value="">Elige…</option>
                      {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                    </CampoSelect>
                    <CampoSelect etiqueta="Plan" name="planClave" obligatorio defaultValue="" ayuda="Solo se asignan planes con precio ligado y criterio de IVA.">
                      <option value="">Elige…</option>
                      {planes.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
                    </CampoSelect>
                  </FormaConAviso>
                )}
                <FormaConAviso accion={accionGestionarPlan} boton="Aplicar" columnas="md:grid-cols-1">
                  <CampoSelect etiqueta="Flota" name="tenantId" obligatorio defaultValue="">
                    <option value="">Elige…</option>
                    {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                  </CampoSelect>
                  <CampoSelect etiqueta="Qué hacer" name="operacion" obligatorio defaultValue="activar" ayuda="Activar la cuenta para el ingreso recurrente, o pausarla.">
                    <option value="activar">Activar la suscripción</option>
                    <option value="pausar">Pausar la suscripción</option>
                  </CampoSelect>
                </FormaConAviso>
                <FormaConAviso
                  accion={accionGestionarPlan} boton="Cancelar suscripción" columnas="md:grid-cols-1"
                  confirmar={{
                    titulo: 'Cancelar la suscripción de una flota',
                    descripcion: 'La suscripción queda cancelada y la flota vuelve al plan de demostración. No se borra su historial de cobro. Para volver a cobrarle habrá que asignarle un plan de nuevo.',
                    etiquetaConfirmar: 'Sí, cancelar',
                  }}
                >
                  <input type="hidden" name="operacion" value="cancelar" />
                  <CampoSelect etiqueta="Flota" name="tenantId" obligatorio defaultValue="">
                    <option value="">Elige…</option>
                    {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                  </CampoSelect>
                </FormaConAviso>
              </div>
            </Disclosure>
          </>
        ) : null}
      </Tarjeta>

      <Tarjeta titulo="Planes y precios" estado={!hayStripe ? 'vacio' : planes === null ? 'error' : 'ok'}
        mensaje={!hayStripe ? 'Falta conectar Stripe' : 'No se pudieron leer los planes'}
        detalle={!hayStripe ? 'Sin la llave de Stripe no se puede leer un precio ni cobrar: la pantalla del cliente esconde el botón de pago a propósito.' : undefined} reintentar
        acciones={modo === null ? <StatusChip tono="bad">Stripe sin conectar</StatusChip> : modo === 'prueba' ? <StatusChip tono="warn">Llave de prueba</StatusChip> : <StatusChip tono="ok">Producción</StatusChip>}>
        {planes !== null && hayStripe ? (
          <>
            <div className="adm-din-rejilla">
              {planes.map((p) => (
                <div key={p.clave} className="adm-din-plan">
                  <div className="adm-din-plan__cab">
                    <span>{p.nombre}</span>
                    {/* El criterio del IVA gatea el cobro igual que el precio: un plan con precio y sin criterio NO se puede emitir, y «Se puede contratar» ahí sería falso. */}
                    {!p.stripePriceId
                      ? <StatusChip tono="muted">Sin precio</StatusChip>
                      : p.precioIvaIncluido === null
                        ? <StatusChip tono="bad">IVA sin declarar</StatusChip>
                        : <StatusChip tono="ok">Se puede contratar</StatusChip>}
                  </div>
                  <div className="adm-din-plan__precio">
                    {p.precioMensual === null
                      ? <small>Sin configurar</small>
                      : <>{mxn(p.precioMensual)} <small>al mes {etiquetaIva(p.precioIvaIncluido)}</small></>}
                  </div>
                  {p.precioMensual !== null && p.precioIvaIncluido === null ? (
                    <p className="adm-din-nota">
                      Su precio en Stripe no dice si trae el IVA. Emitir la mensualidad está bloqueado: no se sabe si cobrar {mxn(p.precioMensual)} o {mxn(p.precioMensual * 1.16)}.
                    </p>
                  ) : null}
                  <FormaConAviso accion={accionPrecio} boton="Guardar price" columnas="md:grid-cols-1">
                    <input type="hidden" name="plan" value={p.clave} />
                    <CampoTexto etiqueta="Price ID de Stripe" name="price" obligatorio defaultValue={p.stripePriceId ?? ''} placeholder="price_1Abc..." />
                  </FormaConAviso>
                </div>
              ))}
            </div>
            <p className="adm-din-nota">
              El monto <strong>no se teclea</strong>: se lee de Stripe al guardar el precio, junto con el lado del IVA. Capturados aparte, el panel podría decir una cifra y Stripe cobrar otra.
              Sin ese dato no se emite nada: un CFDI por 16 % de más solo se corrige cancelándolo ante el SAT.
            </p>
          </>
        ) : null}
      </Tarjeta>

      <Disclosure titulo="Lo que aún no existe aquí" resumen="MRR por plan, descuentos, cobranza automática">
        <p className="adm-din-nota">
          El ingreso recurrente por plan, su evolución y el margen por cliente tienen de dónde salir, pero necesitan flotas cobrando de verdad: con cero suscripciones activas
          cualquier cifra sería un cero de encuadre. Tampoco hay descuentos ni periodos de gracia por flota, ni cobro automático al cliente: marcar pagada una factura es un paso
          manual contra el estado de cuenta del banco, a propósito. El timbrado del CFDI sí está conectado y se dispara solo al marcar un pago.
        </p>
      </Disclosure>
      {r === null ? <EstadoError reintentar>No se pudo leer la lista de flotas: las acciones que necesitan elegir una flota no se ofrecen. Recarga en un momento.</EstadoError> : null}
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Planes y cobro' };
