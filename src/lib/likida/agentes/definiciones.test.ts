import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DECLARATIVO (0116) — la validación pura y el contrato del alta:
// todo agente nace `disenado` (jamás vivo desde una forma), el id duplicado
// se dice con palabras, y el presupuesto vacío es NULL declarado, no $0.
// ═══════════════════════════════════════════════════════════════════════════

const inserciones: Array<{ tabla: string; fila: Record<string, unknown> }> = [];
let errorInsert: { code?: string; message: string } | null = null;
/** Filas crudas que `listarAgentes` lee de `agente_definicion`. */
let filasCatalogo: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      insert: async (fila: Record<string, unknown>) => {
        if (tabla === 'agente_definicion' && errorInsert) return { error: errorInsert };
        inserciones.push({ tabla, fila });
        return { error: null };
      },
      select: () => ({
        order: () => ({
          range: async () => ({ data: filasCatalogo, error: null, count: filasCatalogo.length }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { validarDefinicion, darDeAltaAgente, listarAgentes } = await import('./definiciones');
const { DatoInvalido } = await import('../errores');

const CRUDA = {
  id: 'cazador_censo', nombre: 'Cazador de censo', departamento: 'leads',
  descripcion: 'Barre el censo', disparador: 'manual', promptRef: '', presupuestoDiaUsd: '',
};

const filaCatalogo = (sobre: Partial<Record<string, unknown>> = {}) => ({
  id: 'cazador', nombre: 'Cazador', departamento: 'leads', descripcion: null,
  disparador: 'manual', estado: 'vivo', presupuesto_dia_usd: null, prompt_ref: null,
  modelo_rol: null, experimental: false, creado_en: '2026-08-01T00:00:00+00:00',
  ...sobre,
});

beforeEach(() => { inserciones.length = 0; errorInsert = null; filasCatalogo = []; });

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

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25, BAJO — `listarAgentes` mapea `experimental` de una fila REAL.
//
// `definiciones.test.ts` mockeaba `select()` devolviendo siempre `data: []`,
// así que el mapeo de `listarAgentes` nunca se ejercitaba con una fila: la
// mutación `experimental: f.experimental === true` → `experimental: false`
// fijo pasaba la suite completa. El badge «Experimental» de
// `admin/agentes/contenido.tsx` depende enteramente de este campo.
// ═══════════════════════════════════════════════════════════════════════════
describe('listarAgentes — el campo `experimental`', () => {
  it('un agente vivo con experimental=true en la base sale con experimental:true', async () => {
    filasCatalogo = [filaCatalogo({ experimental: true })];
    const [a] = await listarAgentes();
    expect(a.experimental).toBe(true);
  });

  it('un agente vivo con experimental=false sale con experimental:false, no comodín', async () => {
    filasCatalogo = [filaCatalogo({ experimental: false })];
    const [a] = await listarAgentes();
    expect(a.experimental).toBe(false);
  });
});
