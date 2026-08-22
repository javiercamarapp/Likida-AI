import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  crearDoble, despacharRpc, cobranzaTotalSql, type Doble,
} from './espejo_0152.pruebas';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · M20 — el lado del ingreso entero (Rentabilidad, Cartera,
// Cobranza) tenía 3 de 229 líneas ejecutadas: invertir el signo de la
// contribución o quitar el guardia de división entre cero no rompía nada.
//
// ESCALA 50k (22-ago-2026, mig. 0152): las tres pasaron de `traerTodo` +
// reduce en JS a `rentabilidad_tenant` / `cartera_tenant` / `cobranza_tenant`.
// El doble de la base ya no dobla `traerTodo`: dobla la RPC con el ESPEJO EN
// JS de la migración (`espejo_0152.pruebas.ts`), así que lo que se afirma
// aquí sigue siendo la REGLA DEL PRODUCTO —una cifra o es un conteo real de
// la base, o NO SE MUESTRA (null, jamás 0 ni NaN)— más el fail-closed nuevo:
// una forma inesperada LANZA, no se lee como una flota sin actividad.
//
// La equivalencia contra la reducción JS vieja vive en
// `comercial_equivalencia.test.ts`; que el espejo coincida con Postgres de
// verdad, en el bloque 124 de supabase/verificaciones.sql.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = '2026-08-14';
let doble: Doble = crearDoble(HOY);

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve(despacharRpc(doble, fn, args)),
    // El `count exact head` de `getCobranza`: cuenta con el MISMO filtro de
    // fecha que la RPC, y devuelve `count: null` cuando se le pide fallar.
    from: () => {
      const filtros: Record<string, string> = {};
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        gte: (_c: string, v: string) => { filtros.desde = v; return api; },
        lte: (_c: string, v: string) => { filtros.hasta = v; return api; },
        then: (res: (v: unknown) => unknown) => Promise.resolve(
          doble.error
            ? { count: null, error: doble.error }
            : {
              count: conteoRoto ? null : cobranzaTotalSql(doble.base, 't-1',
                filtros.desde === '0001-01-01' ? null : filtros.desde ?? null,
                filtros.hasta === '9999-12-31' ? null : filtros.hasta ?? null),
              error: null,
            },
        ).then(res),
      };
      return api;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let conteoRoto = false;

const { getRentabilidad, getCartera, getCobranza } = await import('./comercial');

const cliente = (id: string, nombre: string, extra: Record<string, unknown> = {}) =>
  ({ id, tenant_id: 't-1', nombre, ...extra });

beforeEach(() => { doble = crearDoble(HOY); conteoRoto = false; });

describe('getRentabilidad — contribución = ingreso − comprobado, y el margen sobre 0 es null', () => {
  it('$500,000 capturados y $380,000 comprobados: +$120,000 y +24%', async () => {
    doble.base.viaje = [
      { id: 'v-1', tenant_id: 't-1', operador_id: 'o-1', estatus: 'liquidado', ingreso_flete: 300000 },
      { id: 'v-2', tenant_id: 't-1', operador_id: 'o-1', estatus: 'liquidado', ingreso_flete: 200000 },
      { id: 'v-3', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', ingreso_flete: null },
    ];
    doble.base.liquidacion = [{ tenant_id: 't-1', viaje_id: 'v-1', total_comprobado: 380000, created_at: '2026-08-01T12:00:00Z' }];
    const r = await getRentabilidad('t-1');
    expect(r.ingreso).toBe(500000);
    expect(r.costoComprobado).toBe(380000);
    expect(r.contribucion).toBe(120000);
    expect(r.margenPct).toBe(24);
    expect(r.viajesConIngreso).toBe(2);
    expect(r.viajesSinIngreso).toBe(1);
  });

  it('una flota NUEVA (nadie capturó ingreso) no enseña margen: null, no Infinity ni NaN ni 0', async () => {
    doble.base.viaje = [
      { id: 'v-1', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', ingreso_flete: null },
      { id: 'v-2', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', ingreso_flete: null },
    ];
    doble.base.liquidacion = [{ tenant_id: 't-1', viaje_id: 'v-1', total_comprobado: 1500, created_at: '2026-08-01T12:00:00Z' }];
    const r = await getRentabilidad('t-1');
    expect(r.ingreso).toBe(0);
    expect(r.margenPct).toBeNull();
    expect(r.contribucion).toBe(-1500);
    expect(r.viajesSinIngreso).toBe(2);
  });

  it('un viaje con $0 de ingreso capturado cuenta como CON ingreso (0 es una medición, null no)', async () => {
    doble.base.viaje = [{ id: 'v-1', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', ingreso_flete: 0 }];
    const r = await getRentabilidad('t-1');
    expect(r.viajesConIngreso).toBe(1);
    expect(r.margenPct).toBeNull();
  });

  it('redondea a centavos', async () => {
    doble.base.viaje = [
      { id: 'v-1', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', ingreso_flete: 0.1 },
      { id: 'v-2', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', ingreso_flete: 0.2 },
    ];
    const r = await getRentabilidad('t-1');
    expect(r.ingreso).toBe(0.3);
    expect(r.contribucion).toBe(0.3);
    expect(r.margenPct).toBe(100);
  });

  it('el error de la RPC LANZA: cero no es "esta flota no ha facturado nada"', async () => {
    doble.error = { message: 'timeout' };
    await expect(getRentabilidad('t-1')).rejects.toThrow('timeout');
  });

  it('una forma inesperada LANZA y nombra la migración', async () => {
    doble.formaRota = { ingreso: 100 };   // faltan tres campos
    await expect(getRentabilidad('t-1')).rejects.toThrow('0152');
  });
});

describe('getCartera — el reparto por cliente y la concentración', () => {
  it('suma solo el ingreso capturado, cuenta aparte el hueco, y la concentración es del más grande', async () => {
    doble.base.cliente = [
      cliente('c-a', 'Alfa', { rfc: 'AAA', dias_credito: 30, activo: true }),
      cliente('c-b', 'Beta', { rfc: null, dias_credito: null, activo: false }),
    ];
    doble.base.viaje = [
      { id: 'v-1', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', cliente_id: 'c-a', ingreso_flete: 7000 },
      { id: 'v-2', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', cliente_id: 'c-a', ingreso_flete: null },
      { id: 'v-3', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', cliente_id: 'c-b', ingreso_flete: 3000 },
      { id: 'v-4', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', cliente_id: null, ingreso_flete: 999 },
    ];
    const c = await getCartera('t-1');
    expect(c.clientes.map((x) => x.nombre)).toEqual(['Alfa', 'Beta']);
    expect(c.clientes[0]).toMatchObject({ viajes: 2, ingreso: 7000, viajesSinIngreso: 1, diasCredito: 30, activo: true });
    expect(c.clientes[1]).toMatchObject({ viajes: 1, ingreso: 3000, viajesSinIngreso: 0, diasCredito: null, rfc: null });
    expect(c.ingresoTotal).toBe(10000);
    expect(c.concentracion).toBe(70);
    expect(c.viajesSinCliente).toBe(1);
  });

  it('sin ingreso capturado la concentración es null — 0 diría "no dependes de nadie"', async () => {
    doble.base.cliente = [cliente('c-a', 'Alfa')];
    doble.base.viaje = [{ id: 'v-1', tenant_id: 't-1', operador_id: 'o-1', estatus: 'abierto', cliente_id: 'c-a', ingreso_flete: null }];
    const c = await getCartera('t-1');
    expect(c.ingresoTotal).toBe(0);
    expect(c.concentracion).toBeNull();
  });

  it('sin clientes: lista vacía y concentración null', async () => {
    const c = await getCartera('t-1');
    expect(c.clientes).toEqual([]);
    expect(c.concentracion).toBeNull();
  });

  it('un cliente de OTRA flota no entra (el aislamiento vive en el where de la RPC)', async () => {
    doble.base.cliente = [cliente('c-a', 'Alfa'), { id: 'c-x', tenant_id: 't-2', nombre: 'Ajena' }];
    const c = await getCartera('t-1');
    expect(c.clientes.map((x) => x.id)).toEqual(['c-a']);
  });

  it('un cliente fuera de forma LANZA en vez de colarse a medias', async () => {
    doble.formaRota = { clientes: [{ id: 'c-a' }], viajesSinCliente: 0, conIngreso: 0 };
    await expect(getCartera('t-1')).rejects.toThrow('cliente #0');
  });
});

describe('getCobranza — el saldo sale de la vista, solo las vivas cuentan, y la lista viene PAGINADA', () => {
  const sembrar = () => {
    doble.base.cliente = [cliente('c-a', 'Alfa')];
    doble.base.factura_emitida = [
      { id: 'f-1', tenant_id: 't-1', cliente_id: 'c-a', folio: 'A-1', fecha: '2026-07-01', total: 11600, estatus: 'emitida', vence_en: '2026-07-31' },
      { id: 'f-2', tenant_id: 't-1', cliente_id: 'c-z', folio: null, fecha: '2026-08-01', total: 5000, estatus: 'emitida', vence_en: null },
      { id: 'f-3', tenant_id: 't-1', cliente_id: 'c-a', folio: 'A-3', fecha: '2026-08-02', total: 800, estatus: 'cancelada', vence_en: null },
      { id: 'f-4', tenant_id: 't-1', cliente_id: 'c-a', folio: 'A-4', fecha: '2026-08-03', total: 300, estatus: 'borrador', vence_en: null },
    ];
    doble.base.pago_recibido = [{ factura_id: 'f-1', monto: 10000 }];
  };

  it('porCobrar y vencido suman solo emitidas/pagadas (no canceladas ni borradores)', async () => {
    sembrar();
    const c = await getCobranza('t-1');
    expect(c.porCobrar).toBe(6600);
    expect(c.vencido).toBe(1600);
    expect(c.sinCondiciones).toBe(1); // f-2: cliente sin crédito pactado
  });

  it('las vencidas van primero y el cliente desconocido se pinta "—"', async () => {
    sembrar();
    const c = await getCobranza('t-1');
    expect(c.facturas[0].id).toBe('f-1');
    expect(c.facturas[0].vencida).toBe(true);
    expect(c.facturas.find((f) => f.id === 'f-2')!.cliente).toBe('—');
  });

  it('la página recorta la LISTA y nunca las cifras, y dice el total', async () => {
    sembrar();
    const p1 = await getCobranza('t-1', { porPagina: 2 });
    expect(p1.facturas).toHaveLength(2);
    expect(p1.total).toBe(4);
    expect(p1.pagina).toBe(1);
    expect(p1.porCobrar).toBe(6600);   // la MISMA cifra que sin paginar

    const p2 = await getCobranza('t-1', { porPagina: 2, pagina: 2 });
    expect(p2.facturas).toHaveLength(2);
    expect(p2.porCobrar).toBe(6600);
    // Sin filas repetidas entre páginas: el orden es estable.
    expect(p1.facturas.map((f) => f.id).some((id) => p2.facturas.some((f) => f.id === id))).toBe(false);
  });

  it('nunca pide más de 100 renglones, aunque se los pidan', async () => {
    sembrar();
    await getCobranza('t-1', { porPagina: 5000 });
    const llamada = doble.llamadas.find((l) => l.fn === 'cobranza_tenant')!;
    expect(llamada.args.p_limite).toBe(100);
  });

  it('acota por periodo cuando se le da uno, y el total usa el MISMO filtro', async () => {
    sembrar();
    const c = await getCobranza('t-1', { desde: '2026-08-01', hasta: '2026-08-31' });
    expect(c.total).toBe(3);            // f-1 es de julio
    expect(c.facturas.every((f) => f.fecha >= '2026-08-01')).toBe(true);
    expect(c.porCobrar).toBe(5000);     // sin la de julio
  });

  it('un conteo que no llegó LANZA: null no es cero facturas', async () => {
    sembrar();
    conteoRoto = true;
    await expect(getCobranza('t-1')).rejects.toThrow('no devolvió el conteo');
  });

  it('una factura fuera de forma LANZA', async () => {
    doble.formaRota = { porCobrar: 0, vencido: 0, sinCondiciones: 0, facturas: [{ id: 'f-1' }] };
    await expect(getCobranza('t-1')).rejects.toThrow('factura #0');
  });
});
