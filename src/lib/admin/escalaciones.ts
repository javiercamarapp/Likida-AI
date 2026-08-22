// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA DE ESCALACIONES — todo lo que hoy espera a un humano, en UNA
// cola (patrón Agent Inbox del informe de consolas, 15-ago-2026).
//
// Antes de esta bandeja, lo pendiente vivía disperso: las ARCO en
// /admin/compliance, los tickets en /admin/soporte, las corridas en fallo en
// la bitácora del Inicio, y las talachas y facturas de proveedor en NINGUNA
// pantalla del superadmin. Este módulo NO mide nada nuevo: junta las seis
// lecturas que ya existen (o que viven aquí al lado, en lib/admin) y las
// aplana en una sola cola ordenada por urgencia.
//
// Vive en lib/admin — el barrio con permiso de cruzar tenants (ver
// negocio.ts) — y sus errores van POR VALOR por fuente: si una tabla no se
// pudo leer, ESA fuente dice "no se pudo leer" (que no es 0) y las otras
// cinco siguen enseñando lo suyo. Una bandeja que se cae entera porque una
// de seis consultas falló dejaría ciego justo al que va a destrabar todo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { mxn } from '@/lib/formato';
import { AGENTES_NOTIFICABLES } from '@/lib/likida/agentes/notificaciones';
import { getCorridasFallidas, getLiquidacionesEnRevisar, contarLiquidacionesEnRevisar } from './negocio';
import { getTicketsCruzados, ESTADOS_TICKET_CERRADO } from './soporte';

// ── Las lecturas propias (las que no existían en ningún lib) ────────────────

export interface ArcoPendiente {
  id: string;
  tipo: string;
  estado: string;
  recibidaEn: string;
  /** `date` en la base (0053) — 'YYYY-MM-DD', el plazo legal de los 20 días
   *  hábiles ya calculado al registrar la solicitud. */
  venceEn: string;
  tenantId: string;
  flotaNombre: string;
}

/**
 * Las solicitudes ARCO SIN resolver, de todas las flotas — la MISMA lectura
 * que /admin/compliance usaba para su contador "vencen pronto", extraída
 * aquí para que la bandeja y esa página no la dupliquen (compliance ahora
 * la importa y deriva su conteo de estos items).
 */
export async function getSolicitudesArcoPendientes(): Promise<ArcoPendiente[]> {
  const admin = supabaseAdmin();
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => admin
      .from('solicitud_arco')
      .select('id, tipo, estado, recibida_en, vence_en, tenant_id, flota:tenant_id(nombre)', conteo(d))
      .in('estado', ['recibida', 'en_proceso'])
      .order('id').range(d, h),
    'getSolicitudesArcoPendientes',
  );
  return filas.map((f) => ({
    id: f.id as string,
    tipo: f.tipo as string,
    estado: f.estado as string,
    recibidaEn: f.recibida_en as string,
    venceEn: f.vence_en as string,
    tenantId: f.tenant_id as string,
    flotaNombre: ((f.flota as { nombre?: string } | null)?.nombre) ?? '—',
  }));
}

export interface TalachaPendiente {
  id: string;
  descripcion: string | null;
  /** NULL = el chofer no dijo monto — NO "costó cero" (0107). */
  montoEstimado: number | null;
  abiertaEn: string;
  tenantId: string;
  tenantNombre: string;
}

/**
 * Las talachas esperando la firma del jefe: `incidencia.autorizacion =
 * 'pendiente'` (0107 — el índice parcial ya existe para esta consulta),
 * cruzadas por todas las flotas. Cada una es un chofer parado en la
 * carretera esperando un "autorizo" por WhatsApp.
 */
export async function getTalachasPendientes(): Promise<TalachaPendiente[]> {
  const admin = supabaseAdmin();
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => admin
      .from('incidencia')
      .select('id, descripcion, monto_estimado, abierta_en, tenant_id, tenant:tenant_id(nombre)', conteo(d))
      .eq('autorizacion', 'pendiente')
      .order('id').range(d, h),
    'getTalachasPendientes',
  );
  return filas.map((f) => ({
    id: f.id as string,
    descripcion: (f.descripcion as string | null) ?? null,
    montoEstimado: (f.monto_estimado as number | null) ?? null,
    abiertaEn: f.abierta_en as string,
    tenantId: f.tenant_id as string,
    tenantNombre: ((f.tenant as { nombre?: string } | null)?.nombre) ?? '—',
  }));
}

