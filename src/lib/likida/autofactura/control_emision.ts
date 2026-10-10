// ═══════════════════════════════════════════════════════════════════════════
// EL CONTROL DE LA EMISIÓN REAL (0542) — el flujo supervisado de la PRIMERA EMISIÓN.
//
// Antes de este módulo, `emitir` dependía de DOS llaves globales (FACTURACION_MODO + el mandato por flota).
// Para la primera emisión real eso es poco: un portal recién verificado (solo formulario en blanco) y un cron
// sin nadie mirando es justo donde un selector equivocado emite cincuenta CFDI malos. Este módulo agrega, por
// FLOTA y con la base como árbitro:
//
//   1. BANDERA ensayo→real por flota (apagada por omisión; encenderla exige dueño + mandato).
//   2. PORTAL VERIFICADO: sin una corrida supervisada vigente (autofactura/verificacion.ts) el portal no emite.
//   3. LÍMITES: monto por ticket, tickets por lote, y cupo diario (tickets y monto) reservado ATÓMICAMENTE.
//   4. FASE SUPERVISADA por (flota, portal): el agente PROPONE un lote y una persona lo CONFIRMA en el panel; el
//      cron consume ese lote UNA vez. Solo tras N emisiones reales confirmadas con UUID y la decisión del dueño
//      el portal pasa a `autonoma` (las demás barreras siguen).
//   5. BITÁCORA de cada decisión y cada resultado (bitacora_auditoria; sin RFC, cookies ni contraseñas).
//   6. LA REVERSA no está aquí: cancelar un CFDI emitido por un portal de tercero no tiene API (la cancelación por
//      API del PAC, 0541, cubre solo los CFDI que Likida timbra). Lo emitido por portal lo cancela una persona; es
//      una de las razones de la fase supervisada.
//
// FALLA CERRADO: cualquier lectura que no conteste → ensayo, y se dice por qué. Un ensayo de más cuesta una
// visita al portal; una emisión sin control cuesta un CFDI irreversible.
//
// Todo entra por puertos (`RepoControl`, `SalidasControl`): la prueba E2E corre el ciclo completo con dobles.
// ═══════════════════════════════════════════════════════════════════════════

export interface ControlEmision {
  emisionReal: boolean;
  maxMontoTicket: number;
  maxTicketsLote: number;
  maxTicketsDia: number;
  maxMontoDia: number;
}

export type FasePortal = 'supervisada' | 'autonoma';

export interface TicketParaEmitir { gastoId: string; monto: number }

/** `null` = la base no contestó (se falla cerrado). `undefined`-equivalente: sin fila → los defaults del repo. */
export interface RepoControl {
  control(tenantId: string): Promise<ControlEmision | null | 'sin_fila'>;
  fase(tenantId: string, comercio: string): Promise<{ fase: FasePortal; emisionesConfirmadas: number } | null | 'sin_fila'>;
  cupoDelDia(tenantId: string, dia: string): Promise<{ tickets: number; monto: number } | null>;
  reservarCupo(tenantId: string, dia: string, tickets: number, monto: number, maxTickets: number, maxMonto: number): Promise<boolean>;
  liberarCupo(tenantId: string, dia: string, tickets: number, monto: number): Promise<void>;
  /** Consume el lote confirmado UNA vez; devuelve los gastos que de verdad pueden emitir. `null` = no contestó. */
  consumirLoteConfirmado(tenantId: string, comercio: string, gastoIds: string[]): Promise<string[] | null>;
  proponerLote(tenantId: string, comercio: string, gastoIds: string[], monto: number): Promise<{ ok: boolean; estado?: string; motivo?: string }>;
  registrarEmision(tenantId: string, comercio: string, n: number): Promise<void>;
}

export interface SalidasControl {
  bitacora(tenantId: string, accion: string, entidadId: string, detalle: Record<string, unknown>): Promise<void>;
}

export interface DepsControl {
  repo: RepoControl;
  salidas: SalidasControl;
  /** El estado de verificación REAL del portal. `exento` = no pasa por el registro (CAPUFE tiene su propio adaptador). */
  verificacionDe(comercio: string): 'verificado' | 'no_verificado' | 'obsoleto' | 'exento';
  /** AAAA-MM-DD del día de México (el cupo diario se mide por día de la flota, no UTC). */
  hoyMx(): string;
}

export type RazonEnsayo =
  | 'no_pedido'
  | 'bandera_flota_apagada'
  | 'portal_sin_verificar'
  | 'control_ilegible'
  | 'cupo_agotado';

export type MotivoRechazo = 'monto_excede' | 'limite_lote' | 'limite_dia' | 'espera_confirmacion';

export interface Rechazo { gastoId: string; motivo: MotivoRechazo; detalle: string }

