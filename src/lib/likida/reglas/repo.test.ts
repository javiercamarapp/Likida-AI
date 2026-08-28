import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A19 — EL REPOSITORIO. Lo que estas pruebas fijan:
//
//   1. Una fila cuya plantilla o cuyos parámetros el catálogo de HOY ya no
//      entiende se DESCARTA con log — no se corre a medias. Una regla que el
//      lector no sabe leer no puede mandar un WhatsApp.
//   2. Las transiciones van ancladas por estado: confirmar solo una
//      'pendiente', pausar solo una 'activa'. Dos clics del mismo botón no
//      re-firman ni re-pausan.
//   3. El error llega POR VALOR a la pantalla, con el mensaje que dice qué
//      pasó (la duplicada NO es "no se pudo guardar").
//   4. El sello se escribe con ON CONFLICT DO NOTHING y la llave completa.
//   5. Quién confirmó y quién pausó queda en la bitácora: una vigilancia que
//      manda WhatsApps tiene autor.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string; code?: string } | null; count?: number };

const estado = vi.hoisted(() => ({
  /** Respuesta por `${tabla}:${operacion}`. */
  respuestas: new Map<string, Resp>(),
  llamadas: [] as Array<{ tabla: string; metodo: string; args: unknown[] }>,
}));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const anotarBitacora = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('../bitacora_escritura', () => ({ anotarBitacora }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let operacion = 'select';
      const resolver = () => {
        const r = estado.respuestas.get(`${tabla}:${operacion}`) ?? { data: [], error: null };
        return { data: r.data ?? null, error: r.error ?? null, count: r.count };
      };
      const api: Record<string, unknown> = {
        single: () => Promise.resolve(resolver()),
        then: (res: (v: unknown) => unknown) => Promise.resolve(resolver()).then(res),
      };
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
        api[m] = (...args: unknown[]) => { estado.llamadas.push({ tabla, metodo: m, args }); return api; };
      }
      for (const m of ['insert', 'update', 'delete', 'upsert']) {
        api[m] = (...args: unknown[]) => {
          operacion = m;
          estado.llamadas.push({ tabla, metodo: m, args });
          return api;
        };
      }
      return api;
    },
  }),
}));

const repo = await import('./repo');
const {
  desdeFila, crearReglaPendiente, confirmarRegla, alternarPausa, borrarRegla,
  listarReglas, reglasActivas, sellosDe, sellarDisparos, anotarCorrida, llaveSello,
  TOPE_REGLAS_POR_FLOTA,
} = repo;

const TENANT = 't-1';
const ACTOR = { id: 'u-1', email: 'duena@flota.mx' };

const FILA = {
  id: 'r-1', tenant_id: TENANT, plantilla: 'gasto_de_concepto_mayor_a',
  params: { concepto: 'caseta', monto: 3000 },
  texto_original: 'avísame si un gasto de caseta pasa de $3,000',
  frase: 'Voy a avisarte cuando entre un comprobante de casetas por más de $3,000.00.',
  estado: 'activa', creada_en: '2026-08-20T10:00:00Z',
  confirmada_en: '2026-08-20T10:05:00Z', ultima_corrida_en: null,
  ultimo_disparo_en: null, modelo: 'modelo-x',
};

function pon(clave: string, r: Resp) { estado.respuestas.set(clave, r); }
function llamadas(tabla: string, metodo: string) {
  return estado.llamadas.filter((c) => c.tabla === tabla && c.metodo === metodo).map((c) => c.args);
}

beforeEach(() => {
  estado.respuestas.clear();
  estado.llamadas.length = 0;
  logger.warn.mockClear();
  anotarBitacora.mockClear();
});

