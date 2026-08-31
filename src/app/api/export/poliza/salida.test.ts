import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · PRU-C1 (CRÍTICO) — la ruta que exporta el asiento contable no
// tenía UNA sola prueba que ejecutara su salida.
//
// Su único archivo (`rol_dinero.test.ts`) tiene cuatro casos y los cuatro son
// de ROL: se cortan ANTES de leer el catálogo a propósito. Así que los dos
// frenos de dinero de la ruta —el de base gravable desconocida
// (`route.ts:182`) y el 409 de pólizas incompletas (`:204`)— se podían BORRAR
// con la suite entera en verde.
//
// Y no es teórico: es la MISMA ruta que carga el crítico fiscal FIS-C1, y
// explica cómo el arreglo `010a7f5` pudo convertir un bloqueo en una
// exportación sin que nadie se enterara. Ahí no había red.
//
// Lo que esta suite fija:
//   1. Una base gravable desconocida BLOQUEA, y el mensaje dice cuál concepto.
//   2. Un catálogo incompleto BLOQUEA con 409 y nombra qué cuenta falta.
//   3. El archivo feliz SALE, y lleva las cuentas declaradas — no unas
//      plausibles.
//   4. FIS-C1: un gasto NO DEDUCIBLE no se asienta en la cuenta de gasto
//      deducible. Es la regresión que costó el crítico.
// ═══════════════════════════════════════════════════════════════════════════

const resolverTenantApi = vi.fn(async () => ({
  ok: true as const, tenantId: 'tenant-1', rol: 'contador' as string,
}));
vi.mock('@/lib/auth/tenant-api', () => ({
  resolverTenantApi: (...a: unknown[]) => resolverTenantApi(...(a as [])),
}));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '203.0.113.7' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const CATALOGO_COMPLETO = {
  gastos: { diesel: '5010-001', hospedaje: '5010-004' },
  ivaAcreditable: '1180-001',
  ivaNoAcreditable: '1180-002',
  gastoNoDeducible: '5990-001',
  gastoPorConfirmar: '5990-002',
  retencionesPorPagar: '2015-001',
  anticipoOperador: '1190-001',
  porCobrarOperador: '1190-002',
  porPagarOperador: '2010-001',
};

let catalogo: unknown = { ok: true, catalogo: CATALOGO_COMPLETO };
vi.mock('@/lib/likida/contabilidad/catalogo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/contabilidad/catalogo')>()),
  catalogoDeclarado: async () => catalogo,
}));
// Un perfil CONTPAQi CONFIRMADO: sin él la ruta contesta 409
// `perfil_erp_sin_confirmar` y nunca llega a armar el archivo — que es
// justamente lo que esta suite viene a ejercitar.
vi.mock('@/lib/likida/contabilidad/perfiles', () => ({
  perfilExportacionDeclarado: async () => ({
    sistema: 'contpaqi' as const,
    confirmadoEn: '2026-08-01T00:00:00.000Z',
    opciones: { tipo: 'Dr', numero: 1, separador: ',', encabezado: undefined },
  }),
}));

/** Lo que la RPC `poliza_datos_tenant` devuelve. */
let filas: unknown[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: async () => ({ data: filas, error: null }) }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async (p: unknown) => p }));

const { GET } = await import('./route');

const URL_POLIZA = 'https://app.likida.ai/api/export/poliza?desde=2026-08-01&hasta=2026-08-24&formato=contpaqi';
const pedir = () => GET(new Request(URL_POLIZA));

/** Una liquidación sana: diésel deducible 3,000 + IVA 480, devuelve 1,520. */
const SANA = {
  liquidacionId: 'l-1', folioViaje: 'VJ-1', operador: 'Juan', fecha: '2026-08-20',
  anticipo: 5000, comprobado: 3480, diferencia: 1520, ivaAcreditable: 480,
  porConcepto: [{ concepto: 'diesel', subtotal: 3000, baseConocida: true }],
  baseDesconocida: 0,
  gastos: [{ id: 'g1', concepto: 'diesel', subtotal: 3000, descuento: null, tieneCfdi: true }],
  diferencias: [],
  retenciones: 0,
};

beforeEach(() => {
  catalogo = { ok: true, catalogo: CATALOGO_COMPLETO };
  filas = [SANA];
  resolverTenantApi.mockResolvedValue({ ok: true as const, tenantId: 'tenant-1', rol: 'contador' });
});

describe('PRU-C1: el export de póliza, ejecutado de verdad', () => {
  it('el camino feliz SALE, con las cuentas que la flota declaró', async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    const txt = await r.text();
    expect(txt).toContain('5010-001');   // la cuenta de diésel declarada
    expect(txt).toContain('1190-001');   // el anticipo que se cancela
  });

  // El freno de `route.ts:182`. Sin esta prueba se podía borrar entero.
  it('una base gravable DESCONOCIDA bloquea, y dice de qué concepto', async () => {
    filas = [{ ...SANA, porConcepto: [{ concepto: 'diesel', subtotal: null, baseConocida: false }] }];
    const r = await pedir();
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toBe('polizas_incompletas');
    expect(JSON.stringify(j.bloqueos)).toContain('diesel');
    expect(JSON.stringify(j.bloqueos)).toMatch(/base gravable/i);
  });

  // El 409 de `route.ts:204`. El otro freno que nadie ejercitaba.
  it('sin la cuenta declarada NO se inventa una: 409 nombrando qué falta', async () => {
    catalogo = { ok: true, catalogo: { ...CATALOGO_COMPLETO, gastos: {} } };
    const r = await pedir();
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(JSON.stringify(j.bloqueos)).toContain('diesel');
  });

  it('un solo folio bloqueado tira el archivo completo — a propósito', async () => {
    filas = [SANA, { ...SANA, folioViaje: 'VJ-2', porConcepto: [{ concepto: 'diesel', subtotal: null, baseConocida: false }] }];
    const r = await pedir();
    // Media póliza importada es peor que ninguna: el contador cuadra a medias
    // y lo que falta no aparece por ningún lado.
    expect(r.status).toBe(409);
  });

  // ── FIS-C1, la regresión que costó el crítico ───────────────────────────
  it('un gasto NO DEDUCIBLE no se asienta en la cuenta de gasto deducible', async () => {
    filas = [{
      ...SANA,
      folioViaje: 'VJ-ND',
      anticipo: 10_000, comprobado: 8000, diferencia: 2000, ivaAcreditable: 0,
      porConcepto: [{ concepto: 'hospedaje', subtotal: 8000, baseConocida: true }],
      gastos: [{ id: 'g9', concepto: 'hospedaje', subtotal: 8000, descuento: null, tieneCfdi: true }],
      diferencias: [{ tipo: 'efectivo_sobre_tope', gastoId: 'g9', concepto: 'hospedaje', monto: 0 }],
    }];
    const r = await pedir();
    expect(r.status).toBe(200);
    const txt = await r.text();
    // Lo que rompía: 5010-004 (hospedaje DEDUCIBLE) cargaba los $8,000.
    expect(txt).not.toContain('5010-004');
    expect(txt).toContain('5990-001');
  });
});
