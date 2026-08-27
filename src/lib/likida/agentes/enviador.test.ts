import { describe, it, expect, vi, beforeEach } from 'vitest';

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
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, in: () => b, lte: () => b, or: () => b,
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

const { correrEnviador, filtrarSuprimidos, suprimirCorreo } = await import('./enviador');

const PIEZA = {
  id: 'pieza-0000-1111', tipo: 'correo_frio', estado: 'pendiente', prospecto_id: 'pr-1',
  prospecto: { empresa: 'Transportes X', correo: 'c@x.mx' },
};

beforeEach(() => {
  respuestas.clear();
  apagado = false;
  canal = true;
  enviarPiezaPorCorreo.mockClear();
  registrarCorrida.mockClear();
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
