import { getT } from '@/lib/i18n/servidor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import { revalidatePath } from 'next/cache';
import { Link2 } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { mxn, fechaMx, fechaHoraMx } from '@/lib/formato';
import { diasDeVigencia } from '@/lib/likida/portal_pago';
import { panelDelPortal, TOPE_REPS_PANEL, type PanelPortal } from '@/lib/likida/portal_pago_lectura';
import {
  crearLigaPago, revocarLigaPago, conciliarPropuesta, descartarPropuesta, registrarRepEmitido,
} from '@/lib/likida/portal_pago_escritura';
import { FormaConAviso, Campo, Selector, type ResultadoAccion } from '../../admin/ui/forma';
import { EstadoVacio } from '../estados';
import { TituloSeccion } from '../resumen-visual';

/**
 * EL PORTAL DE PAGO — la sección del contralor (0228).
 *
 * Vive en Facturación y no en una pantalla propia por la misma razón que el
 * auditor de cobranza y las estadías: lo que se decide aquí —conciliar un
 * depósito, revocar un enlace— es la MISMA cartera de arriba, y separarlo
 * obligaría a cruzar dos pantallas para responder una sola pregunta.
 *
 * ── LA REGLA QUE ESTA SECCIÓN EXISTE PARA SOSTENER ────────────────────────
 *
 * Lo que el cliente registra en su enlace NO toca la cartera. Aparece aquí,
 * como propuesta, con el saldo REAL de la factura al lado, y espera. Conciliar
 * es un botón que aprieta una persona después de mirar su estado de cuenta, y
 * es lo único que crea el abono de verdad — por `registrar_pago_tx`, el mismo
 * camino que el pago tecleado a mano.
 *
 * ── EL ENLACE SE ENSEÑA UNA VEZ ───────────────────────────────────────────
 *
 * La base guarda el sha256 del token, no el token. Así que el link completo
 * solo existe en el mensaje verde que sale al generarlo: si se pierde, se
 * revoca y se genera otro. No es una molestia de diseño, es la razón por la
 * que un volcado de esa tabla no abre las facturas de nadie.
 */

const RUTA = '/dashboard/facturacion';

export async function BloquePortalPago({
  sp,
}: {
  sp: { tenant?: string; rol?: string; vista?: string };
}) {
  const { t: tr } = await getT('dinero');
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) return null;

  // Lectura independiente de la cartera: su fallo pinta el error DICHO, no una
  // bandeja vacía que se leería como «ningún cliente ha registrado nada».
  let panel: PanelPortal | null = null;
  try {
    panel = await panelDelPortal(tenantId);
  } catch (e) {
    logger.warn('portal_pago.panel_no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  async function generar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('facturacion.portal.tuRolNoPuede') };
    const facturaId = String(fd.get('facturaId') ?? '');
    if (!facturaId) return { error: tr('facturacion.portal.eligeLaFacturaDel') };
    try {
      const liga = await crearLigaPago(s.tenantId, facturaId, { id: s.userId });
      revalidatePath(RUTA);
      // EL ÚNICO MOMENTO en que el link completo existe. Se dice que es el
      // único, para que nadie cierre la pantalla creyendo que puede volver.
      return {
        ok: tr('facturacion.portal.enlaceGeneradoCopialoAhora', { url: liga.url, v: fechaMx(liga.expiraEn) }),
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'generar el enlace de pago') };
    }
  }

  async function revocar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('facturacion.portal.tuRolNoPuede2') };
    try {
      await revocarLigaPago(s.tenantId, String(fd.get('ligaId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: tr('facturacion.portal.enlaceRevocadoQuienLo') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'revocar el enlace') };
    }
  }

  async function conciliar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('facturacion.portal.tuRolNoPuede3') };
    try {
      const r = await conciliarPropuesta(s.tenantId, String(fd.get('propuestaId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: tr('facturacion.portal.conciliadoEntraronALa', { v: mxn(r.monto) }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'conciliar el pago') };
    }
  }

  async function descartar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('facturacion.portal.tuRolNoPuede4') };
    try {
      await descartarPropuesta(
        s.tenantId,
        String(fd.get('propuestaId') ?? ''),
        String(fd.get('motivo') ?? ''),
        { id: s.userId },
      );
      revalidatePath(RUTA);
      return { ok: tr('facturacion.portal.descartadoConTuMotivo') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'descartar el registro') };
    }
  }

  async function anotarRep(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('facturacion.portal.tuRolNoPuede5') };
    try {
      await registrarRepEmitido(s.tenantId, {
        facturaId: String(fd.get('facturaId') ?? ''),
        pagoId: String(fd.get('pagoId') ?? ''),
        cfdiUuid: String(fd.get('cfdiUuid') ?? ''),
        fechaPago: String(fd.get('fechaPago') ?? ''),
        impPagado: String(fd.get('impPagado') ?? ''),
        formaPago: String(fd.get('formaPago') ?? ''),
        xml: String(fd.get('xml') ?? ''),
      }, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: tr('facturacion.portal.complementoRegistradoTuClien') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'registrar el complemento de pago') };
    }
  }

  return (
    <section className="mt-3 rounded-2xl px-5 py-4 flex flex-col gap-3 hairline" style={{ background: 'var(--surface)' }}>
      <div className="flex items-start gap-2.5">
        <Link2 width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
        <div className="min-w-0">
          <p className="text-sm font-medium">{tr('facturacion.portal.portalDePagoDel')}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {rico(tr('facturacion.portal.unEnlacePorFactura', { v: diasDeVigencia() }), { strong: (c) => <strong>{c}</strong>, strong2: (c) => <strong>{c}</strong> })}
          </p>
        </div>
      </div>

      {panel === null ? (
        <p className="text-xs" style={{ color: 'var(--bad)' }}>
          {tr('facturacion.portal.noPudeLeerEl')}
        </p>
      ) : (
        <>
          <Bandeja tr={tr} panel={panel} conciliar={conciliar} descartar={descartar} />
          <Enlaces tr={tr} panel={panel} generar={generar} revocar={revocar} />
          <Complemento tr={tr} panel={panel} anotarRep={anotarRep} />
        </>
      )}
    </section>
  );
}

