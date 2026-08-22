import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  crearDoble, despacharRpc, baseDeDosFlotas, saldoFactura, diaMxSql,
  HOY_PRUEBAS, type Doble, type BaseSintetica,
} from './espejo_0152.pruebas';
import {
  armarCartera, armarEnLaMesa, diaMx, esFacturaViva,
  type ViajeLiquidado,
} from './facturacion_clientes';
import type { FacturaRow } from './comercial';

// ═══════════════════════════════════════════════════════════════════════════
// ESCALA 50k (mig. 0152): getFacturacionClientes leía la cartera ENTERA (vía
// getCobranza), TODAS las facturas, TODOS los viajes liquidados, TODAS las
// liquidaciones y `factura_viaje` por lotes, y reducía en JS con
// `armarCartera` / `armarEnLaMesa`. Ahora lo hace `facturacion_clientes_tenant`.
//
// LAS DOS FUNCIONES PURAS SIGUEN VIVAS Y SON EL ORÁCULO: aquí se las alimenta
// con lo que `traerTodo` habría traído, y su resultado se compara contra el de
// la RPC (doblada por el espejo de la migración) sobre el MISMO dataset. Es la
// prueba que impide que la antigüedad de saldos —la tabla que el contralor
// cruza contra su estado de cuenta— cambie de números al mudarse a SQL.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = HOY_PRUEBAS;
let doble: Doble = crearDoble(HOY);

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve(despacharRpc(doble, fn, args)),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getFacturacionClientes } = await import('./facturacion_clientes');

/** Lo que `getCobranza` (pre-0152) le entregaba a `armarCartera`. */
function facturasViejas(b: BaseSintetica, t: string): FacturaRow[] {
  const nombre = new Map(b.cliente.filter((c) => c.tenant_id === t).map((c) => [c.id, c.nombre]));
  return b.factura_emitida.filter((f) => f.tenant_id === t).map((f) => {
    const s = saldoFactura(b, f, HOY);
    return {
      id: f.id, folio: f.folio ?? null, cliente: nombre.get(f.cliente_id) ?? '—', fecha: f.fecha,
      total: f.total, pagado: s.pagado, saldo: s.saldo, estatus: f.estatus,
      venceEn: f.vence_en ?? null, vencida: s.vencida,
    };
  });
}

/** Lo que el JS viejo armaba para `armarEnLaMesa`. */
function mesaVieja(b: BaseSintetica, t: string) {
  const nombre = new Map(b.cliente.filter((c) => c.tenant_id === t).map((c) => [c.id, c.nombre]));
  const cierrePorViaje = new Map<string, string>();
  for (const l of b.liquidacion.filter((x) => x.tenant_id === t)) {
    const dia = diaMxSql(l.created_at);
    const previo = cierrePorViaje.get(l.viaje_id);
    if (previo === undefined || dia < previo) cierrePorViaje.set(l.viaje_id, dia);
  }
  const conFacturaViva = new Set<string>();
  const conBorrador = new Set<string>();
  const marcar = (viajeId: string, estatus: string) => {
    if (estatus === 'borrador') conBorrador.add(viajeId);
    else if (esFacturaViva(estatus)) conFacturaViva.add(viajeId);
  };
  for (const f of b.factura_emitida.filter((x) => x.tenant_id === t)) {
    if (f.viaje_id) marcar(f.viaje_id, f.estatus);
    for (const fv of b.factura_viaje.filter((x) => x.factura_id === f.id)) marcar(fv.viaje_id, f.estatus);
  }
  const viajes: ViajeLiquidado[] = b.viaje.filter((v) => v.tenant_id === t && v.estatus === 'liquidado').map((v) => ({
    id: v.id, folio: v.folio ?? null, origen: v.origen ?? null, destino: v.destino ?? null,
    cliente: v.cliente_id ? nombre.get(v.cliente_id) ?? null : null,
    ingresoFlete: v.ingreso_flete ?? null,
    liquidadoEn: cierrePorViaje.get(v.id) ?? diaMx(v.fecha_fin ?? null),
  }));
  return { viajes, conFacturaViva, conBorrador, hoy: HOY };
}

