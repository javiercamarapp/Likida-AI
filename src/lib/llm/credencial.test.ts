import { describe, it, expect, vi, beforeEach } from 'vitest';

// CT-IA-05 (F5): llave del proveedor caída. Aviso al primer 401/402/403, circuito si se repite, sonda sin costo.

const alertar = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: alertar }));

import {
  statusDeCredencial, claseDeStatus, credencialFallo, credencialVerificar, credencialExito, estadoCredencial,
  sondearLlave, _reiniciarCredencial, CredencialLlmCaidaError, FALLOS_PARA_ABRIR_CREDENCIAL, ABIERTO_CREDENCIAL_MS,
} from './credencial';
import { conBreaker, breakerVerificar, _reiniciarBreaker } from './breaker';
import { esFalloDeCredencial } from './openrouter';

const e401 = () => Object.assign(new Error('No auth'), { status: 401 });
const e402 = () => Object.assign(new Error('Insufficient credits'), { status: 402 });
const e403 = () => Object.assign(new Error('moderation'), { status: 403 });
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { _reiniciarBreaker(); _reiniciarCredencial(); alertar.mockClear(); });

describe('clasificación', () => {
  it('lee el status en la cadena de causas y lo traduce a una clase', () => {
    expect(statusDeCredencial(e401())).toBe(401);
    expect(statusDeCredencial(new Error('x', { cause: e402() }))).toBe(402);
    expect(statusDeCredencial(e403())).toBe(403);
    expect(statusDeCredencial(Object.assign(new Error('x'), { status: 429 }))).toBeNull();
    expect(statusDeCredencial(null)).toBeNull();
    expect(statusDeCredencial('401')).toBeNull();
    expect(claseDeStatus(401)).toBe('llave_invalida');
    expect(claseDeStatus(402)).toBe('sin_saldo');
    expect(claseDeStatus(403)).toBe('sin_permiso');
  });
});

describe('aviso y circuito', () => {
  it('el PRIMER 401 avisa al operador; el segundo en la misma racha no repite el aviso desde aquí', async () => {
    credencialFallo(e401(), 'ocr', 1_000);
    await flush();
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledWith('llm.credencial_caida', expect.objectContaining({ clase: 'llave_invalida', status: 401, origen: 'rol:ocr' }));
    credencialFallo(e401(), 'ocr', 2_000);
    await flush();
    expect(alertar).toHaveBeenCalledTimes(1);
  });

  it('un 401 aislado no abre el circuito; dos dentro de la ventana sí, y las llamadas fallan sin red', () => {
    credencialFallo(e401(), 'ocr', 1_000);
    expect(estadoCredencial(1_001).abierto).toBe(false);
    expect(() => credencialVerificar(1_001)).not.toThrow();
    for (let i = 1; i < FALLOS_PARA_ABRIR_CREDENCIAL; i++) credencialFallo(e401(), 'ocr', 2_000);
    expect(estadoCredencial(2_001).abierto).toBe(true);
    expect(() => credencialVerificar(2_001)).toThrow(CredencialLlmCaidaError);
    // pasado el lapso se deja pasar una sonda
    expect(() => credencialVerificar(2_000 + ABIERTO_CREDENCIAL_MS + 1)).not.toThrow();
  });

  it('dos fallos fuera de la ventana no abren', () => {
    credencialFallo(e402(), 'ocr', 1_000);
    credencialFallo(e402(), 'ocr', 200_000);
    expect(estadoCredencial(200_001).abierto).toBe(false);
  });

  it('un 403 avisa pero NUNCA abre el circuito (puede ser de un modelo o de una petición)', async () => {
    for (let i = 0; i < 5; i++) credencialFallo(e403(), 'ocr', 1_000 + i);
    await flush();
    expect(alertar).toHaveBeenCalledWith('llm.credencial_caida', expect.objectContaining({ clase: 'sin_permiso', status: 403 }));
    expect(estadoCredencial(1_010).abierto).toBe(false);
  });

  it('el error del circuito lo reconoce esFalloDeCredencial: el llamador degrada igual que ante el 401 real', () => {
    credencialFallo(e402(), 'x', 1_000); credencialFallo(e402(), 'x', 1_001);
    let err: unknown;
    try { credencialVerificar(1_002); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CredencialLlmCaidaError);
    expect(esFalloDeCredencial(err)).toBe(true);
    expect(String((err as Error).message)).not.toMatch(/sk-/);
  });

  it('un éxito cierra y rearma el aviso', async () => {
    credencialFallo(e401(), 'x', 1_000); credencialFallo(e401(), 'x', 1_001);
    await flush();
    credencialExito();
    expect(estadoCredencial(1_002).abierto).toBe(false);
    credencialFallo(e401(), 'x', 5_000);
    await flush();
    expect(alertar).toHaveBeenCalledTimes(2);
  });

  it('un aviso que revienta no tumba la llamada', async () => {
    alertar.mockRejectedValueOnce(new Error('correo caído'));
    expect(() => credencialFallo(e401(), 'x', 1)).not.toThrow();
    await flush();
  });
});

