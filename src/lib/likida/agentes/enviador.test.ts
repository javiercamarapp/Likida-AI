import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL ENVIADOR (0217) — los contratos del envío automático:
//  · Canal sin configurar: corrida en FALLO que lo dice — jamás un 0/0 verde.
//  · La lista de bajas es FAIL-CLOSED y el principal suprimido NO se envía.
//  · La resolución automática va anclada a `pendiente`: si un humano resolvió
//    en la ventana, la pieza es suya.
//  · El envío pasa por la puerta de siempre (enviarPiezaPorCorreo) con las
//    copias YA filtradas de suprimidos.
//  · suprimirCorreo es idempotente y jamás lanza hacia el webhook.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data: unknown; error: { message: string; code?: string } | null }>>();
// AGB-3: registro de llamadas por tabla — para poder afirmar QUÉ filtro se
// mandó, no solo qué devolvió el mock (el `.not('prospecto.correo', ...)`
// tiene que quedar en la consulta real, no solo filtrarse en memoria).
const llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = [];
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  const encadenar = (metodo: string) => (...args: unknown[]) => { llamadas.push({ tabla, metodo, args }); return b; };
  Object.assign(b, {
    select: encadenar('select'), eq: encadenar('eq'), is: encadenar('is'), in: encadenar('in'),
    lte: encadenar('lte'), or: encadenar('or'), not: encadenar('not'),
    limit: () => b, order: () => b, update: () => b, insert: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let apagado = false;
vi.mock('../interruptores', () => ({ estaApagado: async () => apagado }));

let canal = true;
vi.mock('@/lib/correo/enviar', () => ({ correoConfigurado: () => canal }));

const enviarPiezaPorCorreo = vi.fn(async (..._a: unknown[]) => ({ ok: true, destinatario: 'c@x.mx', providerId: 'prov-1' }));
vi.mock('./cola', () => ({
  enviarPiezaPorCorreo: (...a: unknown[]) => enviarPiezaPorCorreo(...a),
  topeCorreoFrioDia: () => 30,
  TIPOS_CAMPANA: ['correo_frio', 'correo_seguimiento'],
  // La réplica del filtrado real (que ahora vive en cola.ts, c5-1 — y allá
  // tiene sus propias pruebas): misma normalización, mismo fail-closed.
  filtrarSuprimidos: async (correos: string[]) => {
    const limpios = [...new Set(correos.map((c) => c.trim().toLowerCase()).filter(Boolean))];
    if (limpios.length === 0) return [];
    const cola = respuestas.get('correo_suprimido');
    const r = cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
    if (r.error) throw new Error(`filtrarSuprimidos: ${r.error.message}`);
    const fuera = new Set(((r.data ?? []) as Array<{ correo: string }>).map((f) => f.correo));
    return limpios.filter((c) => !fuera.has(c));
  },
}));
const registrarCorrida = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));

const { correrEnviador, filtrarSuprimidos, suprimirCorreo, ventanaRevisionMin, autoaprobarActivo } = await import('./enviador');

const PIEZA = {
  id: 'pieza-0000-1111', tipo: 'correo_frio', estado: 'pendiente', prospecto_id: 'pr-1',
  prospecto: { empresa: 'Transportes X', correo: 'c@x.mx' },
};

const ENCENDIDO_ANTES = process.env.LIKIDA_ENVIADOR_ENCENDIDO;
const VENTANA_ANTES = process.env.LIKIDA_ENVIADOR_VENTANA_MIN;
const AUTOAPROBAR_ANTES = process.env.LIKIDA_ENVIADOR_AUTOAPROBAR;
afterAll(() => {
  if (ENCENDIDO_ANTES === undefined) delete process.env.LIKIDA_ENVIADOR_ENCENDIDO;
  else process.env.LIKIDA_ENVIADOR_ENCENDIDO = ENCENDIDO_ANTES;
  if (VENTANA_ANTES === undefined) delete process.env.LIKIDA_ENVIADOR_VENTANA_MIN;
  else process.env.LIKIDA_ENVIADOR_VENTANA_MIN = VENTANA_ANTES;
  if (AUTOAPROBAR_ANTES === undefined) delete process.env.LIKIDA_ENVIADOR_AUTOAPROBAR;
  else process.env.LIKIDA_ENVIADOR_AUTOAPROBAR = AUTOAPROBAR_ANTES;
});

