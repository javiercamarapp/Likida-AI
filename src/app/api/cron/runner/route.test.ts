import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL LATIDO DEL RUNNER — lo que se fija:
//  · sin CRON_SECRET: 500; secreto incorrecto: 401 — y el runner no corre.
//  · si el runner truena: 500 (Vercel lo pinta rojo), log con `codigo`
//    estable (Sentry notifica por causa nueva) y correo al operador
//    (AUDITORÍA 18, M15: era el único cron sin las dos cosas).
//  · EL LATIDO SE ESCRIBE SIEMPRE — éxito, corte por reloj y fallo (25-ago-
//    2026): la pasada de las 18:00 murió en el `maxDuration` ANTES de
//    `registrarLatido` y el orquestador quedó mudo cuatro horas.
//  · la racha de cortes (RES-6): al tercero seguido se molesta al operador.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

interface ResultadoFalso {
  apagadoGlobal: boolean;
  agentes: Array<{ agente: string; resultado: string; piezas?: number; motivo?: string }>;
  saltadosPorReloj: string[];
}
const correrRunner = vi.fn(async (..._a: unknown[]): Promise<ResultadoFalso> =>
  ({ apagadoGlobal: false, agentes: [], saltadosPorReloj: [] }));
// El margen se reexporta TAL CUAL: la ruta lo resta de su `maxDuration` para
// calcular el `venceEn`, y una prueba que lo invente no probaría el reparto real.
vi.mock('@/lib/likida/agentes/runner', () => ({
  correrRunner: (...a: unknown[]) => correrRunner(...a),
  MARGEN_RELOJ_MS: 20_000,
}));

const alertarOperador = vi.fn(async (_e: string, _d: Record<string, unknown>) => { void _e; void _d; });
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (e: string, d: Record<string, unknown>) => alertarOperador(e, d),
}));

// El latido (RES-7) se prueba en src/lib/admin/salud.test.ts; aquí se mockean
// escritura y lectura para que la racha (RES-6) sea observable sin tocar la
// base. `puertaCron` se deja REAL: los 500/401 de arriba son de ella.
const registrarLatido = vi.fn(async (..._a: unknown[]) => {});
let latidoPrevio: { ultimoLatido: string; estado: string; detalle: Record<string, unknown> } | null = null;
let latidoIlegible = false;
vi.mock('@/lib/admin/salud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/salud')>()),
  registrarLatido: (...a: unknown[]) => registrarLatido(...a),
  leerLatido: async () => {
    if (latidoIlegible) throw new Error('cron_latido no se pudo leer');
    return latidoPrevio;
  },
}));

const { GET } = await import('./route');

const peticion = (auth?: string) =>
  new Request('https://app.likida.ai/api/cron/runner', { headers: auth ? { authorization: auth } : {} });

/** Una pasada que cortó por reloj: los `saltados` salen con nombre y motivo. */
const conCorte = (corridos: string[], saltados: string[]): ResultadoFalso => ({
  apagadoGlobal: false,
  saltadosPorReloj: saltados,
  agentes: [
    ...corridos.map((agente) => ({ agente, resultado: 'corrio', piezas: 1 })),
    ...saltados.map((agente) => ({ agente, resultado: 'saltado', motivo: 'saltado por reloj — la vuelta se quedó sin presupuesto de tiempo; le toca en la próxima pasada' })),
  ],
});

beforeEach(() => {
  process.env.CRON_SECRET = 'secreto-de-prueba';
  correrRunner.mockClear().mockResolvedValue({ apagadoGlobal: false, agentes: [], saltadosPorReloj: [] });
  alertarOperador.mockClear(); logger.error.mockClear(); logger.info.mockClear();
  registrarLatido.mockClear();
  latidoPrevio = null;
  latidoIlegible = false;
});

describe('la puerta', () => {
  it('sin CRON_SECRET: 500 y no corre', async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(peticion('Bearer x'))).status).toBe(500);
    expect(correrRunner).not.toHaveBeenCalled();
  });
  it('secreto incorrecto: 401 y no corre', async () => {
    expect((await GET(peticion('Bearer otro'))).status).toBe(401);
    expect(correrRunner).not.toHaveBeenCalled();
  });
});

