// ═══════════════════════════════════════════════════════════════════════════
// A1 por correo (Ola 1, migración 0932): un operador se da de alta solo con número de empleado y correo cuando el canal es correo,
// sin debilitar la unicidad ni la obligación del teléfono donde sí se usa. Todo sintético.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Op = [string, unknown[]];
type Resolver = (tabla: string, ops: Op[]) => unknown;
let resolver: Resolver = () => ({ data: null, error: null });
const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => from(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => {}) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true }));
vi.mock('../terminales', () => ({ resolverTerminalDeFlota: async (_t: string, id?: string | null) => (id ? id : null) }));
// El canal de la flota: cada prueba lo fija.
let canal: 'correo' | 'whatsapp' | 'ambos' | 'caida' = 'correo';
let perfil: 'cinco_agentes' | null = null;
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => perfil }));
vi.mock('../liquidacion_externa/repo_correo', () => ({
  leerConfigCorreo: async () => {
    if (canal === 'caida') throw new Error('base caída');
    return { ok: true, valor: { canal } };
  },
}));

function cadena(tabla: string) {
  const ops: Op[] = [];
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'limit', 'insert', 'upsert', 'update', 'maybeSingle', 'single']) {
    nodo[m] = (...a: unknown[]) => { ops.push([m, a]); return nodo; };
  }
  nodo.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve().then(() => resolver(tabla, ops)).then(r, j);
  return nodo;
}

const { esMarcadorSinTelefono, nuevoMarcadorSinTelefono, telefonoVisible, correoDeOperador } = await import('../operador_sin_telefono');
const { permiteAltaSinTelefono } = await import('../operador_sin_telefono_canal');
const { interpretarFilasOperadores, validarOperadorImportado, planificarOperadores, importarOperadores } = await import('./operadores');
const { DatoInvalido } = await import('../errores');

beforeEach(() => {
  from.mockReset().mockImplementation((t: string) => cadena(t));
  resolver = () => ({ data: [], error: null });
  canal = 'correo';
  perfil = null;
});

const T = '00000000-0000-4000-8000-000000000001';

describe('el marcador «sin WhatsApp»', () => {
  it('tiene la forma que exige la migración 0932, no lleva un solo dígito y no se repite', () => {
    const a = nuevoMarcadorSinTelefono();
    const b = nuevoMarcadorSinTelefono();
    expect(a).toMatch(/^sin-tel:[a-z]{20}$/);
    expect(/\d/.test(a)).toBe(false);
    expect(a).not.toBe(b);
    expect(esMarcadorSinTelefono(a)).toBe(true);
    expect(esMarcadorSinTelefono('525512345678')).toBe(false);
    expect(esMarcadorSinTelefono('sin-tel:abc')).toBe(false);
    expect(esMarcadorSinTelefono(null)).toBe(false);
  });

  it('nunca se muestra como teléfono', () => {
    expect(telefonoVisible(nuevoMarcadorSinTelefono())).toBeNull();
    expect(telefonoVisible('525512345678')).toBe('525512345678');
    expect(telefonoVisible(null)).toBeNull();
  });

  it('correoDeOperador normaliza, deja vacío en null y marca lo que no es correo con undefined', () => {
    expect(correoDeOperador('  Op@Ejemplo.TEST ')).toBe('op@ejemplo.test');
    expect(correoDeOperador('')).toBeNull();
    expect(correoDeOperador(undefined)).toBeNull();
    expect(correoDeOperador('sin-arroba')).toBeUndefined();
  });
});

describe('la compuerta: solo el canal «correo» admite altas sin teléfono', () => {
  it.each([['correo', true], ['whatsapp', false], ['ambos', false], ['caida', false]] as const)('canal %s ⇒ %s', async (c, esperado) => {
    canal = c;
    expect(await permiteAltaSinTelefono(T)).toBe(esperado);
  });
});

describe('la compuerta sigue el MISMO criterio de canal que la entrega', () => {
  it('una flota con el perfil cinco_agentes es siempre «correo», aunque su configuración diga whatsapp o no exista', async () => {
    perfil = 'cinco_agentes';
    canal = 'whatsapp';
    expect(await permiteAltaSinTelefono(T)).toBe(true);
    canal = 'caida';
    expect(await permiteAltaSinTelefono(T)).toBe(true);
  });
});