beforeEach(() => {
  respuestas.clear();
  llamadas.length = 0;
  apagado = false;
  canal = true;
  enviarPiezaPorCorreo.mockClear();
  registrarCorrida.mockClear();
  // El interruptor MAESTRO (envío autónomo acotado, 29-ago-2026): arranca
  // apagado por default, así que el grueso de este archivo —que prueba OTRA
  // cosa— lo enciende aquí; el describe dedicado más abajo lo apaga a
  // propósito para probar el default real.
  process.env.LIKIDA_ENVIADOR_ENCENDIDO = 'true';
  delete process.env.LIKIDA_ENVIADOR_VENTANA_MIN;
  delete process.env.LIKIDA_ENVIADOR_AUTOAPROBAR;
});

describe('el interruptor MAESTRO — apagado por default (envío autónomo acotado)', () => {
  it('ausente: no manda nada, sin siquiera consultar el kill switch de incidente', async () => {
    delete process.env.LIKIDA_ENVIADOR_ENCENDIDO;
    await expect(correrEnviador()).rejects.toThrow(/APAGADO/);
    expect(enviarPiezaPorCorreo).not.toHaveBeenCalled();
  });

  it('cualquier valor que no sea exactamente "true" cuenta como apagado', async () => {
    process.env.LIKIDA_ENVIADOR_ENCENDIDO = 'si';
    await expect(correrEnviador()).rejects.toThrow(/APAGADO/);
    process.env.LIKIDA_ENVIADOR_ENCENDIDO = '1';
    await expect(correrEnviador()).rejects.toThrow(/APAGADO/);
  });

  it('con "true", pasa este candado y llega al kill switch de incidente (que sigue apagándolo si toca)', async () => {
    apagado = true;
    await expect(correrEnviador()).rejects.toThrow(/enviador está apagado/);
  });
});

describe('correrEnviador', () => {
  it('apagado (kill switch): no envía nada', async () => {
    apagado = true;
    await expect(correrEnviador()).rejects.toThrow(/apagado/);
    expect(enviarPiezaPorCorreo).not.toHaveBeenCalled();
  });

  it('canal sin configurar: corrida en FALLO que lo dice — no un 0/0 verde', async () => {
    canal = false;
    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(0);
    expect(r.motivos).toContain('canal sin configurar');
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'enviador', expect.objectContaining({ estado: 'fallo' }));
  });

  it('el camino feliz: aprueba automático, filtra suprimidos y envía con las copias de la empresa', async () => {
    process.env.LIKIDA_ENVIADOR_AUTOAPROBAR = 'si'; // AGB-1: candado de profundidad exige la palanca explícita
    respuestas.set('cola_aprobacion', [
      { data: [PIEZA], error: null },                                  // candidatas
      { data: [{ id: PIEZA.id }], error: null },                        // auto-aprobación (claim)
    ]);
    respuestas.set('prospecto_correo', [{ data: [{ correo: 'ventas@x.mx' }, { correo: 'gerencia@x.mx' }], error: null }]);
    respuestas.set('correo_suprimido', [{ data: [{ correo: 'gerencia@x.mx' }], error: null }]);
    respuestas.set('prospecto', [{ data: [], error: null }]);           // estado → contactado

    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(1);
    // El suprimido NO viaja: solo la copia viva.
    expect(enviarPiezaPorCorreo).toHaveBeenCalledWith(PIEZA.id, null, ['ventas@x.mx']);
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'enviador', expect.objectContaining({ estado: 'ok' }));
  });

  it('el principal en la lista de bajas: la pieza se SALTA con el motivo dicho', async () => {
    respuestas.set('cola_aprobacion', [{ data: [PIEZA], error: null }]);
    respuestas.set('prospecto_correo', [{ data: [], error: null }]);
    respuestas.set('correo_suprimido', [{ data: [{ correo: 'c@x.mx' }], error: null }]);
    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(0);
    expect(r.saltadas).toBe(1);
    expect(r.motivos.join(' ')).toMatch(/lista de bajas/);
    expect(enviarPiezaPorCorreo).not.toHaveBeenCalled();
  });

  it('la lista de bajas ILEGIBLE: fail closed — la pieza no sale', async () => {
    respuestas.set('cola_aprobacion', [{ data: [PIEZA], error: null }]);
    respuestas.set('prospecto_correo', [{ data: [], error: null }]);
    respuestas.set('correo_suprimido', [{ data: null, error: { message: 'db down' } }]);
    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(0);
    expect(r.saltadas).toBe(1);
    expect(enviarPiezaPorCorreo).not.toHaveBeenCalled();
  });

  it('un humano resolvió la pieza durante la ventana: la máquina no la pisa', async () => {
    process.env.LIKIDA_ENVIADOR_AUTOAPROBAR = 'si'; // AGB-1: sin la palanca, la pendiente ni intenta el claim
    respuestas.set('cola_aprobacion', [
      { data: [PIEZA], error: null },
      { data: [], error: null },                                        // claim: cero filas
    ]);
    respuestas.set('prospecto_correo', [{ data: [], error: null }]);
    respuestas.set('correo_suprimido', [{ data: [], error: null }]);
    const r = await correrEnviador();
    expect(r.saltadas).toBe(1);
    expect(r.motivos.join(' ')).toMatch(/humano/);
    expect(enviarPiezaPorCorreo).not.toHaveBeenCalled();
  });

  it('sin correo principal capturado: se salta con el motivo, el lote sigue', async () => {
    respuestas.set('cola_aprobacion', [{ data: [{ ...PIEZA, prospecto: { empresa: 'X', correo: null } }], error: null }]);
    const r = await correrEnviador();
    expect(r.saltadas).toBe(1);
    expect(r.motivos.join(' ')).toMatch(/correo principal/);
  });
});

