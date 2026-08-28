import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// EL RUNNER NIVEL 2 (0123) — los cuatro candados, todos fail-closed:
//  · Global abajo = no corre nada. Agente sin kill switch declarado = no
//    corre. Interruptor ilegible = no corre.
//  · Sin techo declarado NO hay autonomía; techo agotado o gasto ilegible,
//    tampoco.
//  · Backpressure: bandeja llena = no se fabrica encima.
//  · El lote corta por piezas y por presupuesto, y un prospecto que rebota
//    en las guardas NO tumba el lote.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data?: unknown; error?: { message: string } | null; count?: number }>>();
const llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, not: () => b, gte: () => b, order: () => b,
    limit: () => b, range: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({
  from: (t: string) => builder(t),
  rpc: (fn: string, args: Record<string, unknown>) => {
    llamadasRpc.push({ fn, args });
    const cola = respuestas.get(`rpc:${fn}`);
    return Promise.resolve(cola && cola.length ? cola.shift()! :
      (fn === 'reservar_presupuesto_agente'
        ? { data: [{ id: 'reserva-1', disponible_usd: 1 }], error: null }
        : { data: true, error: null }));
  },
}) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

let apagados = new Set<string>();
let interruptorFalla = false;
vi.mock('../interruptores', () => ({
  INTERRUPTORES: ['global', 'agente:redactor', 'agente:kpi_whatsapp',
    'agente:vigilante_calidad', 'agente:documentacion', 'agente:legal_compliance', 'agente:talento',
    'agente:onboarding_cliente', 'agente:atencion_faq',
    // Los dos de abajo solo los usan las pruebas del reloj (25-ago-2026):
    // el corte necesita TRES agentes deterministas seguidos para que haya un
    // «antes del tercero» que verificar.
    'agente:exito_cliente', 'agente:soporte',
    // Crecimiento (0230): el que gasta modelo y dos deterministas.
    'agente:contenido_fiscal', 'agente:lead_magnet', 'agente:promos_diarias'],
  estaApagado: async (n: string) => {
    if (interruptorFalla && n !== 'global') throw new Error('base caída');
    return apagados.has(n);
  },
}));

const redactar = vi.fn(async (..._a: unknown[]) => ({ piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0.001 }));
vi.mock('./redactor', () => ({ redactarCorreoFrio: (...a: unknown[]) => redactar(...a) }));

// El motor de dirección (0216) se despacha por import dinámico; el mock
// aplica igual y evita arrastrar los lectores reales de /admin.
const correrDireccion = vi.fn(async (_a: unknown) => ({ resultado: 'corrio' as const, piezas: 1, costoUsd: 0 }));
vi.mock('../direccion/reportes', () => ({ correrAgenteDireccion: (...a: unknown[]) => correrDireccion(...(a as [unknown])) }));

// El back office restante (0219) entra por el mismo camino: import dinámico
// dentro de su rama. El predicado NO se mockea — es la lista real del motor
// contra la que se compara la literal del runner.
const correrBackOffice = vi.fn(async (_a: unknown) => ({ piezas: 1 }));
const { AGENTES_BACK_OFFICE, esAgenteBackOffice } = await import('./backoffice');
vi.mock('./backoffice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backoffice')>()),
  correrAgenteBackOffice: (...a: unknown[]) => correrBackOffice(...(a as [unknown])),
}));

// Éxito del cliente (0218): mismo trato que dirección — import dinámico en el
// runner, mock aquí, y así la vuelta no arrastra los lectores de /admin ni el
// corpus de normas.
const correrExito = vi.fn(async (..._a: unknown[]) => ({ resultado: 'corrio' as const, piezas: 1, costoUsd: 0 }));
vi.mock('./exito', () => ({ correrAgenteExito: (...a: unknown[]) => correrExito(...a) }));