describe('validarOperadorImportado sin teléfono', () => {
  it('con la opción: exige número de empleado y correo y queda marcada sinTelefono (sin teléfono guardado todavía)', () => {
    const v = validarOperadorImportado({ nombre: 'Ana Torres', telefono: '', numeroEmpleado: 'E-7', correo: 'ANA@Ejemplo.test' }, 3, { sinTelefono: true });
    expect(v).toMatchObject({ fila: 3, telefono: '', sinTelefono: true, numeroEmpleado: 'E-7', correo: 'ana@ejemplo.test' });
    expect(() => validarOperadorImportado({ nombre: 'Ana Torres', telefono: '', correo: 'ana@ejemplo.test' }, 3, { sinTelefono: true })).toThrow(/número de empleado y correo/);
    expect(() => validarOperadorImportado({ nombre: 'Ana Torres', telefono: '', numeroEmpleado: 'E-7' }, 3, { sinTelefono: true })).toThrow(/número de empleado y correo/);
    expect(() => validarOperadorImportado({ nombre: 'Ana Torres', telefono: '', numeroEmpleado: 'E-7', correo: 'malo' }, 3, { sinTelefono: true })).toThrow(DatoInvalido);
  });

  it('sin la opción el teléfono SIGUE siendo obligatorio (la regla de siempre)', () => {
    expect(() => validarOperadorImportado({ nombre: 'Ana Torres', telefono: '', numeroEmpleado: 'E-7', correo: 'ana@ejemplo.test' }, 3)).toThrow(/sin teléfono/);
  });

  it('con teléfono, el correo es opcional pero si viene tiene que ser correo', () => {
    expect(validarOperadorImportado({ nombre: 'Ana Torres', telefono: '5512345678', correo: 'ana@ejemplo.test' }, 1, { sinTelefono: true }))
      .toMatchObject({ telefono: '525512345678', correo: 'ana@ejemplo.test' });
    expect(() => validarOperadorImportado({ nombre: 'Ana Torres', telefono: '5512345678', correo: 'x' }, 1)).toThrow(DatoInvalido);
  });
});

describe('interpretarFilasOperadores con la flota en canal correo', () => {
  const ENC = ['Nombre', 'Nº de empleado', 'Correo'];

  it('sin columna de teléfono: lee número de empleado + correo', () => {
    const r = interpretarFilasOperadores([ENC, ['Ana Torres', 'E-1', 'ana@ejemplo.test'], ['Luis Mora', 'E-2', 'luis@ejemplo.test']], { sinTelefono: true });
    expect(r.error).toBeUndefined();
    expect(r.filas.map((f) => [f.nombre, f.numeroEmpleado, f.correo, f.sinTelefono, f.telefono])).toEqual([
      ['Ana Torres', 'E-1', 'ana@ejemplo.test', true, ''], ['Luis Mora', 'E-2', 'luis@ejemplo.test', true, ''],
    ]);
  });

  it('sin la opción, la falta de la columna de teléfono sigue siendo error', () => {
    const r = interpretarFilasOperadores([ENC, ['Ana Torres', 'E-1', 'ana@ejemplo.test']]);
    expect(r.filas).toEqual([]);
    expect(r.error).toMatch(/columna de teléfono/);
  });

  it('número de empleado repetido y correo compartido se rechazan POR FILA, sin adivinar', () => {
    const r = interpretarFilasOperadores([
      ENC,
      ['Ana Torres', 'E-1', 'ana@ejemplo.test'],
      ['Ana Repetida', 'E-1', 'otra@ejemplo.test'],
      ['Luis Mora', 'E-2', 'compartido@ejemplo.test'],
      ['Pedro Gil', 'E-3', 'compartido@ejemplo.test'],
    ], { sinTelefono: true });
    expect(r.filas.map((f) => f.nombre)).toEqual(['Ana Torres']);
    const motivos = Object.fromEntries(r.descartadas.map((d) => [d.fila, d.motivo]));
    expect(motivos[3]).toMatch(/número de empleado repetido/);
    expect(motivos[4]).toMatch(/comparte el correo/);
    expect(motivos[5]).toMatch(/comparte el correo/);
  });

  it('una fila con teléfono y otra sin teléfono conviven en el mismo archivo', () => {
    const r = interpretarFilasOperadores([
      ['Nombre', 'Teléfono', 'Nº de empleado', 'Correo'],
      ['Ana Torres', '5512345678', 'E-1', ''],
      ['Luis Mora', '', 'E-2', 'luis@ejemplo.test'],
    ], { sinTelefono: true });
    expect(r.filas.map((f) => f.sinTelefono ?? false)).toEqual([false, true]);
  });
});

