import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVIDAD DE CÓDIGO — los estados honestos:
//  · Sin GITHUB_TOKEN no se afirma nada (repo privado). 202 de GitHub = está
//    calculando, se dice. Error = se dice — jamás un heatmap vacío con cara
//    de "nadie trabajó".
//  · El camino feliz suma el total anual y recorta los commits recientes.
// ═══════════════════════════════════════════════════════════════════════════

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const { getActividadCodigo } = await import('./actividad-codigo');

const envAntes = process.env.GITHUB_TOKEN;
beforeEach(() => { fetchMock.mockReset(); process.env.GITHUB_TOKEN = 'tok'; });
afterEach(() => {
  if (envAntes === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = envAntes;
});

describe('los estados honestos', () => {
  it('sin token: sin_token y CERO fetch — no se afirma nada del repo privado', async () => {
    delete process.env.GITHUB_TOKEN;
    expect(await getActividadCodigo()).toEqual({ estado: 'sin_token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GitHub calculando (202) se dice; un error HTTP se dice con su código', async () => {
    fetchMock.mockResolvedValueOnce({ status: 202, ok: false } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    expect(await getActividadCodigo()).toEqual({ estado: 'calculando' });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({ status: 403, ok: false } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const r = await getActividadCodigo();
    expect(r.estado).toBe('error');
    if (r.estado === 'error') expect(r.detalle).toContain('403');
  });

  it('el camino feliz: total anual sumado y commits recortados a una línea', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ([
        { week: 1700000000, days: [1, 0, 2, 0, 0, 0, 0], total: 3 },
        { week: 1700604800, days: [0, 5, 0, 0, 0, 0, 0], total: 5 },
      ]) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ([
        { sha: 'abcdef1234567', commit: { message: 'feat: algo\n\ncuerpo largo', author: { name: 'Claude', date: '2026-08-16T12:00:00Z' } } },
      ]) } as Response);
    const r = await getActividadCodigo();
    expect(r.estado).toBe('ok');
    if (r.estado === 'ok') {
      expect(r.totalAnual).toBe(8);
      expect(r.recientes[0]).toMatchObject({ sha: 'abcdef1', mensaje: 'feat: algo' });
    }
  });

  it('la red caída se dice como error, no como cero commits', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    const r = await getActividadCodigo();
    expect(r.estado).toBe('error');
  });
});