export interface FacturaProveedorPendiente {
  id: string;
  emisorNombre: string | null;
  total: number;
  creadaEn: string;
  tenantId: string;
  tenantNombre: string;
}

/** Facturas de proveedor en la cola de aprobación humana (`estado =
 *  'pendiente'`, 0091), cruzadas — la persona decide, el agente solo marca. */
export async function getFacturasProveedorPendientes(): Promise<FacturaProveedorPendiente[]> {
  const admin = supabaseAdmin();
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => admin
      .from('factura_proveedor')
      .select('id, emisor_nombre, total, created_at, tenant_id, tenant:tenant_id(nombre)', conteo(d))
      .eq('estado', 'pendiente')
      .order('id').range(d, h),
    'getFacturasProveedorPendientes',
  );
  return filas.map((f) => ({
    id: f.id as string,
    emisorNombre: (f.emisor_nombre as string | null) ?? null,
    total: Number(f.total),
    creadaEn: f.created_at as string,
    tenantId: f.tenant_id as string,
    tenantNombre: ((f.tenant as { nombre?: string } | null)?.nombre) ?? '—',
  }));
}

// ── La cola unificada ───────────────────────────────────────────────────────

export type FuenteEscalacion =
  | 'arco' | 'corridas' | 'talachas' | 'facturas_proveedor' | 'tickets' | 'liquidaciones';

export const NOMBRE_FUENTE: Record<FuenteEscalacion, string> = {
  arco: 'Solicitudes ARCO',
  corridas: 'Corridas en fallo',
  talachas: 'Talachas por autorizar',
  facturas_proveedor: 'Facturas de proveedor',
  tickets: 'Tickets de soporte',
  liquidaciones: 'Liquidaciones en revisión',
};

export interface ItemEscalacion {
  fuente: FuenteEscalacion;
  /** Qué es — en palabras del dominio, sin fechas (las fechas van aparte
   *  para que la pantalla las formatee con lib/formato). */
  titulo: string;
  detalle: string | null;
  tenantNombre: string;
  /** Desde cuándo espera (ISO). */
  desde: string;
  /** Plazo, si la fuente tiene uno (ARCO `vence_en`, ticket `vence_en`). */
  vence: string | null;
  /** DÓNDE se resuelve (con `?tenant=` cuando la pantalla es del panel de
   *  esa flota). NULL = no hay pantalla a la cual llevar — se dice, no se
   *  inventa un link que rebote. */
  href: string | null;
}

/** Una fuente leída o su error, POR VALOR: `items === null ⟺ error !== null`.
 *  "No se pudo leer" NUNCA se colapsa a una lista vacía — vacía significa
 *  "se leyó y no hay nada". */
export interface FuenteLeida {
  items: ItemEscalacion[] | null;
  error: string | null;
}

/** Los conteos que consume la campana (`calcularAlertas`) — derivados de las
 *  MISMAS lecturas de la bandeja, no de consultas aparte. `null` = esa
 *  fuente no se pudo leer (≠ 0). */
export interface ConteosEscalaciones {
  arco: number | null;
  corridasFallo: number | null;
  talachas: number | null;
  facturasProveedor: number | null;
  ticketsAbiertos: number | null;
  ticketsVencidos: number | null;
  liquidacionesRevisar: number | null;
}

export interface BandejaEscalaciones {
  fuentes: Record<FuenteEscalacion, FuenteLeida>;
  /** LA cola: todos los items de las fuentes legibles, ordenados por
   *  urgencia — lo que tiene PLAZO se ordena por su plazo (vencido primero)
   *  y lo que no, por cuánto lleva esperando (lo más viejo arriba). Un plazo
   *  pasado y una espera vieja compiten en la misma línea de tiempo. */
  cola: ItemEscalacion[];
  conteos: ConteosEscalaciones;
}

