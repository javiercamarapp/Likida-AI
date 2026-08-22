import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  crearDoble, despacharRpc, baseDeDosFlotas, carteraSql, saldoFactura,
  HOY_PRUEBAS, type Doble, type BaseSintetica,
} from './espejo_0152.pruebas';

// ═══════════════════════════════════════════════════════════════════════════
// ESCALA 50k (mig. 0152): getPanelClientes (clientes.ts) leía `cliente` DOS
// veces, `factura_saldo` entera y TODOS los viajes sin ingreso para quedarse
// con los 12 más recientes. Ahora: `cartera_tenant` (viajes + ingreso +
// contacto + saldo por cliente, de una), el catálogo de tarifas, los 12 viajes
// ORDENADOS Y RECORTADOS EN LA BASE y un `count exact head` para el total.
//
// Se compara contra la reducción JS vieja —copia congelada de clientes.ts
// pre-0152— sobre el mismo dataset. Lo que esta prueba defiende es que el
// saldo por cliente y la concentración siguen saliendo del MISMO conteo: dos
// cifras del mismo dinero se leen como dos cálculos.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = HOY_PRUEBAS;
let doble: Doble = crearDoble(HOY);
/** Consultas que vio el doble de PostgREST: tabla, si pidió conteo y su tope. */
const consultas: Array<{ tabla: string; conteo: boolean; limite: number | null; orden: string[] }> = [];

function constructor(tabla: string, base: () => BaseSintetica) {
  const reg = { tabla, conteo: false, limite: null as number | null, orden: [] as string[] };
  consultas.push(reg);
  let soloSinIngreso = false;
  const filas = () => {
    if (tabla === 'tarifa') return base().tarifa ?? [];
    if (tabla === 'viaje') {
      const vs = base().viaje.filter((v) => v.tenant_id === 't-1' && (!soloSinIngreso || v.ingreso_flete == null));
      // El `order by fecha_inicio desc nulls last, id desc` de la consulta.
      return [...vs].sort((a, b) => {
        const fa = (a as { fecha_inicio?: string }).fecha_inicio ?? '';
        const fb = (b as { fecha_inicio?: string }).fecha_inicio ?? '';
        if (fa !== fb) return fa < fb ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    }
    return [];
  };
  const api: Record<string, unknown> = {
    select: (_c?: unknown, o?: { count?: string; head?: boolean }) => { if (o?.count) reg.conteo = true; return api; },
    eq: () => api,
    is: () => { soloSinIngreso = true; return api; },
    not: () => api,
    order: (c: string) => { reg.orden.push(c); return api; },
    limit: (n: number) => { reg.limite = n; return api; },
    range: (d: number, h: number) => Promise.resolve({
      data: filas().slice(d, h + 1), error: null, count: reg.conteo ? filas().length : null,
    }),
    then: (res: (v: unknown) => unknown) => Promise.resolve(
      reg.conteo
        ? { data: null, count: filas().length, error: null }
        : { data: reg.limite === null ? filas() : filas().slice(0, reg.limite), error: null },
    ).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve(despacharRpc(doble, fn, args)),
    from: (t: string) => constructor(t, () => doble.base),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn() }));

const { getPanelClientes } = await import('./clientes');

function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

/**
 * El saldo por cliente como lo armaba `getPanelClientes` antes de la 0152:
 * sobre TODAS las filas de la vista `factura_saldo`, tirando canceladas y
 * borradores. Es el número que la RPC ahora calcula en SQL.
 */
function legacySaldoPorCliente(b: BaseSintetica, t: string) {
  const m = new Map<string, { saldo: number; vencido: number; facturas: number }>();
  for (const f of b.factura_emitida.filter((x) => x.tenant_id === t)) {
    if (f.estatus === 'cancelada' || f.estatus === 'borrador') continue;
    const s = saldoFactura(b, f, HOY);
    const a = m.get(f.cliente_id) ?? { saldo: 0, vencido: 0, facturas: 0 };
    a.saldo += s.saldo;
    if (s.vencida) a.vencido += s.saldo;
    a.facturas++;
    m.set(f.cliente_id, a);
  }
  return m;
}

beforeEach(() => {
  doble = crearDoble(HOY);
  doble.base = baseDeDosFlotas();
  doble.base.tarifa = [];
  consultas.length = 0;
});

describe('EQUIVALENCIA getPanelClientes — la reducción JS vieja vs cartera_tenant', () => {
  it('cada cliente trae los mismos viajes, ingreso, hueco, contacto y saldo', async () => {
    const b = doble.base;
    const esperado = carteraSql(b, 't-1', HOY);          // el espejo de la RPC
    const saldos = legacySaldoPorCliente(b, 't-1');      // la reducción vieja
    const panel = await getPanelClientes('t-1', HOY);

    expect(panel.clientes.map((c) => c.id)).toEqual(esperado.clientes.map((c) => c.id));
    for (const c of panel.clientes) {
      const viejo = saldos.get(c.id);
      const cliente = b.cliente.find((x) => x.id === c.id)!;
      expect(c.saldoPorCobrar).toEqual(viejo ? round2(viejo.saldo) : null);
      expect(c.vencido).toEqual(viejo ? round2(viejo.vencido) : null);
      expect(c.facturas).toBe(viejo?.facturas ?? 0);
      // El contacto que el formulario de edición necesita para no borrarlo.
      expect([c.contacto, c.correo, c.telefono])
        .toEqual([cliente.contacto ?? null, cliente.correo ?? null, cliente.telefono ?? null]);
    }
  });

  it('un cliente SIN facturas vivas tiene saldo DESCONOCIDO (null), no cero', async () => {
    doble.base.factura_emitida = doble.base.factura_emitida.filter((f) => f.cliente_id !== 'c-b');
    const panel = await getPanelClientes('t-1', HOY);
    const b = panel.clientes.find((c) => c.id === 'c-b')!;
    expect(b.saldoPorCobrar).toBeNull();
    expect(b.vencido).toBeNull();
    expect(b.facturas).toBe(0);
  });

  it('ingresoTotal, concentración y viajes sin cliente son los de la cartera', async () => {
    const panel = await getPanelClientes('t-1', HOY);
    const esperado = carteraSql(doble.base, 't-1', HOY);
    const total = round2(esperado.clientes.reduce((s, c) => s + c.ingreso, 0));
    expect(panel.ingresoTotal).toBe(total);
    expect(panel.concentracion).toBe(round2((esperado.clientes[0].ingreso / total) * 100));
    expect(panel.viajesSinCliente).toBe(esperado.viajesSinCliente);
    expect(panel.conIngreso).toBe(esperado.conIngreso);
  });

  it('la lista de viajes sin ingreso se RECORTA EN LA BASE, y el total se dice aparte', async () => {
    const panel = await getPanelClientes('t-1', HOY);
    // v-2 y v-4 no tienen ingreso capturado; el de $0 (v-5) sí lo tiene.
    expect(panel.sinIngresoTotal).toBe(2);
    expect(panel.sinIngreso.map((v) => v.id).sort()).toEqual(['v-2', 'v-4']);
    const viajes = consultas.filter((c) => c.tabla === 'viaje');
    expect(viajes.some((c) => c.limite === 12 && c.orden[0] === 'fecha_inicio')).toBe(true);
    expect(viajes.some((c) => c.conteo)).toBe(true);
  });

  it('si la cartera no se puede leer, LANZA — no devuelve "esta flota no tiene clientes"', async () => {
    doble.error = { message: 'base caída' };
    await expect(getPanelClientes('t-1', HOY)).rejects.toThrow('base caída');
  });
});
