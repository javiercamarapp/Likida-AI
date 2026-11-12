import { getT } from '@/lib/i18n/servidor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import { revalidatePath } from 'next/cache';
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
import {
  CampoFecha, CampoSelect, CampoTexto, CampoTextarea, FormaEnCajon, StatusChip, Tarjeta, TablaBase,
  type ColumnaBase, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import { EstadoError } from '../estados';

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
    <Tarjeta titulo={tr('facturacion.portal.portalDePagoDel')}>
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-[color:var(--muted)]">
          {rico(tr('facturacion.portal.unEnlacePorFactura', { v: diasDeVigencia() }), { strong: (c) => <strong>{c}</strong>, strong2: (c) => <strong>{c}</strong> })}
        </p>

        {panel === null ? (
          <EstadoError mensaje={tr('facturacion.portal.noPudeLeerEl')} />
        ) : (
          <>
            <Bandeja tr={tr} panel={panel} conciliar={conciliar} descartar={descartar} />
            <Enlaces tr={tr} panel={panel} generar={generar} revocar={revocar} />
            <Complemento tr={tr} panel={panel} anotarRep={anotarRep} />
          </>
        )}
      </div>
    </Tarjeta>
  );
}

type AccionServidor = (p: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

/** Subsección de la tarjeta: título a la izquierda, la acción (un cajón del sistema) a la derecha. */
function Subseccion({ titulo, accion, children }: { titulo: string; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">{titulo}</p>
        {accion}
      </div>
      {children}
    </div>
  );
}

// ── La bandeja: lo que tus clientes dicen que pagaron ──────────────────────

function Bandeja({ panel, conciliar, descartar, tr = trEs }: {
  panel: PanelPortal;
  conciliar: AccionServidor;
  descartar: AccionServidor; tr?: Tr;
}) {
  if (panel.pendientes.length === 0) {
    return (
      <p className="text-[12px] text-[color:var(--muted)]">
        {tr('facturacion.portal.ningunClienteHaRegistrado')}
      </p>
    );
  }
  type Pendiente = PanelPortal['pendientes'][number];
  const columnas: ColumnaBase<Pendiente>[] = [
    {
      id: 'cliente', titulo: tr('facturacion.vista.cliente'), principal: true,
      celda: (p) => (
        <>
          <span>{p.cliente}</span>
          {/* La factura que no se pudo resolver NO se concilia (`c7-23`): sin
              saber sobre qué papel es, "Conciliar" sería mover dinero a
              ciegas. Y una cancelada rebotaría en `registrar_pago_tx`: se
              dice antes de apretar, no después. */}
          {!p.identificada ? (
            <span className="block text-[11px] font-normal text-[color:var(--bad)]">{tr('facturacion.portal.noPudeIdentificarLa', { facturaId: p.facturaId })}</span>
          ) : p.estatus === 'cancelada' ? (
            <span className="block text-[11px] font-normal text-[color:var(--bad)]">{tr('facturacion.portal.esaFacturaEstaCancelada')}</span>
          ) : null}
        </>
      ),
    },
    { id: 'factura', titulo: tr('facturacion.portal.factura2'), celda: (p) => <span className="rv-cifra">{p.factura}</span> },
    { id: 'ref', titulo: tr('facturacion.forma.referencia'), celda: (p) => <span className="rv-cifra">{p.referencia}</span> },
    { id: 'fecha', titulo: tr('facturacion.vista.fecha'), celda: (p) => <span className="whitespace-nowrap text-[color:var(--muted)]">{fechaMx(p.fecha)}</span> },
    { id: 'monto', titulo: tr('facturacion.forma.montoMxn'), alinear: 'der', celda: (p) => <span className="tabular font-medium">{mxn(p.monto)}</span> },
    {
      id: 'acciones', titulo: tr('facturacion.vista.acciones'), alinear: 'der',
      celda: (p) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {p.identificada && p.estatus !== 'cancelada' && (
            <FormaEnCajon id={`conciliar-${p.id}`} titulo={tr('facturacion.portal.conciliarMonto', { monto: mxn(p.monto) })} accion={conciliar}
              boton={tr('facturacion.portal.conciliarMonto', { monto: mxn(p.monto) })} disparador={tr('facturacion.portal.conciliar')}>
              <input type="hidden" name="propuestaId" value={p.id} />
              <DetallePago tr={tr} p={p} />
            </FormaEnCajon>
          )}
          <FormaEnCajon id={`descartar-${p.id}`} titulo={tr('facturacion.portal.descartarEsteRegistro')} accion={descartar}
            boton={tr('facturacion.portal.descartarEsteRegistro')} disparador={tr('facturacion.portal.descartar')}>
            <input type="hidden" name="propuestaId" value={p.id} />
            <DetallePago tr={tr} p={p} />
            <CampoTexto etiqueta={tr('facturacion.portal.porQueLoDescartas')} name="motivo" obligatorio ayuda={tr('facturacion.portal.tuClientePuedePreguntar')} />
          </FormaEnCajon>
        </div>
      ),
    },
  ];
  return (
    <Subseccion titulo={tr('facturacion.portal.pagoSPorConciliar', { length: panel.pendientes.length })}>
      {panel.pendientesTruncados && (
        <p className="text-[12px] text-[color:var(--muted)]">
          {tr('facturacion.portal.hayMasPagosPendientes', { length: panel.pendientes.length })}
        </p>
      )}
      <TablaBase etiqueta={tr('facturacion.portal.pagoSPorConciliar', { length: panel.pendientes.length })} columnas={columnas} filas={panel.pendientes}
        idFila={(p) => p.id} altoMaximo={false} />
    </Subseccion>
  );
}

