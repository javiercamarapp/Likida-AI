import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EntregaWhatsApp } from './entrega';
import type { CanalEntrega } from './repo_correo';

// ═══════════════════════════════════════════════════════════════════════════
// LA RED del hallazgo MEDIO (oct-2026): si de todos modos una liquidación de
// canal `correo` llega huérfana (una que entró antes del guardia del endpoint
// general, o por un camino nuevo que alguien olvide proteger), la pasada del
// cron la detecta, la cuenta en el resumen y avisa al operador — en vez de que
// quede estancada en silencio para siempre. Ver `trabajo_huerfana.test.ts` para
// la consulta que cruza tenants, y `route_correo_huerfana.test.ts` para el
// rechazo en el POST que cierra el hueco de raíz.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('./repo', async (orig) => ({
  ...(await orig<typeof import('./repo')>()),
  transicionar: vi.fn(async () => true),
  registrarEvento: vi.fn(async () => undefined),
  leerPorId: vi.fn(async () => null),
  firmarPdfExterno: vi.fn(async () => 'https://firmada'),
}));
let candidatas: Array<{ id: string; tenantId: string; claveExterna: string; creadaEn: string }> = [];
vi.mock('./trabajo', () => ({
  trabajoPendiente: vi.fn(async () => []),
  avisosPendientes: vi.fn(async () => []),
  candidatasHuerfanaCorreo: vi.fn(async () => candidatas),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));

const { procesarLiquidacionesExternas } = await import('./servicio');

const entrega = { enviarConFallback: vi.fn() } as unknown as EntregaWhatsApp;
const base = {
  entrega, ahora: () => new Date('2026-10-20T12:00:00.000Z'), razonSocial: async () => 'Flota SA',
  firmarPdf: async () => 'https://firmada.example/x.pdf', avisarNoCoincide: vi.fn(async () => ({ destinatarios: [], aceptados: [] })),
  formato: async () => null, subirArchivo: async () => undefined, copiarAJefe: vi.fn(async () => ({ estado: 'sin_destinatarios' as const })),
};

beforeEach(() => { candidatas = []; alertarOperador.mockClear(); });

describe('procesarLiquidacionesExternas: la fase de huérfanas de correo', () => {
  it('candidata cuyo tenant resuelve a canal `correo` ⇒ confirmada, contada y avisada', async () => {
    candidatas = [{ id: 'l-1', tenantId: 't-innovativos', claveExterna: 'INNOVATIVOS-R1', creadaEn: '2026-10-20T11:00:00.000Z' }];
    const canalDeEntrega = vi.fn(async (): Promise<CanalEntrega> => 'correo');
    const r = await procesarLiquidacionesExternas({ ...base, canalDeEntrega }, 10);
    expect(r.huerfanasCorreo).toEqual({ candidatas: 1, confirmadas: 1, tenants: ['t-innovativos'] });
    expect(alertarOperador).toHaveBeenCalledTimes(1);
    expect(alertarOperador.mock.calls[0][0]).toBe('liqext.huerfanas_correo');
  });

  it('candidata cuyo tenant resuelve a `whatsapp`/`ambos` NO se acusa huérfana ni se avisa (falso positivo evitado)', async () => {
    candidatas = [{ id: 'l-1', tenantId: 't-normal', claveExterna: 'K-1', creadaEn: '2026-10-20T11:00:00.000Z' }];
    const canalDeEntrega = vi.fn(async (): Promise<CanalEntrega> => 'whatsapp');
    const r = await procesarLiquidacionesExternas({ ...base, canalDeEntrega }, 10);
    expect(r.huerfanasCorreo).toEqual({ candidatas: 1, confirmadas: 0, tenants: [] });
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('el canal se resuelve UNA sola vez por tenant (cacheado dentro de la pasada), aunque haya varias candidatas', async () => {
    candidatas = [
      { id: 'l-1', tenantId: 't-innovativos', claveExterna: 'K-1', creadaEn: 'c' },
      { id: 'l-2', tenantId: 't-innovativos', claveExterna: 'K-2', creadaEn: 'c' },
    ];
    const canalDeEntrega = vi.fn(async (): Promise<CanalEntrega> => 'correo');
    const r = await procesarLiquidacionesExternas({ ...base, canalDeEntrega }, 10);
    expect(r.huerfanasCorreo).toEqual({ candidatas: 2, confirmadas: 2, tenants: ['t-innovativos'] });
    expect(canalDeEntrega).toHaveBeenCalledTimes(1);
  });

  it('sin candidatas, la fase no avisa y el resumen queda en cero', async () => {
    const r = await procesarLiquidacionesExternas(base, 10);
    expect(r.huerfanasCorreo).toEqual({ candidatas: 0, confirmadas: 0, tenants: [] });
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('si la lectura del canal de una candidata falla, no se acusa huérfana sin estar seguros (ni se avisa)', async () => {
    candidatas = [{ id: 'l-1', tenantId: 't-1', claveExterna: 'K-1', creadaEn: 'c' }];
    const canalDeEntrega = vi.fn(async (): Promise<CanalEntrega> => { throw new Error('perfil ilegible'); });
    const r = await procesarLiquidacionesExternas({ ...base, canalDeEntrega }, 10);
    expect(r.huerfanasCorreo).toEqual({ candidatas: 1, confirmadas: 0, tenants: [] });
    expect(alertarOperador).not.toHaveBeenCalled();
  });
});
