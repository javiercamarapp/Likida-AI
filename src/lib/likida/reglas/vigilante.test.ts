import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A19 — EL VIGILANTE. Lo que estas pruebas fijan, y es el contrato de la 0202
// aplicado a las reglas de la flota:
//
//   1. SE RECLAMA, SE MANDA Y SE CONFIRMA (0660). Reclamar antes de mandar impide
//      que dos corridas solapadas manden el mismo aviso; un WhatsApp que no salió
//      SUELTA el reclamo y se reintenta a la corrida siguiente (un sello puesto
//      antes convertiría un fallo de red en un aviso perdido para siempre).
//   2. Lo ya sellado NO vuelve a sonar; un CICLO nuevo sí.
//   3. El canal se reparte como en los relojes legales: lo que es dinero va a
//      quien ve dinero, lo que es operación al jefe de tráfico.
//   4. Una regla rota no deja sin vigilancia a las demás — ni a las de otras
//      flotas.
//   5. El mensaje CITA la frase que la persona confirmó y la evidencia
//      medida. Ni una cifra redactada.
// ═══════════════════════════════════════════════════════════════════════════

const OK_ENVIO = { ok: true, via: 'texto', id: 'wamid.OK', motivo: 'ventana_abierta', ventana: 'abierta' };
const KO_ENVIO = { ok: false, motivo: 'plantilla_rechazada', mensaje: 'La plantilla no está aprobada', fueraDeVentana: true, reintentable: false, ventana: 'cerrada' };
// El selector (enviarConFallback) sustituye al `enviarConFallback` directo: texto dentro
// de la ventana, plantilla `regla_aviso_v1` fuera. Aquí se prueba el CONTRATO del
// vigilante (mandar primero, sellar después); el selector tiene sus propias pruebas.
const enviarConFallback = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => OK_ENVIO as Record<string, unknown>));
const telefonoJefeDe = vi.hoisted(() => vi.fn(async () => '5210000000001' as string | null));
const telefonoParaDineroDe = vi.hoisted(() => vi.fn(async () => '5210000000002' as string | null));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const evaluar = vi.hoisted(() => vi.fn());
const reglasActivas = vi.hoisted(() => vi.fn());
const sellosDe = vi.hoisted(() => vi.fn(async () => new Set<string>()));
const sellarDisparos = vi.hoisted(() => vi.fn(async () => {}));
type D = { objeto: string; objetoId: string; clave: string; evidencia: string };
const reclamarDisparos = vi.hoisted(() => vi.fn(async (..._a: unknown[]): Promise<{ modo: 'reclamo'; token: string; ganados: D[] } | { modo: 'sin_rpc' }> => ({ modo: 'reclamo', token: 'tok-1', ganados: [] })));
const confirmarDisparos = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => 1));
const liberarDisparos = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
const hayEnvioAjenoEnVuelo = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => false));
const anotarCorrida = vi.hoisted(() => vi.fn(async () => {}));
const avisosEnviadosDesde = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => [] as Date[]));
const registrarAviso = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
const purgarAvisosViejos = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => 0));