describe('la corrida', () => {
  it('sana: 200 con el resultado, sin alerta', async () => {
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ apagadoGlobal: false });
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('que truena: 500, log con codigo estable y correo al operador', async () => {
    correrRunner.mockRejectedValueOnce(Object.assign(new Error('relation "agente" does not exist'), { code: '42P01' }));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('cron.runner.fallo', expect.objectContaining({ codigo: '42P01' }));
    expect(alertarOperador).toHaveBeenCalledWith('cron.runner', expect.objectContaining({ codigo: '42P01', error: expect.stringContaining('agente') }));
  });

  it('dos causas distintas dan dos códigos distintos (dos issues, dos notificaciones)', async () => {
    correrRunner.mockRejectedValueOnce(new Error('token vencido'));
    await GET(peticion('Bearer secreto-de-prueba'));
    correrRunner.mockRejectedValueOnce(new TypeError('x is not a function'));
    await GET(peticion('Bearer secreto-de-prueba'));
    const codigos = logger.error.mock.calls.map((c) => (c[1] as { codigo: string }).codigo);
    expect(codigos).toHaveLength(2);
    expect(codigos[0]).not.toBe(codigos[1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL PRESUPUESTO DE TIEMPO (alerta de prod 25-ago-2026: "Sin latido: runner
// hace 286 min"). La pasada de las 18:00, con 34 agentes en serie, murió en
// el `maxDuration` de 120 s sin escribir latido. Lo que se fija aquí es el
// lado de la RUTA: le pasa su reloj al motor, y late SIEMPRE — pase lo que
// pase con la vuelta.
// ═══════════════════════════════════════════════════════════════════════════
describe('el reloj que la ruta le presta al motor', () => {
  it('le pasa un `venceEn` = ahora + maxDuration − margen, no un reloj infinito', async () => {
    const antes = Date.now();
    await GET(peticion('Bearer secreto-de-prueba'));
    const opts = correrRunner.mock.calls[0][2] as { venceEn: number };
    // 300 s de techo menos los 20 s que la ruta se guarda para latir.
    expect(opts.venceEn).toBeGreaterThanOrEqual(antes + 280_000);
    expect(opts.venceEn).toBeLessThanOrEqual(Date.now() + 280_000);
  });
});

describe('el latido se escribe SIEMPRE, y dice la verdad de la pasada', () => {
  it('éxito: `ok`, con la cuenta de despachados y la racha en cero', async () => {
    correrRunner.mockResolvedValue({
      apagadoGlobal: false,
      agentes: [{ agente: 'kpi_whatsapp', resultado: 'corrio', piezas: 1 }, { agente: 'redactor', resultado: 'corrio', piezas: 3 }],
      saltadosPorReloj: [],
    });
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(200);
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'ok', {
      agentes: 2, despachados: 2, saltadosPorReloj: [], cortesSeguidos: 0,
    });
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('corte por reloj: `parcial`, con los saltados POR NOMBRE — no un conteo', async () => {
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp', 'documentacion'], ['redactor', 'enriquecedor']));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(200);
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'parcial', {
      agentes: 4, despachados: 2, saltadosPorReloj: ['redactor', 'enriquecedor'], cortesSeguidos: 1,
    });
    // Y la respuesta que ve Vercel trae la lista, no un 200 mudo.
    expect((await r.json()).saltadosPorReloj).toEqual(['redactor', 'enriquecedor']);
  });

  it('fallo: `fallo` con el código estable — el latido va DESPUÉS del correo, pero va', async () => {
    correrRunner.mockRejectedValueOnce(Object.assign(new Error('relation "agente" does not exist'), { code: '42P01' }));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(500);
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'fallo', { codigo: '42P01' });
  });

  it('la pasada apagada por el kill switch global también late', async () => {
    correrRunner.mockResolvedValue({ apagadoGlobal: true, agentes: [], saltadosPorReloj: [] });
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'ok', {
      agentes: 0, despachados: 0, saltadosPorReloj: [], cortesSeguidos: 0,
    });
  });
});

describe('la racha de cortes (RES-6) — al TERCERO seguido se molesta al operador', () => {
  it('el primer corte suma a la racha y NO alerta: los caros esperan cuatro horas', async () => {
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp'], ['redactor']));
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'parcial', expect.objectContaining({ cortesSeguidos: 1 }));
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('el segundo tampoco', async () => {
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'parcial', detalle: { cortesSeguidos: 1 } };
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp'], ['redactor']));
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'parcial', expect.objectContaining({ cortesSeguidos: 2 }));
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('el TERCERO: el trabajo ya no cabe en la cadencia y se avisa con los nombres', async () => {
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'parcial', detalle: { cortesSeguidos: 2 } };
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp'], ['redactor', 'sdr']));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    // Sigue siendo 200: la pasada corrió, solo que incompleta. El grito va por correo.
    expect(r.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith('cron.runner.corte_repetido', expect.objectContaining({ cortesSeguidos: 3 }));
    expect(alertarOperador).toHaveBeenCalledWith('cron.runner', expect.objectContaining({
      codigo: 'corte_por_reloj_repetido',
      error: expect.stringContaining('redactor, sdr'),
    }));
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'parcial', expect.objectContaining({ cortesSeguidos: 3 }));
  });

  it('una pasada COMPLETA reinicia la racha: el latido vuelve a `ok` en cero', async () => {
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'parcial', detalle: { cortesSeguidos: 5 } };
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'ok', expect.objectContaining({ cortesSeguidos: 0 }));
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('con la racha ILEGIBLE el corte no se pierde: cuenta como el primero y la pasada late igual', async () => {
    latidoIlegible = true;
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp'], ['redactor']));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(200);
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'parcial', expect.objectContaining({ cortesSeguidos: 1 }));
  });
});
