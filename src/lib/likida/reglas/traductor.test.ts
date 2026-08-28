import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A19 — EL TRADUCTOR. La única vez que un modelo toca una regla, y lo que
// estas pruebas fijan es sobre todo lo que NO puede hacer:
//
//   · Inventar una vigilancia fuera del catálogo (ni siquiera cuando el
//     modelo insiste con una plantilla que no le toca a ese rol).
//   · Redactar la frase que la persona confirma: la arma el catálogo con los
//     números que ella dio.
//   · Activar nada por su cuenta.
//   · Llamar al proveedor sin un tenant que pague.
//
// Y que sus tres modos de falla —no calza, falta el número, el proveedor no
// contestó— son TRES mensajes distintos: los tres se le van a decir a una
// persona, y "no se pudo" no ayuda a ninguno.
// ═══════════════════════════════════════════════════════════════════════════

class LlmBudgetExceededError extends Error {
  constructor() { super('presupuesto de IA agotado'); this.name = 'LlmBudgetExceededError'; }
}

const generateStructured = vi.hoisted(() => vi.fn());
const createLlmBudget = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/llm/openrouter', () => ({ generateStructured }));
vi.mock('@/lib/llm/budget', () => ({
  createLlmBudget: (...a: unknown[]) => createLlmBudget(...a),
  LlmBudgetExceededError,
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { interpretar, interpretarAMano, catalogoParaPrompt, MAX_TEXTO } = await import('./traductor');

/** Lo que el modelo contesta: la forma plana con todos los parámetros y
 *  `null` en los que no aplican. */
function respuesta(parcial: Record<string, unknown>) {
  return {
    data: {
      plantilla: 'ninguna', documento: null, concepto: null,
      monto: null, dias: null, horas: null, n: null, usd: null,
      ...parcial,
    },
    raw: '{}', model: 'modelo-de-prueba', tokensIn: 300, tokensOut: 40, cost: 0.00012,
  };
}

const DUEÑO = { tenantId: '11111111-1111-1111-1111-111111111111', rol: 'flota_admin' };

beforeEach(() => {
  generateStructured.mockReset();
  createLlmBudget.mockReset().mockReturnValue({
    tenantId: DUEÑO.tenantId, runId: 'run', maxRunUsd: 0.5, maxTenantDailyUsd: 5, reservadoRunUsd: 0,
  });
  logger.warn.mockClear();
});

describe('cuando la frase SÍ calza', () => {
  it('traduce "avísame si un gasto de caseta pasa de $3,000" a plantilla + parámetros', async () => {
    generateStructured.mockResolvedValue(respuesta({
      plantilla: 'gasto_de_concepto_mayor_a', concepto: 'caseta', monto: 3000,
    }));
    const r = await interpretar('avísame si un gasto de caseta pasa de $3,000', DUEÑO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plantilla).toBe('gasto_de_concepto_mayor_a');
    expect(r.params).toEqual({ concepto: 'caseta', monto: 3000 });
    expect(r.modelo).toBe('modelo-de-prueba');
    expect(r.costoUsd).toBeCloseTo(0.00012, 6);
  });

  it('la frase de confirmación la arma el CATÁLOGO, no el modelo', async () => {
    generateStructured.mockResolvedValue(respuesta({
      plantilla: 'gasto_de_concepto_mayor_a', concepto: 'caseta', monto: 3000,
    }));
    const r = await interpretar('avísame si un gasto de caseta pasa de $3,000', DUEÑO);
    expect(r.ok && r.frase).toBe('Voy a avisarte cuando entre un comprobante de casetas por más de $3,000.00.');
  });

  it('IGNORA los parámetros que la plantilla no usa — no se guarda basura', async () => {
    generateStructured.mockResolvedValue(respuesta({
      plantilla: 'estadia_mayor_a', horas: 4, monto: 9999, dias: 7, concepto: 'diesel',
    }));
    const r = await interpretar('avísame si una unidad lleva más de 4 horas en el cliente', DUEÑO);
    expect(r.ok && r.params).toEqual({ horas: 4 });
  });

  it('cobra la traducción al TENANT, con presupuesto declarado', async () => {
    generateStructured.mockResolvedValue(respuesta({ plantilla: 'gasto_sin_cfdi_mayor_a', monto: 2000 }));
    await interpretar('avísame de gastos sin factura arriba de 2000', DUEÑO);
    expect(createLlmBudget).toHaveBeenCalledWith(DUEÑO.tenantId, expect.any(String), {});
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      role: 'extraccion', temperature: 0, budget: expect.objectContaining({ tenantId: DUEÑO.tenantId }),
    }));
  });
});

