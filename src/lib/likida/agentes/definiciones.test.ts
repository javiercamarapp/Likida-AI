import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DECLARATIVO (0116) — la validación pura y el contrato del alta:
// todo agente nace `disenado` (jamás vivo desde una forma), el id duplicado
// se dice con palabras, y el presupuesto vacío es NULL declarado, no $0.
// ═══════════════════════════════════════════════════════════════════════════

const inserciones: Array<{ tabla: string; fila: Record<string, unknown> }> = [];
let errorInsert: { code?: string; message: string } | null = null;
/** Ids que `graduarAgente` encuentra al hacer `UPDATE ... WHERE id = ...`
 *  (simula qué filas existen de verdad en el catálogo). */
let idsExistentes: Set<string> = new Set();
let errorUpdate: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      insert: async (fila: Record<string, unknown>) => {
        if (tabla === 'agente_definicion' && errorInsert) return { error: errorInsert };
        inserciones.push({ tabla, fila });
        return { error: null };
      },
      select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }),
      update: (cambios: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => ({
          select: () => ({
            maybeSingle: async () => {
              if (errorUpdate) return { data: null, error: errorUpdate };
              if (!idsExistentes.has(id)) return { data: null, error: null };
              inserciones.push({ tabla, fila: { id, ...cambios } });
              return { data: { id }, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { validarDefinicion, darDeAltaAgente, graduarAgente } = await import('./definiciones');
const { DatoInvalido } = await import('../errores');

const CRUDA = {
  id: 'cazador_censo', nombre: 'Cazador de censo', departamento: 'leads',
  descripcion: 'Barre el censo', disparador: 'manual', promptRef: '', presupuestoDiaUsd: '',
};

beforeEach(() => { inserciones.length = 0; errorInsert = null; idsExistentes = new Set(); errorUpdate = null; });

describe('validarDefinicion', () => {
  it('un id con mayúsculas o espacios se normaliza o rebota con texto de pantalla', () => {
    expect(validarDefinicion({ ...CRUDA, id: ' Cazador_Censo ' }).id).toBe('cazador_censo');
    expect(() => validarDefinicion({ ...CRUDA, id: 'con espacios' })).toThrow(DatoInvalido);
    expect(() => validarDefinicion({ ...CRUDA, id: 'x' })).toThrow(DatoInvalido);
  });

  it('un departamento fuera del organigrama rebota', () => {
    expect(() => validarDefinicion({ ...CRUDA, departamento: 'marketing_viral' })).toThrow(DatoInvalido);
  });

  it('presupuesto vacío es NULL (sin tope declarado), no cero; negativo rebota', () => {
    expect(validarDefinicion(CRUDA).presupuestoDiaUsd).toBeNull();
    expect(validarDefinicion({ ...CRUDA, presupuestoDiaUsd: '2.5' }).presupuestoDiaUsd).toBe(2.5);
    expect(() => validarDefinicion({ ...CRUDA, presupuestoDiaUsd: '-1' })).toThrow(DatoInvalido);
    expect(() => validarDefinicion({ ...CRUDA, presupuestoDiaUsd: '0' })).toThrow(DatoInvalido);
  });
});

describe('darDeAltaAgente', () => {
  it('todo agente nace disenado — la forma no puede parir uno vivo', async () => {
    await darDeAltaAgente(validarDefinicion(CRUDA), 'u-javier');
    const alta = inserciones.find((i) => i.tabla === 'agente_definicion');
    expect(alta?.fila.estado).toBe('disenado');
  });

  it('el alta queda en bitacora_auditoria con el actor', async () => {
    await darDeAltaAgente(validarDefinicion(CRUDA), 'u-javier');
    const bit = inserciones.find((i) => i.tabla === 'bitacora_auditoria');
    expect(bit?.fila).toMatchObject({ accion: 'agente.alta', entidad_id: 'cazador_censo', actor_id: 'u-javier' });
  });

  it('un id duplicado (23505) se dice con palabras, no con el error de Postgres', async () => {
    errorInsert = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expect(darDeAltaAgente(validarDefinicion(CRUDA), 'u-1')).rejects.toThrow(/ya existe un agente/i);
  });
});

describe('graduarAgente', () => {
  it('quita experimental del agente y lo anota en bitácora con el actor', async () => {
    idsExistentes = new Set(['cazador']);
    await graduarAgente('cazador', 'u-javier');
    const upd = inserciones.find((i) => i.tabla === 'agente_definicion');
    expect(upd?.fila).toMatchObject({ id: 'cazador', experimental: false });
    const bit = inserciones.find((i) => i.tabla === 'bitacora_auditoria');
    expect(bit?.fila).toMatchObject({ accion: 'agente.graduado', entidad_id: 'cazador', actor_id: 'u-javier' });
  });

  it('graduar un id que no existe en el catálogo rebota con texto de pantalla, no una fila fantasma', async () => {
    idsExistentes = new Set();
    await expect(graduarAgente('no_existe', 'u-1')).rejects.toThrow(DatoInvalido);
    expect(inserciones.find((i) => i.tabla === 'bitacora_auditoria')).toBeUndefined();
  });
});