describe('integrado con conBreaker (los tres caminos de generate* pasan por aquí)', () => {
  it('dos 401 seguidos abren el circuito y la tercera llamada ni siquiera llama a la red', async () => {
    const red = vi.fn(async () => { throw e401(); });
    await conBreaker('ocr', red).catch(() => null);
    await conBreaker('ocr', red).catch(() => null);
    expect(red).toHaveBeenCalledTimes(2);
    await expect(conBreaker('ocr', red)).rejects.toBeInstanceOf(CredencialLlmCaidaError);
    expect(red).toHaveBeenCalledTimes(2);
    expect(() => breakerVerificar('otro-rol')).toThrow(CredencialLlmCaidaError); // la llave es de TODOS los roles
  });

  it('un 429 o un 500 no cuentan como credencial', async () => {
    for (let i = 0; i < 4; i++) await conBreaker('ocr', async () => { throw Object.assign(new Error('x'), { status: 429 }); }).catch(() => null);
    expect(estadoCredencial().abierto).toBe(false);
    expect(alertar).not.toHaveBeenCalled();
  });

  it('un éxito intermedio reinicia la cuenta', async () => {
    await conBreaker('ocr', async () => { throw e401(); }).catch(() => null);
    await conBreaker('ocr', async () => 'ok');
    await conBreaker('ocr', async () => { throw e401(); }).catch(() => null);
    expect(estadoCredencial().abierto).toBe(false);
  });
});

describe('sondearLlave (GET /key, sin costo)', () => {
  const resp = (status: number, cuerpo?: unknown) =>
    ({ status, ok: status >= 200 && status < 300, json: async () => cuerpo }) as unknown as Response;
  const f = (r: Response | Error) => vi.fn(async () => { if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch;

  it('llave buena: ok, devuelve lo que queda y cierra un circuito abierto', async () => {
    credencialFallo(e401(), 'x', 1_000); credencialFallo(e401(), 'x', 1_001);
    const r = await sondearLlave(f(resp(200, { data: { limit_remaining: 12.5 } })), 'k', 1_002);
    expect(r).toEqual({ estado: 'ok', status: 200, restanteUsd: 12.5 });
    expect(estadoCredencial(1_003).abierto).toBe(false);
  });

  it('401 de la sonda: llave inválida, avisa y deja el circuito abierto', async () => {
    const r = await sondearLlave(f(resp(401)), 'k-muerta', 5_000);
    expect(r.estado).toBe('llave_invalida');
    await flush();
    expect(alertar).toHaveBeenCalledWith('llm.credencial_caida', expect.objectContaining({ clase: 'llave_invalida' }));
    expect(estadoCredencial(5_001).abierto).toBe(true);
  });

  it('402 o saldo en cero: sin_saldo', async () => {
    expect((await sondearLlave(f(resp(402)), 'k', 1)).estado).toBe('sin_saldo');
    _reiniciarCredencial();
    expect((await sondearLlave(f(resp(200, { data: { limit_remaining: 0 } })), 'k', 1)).estado).toBe('sin_saldo');
  });

  it('sin llave: sin_llave y avisa; red caída o 5xx: inalcanzable (no se confunde con llave muerta ni abre circuito)', async () => {
    expect((await sondearLlave(f(resp(200)), undefined)).estado).toBe('sin_llave');
    await flush();
    expect(alertar).toHaveBeenCalledTimes(1);
    const [, det] = alertar.mock.calls[0] as unknown as [string, { clase: string; status: number; msg: string }];
    expect(det.clase).toBe('sin_llave');
    expect(det.msg).toContain('Falta OPENROUTER_API_KEY');
    expect(det.msg).not.toContain('rechazó');
    expect(det.msg).not.toContain('401');
    expect((await sondearLlave(f(new Error('ENOTFOUND')), 'k')).estado).toBe('inalcanzable');
    expect((await sondearLlave(f(resp(503)), 'k')).estado).toBe('inalcanzable');
    expect(estadoCredencial().abierto).toBe(false);
  });

  it('200 con cuerpo ilegible sigue siendo llave buena; sin límite (null) no inventa un saldo', async () => {
    const mal = { status: 200, ok: true, json: async () => { throw new Error('no json'); } } as unknown as Response;
    expect(await sondearLlave(f(mal), 'k')).toEqual({ estado: 'ok', status: 200, restanteUsd: null });
    expect((await sondearLlave(f(resp(200, { data: { limit_remaining: null } })), 'k')).restanteUsd).toBeNull();
  });

  it('la sonda no manda la llave a ningún sitio salvo la cabecera hacia OpenRouter', async () => {
    const fx = f(resp(200, {}));
    await sondearLlave(fx, 'sk-or-secreta');
    const [url, init] = (fx as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-secreta');
  });
});