describe('cuando NO calza — la negativa honesta', () => {
  it('"avísame si va a llover" no se fuerza a la plantilla más parecida', async () => {
    generateStructured.mockResolvedValue(respuesta({ plantilla: 'ninguna' }));
    const r = await interpretar('avísame si va a llover en la ruta a Monterrey', DUEÑO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('No puedo vigilar eso todavía');
    // La mitad que evita que la persona se rinda: qué SÍ se puede.
    expect(r.puedoVigilar.length).toBeGreaterThan(5);
    expect(r.puedoVigilar.join('\n')).toContain('caseta');
  });

  it('una plantilla de PLATAFORMA no se le cuela a un dueño de flota', async () => {
    // El prompt ya no se la ofrecía; esto prueba la segunda puerta, la que
    // atrapa a un modelo que la recuerde de otro lado.
    generateStructured.mockResolvedValue(respuesta({ plantilla: 'costo_ia_dia_mayor_a', usd: 5 }));
    const r = await interpretar('avísame si el costo de IA del día pasa de 5 dólares', DUEÑO);
    expect(r.ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('reglas.traductor.plantilla_fuera_de_rol', expect.anything());
  });

  it('al superadmin SÍ se la deja declarar', async () => {
    generateStructured.mockResolvedValue(respuesta({ plantilla: 'costo_ia_dia_mayor_a', usd: 5 }));
    const r = await interpretar('avísame si el costo de IA del día pasa de 5 dólares',
      { ...DUEÑO, rol: 'superadmin' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.params).toEqual({ usd: 5 });
  });

  it('sin el número, lo PIDE — no adivina uno', async () => {
    generateStructured.mockResolvedValue(respuesta({ plantilla: 'gasto_de_concepto_mayor_a', concepto: 'caseta' }));
    const r = await interpretar('avísame si un gasto de caseta se pasa', DUEÑO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('no de cuánto');
  });

  it('un número fuera de rango se rechaza con el campo dicho', async () => {
    generateStructured.mockResolvedValue(respuesta({
      plantilla: 'gasto_de_concepto_mayor_a', concepto: 'caseta', monto: 3_000_000,
    }));
    const r = await interpretar('avísame si una caseta pasa de tres millones', DUEÑO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('monto');
  });

  it('una plantilla que el modelo se inventó no pasa el enum ni el guardia', async () => {
    generateStructured.mockResolvedValue(respuesta({ plantilla: 'avisame_de_todo' }));
    const r = await interpretar('avísame de todo lo raro que pase', DUEÑO);
    expect(r.ok).toBe(false);
  });
});

describe('los modos de falla que no son del modelo', () => {
  it('el proveedor caído se dice como tal, y ofrece el camino a mano', async () => {
    generateStructured.mockRejectedValue(new Error('502 bad gateway'));
    const r = await interpretar('avísame si un gasto de caseta pasa de 3000', DUEÑO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('elegir la vigilancia a mano');
  });

  it('el techo de gasto del día es su propio mensaje, no "no se pudo"', async () => {
    generateStructured.mockRejectedValue(new LlmBudgetExceededError());
    const r = await interpretar('avísame si un gasto de caseta pasa de 3000', DUEÑO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('techo de gasto de IA del día');
  });

  it('sin tenant de presupuesto NO se llama al proveedor — fail closed', async () => {
    createLlmBudget.mockImplementation(() => { throw new Error('presupuesto_llm: tenant requerido'); });
    const r = await interpretar('avísame si un gasto de caseta pasa de 3000', { ...DUEÑO, tenantId: '' });
    expect(r.ok).toBe(false);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('una frase de tres letras y un ensayo de mil no llegan al modelo', async () => {
    const corta = await interpretar('hola', DUEÑO);
    const larga = await interpretar('a'.repeat(MAX_TEXTO + 1), DUEÑO);
    expect(corta.ok).toBe(false);
    expect(larga.ok).toBe(false);
    if (!larga.ok) expect(larga.motivo).toContain('dos reglas');
    expect(generateStructured).not.toHaveBeenCalled();
  });
});

describe('el prompt se genera del catálogo, no se copia a mano', () => {
  it('trae cada plantilla del rol con sus parámetros y su dominio', () => {
    const p = catalogoParaPrompt('flota_admin');
    expect(p).toContain('· gasto_de_concepto_mayor_a');
    expect(p).toContain('concepto (uno de: diesel, caseta');
    expect(p).toContain('monto (número en MXN)');
    // Un prompt que ofrezca lo que ese rol no puede declarar es una promesa
    // que la segunda puerta va a romper.
    expect(p).not.toContain('costo_ia_dia_mayor_a');
    expect(catalogoParaPrompt('superadmin')).toContain('costo_ia_dia_mayor_a');
  });
});

describe('interpretarAMano — el camino sin proveedor', () => {
  it('valida igual que el traductor y arma la misma frase, sin modelo ni costo', () => {
    const r = interpretarAMano('gasto_de_concepto_mayor_a', { concepto: 'caseta', monto: 3000 }, 'contador');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.modelo).toBeNull();
    expect(r.costoUsd).toBe(0);
    expect(r.frase).toContain('$3,000.00');
  });

  it('una plantilla que no existe, o que no le toca al rol, rebota', () => {
    expect(interpretarAMano('lo_que_sea', {}, 'flota_admin').ok).toBe(false);
    expect(interpretarAMano('costo_ia_dia_mayor_a', { usd: 5 }, 'flota_admin').ok).toBe(false);
    expect(interpretarAMano('costo_ia_dia_mayor_a', { usd: 5 }, 'superadmin').ok).toBe(true);
  });

  it('unos parámetros inválidos devuelven el error del campo, no un throw', () => {
    const r = interpretarAMano('chofer_con_viajes_sin_liquidar', { n: 0 }, 'flota_admin');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('«n»');
  });
});
