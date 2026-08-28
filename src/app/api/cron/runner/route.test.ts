import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

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
  cortadaPorRelojDuro?: boolean;
}
const correrRunner = vi.fn(async (..._a: unknown[]): Promise<ResultadoFalso> =>
  ({ apagadoGlobal: false, agentes: [], saltadosPorReloj: [] }));
// Del módulo del runner se mockea SOLO `correrRunner` — la vuelta, que es lo
// que esta suite no quiere ejecutar. Todo lo demás queda REAL a propósito:
// `MARGEN_RELOJ_MS` porque la ruta lo resta de su `maxDuration` y una prueba que
// lo invente no probaría el reparto real; y `conRelojDuro`/`nuevoAvanceRunner`/
// `cerrarPorRelojDuro` porque son EL TECHO que se está probando (c7-1) —
// mockearlos sería probar el mock.
vi.mock('@/lib/likida/agentes/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/likida/agentes/runner')>()),
  correrRunner: (...a: unknown[]) => correrRunner(...a),
}));
type AvanceFalso = {
  apagadoGlobal: boolean;
  agentes: Array<{ agente: string; resultado: string; piezas?: number; motivo?: string }>;
  saltadosPorReloj: string[];
  pendientes: string[];
  enVuelo: string | null;
};

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
  alertarOperador.mockClear(); logger.error.mockClear(); logger.info.mockClear(); logger.warn.mockClear();
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
    // 300 s de techo menos los 30 s que la ruta se guarda para latir (c7-31).
    expect(opts.venceEn).toBeGreaterThanOrEqual(antes + 270_000);
    expect(opts.venceEn).toBeLessThanOrEqual(Date.now() + 270_000);
  });

  it('le pasa TAMBIÉN el parte en vivo: sin él, un corte duro no sabría a quién nombrar', async () => {
    await GET(peticion('Bearer secreto-de-prueba'));
    const opts = correrRunner.mock.calls[0][2] as { avance?: AvanceFalso };
    expect(opts.avance).toBeDefined();
    expect(opts.avance).toMatchObject({ agentes: [], saltadosPorReloj: [], pendientes: [], enVuelo: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL TECHO ESTRUCTURAL (auditoría ciclo 7, c7-1) — el agujero que dejó abierto
// el reloj de #141 y que se cobró DOS incidentes de producción:
//   · 25-ago-2026 18:46 — «Sin latido: runner hace 286 min».
//   · 28-ago-2026 00:03 UTC — el mismo silencio, ya con el reloj desplegado:
//     el candado 0 preguntaba la hora ENTRE agentes, pero `loteRedactor`
//     iteraba 20 candidatos a ~25 s medidos sin mirarla. 500 s dentro de un
//     `maxDuration` de 300: Vercel mató la función DENTRO del bucle, no corrió
//     ni el `try` ni el `catch` de esta ruta, y no se escribió latido.
//
// El auditor lo dijo sin rodeos: «no existe una sola prueba en la que un agente
// YA DESPACHADO se pase del presupuesto». Esta es esa prueba. El motor no
// coopera —no mira el reloj, no devuelve nunca— y aun así la ruta tiene que
// responder, latir `'parcial'` y NOMBRAR a los que se quedaron sin trabajo.
// ═══════════════════════════════════════════════════════════════════════════
describe('un motor que se pasa del presupuesto NO puede dejar muda a la ruta', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** Un motor que despacha algo, se mete en el siguiente y JAMÁS devuelve —
   *  el `loteRedactor` del 28-ago con sus 20 candidatos de 25 s. */
  function motorQueNuncaVuelve(): void {
    correrRunner.mockImplementation((...a: unknown[]) => {
      const { avance } = a[2] as { avance: AvanceFalso };
      avance.agentes.push({ agente: 'kpi_whatsapp', resultado: 'corrio', piezas: 1 });
      avance.enVuelo = 'redactor';
      avance.pendientes = ['enriquecedor'];
      return new Promise<ResultadoFalso>(() => {});   // se cuelga para siempre
    });
  }

  it('la ruta responde, LATE `parcial` y `saltadosPorReloj` NO queda vacía', async () => {
    vi.useFakeTimers();
    motorQueNuncaVuelve();

    const enCurso = GET(peticion('Bearer secreto-de-prueba'));
    // Más allá del `venceEn` (270 s) pero por debajo del `maxDuration` (300 s):
    // el punto entero es que la ruta termine ANTES de que Vercel la mate.
    await vi.advanceTimersByTimeAsync(275_000);
    const r = await enCurso;

    expect(r.status).toBe(200);
    // EL INVARIANTE: latió. Con el bug, aquí no había llamada ninguna.
    expect(registrarLatido).toHaveBeenCalledTimes(1);
    const [, estado, detalle] = registrarLatido.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(estado).toBe('parcial');
    // Y el latido DICE LA VERDAD: con el bug `saltadosPorReloj` salía vacía, o
    // sea que si llegara a escribirse diría `'ok'` — el runner reportando una
    // pasada limpia mientras agonizaba.
    expect(detalle.saltadosPorReloj).not.toEqual([]);
    expect(detalle.saltadosPorReloj).toEqual(['redactor', 'enriquecedor']);
    expect(detalle.cortesSeguidos).toBe(1);
    // El que sí corrió no se pierde en la contabilidad.
    expect(detalle.despachados).toBe(1);
  });

  it('nombra al motor EN VUELO aparte de los que no alcanzaron turno', async () => {
    vi.useFakeTimers();
    motorQueNuncaVuelve();
    const enCurso = GET(peticion('Bearer secreto-de-prueba'));
    await vi.advanceTimersByTimeAsync(275_000);
    const cuerpo = await (await enCurso).json();

    expect(cuerpo.cortadaPorRelojDuro).toBe(true);
    const redactor = cuerpo.agentes.find((a: { agente: string }) => a.agente === 'redactor');
    expect(redactor).toMatchObject({ resultado: 'saltado' });
    expect(redactor.motivo).toMatch(/CORTADO EN VUELO/);
    const enriquecedor = cuerpo.agentes.find((a: { agente: string }) => a.agente === 'enriquecedor');
    expect(enriquecedor.motivo).toMatch(/saltado por reloj/);
  });

  it('el tercer corte duro seguido sí molesta al operador — la racha cuenta igual', async () => {
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'parcial', detalle: { cortesSeguidos: 2 } };
    vi.useFakeTimers();
    motorQueNuncaVuelve();
    const enCurso = GET(peticion('Bearer secreto-de-prueba'));
    await vi.advanceTimersByTimeAsync(275_000);
    await enCurso;

    expect(registrarLatido).toHaveBeenCalledWith('runner', 'parcial', expect.objectContaining({ cortesSeguidos: 3 }));
    expect(alertarOperador).toHaveBeenCalledWith('cron.runner', expect.objectContaining({
      codigo: 'corte_por_reloj_repetido',
    }));
  });

  // ── EL RATCHET ──────────────────────────────────────────────────────────
  // Lo de arriba prueba que HOY la ruta está acotada. Esto impide que mañana
  // deje de estarlo: el techo tiene que ser una restricción, no una disciplina.
  // Un motor nuevo escrito el mes que viene por alguien que no leyó `runner.ts`
  // no puede volver a romper esto mientras la ruta espere a la CARRERA y no a
  // la vuelta — y quitar la carrera es esta prueba en rojo, no un descuido.
  it('la ruta NUNCA espera a `correrRunner` a secas: la vuelta va dentro de `conRelojDuro`', () => {
    const fuente = readFileSync('src/app/api/cron/runner/route.ts', 'utf8');
    expect(fuente).toMatch(/await conRelojDuro\(\s*\n\s*correrRunner\(/);
    // Y no queda ningún `await correrRunner(` suelto que se salte el techo.
    expect(fuente).not.toMatch(/await correrRunner\(/);
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

  it('fallo: `fallo` con el código estable, y sin racha previa NO se inventa un cero', async () => {
    correrRunner.mockRejectedValueOnce(Object.assign(new Error('relation "agente" does not exist'), { code: '42P01' }));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(500);
    // Sin latido previo la racha no se sabe, y «no se sabe» no es «es cero»
    // (regla 2): la llave se OMITE en vez de escribirse en 0.
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'fallo', { codigo: '42P01' });
  });

  // ── c7-31: EL ORDEN DE LA COLA DEL LATIDO ───────────────────────────────
  // El peor caso medido de la rama de corte son 25.2 s en serie (leerLatido 9.5
  // + Redis 1.2 + correo 5 + registrarLatido 9.5) contra un margen que eran 20.
  // Con el latido al final de la fila, lo primero que se perdía era justo lo
  // que el margen existe para proteger. Ahora late primero y grita después.
  it('en el tercer corte, el latido se escribe ANTES del correo al operador', async () => {
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'parcial', detalle: { cortesSeguidos: 2 } };
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp'], ['redactor']));
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido).toHaveBeenCalledTimes(1);
    expect(alertarOperador).toHaveBeenCalledTimes(1);
    expect(registrarLatido.mock.invocationCallOrder[0])
      .toBeLessThan(alertarOperador.mock.invocationCallOrder[0]);
  });

  it('y en la rama de FALLO también: primero el latido, después el correo', async () => {
    correrRunner.mockRejectedValueOnce(new Error('la lista de agentes no se leyó'));
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido.mock.invocationCallOrder[0])
      .toBeLessThan(alertarOperador.mock.invocationCallOrder[0]);
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

  it('con la racha ILEGIBLE el corte no se pierde: cuenta como el primero, se DICE y la pasada late igual', async () => {
    latidoIlegible = true;
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp'], ['redactor']));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(200);
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'parcial', expect.objectContaining({ cortesSeguidos: 1 }));
    // Fail-closed Y DECIRLO (regla 3): el `catch` no se traga la subcuenta.
    expect(logger.warn).toHaveBeenCalledWith('cron.runner.racha_ilegible', expect.anything());
  });

  // ── c7-32: UNA PASADA FALLIDA YA NO BORRA LA RACHA ──────────────────────
  // El latido de fallo escribía `{ codigo }` a secas, o sea que borraba
  // `cortesSeguidos`. Secuencia realizable: corte (racha 1) → fallo (racha
  // borrada) → corte → `?? 0` → racha 1 otra vez. Con fallos intercalados la
  // alerta de «tres pasadas seguidas» se difiere indefinidamente.
  it('un fallo ARRASTRA la racha en vez de borrarla: no suma, no reinicia, conserva', async () => {
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'parcial', detalle: { cortesSeguidos: 2 } };
    correrRunner.mockRejectedValueOnce(new Error('la base no contestó'));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(500);
    expect(registrarLatido).toHaveBeenCalledWith('runner', 'fallo', expect.objectContaining({ cortesSeguidos: 2 }));
  });

  it('corte → fallo → corte alerta al TERCERO: la racha sobrevivió al fallo intercalado', async () => {
    // Pasada 1: corta. La racha queda en 1.
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp'], ['redactor']));
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido).toHaveBeenLastCalledWith('runner', 'parcial', expect.objectContaining({ cortesSeguidos: 1 }));

    // Pasada 2: truena. El latido de fallo CONSERVA el 1 en vez de borrarlo.
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'parcial', detalle: { cortesSeguidos: 1 } };
    correrRunner.mockRejectedValueOnce(new Error('token vencido'));
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido).toHaveBeenLastCalledWith('runner', 'fallo', expect.objectContaining({ cortesSeguidos: 1 }));

    // Pasada 3: corta. Antes leía un detalle sin racha y volvía a 1; ahora va a 2.
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'fallo', detalle: { cortesSeguidos: 1 } };
    correrRunner.mockResolvedValue(conCorte(['kpi_whatsapp'], ['redactor']));
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(registrarLatido).toHaveBeenLastCalledWith('runner', 'parcial', expect.objectContaining({ cortesSeguidos: 2 }));
  });

  it('si en el fallo la racha NO se puede leer, se OMITE — jamás se escribe 0 (regla 2)', async () => {
    latidoIlegible = true;
    correrRunner.mockRejectedValueOnce(new Error('la base no contestó'));
    await GET(peticion('Bearer secreto-de-prueba'));
    const detalle = registrarLatido.mock.calls[0][2] as Record<string, unknown>;
    expect(detalle).not.toHaveProperty('cortesSeguidos');
    expect(logger.warn).toHaveBeenCalledWith('cron.runner.racha_ilegible_en_fallo', expect.anything());
  });
});
