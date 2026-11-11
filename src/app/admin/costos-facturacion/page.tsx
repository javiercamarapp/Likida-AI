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
  datosBancarios, emitirMensualidad, conciliar, timbrarFactura, getPorCobrarTodas, tenantDeFacturaSaas, listarFacturasSaas, type FacturaPorCobrar, type FacturaSaasFila,
} from '@/lib/saas/transferencia';
import { etiquetaIva } from '@/lib/saas/iva';
import { facturapiConfigurado, modoFacturapi } from '@/lib/saas/facturapi';
import { logger } from '@/lib/logger';
import { Aviso, BarraFiltros, CampoSelect, CampoTexto, Disclosure, EstadoError, FilaTarjetas, FiltroOpciones, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { Columnas, DonaMini, type PropsCifra } from '@/app/ui-v2/graficas';
import { uniformes } from '../cifras-uniformes';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { accionGestionarPlan } from '../flotas/acciones-plan';
import { FormaEmitirMensualidad } from './forma-emitir';
import '../dinero.css';
import '../resumen.css';

import { getT } from '@/lib/i18n/servidor';
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
  const { t } = await getT('admin_dinero');
  const s = await requireSuperadmin();
  const tenantId = String(fd.get('tenantId') ?? '');
  if (!tenantId) return { error: t('costos_facturacion.elige_una_flota') };
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
  const { t } = await getT('admin_dinero');
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
        ? t('costos_facturacion.el_pago_quedo_registrado', { e: mensajeParaPantalla(e, 'timbrar') })
        : t('costos_facturacion.el_pago_quedo_registrado_2', { e: mensajeParaPantalla(e, 'timbrar') });
    }

    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    return { ok: t('costos_facturacion.factura_marcada_como_pagada', { nota, anotado: anotado ? '' : AVISO_SIN_BITACORA }) };
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
  const { t } = await getT('admin_dinero');
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
  // Historia de lo facturado (barras por mes y dona por estado). `null` = no se pudo leer, y la gráfica lo dice; una lista recortada
  // por el tope no se dibuja como completa.
  let historial: { filas: FacturaSaasFila[]; truncado: boolean } | null = null;
  try { const h = await listarFacturasSaas({ limite: 500 }); historial = { filas: h.filas, truncado: h.truncado }; } catch (e) { logger.error('admin.facturas_historial', { err: e instanceof Error ? e.message : String(e) }); }

  const porTenant = new Map((suscripciones ?? []).map((s) => [s.tenantId, s]));
  const filasFlota = (flotas ?? []).map((f) => ({ ...f, suscripcion: porTenant.get(f.id) ?? null }))
    .filter((f) => (filtroEstado === 'sin' ? f.suscripcion === null : filtroEstado ? f.suscripcion?.estado === filtroEstado : true));
  const conSuscripcion = (flotas ?? []).filter((f) => porTenant.has(f.id)).length;
  const contables = planes ? planes.filter((p) => p.stripePriceId && p.precioIvaIncluido !== null).length : null;
  const sumaPorCobrar = porCobrar && !recortada ? porCobrar.reduce((s, f) => s + f.monto, 0) : null;

  const cifras: PropsCifra[] = uniformes([
    porCobrar === null
      ? { etiqueta: t('costos_facturacion.por_cobrar'), valor: null, estado: 'error', mensaje: t('costos_facturacion.no_se_pudo_leer'), reintentar: true }
      : recortada
        ? { etiqueta: t('costos_facturacion.por_cobrar'), valor: null, estado: 'error', mensaje: t('costos_facturacion.la_lista_esta_recortada'), reintentar: true }
        : { etiqueta: t('costos_facturacion.por_cobrar'), valor: sumaPorCobrar, formato: 'mxn', nota: `${totalPorCobrar} ${totalPorCobrar === 1 ? 'factura pendiente o fallida' : 'facturas pendientes o fallidas'}.`, tono: totalPorCobrar > 0 ? 'warn' : undefined },
    sinDato(suscripciones) || flotas === null
      ? { etiqueta: t('costos_facturacion.flotas_con_plan_asignado'), valor: null, estado: 'error', mensaje: t('costos_facturacion.no_se_pudo_leer_2'), reintentar: true }
      : { etiqueta: t('costos_facturacion.flotas_con_plan_asignado'), valor: `${conSuscripcion} de ${flotas.length}`, nota: t('costos_facturacion.sin_plan_asignado_no'), tono: conSuscripcion < flotas.length ? 'warn' : 'ok' },
    sinDato(planes) || contables === null
      ? { etiqueta: t('costos_facturacion.planes_que_se_pueden'), valor: null, estado: 'error', mensaje: t('costos_facturacion.no_se_pudieron_leer'), reintentar: true }
      : !hayStripe
        ? { etiqueta: t('costos_facturacion.planes_que_se_pueden'), valor: null, estado: 'vacio', mensaje: t('costos_facturacion.stripe_sin_conectar') }
        : { etiqueta: t('costos_facturacion.planes_que_se_pueden'), valor: `${contables} de ${planes.length}`, nota: t('costos_facturacion.necesitan_precio_ligado_y') },
    {
      etiqueta: t('costos_facturacion.timbrado_de_cfdi'),
      valor: facturapiConfigurado() ? (modoFacturapi() === 'produccion' ? t('costos_facturacion.produccion') : t('costos_facturacion.en_prueba')) : t('costos_facturacion.sin_conectar'),
      nota: facturapiConfigurado() ? t('costos_facturacion.se_timbra_al_marcar') : t('costos_facturacion.el_pago_queda_valido'),
      tono: facturapiConfigurado() && modoFacturapi() === 'produccion' ? 'ok' : 'warn',
    },
  ]);

  // Graficas del panel (8-4): facturado por mes (sin canceladas) y facturas por estado.
  const porMes = new Map<string, number>();
  for (const f of historial?.filas ?? []) if (f.estado !== 'cancelada') porMes.set(f.periodoInicio.slice(0, 7), (porMes.get(f.periodoInicio.slice(0, 7)) ?? 0) + f.monto);
  const mesesOrden = [...porMes.keys()].sort().slice(-12);
  const porEstado = new Map<string, number>();
  for (const f of historial?.filas ?? []) porEstado.set(String(f.estado), (porEstado.get(String(f.estado)) ?? 0) + 1);
  const graficas = [
    historial === null
      ? <Tarjeta key="barras" titulo={t('costos_facturacion.facturado_por_mes')} estado="error" mensaje={t('costos_facturacion.no_se_pudo_leer_3')} reintentar />
      : mesesOrden.length === 0
        ? <Tarjeta key="barras" titulo={t('costos_facturacion.facturado_por_mes')} estado="vacio" mensaje={t('costos_facturacion.sin_facturas_emitidas')} detalle={t('costos_facturacion.aparece_aqui_en_cuanto')} />
        : (
          <Tarjeta key="barras" titulo={t('costos_facturacion.facturado_por_mes')} elevar entra="tarjeta">
            <Columnas datos={mesesOrden.map((m) => ({ etiqueta: m, valor: porMes.get(m)! }))} etiqueta={t('costos_facturacion.facturado_por_mes')} formato="mxn" matiz={8} />
            {historial.truncado ? <p className="adm-din-nota">{t('costos_facturacion.historial_recortado')}</p> : null}
          </Tarjeta>
        ),
    historial === null
      ? <Tarjeta key="dona" titulo={t('costos_facturacion.facturas_por_estado')} estado="error" mensaje={t('costos_facturacion.no_se_pudo_leer_3')} reintentar />
      : porEstado.size === 0
        ? <Tarjeta key="dona" titulo={t('costos_facturacion.facturas_por_estado')} estado="vacio" mensaje={t('costos_facturacion.sin_facturas_emitidas')} detalle={t('costos_facturacion.aparece_aqui_en_cuanto')} />
        : (
          <Tarjeta key="dona" titulo={t('costos_facturacion.facturas_por_estado')} elevar entra="tarjeta">
            <DonaMini gajos={[...porEstado.entries()].map(([etiqueta, valor]) => ({ etiqueta, valor }))} etiqueta={t('costos_facturacion.facturas_por_estado')} formato="numero" matiz={8} />
          </Tarjeta>
        ),
  ];

  return (
    <EsqueletoPanelCifras
      titulo={t('costos_facturacion.facturacion')} apoyo={t('costos_facturacion.lo_que_likida_cobra')}
      etiquetaCifras={t('costos_facturacion.cobro_de_la_mensualidad')} cifras={cifras} graficas={graficas} variante="8-4"
      avisos={(
        <>
          {!banco ? (
            <Aviso tono="warn" titulo={t('costos_facturacion.sin_cuenta_de_cobro')}>
          
              {t('costos_facturacion.faltan_la_clabe_el')}
            </Aviso>
          ) : null}
          {!hayStripe ? (
            <Aviso tono="warn" titulo={t('costos_facturacion.stripe_sin_conectar')}>{t('costos_facturacion.sin_la_llave_de')}</Aviso>
          ) : !webhookConfigurado() ? (
            <Aviso tono="error" titulo={t('costos_facturacion.falta_el_secreto_del')}>
          
              {t('costos_facturacion.se_puede_mandar_a')}
            </Aviso>
          ) : null}
        </>
      )}
    >
      <div className="adm-pila adm-forma-fina">
      <FilaTarjetas variante="8-4">
        <Tarjeta titulo={t('costos_facturacion.por_cobrar')} estado={porCobrar === null ? 'error' : porCobrar.length === 0 ? 'vacio' : 'ok'} contenida={porCobrar !== null && porCobrar.length === 0} mensaje={porCobrar === null ? t('costos_facturacion.no_se_pudo_leer_3') : t('costos_facturacion.nada_pendiente_de_cobro')}
          detalle={porCobrar === null ? t('costos_facturacion.esto_no_quiere_decir') : t('costos_facturacion.aparece_aqui_en_cuanto')} reintentar>
          {porCobrar !== null ? (
            <>
              {recortada ? (
                <Aviso tono="warn">Se muestran {porCobrar.length} de {totalPorCobrar} facturas por cobrar: la lista está recortada. Las más viejas no aparecen aquí.</Aviso>
              ) : null}
              {/* El total manda (es lo que entra al banco) y el desglose va debajo: es lo que va a salir en el CFDI. Sin desglose se dice, porque esa factura NO se va a poder timbrar. */}
              <TablaBase
                etiqueta={t('costos_facturacion.facturas_por_cobrar')} idFila={(f) => f.id} tarjetaMovil filas={porCobrar}
                columnas={[
                  { id: 'flota', titulo: t('costos_facturacion.flota'), principal: true, celda: (f) => f.tenantNombre },
                  { id: 'periodo', titulo: t('costos_facturacion.periodo'), celda: (f) => `${f.periodoInicio} a ${f.periodoFin}` },
                  { id: 'ref', titulo: t('costos_facturacion.referencia'), celda: (f) => f.referencia ?? '—' },
                  { id: 'estado', titulo: t('costos_facturacion.estado'), celda: (f) => <StatusChip tono={f.estado === 'fallida' ? 'bad' : 'warn'}>{f.estado === 'fallida' ? 'Fallida' : 'Pendiente'}</StatusChip> },
                  {
                    id: 'total', titulo: t('costos_facturacion.total_a_transferir'), alinear: 'der',
                    celda: (f) => (
                      <>
                        {mxn(f.monto)}
                        <span className="adm-din-sub">{f.subtotal === null || f.iva === null ? t('costos_facturacion.sin_desglose_no_se') : `${mxn(f.subtotal)} + IVA ${mxn(f.iva)}`}</span>
                      </>
                    ),
                  },
                ]}
              />
              <div className="adm-din-forma">
                <FormaConAviso accion={accionConciliar} boton="Marcar pagada" columnas="md:grid-cols-1">
                  <CampoSelect etiqueta={t('costos_facturacion.factura_que_ya_se')} name="facturaId" obligatorio defaultValue="">
                    <option value="">Elige…</option>
                    {porCobrar.map((f) => <option key={f.id} value={f.id}>{f.tenantNombre} · {f.periodoInicio} a {f.periodoFin} · {mxn(f.monto)}</option>)}
                  </CampoSelect>
                  <CampoTexto etiqueta={t('costos_facturacion.referencia_del_banco')} name="referenciaBanco" obligatorio placeholder={t('costos_facturacion.folio_del_movimiento')} ayuda={t('costos_facturacion.un_banco_no_manda')} />
                </FormaConAviso>
              </div>
            </>
          ) : null}
        </Tarjeta>

        <Tarjeta titulo={t('costos_facturacion.emitir_la_mensualidad_de')} estado={flotas === null ? 'error' : flotas.length === 0 ? 'vacio' : 'ok'} mensaje={flotas === null ? t('costos_facturacion.no_se_pudo_leer_4') : t('costos_facturacion.sin_flotas_dadas_de')} detalle={t('costos_facturacion.cada_flota_aparece_aqui')} reintentar>
          {flotas !== null ? (
            <>
              <p className="adm-din-nota">{t('costos_facturacion.genera_el_cobro_del')}</p>
              <FormaEmitirMensualidad accion={accionEmitir} flotas={flotas} periodoIni={periodoActual.ini} periodoFin={periodoActual.fin} />
            </>
          ) : null}
        </Tarjeta>
      </FilaTarjetas>

      <Tarjeta titulo={t('costos_facturacion.plan_de_cada_flota')} estado={flotas === null || suscripciones === null ? 'error' : flotas.length === 0 ? 'vacio' : 'ok'}
        mensaje={flotas === null || suscripciones === null ? t('costos_facturacion.no_se_pudo_leer_5') : t('costos_facturacion.sin_flotas_dadas_de')} detalle={t('costos_facturacion.cada_flota_aparece_aqui')} reintentar>
        {flotas !== null && suscripciones !== null ? (
          <>
            <BarraFiltros accion="/admin/costos-facturacion" enLinea etiqueta={t('costos_facturacion.filtrar_flotas_por_estado')} nActivos={filtroEstado ? 1 : 0} limpiarHref="/admin/costos-facturacion">
              <FiltroOpciones
                etiqueta={t('costos_facturacion.estado_del_plan')} nombre="estado" valor={filtroEstado}
                opciones={[{ valor: 'sin', rotulo: t('costos_facturacion.sin_plan_asignado') }, ...ESTADOS_SUSCRIPCION.map((e) => ({ valor: e, rotulo: ROTULO_SUSCRIPCION[e] }))]}
              />
            </BarraFiltros>
            <TablaBase
              etiqueta={t('costos_facturacion.plan_y_estado_de')} idFila={(f) => f.id} tarjetaMovil filas={filasFlota}
              vacio={{ titulo: t('costos_facturacion.ninguna_flota_con_ese'), texto: t('costos_facturacion.quita_el_filtro_para') }}
              columnas={[
                { id: 'flota', titulo: t('costos_facturacion.flota'), principal: true, celda: (f) => f.nombre },
                { id: 'plan', titulo: t('costos_facturacion.plan'), celda: (f) => f.suscripcion?.planNombre ?? '—' },
                {
                  id: 'estado', titulo: t('costos_facturacion.estado'),
                  celda: (f) => (f.suscripcion
                    ? <StatusChip tono={TONO_SUSCRIPCION[f.suscripcion.estado]}>{ROTULO_SUSCRIPCION[f.suscripcion.estado]}</StatusChip>
                    : <StatusChip tono="muted">{t('costos_facturacion.sin_plan_asignado')}</StatusChip>),
                },
                { id: 'corte', titulo: t('costos_facturacion.corte_del_periodo'), celda: (f) => (f.suscripcion?.periodoFin ? <>{f.suscripcion.periodoFin}{f.suscripcion.vencida ? <StatusChip tono="warn">Vencido</StatusChip> : null}</> : '—') },
                { id: 'gestion', titulo: t('costos_facturacion.se_gestiona'), celda: (f) => (f.suscripcion ? (f.suscripcion.stripeSubscriptionId ? t('costos_facturacion.en_stripe') : t('costos_facturacion.aqui')) : '—') },
              ]}
            />
            <Disclosure titulo={t('costos_facturacion.asignar_activar_pausar_o')} resumen="Con huella en la bitácora">
              <div className="adm-din-forma">
                <p className="adm-din-nota">
                  
                  {t('costos_facturacion.asignar_crea_la_suscripcion')}
                </p>
                {planes === null ? (
                  <Aviso tono="warn">{t('costos_facturacion.no_se_pudieron_leer_2')}</Aviso>
                ) : (
                  <FormaConAviso accion={accionGestionarPlan} boton="Asignar o cambiar plan" columnas="md:grid-cols-1">
                    <input type="hidden" name="operacion" value="asignar" />
                    <CampoSelect etiqueta={t('costos_facturacion.flota')} name="tenantId" obligatorio defaultValue="">
                      <option value="">Elige…</option>
                      {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                    </CampoSelect>
                    <CampoSelect etiqueta={t('costos_facturacion.plan')} name="planClave" obligatorio defaultValue="" ayuda={t('costos_facturacion.solo_se_asignan_planes')}>
                      <option value="">Elige…</option>
                      {planes.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
                    </CampoSelect>
                  </FormaConAviso>
                )}
                <FormaConAviso accion={accionGestionarPlan} boton="Aplicar" columnas="md:grid-cols-1">
                  <CampoSelect etiqueta={t('costos_facturacion.flota')} name="tenantId" obligatorio defaultValue="">
                    <option value="">Elige…</option>
                    {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                  </CampoSelect>
                  <CampoSelect etiqueta={t('costos_facturacion.que_hacer')} name="operacion" obligatorio defaultValue="activar" ayuda={t('costos_facturacion.activar_la_cuenta_para')}>
                    <option value="activar">{t('costos_facturacion.activar_la_suscripcion')}</option>
                    <option value="pausar">{t('costos_facturacion.pausar_la_suscripcion')}</option>
                  </CampoSelect>
                </FormaConAviso>
                <FormaConAviso
                  accion={accionGestionarPlan} boton="Cancelar suscripción" columnas="md:grid-cols-1"
                  confirmar={{
                    titulo: t('costos_facturacion.cancelar_la_suscripcion_de'),
                    descripcion: t('costos_facturacion.la_suscripcion_queda_cancelada'),
                    etiquetaConfirmar: t('costos_facturacion.si_cancelar'),
                  }}
                >
                  <input type="hidden" name="operacion" value="cancelar" />
                  <CampoSelect etiqueta={t('costos_facturacion.flota')} name="tenantId" obligatorio defaultValue="">
                    <option value="">Elige…</option>
                    {flotas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                  </CampoSelect>
                </FormaConAviso>
              </div>
            </Disclosure>
          </>
        ) : null}
      </Tarjeta>

      <Tarjeta titulo={t('costos_facturacion.planes_y_precios')} estado={!hayStripe ? 'vacio' : planes === null ? 'error' : 'ok'}
        mensaje={!hayStripe ? t('costos_facturacion.falta_conectar_stripe') : t('costos_facturacion.no_se_pudieron_leer_3')}
        detalle={!hayStripe ? t('costos_facturacion.sin_la_llave_de_2') : undefined} reintentar
        acciones={modo === null ? <StatusChip tono="bad">{t('costos_facturacion.stripe_sin_conectar')}</StatusChip> : modo === 'prueba' ? <StatusChip tono="warn">{t('costos_facturacion.llave_de_prueba')}</StatusChip> : <StatusChip tono="ok">{t('costos_facturacion.produccion')}</StatusChip>}>
        {planes !== null && hayStripe ? (
          <>
            <div className="adm-din-rejilla">
              {planes.map((p) => (
                <div key={p.clave} className="adm-din-plan">
                  <div className="adm-din-plan__cab">
                    <span>{p.nombre}</span>
                    {/* El criterio del IVA gatea el cobro igual que el precio: un plan con precio y sin criterio NO se puede emitir, y «Se puede contratar» ahí sería falso. */}
                    {!p.stripePriceId
                      ? <StatusChip tono="muted">{t('costos_facturacion.sin_precio')}</StatusChip>
                      : p.precioIvaIncluido === null
                        ? <StatusChip tono="bad">{t('costos_facturacion.iva_sin_declarar')}</StatusChip>
                        : <StatusChip tono="ok">{t('costos_facturacion.se_puede_contratar')}</StatusChip>}
                  </div>
                  <div className="adm-din-plan__precio">
                    {p.precioMensual === null
                      ? <small>{t('costos_facturacion.sin_configurar')}</small>
                      : <>{mxn(p.precioMensual)} <small>al mes {etiquetaIva(p.precioIvaIncluido)}</small></>}
                  </div>
                  {p.precioMensual !== null && p.precioIvaIncluido === null ? (
                    <p className="adm-din-nota">
                      Su precio en Stripe no dice si trae el IVA. Emitir la mensualidad está bloqueado: no se sabe si cobrar {mxn(p.precioMensual)} o {mxn(p.precioMensual * 1.16)}.
                    </p>
                  ) : null}
                  <FormaConAviso accion={accionPrecio} boton="Guardar price" columnas="md:grid-cols-1">
                    <input type="hidden" name="plan" value={p.clave} />
                    <CampoTexto etiqueta={t('costos_facturacion.price_id_de_stripe')} name="price" obligatorio defaultValue={p.stripePriceId ?? ''} placeholder="price_1Abc..." />
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

      <Disclosure titulo={t('costos_facturacion.lo_que_aun_no')} resumen="MRR por plan, descuentos, cobranza automática">
        <p className="adm-din-nota">
          
          {t('costos_facturacion.el_ingreso_recurrente_por')}
        </p>
      </Disclosure>
      {r === null ? <EstadoError reintentar>{t('costos_facturacion.no_se_pudo_leer_6')}</EstadoError> : null}
      </div>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_dinero');
  return { title: t('costos_facturacion.planes_y_cobro') };
}
