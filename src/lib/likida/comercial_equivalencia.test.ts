import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  crearDoble, despacharRpc, baseDeDosFlotas, cobranzaTotalSql, saldoFactura,
  HOY_PRUEBAS, type Doble, type BaseSintetica,
} from './espejo_0152.pruebas';

// ═══════════════════════════════════════════════════════════════════════════
// ESCALA 50k (mig. 0152): getRentabilidad, getCartera y getCobranza pasaron de
// `traerTodo` + reduce en JS a `rentabilidad_tenant` / `cartera_tenant` /
// `cobranza_tenant` en SQL.
//
// Lo que prueba este archivo es EQUIVALENCIA, con el patrón de la 0112
// (analytics_kpis_acreditables.test.ts): la reducción JS VIEJA —copias
// congeladas de lo que vivía en comercial.ts antes de la 0152, abajo— contra
// las funciones NUEVAS (con la RPC doblada por el espejo de la migración,
// escrito aparte), sobre el MISMO dataset sintético: dos flotas, ingreso
// `null`, factura sin vencimiento, cancelada, borrador, pago parcial y una
// factura saldada al centavo.
//
// La única diferencia de contrato que se admite —y se prueba— es que
// `getCobranza` ahora devuelve UNA PÁGINA: las CIFRAS tienen que ser
// idénticas a las de la reducción vieja sobre la tabla entera.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = HOY_PRUEBAS;
let doble: Doble = crearDoble(HOY);

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve(despacharRpc(doble, fn, args)),
    from: () => {
      const api: Record<string, unknown> = {
        select: () => api, eq: () => api, gte: () => api, lte: () => api,
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ count: cobranzaTotalSql(doble.base, 't-1', null, null), error: null }).then(res),
      };
      return api;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getRentabilidad, getCartera, getCobranza } = await import('./comercial');

function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

// ── LAS REDUCCIONES JS VIEJAS — copias congeladas de comercial.ts pre-0152 ──

/** `getRentabilidad` antes de la 0152: leía `viaje` y `liquidacion` enteras. */
function legacyRentabilidad(viajes: Array<{ ingreso_flete: unknown }>, liqs: Array<{ total_comprobado: unknown }>) {
  let ingreso = 0, conIngreso = 0, sinIngreso = 0;
  for (const v of viajes) {
    if (v.ingreso_flete == null) sinIngreso++;
    else { ingreso += Number(v.ingreso_flete); conIngreso++; }
  }
  const costoComprobado = liqs.reduce((s, l) => s + Number(l.total_comprobado ?? 0), 0);
  return {
    ingreso: round2(ingreso),
    costoComprobado: round2(costoComprobado),
    contribucion: round2(ingreso - costoComprobado),
    margenPct: ingreso > 0 ? round2(((ingreso - costoComprobado) / ingreso) * 100) : null,
    viajesConIngreso: conIngreso,
    viajesSinIngreso: sinIngreso,
  };
}

/** `getCartera` antes de la 0152. */
function legacyCartera(
  clientes: Array<{ id: string; nombre: string; rfc: string | null; dias_credito: number | null; activo: boolean }>,
  viajes: Array<{ cliente_id: string | null; ingreso_flete: unknown }>,
) {
  const acum = new Map<string, { viajes: number; ingreso: number; sinIngreso: number }>();
  let viajesSinCliente = 0;
  for (const v of viajes) {
    const cid = v.cliente_id;
    if (!cid) { viajesSinCliente++; continue; }
    const a = acum.get(cid) ?? { viajes: 0, ingreso: 0, sinIngreso: 0 };
    a.viajes++;
    if (v.ingreso_flete == null) a.sinIngreso++;
    else a.ingreso += Number(v.ingreso_flete);
    acum.set(cid, a);
  }
  const filas = clientes.map((c) => {
    const a = acum.get(c.id) ?? { viajes: 0, ingreso: 0, sinIngreso: 0 };
    return {
      id: c.id, nombre: c.nombre, rfc: c.rfc ?? null,
      diasCredito: c.dias_credito == null ? null : Number(c.dias_credito),
      activo: Boolean(c.activo), viajes: a.viajes, ingreso: round2(a.ingreso), viajesSinIngreso: a.sinIngreso,
    };
  }).sort((x, y) => y.ingreso - x.ingreso);
  const ingresoTotal = round2(filas.reduce((s, f) => s + f.ingreso, 0));
  const concentracion = ingresoTotal > 0 && filas.length ? round2((filas[0].ingreso / ingresoTotal) * 100) : null;
  return { clientes: filas, ingresoTotal, concentracion, viajesSinCliente };
}

