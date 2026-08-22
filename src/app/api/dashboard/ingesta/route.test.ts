import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA SONDA DE INGESTA GASTA VISIÓN — lo que se fija (AUDITORÍA 18, A6/A25):
//  · sin sesión 401; sin área 'dinero' 403 — y en ninguno se toca el modelo.
//  · rateLimit por usuario: excedido → 429 sin llamar al modelo.
//  · tope diario por tenant: agotado → 429; no se pudo leer → 503. Las dos
//    ramas fallan CERRADO: jamás se gasta sin saber cuánto se lleva.
//  · cada lectura deja su fila en `llm_costo` (fase ocr, sin viaje) — es la
//    cifra que el tablero de costo de IA suma y la que el tope lee.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; tenantId: string | null; rol: string; nombre: string } | null = null;
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerArea: (rol: string) => rol !== 'operador' }));

const extraer = vi.fn(async () => ({
  legible: true, gasto: { concepto: 'diesel', monto: 1500 },
  costo: { modelo: 'vision-x', tokensIn: 900, tokensOut: 80, costoUsd: 0.0123 },
}));
vi.mock('@/lib/likida/intake/ocr', () => ({ extraerComprobante: (...a: unknown[]) => extraer(...(a as [])) }));

const registrarCosto = vi.fn(async (_c: unknown) => { void _c; });
vi.mock('@/lib/likida/costos', () => ({ registrarCosto: (c: unknown) => registrarCosto(c as never) }));

let permitido = true;
const rateLimit = vi.fn(async () => permitido);
vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }));

let gastado: number | 'error' = 0;
vi.mock('./tope', () => ({
  topeSondaDiaUsd: () => 1.0,
  SONDAS_POR_MINUTO: 10,
  gastoSondaHoyUsd: async () => { if (gastado === 'error') throw new Error('base caída'); return gastado; },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');

const IMG = 'data:image/png;base64,AAAA';
function postear(cuerpo: unknown = { imagen: IMG }) {
  return POST(new Request('https://app.likida.ai/api/dashboard/ingesta', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  }) as never);
}

beforeEach(() => {
  sesion = { userId: 'u-1', tenantId: 't-1', rol: 'contador', nombre: 'C' };
  permitido = true; gastado = 0;
  extraer.mockClear(); registrarCosto.mockClear(); rateLimit.mockClear();
});

describe('la puerta', () => {
  it('sin sesión: 401; sin área dinero: 403 — sin tocar el modelo', async () => {
    sesion = null;
    expect((await postear()).status).toBe(401);
    sesion = { userId: 'u-1', tenantId: 't-1', rol: 'operador', nombre: 'O' };
    expect((await postear()).status).toBe(403);
    expect(extraer).not.toHaveBeenCalled();
  });

  it('rateLimit por USUARIO: excedido → 429 y el modelo no se llama', async () => {
    permitido = false;
    expect((await postear()).status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith('ingesta:u-1', 10, 60_000);
    expect(extraer).not.toHaveBeenCalled();
  });
});

describe('el tope diario', () => {
  it('agotado: 429 con agotado:true, sin gastar', async () => {
    gastado = 1.0;
    const r = await postear();
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ agotado: true });
    expect(extraer).not.toHaveBeenCalled();
  });

  it('si no se pudo leer el gasto: 503 — fallar CERRADO, no "será $0"', async () => {
    gastado = 'error';
    expect((await postear()).status).toBe(503);
    expect(extraer).not.toHaveBeenCalled();
  });
});

describe('la contabilidad', () => {
  it('cada lectura deja su fila en llm_costo: fase ocr, sin viaje, con el modelo real', async () => {
    const r = await postear();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ legible: true, campos: { concepto: 'diesel', monto: 1500 } });
    expect(registrarCosto).toHaveBeenCalledTimes(1);
    expect(registrarCosto).toHaveBeenCalledWith({
      tenantId: 't-1', viajeId: null, fase: 'ocr', modelo: 'vision-x',
      tokensIn: 900, tokensOut: 80, costoUsd: 0.0123,
    });
  });

  it('el modelo truena: 502 y sin fila (no hubo costo que registrar)', async () => {
    extraer.mockRejectedValueOnce(new Error('timeout'));
    expect((await postear()).status).toBe(502);
    expect(registrarCosto).not.toHaveBeenCalled();
  });
});