export type DecisionEmision =
  | { modo: 'ensayo'; razon: RazonEnsayo; detalle: string }
  | {
      modo: 'emitir';
      /** Los gastos que SÍ pueden emitir en esta corrida, en el orden recibido. */
      permitidos: string[];
      rechazados: Rechazo[];
      fase: FasePortal;
      /** Lo reservado del cupo diario (para devolver lo que no se emita). */
      reservado: { tickets: number; monto: number; dia: string };
    };

const ENSAYO = (razon: RazonEnsayo, detalle: string): DecisionEmision => ({ modo: 'ensayo', razon, detalle });
const mxn = (n: number) => `$${n.toFixed(2)}`;

export async function decidirEmision(
  a: { tenantId: string; comercio: string; tickets: TicketParaEmitir[]; modoPedido: 'ensayo' | 'emitir' },
  deps: DepsControl,
): Promise<DecisionEmision> {
  if (a.modoPedido !== 'emitir') return ENSAYO('no_pedido', 'se pidió ensayo');
  if (a.tickets.length === 0) return ENSAYO('no_pedido', 'sin tickets');

  // ── 1. La bandera de la flota ─────────────────────────────────────────────
  const control = await deps.repo.control(a.tenantId);
  if (control === null) return ENSAYO('control_ilegible', 'no se pudo leer el control de emisión de la flota: se ensaya');
  if (control === 'sin_fila' || !control.emisionReal) {
    return ENSAYO('bandera_flota_apagada', 'la emisión real no está encendida para esta flota (se enciende en el panel, con el mandato otorgado)');
  }

  // ── 2. El portal verificado ───────────────────────────────────────────────
  const v = deps.verificacionDe(a.comercio);
  if (v === 'no_verificado' || v === 'obsoleto') {
    return ENSAYO('portal_sin_verificar', v === 'obsoleto'
      ? `la tabla de selectores de ${a.comercio} cambió después de su corrida supervisada: hay que volver a verificarlo`
      : `${a.comercio} no tiene una corrida supervisada vigente contra el portal real (docs/operacion/verificacion-portales.md)`);
  }

  const rechazados: Rechazo[] = [];
  const rechazar = (t: TicketParaEmitir, motivo: MotivoRechazo, detalle: string) => rechazados.push({ gastoId: t.gastoId, motivo, detalle });

  // ── 3. Monto por ticket ───────────────────────────────────────────────────
  let candidatos: TicketParaEmitir[] = [];
  for (const t of a.tickets) {
    if (!Number.isFinite(t.monto) || t.monto <= 0 || t.monto > control.maxMontoTicket) {
      rechazar(t, 'monto_excede', `el ticket (${Number.isFinite(t.monto) ? mxn(t.monto) : 'monto ilegible'}) excede el límite de ${mxn(control.maxMontoTicket)} por ticket: lo emite una persona`);
    } else candidatos.push(t);
  }

  // ── 4. Fase del portal ────────────────────────────────────────────────────
  const fila = await deps.repo.fase(a.tenantId, a.comercio);
  if (fila === null) return ENSAYO('control_ilegible', 'no se pudo leer la fase del portal: se ensaya');
  const fase: FasePortal = fila === 'sin_fila' ? 'supervisada' : fila.fase;

  // ── 5. Tamaño del lote y cupo del día (lectura previa; la reserva atómica va después) ───────────
  const dia = deps.hoyMx();
  const usado = await deps.repo.cupoDelDia(a.tenantId, dia);
  if (usado === null) return ENSAYO('control_ilegible', 'no se pudo leer el cupo del día: se ensaya');

  const recortar = (lista: TicketParaEmitir[]): TicketParaEmitir[] => {
    const dentro: TicketParaEmitir[] = [];
    let n = usado.tickets; let m = usado.monto;
    for (const t of lista) {
      if (dentro.length >= control.maxTicketsLote) { rechazar(t, 'limite_lote', `el lote ya trae ${control.maxTicketsLote} tickets (límite por lote)`); continue; }
      if (n + 1 > control.maxTicketsDia || m + t.monto > control.maxMontoDia) {
        rechazar(t, 'limite_dia', `se agotó el cupo del día (${control.maxTicketsDia} tickets / ${mxn(control.maxMontoDia)}): sigue mañana`); continue;
      }
      dentro.push(t); n += 1; m += t.monto;
    }
    return dentro;
  };

  // ── 6. Supervisada: solo emite lo que una persona confirmó ────────────────
  if (fase === 'supervisada') {
    const aProponer = recortar(candidatos); // lo que cabría emitir; la persona decide sobre ESTO
    if (aProponer.length === 0 && candidatos.length > 0) return ENSAYO('cupo_agotado', 'el cupo del día está agotado');
    const confirmados = await deps.repo.consumirLoteConfirmado(a.tenantId, a.comercio, aProponer.map((t) => t.gastoId));
    if (confirmados === null) return ENSAYO('control_ilegible', 'no se pudo consultar el lote confirmado: se ensaya');
    const ok = new Set(confirmados);
    const pendientes = aProponer.filter((t) => !ok.has(t.gastoId));
    if (pendientes.length > 0) {
      const monto = pendientes.reduce((s, t) => s + t.monto, 0);
      const p = await deps.repo.proponerLote(a.tenantId, a.comercio, pendientes.map((t) => t.gastoId), monto);
      await deps.salidas.bitacora(a.tenantId, p.ok ? 'autofactura.lote_propuesto' : 'autofactura.lote_no_propuesto', a.comercio, { tickets: pendientes.length, monto, estado: p.estado ?? null });
      for (const t of pendientes) rechazar(t, 'espera_confirmacion', 'fase supervisada: espera a que una persona confirme el lote en el panel (Facturas en automático)');
    }
    candidatos = aProponer.filter((t) => ok.has(t.gastoId));
  } else {
    candidatos = recortar(candidatos);
  }

  if (candidatos.length === 0) {
    return { modo: 'emitir', permitidos: [], rechazados, fase, reservado: { tickets: 0, monto: 0, dia } };
  }

  // ── 7. La reserva ATÓMICA del cupo (la lectura de arriba pudo envejecer) ──
  const monto = candidatos.reduce((s, t) => s + t.monto, 0);
  const reservado = await deps.repo.reservarCupo(a.tenantId, dia, candidatos.length, monto, control.maxTicketsDia, control.maxMontoDia);
  if (!reservado) {
    for (const t of candidatos) rechazar(t, 'limite_dia', 'otra corrida tomó el cupo del día mientras tanto: sigue en la siguiente');
    return { modo: 'emitir', permitidos: [], rechazados, fase, reservado: { tickets: 0, monto: 0, dia } };
  }

  await deps.salidas.bitacora(a.tenantId, 'autofactura.emision_autorizada', a.comercio, { fase, tickets: candidatos.length, monto, rechazados: rechazados.length });
  return { modo: 'emitir', permitidos: candidatos.map((t) => t.gastoId), rechazados, fase, reservado: { tickets: candidatos.length, monto, dia } };
}