/** Lo que el cliente dijo, con el saldo REAL de la factura al lado: es lo que se mira antes de conciliar o descartar. */
function DetallePago({ p, tr = trEs }: { p: PanelPortal['pendientes'][number]; tr?: Tr }) {
  return (
    <div className="flex flex-col gap-1.5 text-[12px] text-[color:var(--muted)]">
      <span>
        {tr('facturacion.portal.diceHaberPagadoEl')} {fechaMx(p.fecha)}
        {p.metodo && ' ' + tr('facturacion.portal.porMetodo', { metodo: p.metodo })}. {tr('facturacion.portal.loRegistroEl', { cuando: fechaHoraMx(p.registradaEn) })}
        {' '}{tr('facturacion.portal.saldoDeLaFactura')}{' '}
        <strong>{p.saldo === null ? tr('facturacion.portal.sinDato') : mxn(p.saldo)}</strong>
        {p.saldo === null && ' ' + tr('facturacion.portal.noSePudoLeer')}
      </span>
      <span>{tr('facturacion.portal.cruzaLaReferenciaContra')}</span>
    </div>
  );
}

// ── Los enlaces vivos y el alta de uno nuevo ───────────────────────────────

function Enlaces({ panel, generar, revocar, tr = trEs }: {
  panel: PanelPortal;
  generar: AccionServidor;
  revocar: AccionServidor; tr?: Tr;
}) {
  type Liga = PanelPortal['ligasVivas'][number];
  const columnas: ColumnaBase<Liga>[] = [
    { id: 'factura', titulo: tr('facturacion.portal.factura2'), principal: true, celda: (l) => <span className="rv-cifra">{l.factura}</span> },
    { id: 'cliente', titulo: tr('facturacion.vista.cliente'), celda: (l) => l.cliente },
    {
      id: 'acceso', titulo: tr('facturacion.portal.colUltimoAcceso'),
      celda: (l) => <span className="text-[color:var(--muted)]">{l.ultimoAccesoEn ? tr('facturacion.portal.abiertoEl', { cuando: fechaHoraMx(l.ultimoAccesoEn) }) : tr('facturacion.portal.nuncaSeHaAbierto')}</span>,
    },
    {
      id: 'acciones', titulo: tr('facturacion.vista.acciones'), alinear: 'der',
      celda: (l) => (
        <FormaEnCajon id={`revocar-${l.id}`} titulo={tr('facturacion.portal.revocarEsteEnlace')} accion={revocar}
          boton={tr('facturacion.portal.revocarEsteEnlace')} disparador={tr('facturacion.portal.revocar')}>
          <input type="hidden" name="ligaId" value={l.id} />
          <p className="text-[12px] text-[color:var(--muted)]">
            {rico(tr('facturacion.portal.huellaCodeCodeVence', { prefijo: l.prefijo, v: fechaMx(l.expiraEn), v2: !l.ultimoAccesoEn ? ' ' + tr('facturacion.portal.nadieLoHaAbierto') : '' }), { code: (c) => <code>{c}</code> })}
          </p>
        </FormaEnCajon>
      ),
    },
  ];
  const alta = panel.facturasSinLiga.length === 0 ? null : (
    // El enlace completo existe SOLO en este aviso: el cajón no se cierra al generar (`cerrarAlOk={false}`) para que se pueda copiar.
    <FormaEnCajon id="enlace-nuevo" titulo={tr('facturacion.portal.generarEnlace')} descripcion={tr('facturacion.portal.generaElEnlaceDe')} accion={generar}
      boton={tr('facturacion.portal.generarEnlace')} disparador={tr('facturacion.portal.generarEnlace')} cerrarAlOk={false}>
      <CampoSelect etiqueta={tr('facturacion.portal.factura2')} name="facturaId" obligatorio defaultValue="">
        <option value="">{tr('facturacion.portal.elige')}</option>
        {panel.facturasSinLiga.map((f) => (
          <option key={f.id} value={f.id}>
            {tr('facturacion.portal.opcionFactura', { factura: f.factura, cliente: f.cliente, saldo: f.saldo === null ? tr('facturacion.portal.sinDato') : mxn(f.saldo) })}
          </option>
        ))}
      </CampoSelect>
    </FormaEnCajon>
  );
  return (
    <Subseccion titulo={tr('facturacion.portal.enlacesDePagoVivo', { length: panel.ligasVivas.length })} accion={alta}>
      {panel.facturasSinLiga.length === 0 && (
        <p className="text-[12px] text-[color:var(--muted)]">{tr('facturacion.portal.noHayFacturasEmitidas')}</p>
      )}
      {panel.facturasTruncadas && (
        <p className="text-[12px] text-[color:var(--muted)]">{tr('facturacion.portal.laListaEstaRecortada')}</p>
      )}
      {panel.ligasVivas.length > 0 && (
        <TablaBase etiqueta={tr('facturacion.portal.enlacesDePagoVivo', { length: panel.ligasVivas.length })} columnas={columnas} filas={panel.ligasVivas}
          idFila={(l) => l.id} altoMaximo={false} densa />
      )}
    </Subseccion>
  );
}