// Crecimiento (0230): mismo trato que el back office — import dinámico en el
// runner y el predicado REAL (no mockeado), que es contra el que se compara la
// lista literal del despacho. Mockear el motor evita arrastrar la calculadora
// y el índice de normas a esta suite.
const correrCrecimiento = vi.fn(async (..._a: unknown[]) => ({ resultado: 'corrio' as const, piezas: 1, costoUsd: 0 }));
const { AGENTES_CRECIMIENTO, esAgenteCrecimiento } = await import('./crecimiento');
vi.mock('./crecimiento', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./crecimiento')>()),
  correrAgenteCrecimiento: (...a: unknown[]) => correrCrecimiento(...a),
}));

const { correrRunner, ordenarPorCosto, llamaAlModelo, MARGEN_RELOJ_MS, PLAZO_RUNNER_MS } = await import('./runner');

const REDACTOR = { id: 'redactor', presupuesto_dia_usd: 1.0 };
const TENANT = 'tenant-runner-test';

beforeEach(() => {
  respuestas.clear();
  llamadasRpc.length = 0;
  apagados = new Set();
  interruptorFalla = false;
  redactar.mockClear();
  redactar.mockResolvedValue({ piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0.001 });
  correrDireccion.mockClear();
  correrDireccion.mockResolvedValue({ resultado: 'corrio', piezas: 1, costoUsd: 0 });
  correrBackOffice.mockClear();
  correrBackOffice.mockResolvedValue({ piezas: 1 });
  correrExito.mockClear();
  correrExito.mockResolvedValue({ resultado: 'corrio', piezas: 1, costoUsd: 0 });
  correrCrecimiento.mockClear();
  correrCrecimiento.mockResolvedValue({ resultado: 'corrio', piezas: 1, costoUsd: 0 });
});

describe('los cuatro candados', () => {
  it('global abajo: no corre nada y se dice', async () => {
    apagados.add('global');
    const r = await correrRunner(undefined, TENANT);
    expect(r.apagadoGlobal).toBe(true);
    expect(redactar).not.toHaveBeenCalled();
  });

  it('un agente habilitado SIN kill switch declarado no corre — inapagable = inexistente', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'fantasma', presupuesto_dia_usd: 1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0]).toMatchObject({ agente: 'fantasma', resultado: 'saltado' });
    expect(r.agentes[0].motivo).toMatch(/kill switch/);
  });

  it('interruptor apagado o ILEGIBLE: no corre (fail closed)', async () => {
    apagados.add('agente:redactor');
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    let r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toMatch(/apagado/);

    apagados.clear();
    interruptorFalla = true;
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toMatch(/fail closed/);
    expect(redactar).not.toHaveBeenCalled();
  });

  it('sin techo declarado NO hay autonomía; techo agotado tampoco', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'redactor', presupuesto_dia_usd: null }], error: null }]);
    let r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toMatch(/sin presupuesto/);

    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].resultado).toBe('corrio');
    expect(redactar).not.toHaveBeenCalled();
  });

  it('sin tenant explícito, la corrida es de PLATAFORMA (c5-10): gasto medido vs techo, y el lote corre', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('agente_corrida', [{ data: [{ costo_usd: 0.01 }], error: null }]);   // gasto del día
    respuestas.set('prospecto', [{ data: [{ id: 'pr-1', vendedor: null }], error: null }]);
    const r = await correrRunner();
    expect(r.agentes[0].resultado).toBe('corrio');
    // El redactor recibió el contexto de plataforma, no un tenant inventado.
    expect(redactar).toHaveBeenCalledWith('pr-1', 'Javier', 'cron', { plataforma: true });
  });

  it('plataforma con el techo diario ya gastado: saltado con el motivo (c5-10)', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('agente_corrida', [{ data: [{ costo_usd: 99 }], error: null }]);
    const r = await correrRunner();
    expect(r.agentes[0].resultado).toBe('saltado');
    expect(r.agentes[0].motivo).toMatch(/techo diario/);
    expect(redactar).not.toHaveBeenCalled();
  });

  it('backpressure: la bandeja llena frena la fábrica', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 25 }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toMatch(/bandeja con 25/);
    expect(redactar).not.toHaveBeenCalled();
  });
});

