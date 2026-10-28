import { beforeEach, describe, expect, it, vi } from 'vitest';

// A5-01 (ola 8): el camino SOPORTADO para habilitar `agente_chofer_habilitado` (0859). Solo lo llama la ficha de /admin; exige motivo,
// no crea la fila de configuración y firma la bitácora. Datos sintéticos.
const escrituras: Array<{ tabla: string; op: string; payload: unknown; eq: Array<[string, unknown]> }> = [];
let filasActualizadas: Array<Record<string, unknown>> = [{ tenant_id: 't1' }];
let errorEscritura: { message: string } | null = null;

function builder(tabla: string) {
  const reg = { tabla, op: 'select', payload: undefined as unknown, eq: [] as Array<[string, unknown]> };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    update: (p: unknown) => { reg.op = 'update'; reg.payload = p; escrituras.push(reg); return b; },
    insert: (p: unknown) => { reg.op = 'insert'; reg.payload = p; escrituras.push(reg); return b; },
    eq: (c: string, v: unknown) => { reg.eq.push([c, v]); return b; },
    select: () => b,
    then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: tabla === 'agente_conductor_config' ? filasActualizadas : null, error: tabla === 'agente_conductor_config' ? errorEscritura : null }).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(q: T) => q }));

const { fijarAgenteChoferHabilitado } = await import('./negocio');

beforeEach(() => { escrituras.length = 0; filasActualizadas = [{ tenant_id: 't1' }]; errorEscritura = null; });

describe('fijarAgenteChoferHabilitado', () => {
  it('habilitar escribe la columna SOLO de esa flota y firma la bitácora con el motivo', async () => {
    await fijarAgenteChoferHabilitado('t1', true, 'piloto autorizado por el dueño', 'u-super');
    const upd = escrituras.find((e) => e.tabla === 'agente_conductor_config')!;
    expect(upd.op).toBe('update');
    expect(upd.payload).toEqual({ agente_chofer_habilitado: true });
    expect(upd.eq).toContainEqual(['tenant_id', 't1']);
    const bit = escrituras.find((e) => e.tabla === 'bitacora_auditoria')!;
    expect(JSON.stringify(bit.payload)).toContain('agente_chofer.habilitado');
    expect(JSON.stringify(bit.payload)).toContain('piloto autorizado por el dueño');
  });

  it('deshabilitar también queda firmado', async () => {
    await fijarAgenteChoferHabilitado('t1', false, 'incidente en la flota', 'u-super');
    expect(JSON.stringify(escrituras.find((e) => e.tabla === 'bitacora_auditoria')!.payload)).toContain('agente_chofer.deshabilitado');
  });

  it('sin motivo (o con menos de 5 caracteres) rechaza SIN escribir', async () => {
    await expect(fijarAgenteChoferHabilitado('t1', true, '  ok ', 'u')).rejects.toThrow(/motivo/);
    expect(escrituras).toHaveLength(0);
  });

  it('una flota sin fila de configuración NO se habilita (no crea la fila) y no firma nada', async () => {
    filasActualizadas = [];
    await expect(fijarAgenteChoferHabilitado('t1', true, 'motivo válido', 'u')).rejects.toThrow(/configuración del agente/);
    expect(escrituras.some((e) => e.tabla === 'bitacora_auditoria')).toBe(false);
    expect(escrituras.some((e) => e.op === 'insert' && e.tabla === 'agente_conductor_config')).toBe(false);
  });

  it('con la escritura caída (p. ej. la 0859 sin aplicar) LANZA: "habilité" que no habilitó es el peor resultado', async () => {
    errorEscritura = { message: 'column does not exist' };
    await expect(fijarAgenteChoferHabilitado('t1', true, 'motivo válido', 'u')).rejects.toThrow(/column does not exist/);
  });
});
