import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32, continuación 5 (26-sep). FIS-C4 / ARQ32C4-C2 (CRÍTICO) — la
// mitad que la continuación 4 dejó PARCIAL: el asiento que el contador sube a
// su ERP.
//
// UNA FUNCIÓN, DOS RESPUESTAS, SEGÚN QUIÉN LA LLAME. `copiasDeComprobante`
// (engine.ts:514) dedupa por emisor desde `790900d`, porque el folio lo numera
// cada estación y se reinicia: dos tickets de $2,500 con folio 1234 de
// gasolineras DISTINTAS son dos comprobantes. La RPC `poliza_datos_tenant`
// armaba su `jsonb` por comprobante con 18 claves y `rfc_emisor` no era
// ninguna, así que `aGasto` no tenía de dónde sacarlo y esta ruta —y sólo
// esta— corría con la regla ANTERIOR a la 0357.
//
// LA CUBETA ES `por_confirmar`, NO LA DE DIÉSEL, y aquí se corrige el hallazgo
// de la c4, que decía «la cubeta de diésel». `cubetaDe` (engine.ts:~470) manda
// a `por_confirmar` todo lo que no trae `cfdiUuid` —un ticket no es una
// factura, LISR 27-III—, y el bug SÓLO puede darse sin CFDI: con UUID el
// dedup toma la rama del UUID y nunca mira el folio. La consecuencia en pesos
// es la misma y es lo que importa: la base de un comprobante real DESAPARECE
// del asiento.
//
// MEDIDO contra Postgres 16.13 con 337 migraciones sobre base virgen
// (`supabase/tests/0361_poliza_dedup_emisor.sql`): la RPC 0342 devolvía
// `gasto[0] ? 'rfcEmisor' = f` sobre las mismas dos filas con las que
// `guardar_liquidacion_tx` (0360) persiste `total_comprobado = 5000.00`.
//
// Lo que este archivo fija, y por qué no puede pasar con el bug puesto:
//   1. Dos estaciones CONOCIDAS y distintas → la base de LAS DOS entra al
//      asiento ($4,310.34). Con `rfcEmisor` fuera de `aGasto` entra una sola.
//   2. El espejo de la 0358, no el de la 0357: la fila SIN emisor hereda el
//      del grupo, así que dos fotos del mismo ticket —una con RFC leído y otra
//      sin él— siguen siendo UNA ($2,155.17). Sin esto, «arreglar» con la
//      llave de la 0357 pasaría el caso 1 y volvería a sumar doble aquí.
//   3. Una RPC anterior a la 0361 NO produce archivo: 409 y dice qué migración
//      falta. Es el mecanismo que arregló FIS-4 en la auditoría 24, cuando
//      producción iba en la 0271 y el asiento daba el 100 % por deducible.
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
  gastos: { diesel: '5010-001', hospedaje: '5010-004', alimentacion: '5020-001', flete: '5030-001' },
  ivaAcreditable: '1180-001',
  ivaNoAcreditable: '1180-002',
  gastoNoDeducible: '5990-001',
  gastoPorConfirmar: '5990-002',
  retencionesPorPagar: '2015-001',
  anticipoOperador: '1190-001',
  porCobrarOperador: '1190-002',
  porPagarOperador: '2010-001',
};
vi.mock('@/lib/likida/contabilidad/catalogo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/contabilidad/catalogo')>()),
  catalogoDeclarado: async () => ({ ok: true, catalogo: CATALOGO_COMPLETO }),
}));
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

/** CONTPAQi (`filasContpaqi`): …,cuenta,0|1,importe,… — 0 = cargo. */
const cargosDe = (txt: string) => {
  const out: Record<string, number> = {};
  for (const fila of txt.split('\n')) {
    const m = /,(\d{4}-\d{3}),(0|1),([0-9]+\.[0-9]{2}),/.exec(fila);
    if (m && m[2] === '0') out[m[1]] = (out[m[1]] ?? 0) + Number(m[3]);
  }
  return out;
};

