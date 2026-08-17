import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DE /api/admin/copiloto — lo que se fija:
//  1. Sin sesión 401, con sesión de otro rol 403, y en ninguno se dice qué
//     hay detrás (una ruta /api no pasa por el layout: es su propia puerta).
//  2. EJECUTAR exige el AdminActionIntent que el SERVIDOR creó al proponer
//     (copiloto-intents.ts): sin intent —el viejo `confirmado: true`
//     incluido—, expirado, ajeno, reusado o con args cambiados → 409/400,
//     sin tocar el ejecutor. El booleano del cliente dejó de ser autoridad.
//  3. La acción corre con el userId DE LA SESIÓN, jamás del cuerpo.
//  4. `gateo: 'doble'` = motivo obligatorio + DOS POSTs con el mismo intent.
// El módulo de intents NO se mockea: estas pruebas ejercitan el ciclo real
// proponer → intent → ejecutar a través del route.
// ═══════════════════════════════════════════════════════════════════════════

let sesion: { userId: string; rol: string } | null = null;
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => sesion }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// El step-up (fase 7): por default pasa (usuario sin factor); cada prueba
// que lo necesite lo aprieta.
const stepUp = vi.fn(async (): Promise<{ ok: true } | { ok: false; motivo: 'verificar' }> => ({ ok: true }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));
vi.mock('@/lib/auth/mfa', () => ({
  exigirAal2SiHayFactor: () => stepUp(),
  MSG_STEP_UP: 'Esta acción exige tu segundo factor',
}));

const ejecutarAccionCopiloto = vi.fn(async (..._a: unknown[]) => ({ ok: true, mensaje: 'hecho' }));
vi.mock('@/lib/agents/copiloto-acciones', () => ({
  ejecutarAccionCopiloto: (...a: unknown[]) => ejecutarAccionCopiloto(...a),
  // El catálogo REAL no se mockea en espíritu: el route solo lee `gateo`
  // para el step-up. Se declara chico y fiel a los ids que estas pruebas usan.
  CATALOGO_ACCIONES: [
    { id: 'apagar_agente', gateo: 'confirma', implementada: true },
    { id: 'correr_runner', gateo: 'confirma', implementada: true },
    { id: 'encender_agente', gateo: 'doble', implementada: false },
  ],
}));
interface RespuestaMock {
  bloques: Array<Record<string, unknown>>;
  toolsUsadas: string[]; costoUsd: number; tokensIn: number; tokensOut: number; modelo: string;
}
const ejecutarCopiloto = vi.fn(async (..._a: unknown[]): Promise<RespuestaMock> => ({
  bloques: [{ tipo: 'texto', texto: 'hola' }], toolsUsadas: [], costoUsd: 0, tokensIn: 0, tokensOut: 0, modelo: 'prueba',
}));
vi.mock('@/lib/agents/copiloto', () => ({
  ejecutarCopiloto: (...a: unknown[]) => ejecutarCopiloto(...a),
}));
const guardarIntercambioCopiloto = vi.fn(async (..._a: unknown[]) => 'conv-guardada');
vi.mock('@/lib/agents/copiloto-historial', () => ({
  guardarIntercambioCopiloto: (...a: unknown[]) => guardarIntercambioCopiloto(...a),
}));

// El freno de turnos (16-ago): mockeado con permiso por default para que la
// puerta y las acciones se prueben sin tropezarse con el limiter local; los
// casos del tope lo ponen en false a propósito.
const rateLimit = vi.fn(async (_k: string, _l: number, _w: number) => true);
vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: [string, number, number]) => rateLimit(...a) }));

const { POST } = await import('./route');
// El MISMO módulo de intents que usa el route (sin mock): crear aquí un
// intent es exactamente lo que hace el camino de proponer.
const { crearIntent, INTENT_TTL_MS, _vaciarIntentsParaPruebas } = await import('@/lib/agents/copiloto-intents');

const pedir = (cuerpo: unknown) => new Request('https://app.likida.ai/api/admin/copiloto', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
});

/** El bloque `accion` que el copiloto (mockeado) propone en estas pruebas. */
const BLOQUE_ACCION = {
  tipo: 'accion', accion: 'apagar_agente', gateo: 'confirma', implementada: true,
  objetivo: 'agente:cobranza', efecto: 'corta la corrida', revertir: 'encender', motivoSugerido: null,
};

/** Corre el camino de PROPONER (el chat) y devuelve el bloque accion del
 *  'fin' — con el intentId que el servidor le acaba de crear. */