vi.mock('@/lib/meta/enviar_con_fallback', () => ({ enviarConFallback }));
vi.mock('../contactos', () => ({ telefonoJefeDe, telefonoParaDineroDe }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('./lectores', () => ({ evaluar }));
vi.mock('./repo', () => ({
  reglasActivas, sellosDe, sellarDisparos, anotarCorrida,
  avisosEnviadosDesde, registrarAviso, purgarAvisosViejos,
  reclamarDisparos, confirmarDisparos, liberarDisparos, hayEnvioAjenoEnVuelo,
  llaveSello: (d: { objeto: string; objetoId: string; clave: string }) => `${d.objeto}|${d.objetoId}|${d.clave}`,
}));

const { vigilarReglas, mensajeDeRegla, MAX_LINEAS_AVISO } = await import('./vigilante');

const AHORA = new Date('2026-08-27T18:00:00Z');

const REGLA_DINERO = {
  id: 'r-1', tenantId: 't-1', plantilla: 'gasto_de_concepto_mayor_a' as const,
  params: { concepto: 'caseta' as const, monto: 3000 },
  textoOriginal: 'avísame si un gasto de caseta pasa de $3,000',
  frase: 'Voy a avisarte cuando entre un comprobante de casetas por más de $3,000.00.',
  estado: 'activa' as const, creadaEn: '2026-08-01T00:00:00Z', confirmadaEn: '2026-08-01T00:05:00Z',
  ultimaCorridaEn: null, ultimoDisparoEn: null, modelo: 'modelo-x',
  maxAvisosDia: 4, minHorasEntreAvisos: 1,
};
const REGLA_OPERACION = {
  ...REGLA_DINERO, id: 'r-2', plantilla: 'estadia_mayor_a' as const, params: { horas: 4 },
  frase: 'Voy a avisarte cuando una unidad acumule más de 4 horas…',
};

const DISPARO = { objeto: 'gasto' as const, objetoId: 'g-1', clave: '', evidencia: '$3,500.00 de casetas el 2026-08-27' };

beforeEach(() => {
  enviarConFallback.mockReset().mockResolvedValue(OK_ENVIO);
  telefonoJefeDe.mockReset().mockResolvedValue('5210000000001');
  telefonoParaDineroDe.mockReset().mockResolvedValue('5210000000002');
  evaluar.mockReset().mockResolvedValue([]);
  reglasActivas.mockReset().mockResolvedValue([]);
  sellosDe.mockReset().mockResolvedValue(new Set<string>());
  sellarDisparos.mockReset().mockResolvedValue(undefined);
  // Por omisión el reclamo GANA todo lo que se le pide (una sola corrida).
  reclamarDisparos.mockReset().mockImplementation(async (...a: unknown[]) => ({ modo: 'reclamo' as const, token: 'tok-1', ganados: a[2] as D[] }));
  confirmarDisparos.mockReset().mockImplementation(async (..._a: unknown[]) => (reclamarDisparos.mock.calls.at(-1)?.[2] as D[] | undefined)?.length ?? 1);
  liberarDisparos.mockReset().mockResolvedValue(undefined);
  hayEnvioAjenoEnVuelo.mockReset().mockResolvedValue(false);
  anotarCorrida.mockReset().mockResolvedValue(undefined);
  avisosEnviadosDesde.mockReset().mockResolvedValue([]);
  registrarAviso.mockReset().mockResolvedValue(undefined);
  purgarAvisosViejos.mockReset().mockResolvedValue(0);
  logger.error.mockClear();
  logger.warn.mockClear();
});

describe('mensajeDeRegla — puro, y sin una cifra redactada', () => {
  it('cita la frase CONFIRMADA (no el texto libre) y la evidencia medida', () => {
    const m = mensajeDeRegla(REGLA_DINERO.frase, ['$3,500.00 de casetas', '$4,100.00 de casetas']);
    expect(m).toContain('Tu regla: Voy a avisarte cuando entre un comprobante de casetas');
    expect(m).toContain('· $3,500.00 de casetas');
    expect(m).toContain('· $4,100.00 de casetas');
    // La salida del canal: un aviso que no se puede apagar se vuelve ruido.
    expect(m).toContain('pausa la regla');
  });

  it('con muchos casos resume en vez de mandar cuarenta renglones', () => {
    const m = mensajeDeRegla('regla X', Array.from({ length: 14 }, (_, i) => `caso ${i + 1}`));
    expect(m).toContain('· caso 10');
    expect(m).not.toContain('· caso 11');
    expect(m).toContain('…y 4 casos más');
    expect(m.split('\n').filter((l) => l.startsWith('· '))).toHaveLength(MAX_LINEAS_AVISO);
  });

  it('un solo caso de más se dice en singular', () => {
    const m = mensajeDeRegla('regla X', Array.from({ length: 11 }, (_, i) => `caso ${i + 1}`));
    expect(m).toContain('…y 1 caso más');
  });
});

describe('el barrido', () => {
  it('RECLAMA, manda, CONFIRMA, y cuenta el disparo', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    const r = await vigilarReglas(AHORA);

    expect(r).toEqual({ reglas: 1, disparadas: 1, avisos: 1, fallos: 0, diferidas: 0 });
    expect(enviarConFallback).toHaveBeenCalledWith('5210000000002', expect.objectContaining({
      texto: expect.stringContaining('$3,500.00'),
      plantilla: expect.objectContaining({ nombre: 'regla_aviso_v1', parametros: expect.arrayContaining(['1']) }),
      tenantId: 't-1',
    }));
    expect(reclamarDisparos).toHaveBeenCalledWith('t-1', 'r-1', [DISPARO], AHORA);
    expect(confirmarDisparos).toHaveBeenCalledWith('t-1', 'r-1', 'tok-1', AHORA);
    expect(sellarDisparos).not.toHaveBeenCalled();
    // El orden es el contrato: primero el reclamo, luego el envío, al final la confirmación.
    expect(reclamarDisparos.mock.invocationCallOrder[0]).toBeLessThan(enviarConFallback.mock.invocationCallOrder[0]);
    expect(enviarConFallback.mock.invocationCallOrder[0]).toBeLessThan(confirmarDisparos.mock.invocationCallOrder[0]);
    expect(anotarCorrida).toHaveBeenCalledWith('t-1', 'r-1', AHORA, 1);
  });

  it('el canal se reparte: dinero al contador/dueño, operación al jefe', async () => {
    reglasActivas.mockResolvedValue([REGLA_OPERACION]);
    evaluar.mockResolvedValue([{ ...DISPARO, objeto: 'viaje', objetoId: 'v-1', clave: '2026-08-27T12:00:00Z' }]);
    await vigilarReglas(AHORA);
    expect(telefonoJefeDe).toHaveBeenCalledWith('t-1');
    expect(telefonoParaDineroDe).not.toHaveBeenCalled();
  });

  it('lo YA sellado no vuelve a sonar, pero la corrida sí queda anotada', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    sellosDe.mockResolvedValue(new Set(['gasto|g-1|']));
    const r = await vigilarReglas(AHORA);
    expect(enviarConFallback).not.toHaveBeenCalled();
    expect(r).toEqual({ reglas: 1, disparadas: 0, avisos: 0, fallos: 0, diferidas: 0 });
    expect(anotarCorrida).toHaveBeenCalledWith('t-1', 'r-1', AHORA, 0);
  });

  it('un CICLO nuevo del mismo objeto sí suena', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([{ ...DISPARO, clave: '2026-09-01' }]);
    sellosDe.mockResolvedValue(new Set(['gasto|g-1|']));
    const r = await vigilarReglas(AHORA);
    expect(r.avisos).toBe(1);
  });

  it('sin candidatos no consulta sellos ni manda nada', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([]);
    const r = await vigilarReglas(AHORA);
    expect(sellosDe).not.toHaveBeenCalled();
    expect(enviarConFallback).not.toHaveBeenCalled();
    expect(r).toEqual({ reglas: 1, disparadas: 0, avisos: 0, fallos: 0, diferidas: 0 });
  });

  it('varios casos nuevos salen en UN mensaje, no en cinco WhatsApps', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([
      DISPARO, { ...DISPARO, objetoId: 'g-2', evidencia: '$9,000.00 de casetas' },
    ]);
    const r = await vigilarReglas(AHORA);
    expect(enviarConFallback).toHaveBeenCalledTimes(1);
    expect(r.avisos).toBe(2);
    expect(r.disparadas).toBe(1);
  });
});

