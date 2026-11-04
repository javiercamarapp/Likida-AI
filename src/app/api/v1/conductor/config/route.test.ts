import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT } from '@/lib/likida/conductor/config';

// PUT /v1/conductor/config (MX-007 / API04-01): debe pasar por el MISMO preflight que el panel al ENCENDER la señal de vida
// y dejar bitácora con quien firma (la llave). El guardado en dos pasos config+contactos (API04-02) sigue sin transacción:
// requiere una RPC nueva (migración, F1 lote B).

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion', llaveId: 'a1b2c3d4-0000-4000-8000-000000000000' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => ({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin' }) }));

let actual = { ...CONFIG_CONDUCTOR_DEFAULT };
const leerConfigConductor = vi.fn(async (..._a: unknown[]) => actual);
const cargarContactosTrafico = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const guardarConfigConductor = vi.fn(async (..._a: unknown[]): Promise<string> => 'ok');
vi.mock('@/lib/likida/conductor/repo', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/conductor/repo')>()),
  leerConfigConductor: (...a: unknown[]) => leerConfigConductor(...a),
  cargarContactosTrafico: (...a: unknown[]) => cargarContactosTrafico(...a),
  guardarConfigConductor: (...a: unknown[]) => guardarConfigConductor(...a),
}));
const preflightReal = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ lista: true }));
vi.mock('@/lib/likida/conductor/acciones_config', () => ({ preflightReal: (...a: unknown[]) => preflightReal(...a) }));
const anotarBitacora = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/likida/bitacora_escritura', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/bitacora_escritura')>()),
  anotarBitacora: (...a: unknown[]) => anotarBitacora(...a),
}));

const ruta = await import('./route');
const put = (cuerpo: unknown) => ruta.PUT(new Request('https://app.likida.ai/api/v1/conductor/config', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
}));

beforeEach(() => {
  [abrir, leerConfigConductor, cargarContactosTrafico, guardarConfigConductor, preflightReal, anotarBitacora].forEach((f) => f.mockClear());
  actual = { ...CONFIG_CONDUCTOR_DEFAULT, avisarSenalVida: false };
  leerConfigConductor.mockImplementation(async () => actual);
  guardarConfigConductor.mockResolvedValue('ok');
  preflightReal.mockResolvedValue({ lista: true });
});

describe('PUT /v1/conductor/config', () => {
  it('un cambio cualquiera guarda y deja bitácora firmada por la llave, sin teléfonos', async () => {
    const r = await put({ solicitudesMin: [10, 20] });
    expect(r.status).toBe(200);
    expect(guardarConfigConductor).toHaveBeenCalledTimes(1);
    expect(anotarBitacora).toHaveBeenCalledTimes(1);
    const e = anotarBitacora.mock.calls[0][0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(e).toMatchObject({ tenantId: 't-1', accion: 'conductor.config_guardada', entidad: 'conductor_config', actor: { email: 'llave-api:a1b2c3d4' } });
    expect(JSON.stringify(e.detalle)).not.toMatch(/\d{10}/);
    expect(preflightReal).not.toHaveBeenCalled();
  });

  it('ENCENDER la señal de vida con el preflight bloqueado: 409, no se guarda nada y no hay bitácora', async () => {
    preflightReal.mockResolvedValue({ lista: false, bloqueos: [{ id: 'plantillas', titulo: 'Plantillas aprobadas', queHacer: 'Somete las plantillas a Meta.' }] });
    const r = await put({ avisarSenalVida: true });
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).toContain('Aún no se puede encender');
    expect(guardarConfigConductor).not.toHaveBeenCalled();
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('ENCENDER la señal de vida con el preflight limpio guarda y anota', async () => {
    const r = await put({ avisarSenalVida: true });
    expect(r.status).toBe(200);
    expect(preflightReal).toHaveBeenCalledTimes(1);
    expect(guardarConfigConductor).toHaveBeenCalledTimes(1);
    expect(anotarBitacora).toHaveBeenCalledTimes(1);
  });

  it('si ya estaba encendida, guardar otro cambio NO vuelve a pasar por la compuerta', async () => {
    actual = { ...actual, avisarSenalVida: true };
    const r = await put({ avisarSenalVida: true, solicitudesMin: [10, 20] });
    expect(r.status).toBe(200);
    expect(preflightReal).not.toHaveBeenCalled();
  });
});
