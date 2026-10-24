import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S51-03 y A37-S51-04: el aviso de peajes a la oficina no se reenvía ni cuando el sello falla después de enviar ni
// cuando el envío quedó en el outbox. Todo sintético.

const estado = { anulado: false, avisoEn: null as string | null, intentos: 0, proveedor: 'Proveedor Uno', periodoDesde: '2026-10-01', periodoHasta: '2026-10-07' };
const sello = vi.fn(async (..._a: unknown[]) => true);
const agotar = vi.fn(async (..._a: unknown[]) => true);
vi.mock('./datos', () => ({
  MAX_INTENTOS_AVISO: 5,
  leerEstadoAvisoDesglose: vi.fn(async () => ({ ...estado })),
  reclamarIntentoAviso: vi.fn(async () => true),
  marcarAvisoEnviado: (...a: unknown[]) => sello(...a),
  agotarIntentosAviso: (...a: unknown[]) => agotar(...a),
  avisosPendientesPeajes: vi.fn(async () => []),
}));
vi.mock('./bitacora_conciliada', () => ({
  bitacoraConciliada: vi.fn(async () => ({ filas: [{ gps: 'no coincide' }], resumen: { sinRespaldo: 1, porVerificar: 0 } })),
}));
vi.mock('../contactos', () => ({ telefonoParaDineroDe: vi.fn(async () => '5215500000000') }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.ejemplo.test' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/meta/aviso_oficina', () => ({ avisarOficina: vi.fn(), parametrosAvisoOficina: (a: string, b: string, c: string) => [a, b, c] }));

const { avisarDesgloseConciliado } = await import('./aviso_oficina');
type Deps = Parameters<typeof avisarDesgloseConciliado>[2];
const avisar = vi.fn();
const deps = { telefono: async () => '5215500000000', avisar } as unknown as Deps;

beforeEach(() => { sello.mockReset(); sello.mockResolvedValue(true); agotar.mockReset(); agotar.mockResolvedValue(true); avisar.mockReset(); });

describe('avisarDesgloseConciliado', () => {
  it('A37-S51-03: si el sello falla después de enviar, se reintenta una vez; si sigue fallando se agotan los intentos (no se reenvía)', async () => {
    avisar.mockResolvedValue({ ok: true, via: 'texto', id: 'w' });
    sello.mockResolvedValue(false);
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('enviado');
    expect(sello).toHaveBeenCalledTimes(2);
    expect(agotar).toHaveBeenCalledWith('t1', 'd1', 5);
  });

  it('A37-S51-03: con el sello bien no se agotan los intentos; un solo fallo del sello se salva con el reintento', async () => {
    avisar.mockResolvedValue({ ok: true, via: 'texto', id: 'w' });
    sello.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('enviado');
    expect(agotar).not.toHaveBeenCalled();
  });

  it('A37-S51-04: un envío no-ok pero ENCOLADO (reintentable o token vencido) se sella como enviado, no se reintenta', async () => {
    for (const r of [{ reintentable: true }, { reintentable: false, encolado: true }]) {
      sello.mockClear();
      avisar.mockResolvedValue({ ok: false, motivo: 'x', codigo: 190, fueraDeVentana: false, ...r });
      expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('enviado');
      expect(sello).toHaveBeenCalledTimes(1);
    }
  });

  it('un rechazo definitivo (ni reintentable ni encolado) sigue siendo «rechazado» y no sella', async () => {
    avisar.mockResolvedValue({ ok: false, motivo: 'número inválido', codigo: 131026, fueraDeVentana: false, reintentable: false });
    expect(await avisarDesgloseConciliado('t1', 'd1', deps)).toBe('rechazado');
    expect(sello).not.toHaveBeenCalled();
  });
});
