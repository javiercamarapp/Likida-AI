// ═══════════════════════════════════════════════════════════════════════════
// EL LADO DEL INGRESO — lo que alimenta Clientes, Rentabilidad, Cobranza y
// Cotizador ahora que las tablas de la 0048/0049/0051 existen.
//
// LA REGLA DE ESTE ARCHIVO, que es la del producto: una cifra o es un conteo
// real de la base, o NO SE MUESTRA. Nada de derivar un ingreso del anticipo,
// ni un margen de un costo estimado, ni una concentración sobre una cartera a
// medio capturar. Cuando falta la mitad del dato, se devuelve el conteo de lo
// que falta para que la pantalla lo diga.
//
// `traerTodo` en todas: PostgREST recorta a 1,000 filas EN SILENCIO, y una
// cartera recortada da una concentración que se ve razonable y está mal.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { traerTodo } from './pg';
// `round2` se IMPORTA, no se reimplementa: hay una prueba en `formato.test.ts`
// que falla si aparece otra copia. Dos redondeos distintos hacen que la misma
// cifra fiscal se lea diferente en dos pantallas, y eso se lee como dos
// cálculos distintos.
import { round2 } from '@/lib/formato';

// ── Clientes ───────────────────────────────────────────────────────────────

export interface ClienteRow {
  id: string;
  nombre: string;
  rfc: string | null;
  diasCredito: number | null;
  activo: boolean;
  viajes: number;
  /** Suma de `viaje.ingreso_flete`. Solo de los viajes que lo tienen capturado. */
  ingreso: number;
  /** Viajes de ese cliente SIN ingreso capturado — el tamaño del hueco. */
  viajesSinIngreso: number;
}

export interface Cartera {
  clientes: ClienteRow[];
  ingresoTotal: number;
  /** % del ingreso que depende del cliente más grande. `null` si no hay ingreso capturado. */
  concentracion: number | null;
  /** Viajes sin cliente asignado en toda la flota. */
  viajesSinCliente: number;
}

export async function getCartera(tenantId: string): Promise<Cartera> {
  const admin = supabaseAdmin();
  const [clientes, viajes] = await Promise.all([
    traerTodo<{ id: unknown; nombre: unknown; rfc: unknown; dias_credito: unknown; activo: unknown }>(
      (d, h) => admin.from('cliente').select('id, nombre, rfc, dias_credito, activo')
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCartera.cliente',
    ),
    traerTodo<{ cliente_id: unknown; ingreso_flete: unknown }>(
      (d, h) => admin.from('viaje').select('cliente_id, ingreso_flete')
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCartera.viaje',
    ),
  ]);

  const acum = new Map<string, { viajes: number; ingreso: number; sinIngreso: number }>();
  let viajesSinCliente = 0;

  for (const v of viajes) {
    const cid = v.cliente_id as string | null;
    if (!cid) { viajesSinCliente++; continue; }
    const a = acum.get(cid) ?? { viajes: 0, ingreso: 0, sinIngreso: 0 };
    a.viajes++;
    // `null` NO es cero. Un viaje sin ingreso capturado se cuenta aparte: si
    // se sumara como 0, el ingreso del cliente saldría bajo y su margen
    // negativo, y los dos números se verían plausibles.
    if (v.ingreso_flete == null) a.sinIngreso++;
    else a.ingreso += Number(v.ingreso_flete);
    acum.set(cid, a);
  }

  const filas: ClienteRow[] = clientes.map((c) => {
    const a = acum.get(c.id as string) ?? { viajes: 0, ingreso: 0, sinIngreso: 0 };
    return {
      id: c.id as string,
      nombre: c.nombre as string,
      rfc: (c.rfc as string) ?? null,
      diasCredito: c.dias_credito == null ? null : Number(c.dias_credito),
      activo: Boolean(c.activo),
      viajes: a.viajes,
      ingreso: round2(a.ingreso),
      viajesSinIngreso: a.sinIngreso,
    };
  }).sort((x, y) => y.ingreso - x.ingreso);

  const ingresoTotal = round2(filas.reduce((s, f) => s + f.ingreso, 0));
  // Sin ingreso capturado no hay concentración que calcular. Devolver 0 se
  // leería como "no dependes de nadie", que es la conclusión contraria.
  const concentracion = ingresoTotal > 0 && filas.length
    ? round2((filas[0].ingreso / ingresoTotal) * 100)
    : null;

  return { clientes: filas, ingresoTotal, concentracion, viajesSinCliente };
}

// ── Rentabilidad ───────────────────────────────────────────────────────────

export interface Rentabilidad {
  ingreso: number;
  /** Lo comprobado por los operadores, de `liquidacion.total_comprobado`. */
  costoComprobado: number;
  utilidad: number;
  /** `null` cuando no hay ingreso capturado: un margen sobre 0 es división por cero. */
  margenPct: number | null;
  viajesConIngreso: number;
  viajesSinIngreso: number;
}