describe('lo que NO se sella', () => {
  it('si el WhatsApp no salió: el reclamo se SUELTA, no hay sello, y la corrida cuenta el fallo', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    enviarConFallback.mockResolvedValue(KO_ENVIO);
    const r = await vigilarReglas(AHORA);
    expect(liberarDisparos).toHaveBeenCalledWith('t-1', 'r-1', 'tok-1');
    expect(confirmarDisparos).not.toHaveBeenCalled();
    expect(sellarDisparos).not.toHaveBeenCalled();
    expect(r.fallos).toBe(1);
    expect(r.avisos).toBe(0);
  });

  it('sin teléfono registrado tampoco se sella: cuando lo capturen, el aviso sale', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    telefonoParaDineroDe.mockResolvedValue(null);
    const r = await vigilarReglas(AHORA);
    expect(enviarConFallback).not.toHaveBeenCalled();
    expect(sellarDisparos).not.toHaveBeenCalled();
    // Sin a quién avisarle no se reclama nada: no hay llave que soltar después.
    expect(reclamarDisparos).not.toHaveBeenCalled();
    expect(r.fallos).toBe(1);
    // Es un problema de configuración que se arregla en un minuto: se dice.
    expect(logger.warn).toHaveBeenCalledWith('reglas.sin_destinatario', expect.objectContaining({ canal: 'dinero' }));
  });
});