describe('planificar e importar operadores sin teléfono', () => {
  const filas = () => interpretarFilasOperadores([
    ['Nombre', 'Nº de empleado', 'Correo'],
    ['Ana Torres', 'E-1', 'ana@ejemplo.test'],
    ['Luis Mora', 'E-2', 'luis@ejemplo.test'],
  ], { sinTelefono: true }).filas;

  it('se encuentran por número de empleado DENTRO de la flota (no consulta teléfonos): el que ya estaba es «duplicado»', async () => {
    const consultas: Array<{ tabla: string; ops: Op[] }> = [];
    resolver = (tabla, ops) => {
      consultas.push({ tabla, ops });
      const col = String((ops.find((o) => o[0] === 'in')?.[1] as unknown[] | undefined)?.[0]);
      if (col === 'numero_empleado') return { data: [{ id: 'o-1', nombre: 'Ana Torres', numero_empleado: 'E-1', activo: true }], error: null };
      return { data: [], error: null };
    };
    const plan = await planificarOperadores(T, filas());
    expect(plan.error).toBeUndefined();
    expect(plan.nuevas.map((f) => f.numeroEmpleado)).toEqual(['E-2']);
    expect(plan.duplicados).toEqual([{ fila: 2, id: 'o-1', telefono: '', motivo: 'ya estaba, a nombre de Ana Torres' }]);
    // jamás pregunta por teléfonos de estas filas
    expect(consultas.some((c) => c.ops.some((o) => o[0] === 'in' && o[1][0] === 'telefono'))).toBe(false);
    // y toda consulta va anclada a la flota
    for (const c of consultas) expect(c.ops.some((o) => o[0] === 'eq' && o[1][0] === 'tenant_id' && o[1][1] === T)).toBe(true);
  });

  it('el correo que ya usa OTRO operador de la flota frena el alta con un motivo claro', async () => {
    resolver = (_t, ops) => {
      const col = String((ops.find((o) => o[0] === 'in')?.[1] as unknown[] | undefined)?.[0]);
      if (col === 'correo') return { data: [{ id: 'o-9', correo: 'luis@ejemplo.test' }], error: null };
      return { data: [], error: null };
    };
    const plan = await planificarOperadores(T, filas());
    expect(plan.nuevas.map((f) => f.numeroEmpleado)).toEqual(['E-1']);
    expect(plan.errores).toHaveLength(1);
    expect(plan.errores[0]).toMatchObject({ fila: 3 });
    expect(plan.errores[0].motivo).toMatch(/ya lo usa otro operador/);
  });

  it('un número de empleado de un operador de baja se dice, no se vuelve a dar de alta', async () => {
    resolver = (_t, ops) => {
      const col = String((ops.find((o) => o[0] === 'in')?.[1] as unknown[] | undefined)?.[0]);
      if (col === 'numero_empleado') return { data: [{ id: 'o-1', nombre: 'Ana Torres', numero_empleado: 'E-1', activo: false }], error: null };
      return { data: [], error: null };
    };
    const plan = await planificarOperadores(T, filas());
    expect(plan.errores[0].motivo).toMatch(/dado de baja/);
    expect(plan.nuevas.map((f) => f.numeroEmpleado)).toEqual(['E-2']);
  });

  it('una lectura caída FALLA CERRADO: no se importa nada', async () => {
    resolver = () => ({ data: null, error: { message: 'caída' } });
    const plan = await planificarOperadores(T, filas());
    expect(plan.error).toMatch(/no importé nada/);
    expect(plan.nuevas).toEqual([]);
  });

  it('importar escribe un marcador sin dígitos como teléfono, el correo y el número de empleado; el informe no lo expone', async () => {
    let insertadas: Array<Record<string, unknown>> = [];
    resolver = (tabla, ops) => {
      const ins = ops.find((o) => o[0] === 'insert');
      if (tabla === 'operador' && ins) {
        insertadas = ins[1][0] as Array<Record<string, unknown>>;
        return { data: insertadas.map((f, i) => ({ id: `n-${i}`, telefono: f.telefono })), error: null };
      }
      return { data: [], error: null };
    };
    const r = await importarOperadores(T, filas(), { origen: 'api' });
    expect(r.error).toBeUndefined();
    expect(r.errores).toEqual([]);
    expect(r.creados.map((c) => [c.fila, c.id, c.telefono])).toEqual([[2, 'n-0', ''], [3, 'n-1', '']]);
    expect(insertadas).toHaveLength(2);
    for (const f of insertadas) {
      expect(String(f.telefono)).toMatch(/^sin-tel:[a-z]{20}$/);
      expect(f.tenant_id).toBe(T);
    }
    expect(insertadas.map((f) => [f.numero_empleado, f.correo])).toEqual([['E-1', 'ana@ejemplo.test'], ['E-2', 'luis@ejemplo.test']]);
    expect(insertadas[0].telefono).not.toBe(insertadas[1].telefono);
  });

  it('una carrera sobre el índice de número de empleado se dice «ya estaba», no es un error ni una segunda alta', async () => {
    let intento = 0;
    resolver = (tabla, ops) => {
      const ins = ops.find((o) => o[0] === 'insert');
      if (tabla === 'operador' && ins) {
        intento += 1;
        return { data: null, error: { message: 'duplicate key value violates unique constraint "uq_operador_tenant_numero_empleado_sin_tel"' } };
      }
      const col = String((ops.find((o) => o[0] === 'in')?.[1] as unknown[] | undefined)?.[0]);
      if (col === 'numero_empleado' && intento > 0) return { data: [{ id: 'o-1', nombre: 'Ana Torres', numero_empleado: 'E-1', activo: true }], error: null };
      return { data: [], error: null };
    };
    const r = await importarOperadores(T, filas().slice(0, 1), { origen: 'api' });
    expect(r.creados).toEqual([]);
    expect(r.duplicados).toEqual([{ fila: 2, id: 'o-1', telefono: '', motivo: 'ya estaba, a nombre de Ana Torres' }]);
  });
});
