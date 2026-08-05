// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 12, ALTO (backend, reincidente de ronda 10): el camino de dinero
// de Likida → SUS clientes no tenía una sola prueba que lo invocara.
//
// `emitirMensualidad` y `timbrarFactura` (transferencia.ts) — las dos funciones
// que ESCRIBEN dinero en `factura_saas` y crean CFDI ante el SAT — pasaban la
// suite entera en verde sin haberse ejecutado ni una vez. Estas pruebas las
// ejercitan con el I/O mockeado: la suscripción/plan en la base, el tenant con
// datos fiscales, y el PAC (Facturapi) devolviendo un UUID.
//
// Lo que protegen es irreversible: emitir con el criterio de IVA equivocado
// timbra 16% de más; timbrar sin el desglose guardado emite un CFDI que no
// corresponde al depósito y solo se corrige cancelándolo ante el SAT.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Borde 1: la base (Supabase) ─────────────────────────────────────────────
type Fila = Record<string, unknown>;
const TABLAS: Record<string, Fila[]> = {};
const escrituras: Array<{ tabla: string; valores: Record<string, unknown> }> = [];
const consultas: string[] = [];

function constructor(tabla: string) {
  const registro: Record<string, unknown> = {};
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    in: () => api,
    maybeSingle: () => Promise.resolve({ data: (TABLAS[tabla] ?? [])[0] ?? null, error: null }),
    insert: (v: Record<string, unknown>) => {
      escrituras.push({ tabla, valores: v });
      // El insert devuelve el id via .select('id').maybeSingle(): sin esta fila,
      // emitirMensualidad lee null y truena en data!.id.
      TABLAS[tabla] = [...(TABLAS[tabla] ?? []), { id: `${tabla}-nuevo`, ...v }];
      return api;
    },
    update: () => api,
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ── Borde 2: el PAC (Facturapi) y los datos fiscales ───────────────────────
const timbrarMensualidad = vi.fn(async () => ({ uuid: '11111111-2222-3333-4444-555555555555' }));
vi.mock('./facturapi', () => ({
  facturapiConfigurado: vi.fn(() => true),
  timbrarMensualidad,
  enviarPorCorreo: vi.fn(),
}));
vi.mock('./fiscal', () => ({
  getDatosFiscales: vi.fn(async () => ({
    rfc: 'GMX0902279I1', razonSocial: 'Flota de Prueba SA de CV',
    regimenFiscal: '601', codigoPostal: '36100', usoCfdi: 'G03',
  })),
  estanCompletos: vi.fn(() => true),
}));

const { emitirMensualidad, timbrarFactura } = await import('./transferencia');

const SUSCRIPCION = (precioIvaIncluido: boolean | null = true) => [{
  id: 'sus-1', plan_clave: 'basico',
  plan: [{ precio_mensual: 10000, moneda: 'MXN', nombre: 'Básico', precio_iva_incluido: precioIvaIncluido }],
}];

const FACTURA_PAGADA = {
  id: 'fact-1', tenant_id: 't-1', estado: 'pagada', monto: 10000,
  subtotal: 8620.69, iva: 1379.31, moneda: 'MXN',
  periodo_inicio: '2026-08-01', periodo_fin: '2026-08-31', referencia: 'REF-123', cfdi_uuid: null,
};

beforeEach(() => {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  escrituras.length = 0;
  consultas.length = 0;
  timbrarMensualidad.mockClear();
});

describe('emitirMensualidad — el cobro que no puede equivocarse', () => {
  it('emite con el desglose de IVA correcto para un plan con IVA incluido', async () => {
    TABLAS.suscripcion = SUSCRIPCION(true);
    const r = await emitirMensualidad('t-1', '2026-08-01', '2026-08-31');
    // 10,000 con IVA incluido → subtotal 8,620.69 + IVA 1,379.31, total 10,000.
    expect(r.monto).toBe(10000);
    expect(r.subtotal).toBeCloseTo(8620.69, 1);
    expect(r.iva).toBeCloseTo(1379.31, 1);
    const w = escrituras.find((e) => e.tabla === 'factura_saas')!;
    expect(w.valores).toMatchObject({
      tenant_id: 't-1', estado: 'pendiente', metodo_cobro: 'transferencia',
      moneda: 'MXN', monto: 10000,
    });
    expect(w.valores.referencia).toMatch(/^[A-Z0-9]+$/);
  });

  it('REINICIA el desglose para un plan con IVA por separado (precio × 1.16)', async () => {
    TABLAS.suscripcion = SUSCRIPCION(false);
    const r = await emitirMensualidad('t-1', '2026-08-01', '2026-08-31');
    // 10,000 SIN IVA → subtotal 10,000 + IVA 1,600 = total 11,600.
    expect(r.subtotal).toBe(10000);
    expect(r.iva).toBe(1600);
    expect(r.monto).toBe(11600);
  });

  it('RECHAZA un plan sin precio — no hay monto que cobrar', async () => {
    TABLAS.suscripcion = [{
      id: 'sus-1', plan_clave: 'gratis',
      plan: [{ precio_mensual: null, moneda: 'MXN', nombre: 'Gratis', precio_iva_incluido: null }],
    }];
    await expect(emitirMensualidad('t-1', '2026-08-01', '2026-08-31')).rejects.toThrow(/no tiene precio/i);
  });

  it('RECHAZA un plan en moneda que no es MXN — el peso imprime todo como MXN', async () => {
    TABLAS.suscripcion = [{
      id: 'sus-1', plan_clave: 'usd',
      plan: [{ precio_mensual: 100, moneda: 'USD', nombre: 'Dólares', precio_iva_incluido: true }],
    }];
    await expect(emitirMensualidad('t-1', '2026-08-01', '2026-08-31')).rejects.toThrow(/MXN/i);
  });

  it('RECHAZA sin suscripción activa', async () => {
    TABLAS.suscripcion = [];
    await expect(emitirMensualidad('t-1', '2026-08-01', '2026-08-31')).rejects.toThrow(/no tiene una suscripción/i);
  });
});

describe('timbrarFactura — el CFDI que no se puede deshacer', () => {
  it('timbra una factura pagada con desglose consistente', async () => {
    TABLAS.factura_saas = [FACTURA_PAGADA];
    const r = await timbrarFactura('fact-1');
    expect(r).toEqual({ uuid: '11111111-2222-3333-4444-555555555555' });
    expect(timbrarMensualidad).toHaveBeenCalledWith(expect.objectContaining({
      subtotal: 8620.69,
      totalEsperado: 10000,
      referencia: 'REF-123',
    }));
  });

  it('NO timbra dos veces — el UUID ya puesto es la prueba', async () => {
    TABLAS.factura_saas = [{ ...FACTURA_PAGADA, cfdi_uuid: 'aaaaaaaa-0000-0000-0000-000000000000' }];
    await expect(timbrarFactura('fact-1')).rejects.toThrow(/ya está timbrada/i);
    expect(timbrarMensualidad).not.toHaveBeenCalled();
  });

  it('NO timbra lo que no está pagado', async () => {
    TABLAS.factura_saas = [{ ...FACTURA_PAGADA, estado: 'pendiente' }];
    await expect(timbrarFactura('fact-1')).rejects.toThrow(/solo se timbra lo que ya está pagado/i);
    expect(timbrarMensualidad).not.toHaveBeenCalled();
  });

  it('NO timbra sin el desglose de IVA guardado', async () => {
    TABLAS.factura_saas = [{ ...FACTURA_PAGADA, subtotal: null, iva: null }];
    await expect(timbrarFactura('fact-1')).rejects.toThrow(/no trae el desglose/i);
    expect(timbrarMensualidad).not.toHaveBeenCalled();
  });

  it('NO timbra un desglose que no cuadra con el total — el CFDI saldría 16% mal', async () => {
    TABLAS.factura_saas = [{ ...FACTURA_PAGADA, subtotal: 8000, iva: 1000 }];  // 8000+1000 ≠ 10000
    await expect(timbrarFactura('fact-1')).rejects.toThrow(/no cuadra/i);
    expect(timbrarMensualidad).not.toHaveBeenCalled();
  });

  it('vuelve pendiente si el PAC no está configurado — el cobro es válido igual', async () => {
    const { facturapiConfigurado } = await import('./facturapi');
    vi.mocked(facturapiConfigurado).mockReturnValueOnce(false);
    TABLAS.factura_saas = [FACTURA_PAGADA];
    const r = await timbrarFactura('fact-1');
    expect(r).toEqual({ pendiente: expect.stringContaining('no está conectado') });
    expect(timbrarMensualidad).not.toHaveBeenCalled();
  });
});