beforeEach(() => { doble = crearDoble(HOY); doble.base = baseDeDosFlotas(); });

describe('EQUIVALENCIA getFacturacionClientes — armarCartera/armarEnLaMesa vs la RPC', () => {
  it('la CARTERA entera es idéntica: cubetas, por cliente, renglones y orden', async () => {
    const viejo = armarCartera(facturasViejas(doble.base, 't-1'), HOY);
    const nuevo = await getFacturacionClientes('t-1', HOY);
    expect(nuevo.cartera).toEqual(viejo);
    // Control: hay saldo de verdad, así que la igualdad no es de dos ceros.
    expect(viejo.porCobrar).toBeGreaterThan(0);
    expect(viejo.vencido).toBeGreaterThan(0);
  });

  it('LA MESA es idéntica: qué viaje sigue sin facturar, desde cuándo y con qué ingreso', async () => {
    const viejo = armarEnLaMesa(mesaVieja(doble.base, 't-1'));
    const nuevo = await getFacturacionClientes('t-1', HOY);
    expect(nuevo.enLaMesa).toEqual(viejo);
    expect(nuevo.viajesLiquidados).toBe(mesaVieja(doble.base, 't-1').viajes.length);
  });

  it('el viaje con factura CANCELADA y BORRADOR sigue en la mesa, marcado, en las dos', async () => {
    const nuevo = await getFacturacionClientes('t-1', HOY);
    const v2 = nuevo.enLaMesa.viajes.find((v) => v.viajeId === 'v-2')!;
    expect(v2.soloBorrador).toBe(true);
    expect(v2.ingreso).toBeNull();            // sin ingreso capturado: NO es $0
    // Y el que sí tiene factura viva no está.
    expect(nuevo.enLaMesa.viajes.some((v) => v.viajeId === 'v-1')).toBe(false);
  });

  it('la suma de las CINCO cubetas es exactamente el por cobrar', async () => {
    const c = (await getFacturacionClientes('t-1', HOY)).cartera;
    expect(c.cubetas.reduce((s, b) => s + b.saldo, 0)).toBe(c.porCobrar);
    // La factura saldada al centavo (f-5) no engorda "corriente".
    expect(c.cubetas.find((b) => b.clave === 'corriente')!.saldo).toBe(0);
  });

  it('un solo `hoy` manda: la columna `vencida` de la vista NO se usa', async () => {
    // Se pone la vista a mentir: si alguien la volviera a leer, el rótulo y los
    // días se contradirían («vencida · 0 días vencida»).
    const nuevo = await getFacturacionClientes('t-1', HOY);
    const f1 = nuevo.cartera.facturas.find((f) => f.id === 'f-1')!;
    expect(f1.antiguedad.diasVencida).toBe(45);
    expect(f1.antiguedad.cubeta).toBe('v31_60');
    expect(nuevo.hoy).toBe(HOY);
  });

  it('nada de la otra flota se cuela: la cartera de t-2 es otra', async () => {
    const a = await getFacturacionClientes('t-1', HOY);
    const b = await getFacturacionClientes('t-2', HOY);
    expect(b.cartera.porCobrar).not.toBe(a.cartera.porCobrar);
    expect(a.cartera.facturas.every((f) => f.folio !== 'B-001')).toBe(true);
  });

  it('la RPC caída LANZA, y una forma inesperada también', async () => {
    doble.error = { message: 'base caída' };
    await expect(getFacturacionClientes('t-1', HOY)).rejects.toThrow('base caída');
    doble.error = null;
    doble.formaRota = { cartera: {}, enLaMesa: {}, viajesLiquidados: 0 };
    await expect(getFacturacionClientes('t-1', HOY)).rejects.toThrow('0152');
  });
});