describe('el lote', () => {
  it('fabrica hasta el tope de piezas y un rebote de guarda NO tumba el lote', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('prospecto', [{
      data: Array.from({ length: 8 }, (_, i) => ({ id: `pr-${i}`, vendedor: null })), error: null,
    }]);
    // El segundo candidato rebota en la guarda (cadencia) — el lote sigue.
    redactar.mockImplementation(async (id: unknown) => {
      if (id === 'pr-1') throw new Error('la cadencia lo protege');
      return { piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0.001 };
    });
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toBeUndefined();
    expect(r.agentes[0]).toMatchObject({ resultado: 'corrio', piezas: 5, saltados: 1 });
  });

  it('el lote recibe un único presupuesto central por toda la corrida', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'redactor', presupuesto_dia_usd: 0.005 }], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('prospecto', [{
      data: Array.from({ length: 8 }, (_, i) => ({ id: `pr-${i}`, vendedor: null })), error: null,
    }]);
    redactar.mockResolvedValue({ piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0.002 });
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toBeUndefined();
    expect(r.agentes[0].piezas).toBe(5);
    expect(redactar.mock.calls.every((call) => (call[3] as { tenantId?: string }).tenantId === TENANT)).toBe(true);
  });
});

describe('M30 — correrRunner(soloAgente) acota la vuelta a UN agente', () => {
  it('con dos habilitados y soloAgente="redactor", el otro ni se evalúa', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR, { id: 'cobranza', presupuesto_dia_usd: 1 }], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('prospecto', [{ data: [{ id: 'p1', vendedor: null }], error: null }]);
    const r = await correrRunner('redactor', TENANT);
    expect(r.agentes.map((a) => a.agente)).toEqual(['redactor']);
  });

  it('soloAgente que no está habilitado → vuelta vacía, sin despachar nada', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    const r = await correrRunner('cobranza', TENANT);
    expect(r).toEqual({ apagadoGlobal: false, agentes: [], saltadosPorReloj: [] });
    expect(redactar).not.toHaveBeenCalled();
  });
});

describe('el despacho de dirección (0216)', () => {
  it('un agente de dirección habilitado se despacha a su motor, con su resultado tal cual', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'kpi_whatsapp', presupuesto_dia_usd: 0.1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrDireccion).toHaveBeenCalledWith('kpi_whatsapp');
    expect(r.agentes).toEqual([{ agente: 'kpi_whatsapp', resultado: 'corrio', motivo: undefined, piezas: 1, costoUsd: 0 }]);
  });

  it('el motor que lanza NO tumba la vuelta: el agente queda saltado con su motivo', async () => {
    correrDireccion.mockRejectedValueOnce(new Error('el sello no se pudo leer'));
    respuestas.set('agente_definicion', [{ data: [{ id: 'kpi_whatsapp', presupuesto_dia_usd: 0.1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0]).toMatchObject({ agente: 'kpi_whatsapp', resultado: 'saltado', motivo: 'el sello no se pudo leer' });
  });

  it('sin techo declarado, dirección tampoco corre — el candado 3 no distingue rubros', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'kpi_whatsapp', presupuesto_dia_usd: null }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrDireccion).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toContain('sin presupuesto_dia_usd');
  });
});

