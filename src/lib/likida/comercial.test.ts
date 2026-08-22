import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · M20 — el lado del ingreso entero (Rentabilidad, Cartera,
// Cobranza) tenía 3 de 229 líneas ejecutadas: invertir el signo de la
// contribución o quitar el guardia de división entre cero no rompía nada. El
// módulo es puro salvo por las consultas: `traerTodo` se dobla por etiqueta y
// lo que se afirma es el CÁLCULO y la regla del producto —una cifra o es un
// conteo real de la base, o NO SE MUESTRA (null, jamás 0 ni NaN).
// ═══════════════════════════════════════════════════════════════════════════

let fixtures: Record<string, unknown[]> = {};
vi.mock('./pg', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, traerTodo: async (_c: unknown, etiqueta: string) => fixtures[etiqueta] ?? [] };
});
// `from` se encadena pero nunca se ejecuta: traerTodo está doblado.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));

const { getRentabilidad, getCartera, getCobranza } = await import('./comercial');

beforeEach(() => { fixtures = {}; });

describe('getRentabilidad — contribución = ingreso − comprobado, y el margen sobre 0 es null', () => {
  it('$500,000 capturados y $380,000 comprobados: +$120,000 y +24%', async () => {
    fixtures = {
      'getRentabilidad.viaje': [{ ingreso_flete: 300000 }, { ingreso_flete: '200000' }, { ingreso_flete: null }],
      'getRentabilidad.liquidacion': [{ total_comprobado: 380000 }],
    };
    const r = await getRentabilidad('t-1');
    expect(r.ingreso).toBe(500000);
    expect(r.costoComprobado).toBe(380000);
    expect(r.contribucion).toBe(120000);
    expect(r.margenPct).toBe(24);
    expect(r.viajesConIngreso).toBe(2);
    expect(r.viajesSinIngreso).toBe(1);
  });

  it('una flota NUEVA (nadie capturó ingreso) no enseña margen: null, no Infinity ni NaN ni 0', async () => {
    fixtures = {
      'getRentabilidad.viaje': [{ ingreso_flete: null }, { ingreso_flete: null }],
      'getRentabilidad.liquidacion': [{ total_comprobado: 1500 }],
    };
    const r = await getRentabilidad('t-1');
    expect(r.ingreso).toBe(0);
    expect(r.margenPct).toBeNull();
    expect(r.contribucion).toBe(-1500);
    expect(r.viajesSinIngreso).toBe(2);
  });

  it('un viaje con $0 de ingreso capturado cuenta como CON ingreso (0 es una medición, null no)', async () => {
    fixtures = { 'getRentabilidad.viaje': [{ ingreso_flete: 0 }], 'getRentabilidad.liquidacion': [] };
    const r = await getRentabilidad('t-1');
    expect(r.viajesConIngreso).toBe(1);
    expect(r.margenPct).toBeNull();
  });

  it('redondea a centavos y un comprobado null suma 0', async () => {
    fixtures = {
      'getRentabilidad.viaje': [{ ingreso_flete: 0.1 }, { ingreso_flete: 0.2 }],
      'getRentabilidad.liquidacion': [{ total_comprobado: null }],
    };
    const r = await getRentabilidad('t-1');
    expect(r.ingreso).toBe(0.3);
    expect(r.contribucion).toBe(0.3);
    expect(r.margenPct).toBe(100);
  });
});

describe('getCartera — el reparto por cliente y la concentración', () => {
  it('suma solo el ingreso capturado, cuenta aparte el hueco, y la concentración es del más grande', async () => {
    fixtures = {
      'getCartera.cliente': [
        { id: 'c-a', nombre: 'Alfa', rfc: 'AAA', dias_credito: 30, activo: true },
        { id: 'c-b', nombre: 'Beta', rfc: null, dias_credito: null, activo: false },
      ],
      'getCartera.viaje': [
        { cliente_id: 'c-a', ingreso_flete: 7000 },
        { cliente_id: 'c-a', ingreso_flete: null },
        { cliente_id: 'c-b', ingreso_flete: 3000 },
        { cliente_id: null, ingreso_flete: 999 },
      ],
    };
    const c = await getCartera('t-1');
    expect(c.clientes.map((x) => x.nombre)).toEqual(['Alfa', 'Beta']);
    expect(c.clientes[0]).toMatchObject({ viajes: 2, ingreso: 7000, viajesSinIngreso: 1, diasCredito: 30, activo: true });
    expect(c.clientes[1]).toMatchObject({ viajes: 1, ingreso: 3000, viajesSinIngreso: 0, diasCredito: null, rfc: null });
    expect(c.ingresoTotal).toBe(10000);
    expect(c.concentracion).toBe(70);
    expect(c.viajesSinCliente).toBe(1);
  });

  it('sin ingreso capturado la concentración es null — 0 diría "no dependes de nadie"', async () => {
    fixtures = {
      'getCartera.cliente': [{ id: 'c-a', nombre: 'Alfa', rfc: null, dias_credito: null, activo: true }],
      'getCartera.viaje': [{ cliente_id: 'c-a', ingreso_flete: null }],
    };
    const c = await getCartera('t-1');
    expect(c.ingresoTotal).toBe(0);
    expect(c.concentracion).toBeNull();
  });

  it('sin clientes: lista vacía y concentración null', async () => {
    const c = await getCartera('t-1');
    expect(c.clientes).toEqual([]);
    expect(c.concentracion).toBeNull();
  });
});

describe('getCobranza — el saldo sale de la vista, y solo las facturas vivas cuentan', () => {
  const base = () => ({
    'getCobranza.factura': [
      { id: 'f-1', folio: 'A-1', cliente_id: 'c-a', fecha: '2026-07-01', total: 11600, estatus: 'emitida', vence_en: '2026-07-31' },
      { id: 'f-2', folio: null, cliente_id: 'c-z', fecha: '2026-08-01', total: 5000, estatus: 'emitida', vence_en: null },
      { id: 'f-3', folio: 'A-3', cliente_id: 'c-a', fecha: '2026-08-02', total: 800, estatus: 'cancelada', vence_en: null },
      { id: 'f-4', folio: 'A-4', cliente_id: 'c-a', fecha: '2026-08-03', total: 300, estatus: 'borrador', vence_en: null },
    ],
    'getCobranza.saldo': [
      { factura_id: 'f-1', pagado: 10000, saldo: 1600, vencida: true },
      { factura_id: 'f-2', pagado: 0, saldo: 5000, vencida: false },
    ],
    'getCobranza.cliente': [{ id: 'c-a', nombre: 'Alfa' }],
  });

  it('porCobrar y vencido suman solo emitidas/pagadas (no canceladas ni borradores)', async () => {
    fixtures = base();
    const c = await getCobranza('t-1');
    expect(c.porCobrar).toBe(6600);
    expect(c.vencido).toBe(1600);
    expect(c.sinCondiciones).toBe(1); // f-2: cliente sin crédito pactado
  });

  it('las vencidas van primero; el cliente desconocido se pinta "—"; sin fila en la vista, saldo = total', async () => {
    fixtures = base();
    const c = await getCobranza('t-1');
    expect(c.facturas[0]).toMatchObject({ id: 'f-1', cliente: 'Alfa', pagado: 10000, saldo: 1600, vencida: true });
    const f2 = c.facturas.find((f) => f.id === 'f-2')!;
    expect(f2.cliente).toBe('—');
    const f3 = c.facturas.find((f) => f.id === 'f-3')!;
    expect(f3.saldo).toBe(800);
    expect(f3.pagado).toBe(0);
  });
});