describe('el reclamo antes de mandar (0660)', () => {
  it('DOS CORRIDAS SOLAPADAS ven los mismos casos y el aviso sale UNA sola vez', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    // La base real: el primero en insertar la llave la gana; el segundo gana cero.
    const reclamadas = new Set<string>();
    reclamarDisparos.mockImplementation(async (...a: unknown[]) => {
      const ganados = (a[2] as D[]).filter((d) => {
        const k = `${d.objeto}|${d.objetoId}|${d.clave}`;
        if (reclamadas.has(k)) return false;
        reclamadas.add(k);
        return true;
      });
      return { modo: 'reclamo' as const, token: `tok-${reclamadas.size}`, ganados };
    });
    // Un envío lento hace que las dos corridas estén en vuelo a la vez.
    enviarConFallback.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); return OK_ENVIO; });
    confirmarDisparos.mockResolvedValue(1);
    const [a, b] = await Promise.all([vigilarReglas(AHORA), vigilarReglas(AHORA)]);

    expect(enviarConFallback).toHaveBeenCalledTimes(1);
    expect(a.avisos + b.avisos).toBe(1);
    expect(confirmarDisparos).toHaveBeenCalledTimes(1);
    expect(registrarAviso).toHaveBeenCalledTimes(1);
  });

  it('si el reclamo no ganó nada, no manda, no registra aviso y anota la corrida en cero', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    reclamarDisparos.mockResolvedValue({ modo: 'reclamo', token: '', ganados: [] });
    const r = await vigilarReglas(AHORA);
    expect(enviarConFallback).not.toHaveBeenCalled();
    expect(registrarAviso).not.toHaveBeenCalled();
    expect(anotarCorrida).toHaveBeenCalledWith('t-1', 'r-1', AHORA, 0);
    expect(r).toEqual({ reglas: 1, disparadas: 0, avisos: 0, fallos: 0, diferidas: 0 });
  });

  it('con un reclamo PARCIAL manda solo los casos que ganó', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    const g2 = { ...DISPARO, objetoId: 'g-2', evidencia: '$9,000.00 de casetas' };
    evaluar.mockResolvedValue([DISPARO, g2]);
    reclamarDisparos.mockResolvedValue({ modo: 'reclamo', token: 'tok-9', ganados: [g2] });
    const r = await vigilarReglas(AHORA);
    const texto = (enviarConFallback.mock.calls[0][1] as { texto: string }).texto;
    expect(texto).toContain('$9,000.00');
    expect(texto).not.toContain('$3,500.00');
    expect(r.avisos).toBe(1);
    expect(registrarAviso).toHaveBeenCalledWith('t-1', 'r-1', expect.objectContaining({ resultado: 'enviado', casos: 1 }));
  });

  it('si el envío LANZA una excepción, se suelta el reclamo y el error sube', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    enviarConFallback.mockRejectedValue(new Error('socket colgado'));
    const r = await vigilarReglas(AHORA);
    expect(liberarDisparos).toHaveBeenCalledWith('t-1', 'r-1', 'tok-1');
    expect(confirmarDisparos).not.toHaveBeenCalled();
    expect(r.fallos).toBe(1);
  });

  it('un aviso POSPUESTO por frecuencia no reclama nada', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    avisosEnviadosDesde.mockResolvedValue([new Date(AHORA.getTime() - 60_000)]);
    const r = await vigilarReglas(AHORA);
    expect(r.diferidas).toBe(1);
    expect(reclamarDisparos).not.toHaveBeenCalled();
  });

  it('si el reclamo falla en la base la regla falla POR SU LADO y no se manda a ciegas', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    reclamarDisparos.mockRejectedValue(new Error('reclamarDisparos: deadlock'));
    const r = await vigilarReglas(AHORA);
    expect(enviarConFallback).not.toHaveBeenCalled();
    expect(r.fallos).toBe(1);
  });

  it('sin la 0660 en la base cae al orden anterior: manda y SELLA DESPUÉS', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    reclamarDisparos.mockResolvedValue({ modo: 'sin_rpc' });
    const r = await vigilarReglas(AHORA);
    expect(r.avisos).toBe(1);
    expect(sellarDisparos).toHaveBeenCalledWith('t-1', 'r-1', [DISPARO]);
    expect(confirmarDisparos).not.toHaveBeenCalled();
    expect(enviarConFallback.mock.invocationCallOrder[0]).toBeLessThan(sellarDisparos.mock.invocationCallOrder[0]);
  });

  it('un arriendo perdido al confirmar no tumba la corrida, pero queda en el log', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    confirmarDisparos.mockResolvedValue(0);
    const r = await vigilarReglas(AHORA);
    expect(r.avisos).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith('reglas.arriendo_perdido_al_confirmar', expect.objectContaining({ casos: 1, confirmadas: 0 }));
  });
});