/** El catálogo de fichas de agentes (el MISMO de notificaciones.ts, no una
 *  copia) para llevar una corrida en fallo a donde se mira: la ficha del
 *  agente en el panel de ESA flota. `ventas` corre para Likida misma y su
 *  casa es /admin/vendedores (0105). */
function hrefDeCorrida(agente: string, tenantId: string | null): string | null {
  if (agente === 'ventas') return '/admin/vendedores';
  const info = AGENTES_NOTIFICABLES.find((a) => a.id === agente);
  return info && tenantId ? `${info.ruta}?tenant=${tenantId}` : null;
}

/** try/catch → valor. El mensaje conserva QUÉ no se pudo leer. */
async function porValor<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Milisegundos del punto que hace urgente al item: su plazo si tiene, si no
 *  desde cuándo espera. Fecha ilegible → al final, no arriba por accidente. */
function claveUrgencia(i: ItemEscalacion): number {
  const t = new Date(i.vence ?? i.desde).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Junta las seis fuentes en paralelo. NUNCA lanza: cada fuente cae por su
 * lado y lo dice. `ahoraMs` inyectado (mismo criterio que
 * `getTicketsCruzados`): el reloj de SLA no puede depender de quién renderiza.
 */
export async function getBandejaEscalaciones(ahoraMs: number): Promise<BandejaEscalaciones> {
  const [arco, corridas, talachas, facturas, tickets, liquidaciones] = await Promise.all([
    porValor(() => getSolicitudesArcoPendientes()),
    porValor(() => getCorridasFallidas(20)),
    porValor(() => getTalachasPendientes()),
    porValor(() => getFacturasProveedorPendientes()),
    porValor(() => getTicketsCruzados(ahoraMs)),
    // Las N más recientes para la cola + el TOTAL contado aparte (head):
    // desde el 22-ago-2026 (escala 50k) `getLiquidacionesEnRevisar` trae las
    // últimas `LIMITE_LIQUIDACIONES_REVISAR`, no toda la cola humana, así que
    // `items.length` ya no es el conteo de la campana. Si cualquiera de las
    // dos lecturas falla, la fuente entera cae por valor (conteo null ≠ 0).
    porValor(async () => {
      const [items, total] = await Promise.all([getLiquidacionesEnRevisar(), contarLiquidacionesEnRevisar()]);
      return { items, total };
    }),
  ]);

  const fuente = (r: { error: string }): FuenteLeida => ({ items: null, error: r.error });
  const leida = (items: ItemEscalacion[]): FuenteLeida => ({ items, error: null });

  const fuentes: Record<FuenteEscalacion, FuenteLeida> = {
    arco: 'error' in arco ? fuente(arco) : leida(arco.ok.map((s) => ({
      fuente: 'arco',
      titulo: `Solicitud ARCO — ${s.tipo}`,
      detalle: 'El titular tiene derecho a respuesta en 20 días hábiles (LFPDPPP art. 32).',
      tenantNombre: s.flotaNombre,
      desde: s.recibidaEn,
      vence: s.venceEn,
      href: '/admin/compliance',
    }))),
    corridas: 'error' in corridas ? fuente(corridas) : leida(corridas.ok.map((c) => ({
      fuente: 'corridas',
      titulo: `Corrida en fallo — agente ${c.agente}`,
      // Ambos o ninguno (0102): un numerador sin denominador no dice nada.
      detalle: c.tareasHechas !== null && c.tareasTotal !== null
        ? `Se quedó en ${c.tareasHechas}/${c.tareasTotal} tareas (disparo: ${c.disparo}).`
        : `Disparo: ${c.disparo}.`,
      tenantNombre: c.tenantNombre,
      desde: c.inicio,
      vence: null,
      href: hrefDeCorrida(c.agente, c.tenantId),
    }))),
    talachas: 'error' in talachas ? fuente(talachas) : leida(talachas.ok.map((t) => ({
      fuente: 'talachas',
      // NULL ≠ $0: sin monto reportado se dice así, nunca "$0.00" (0107).
      titulo: `Talacha esperando autorización — ${t.montoEstimado !== null ? mxn(t.montoEstimado) : 'sin monto reportado'}`,
      detalle: t.descripcion
        ? `«${t.descripcion}» — la autoriza el jefe de esa flota por WhatsApp.`
        : 'La autoriza el jefe de esa flota por WhatsApp.',
      tenantNombre: t.tenantNombre,
      desde: t.abiertaEn,
      vence: null,
      // No hay pantalla donde AUTORIZAR (la firma es del jefe, por WhatsApp);
      // la ventana del superadmin a ese circuito son las conversaciones.
      href: '/admin/conversaciones',
    }))),
    facturas_proveedor: 'error' in facturas ? fuente(facturas) : leida(facturas.ok.map((f) => ({
      fuente: 'facturas_proveedor',
      titulo: `Factura de proveedor por decidir — ${mxn(f.total)}`,
      detalle: f.emisorNombre ? `Emisor: ${f.emisorNombre}.` : 'Emisor sin nombre en el CFDI.',
      tenantNombre: f.tenantNombre,
      desde: f.creadaEn,
      vence: null,
      href: `/dashboard/agentes/proveedores?tenant=${f.tenantId}`,
    }))),
    tickets: 'error' in tickets ? fuente(tickets) : leida(
      tickets.ok
        .filter((t) => !ESTADOS_TICKET_CERRADO.has(t.estado))
        .map((t) => ({
          fuente: 'tickets',
          titulo: `Ticket de soporte (${t.prioridad}) — ${t.asunto}`,
          // Sin SLA pactado NO es vencido — mismo criterio que /admin/soporte.
          detalle: t.horasRestantes === null
            ? 'Sin SLA pactado.'
            : t.horasRestantes < 0
              ? `SLA vencido hace ${Math.abs(Math.round(t.horasRestantes))} h.`
              : `Quedan ${Math.round(t.horasRestantes)} h de SLA.`,
          tenantNombre: t.tenantNombre,
          desde: t.abiertoEn,
          vence: t.venceEn,
          href: '/admin/soporte',
        })),
    ),
    liquidaciones: 'error' in liquidaciones ? fuente(liquidaciones) : leida(liquidaciones.ok.items.map((l) => ({
      fuente: 'liquidaciones',
      titulo: l.folio ? `Liquidación en revisión — viaje ${l.folio}` : 'Liquidación en revisión',
      detalle: 'El motor no pudo cerrarla solo: espera ojos humanos en la bandeja de esa flota.',
      tenantNombre: l.tenantNombre,
      desde: l.creadaEn,
      vence: null,
      href: `/dashboard/agentes/liquidacion?tenant=${l.tenantId}`,
    }))),
  };

  const cola = (Object.values(fuentes))
    .flatMap((f) => f.items ?? [])
    .sort((a, b) => claveUrgencia(a) - claveUrgencia(b));

  // Los conteos de la campana salen de ESTAS lecturas — jamás de un fetch
  // aparte. Los de tickets se derivan ANTES de aplanar porque "vencido"
  // necesita `horasRestantes`, que el item ya no carga.
  const ticketsAbiertos = 'error' in tickets
    ? null
    : tickets.ok.filter((t) => !ESTADOS_TICKET_CERRADO.has(t.estado));
  const conteos: ConteosEscalaciones = {
    arco: fuentes.arco.items?.length ?? null,
    corridasFallo: fuentes.corridas.items?.length ?? null,
    talachas: fuentes.talachas.items?.length ?? null,
    facturasProveedor: fuentes.facturas_proveedor.items?.length ?? null,
    ticketsAbiertos: ticketsAbiertos === null ? null : ticketsAbiertos.length,
    ticketsVencidos: ticketsAbiertos === null
      ? null
      : ticketsAbiertos.filter((t) => t.horasRestantes !== null && t.horasRestantes < 0).length,
    // CONTADO en la base, no `items.length`: la lista viene acotada.
    liquidacionesRevisar: 'error' in liquidaciones ? null : liquidaciones.ok.total,
  };

  return { fuentes, cola, conteos };
}
