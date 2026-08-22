import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · ESC-14 — 16 MB prometidos contra 4.5 reales.
//
// El lector de archivos del chat aceptaba ~12 MB (16 MB en base64). El cuerpo
// de una función serverless de Vercel se corta en 4.5 MB, en la plataforma:
// todo lo que pasara de ahí moría con un 413 ajeno, sin nuestro texto y sin
// log, mientras el número de este archivo prometía doce megas. Y el xlsx se
// arma ENTERO en memoria, así que el tope también protege la invocación.
//
// De paso, esta ruta no tenía NINGUNA prueba: la puerta (sesión + área
// dinero) es lo primero que se fija aquí — es alcanzable por POST directo
// porque el proxy no cubre /api.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; tenantId: string | null; rol: string; nombre: string } | null = null;
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerArea: (rol: string) => rol !== 'operador' }));

const leer = vi.fn(async () => ({ clase: 'excel', extracto: 'A1: 100', meta: [] as Array<[string, string]> }));
vi.mock('@/lib/likida/intake/archivo', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, leerArchivoUniversal: (...a: unknown[]) => leer(...(a as [])) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST, MAX_BASE64 } = await import('./route');

function postear(cuerpo: unknown) {
  return POST(new Request('https://app.likida.ai/api/dashboard/archivo', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  }) as never);
}

beforeEach(() => {
  sesion = { userId: 'u-1', tenantId: 't-1', rol: 'contador', nombre: 'C' };
  leer.mockClear();
});

describe('la puerta', () => {
  it('sin sesión: 401 y no se lee nada', async () => {
    sesion = null;
    expect((await postear({ nombre: 'a.csv', contenido: 'x' })).status).toBe(401);
    expect(leer).not.toHaveBeenCalled();
  });

  it('sin área de dinero: 403 — el archivo del contralor trae montos', async () => {
    sesion = { userId: 'u-2', tenantId: 't-1', rol: 'operador', nombre: 'O' };
    expect((await postear({ nombre: 'a.csv', contenido: 'x' })).status).toBe(403);
    expect(leer).not.toHaveBeenCalled();
  });
});

describe('el tope cabe DENTRO del límite real de Vercel (ESC-14)', () => {
  const LIMITE_VERCEL = 4.5 * 1024 * 1024;

  it('lo que esta ruta acepta siempre llega a esta ruta', () => {
    expect(MAX_BASE64).toBeLessThan(LIMITE_VERCEL);
    expect(MAX_BASE64).toBeLessThanOrEqual(LIMITE_VERCEL - 400_000);
  });

  it('un archivo por encima del tope: 413, con nuestras palabras y sin armar el xlsx en memoria', async () => {
    const r = await postear({ nombre: 'gordo.xlsx', contenido: `data:application/vnd.ms-excel;base64,${'A'.repeat(MAX_BASE64 + 1)}` });
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/parte que importa|hoja|rango/i);
    expect(leer).not.toHaveBeenCalled();
  });

  it('CONTROL — uno normal sí se lee', async () => {
    const r = await postear({ nombre: 'chico.csv', contenido: 'data:text/csv;base64,QUJD' });
    expect(r.status).toBe(200);
    expect(leer).toHaveBeenCalled();
  });
});