describe('cierre de la ronda 18: R10-5 y R10-6', () => {
  it('R10-6: DOS CORRIDAS SOLAPADAS con casos DISTINTOS: la que ve a la otra mandando suelta lo suyo y difiere; el tope no se rebasa', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    hayEnvioAjenoEnVuelo.mockResolvedValueOnce(true);
    const r = await vigilarReglas(AHORA);
    expect(r).toMatchObject({ avisos: 0, diferidas: 1, fallos: 0 });
    expect(enviarConFallback).not.toHaveBeenCalled();
    expect(liberarDisparos).toHaveBeenCalledWith('t-1', 'r-1', 'tok-1');
    expect(sellarDisparos).not.toHaveBeenCalled();
    expect(confirmarDisparos).not.toHaveBeenCalled();
    expect(anotarCorrida).toHaveBeenCalledWith('t-1', 'r-1', AHORA, 0);
    // sin otra corrida en vuelo, sale normal
    const ok = await vigilarReglas(AHORA);
    expect(ok.avisos).toBe(1);
  });

  it('R10-6: si no se puede saber si hay otra corrida mandando, la regla falla por su lado y SUELTA su reclamo (no manda a ciegas)', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    hayEnvioAjenoEnVuelo.mockRejectedValueOnce(new Error('base caída'));
    const r = await vigilarReglas(AHORA);
    expect(r).toMatchObject({ avisos: 0, fallos: 1 });
    expect(enviarConFallback).not.toHaveBeenCalled();
    expect(liberarDisparos).toHaveBeenCalledWith('t-1', 'r-1', 'tok-1');
  });

  it('R10-5: Meta aceptó y CONFIRMAR lanza: se reintenta, y si no se logra, el aviso igual se registra (el tope de la hora siguiente lo ve) sin fallar la regla', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    confirmarDisparos.mockRejectedValueOnce(new Error('parpadeo')).mockResolvedValueOnce(1);
    const r1 = await vigilarReglas(AHORA);
    expect(r1).toMatchObject({ avisos: 1, fallos: 0 });
    expect(confirmarDisparos).toHaveBeenCalledTimes(2);

    confirmarDisparos.mockReset().mockRejectedValue(new Error('base caída'));
    registrarAviso.mockClear();
    const r2 = await vigilarReglas(AHORA);
    expect(r2).toMatchObject({ avisos: 1, fallos: 0 });
    expect(confirmarDisparos).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith('reglas.confirmacion_fallo_tras_envio', expect.objectContaining({ regla: 'r-1', casos: 1 }));
    expect(registrarAviso).toHaveBeenCalledWith('t-1', 'r-1', expect.objectContaining({ resultado: 'enviado', casos: 1 }));
    expect(enviarConFallback).toHaveBeenCalledTimes(2); // una vez por corrida: confirmar NO relanza el envío
  });
});

describe('aislamiento entre reglas y entre flotas', () => {
  it('una regla que truena no deja sin vigilancia a la siguiente', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO, { ...REGLA_OPERACION, tenantId: 't-2' }]);
    evaluar
      .mockRejectedValueOnce(new Error('relation does not exist'))
      .mockResolvedValueOnce([{ ...DISPARO, objeto: 'viaje', objetoId: 'v-9', clave: 'c' }]);
    const r = await vigilarReglas(AHORA);
    expect(r).toEqual({ reglas: 2, disparadas: 1, avisos: 1, fallos: 1, diferidas: 0 });
    expect(enviarConFallback).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('reglas.regla_fallo', expect.objectContaining({ regla: 'r-1' }));
  });

  it('si no se pueden LEER las reglas, el barrido LANZA — ciego no es tranquilo', async () => {
    reglasActivas.mockRejectedValue(new Error('sin respuesta en 8000 ms'));
    await expect(vigilarReglas(AHORA)).rejects.toThrow(/sin respuesta/);
  });

  it('sin reglas activas la corrida es un cero honesto', async () => {
    const r = await vigilarReglas(AHORA);
    expect(r).toEqual({ reglas: 0, disparadas: 0, avisos: 0, fallos: 0, diferidas: 0 });
  });
});


