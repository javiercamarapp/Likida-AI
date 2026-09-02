import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 19, SEG-19-1 (ALTO) — LA PÓLIZA TAMBIÉN PREGUNTA POR «DINERO».
//
// El encabezado de `export/poliza/route.ts` promete «LOS MISMOS GUARDAS QUE EL
// RESTO DE `export/`, y por la misma razón: aquí sale dinero de una flota».
// Preguntaba `puedeExportar` y nada más. Sus tres hermanas
// —`bitacora-peaje`, `facturas-proveedor`, `liquidaciones`— preguntan las DOS
// cosas, y la que faltaba es justo la que separa las áreas:
//
//   permisos.ts:17    EXPORTA = {superadmin, flota_admin, encargado, contador}
//   visibilidad.ts:41 encargado: ['operacion']        ← NO ve 'dinero'
//
// O sea que el `encargado` —el jefe de tráfico, el rol para el que existe
// `visibilidad.ts`— pasaba el único guarda que había y se bajaba el asiento
// contable completo de su flota: anticipo, IVA acreditable y diferencia de
// cada liquidación del periodo, en el formato que su ERP importa.
//
// La prueba mira el guarda, no el archivo: se corta ANTES de leer catálogo,
// perfil ERP o liquidaciones, así que no depende de que haya datos.
// ═══════════════════════════════════════════════════════════════════════════

const resolverTenantApi = vi.fn(async () => ({
  ok: true as const, tenantId: 'tenant-1', rol: 'encargado' as string,
}));
vi.mock('@/lib/auth/tenant-api', () => ({
  resolverTenantApi: (...a: unknown[]) => resolverTenantApi(...(a as [])),
}));

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => true,
  clientIp: () => '203.0.113.7',
}));

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));

// Si el guarda falla, la ruta seguiría hasta aquí. Estos dobles gritan en vez
// de devolver algo plausible: una fuga que se lee como «no había datos» es
// exactamente el fallo que esta prueba viene a impedir.
const catalogoDeclarado = vi.fn(async () => { throw new Error('EL GUARDA NO CORTÓ: se llegó a leer el catálogo contable'); });
vi.mock('@/lib/likida/contabilidad/catalogo', () => ({
  catalogoDeclarado: (...a: unknown[]) => catalogoDeclarado(...(a as [])),
  CUENTAS_BALANCE: {},
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => { throw new Error('EL GUARDA NO CORTÓ: se llegó a consultar la base'); },
}));

import { GET } from './route';

const URL_POLIZA = 'https://app.likida.ai/api/export/poliza?desde=2026-08-01&hasta=2026-08-24&formato=contpaqi';

describe('/api/export/poliza — el área «dinero» (SEG-19-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('el encargado NO se baja el asiento contable de su flota', async () => {
    resolverTenantApi.mockResolvedValue({ ok: true, tenantId: 'tenant-1', rol: 'encargado' });

    const res = await GET(new Request(URL_POLIZA));

    expect(res.status).toBe(403);
    // Y se cortó ANTES de tocar nada: ni catálogo, ni base.
    expect(catalogoDeclarado).not.toHaveBeenCalled();
  });

  it('el operador tampoco — el guarda de rol que ya existía sigue en pie', async () => {
    resolverTenantApi.mockResolvedValue({ ok: true, tenantId: 'tenant-1', rol: 'operador' });

    const res = await GET(new Request(URL_POLIZA));

    expect(res.status).toBe(403);
    expect(catalogoDeclarado).not.toHaveBeenCalled();
  });

  // Para los dos roles que SÍ deben pasar, la señal de que pasaron es que la
  // ruta llegó a leer el catálogo. El doble lanza, la ruta lo atrapa y
  // contesta 503: 503 aquí significa «el guarda dejó pasar», que es justo lo
  // que hay que comprobar — y es también lo que devolvía el `encargado` antes
  // del arreglo, por eso la prueba de arriba exige 403 y no «no 200».
  it('el contador SÍ pasa los dos guardas: vive del dinero y del papel', async () => {
    resolverTenantApi.mockResolvedValue({ ok: true, tenantId: 'tenant-1', rol: 'contador' });

    const res = await GET(new Request(URL_POLIZA));

    expect(catalogoDeclarado).toHaveBeenCalled();
    expect(res.status).not.toBe(403);
  });

  it('el dueño de la flota también pasa', async () => {
    resolverTenantApi.mockResolvedValue({ ok: true, tenantId: 'tenant-1', rol: 'flota_admin' });

    const res = await GET(new Request(URL_POLIZA));

    expect(catalogoDeclarado).toHaveBeenCalled();
    expect(res.status).not.toBe(403);
  });
});
