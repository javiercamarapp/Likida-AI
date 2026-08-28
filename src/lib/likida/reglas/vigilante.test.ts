import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A19 — EL VIGILANTE. Lo que estas pruebas fijan, y es el contrato de la 0202
// aplicado a las reglas de la flota:
//
//   1. SE MANDA PRIMERO Y SE SELLA DESPUÉS. Un WhatsApp que no salió NO deja
//      sello: se reintenta a la corrida siguiente. Un sello puesto antes
//      convertiría un fallo de red en un aviso perdido para siempre.
//   2. Lo ya sellado NO vuelve a sonar; un CICLO nuevo sí.
//   3. El canal se reparte como en los relojes legales: lo que es dinero va a
//      quien ve dinero, lo que es operación al jefe de tráfico.
//   4. Una regla rota no deja sin vigilancia a las demás — ni a las de otras
//      flotas.
//   5. El mensaje CITA la frase que la persona confirmó y la evidencia
//      medida. Ni una cifra redactada.
// ═══════════════════════════════════════════════════════════════════════════

const sendText = vi.hoisted(() => vi.fn(async () => 'wamid.OK' as string | null));
const telefonoJefeDe = vi.hoisted(() => vi.fn(async () => '5210000000001' as string | null));
const telefonoParaDineroDe = vi.hoisted(() => vi.fn(async () => '5210000000002' as string | null));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const evaluar = vi.hoisted(() => vi.fn());
const reglasActivas = vi.hoisted(() => vi.fn());
const sellosDe = vi.hoisted(() => vi.fn(async () => new Set<string>()));
const sellarDisparos = vi.hoisted(() => vi.fn(async () => {}));
const anotarCorrida = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/meta/client', () => ({ sendText }));
vi.mock('../contactos', () => ({ telefonoJefeDe, telefonoParaDineroDe }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('./lectores', () => ({ evaluar }));
vi.mock('./repo', () => ({
  reglasActivas, sellosDe, sellarDisparos, anotarCorrida,
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
};
const REGLA_OPERACION = {
  ...REGLA_DINERO, id: 'r-2', plantilla: 'estadia_mayor_a' as const, params: { horas: 4 },
  frase: 'Voy a avisarte cuando una unidad acumule más de 4 horas…',
};

const DISPARO = { objeto: 'gasto' as const, objetoId: 'g-1', clave: '', evidencia: '$3,500.00 de casetas el 2026-08-27' };

beforeEach(() => {
  sendText.mockReset().mockResolvedValue('wamid.OK');
  telefonoJefeDe.mockReset().mockResolvedValue('5210000000001');
  telefonoParaDineroDe.mockReset().mockResolvedValue('5210000000002');
  evaluar.mockReset().mockResolvedValue([]);
  reglasActivas.mockReset().mockResolvedValue([]);
  sellosDe.mockReset().mockResolvedValue(new Set<string>());
  sellarDisparos.mockReset().mockResolvedValue(undefined);
  anotarCorrida.mockReset().mockResolvedValue(undefined);
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
  it('manda, SELLA DESPUÉS, y cuenta el disparo', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    const r = await vigilarReglas(AHORA);

    expect(r).toEqual({ reglas: 1, disparadas: 1, avisos: 1, fallos: 0 });
    expect(sendText).toHaveBeenCalledWith('5210000000002', expect.stringContaining('$3,500.00'));
    expect(sellarDisparos).toHaveBeenCalledWith('t-1', 'r-1', [DISPARO]);
    // El orden es el contrato: primero el envío, después el sello.
    expect(sendText.mock.invocationCallOrder[0]).toBeLessThan(sellarDisparos.mock.invocationCallOrder[0]);
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
    expect(sendText).not.toHaveBeenCalled();
    expect(r).toEqual({ reglas: 1, disparadas: 0, avisos: 0, fallos: 0 });
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
    expect(sendText).not.toHaveBeenCalled();
    expect(r).toEqual({ reglas: 1, disparadas: 0, avisos: 0, fallos: 0 });
  });

  it('varios casos nuevos salen en UN mensaje, no en cinco WhatsApps', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([
      DISPARO, { ...DISPARO, objetoId: 'g-2', evidencia: '$9,000.00 de casetas' },
    ]);
    const r = await vigilarReglas(AHORA);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(r.avisos).toBe(2);
    expect(r.disparadas).toBe(1);
  });
});

describe('lo que NO se sella', () => {
  it('si el WhatsApp no salió: no hay sello, y la corrida cuenta el fallo', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    sendText.mockResolvedValue(null);
    const r = await vigilarReglas(AHORA);
    expect(sellarDisparos).not.toHaveBeenCalled();
    expect(r.fallos).toBe(1);
    expect(r.avisos).toBe(0);
  });

  it('sin teléfono registrado tampoco se sella: cuando lo capturen, el aviso sale', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO]);
    evaluar.mockResolvedValue([DISPARO]);
    telefonoParaDineroDe.mockResolvedValue(null);
    const r = await vigilarReglas(AHORA);
    expect(sendText).not.toHaveBeenCalled();
    expect(sellarDisparos).not.toHaveBeenCalled();
    expect(r.fallos).toBe(1);
    // Es un problema de configuración que se arregla en un minuto: se dice.
    expect(logger.warn).toHaveBeenCalledWith('reglas.sin_destinatario', expect.objectContaining({ canal: 'dinero' }));
  });
});

describe('aislamiento entre reglas y entre flotas', () => {
  it('una regla que truena no deja sin vigilancia a la siguiente', async () => {
    reglasActivas.mockResolvedValue([REGLA_DINERO, { ...REGLA_OPERACION, tenantId: 't-2' }]);
    evaluar
      .mockRejectedValueOnce(new Error('relation does not exist'))
      .mockResolvedValueOnce([{ ...DISPARO, objeto: 'viaje', objetoId: 'v-9', clave: 'c' }]);
    const r = await vigilarReglas(AHORA);
    expect(r).toEqual({ reglas: 2, disparadas: 1, avisos: 1, fallos: 1 });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('reglas.regla_fallo', expect.objectContaining({ regla: 'r-1' }));
  });

  it('si no se pueden LEER las reglas, el barrido LANZA — ciego no es tranquilo', async () => {
    reglasActivas.mockRejectedValue(new Error('sin respuesta en 8000 ms'));
    await expect(vigilarReglas(AHORA)).rejects.toThrow(/sin respuesta/);
  });

  it('sin reglas activas la corrida es un cero honesto', async () => {
    const r = await vigilarReglas(AHORA);
    expect(r).toEqual({ reglas: 0, disparadas: 0, avisos: 0, fallos: 0 });
  });
});
