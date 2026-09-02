// ═══════════════════════════════════════════════════════════════════════════
// EMISIÓN Y REVOCACIÓN DE LLAVES (A6, auditoría 4).
//
// Lo que se fija aquí NO es que el mock de Supabase funcione: es lo que el
// motor le MANDA y cómo reacciona a lo que vuelve —
//   · al INSERT van hash y prefijo y JAMÁS la llave en claro;
//   · un UPDATE de 0 filas no es éxito (patrón `editarCliente`);
//   · el UPDATE va anclado al tenant, no solo al id;
//   · un error de lectura LANZA en vez de volverse "no tienes llaves".
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Registro = {
  tabla: string;
  op: string | null;
  payload: unknown;
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  select: string | null;
  orden: Array<[string, unknown]>;
};

const llamadas: Registro[] = [];
const respuestas = new Map<string, { data: unknown; error: { message: string } | null }>();

function builder(tabla: string) {
  const r: Registro = { tabla, op: null, payload: null, eq: [], is: [], select: null, orden: [] };
  llamadas.push(r);
  const respuesta = () => respuestas.get(tabla) ?? { data: null, error: null };
  const b: Record<string, unknown> = {};
  b.insert = (p: unknown) => { r.op = 'insert'; r.payload = p; return b; };
  b.update = (p: unknown) => { r.op = 'update'; r.payload = p; return b; };
  b.select = (cols: string) => { r.select = cols; if (!r.op) r.op = 'select'; return b; };
  b.eq = (c: string, v: unknown) => { r.eq.push([c, v]); return b; };
  b.is = (c: string, v: unknown) => { r.is.push([c, v]); return b; };
  b.order = (c: string, o: unknown) => { r.orden.push([c, o]); return b; };
  b.single = async () => respuesta();
  // El builder de supabase-js es "thenable": las cadenas sin `.single()` se
  // esperan directo (y `acotada` les hace Promise.race encima).
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(respuesta()).then(res, rej);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { crearLlaveApi, revocarLlaveApi, listarLlavesApi } = await import('./llave-api-escritura');
const { DatoInvalido } = await import('@/lib/likida/errores');

const TENANT = 't-flota-1';
const LLAVE_ID = '11111111-2222-4333-8444-555555555555';

function insertsDeLlaves(): Registro[] {
  return llamadas.filter((l) => l.tabla === 'tenant_api_key' && l.op === 'insert');
}

beforeEach(() => {
  llamadas.length = 0;
  respuestas.clear();
});

describe('crearLlaveApi — el secreto se devuelve, nunca se guarda', () => {
  it('inserta hash y prefijo y devuelve la llave en claro UNA vez', async () => {
    respuestas.set('tenant_api_key', { data: { id: 'llave-1' }, error: null });
    const r = await crearLlaveApi(TENANT, { nombre: 'TMS propio', area: 'operacion' }, 'u-1');

    expect(r.id).toBe('llave-1');
    expect(r.enClaro.startsWith('lk_live_')).toBe(true);
    expect(r.prefijo.length).toBe('lk_live_'.length + 6);

    const [ins] = insertsDeLlaves();
    const fila = ins.payload as Record<string, unknown>;
    expect(fila.tenant_id).toBe(TENANT);
    expect(fila.nombre).toBe('TMS propio');
    expect(fila.area).toBe('operacion');
    expect(fila.creada_por).toBe('u-1');
    // La forma que el CHECK de la 0093 exige: 64 hex, no la llave.
    expect(fila.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila.prefijo).toBe(r.prefijo);
  });

  it('la llave en claro NO viaja al insert — ni entera ni escondida en otro campo', async () => {
    respuestas.set('tenant_api_key', { data: { id: 'llave-1' }, error: null });
    const r = await crearLlaveApi(TENANT, { nombre: 'Tablero', area: 'dinero' }, 'u-1');

    const [ins] = insertsDeLlaves();
    // Serializado completo: si `enClaro` se colara en CUALQUIER campo del
    // payload (hash, nombre, uno nuevo), esta prueba lo ve.
    expect(JSON.stringify(ins.payload)).not.toContain(r.enClaro);
    // Y nada con pinta de llave completa: lo único que puede empezar con
    // `lk_live_` es la pista de 6 caracteres.
    for (const v of Object.values(ins.payload as Record<string, unknown>)) {
      if (typeof v === 'string' && v.startsWith('lk_live_')) {
        expect(v.length).toBe('lk_live_'.length + 6);
      }
    }
  });

  it('sin nombre no se emite — y ni se toca la base', async () => {
    await expect(crearLlaveApi(TENANT, { nombre: '   ', area: 'operacion' })).rejects.toThrow(DatoInvalido);
    expect(insertsDeLlaves()).toHaveLength(0);
  });

  it('un área fuera del dominio de la 0093 se rechaza antes del insert', async () => {
    await expect(crearLlaveApi(TENANT, { nombre: 'TMS', area: 'todo' })).rejects.toThrow(DatoInvalido);
    expect(insertsDeLlaves()).toHaveLength(0);
  });

  it('un error del insert LANZA, no devuelve una llave a medias', async () => {
    respuestas.set('tenant_api_key', { data: null, error: { message: 'duplicate key' } });
    await expect(crearLlaveApi(TENANT, { nombre: 'TMS', area: 'operacion' }))
      .rejects.toThrow(/crearLlaveApi: duplicate key/);
  });

  it('un insert que no devuelve id también lanza — supabase reporta POR VALOR', async () => {
    respuestas.set('tenant_api_key', { data: null, error: null });
    await expect(crearLlaveApi(TENANT, { nombre: 'TMS', area: 'operacion' }))
      .rejects.toThrow(/no devolvió id/);
  });
});

describe('revocarLlaveApi — 0 filas no es éxito', () => {
  it('sella revocada_en anclado a id + tenant + viva', async () => {
    respuestas.set('tenant_api_key', { data: [{ id: LLAVE_ID }], error: null });
    await revocarLlaveApi(TENANT, LLAVE_ID, 'u-1');

    const upd = llamadas.find((l) => l.tabla === 'tenant_api_key' && l.op === 'update');
    expect(upd).toBeDefined();
    const fila = upd!.payload as Record<string, unknown>;
    // Se sella, no se borra: la 0093 conserva el renglón para la auditoría.
    expect(typeof fila.revocada_en).toBe('string');
    expect(upd!.eq).toContainEqual(['id', LLAVE_ID]);
    // EL ancla: sin esto, el id de una llave ajena revocaría en otra flota.
    expect(upd!.eq).toContainEqual(['tenant_id', TENANT]);
    // Y solo vivas: revocar dos veces pisaría el sello original.
    expect(upd!.is).toContainEqual(['revocada_en', null]);
    expect(upd!.select).toBe('id');
  });

  it('0 filas tocadas LANZA: el id de otra flota o una ya revocada no es "revocada"', async () => {
    respuestas.set('tenant_api_key', { data: [], error: null });
    await expect(revocarLlaveApi(TENANT, LLAVE_ID)).rejects.toThrow(DatoInvalido);
  });

  it('un error del UPDATE lanza como fallo del sistema, no como DatoInvalido', async () => {
    respuestas.set('tenant_api_key', { data: null, error: { message: 'fetch failed' } });
    await expect(revocarLlaveApi(TENANT, LLAVE_ID)).rejects.toThrow(/revocarLlaveApi: fetch failed/);
  });

  it('un id que ni es uuid se rechaza sin gastar un viaje a la base', async () => {
    await expect(revocarLlaveApi(TENANT, 'basura')).rejects.toThrow(DatoInvalido);
    expect(llamadas.filter((l) => l.tabla === 'tenant_api_key')).toHaveLength(0);
  });
});

describe('listarLlavesApi — la lista dice la verdad o dice que falló', () => {
  it('lee solo columnas públicas, del tenant, nuevas primero — y las revocadas VIENEN', async () => {
    respuestas.set('tenant_api_key', {
      data: [
        {
          id: 'l-2', nombre: 'TMS propio', prefijo: 'lk_live_abc123', area: 'administracion',
          creada_en: '2026-08-14T10:00:00Z', ultimo_uso_en: null, revocada_en: null,
        },
        {
          id: 'l-1', nombre: 'Tablero viejo', prefijo: 'lk_live_zzz999', area: 'operacion',
          creada_en: '2026-08-01T10:00:00Z', ultimo_uso_en: '2026-08-10T09:00:00Z',
          revocada_en: '2026-08-12T08:00:00Z',
        },
      ],
      error: null,
    });

    const r = await listarLlavesApi(TENANT);
    expect(r).toHaveLength(2);
    // `null` se queda `null`: "nunca se ha usado" es un dato, no un hueco que
    // se rellena.
    expect(r[0]).toEqual({
      id: 'l-2', nombre: 'TMS propio', prefijo: 'lk_live_abc123', area: 'administracion',
      creadaEn: '2026-08-14T10:00:00Z', ultimoUsoEn: null, revocadaEn: null,
      // Una llave anterior a la 0294 no trae `expira_en`: no caduca (SEG-8).
      expiraEn: null,
    });
    expect(r[1].revocadaEn).toBe('2026-08-12T08:00:00Z');

    const sel = llamadas.find((l) => l.tabla === 'tenant_api_key');
    expect(sel!.eq).toContainEqual(['tenant_id', TENANT]);
    expect(sel!.orden).toContainEqual(['creada_en', { ascending: false }]);
    // El hash NO se lee: la pantalla no lo necesita y no tiene por qué viajar.
    expect(sel!.select).not.toContain('hash');
  });

  it('un error de lectura LANZA — no se disfraza de "no tienes llaves"', async () => {
    respuestas.set('tenant_api_key', { data: null, error: { message: 'fetch failed' } });
    await expect(listarLlavesApi(TENANT)).rejects.toThrow(/listarLlavesApi: fetch failed/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SEG-8 (auditoría 24, columna `expira_en` de la 0294) — LAS LLAVES CADUCAN.
//
// Una llave de área `administracion` filtrada en el repo del TMS del cliente
// servía para siempre. Ahora la emisión pide vigencia, con un año por default;
// «sin caducidad» sigue existiendo pero como decisión elegida, no como el
// único camino. Que el camino CALIENTE rechace una vencida se prueba en
// `llave-api.test.ts`; que la base impida emitirla ya muerta, en el bloque 242.
// ═══════════════════════════════════════════════════════════════════════════
const { expiraEnDesdeVigencia, llaveVencida, VIGENCIA_DEFAULT } = await import('./llave-api-escritura');

describe('la vigencia que se elige al emitir', () => {
  const AHORA = Date.parse('2026-09-01T12:00:00Z');

  it('90 días, 1 año y 2 años se convierten en la fecha exacta que la pantalla promete', () => {
    expect(expiraEnDesdeVigencia('90', AHORA)).toBe(new Date(AHORA + 90 * 86_400_000).toISOString());
    expect(expiraEnDesdeVigencia('365', AHORA)).toBe(new Date(AHORA + 365 * 86_400_000).toISOString());
    expect(expiraEnDesdeVigencia('730', AHORA)).toBe(new Date(AHORA + 730 * 86_400_000).toISOString());
  });

  it('solo el valor EXPLÍCITO «nunca» deja la llave sin caducidad', () => {
    expect(expiraEnDesdeVigencia('nunca', AHORA)).toBeNull();
  });

  it('un POST sin vigencia cae al DEFAULT (un año), no a «nunca»: quien no elige no está pidiendo una llave eterna', () => {
    expect(expiraEnDesdeVigencia(undefined, AHORA)).toBe(expiraEnDesdeVigencia(VIGENCIA_DEFAULT, AHORA));
    expect(expiraEnDesdeVigencia('', AHORA)).toBe(expiraEnDesdeVigencia(VIGENCIA_DEFAULT, AHORA));
    expect(expiraEnDesdeVigencia('   ', AHORA)).toBe(expiraEnDesdeVigencia(VIGENCIA_DEFAULT, AHORA));
  });

  it.each(['0', '-30', '3651', '1.5', 'siempre', 'null'])(
    'una vigencia inventada (%s) se rechaza con mensaje de captura, no se interpreta',
    (v) => {
      expect(() => expiraEnDesdeVigencia(v, AHORA)).toThrow(DatoInvalido);
    });

  it('emitir manda `expira_en` en el INSERT y lo devuelve para que la pantalla lo diga', async () => {
    respuestas.set('tenant_api_key', { data: { id: 'l-9' }, error: null });
    const r = await crearLlaveApi(TENANT, { nombre: 'TMS propio', area: 'operacion', vigencia: '90' });
    const insert = llamadas.find((l) => l.op === 'insert');
    const payload = insert!.payload as Record<string, unknown>;
    expect(typeof payload.expira_en).toBe('string');
    expect(r.expiraEn).toBe(payload.expira_en);
    // Y la llave en claro SIGUE sin entrar a la fila.
    expect(JSON.stringify(payload)).not.toContain(r.enClaro);
  });

  it('emitir SIN caducidad manda null explícito', async () => {
    respuestas.set('tenant_api_key', { data: { id: 'l-10' }, error: null });
    const r = await crearLlaveApi(TENANT, { nombre: 'ERP eterno', area: 'operacion', vigencia: 'nunca' });
    expect((llamadas.find((l) => l.op === 'insert')!.payload as Record<string, unknown>).expira_en).toBeNull();
    expect(r.expiraEn).toBeNull();
  });

  it('una vigencia inválida NO llega a insertar nada: se rechaza antes de generar la llave', async () => {
    await expect(crearLlaveApi(TENANT, { nombre: 'X', area: 'operacion', vigencia: 'siempre' }))
      .rejects.toBeInstanceOf(DatoInvalido);
    expect(llamadas.filter((l) => l.op === 'insert')).toHaveLength(0);
  });
});

describe('llaveVencida — el mismo criterio que usa el camino caliente', () => {
  const AHORA = Date.parse('2026-09-01T12:00:00Z');
  it('null no vence nunca', () => expect(llaveVencida(null, AHORA)).toBe(false));
  it('una fecha futura no ha vencido', () => expect(llaveVencida('2026-12-01T00:00:00Z', AHORA)).toBe(false));
  it('una fecha pasada sí', () => expect(llaveVencida('2026-08-31T00:00:00Z', AHORA)).toBe(true));
  it('el instante exacto ya cuenta como vencida (se cierra, no se abre)', () =>
    expect(llaveVencida('2026-09-01T12:00:00Z', AHORA)).toBe(true));
});