describe('el despacho de éxito del cliente (0218)', () => {
  it('un determinista se despacha a su motor y su resultado sale tal cual', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'onboarding_cliente', presupuesto_dia_usd: 0.1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).toHaveBeenCalledWith('onboarding_cliente', 'cron');
    expect(r.agentes).toEqual([{ agente: 'onboarding_cliente', resultado: 'corrio', motivo: undefined, piezas: 1, costoUsd: 0 }]);
    // Los cinco deterministas NO pasan por el gasto del día: su gasto de
    // modelo es $0 y leerlo sería una consulta que no decide nada.
    expect(respuestas.get('agente_corrida')).toBeUndefined();
  });

  it('el motor que lanza NO tumba la vuelta', async () => {
    correrExito.mockRejectedValueOnce(new Error('la bandeja no contesta'));
    respuestas.set('agente_definicion', [{ data: [{ id: 'onboarding_cliente', presupuesto_dia_usd: 0.1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0]).toMatchObject({ agente: 'onboarding_cliente', resultado: 'saltado', motivo: 'la bandeja no contesta' });
  });

  it('sin kill switch declarado no corre — el candado 1 no distingue rubros', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'retencion', presupuesto_dia_usd: 0.1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toMatch(/kill switch/);
  });

  it('atencion_faq SÍ pasa por el techo de gasto MEDIDO: es el único que gasta modelo', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'atencion_faq', presupuesto_dia_usd: 1 }], error: null }]);
    respuestas.set('agente_corrida', [{ data: [{ costo_usd: 0.02 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).toHaveBeenCalledWith('atencion_faq', 'cron');
    expect(r.agentes[0].resultado).toBe('corrio');
  });

  it('con el techo de atencion_faq agotado, ni se le pregunta al modelo', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'atencion_faq', presupuesto_dia_usd: 1 }], error: null }]);
    respuestas.set('agente_corrida', [{ data: [{ costo_usd: 5 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toMatch(/techo diario alcanzado/);
  });

  it('gasto del día ilegible: fail closed y dicho', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'atencion_faq', presupuesto_dia_usd: 1 }], error: null }]);
    respuestas.set('agente_corrida', [{ data: null, error: { message: 'base caída' } }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toMatch(/fail closed/);
  });
});

describe('el presupuesto central evita un ledger duplicado', () => {
  it('no llama las RPC antiguas del runner', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('prospecto', [{ data: [{ id: 'p1', vendedor: null }], error: null }]);
    await correrRunner(undefined, TENANT);
    expect(llamadasRpc).toEqual([]);
  });
});