describe('desdeFila — la fila que el catálogo de hoy no entiende NO se corre', () => {
  it('convierte una fila sana', () => {
    const r = desdeFila(FILA);
    expect(r).not.toBeNull();
    expect(r!.plantilla).toBe('gasto_de_concepto_mayor_a');
    expect(r!.params).toEqual({ concepto: 'caseta', monto: 3000 });
    expect(r!.ultimoDisparoEn).toBeNull();
  });

  it('una plantilla retirada del catálogo se descarta, con log', () => {
    expect(desdeFila({ ...FILA, plantilla: 'vigilancia_que_ya_no_existe' })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('reglas.plantilla_desconocida', expect.anything());
  });

  it('unos parámetros que dejaron de ser válidos se descartan, con log', () => {
    // El catálogo puede endurecer un dominio; la fila guardada no se entera.
    expect(desdeFila({ ...FILA, params: { concepto: 'mordidas', monto: 3000 } })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('reglas.params_invalidos', expect.anything());
  });
});

describe('crear — nace PENDIENTE, y el duplicado tiene su propio mensaje', () => {
  it('guarda la estructura y el texto citable, en estado pendiente', async () => {
    pon('regla_vigilancia:select', { count: 3, data: [] });
    pon('regla_vigilancia:insert', { data: { ...FILA, estado: 'pendiente', confirmada_en: null } });
    const r = await crearReglaPendiente(TENANT, {
      plantilla: 'gasto_de_concepto_mayor_a', params: { concepto: 'caseta', monto: 3000 },
      textoOriginal: '  avísame si un gasto de caseta pasa de $3,000  ',
      frase: 'Voy a avisarte…', modelo: 'modelo-x', costoUsd: 0.0001,
    }, ACTOR.id);
    expect(r.ok).toBe(true);
    const fila = llamadas('regla_vigilancia', 'insert')[0][0] as Record<string, unknown>;
    expect(fila.estado).toBe('pendiente');
    expect(fila.confirmada_por).toBeUndefined();
    expect(fila.texto_original).toBe('avísame si un gasto de caseta pasa de $3,000');
    expect(fila.creada_por).toBe(ACTOR.id);
    expect(fila.costo_usd).toBeCloseTo(0.0001, 6);
  });

  it('sin costo (camino a mano) el costo se guarda NULL, no cero', async () => {
    pon('regla_vigilancia:select', { count: 0, data: [] });
    pon('regla_vigilancia:insert', { data: { ...FILA, estado: 'pendiente', confirmada_en: null } });
    await crearReglaPendiente(TENANT, {
      plantilla: 'estadia_mayor_a', params: { horas: 4 }, textoOriginal: 'x', frase: 'y',
      modelo: null, costoUsd: 0,
    }, ACTOR.id);
    const fila = llamadas('regla_vigilancia', 'insert')[0][0] as Record<string, unknown>;
    expect(fila.costo_usd).toBeNull();
    expect(fila.modelo).toBeNull();
  });

  it('el choque del índice único se dice como lo que es, no como "no se pudo"', async () => {
    pon('regla_vigilancia:select', { count: 1, data: [] });
    pon('regla_vigilancia:insert', { error: { message: 'duplicate key', code: '23505' } });
    const r = await crearReglaPendiente(TENANT, {
      plantilla: 'estadia_mayor_a', params: { horas: 4 }, textoOriginal: 'x', frase: 'y',
      modelo: null, costoUsd: 0,
    }, ACTOR.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ya está declarada');
  });

  it('el tope por flota se respeta y lo dice con el número', async () => {
    pon('regla_vigilancia:select', { count: TOPE_REGLAS_POR_FLOTA, data: [] });
    const r = await crearReglaPendiente(TENANT, {
      plantilla: 'estadia_mayor_a', params: { horas: 4 }, textoOriginal: 'x', frase: 'y',
      modelo: null, costoUsd: 0,
    }, ACTOR.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(TOPE_REGLAS_POR_FLOTA));
    expect(llamadas('regla_vigilancia', 'insert')).toHaveLength(0);
  });

  it('si no se puede CONTAR, no se agrega — fail closed', async () => {
    pon('regla_vigilancia:select', { error: { message: 'timeout' } });
    const r = await crearReglaPendiente(TENANT, {
      plantilla: 'estadia_mayor_a', params: { horas: 4 }, textoOriginal: 'x', frase: 'y',
      modelo: null, costoUsd: 0,
    }, ACTOR.id);
    expect(r.ok).toBe(false);
    expect(llamadas('regla_vigilancia', 'insert')).toHaveLength(0);
  });
});

describe('confirmar — la firma humana, anclada por estado', () => {
  it('escribe quién y cuándo, y lo anota en la bitácora', async () => {
    pon('regla_vigilancia:update', { data: [{ id: 'r-1', frase: FILA.frase }] });
    const r = await confirmarRegla(TENANT, 'r-1', ACTOR);
    expect(r.ok).toBe(true);
    const parche = llamadas('regla_vigilancia', 'update')[0][0] as Record<string, unknown>;
    expect(parche.estado).toBe('activa');
    expect(parche.confirmada_por).toBe(ACTOR.id);
    expect(parche.confirmada_en).toEqual(expect.any(String));
    // Anclada: solo una que siga 'pendiente'.
    expect(llamadas('regla_vigilancia', 'eq')).toContainEqual(['estado', 'pendiente']);
    expect(llamadas('regla_vigilancia', 'eq')).toContainEqual(['tenant_id', TENANT]);
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'regla.confirmada', entidad: 'regla_vigilancia', entidadId: 'r-1' }),
      expect.anything(),
    );
  });

  it('el segundo clic no re-firma: cero filas = mensaje, no éxito', async () => {
    pon('regla_vigilancia:update', { data: [] });
    const r = await confirmarRegla(TENANT, 'r-1', ACTOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ya no está esperando confirmación');
    expect(anotarBitacora).not.toHaveBeenCalled();
  });
});

describe('pausar / reanudar / borrar', () => {
  it('pausar solo toca una ACTIVA, y reanudar solo una PAUSADA', async () => {
    pon('regla_vigilancia:update', { data: [{ id: 'r-1' }] });
    expect((await alternarPausa(TENANT, 'r-1', true, ACTOR)).ok).toBe(true);
    expect(llamadas('regla_vigilancia', 'eq')).toContainEqual(['estado', 'activa']);

    estado.llamadas.length = 0;
    expect((await alternarPausa(TENANT, 'r-1', false, ACTOR)).ok).toBe(true);
    expect(llamadas('regla_vigilancia', 'eq')).toContainEqual(['estado', 'pausada']);
  });

  it('reanudar NO vuelve a pedir firma: la pausada conserva la suya', async () => {
    pon('regla_vigilancia:update', { data: [{ id: 'r-1' }] });
    await alternarPausa(TENANT, 'r-1', false, ACTOR);
    const parche = llamadas('regla_vigilancia', 'update')[0][0] as Record<string, unknown>;
    expect(parche).toEqual({ estado: 'activa' });
  });

  it('borrar una que ya no existe se dice, no revienta', async () => {
    pon('regla_vigilancia:delete', { data: [] });
    const r = await borrarRegla(TENANT, 'r-1', ACTOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ya no existe');
  });

  it('borrar anota en la bitácora y va acotado al tenant', async () => {
    pon('regla_vigilancia:delete', { data: [{ id: 'r-1' }] });
    expect((await borrarRegla(TENANT, 'r-1', ACTOR)).ok).toBe(true);
    expect(llamadas('regla_vigilancia', 'eq')).toContainEqual(['tenant_id', TENANT]);
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'regla.borrada' }), expect.anything(),
    );
  });
});