// ── La bandeja: lo que tus clientes dicen que pagaron ──────────────────────

function Bandeja({ panel, conciliar, descartar, tr = trEs }: {
  panel: PanelPortal;
  conciliar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
  descartar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>; tr?: Tr;
}) {
  if (panel.pendientes.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {tr('facturacion.portal.ningunClienteHaRegistrado')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium">
        {tr('facturacion.portal.pagoSPorConciliar', { length: panel.pendientes.length })}
      </p>
      {panel.pendientesTruncados && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {tr('facturacion.portal.hayMasPagosPendientes', { length: panel.pendientes.length })}
        </p>
      )}
      {panel.pendientes.map((p) => (
        <details key={p.id} className="rounded-xl hairline px-3.5 py-2.5">
          <summary className="cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="font-medium">{p.cliente}</span>
            <span style={{ color: 'var(--muted)' }}>{tr('facturacion.portal.factura', { factura: p.factura })}</span>
            <span style={{ color: 'var(--muted)' }}>{tr('facturacion.portal.ref', { ref: p.referencia })}</span>
            <span className="ml-auto font-medium">{mxn(p.monto)}</span>
          </summary>
          <div className="mt-2.5 flex flex-col gap-3 text-xs" style={{ color: 'var(--muted)' }}>
            <span>
              {tr('facturacion.portal.diceHaberPagadoEl')} {fechaMx(p.fecha)}
              {p.metodo && ' ' + tr('facturacion.portal.porMetodo', { metodo: p.metodo })}. {tr('facturacion.portal.loRegistroEl', { cuando: fechaHoraMx(p.registradaEn) })}
              {' '}{tr('facturacion.portal.saldoDeLaFactura')}{' '}
              <strong>{p.saldo === null ? tr('facturacion.portal.sinDato') : mxn(p.saldo)}</strong>
              {p.saldo === null && ' ' + tr('facturacion.portal.noSePudoLeer')}
            </span>
            {/* La factura que no se pudo resolver NO se concilia (`c7-23`): sin
                saber sobre qué papel es, "Conciliar" sería mover dinero a
                ciegas. Y una cancelada rebotaría en `registrar_pago_tx`: se
                dice antes de apretar, no después. */}
            {!p.identificada ? (
              <span style={{ color: 'var(--bad)' }}>
                {tr('facturacion.portal.noPudeIdentificarLa', { facturaId: p.facturaId })}
              </span>
            ) : p.estatus === 'cancelada' ? (
              <span style={{ color: 'var(--bad)' }}>
                {tr('facturacion.portal.esaFacturaEstaCancelada')}
              </span>
            ) : null}
            <span>
              {tr('facturacion.portal.cruzaLaReferenciaContra')}
            </span>
            <div className="flex flex-col gap-3">
              {p.identificada && p.estatus !== 'cancelada' && (
                <FormaConAviso accion={conciliar} boton={`Conciliar ${mxn(p.monto)}`} columnas="md:grid-cols-1">
                  <input type="hidden" name="propuestaId" value={p.id} />
                </FormaConAviso>
              )}
              <FormaConAviso accion={descartar} boton="Descartar este registro" columnas="md:grid-cols-1">
                <input type="hidden" name="propuestaId" value={p.id} />
                <Campo
                  nombre="motivo"
                  etiqueta={tr('facturacion.portal.porQueLoDescartas')}
                  requerido
                  ayuda={tr('facturacion.portal.tuClientePuedePreguntar')}
                />
              </FormaConAviso>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

// ── Los enlaces vivos y el alta de uno nuevo ───────────────────────────────

function Enlaces({ panel, generar, revocar, tr = trEs }: {
  panel: PanelPortal;
  generar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
  revocar: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>; tr?: Tr;
}) {
  return (
    <details className="rounded-xl hairline px-4 py-3">
      <summary className="text-xs font-medium cursor-pointer">
        {tr('facturacion.portal.enlacesDePagoVivo', { length: panel.ligasVivas.length })}
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        <div>
          <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
            {tr('facturacion.portal.generaElEnlaceDe')}
          </p>
          {panel.facturasSinLiga.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {tr('facturacion.portal.noHayFacturasEmitidas')}
            </p>
          ) : (
            <FormaConAviso accion={generar} boton="Generar enlace" columnas="md:grid-cols-1">
              <Selector
                nombre="facturaId"
                etiqueta={tr('facturacion.portal.factura2')}
                requerido
                opciones={[
                  { valor: '', texto: 'Elige…' },
                  ...panel.facturasSinLiga.map((f) => ({
                    valor: f.id,
                    texto: `${f.factura} · ${f.cliente} · saldo ${f.saldo === null ? 'sin dato' : mxn(f.saldo)}`,
                  })),
                ]}
              />
            </FormaConAviso>
          )}
          {panel.facturasTruncadas && (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              {tr('facturacion.portal.laListaEstaRecortada')}
            </p>
          )}
        </div>

        {panel.ligasVivas.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {panel.ligasVivas.map((l) => (
              <details key={l.id} className="rounded-xl hairline px-3.5 py-2.5">
                <summary className="cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <span className="font-medium">{l.factura}</span>
                  <span style={{ color: 'var(--muted)' }}>{l.cliente}</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>
                    {l.ultimoAccesoEn ? `abierto ${fechaHoraMx(l.ultimoAccesoEn)}` : tr('facturacion.portal.nuncaSeHaAbierto')}
                  </span>
                </summary>
                <div className="mt-2.5 flex flex-col gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                  <span>
                    {rico(tr('facturacion.portal.huellaCodeCodeVence', { prefijo: l.prefijo, v: fechaMx(l.expiraEn), v2: !l.ultimoAccesoEn ? ' ' + tr('facturacion.portal.nadieLoHaAbierto') : '' }), { code: (c) => <code>{c}</code> })}
                  </span>
                  <FormaConAviso accion={revocar} boton="Revocar este enlace" columnas="md:grid-cols-1">
                    <input type="hidden" name="ligaId" value={l.id} />
                  </FormaConAviso>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

// ── El REP que la flota emite a su cliente ─────────────────────────────────

function Complemento({ panel, anotarRep, tr = trEs }: {
  panel: PanelPortal;
  anotarRep: (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>; tr?: Tr;
}) {
  return (
    <details className="rounded-xl hairline px-4 py-3">
      <summary className="text-xs font-medium cursor-pointer">
        {tr('facturacion.portal.complementoDePagoRep')}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {rico(tr('facturacion.portal.likidaStrongNoTimbra'), { strong: (c) => <strong>{c}</strong> })}
        </p>
        {panel.ligasVivas.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {tr('facturacion.portal.generaPrimeroElEnlace')}
          </p>
        ) : (
          <FormaConAviso accion={anotarRep} boton="Registrar el complemento" columnas="md:grid-cols-2">
            <Selector
              nombre="facturaId"
              etiqueta={tr('facturacion.portal.facturaDelComplemento')}
              requerido
              opciones={[
                { valor: '', texto: 'Elige…' },
                ...panel.ligasVivas.map((l) => ({ valor: l.facturaId, texto: `${l.factura} · ${l.cliente}` })),
              ]}
            />
            <Campo
              nombre="pagoId"
              etiqueta={tr('facturacion.portal.idDelAbonoQue')}
              requerido
              ayuda={tr('facturacion.portal.elQueQuedoAl')}
            />
            <Campo nombre="cfdiUuid" etiqueta={tr('facturacion.portal.folioFiscalUuidDel')} requerido
              ayuda={tr('facturacion.portal.copialoTalCualDel')} />
            <Campo nombre="fechaPago" etiqueta={tr('facturacion.portal.fechaDelPago')} tipo="date" requerido />
            <Campo nombre="impPagado" etiqueta={tr('facturacion.portal.importePagado')} requerido
              ayuda={tr('facturacion.portal.elQueTraeEl')} />
            <Campo nombre="formaPago" etiqueta={tr('facturacion.portal.formaDePagoDel')}
              ayuda={tr('facturacion.portal.03Transferencia01Efectivo')} />
            <Campo nombre="xml" etiqueta={tr('facturacion.portal.xmlDelComplementoOpcional')}
              ayuda={tr('facturacion.portal.pegaloSiLoTienes')} />
          </FormaConAviso>
        )}

        <ListaReps tr={tr} reps={panel.reps} truncados={panel.repsTruncados} />
      </div>
    </details>
  );
}

/**
 * LOS COMPLEMENTOS YA REGISTRADOS.
 *
 * Se exporta como componente propio —y no inline dentro de `Complemento`— por
 * la razón de la casa: así el preview headless puede montar ESTO, el
 * componente REAL, en vez de una copia de su markup. Una copia verifica la
 * copia.
 */
export function ListaReps({ reps, truncados, tr = trEs }: { reps: PanelPortal['reps']; truncados: boolean; tr?: Tr }) {
  // LO QUE YA SE REGISTRÓ. El bloque del complemento era sólo un formulario de
  // alta: se registraba y no se volvía a ver nunca — ni siquiera para
  // contestar «¿ya le mandamos el de esta factura?» antes de emitir otro. Y el
  // texto de esa sección ya prometía «con el sello de cuándo lo abrió», un
  // sello (`entregado_en`) que no se pintaba en ninguna parte.
  return (
      <div className="mt-1">
        <TituloSeccion>{tr('facturacion.portal.complementosYaRegistrados')}</TituloSeccion>
        {reps.length === 0 ? (
          <EstadoVacio>
            {tr('facturacion.portal.todaviaNoHasRegistrado')}
          </EstadoVacio>
        ) : (
          <>
            <ul className="mt-2 flex flex-col gap-1.5">
              {reps.map((r) => (
                <li key={r.id} className="hairline rounded-lg px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <strong>{r.factura}</strong>
                      <span style={{ color: 'var(--muted)' }}> · {r.cliente}</span>
                    </span>
                    <span className="tabular-nums">
                      {/* null ≠ 0: un importe que no se pudo leer no es un
                          complemento por cero pesos. */}
                      {r.impPagado === null
                        ? <span style={{ color: 'var(--muted)' }}>{tr('facturacion.portal.importeSinDato')}</span>
                        : mxn(r.impPagado)}
                      {r.formaPago !== null && (
                        <span style={{ color: 'var(--muted)' }}> {tr('facturacion.portal.forma', { formaPago: r.formaPago })}</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5" style={{ color: 'var(--muted)' }}>
                    {rico(tr('facturacion.portal.folioFiscalCodeCode', { cfdiUuid: r.cfdiUuid, v: ' · ', v2: fechaMx(r.fechaPago), v3: ' · ', v4: fechaHoraMx(r.registradoEn) }), { code: (c) => <code className="cifra-mono">{c}</code> })}
                  </div>
                  <div className="mt-0.5">
                    {r.entregadoEn === null
                      ? <span style={{ color: 'var(--muted)' }}>{tr('facturacion.portal.tuClienteTodaviaNo')}</span>
                      : <span style={{ color: 'var(--color-ok)' }}>{tr('facturacion.portal.tuClienteLoAbrio', { v: fechaHoraMx(r.entregadoEn) })}</span>}
                  </div>
                </li>
              ))}
            </ul>
            {truncados && (
              <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                {tr('facturacion.portal.seMuestranLosMas', { TOPE_REPS_PANEL })}
              </p>
            )}
          </>
        )}
      </div>
  );
}