// ── El REP que la flota emite a su cliente ─────────────────────────────────

function Complemento({ panel, anotarRep, tr = trEs }: {
  panel: PanelPortal;
  anotarRep: AccionServidor; tr?: Tr;
}) {
  const alta = panel.ligasVivas.length === 0 ? null : (
    <FormaEnCajon id="complemento-nuevo" titulo={tr('facturacion.portal.registrarElComplemento')} accion={anotarRep}
      boton={tr('facturacion.portal.registrarElComplemento')} disparador={tr('facturacion.portal.registrarElComplemento')} tamano="l">
      <CampoSelect etiqueta={tr('facturacion.portal.facturaDelComplemento')} name="facturaId" obligatorio defaultValue="">
        <option value="">{tr('facturacion.portal.elige')}</option>
        {panel.ligasVivas.map((l) => <option key={l.id} value={l.facturaId}>{l.factura} · {l.cliente}</option>)}
      </CampoSelect>
      <CampoTexto etiqueta={tr('facturacion.portal.idDelAbonoQue')} name="pagoId" obligatorio ayuda={tr('facturacion.portal.elQueQuedoAl')} />
      <CampoTexto etiqueta={tr('facturacion.portal.folioFiscalUuidDel')} name="cfdiUuid" obligatorio ayuda={tr('facturacion.portal.copialoTalCualDel')} claseControl="cifra-mono" />
      <div className="grid grid-cols-2 gap-3">
        <CampoFecha etiqueta={tr('facturacion.portal.fechaDelPago')} name="fechaPago" obligatorio />
        <CampoTexto etiqueta={tr('facturacion.portal.importePagado')} name="impPagado" obligatorio inputMode="decimal" ayuda={tr('facturacion.portal.elQueTraeEl')} claseControl="rv-cifra" />
      </div>
      <CampoTexto etiqueta={tr('facturacion.portal.formaDePagoDel')} name="formaPago" ayuda={tr('facturacion.portal.03Transferencia01Efectivo')} />
      <CampoTextarea etiqueta={tr('facturacion.portal.xmlDelComplementoOpcional')} name="xml" ayuda={tr('facturacion.portal.pegaloSiLoTienes')} />
    </FormaEnCajon>
  );
  return (
    <Subseccion titulo={tr('facturacion.portal.complementoDePagoRep')} accion={alta}>
      <p className="text-[12px] text-[color:var(--muted)]">
        {rico(tr('facturacion.portal.likidaStrongNoTimbra'), { strong: (c) => <strong>{c}</strong> })}
      </p>
      {panel.ligasVivas.length === 0 && (
        <p className="text-[12px] text-[color:var(--muted)]">{tr('facturacion.portal.generaPrimeroElEnlace')}</p>
      )}
      <ListaReps tr={tr} reps={panel.reps} truncados={panel.repsTruncados} />
    </Subseccion>
  );
}