describe('listar y barrer', () => {
  it('la lista trae título, canal y las últimas 3 evidencias por regla', async () => {
    pon('regla_vigilancia:select', { data: [FILA] });
    pon('regla_disparo:select', {
      data: [
        { regla_id: 'r-1', evidencia: 'e1', disparado_en: '2026-08-26T10:00:00Z' },
        { regla_id: 'r-1', evidencia: 'e2', disparado_en: '2026-08-25T10:00:00Z' },
        { regla_id: 'r-1', evidencia: 'e3', disparado_en: '2026-08-24T10:00:00Z' },
        { regla_id: 'r-1', evidencia: 'e4', disparado_en: '2026-08-23T10:00:00Z' },
      ],
    });
    const r = await listarReglas(TENANT);
    expect(r).toHaveLength(1);
    expect(r[0].titulo).toBe('Gasto de un concepto por arriba de un monto');
    expect(r[0].canal).toBe('dinero');
    expect(r[0].ultimasEvidencias.map((e) => e.evidencia)).toEqual(['e1', 'e2', 'e3']);
  });

  it('sin reglas no consulta sellos', async () => {
    pon('regla_vigilancia:select', { data: [] });
    expect(await listarReglas(TENANT)).toEqual([]);
    expect(llamadas('regla_disparo', 'select')).toHaveLength(0);
  });

  it('listar LANZA si la base falla: media lista se ve igual que la lista entera', async () => {
    pon('regla_vigilancia:select', { error: { message: 'connection reset' } });
    await expect(listarReglas(TENANT)).rejects.toThrow(/connection reset/);
  });

  it('el barrido pide SOLO las activas y LANZA si no puede leerlas', async () => {
    pon('regla_vigilancia:select', { data: [FILA] });
    expect(await reglasActivas()).toHaveLength(1);
    expect(llamadas('regla_vigilancia', 'eq')).toContainEqual(['estado', 'activa']);

    estado.respuestas.clear();
    pon('regla_vigilancia:select', { error: { message: 'sin respuesta en 8000 ms' } });
    await expect(reglasActivas()).rejects.toThrow(/sin respuesta/);
  });

  it('el barrido descarta las filas ilegibles sin tumbar la corrida', async () => {
    pon('regla_vigilancia:select', { data: [FILA, { ...FILA, id: 'r-2', plantilla: 'inventada' }] });
    const r = await reglasActivas();
    expect(r.map((x) => x.id)).toEqual(['r-1']);
  });
});