describe('filtrarSuprimidos', () => {
  it('normaliza a minúsculas, deduplica y quita los suprimidos', async () => {
    respuestas.set('correo_suprimido', [{ data: [{ correo: 'baja@x.mx' }], error: null }]);
    const r = await filtrarSuprimidos(['A@x.mx', 'a@x.mx', 'BAJA@x.mx', 'ok@x.mx']);
    expect(r).toEqual(['a@x.mx', 'ok@x.mx']);
  });
});

describe('suprimirCorreo — idempotente y sin lanzar', () => {
  it('el duplicado (23505) no es error', async () => {
    respuestas.set('correo_suprimido', [{ data: null, error: { message: 'dup', code: '23505' } }]);
    await expect(suprimirCorreo('ya@x.mx', 'rebote')).resolves.toBeUndefined();
  });
  it('un formato roto se ignora sin tocar la base', async () => {
    await expect(suprimirCorreo('no-es-correo', 'rebote')).resolves.toBeUndefined();
  });
});

describe('c5-6 — las aprobadas automáticas SIN enviar se retoman ("sale mañana" tiene que ser verdad)', () => {
  it('una pieza ya aprobada por la máquina se envía sin re-aprobar', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{ ...PIEZA, estado: 'aprobado' }], error: null },   // candidatas
    ]);
    respuestas.set('prospecto_correo', [{ data: [], error: null }]);
    respuestas.set('correo_suprimido', [{ data: [], error: null }]);
    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(1);
    // Sin update de auto-aprobación: la única escritura sobre cola la hace
    // enviarPiezaPorCorreo (mockeado) — el paso de aprobar se saltó.
    expect(enviarPiezaPorCorreo).toHaveBeenCalledWith(PIEZA.id, null, []);
  });

  it('una pendiente madura sigue pasando por la auto-aprobación anclada', async () => {
    process.env.LIKIDA_ENVIADOR_AUTOAPROBAR = 'si'; // AGB-1: la palanca es la que habilita esta ruta
    respuestas.set('cola_aprobacion', [
      { data: [{ ...PIEZA, estado: 'pendiente' }], error: null }, // candidatas
      { data: [{ id: PIEZA.id }], error: null },                  // la auto-aprobación
    ]);
    respuestas.set('prospecto_correo', [{ data: [], error: null }]);
    respuestas.set('correo_suprimido', [{ data: [], error: null }]);
    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AGB-1 (auditoría 24, 1-sep-2026) — el correo del 28-ago salió con ventana 0
// y auto-aprobación sin candado. Estas pruebas cubren los dos candados nuevos.
// ═══════════════════════════════════════════════════════════════════════════
describe('AGB-1 — ventanaRevisionMin nunca es 0', () => {
  it('sin LIKIDA_ENVIADOR_VENTANA_MIN: default de 24 h (1,440 min), no 0', () => {
    delete process.env.LIKIDA_ENVIADOR_VENTANA_MIN;
    expect(ventanaRevisionMin()).toBe(24 * 60);
  });

  it('con "0" a propósito: el piso de 1 h se impone — nunca inmediato', () => {
    process.env.LIKIDA_ENVIADOR_VENTANA_MIN = '0';
    expect(ventanaRevisionMin()).toBe(60);
  });

  it('con un valor negativo: mismo piso de 1 h', () => {
    process.env.LIKIDA_ENVIADOR_VENTANA_MIN = '-30';
    expect(ventanaRevisionMin()).toBe(60);
  });

  it('con un valor explícito por encima del piso: se respeta tal cual', () => {
    process.env.LIKIDA_ENVIADOR_VENTANA_MIN = '180';
    expect(ventanaRevisionMin()).toBe(180);
  });

  it('con basura no numérica: cae al default de 24 h', () => {
    process.env.LIKIDA_ENVIADOR_VENTANA_MIN = 'no-es-numero';
    expect(ventanaRevisionMin()).toBe(24 * 60);
  });
});

describe('AGB-1 — autoaprobarActivo, default "no"', () => {
  it('ausente: apagado', () => {
    delete process.env.LIKIDA_ENVIADOR_AUTOAPROBAR;
    expect(autoaprobarActivo()).toBe(false);
  });

  it('cualquier valor que no sea exactamente "si" cuenta como apagado', () => {
    process.env.LIKIDA_ENVIADOR_AUTOAPROBAR = 'true';
    expect(autoaprobarActivo()).toBe(false);
    process.env.LIKIDA_ENVIADOR_AUTOAPROBAR = 'yes';
    expect(autoaprobarActivo()).toBe(false);
  });

  it('"si" exacto: encendido', () => {
    process.env.LIKIDA_ENVIADOR_AUTOAPROBAR = 'si';
    expect(autoaprobarActivo()).toBe(true);
  });
});

describe('AGB-1 — con la palanca de autoaprobación en default, la pieza NO se envía', () => {
  it('una candidata pendiente no se auto-aprueba ni se manda: se salta con el motivo dicho', async () => {
    delete process.env.LIKIDA_ENVIADOR_AUTOAPROBAR; // default: 'no'
    // Aunque la consulta real filtraría esta fila (solo aprobado+humano), la
    // prueba fuerza que una `pendiente` SÍ llegue al lote — el candado de
    // profundidad tiene que rechazarla igual, sin depender solo del filtro.
    respuestas.set('cola_aprobacion', [{ data: [PIEZA], error: null }]);
    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(0);
    expect(r.saltadas).toBe(1);
    expect(r.motivos.join(' ')).toMatch(/autoaprobación desactivada/);
    expect(enviarPiezaPorCorreo).not.toHaveBeenCalled();
  });

  it('con la palanca encendida ("si"), la misma pieza pendiente sí se aprueba y se manda', async () => {
    process.env.LIKIDA_ENVIADOR_AUTOAPROBAR = 'si';
    respuestas.set('cola_aprobacion', [
      { data: [PIEZA], error: null },
      { data: [{ id: PIEZA.id }], error: null },
    ]);
    respuestas.set('prospecto_correo', [{ data: [], error: null }]);
    respuestas.set('correo_suprimido', [{ data: [], error: null }]);
    respuestas.set('prospecto', [{ data: [], error: null }]);
    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(1);
    expect(enviarPiezaPorCorreo).toHaveBeenCalledWith(PIEZA.id, null, []);
  });

  it('una pieza ya aprobada por un HUMANO se manda igual, con la palanca en default', async () => {
    delete process.env.LIKIDA_ENVIADOR_AUTOAPROBAR;
    respuestas.set('cola_aprobacion', [
      { data: [{ ...PIEZA, estado: 'aprobado' }], error: null },
    ]);
    respuestas.set('prospecto_correo', [{ data: [], error: null }]);
    respuestas.set('correo_suprimido', [{ data: [], error: null }]);
    respuestas.set('prospecto', [{ data: [], error: null }]);
    const r = await correrEnviador();
    expect(r.piezasEnviadas).toBe(1);
    expect(enviarPiezaPorCorreo).toHaveBeenCalledWith(PIEZA.id, null, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AGB-3 (auditoría 24) — las 10 candidatas más viejas eran sistemáticamente
// piezas de prospectos SIN correo (medido en producción): con un `limit` fijo
// nunca le tocaba turno a una pieza CON correo. La consulta ahora excluye
// `prospecto.correo is null` en la BASE, no en el bucle.
// ═══════════════════════════════════════════════════════════════════════════
describe('AGB-3 — la consulta de candidatas excluye prospectos sin correo en la base', () => {
  it('la consulta a cola_aprobacion trae el join !inner y el filtro not-is-null sobre prospecto.correo', async () => {
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    await correrEnviador();
    const select = llamadas.find((l) => l.tabla === 'cola_aprobacion' && l.metodo === 'select');
    expect(select?.args[0]).toContain('prospecto:prospecto_id!inner(');
    const not = llamadas.find((l) => l.tabla === 'cola_aprobacion' && l.metodo === 'not');
    expect(not?.args).toEqual(['prospecto.correo', 'is', null]);
  });
});
