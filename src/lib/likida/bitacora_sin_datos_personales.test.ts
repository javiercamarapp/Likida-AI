import { describe, it, expect, vi, beforeEach } from 'vitest';

// F20 (d): `bitacora_auditoria.detalle` no guarda valores personales (la tabla sobrevive a un borrado ARCO). Todos los datos son sintéticos.
const insert = vi.fn();
const logs = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (tabla: string) => ({ insert: (fila: unknown) => insert(tabla, fila) }) }),
}));
vi.mock('@/lib/logger', () => ({ logger: logs }));

const { anotarBitacora, filaBitacora, rutasConDatoPersonal, textoConDatoPersonal, MARCA_DATO_PERSONAL } = await import('./bitacora_escritura');

beforeEach(() => { vi.clearAllMocks(); insert.mockResolvedValue({ error: null }); });

describe('detección de valores personales', () => {
  it.each([
    ['correo', 'avisar a persona.ficticia@ejemplo.test'],
    ['RFC', 'XAXX010101000'],
    ['teléfono de 10 dígitos', '5512345678'],
    ['teléfono con +52', '+52 55 1234 5678'],
    ['CLABE', '012345678901234567'],
  ])('%s se detecta', (_n, v) => expect(textoConDatoPersonal(v)).toBe(true));

  it.each([
    ['un UUID', '8f14e45f-ceea-467a-9575-1f6b1a2c3d4e'],
    ['una fecha ISO', '2026-11-10T15:00:00.000Z'],
    ['un monto', '12345.67'],
    ['una marca de tiempo en ms', '1731250000000'],
    ['un estado', 'pausada'],
    ['un nombre de campo', 'estado_plan'],
  ])('%s NO es un dato personal', (_n, v) => expect(textoConDatoPersonal(v)).toBe(false));

  it('da la ruta del campo, anidado o en arreglos, sin devolver el valor', () => {
    const r = rutasConDatoPersonal({ ok: 'pausada', a: { contacto: 'x@ejemplo.test' }, lista: ['5512345678'] });
    expect(r).toEqual(['a.contacto', 'lista[0]']);
  });
});

describe('el escritor único no deja pasar valores personales', () => {
  it('la fila sale con la marca en lugar del valor y sin mutar la entrada', () => {
    const detalle = { operacion: 'pausar', destinatario: 'persona.ficticia@ejemplo.test', n: 3 };
    const fila = filaBitacora({ tenantId: 't1', actor: 'sistema', accion: 'plan.pausar', entidad: 'suscripcion' as never, entidadId: 'e1', detalle });
    expect(fila.detalle).toEqual({ operacion: 'pausar', destinatario: MARCA_DATO_PERSONAL, n: 3 });
    expect(detalle.destinatario).toBe('persona.ficticia@ejemplo.test');
    expect(JSON.stringify(fila)).not.toContain('@');
  });

  it('anotarBitacora inserta la versión limpia y avisa por log CON la ruta, nunca con el valor', async () => {
    await anotarBitacora({ tenantId: 't1', actor: { id: 'u1', email: 'soporte@ejemplo.test' }, accion: 'x', entidad: 'suscripcion' as never, entidadId: 'e1', detalle: { tel: '5512345678' } });
    const [, fila] = insert.mock.calls[0] as [string, { detalle: unknown; actor_email: string }];
    expect(fila.detalle).toEqual({ tel: MARCA_DATO_PERSONAL });
    expect(fila.actor_email).toBe('soporte@ejemplo.test'); // la firma del actor es otra columna
    const aviso = logs.warn.mock.calls.find((c) => c[0] === 'bitacora.detalle_con_dato_personal');
    expect(aviso?.[1]).toMatchObject({ campos: ['tel'] });
    expect(JSON.stringify(logs.warn.mock.calls)).not.toContain('5512345678');
  });

  it('un detalle limpio pasa idéntico y sin aviso', async () => {
    await anotarBitacora({ tenantId: 't1', actor: 'sistema', accion: 'x', entidad: 'suscripcion' as never, entidadId: 'e1', detalle: { estadoAntes: 'activa', estadoDespues: 'pausada' } });
    const [, fila] = insert.mock.calls[0] as [string, { detalle: unknown }];
    expect(fila.detalle).toEqual({ estadoAntes: 'activa', estadoDespues: 'pausada' });
    expect(logs.warn).not.toHaveBeenCalled();
  });
});