/**
 * LOS COMPLEMENTOS YA REGISTRADOS.
 *
 * Se exporta como componente propio —y no inline dentro de `Complemento`— por
 * la razón de la casa: así el preview headless puede montar ESTO, el
 * componente REAL, en vez de una copia de su markup. Una copia verifica la
 * copia.
 *
 * Se registra y se VUELVE A VER: contestar «¿ya le mandamos el de esta factura?» antes de emitir otro, con el sello de cuándo lo abrió
 * el cliente (`entregado_en`).
 */
export function ListaReps({ reps, truncados, tr = trEs }: { reps: PanelPortal['reps']; truncados: boolean; tr?: Tr }) {
  type Rep = PanelPortal['reps'][number];
  const columnas: ColumnaBase<Rep>[] = [
    {
      id: 'factura', titulo: tr('facturacion.portal.factura2'), principal: true,
      celda: (r) => (
        <>
          <span>{r.factura}</span>
          <span className="block text-[11px] font-normal text-[color:var(--muted)]">{r.cliente}</span>
        </>
      ),
    },
    {
      id: 'importe', titulo: tr('facturacion.portal.importePagado'), alinear: 'der',
      // null ≠ 0: un importe que no se pudo leer no es un complemento por cero pesos.
      celda: (r) => (
        <>
          {r.impPagado === null
            ? <span className="text-[color:var(--muted)]">{tr('facturacion.portal.importeSinDato')}</span>
            : <span className="tabular font-medium">{mxn(r.impPagado)}</span>}
          {r.formaPago !== null && <span className="block text-[11px] text-[color:var(--muted)]">{tr('facturacion.portal.forma', { formaPago: r.formaPago })}</span>}
        </>
      ),
    },
    {
      id: 'uuid', titulo: tr('facturacion.forma.folioFiscalUuid'),
      celda: (r) => (
        <>
          <code className="cifra-mono">{r.cfdiUuid}</code>
          <span className="block text-[11px] text-[color:var(--muted)]">{fechaMx(r.fechaPago)} · {fechaHoraMx(r.registradoEn)}</span>
        </>
      ),
    },
    {
      id: 'entrega', titulo: tr('facturacion.portal.colEntrega'),
      celda: (r) => r.entregadoEn === null
        ? <StatusChip tono="muted">{tr('facturacion.portal.tuClienteTodaviaNo')}</StatusChip>
        : <StatusChip tono="ok">{tr('facturacion.portal.tuClienteLoAbrio', { v: fechaHoraMx(r.entregadoEn) })}</StatusChip>,
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-medium">{tr('facturacion.portal.complementosYaRegistrados')}</p>
      <TablaBase etiqueta={tr('facturacion.portal.complementosYaRegistrados')} columnas={columnas} filas={reps} idFila={(r) => r.id} altoMaximo={false}
        vacio={{ titulo: tr('facturacion.portal.complementosYaRegistrados'), texto: tr('facturacion.portal.todaviaNoHasRegistrado') }} />
      {truncados && (
        <p className="text-[12px] text-[color:var(--muted)]">
          {tr('facturacion.portal.seMuestranLosMas', { TOPE_REPS_PANEL })}
        </p>
      )}
    </div>
  );
}