async function proponer(): Promise<Record<string, unknown>> {
  ejecutarCopiloto.mockResolvedValueOnce({
    bloques: [{ tipo: 'texto', texto: 'previsualización lista' }, BLOQUE_ACCION],
    toolsUsadas: ['proponer_accion'], costoUsd: 0, tokensIn: 0, tokensOut: 0, modelo: 'prueba',
  });
  const r = await POST(pedir({ mensajes: [{ rol: 'usuario', texto: 'apaga cobranza' }] }));
  const eventos = (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  const fin = eventos[eventos.length - 1] as { bloques: Array<Record<string, unknown>> };
  return fin.bloques.find((b) => b.tipo === 'accion')!;
}

beforeEach(() => {
  sesion = { userId: 'u-javier', rol: 'superadmin' };
  ejecutarAccionCopiloto.mockClear();
  ejecutarCopiloto.mockClear();
  guardarIntercambioCopiloto.mockClear();
  guardarIntercambioCopiloto.mockResolvedValue('conv-guardada');
  _vaciarIntentsParaPruebas();
  stepUp.mockClear();
  stepUp.mockImplementation(async () => ({ ok: true }));
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

describe('la acción con intent (AdminActionIntent)', () => {
  const ACCION = { id: 'apagar_agente', objetivo: 'agente:cobranza', motivo: 'manda de más' };

  it('al PROPONER, el servidor crea el intent: el bloque accion del fin trae intentId', async () => {
    const bloque = await proponer();
    expect(typeof bloque.intentId).toBe('string');
    expect((bloque.intentId as string).length).toBeGreaterThan(0);
  });

  it('el viejo `confirmado: true` sin intent ya NO ejecuta — 409 sin tocar el ejecutor', async () => {
    const r = await POST(pedir({ accion: ACCION, confirmado: true, userId: 'u-atacante' }));
    expect(r.status).toBe(409);
    expect(ejecutarAccionCopiloto).not.toHaveBeenCalled();
  });

  it('con el intent de la propuesta: ejecuta UNA vez, con el userId DE LA SESIÓN', async () => {
    const bloque = await proponer();
    const r = await POST(pedir({ intentId: bloque.intentId, accion: ACCION, userId: 'u-atacante' }));
    expect(r.status).toBe(200);
    expect(ejecutarAccionCopiloto).toHaveBeenCalledTimes(1);
    expect(ejecutarAccionCopiloto).toHaveBeenCalledWith(
      'apagar_agente',
      { id: 'agente:cobranza', motivo: 'manda de más' },
      'u-javier',
    );
  });

  it('REPLAY: el mismo intent dos veces → 409 y una sola ejecución', async () => {
    const bloque = await proponer();
    const r1 = await POST(pedir({ intentId: bloque.intentId, accion: ACCION }));
    expect(r1.status).toBe(200);
    const r2 = await POST(pedir({ intentId: bloque.intentId, accion: ACCION }));
    expect(r2.status).toBe(409);
    const cuerpo = await r2.json() as { error: string };
    expect(cuerpo.error).toContain('pide la acción de nuevo');
    expect(ejecutarAccionCopiloto).toHaveBeenCalledTimes(1);
  });

  it('intent EXPIRADO (2 min) → 409 con instrucción de re-proponer', async () => {
    // Nacido hace TTL+1 ms: el mismo Map real, sin reloj falso.
    const viejo = await crearIntent({
      actorId: 'u-javier', accion: 'apagar_agente', objetivo: 'agente:cobranza',
      gateo: 'confirma', ahoraMs: Date.now() - INTENT_TTL_MS - 1,
    });
    const r = await POST(pedir({ intentId: viejo.id, accion: ACCION }));
    expect(r.status).toBe(409);
    expect(ejecutarAccionCopiloto).not.toHaveBeenCalled();
  });

  it('intent de OTRO actor → 409: la sesión que confirma es la que lo pidió', async () => {
    const ajeno = await crearIntent({
      actorId: 'u-otro-superadmin', accion: 'apagar_agente', objetivo: 'agente:cobranza', gateo: 'confirma',
    });
    const r = await POST(pedir({ intentId: ajeno.id, accion: ACCION }));
    expect(r.status).toBe(409);
    expect(ejecutarAccionCopiloto).not.toHaveBeenCalled();
  });

  it('args CAMBIADOS respecto de la previsualización → 409 sin ejecutar', async () => {
    const bloque = await proponer(); // propuso agente:cobranza
    const r = await POST(pedir({
      intentId: bloque.intentId,
      accion: { id: 'apagar_agente', objetivo: 'agente:proveedores', motivo: 'x' },
    }));
    expect(r.status).toBe(409);
    const cuerpo = await r.json() as { error: string };
    expect(cuerpo.error).toContain('no coincide');
    expect(ejecutarAccionCopiloto).not.toHaveBeenCalled();
  });
});

describe("step-up (fase 7): el 'doble' con factor inscrito exige AAL2", () => {
  it('sesión en AAL1 → 403 con instrucción, SIN gastar el intent', async () => {
    stepUp.mockImplementation(async () => ({ ok: false, motivo: 'verificar' }));
    const i = await crearIntent({ actorId: 'u-javier', accion: 'encender_agente', objetivo: 'agente:cobranza', gateo: 'doble' });
    const r = await POST(pedir({ intentId: i.id, accion: { id: 'encender_agente', objetivo: 'agente:cobranza', motivo: 'x' } }));
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toContain('segundo factor');
    expect(ejecutarAccionCopiloto).not.toHaveBeenCalled();
    // El intent NO se quemó: verificado el factor, el MISMO intent arma.
    stepUp.mockImplementation(async () => ({ ok: true }));
    const r2 = await POST(pedir({ intentId: i.id, accion: { id: 'encender_agente', objetivo: 'agente:cobranza', motivo: 'x' } }));
    expect(r2.status).toBe(200);
  });
});

describe("gateo 'doble' — dos POSTs con el mismo intent, motivo obligatorio", () => {
  const DOBLE = { id: 'encender_agente', objetivo: 'agente:cobranza' };
  const intentDoble = async () => crearIntent({
    actorId: 'u-javier', accion: 'encender_agente', objetivo: 'agente:cobranza', gateo: 'doble',
  });

  it('sin motivo NO se arma: 400 y el ejecutor ni se toca', async () => {
    const i = await intentDoble();
    const r = await POST(pedir({ intentId: i.id, accion: { ...DOBLE, motivo: '  ' } }));
    expect(r.status).toBe(400);
    const cuerpo = await r.json() as { error: string };
    expect(cuerpo.error).toContain('motivo');
    expect(ejecutarAccionCopiloto).not.toHaveBeenCalled();
  });

  it('primer POST ARMA sin ejecutar; el segundo ejecuta con el motivo del armado', async () => {
    const i = await intentDoble();
    const r1 = await POST(pedir({ intentId: i.id, accion: { ...DOBLE, motivo: 'lo pidió el cliente' } }));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ ok: true, armado: true });
    expect(ejecutarAccionCopiloto).not.toHaveBeenCalled();

    const r2 = await POST(pedir({ intentId: i.id, accion: { ...DOBLE, motivo: 'texto cambiado' } }));
    expect(r2.status).toBe(200);
    expect(ejecutarAccionCopiloto).toHaveBeenCalledTimes(1);
    expect(ejecutarAccionCopiloto).toHaveBeenCalledWith(
      'encender_agente',
      { id: 'agente:cobranza', motivo: 'lo pidió el cliente' },
      'u-javier',
    );
  });

  it("las dos acciones vivas ('confirma') siguen ejecutando con UN solo intent", async () => {
    // La declaración del catálogo real: apagar_agente y correr_runner son
    // 'confirma' — el flujo de un POST les basta (el de arriba lo prueba
    // para apagar_agente vía proponer(); aquí correr_runner).
    const i = await crearIntent({ actorId: 'u-javier', accion: 'correr_runner', objetivo: 'runner', gateo: 'confirma' });
    const r = await POST(pedir({ intentId: i.id, accion: { id: 'correr_runner', objetivo: 'runner', motivo: 'adelantar el cron' } }));
    expect(r.status).toBe(200);
    expect(ejecutarAccionCopiloto).toHaveBeenCalledTimes(1);
    expect(ejecutarAccionCopiloto).toHaveBeenCalledWith(
      'correr_runner',
      { id: 'runner', motivo: 'adelantar el cron' },
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
    // El cuerpo se CONSUME (como en los demás casos): la respuesta es un
    // stream y el guardado corre dentro de él — sin leerlo, el aserto
    // llegaría antes que el trabajo.
    const r = await POST(pedir({
      mensajes: [{ rol: 'usuario', texto: 'hola' }],
      conversacionId: "'; drop table copiloto_conversacion; --",
    }));
    await r.text();
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

describe('el freno de gasto (16-ago) — el único camino LLM que no tenía techo', () => {
  it('tope por minuto: 429 y se DICE cuál tope pegó, sin ejecutar el modelo', async () => {
    rateLimit.mockImplementationOnce(async () => false); // el de :min es la primera llamada
    const res = await POST(pedir({ mensajes: [{ rol: 'usuario', texto: 'hola' }] }));
    expect(res.status).toBe(429);
    const cuerpo = await res.json() as { error: string };
    expect(cuerpo.error).toContain('minuto');
    expect(ejecutarCopiloto).not.toHaveBeenCalled();
  });

  it('tope diario de turnos: 429 nombrando el override, sin gastar', async () => {
    rateLimit
      .mockImplementationOnce(async () => true)   // :min pasa
      .mockImplementationOnce(async () => false); // :dia frena
    const res = await POST(pedir({ mensajes: [{ rol: 'usuario', texto: 'hola' }] }));
    expect(res.status).toBe(429);
    const cuerpo = await res.json() as { error: string };
    expect(cuerpo.error).toContain('LIKIDA_COPILOTO_TOPE_TURNOS_DIA');
    expect(ejecutarCopiloto).not.toHaveBeenCalled();
  });

  it('el freno cuenta por userId de SESIÓN — la llave no sale del cuerpo', async () => {
    rateLimit.mockClear();
    await POST(pedir({ mensajes: [{ rol: 'usuario', texto: 'hola' }] }));
    const llaves = rateLimit.mock.calls.map((c) => c[0]);
    expect(llaves).toContain('copiloto:min:u-javier');
    expect(llaves).toContain('copiloto:dia:u-javier');
  });
});
