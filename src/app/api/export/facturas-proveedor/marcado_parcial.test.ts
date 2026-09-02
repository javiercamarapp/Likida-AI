import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, BE-8 — cuando el marcado de `exportada_en` falla, el archivo
// sale igual (así debe ser: la descarga no se tumba por no poder anotar), pero
// el aviso vivía SOLO en `agente_corrida`. Quien descarga el CSV no abre la
// bitácora del agente: veía un 200 con archivo, lo importaba al ERP, y como
// las facturas seguían «sin exportar» las volvía a importar — mismo CFDI, mismo
// UUID, gasto de proveedor duplicado en la contabilidad de la flota.
// La advertencia tiene que viajar DENTRO del archivo.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => ({ ok: true, tenantId: 't-1', rol: 'flota_admin' }) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const corrida = vi.fn(async (_t: string, _a: string, _d: Record<string, unknown>) => {});
vi.mock('@/lib/likida/agentes/corridas', () => ({
  registrarCorrida: (t: string, a: string, d: Record<string, unknown>) => corrida(t, a, d),
}));

let marca: { error?: string; marcadas: number } = { marcadas: 3 };
vi.mock('@/lib/likida/proveedores', () => ({
  exportarAprobadas: async () => ({
    filas: [{ uuid: 'u-1' }, { uuid: 'u-2' }, { uuid: 'u-3' }],
    ids: ['f-1', 'f-2', 'f-3'],
  }),
  marcarExportadas: async () => marca,
}));

const { GET } = await import('./route');
const pedir = () => GET(new Request('https://app.likida.ai/api/export/facturas-proveedor'));

beforeEach(() => { corrida.mockClear(); marca = { marcadas: 3 }; });

describe('BE-8 — el CSV dice cuando no se pudo marcar lo exportado', () => {
  it('REPRO: marcado caído ⇒ la PRIMERA línea del archivo lo advierte y nombra cuántas', async () => {
    marca = { error: '414 URI Too Long', marcadas: 1 };

    const r = await pedir();
    const csv = await r.text();

    expect(r.status).toBe(200); // el archivo sale: no se tumba una descarga por no poder anotar
    const primera = csv.split('\n')[0];
    expect(primera.startsWith('#')).toBe(true);
    expect(primera).toContain('2 de 3');
    expect(primera).toContain('NO las vuelvas a importar');
    // y el cuerpo sigue completo debajo del aviso
    expect(csv).toContain('u-1');
    expect(csv).toContain('u-3');
  });

  it('marcado bueno: el archivo NO lleva línea de aviso y la corrida es `ok`', async () => {
    const r = await pedir();
    const csv = await r.text();

    expect(csv.startsWith('#')).toBe(false);
    expect(corrida).toHaveBeenCalledWith('t-1', 'proveedores', expect.objectContaining({ estado: 'ok', tareasHechas: 3 }));
  });

  it('la corrida cuenta como hechas SOLO las que se alcanzaron a marcar', async () => {
    marca = { error: '414 URI Too Long', marcadas: 1 };

    await pedir();

    expect(corrida).toHaveBeenCalledWith('t-1', 'proveedores', expect.objectContaining({ estado: 'parcial', tareasHechas: 1, tareasTotal: 3 }));
  });
});
