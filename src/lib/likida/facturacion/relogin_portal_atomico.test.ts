import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S45-02 y A37-S45-04. Una "base" en memoria con la semántica del UPDATE
// condicional de PostgREST: el filtro y la escritura ocurren juntos al esperar
// la consulta, así que dos corridas con la MISMA lectura previa compiten de
// verdad (solo una afecta la fila).

type Fila = Record<string, unknown>;
const base = { fila: null as Fila | null, upsertFalla: 0, upserts: 0 };

function constructor_(tipo: 'update' | 'upsert', cambios: Fila) {
  const filtros: Array<(f: Fila) => boolean> = [];
  const q = {
    eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); return q; },
    is(c: string, v: null) { filtros.push((f) => (f[c] ?? null) === v); return q; },
    select() { return q; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => {
        if (tipo === 'upsert') {
          base.upserts++;
          if (base.upsertFalla > 0) { base.upsertFalla--; return { data: null, error: { message: 'timeout' } }; }
          base.fila = { ...(base.fila ?? {}), ...cambios };
          return { data: null, error: null };
        }
        if (!base.fila || !filtros.every((f) => f(base.fila!))) return { data: [], error: null };
        base.fila = { ...base.fila, ...cambios };
        return { data: [{ comercio: 'la_gas' }], error: null };
      }).then(res, rej);
    },
  };
  return q;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (c: Fila) => constructor_('update', c),
      upsert: (c: Fila) => constructor_('upsert', c),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (p: unknown) => p }));
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => {}) }));
vi.mock('../conectores/cofre', () => ({ cifrar: vi.fn(), descifrar: vi.fn(), cofreConfigurado: () => false }));

const { registrarIntento, registrarResultado, sinPermiso } = await import('./relogin_portal');

const TENANT = '55555555-5555-5555-5555-555555555555';
const HOY = '2026-10-23';
const permisoLeido = { ...sinPermiso('la_gas'), permitido: true, permitidoPor: 'ana@flota.mx' };

beforeEach(() => {
  base.upsertFalla = 0; base.upserts = 0;
  base.fila = {
    tenant_id: TENANT, comercio: 'la_gas', permitido: true, bloqueado: false,
    intentos_dia: 0, dia_de_intentos: null, ultimo_intento_en: null,
  };
});

describe('A37-S45-02 — reclamar el intento es atómico', () => {
  it('dos corridas con la MISMA lectura: solo una gana, la otra queda «ocupado»', async () => {
    const args = { tenantId: TENANT, comercio: 'la_gas', permiso: permisoLeido, hoy: HOY, ahora: '2026-10-23T15:00:00.000Z' };
    const [a, b] = await Promise.all([registrarIntento(args), registrarIntento({ ...args })]);
    expect([a, b].filter((x) => x === true)).toHaveLength(1);
    expect([a, b].filter((x) => x === 'ocupado')).toHaveLength(1);
    expect(base.fila?.intentos_dia).toBe(1);
  });

  it('con una lectura vigente sí reclama, y el contador queda en +1', async () => {
    const r = await registrarIntento({ tenantId: TENANT, comercio: 'la_gas', permiso: permisoLeido, hoy: HOY, ahora: '2026-10-23T15:00:00.000Z' });
    expect(r).toBe(true);
    expect(base.fila).toMatchObject({ intentos_dia: 1, dia_de_intentos: HOY, ultimo_intento_en: '2026-10-23T15:00:00.000Z' });
  });

  it('si el permiso se bloqueó entre la lectura y la escritura, no reclama', async () => {
    base.fila = { ...base.fila!, bloqueado: true };
    const r = await registrarIntento({ tenantId: TENANT, comercio: 'la_gas', permiso: permisoLeido, hoy: HOY, ahora: '2026-10-23T15:00:00.000Z' });
    expect(r).toBe('ocupado');
  });
});

describe('A37-S45-04 — el bloqueo por credencial inválida no se traga', () => {
  const args = { tenantId: TENANT, comercio: 'la_gas', ok: false, clase: 'credencial_invalida' as const, motivo: 'rechazada', ahora: '2026-10-23T15:00:00.000Z' };

  it('reintenta la escritura y, si cede, queda bloqueado', async () => {
    base.upsertFalla = 2;
    expect(await registrarResultado(args)).toBe(true);
    expect(base.upserts).toBe(3);
    expect(base.fila?.bloqueado).toBe(true);
  });

  it('si no logra escribirlo, DEVUELVE false (no lo disfraza de éxito)', async () => {
    base.upsertFalla = 99;
    expect(await registrarResultado(args)).toBe(false);
    expect(base.fila?.bloqueado).toBe(false);
  });

  it('un resultado que no es bloqueo sigue siendo best-effort de un solo intento', async () => {
    base.upsertFalla = 99;
    expect(await registrarResultado({ ...args, clase: 'portal_no_contesto' })).toBe(false);
    expect(base.upserts).toBe(1);
  });
});