/**
 * Un ticket de diésel SIN CFDI: $2,500 con base $2,155.17 + IVA $344.83.
 * Sin `cfdiUuid` a propósito — es el único camino donde el dedup mira el folio.
 */
const ticket = (id: string, rfcEmisor: string | null) => ({
  id, concepto: 'diesel', monto: 2500, fecha: '2026-08-10',
  subtotal: 2155.17, descuento: null, tieneCfdi: false, cfdiUuid: null,
  cfdiOrden: null, folio: '1234', folioNorm: '1234', rfcEmisor,
  formaPago: '01', pagadoEn: null, pagadoForma: null,
  ivaRetenido: 0, isrRetenido: 0, ivaTraslado: 344.83, iepsTraslado: 0,
});

/** El periodo, con la forma que la 0361 entrega. */
const periodo = (gastos: unknown[]) => [{
  version: 361, revision: 'aprobada',
  liquidacionId: 'l-361', folioViaje: 'VJ-361', operador: 'Juan', fecha: '2026-08-20',
  anticipo: 10000, comprobado: 5000, diferencia: 5000, ivaAcreditable: 0,
  porConcepto: [{ concepto: 'diesel', subtotal: 4310.34, baseConocida: true }],
  baseDesconocida: 0, gastos, diferencias: [], retenciones: 0,
}];

beforeEach(() => {
  resolverTenantApi.mockResolvedValue({ ok: true as const, tenantId: 'tenant-1', rol: 'contador' });
});

describe('FIS-C4 / ARQ32C4-C2: el asiento del contador dedupa con la MISMA llave que el motor', () => {
  it('dos estaciones distintas y conocidas: la base de LAS DOS entra al asiento (4,310.34)', async () => {
    filas = periodo([ticket('g1', 'ESA030303CC1'), ticket('g2', 'ESB040404DD2')]);
    const r = await pedir();
    expect(r.status).toBe(200);
    const c = cargosDe(await r.text());
    // ROJO con `rfcEmisor` fuera de `aGasto`: 2155.17 — la estación B se marca
    // copia y su base real desaparece del archivo que sube el contador.
    expect(c['5990-002']).toBeCloseTo(4310.34, 2);
  });

  it('el espejo es el de la 0358: la fila SIN emisor hereda el del grupo y sigue siendo UNA (2,155.17)', async () => {
    filas = periodo([ticket('g1', 'ESA030303CC1'), ticket('g2', null)]);
    const r = await pedir();
    expect(r.status).toBe(200);
    const c = cargosDe(await r.text());
    expect(c['5990-002']).toBeCloseTo(2155.17, 2);
  });

  it('un grupo entero sin emisor conserva intacta la regla anterior a la 0357 (2,155.17)', async () => {
    filas = periodo([ticket('g1', null), ticket('g2', null)]);
    const r = await pedir();
    expect(r.status).toBe(200);
    const c = cargosDe(await r.text());
    expect(c['5990-002']).toBeCloseTo(2155.17, 2);
  });

  it('una RPC anterior a la 0361 NO produce archivo: 409 y nombra la migración', async () => {
    const vieja = periodo([ticket('g1', 'ESA030303CC1'), ticket('g2', 'ESB040404DD2')])
      .map(({ gastos, ...f }) => ({
        ...f, version: 342,
        // La forma 0342: 18 claves, `rfcEmisor` entre ellas NO.
        gastos: (gastos as Array<Record<string, unknown>>).map(({ rfcEmisor: _r, ...g }) => { void _r; return g; }),
      }));
    filas = vieja;
    const r = await pedir();
    expect(r.status).toBe(409);
    const cuerpo = JSON.stringify(await r.json());
    expect(cuerpo).toContain('361');
    expect(r.headers.get('content-disposition')).toBeNull();
  });
});