describe('el despacho del back office restante (0219)', () => {
  // Los ids viven DOS veces: literal en el runner (para no cargar el motor en
  // cada vuelta) y en `AGENTES_BACK_OFFICE`. Si divergen, un agente vivo se
  // queda sin rama de despacho y el runner lo reporta como «sin motor». Esta
  // prueba es la costura que impide que la duplicación se pudra.
  it('la lista literal del runner y la del motor son la misma', () => {
    const fuente = readFileSync('src/lib/likida/agentes/runner.ts', 'utf8');
    const linea = /const BACK_OFFICE_RESTANTE: readonly string\[\] = \[([^\]]*)\]/.exec(fuente);
    expect(linea, 'la lista literal del runner debe seguir existiendo').not.toBeNull();
    const ids = (linea as RegExpExecArray)[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    expect(ids).toEqual([...AGENTES_BACK_OFFICE]);
    for (const id of ids) expect(esAgenteBackOffice(id)).toBe(true);
  });

  it('un agente de back office habilitado se despacha a su motor con su resultado tal cual', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'vigilante_calidad', presupuesto_dia_usd: 0.1 }], error: null }]);
    // El techo se mide contra el gasto REAL del día: sin corridas, $0.
    respuestas.set('agente_corrida', [{ data: [], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrBackOffice).toHaveBeenCalledWith('vigilante_calidad', 'cron');
    expect(r.agentes).toEqual([{ agente: 'vigilante_calidad', resultado: 'corrio', piezas: 1, costoUsd: 0 }]);
  });

  it('techo diario alcanzado: no se despacha y el motivo trae las dos cifras', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'documentacion', presupuesto_dia_usd: 0.1 }], error: null }]);
    respuestas.set('agente_corrida', [{ data: [{ costo_usd: 0.5 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrBackOffice).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toContain('techo diario alcanzado (0.50 de 0.1 USD)');
  });

  it('gasto del día ilegible: fail closed y dicho', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'legal_compliance', presupuesto_dia_usd: 0.1 }], error: null }]);
    respuestas.set('agente_corrida', [{ data: null, error: { message: 'base caída' } }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrBackOffice).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toContain('fail closed');
  });

  it('el motor que lanza NO tumba la vuelta', async () => {
    correrBackOffice.mockRejectedValueOnce(new Error('la bitácora no se pudo leer'));
    respuestas.set('agente_definicion', [{ data: [{ id: 'talento', presupuesto_dia_usd: 0.1 }], error: null }]);
    respuestas.set('agente_corrida', [{ data: [], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0]).toMatchObject({ agente: 'talento', resultado: 'saltado', motivo: 'la bitácora no se pudo leer' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL PRESUPUESTO DE TIEMPO (alerta de prod 25-ago-2026: "Sin latido: runner
// hace 286 min"). Con 34 agentes en serie la pasada de las 18:00 murió en el
// `maxDuration` con ~15 corridos y sin escribir latido. Lo que se fija aquí:
//  · el reloj se pregunta ANTES de despachar y corta LIMPIO;
//  · los que no alcanzaron turno se DICEN con nombre, no desaparecen;
//  · el orden sacrifica lo caro: los deterministas van primero.
// ═══════════════════════════════════════════════════════════════════════════
describe('el reloj de la vuelta', () => {
  /** Un `Date.now` de mentiras que solo avanza cuando la prueba lo dice. */
  function relojFalso(inicio: number) {
    let ahora = inicio;
    vi.spyOn(Date, 'now').mockImplementation(() => ahora);
    return { avanzar: (ms: number) => { ahora += ms; }, leer: () => ahora };
  }

  afterEach(() => { vi.restoreAllMocks(); });

  it('corta ANTES del tercer agente y los saltados salen con nombre y motivo', async () => {
    const reloj = relojFalso(1_000_000);
    // Cada motor se come 40 s del reloj; la vuelta tiene 60 s.
    correrExito.mockImplementation(async () => { reloj.avanzar(40_000); return { resultado: 'corrio' as const, piezas: 1, costoUsd: 0 }; });
    respuestas.set('agente_definicion', [{ data: [
      { id: 'onboarding_cliente', presupuesto_dia_usd: 0.1 },
      { id: 'exito_cliente', presupuesto_dia_usd: 0.1 },
      { id: 'soporte', presupuesto_dia_usd: 0.1 },
    ], error: null }]);

    const r = await correrRunner(undefined, TENANT, { venceEn: reloj.leer() + 60_000 });

    // Dos alcanzaron turno; el tercero no se despachó — ni se le preguntó al motor.
    expect(correrExito.mock.calls.map((c) => c[0])).toEqual(['onboarding_cliente', 'exito_cliente']);
    expect(r.saltadosPorReloj).toEqual(['soporte']);
    expect(r.agentes.map((a) => a.agente)).toEqual(['onboarding_cliente', 'exito_cliente', 'soporte']);
    expect(r.agentes[2]).toMatchObject({ resultado: 'saltado' });
    expect(r.agentes[2].motivo).toMatch(/saltado por reloj/);
  });

  it('con el reloj ya vencido no se despacha a NADIE, y los 34 se dicen', async () => {
    const reloj = relojFalso(2_000_000);
    respuestas.set('agente_definicion', [{ data: [
      { id: 'onboarding_cliente', presupuesto_dia_usd: 0.1 },
      { id: 'exito_cliente', presupuesto_dia_usd: 0.1 },
    ], error: null }]);
    const r = await correrRunner(undefined, TENANT, { venceEn: reloj.leer() - 1 });
    expect(correrExito).not.toHaveBeenCalled();
    expect(r.saltadosPorReloj).toEqual(['onboarding_cliente', 'exito_cliente']);
  });

  it('una vuelta que cabe entera no reporta ningún saltado por reloj', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'onboarding_cliente', presupuesto_dia_usd: 0.1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.saltadosPorReloj).toEqual([]);
    expect(r.agentes[0].resultado).toBe('corrio');
  });

  it('sin `venceEn` del llamador, el default deja margen para el latido', () => {
    // 300 s de `maxDuration` del cron menos los 20 s que la ruta necesita para
    // leer la racha, alertar y escribir el latido.
    expect(MARGEN_RELOJ_MS).toBe(20_000);
    expect(PLAZO_RUNNER_MS).toBe(280_000);
  });
});

describe('el orden de despacho — lo barato primero, lo caro al final', () => {
  it('los que llaman al modelo se van al final; dentro del grupo, orden estable', () => {
    const entrada = [
      { id: 'atencion_faq' }, { id: 'documentacion' }, { id: 'enriquecedor' },
      { id: 'kpi_whatsapp' }, { id: 'redactor' }, { id: 'sdr' }, { id: 'talento' },
    ];
    expect(ordenarPorCosto(entrada).map((a) => a.id)).toEqual([
      'documentacion', 'kpi_whatsapp', 'talento',
      'atencion_faq', 'enriquecedor', 'redactor', 'sdr',
    ]);
  });

  it('sabe cuáles gastan modelo y cuáles no', () => {
    for (const caro of ['redactor', 'enriquecedor', 'sdr', 'atencion_faq']) expect(llamaAlModelo(caro)).toBe(true);
    for (const barato of ['kpi_whatsapp', 'talento', 'soporte', 'enviador', 'cobranza_saas']) expect(llamaAlModelo(barato)).toBe(false);
  });

  it('con el alfabeto en contra, el determinista corre ANTES que el que gasta modelo', async () => {
    // Así llega la lista de la base: `ORDER BY id`, o sea `atencion_faq` primero.
    respuestas.set('agente_definicion', [{ data: [
      { id: 'atencion_faq', presupuesto_dia_usd: 1 },
      { id: 'onboarding_cliente', presupuesto_dia_usd: 0.1 },
    ], error: null }]);
    respuestas.set('agente_corrida', [{ data: [], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrExito.mock.calls.map((c) => c[0])).toEqual(['onboarding_cliente', 'atencion_faq']);
    expect(r.agentes.map((a) => a.agente)).toEqual(['onboarding_cliente', 'atencion_faq']);
  });

  it('el corte de reloj sacrifica lo CARO: el parte determinista sale, el del modelo no', async () => {
    let ahora = 3_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => ahora);
    correrExito.mockImplementation(async () => { ahora += 40_000; return { resultado: 'corrio' as const, piezas: 1, costoUsd: 0 }; });
    respuestas.set('agente_definicion', [{ data: [
      { id: 'atencion_faq', presupuesto_dia_usd: 1 },
      { id: 'onboarding_cliente', presupuesto_dia_usd: 0.1 },
    ], error: null }]);
    respuestas.set('agente_corrida', [{ data: [], error: null }]);

    const r = await correrRunner(undefined, TENANT, { venceEn: ahora + 30_000 });

    expect(correrExito.mock.calls.map((c) => c[0])).toEqual(['onboarding_cliente']);
    expect(r.saltadosPorReloj).toEqual(['atencion_faq']);
    vi.restoreAllMocks();
  });
});

describe('el despacho de crecimiento (0230)', () => {
  // La misma costura que la del back office: los ids viven DOS veces —literal
  // en el runner, para no cargar la calculadora ni el índice de normas en cada
  // vuelta, y en `AGENTES_CRECIMIENTO`—. Si divergen, un agente vivo se queda
  // sin rama y el runner lo reporta como «sin motor despachable».
  it('la lista literal del runner y la del motor son la misma', () => {
    const fuente = readFileSync('src/lib/likida/agentes/runner.ts', 'utf8');
    const linea = /const CRECIMIENTO: readonly string\[\] = \[([^\]]*)\]/.exec(fuente);
    expect(linea, 'la lista literal del runner debe seguir existiendo').not.toBeNull();
    const ids = (linea as RegExpExecArray)[1]
      .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    expect(ids).toEqual([...AGENTES_CRECIMIENTO]);
    for (const id of ids) expect(esAgenteCrecimiento(id)).toBe(true);
  });

  it('un determinista se despacha a su motor y su resultado sale TAL CUAL', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'lead_magnet', presupuesto_dia_usd: 0.1 }], error: null }]);
    correrCrecimiento.mockResolvedValue({ resultado: 'corrio', piezas: 1, costoUsd: 0 });
    const r = await correrRunner(undefined, TENANT);
    expect(correrCrecimiento).toHaveBeenCalledWith('lead_magnet', 'cron');
    expect(r.agentes).toEqual([{ agente: 'lead_magnet', resultado: 'corrio', motivo: undefined, piezas: 1, costoUsd: 0 }]);
  });

  it('un determinista NO consulta el gasto del día: no gasta modelo y no hay techo que medir', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'promos_diarias', presupuesto_dia_usd: 0.1 }], error: null }]);
    // Si el runner pidiera el gasto, esta cola contestaría con un fallo y el
    // agente saltaría fail-closed. Que corra prueba que ni la pidió.
    respuestas.set('agente_corrida', [{ data: null, error: { message: 'nadie debería preguntar' } }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0]).toMatchObject({ agente: 'promos_diarias', resultado: 'corrio' });
  });

  it('contenido_fiscal SÍ mide el gasto: techo alcanzado, no se despacha, y el motivo trae las dos cifras', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'contenido_fiscal', presupuesto_dia_usd: 1 }], error: null }]);
    respuestas.set('agente_corrida', [{ data: [{ costo_usd: 1.2 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrCrecimiento).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toContain('techo diario alcanzado (1.20 de 1 USD)');
  });

  it('contenido_fiscal con el gasto ILEGIBLE: fail closed y dicho', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'contenido_fiscal', presupuesto_dia_usd: 1 }], error: null }]);
    respuestas.set('agente_corrida', [{ data: null, error: { message: 'base caída' } }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrCrecimiento).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toMatch(/fail closed/);
  });

  it('un motor que truena no tumba la vuelta: se dice y los demás siguen', async () => {
    respuestas.set('agente_definicion', [{ data: [
      { id: 'lead_magnet', presupuesto_dia_usd: 0.1 },
      { id: 'promos_diarias', presupuesto_dia_usd: 0.1 },
    ], error: null }]);
    correrCrecimiento.mockRejectedValueOnce(new Error('sitio_evento ilegible'));
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0]).toMatchObject({ agente: 'lead_magnet', resultado: 'saltado' });
    expect(r.agentes[0].motivo).toContain('sitio_evento ilegible');
    expect(r.agentes[1]).toMatchObject({ agente: 'promos_diarias', resultado: 'corrio' });
  });

  it('contenido_fiscal es CARO: se despacha al final, detrás de los deterministas', () => {
    expect(llamaAlModelo('contenido_fiscal')).toBe(true);
    for (const id of AGENTES_CRECIMIENTO.filter((x) => x !== 'contenido_fiscal')) {
      expect(llamaAlModelo(id), id).toBe(false);
    }
    const orden = ordenarPorCosto([
      { id: 'contenido_fiscal' }, { id: 'lead_magnet' }, { id: 'alianzas' },
    ]).map((a) => a.id);
    expect(orden).toEqual(['lead_magnet', 'alianzas', 'contenido_fiscal']);
  });

  it('sin kill switch declarado no corre, aunque tenga motor', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'visuales', presupuesto_dia_usd: 0.1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrCrecimiento).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toMatch(/kill switch/);
  });

  it('sin techo declarado no corre: el candado 3 no distingue departamentos', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'lead_magnet', presupuesto_dia_usd: null }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(correrCrecimiento).not.toHaveBeenCalled();
    expect(r.agentes[0].motivo).toMatch(/sin presupuesto_dia_usd declarado/);
  });
});