// ── Después de emitir ───────────────────────────────────────────────────────

export interface ResultadoEmision { gastoId: string; monto: number; cfdiUuid: string | null; detalle?: string }

/**
 * Cierra el ciclo de una autorización: devuelve el cupo de lo que NO salió con UUID, cuenta las emisiones
 * confirmadas del portal (lo que permite promoverlo) y deja bitácora de cada resultado. Nunca lanza: la emisión ya
 * ocurrió y tumbar el registro del resultado solo empeora las cosas.
 */
export async function registrarResultado(
  a: { tenantId: string; comercio: string; decision: Extract<DecisionEmision, { modo: 'emitir' }>; resultados: ResultadoEmision[] },
  deps: DepsControl,
): Promise<void> {
  try {
    const emitidos = a.resultados.filter((r) => r.cfdiUuid);
    const noEmitidos = a.resultados.filter((r) => !r.cfdiUuid);
    if (noEmitidos.length > 0 && a.decision.reservado.tickets > 0) {
      // Solo se devuelve lo que NO salió: lo emitido consume cupo. Un fallo ambiguo (sin confirmar) conserva el cupo a propósito:
      // ese CFDI pudo existir, y contarlo es el lado seguro.
      const devolver = noEmitidos.filter((r) => !/sin confirmar|PUEDE QUE EL CFDI YA EXISTA|YA SE EMITI/i.test(r.detalle ?? ''));
      if (devolver.length > 0) await deps.repo.liberarCupo(a.tenantId, a.decision.reservado.dia, devolver.length, devolver.reduce((s, r) => s + r.monto, 0));
    }
    if (emitidos.length > 0) await deps.repo.registrarEmision(a.tenantId, a.comercio, emitidos.length);
    for (const r of emitidos) await deps.salidas.bitacora(a.tenantId, 'autofactura.emitido', r.gastoId, { comercio: a.comercio, monto: r.monto, cfdi_uuid: r.cfdiUuid, fase: a.decision.fase });
    for (const r of noEmitidos) await deps.salidas.bitacora(a.tenantId, 'autofactura.emision_fallida', r.gastoId, { comercio: a.comercio, monto: r.monto, detalle: (r.detalle ?? '').slice(0, 300), fase: a.decision.fase });
  } catch {
    // best-effort: el resultado ya se guardó en el gasto.
  }
}
