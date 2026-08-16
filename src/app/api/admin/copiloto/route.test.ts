import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DE /api/admin/copiloto — lo que se fija:
//  1. Sin sesión 401, con sesión de otro rol 403, y en ninguno se dice qué
//     hay detrás (una ruta /api no pasa por el layout: es su propia puerta).
//  2. Una acción SIN `confirmado: true` se rechaza EN EL SERVIDOR — la
//     confirmación del cliente no es decorativa (diseño §5.3).
//  3. La acción confirmada corre con el userId DE LA SESIÓN, jamás del cuerpo.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; rol: string } | null = null;
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const ejecutarAccionCopiloto = vi.fn(async (..._a: unknown[]) => ({ ok: true, mensaje: 'hecho' }));
vi.mock('@/lib/agents/copiloto-acciones', () => ({
  ejecutarAccionCopiloto: (...a: unknown[]) => ejecutarAccionCopiloto(...a),
}));
const ejecutarCopiloto = vi.fn(async (..._a: unknown[]) => ({
  bloques: [{ tipo: 'texto', texto: 'hola' }], toolsUsadas: [], costoUsd: 0, tokensIn: 0, tokensOut: 0, modelo: 'prueba',
}));
vi.mock('@/lib/agents/copiloto', () => ({
  ejecutarCopiloto: (...a: unknown[]) => ejecutarCopiloto(...a),
}));
const guardarIntercambioCopiloto = vi.fn(async (..._a: unknown[]) => 'conv-guardada');
vi.mock('@/lib/agents/copiloto-historial', () => ({
  guardarIntercambioCopiloto: (...a: unknown[]) => guardarIntercambioCopiloto(...a),
}));

const { POST } = await import('./route');

const pedir = (cuerpo: unknown) => new Request('https://app.likida.ai/api/admin/copiloto', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
});

beforeEach(() => {
  sesion = { userId: 'u-javier', rol: 'superadmin' };
  ejecutarAccionCopiloto.mockClear();
  ejecutarCopiloto.mockClear();
  guardarIntercambioCopiloto.mockClear();
  guardarIntercambioCopiloto.mockResolvedValue('conv-guardada');
});

describe('la puerta', () => {
  it('sin sesión: 401 sin cuerpo', async () => {
    sesion = null;
    const r = await POST(pedir({ mensajes: [{ rol: 'usuario', texto: 'hola' }] }));
    expect(r.status).toBe(401);
    expect(ejecutarCopiloto).not.toHaveBeenCalled();
  });

  it('con sesión de flota_admin: 403 — el copiloto es SOLO del superadmin', async () => {
    sesion = { userId: 'u-cliente', rol: 'flota_admin' };
    const r = await POST(pedir({ mensajes: [{ rol: 'usuario', texto: 'hola' }] }));
    expect(r.status).toBe(403);
    expect(ejecutarCopiloto).not.toHaveBeenCalled();
  });
});

describe('la acción confirmada', () => {
  it('SIN confirmado:true el servidor la rechaza — el botón del cliente no es la frontera', async () => {
    const r = await POST(pedir({ accion: { id: 'apagar_agente', objetivo: 'agente:cobranza', motivo: 'x' } }));
    expect(r.status).toBe(400);
    expect(ejecutarAccionCopiloto).not.toHaveBeenCalled();
  });

  it('confirmada, corre con el userId DE LA SESIÓN — un userId en el cuerpo no pinta', async () => {
    const r = await POST(pedir({
      accion: { id: 'apagar_agente', objetivo: 'agente:cobranza', motivo: 'manda de más' },
      confirmado: true,
      userId: 'u-atacante',
    }));
    expect(r.status).toBe(200);
    expect(ejecutarAccionCopiloto).toHaveBeenCalledWith(
      'apagar_agente',
      { id: 'agente:cobranza', motivo: 'manda de más' },
      'u-javier',
    );
  });
});

describe('el chat', () => {
  it('mensajes válidos: corre el copiloto y el stream termina con los bloques', async () => {
    const r = await POST(pedir({ mensajes: [{ rol: 'usuario', texto: '¿qué espera decisión hoy?' }] }));
    expect(r.status).toBe(200);
    const texto = await r.text();
    const eventos = texto.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(eventos[eventos.length - 1]).toMatchObject({ t: 'fin' });
    expect(ejecutarCopiloto).toHaveBeenCalledTimes(1);
  });

  it('mensajes malformados: 400 sin gastar en el modelo', async () => {
    const r = await POST(pedir({ mensajes: [{ rol: 'asistente', texto: 'yo primero' }] }));
    expect(r.status).toBe(400);
    expect(ejecutarCopiloto).not.toHaveBeenCalled();
  });
});

describe('el historial (0121)', () => {
  const UUID = '11111111-2222-3333-4444-555555555555';

  it('el intercambio se persiste con el userId DE LA SESIÓN y el fin trae el id', async () => {
    const r = await POST(pedir({
      mensajes: [{ rol: 'usuario', texto: '¿qué espera decisión hoy?' }],
      conversacionId: UUID,
    }));
    const eventos = (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(eventos[eventos.length - 1]).toMatchObject({ t: 'fin', conversacionId: 'conv-guardada' });
    expect(guardarIntercambioCopiloto).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u-javier',
      conversacionId: UUID,
      pregunta: '¿qué espera decisión hoy?',
    }));
  });

  it('un conversacionId basura viaja como null (conversación nueva), no a la base', async () => {
    await POST(pedir({
      mensajes: [{ rol: 'usuario', texto: 'hola' }],
      conversacionId: "'; drop table copiloto_conversacion; --",
    }));
    expect(guardarIntercambioCopiloto).toHaveBeenCalledWith(expect.objectContaining({ conversacionId: null }));
  });

  it('si guardar revienta, la respuesta IGUAL sale — el historial es comodidad', async () => {
    guardarIntercambioCopiloto.mockRejectedValueOnce(new Error('base caída'));
    const r = await POST(pedir({ mensajes: [{ rol: 'usuario', texto: 'hola' }] }));
    const eventos = (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    const fin = eventos[eventos.length - 1];
    expect(fin.t).toBe('fin');
    expect(fin.bloques).toEqual([{ tipo: 'texto', texto: 'hola' }]);
    expect(fin.conversacionId).toBeNull();
  });
});