/**
 * NO calcula el margen con el anticipo haciendo de ingreso. Es la tentación
 * obvia —`viaje.anticipo` siempre está lleno— y produce números que se ven
 * bien y están mal: el anticipo es lo que la empresa le ADELANTA al operador,
 * no lo que le paga el cliente.
 */
export async function getRentabilidad(tenantId: string): Promise<Rentabilidad> {
  const admin = supabaseAdmin();
  const [viajes, liqs] = await Promise.all([
    traerTodo<{ ingreso_flete: unknown }>(
      (d, h) => admin.from('viaje').select('ingreso_flete')
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getRentabilidad.viaje',
    ),
    traerTodo<{ total_comprobado: unknown }>(
      (d, h) => admin.from('liquidacion').select('total_comprobado')
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getRentabilidad.liquidacion',
    ),
  ]);

  let ingreso = 0, conIngreso = 0, sinIngreso = 0;
  for (const v of viajes) {
    if (v.ingreso_flete == null) sinIngreso++;
    else { ingreso += Number(v.ingreso_flete); conIngreso++; }
  }
  const costoComprobado = liqs.reduce((s, l) => s + Number(l.total_comprobado ?? 0), 0);

  return {
    ingreso: round2(ingreso),
    costoComprobado: round2(costoComprobado),
    utilidad: round2(ingreso - costoComprobado),
    margenPct: ingreso > 0 ? round2(((ingreso - costoComprobado) / ingreso) * 100) : null,
    viajesConIngreso: conIngreso,
    viajesSinIngreso: sinIngreso,
  };
}

// ── Cobranza ───────────────────────────────────────────────────────────────

export interface FacturaRow {
  id: string;
  folio: string | null;
  cliente: string;
  fecha: string;
  total: number;
  pagado: number;
  saldo: number;
  estatus: string;
  venceEn: string | null;
  vencida: boolean;
}

export interface Cobranza {
  facturas: FacturaRow[];
  porCobrar: number;
  vencido: number;
  /** Facturas sin fecha de vencimiento porque su cliente no tiene crédito pactado. */
  sinCondiciones: number;
}

export async function getCobranza(tenantId: string): Promise<Cobranza> {
  const admin = supabaseAdmin();
  const [facturas, saldos, clientes] = await Promise.all([
    traerTodo<{ id: unknown; folio: unknown; cliente_id: unknown; fecha: unknown; total: unknown; estatus: unknown; vence_en: unknown }>(
      (d, h) => admin.from('factura_emitida').select('id, folio, cliente_id, fecha, total, estatus, vence_en')
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCobranza.factura',
    ),
    // La vista deriva el saldo de los pagos. NO hay columna `saldo`: una
    // guardada se desincroniza al cancelar un pago y entonces la pantalla y la
    // suma de pagos dicen cosas distintas del mismo dinero.
    traerTodo<{ factura_id: unknown; pagado: unknown; saldo: unknown; vencida: unknown }>(
      (d, h) => admin.from('factura_saldo').select('factura_id, pagado, saldo, vencida')
        .eq('tenant_id', tenantId).order('factura_id').range(d, h),
      'getCobranza.saldo',
    ),
    traerTodo<{ id: unknown; nombre: unknown }>(
      (d, h) => admin.from('cliente').select('id, nombre')
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCobranza.cliente',
    ),
  ]);

  const nombrePorId = new Map(clientes.map((c) => [c.id as string, c.nombre as string]));
  const saldoPorId = new Map(saldos.map((s) => [s.factura_id as string, s]));

  const filas: FacturaRow[] = facturas.map((f) => {
    const s = saldoPorId.get(f.id as string);
    return {
      id: f.id as string,
      folio: (f.folio as string) ?? null,
      cliente: nombrePorId.get(f.cliente_id as string) ?? '—',
      fecha: String(f.fecha),
      total: round2(Number(f.total ?? 0)),
      pagado: round2(Number(s?.pagado ?? 0)),
      saldo: round2(Number(s?.saldo ?? f.total ?? 0)),
      estatus: String(f.estatus),
      venceEn: (f.vence_en as string) ?? null,
      vencida: Boolean(s?.vencida),
    };
  }).sort((a, b) => (b.vencida ? 1 : 0) - (a.vencida ? 1 : 0) || b.saldo - a.saldo);

  const vivas = filas.filter((f) => f.estatus !== 'cancelada' && f.estatus !== 'borrador');
  return {
    facturas: filas,
    porCobrar: round2(vivas.reduce((s, f) => s + f.saldo, 0)),
    vencido: round2(vivas.filter((f) => f.vencida).reduce((s, f) => s + f.saldo, 0)),
    sinCondiciones: vivas.filter((f) => f.venceEn == null).length,
  };
}

