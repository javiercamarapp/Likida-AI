// A1 por correo (Ola 1, 0932): el alta unitaria y la edición de un operador SIN WhatsApp. Todo sintético.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Op = [string, unknown[]];
let resolver: (tabla: string, ops: Op[]) => unknown = () => ({ data: [], error: null });
const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => from(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./config', () => ({ getConfig: vi.fn() }));
const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (e: unknown) => anotarBitacora(e as Record<string, unknown>) }));
vi.mock('./terminales', () => ({ resolverTerminalDeFlota: async () => null }));
let canal: 'correo' | 'whatsapp' = 'correo';
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => null }));
vi.mock('./liquidacion_externa/repo_correo', () => ({ leerConfigCorreo: async () => ({ ok: true, valor: { canal } }) }));

function cadena(tabla: string) {
  const ops: Op[] = [];
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'ilike', 'in', 'order', 'limit', 'insert', 'update', 'maybeSingle', 'single']) {
    nodo[m] = (...a: unknown[]) => { ops.push([m, a]); return nodo; };
  }
  nodo.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve().then(() => resolver(tabla, ops)).then(r, j);
  return nodo;
}

const { crearOperador, actualizarOperador } = await import('./administracion');
const { DatoInvalido } = await import('./errores');

const T = '00000000-0000-4000-8000-000000000001';
const OP = '00000000-0000-4000-8000-0000000000a1';

beforeEach(() => {
  from.mockReset().mockImplementation((t: string) => cadena(t));
  anotarBitacora.mockClear();
  canal = 'correo';
  resolver = () => ({ data: [], error: null });
});

describe('crearOperador sin teléfono', () => {
  it('canal correo: con número de empleado + correo nace con el marcador, su correo y su número; la bitácora no guarda ni el marcador ni el correo', async () => {
    let insertado: Record<string, unknown> | null = null;
    resolver = (tabla, ops) => {
      const ins = ops.find((o) => o[0] === 'insert');
      if (tabla === 'operador' && ins) { insertado = ins[1][0] as Record<string, unknown>; return { data: { id: OP }, error: null }; }
      return { data: [], error: null };
    };
    const id = await crearOperador(T, { nombre: 'Ana Torres', telefono: '', numeroEmpleado: ' E-1 ', correo: 'ANA@Ejemplo.test' });
    expect(id).toBe(OP);
    expect(insertado).toMatchObject({ tenant_id: T, nombre: 'Ana Torres', numero_empleado: 'E-1', correo: 'ana@ejemplo.test' });
    expect(String((insertado as unknown as Record<string, unknown>).telefono)).toMatch(/^sin-tel:[a-z]{20}$/);
    const nota = anotarBitacora.mock.calls[0][0] as { detalle: Record<string, unknown> };
    expect(nota.detalle).toEqual({ nombre: 'Ana Torres', sinTelefono: true });
  });

  it('canal correo pero sin número de empleado o sin correo: DatoInvalido y NADA se escribe', async () => {
    await expect(crearOperador(T, { nombre: 'Ana Torres', telefono: '', correo: 'ana@ejemplo.test' })).rejects.toThrow(/número de empleado y correo/);
    await expect(crearOperador(T, { nombre: 'Ana Torres', telefono: '', numeroEmpleado: 'E-1' })).rejects.toThrow(/número de empleado y correo/);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('canal whatsapp: el teléfono sigue siendo OBLIGATORIO (aunque traiga empleado y correo)', async () => {
    canal = 'whatsapp';
    await expect(crearOperador(T, { nombre: 'Ana Torres', telefono: '', numeroEmpleado: 'E-1', correo: 'ana@ejemplo.test' })).rejects.toThrow(/teléfono es obligatorio/);
    expect(from.mock.calls.some(([t]) => t === 'operador')).toBe(false);
  });

  it('el número de empleado ya usado en la flota se dice y no se da de alta otra vez', async () => {
    resolver = (tabla, ops) => {
      if (tabla === 'operador' && ops.some((o) => o[0] === 'eq' && o[1][0] === 'numero_empleado')) return { data: [{ id: OP, nombre: 'Ana Torres' }], error: null };
      return { data: [], error: null };
    };
    await expect(crearOperador(T, { nombre: 'Ana Torres', telefono: '', numeroEmpleado: 'E-1', correo: 'ana@ejemplo.test' })).rejects.toThrow(/número de empleado E-1/);
  });

  it('el correo ya usado se compara SIN distinguir mayúsculas y con los comodines escapados', async () => {
    let patron: unknown = null;
    resolver = (tabla, ops) => {
      const il = ops.find((o) => o[0] === 'ilike' && o[1][0] === 'correo');
      if (tabla === 'operador' && il) { patron = il[1][1]; return { data: [{ id: OP }], error: null }; }
      return { data: [], error: null };
    };
    await expect(crearOperador(T, { nombre: 'Ana Torres', telefono: '', numeroEmpleado: 'E-9', correo: 'Ana_Torres@Ejemplo.test' })).rejects.toThrow(/correo ya lo usa/);
    expect(patron).toBe('ana\\_torres@ejemplo.test');
  });

  it('con teléfono, todo igual que siempre (no consulta el canal ni escribe correo si no viene)', async () => {
    let insertado: Record<string, unknown> | null = null;
    resolver = (tabla, ops) => {
      const ins = ops.find((o) => o[0] === 'insert');
      if (tabla === 'operador' && ins) { insertado = ins[1][0] as Record<string, unknown>; return { data: { id: OP }, error: null }; }
      return { data: [], error: null };
    };
    await crearOperador(T, { nombre: 'Ana Torres', telefono: '5512345678' });
    expect(insertado).toMatchObject({ telefono: '525512345678' });
    expect(insertado).not.toHaveProperty('correo');
  });
});

describe('actualizarOperador: teléfono vacío', () => {
  it('un operador SIN WhatsApp puede guardar otro dato aunque el formulario mande el teléfono vacío', async () => {
    let actualizado: Record<string, unknown> | null = null;
    resolver = (tabla, ops) => {
      const upd = ops.find((o) => o[0] === 'update');
      if (tabla === 'operador' && upd) { actualizado = upd[1][0] as Record<string, unknown>; return { data: [{ id: OP }], error: null }; }
      if (tabla === 'operador') return { data: { telefono: 'sin-tel:abcdefghijklmnopqrst' }, error: null };
      return { data: [], error: null };
    };
    await actualizarOperador(T, OP, { telefono: '', licencia: 'LIC-9' });
    expect(actualizado).toMatchObject({ licencia: 'LIC-9' });
    expect(actualizado).not.toHaveProperty('telefono');
  });

  it('a un operador CON teléfono, vaciarlo sigue siendo un error (nunca se queda sin WhatsApp por accidente)', async () => {
    resolver = (tabla) => (tabla === 'operador' ? { data: { telefono: '525512345678' }, error: null } : { data: [], error: null });
    await expect(actualizarOperador(T, OP, { telefono: '', licencia: 'LIC-9' })).rejects.toThrow(DatoInvalido);
  });
});