/** `getCobranza` antes de la 0152: todas las facturas, con su saldo de la vista. */
function legacyCobranza(
  facturas: Array<{ id: string; folio: string | null; cliente_id: string; fecha: string; total: number; estatus: string; vence_en: string | null }>,
  saldos: Map<string, { pagado: number; saldo: number; vencida: boolean }>,
  clientes: Map<string, string>,
) {
  const filas = facturas.map((f) => {
    const s = saldos.get(f.id);
    return {
      id: f.id, folio: f.folio ?? null, cliente: clientes.get(f.cliente_id) ?? '—', fecha: String(f.fecha),
      total: round2(Number(f.total ?? 0)), pagado: round2(Number(s?.pagado ?? 0)),
      saldo: round2(Number(s?.saldo ?? f.total ?? 0)), estatus: String(f.estatus),
      venceEn: f.vence_en ?? null, vencida: Boolean(s?.vencida),
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

// ── Lo que `traerTodo` le habría entregado a cada reducción vieja ──────────
const filasViaje = (b: BaseSintetica, t: string) => b.viaje.filter((v) => v.tenant_id === t);
const filasLiq = (b: BaseSintetica, t: string) => b.liquidacion.filter((l) => l.tenant_id === t);
const filasFactura = (b: BaseSintetica, t: string) => b.factura_emitida.filter((f) => f.tenant_id === t);

beforeEach(() => { doble = crearDoble(HOY); doble.base = baseDeDosFlotas(); });

describe('EQUIVALENCIA getRentabilidad — la reducción JS vieja vs rentabilidad_tenant', () => {
  it('mismas seis cifras sobre el mismo dataset, y sin un peso de la otra flota', async () => {
    const b = doble.base;
    const viejo = legacyRentabilidad(
      filasViaje(b, 't-1').map((v) => ({ ingreso_flete: v.ingreso_flete ?? null })),
      filasLiq(b, 't-1').map((l) => ({ total_comprobado: l.total_comprobado })),
    );
    expect(await getRentabilidad('t-1')).toEqual(viejo);
    // Control: la flota ajena tiene cifras muy distintas; si el `where` de la
    // RPC se cayera, la comparación de arriba habría pasado por casualidad.
    expect(viejo.ingreso).not.toEqual(legacyRentabilidad(
      filasViaje(b, 't-2').map((v) => ({ ingreso_flete: v.ingreso_flete ?? null })),
      filasLiq(b, 't-2').map((l) => ({ total_comprobado: l.total_comprobado })),
    ).ingreso);
  });

  it('el `null` de ingreso se cuenta aparte en las dos, no se suma como 0', async () => {
    const nuevo = await getRentabilidad('t-1');
    expect(nuevo.viajesSinIngreso).toBe(2);   // v-2 y v-4
    expect(nuevo.viajesConIngreso).toBe(4);   // incluye el de $0 (v-5)
  });
});

describe('EQUIVALENCIA getCartera — la reducción JS vieja vs cartera_tenant', () => {
  it('mismo reparto por cliente, mismo total y misma concentración', async () => {
    const b = doble.base;
    const viejo = legacyCartera(
      b.cliente.filter((c) => c.tenant_id === 't-1').map((c) => ({
        id: c.id, nombre: c.nombre, rfc: c.rfc ?? null, dias_credito: c.dias_credito ?? null, activo: c.activo ?? true,
      })),
      filasViaje(b, 't-1').map((v) => ({ cliente_id: v.cliente_id ?? null, ingreso_flete: v.ingreso_flete ?? null })),
    );
    expect(await getCartera('t-1')).toEqual(viejo);
  });

  it('el viaje sin cliente no se le cuelga a nadie, en las dos', async () => {
    const c = await getCartera('t-1');
    expect(c.viajesSinCliente).toBe(1);   // v-4
    expect(c.clientes.reduce((s, x) => s + x.viajes, 0)).toBe(filasViaje(doble.base, 't-1').length - 1);
  });
});

describe('EQUIVALENCIA getCobranza — las CIFRAS no cambian; la lista ahora pagina', () => {
  const viejoDe = (b: BaseSintetica) => legacyCobranza(
    filasFactura(b, 't-1').map((f) => ({
      id: f.id, folio: f.folio ?? null, cliente_id: f.cliente_id, fecha: f.fecha, total: f.total,
      estatus: f.estatus, vence_en: f.vence_en ?? null,
    })),
    new Map(filasFactura(b, 't-1').map((f) => [f.id, saldoFactura(b, f, HOY)])),
    new Map(b.cliente.filter((c) => c.tenant_id === 't-1').map((c) => [c.id, c.nombre])),
  );

  it('porCobrar, vencido y sinCondiciones son los MISMOS que sobre la tabla entera', async () => {
    const viejo = viejoDe(doble.base);
    const nuevo = await getCobranza('t-1');
    expect(nuevo.porCobrar).toBe(viejo.porCobrar);
    expect(nuevo.vencido).toBe(viejo.vencido);
    expect(nuevo.sinCondiciones).toBe(viejo.sinCondiciones);
    // Y no son cero por accidente: hay saldo vivo y saldo vencido de verdad.
    expect(nuevo.porCobrar).toBeGreaterThan(0);
    expect(nuevo.vencido).toBeGreaterThan(0);
  });

  it('cada renglón trae el mismo saldo, pagado y "vencida" que la reducción vieja', async () => {
    const porId = new Map(viejoDe(doble.base).facturas.map((f) => [f.id, f]));
    for (const f of (await getCobranza('t-1')).facturas) {
      expect(f).toEqual(porId.get(f.id));
    }
  });

  it('recorriendo las páginas salen TODAS las facturas, una sola vez', async () => {
    const viejo = viejoDe(doble.base);
    const vistas: string[] = [];
    for (let p = 1; p <= 3; p++) {
      const pag = await getCobranza('t-1', { porPagina: 2, pagina: p });
      expect(pag.total).toBe(viejo.facturas.length);
      vistas.push(...pag.facturas.map((f) => f.id));
    }
    expect([...vistas].sort()).toEqual(viejo.facturas.map((f) => f.id).sort());
    expect(new Set(vistas).size).toBe(vistas.length);
  });

  it('la primera página trae las mismas de arriba que la lista vieja (vencida, luego saldo)', async () => {
    const viejo = viejoDe(doble.base);
    const nuevo = await getCobranza('t-1', { porPagina: 2 });
    expect(nuevo.facturas.map((f) => [f.vencida, f.saldo]))
      .toEqual(viejo.facturas.slice(0, 2).map((f) => [f.vencida, f.saldo]));
  });
});