// ── Cotizaciones ───────────────────────────────────────────────────────────

export interface CotizacionRow {
  id: string;
  folio: string | null;
  cliente: string | null;
  origen: string;
  destino: string;
  km: number | null;
  costoEstimado: number | null;
  precio: number | null;
  estado: string;
  vigenteHasta: string | null;
}

export async function getCotizaciones(tenantId: string): Promise<CotizacionRow[]> {
  const admin = supabaseAdmin();
  const [cots, clientes] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('cotizacion')
        .select('id, folio, cliente_id, origen, destino, km, costo_estimado, precio, estado, vigente_hasta')
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCotizaciones',
    ),
    traerTodo<{ id: unknown; nombre: unknown }>(
      (d, h) => admin.from('cliente').select('id, nombre')
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getCotizaciones.cliente',
    ),
  ]);

  const nombre = new Map(clientes.map((c) => [c.id as string, c.nombre as string]));
  return cots.map((c) => ({
    id: c.id as string,
    folio: (c.folio as string) ?? null,
    cliente: c.cliente_id ? nombre.get(c.cliente_id as string) ?? null : null,
    origen: String(c.origen),
    destino: String(c.destino),
    km: c.km == null ? null : Number(c.km),
    costoEstimado: c.costo_estimado == null ? null : round2(Number(c.costo_estimado)),
    precio: c.precio == null ? null : round2(Number(c.precio)),
    estado: String(c.estado),
    vigenteHasta: (c.vigente_hasta as string) ?? null,
  }));
}

// ── Soporte ────────────────────────────────────────────────────────────────

export interface TicketRow {
  id: string;
  asunto: string;
  categoria: string;
  prioridad: string;
  estado: string;
  abiertoEn: string;
  venceEn: string | null;
  /** Horas que faltan para el SLA. `null` cuando no hay SLA pactado. */
  horasRestantes: number | null;
}

export async function getTickets(tenantId: string, ahoraMs: number): Promise<TicketRow[]> {
  const admin = supabaseAdmin();
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => admin.from('ticket_soporte')
      .select('id, asunto, categoria, prioridad, estado, abierto_en, vence_en')
      .eq('tenant_id', tenantId).order('id').range(d, h),
    'getTickets',
  );

  return filas.map((t) => {
    const vence = (t.vence_en as string) ?? null;
    return {
      id: t.id as string,
      asunto: String(t.asunto),
      categoria: String(t.categoria),
      prioridad: String(t.prioridad),
      estado: String(t.estado),
      abiertoEn: String(t.abierto_en),
      venceEn: vence,
      // Sin SLA pactado no se calcula: un 0 se leería como "vencido".
      horasRestantes: vence ? round2((new Date(vence).getTime() - ahoraMs) / 3_600_000) : null,
    };
  }).sort((a, b) => (a.horasRestantes ?? Infinity) - (b.horasRestantes ?? Infinity));
}

// ── Rastreo ────────────────────────────────────────────────────────────────

export interface EstadoRastreo {
  /** Proveedores configurados, sin el token: solo los últimos 4. */
  proveedores: Array<{ proveedor: string; ultimos4: string | null; activo: boolean; probadaEn: string | null; ultimoError: string | null }>;
  unidadesConPosicion: number;
  ultimaPosicion: string | null;
}

/**
 * El token NUNCA sale de aquí. La UI enseña "configurado ✓" y los últimos 4;
 * un panel que muestra el token completo lo filtra a cualquiera que mire la
 * pantalla, y un token de rastreo no expira solo.
 */
export async function getEstadoRastreo(tenantId: string): Promise<EstadoRastreo> {
  const admin = supabaseAdmin();
  const [creds, pos] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('rastreo_credencial')
        .select('proveedor, token_ultimos4, activo, probada_en, ultimo_error')
        .eq('tenant_id', tenantId).order('proveedor').range(d, h),
      'getEstadoRastreo.credencial',
    ),
    traerTodo<{ unidad_id: unknown; medida_en: unknown }>(
      (d, h) => admin.from('posicion').select('unidad_id, medida_en')
        .eq('tenant_id', tenantId).order('id', { ascending: false }).range(d, h),
      'getEstadoRastreo.posicion',
    ),
  ]);

  const unidades = new Set(pos.map((p) => p.unidad_id as string));
  const ultima = pos.length
    ? pos.map((p) => String(p.medida_en)).sort().at(-1) ?? null
    : null;

  return {
    proveedores: creds.map((c) => ({
      proveedor: String(c.proveedor),
      ultimos4: (c.token_ultimos4 as string) ?? null,
      activo: Boolean(c.activo),
      probadaEn: (c.probada_en as string) ?? null,
      ultimoError: (c.ultimo_error as string) ?? null,
    })),
    unidadesConPosicion: unidades.size,
    ultimaPosicion: ultima,
  };
}