describe('los sellos', () => {
  const disparo = { objeto: 'gasto' as const, objetoId: 'g-1', clave: '', evidencia: '$3,500.00 de casetas' };

  it('la llave del sello es objeto + id + ciclo', () => {
    expect(llaveSello(disparo)).toBe('gasto|g-1|');
    expect(llaveSello({ ...disparo, clave: '2026-09-01' })).toBe('gasto|g-1|2026-09-01');
  });

  it('sin candidatos no consulta nada', async () => {
    expect(await sellosDe(TENANT, 'r-1', [])).toEqual(new Set());
    expect(llamadas('regla_disparo', 'select')).toHaveLength(0);
    await sellarDisparos(TENANT, 'r-1', []);
    expect(llamadas('regla_disparo', 'upsert')).toHaveLength(0);
  });

  it('lee los sellos existentes en UNA consulta y los devuelve como llaves', async () => {
    pon('regla_disparo:select', { data: [{ objeto: 'gasto', objeto_id: 'g-1', clave: '' }] });
    const s = await sellosDe(TENANT, 'r-1', [disparo, { ...disparo, objetoId: 'g-2' }]);
    expect(s.has('gasto|g-1|')).toBe(true);
    expect(s.has('gasto|g-2|')).toBe(false);
    expect(llamadas('regla_disparo', 'in')).toContainEqual(['objeto_id', ['g-1', 'g-2']]);
  });

  it('sella con la llave completa y ON CONFLICT DO NOTHING (dos crons solapados)', async () => {
    pon('regla_disparo:upsert', { error: null });
    await sellarDisparos(TENANT, 'r-1', [disparo]);
    const [filas, opciones] = llamadas('regla_disparo', 'upsert')[0] as [Array<Record<string, unknown>>, Record<string, unknown>];
    expect(filas[0]).toEqual({
      tenant_id: TENANT, regla_id: 'r-1', objeto: 'gasto', objeto_id: 'g-1', clave: '',
      evidencia: '$3,500.00 de casetas',
    });
    expect(opciones).toEqual({ onConflict: 'tenant_id,regla_id,objeto,objeto_id,clave', ignoreDuplicates: true });
  });

  it('un sello que no se pudo escribir LANZA: el aviso ya salió y el duplicado importa', async () => {
    pon('regla_disparo:upsert', { error: { message: 'deadlock detected' } });
    await expect(sellarDisparos(TENANT, 'r-1', [disparo])).rejects.toThrow(/deadlock/);
  });

  it('la corrida sin disparos anota la revisión pero NO toca ultimo_disparo_en', async () => {
    pon('regla_vigilancia:update', { error: null });
    await anotarCorrida(TENANT, 'r-1', new Date('2026-08-27T18:00:00Z'), 0);
    const parche = llamadas('regla_vigilancia', 'update')[0][0] as Record<string, unknown>;
    expect(parche.ultima_corrida_en).toBe('2026-08-27T18:00:00.000Z');
    expect(parche.ultimo_disparo_en).toBeUndefined();
  });

  it('la corrida con disparos sí lo mueve, y un fallo de anotación no lanza', async () => {
    pon('regla_vigilancia:update', { error: { message: 'timeout' } });
    await expect(anotarCorrida(TENANT, 'r-1', new Date('2026-08-27T18:00:00Z'), 2)).resolves.toBeUndefined();
    const parche = llamadas('regla_vigilancia', 'update')[0][0] as Record<string, unknown>;
    expect(parche.ultimo_disparo_en).toBe('2026-08-27T18:00:00.000Z');
    expect(logger.warn).toHaveBeenCalledWith('reglas.corrida_no_anotada', expect.anything());
  });
});