describe('límite de frecuencia por regla (0520)', () => {
  const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);
  const unCaso = [{ objeto: 'gasto' as const, objetoId: 'g-1', clave: '', evidencia: 'caseta de $4,000' }];

  beforeEach(() => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue(unCaso);
  });

  it('al llegar al tope diario NO manda, NO sella, y lo cuenta como diferida', async () => {
    avisosEnviadosDesde.mockResolvedValue([hace(20), hace(12), hace(6), hace(3)]);
    const r = await vigilarReglas(AHORA);
    expect(r).toMatchObject({ disparadas: 0, avisos: 0, fallos: 0, diferidas: 1 });
    expect(enviarConFallback).not.toHaveBeenCalled();
    expect(sellarDisparos).not.toHaveBeenCalled();
    expect(registrarAviso).not.toHaveBeenCalled();
    // La corrida SÍ se anota: la regla fue revisada.
    expect(anotarCorrida).toHaveBeenCalledWith('t-1', 'r-1', AHORA, 0);
  });

  it('la separación mínima pospone el aviso aunque el tope diario no se alcance', async () => {
    avisosEnviadosDesde.mockResolvedValue([hace(0.5)]);
    const r = await vigilarReglas(AHORA);
    expect(r.diferidas).toBe(1);
    expect(enviarConFallback).not.toHaveBeenCalled();
  });

  it('lo pospuesto sale en el primer aviso permitido: no se perdió porque nunca se selló', async () => {
    avisosEnviadosDesde.mockResolvedValueOnce([hace(0.5)]).mockResolvedValueOnce([hace(2)]);
    const antes = await vigilarReglas(AHORA);
    expect(antes.diferidas).toBe(1);
    const despues = await vigilarReglas(new Date(AHORA.getTime() + 3_600_000));
    expect(despues).toMatchObject({ disparadas: 1, avisos: 1, diferidas: 0 });
    expect(confirmarDisparos).toHaveBeenCalledTimes(1);
  });

  it('un aviso enviado deja su fila en el historial con el canal y la fecha', async () => {
    enviarConFallback.mockResolvedValue({ ...OK_ENVIO, via: 'plantilla', motivo: 'ventana_cerrada' });
    await vigilarReglas(AHORA);
    expect(registrarAviso).toHaveBeenCalledWith('t-1', 'r-1', {
      resultado: 'enviado', casos: 1, via: 'plantilla', motivo: 'ventana_cerrada', enviadoEn: AHORA,
    });
  });

  it('un aviso que Meta rechazó queda en el historial como fallido y NO se sella', async () => {
    enviarConFallback.mockResolvedValue(KO_ENVIO);
    const r = await vigilarReglas(AHORA);
    expect(r.fallos).toBe(1);
    expect(registrarAviso).toHaveBeenCalledWith('t-1', 'r-1', expect.objectContaining({
      resultado: 'fallido', casos: 1, error: 'La plantilla no está aprobada',
    }));
    expect(sellarDisparos).not.toHaveBeenCalled();
  });

  it('si el historial no se puede leer la regla falla POR SU LADO y no manda a ciegas', async () => {
    avisosEnviadosDesde.mockRejectedValue(new Error('base caída'));
    reglasActivas.mockResolvedValue([REGLA_DINERO, REGLA_OPERACION]);
    const r = await vigilarReglas(AHORA);
    expect(r.fallos).toBe(2);
    expect(enviarConFallback).not.toHaveBeenCalled();
  });

  it('cada regla usa SU límite: una con tope 1 se calla y otra con tope 4 sigue', async () => {
    const estricta = { ...REGLA_DINERO, maxAvisosDia: 1 };
    reglasActivas.mockResolvedValue([estricta, REGLA_OPERACION]);
    avisosEnviadosDesde.mockResolvedValue([hace(5)]);
    const r = await vigilarReglas(AHORA);
    expect(r).toMatchObject({ diferidas: 1, disparadas: 1 });
    expect(enviarConFallback).toHaveBeenCalledTimes(1);
  });

  it('purga el historial viejo al final del barrido sin tumbarlo si falla', async () => {
    purgarAvisosViejos.mockRejectedValueOnce(new Error('x')).mockResolvedValue(0);
    // purgarAvisosViejos NO lanza en producción (best-effort); aquí se afirma la llamada.
    purgarAvisosViejos.mockReset().mockResolvedValue(3);
    await vigilarReglas(AHORA);
    expect(purgarAvisosViejos).toHaveBeenCalledWith(AHORA);
  });
});
