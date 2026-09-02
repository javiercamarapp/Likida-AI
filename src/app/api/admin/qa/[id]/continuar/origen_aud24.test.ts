import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, BE-26 — esta ruta y `qa/fotos/ocr` eran las dos POST de
// `admin/qa/*` sin `vieneDeNuestroSitio`; sus hermanas (`qa/lanzar`,
// `qa/fotos` POST y PATCH) sí lo hacían. Autenticada solo por cookie de
// sesión, un sitio ajeno con el superadmin logueado podía arrancar una pasada
// del motor —que gasta modelo— desde un form. `sameSite: lax` lo mitiga, pero
// es una decisión del navegador, no nuestra (ver la cabecera de csrf.ts).
// ═══════════════════════════════════════════════════════════════════════════

const sesionSuperadmin = vi.fn(async () => ({ error: null as Response | null, sesion: { userId: 'u-1' } }));
vi.mock('../../puerta', () => ({ sesionSuperadmin: () => sesionSuperadmin() }));

const ejecutarPasada = vi.fn(async () => ({
  ok: true as const, corrio: true as const, pasada: 1, motivo: 'ok',
  fotosProcesadas: 1, corte: null, terminada: true, avance: null, corrida: null,
}));
vi.mock('@/lib/admin/qa-motor', () => ({ ejecutarPasada: () => ejecutarPasada() }));
vi.mock('@/lib/likida/agentes/runner', () => ({
  conRelojDuro: async (p: Promise<unknown>) => p,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');

const ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const pedir = (cabeceras: Record<string, string>) => POST(
  new Request(`https://app.likida.ai/api/admin/qa/${ID}/continuar`, { method: 'POST', headers: cabeceras }),
  { params: Promise.resolve({ id: ID }) },
);

describe('BE-26 — la puerta de origen de qa/[id]/continuar', () => {
  it('REPRO: desde otro sitio es 403 y el motor NO arranca', async () => {
    ejecutarPasada.mockClear();
    const r = await pedir({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(ejecutarPasada).not.toHaveBeenCalled();
    // Ni siquiera se resuelve la sesión: la puerta va antes.
    expect(sesionSuperadmin).not.toHaveBeenCalled();
  });

  it('desde el panel (same-origin) arranca', async () => {
    ejecutarPasada.mockClear();
    const r = await pedir({ 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(200);
    expect(ejecutarPasada).toHaveBeenCalledTimes(1);
  });

  it('sin cabeceras de navegador (curl, un cron) pasa — no hay CSRF que valga', async () => {
    ejecutarPasada.mockClear();
    const r = await pedir({});
    expect(r.status).toBe(200);
  });
});
