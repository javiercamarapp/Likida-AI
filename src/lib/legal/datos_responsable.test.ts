import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({
  actual: { razon_social: null, domicilio_fiscal: null, contacto_privacidad: null } as Record<string, unknown> | null,
  errorLectura: null as null | { message: string }, errorUpdate: null as null | { message: string },
  updates: [] as Array<{ valores: Record<string, unknown>; id: string }>,
  bitacora: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({
  from: () => {
    let valores: Record<string, unknown> | null = null;
    const c: Record<string, unknown> = {
      select: () => c,
      update: (v: Record<string, unknown>) => { valores = v; return c; },
      eq: (_col: string, id: string) => {
        if (valores) return Promise.resolve({ error: d.errorUpdate, _registrar: d.updates.push({ valores, id }) });
        return c;
      },
      maybeSingle: async () => ({ data: d.actual, error: d.errorLectura }),
    };
    return c;
  },
}) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => d.bitacora(...a) }));

import { validarCamposResponsable, guardarDatosResponsable, leerDatosResponsable } from './datos_responsable';

beforeEach(() => {
  vi.clearAllMocks();
  d.actual = { razon_social: null, domicilio_fiscal: null, contacto_privacidad: null };
  d.errorLectura = null; d.errorUpdate = null; d.updates.length = 0;
});

const OK = { razonSocial: 'TRANSPORTES PÉREZ SA DE CV', domicilio: 'Av. Itzáes 500, Mérida, Yucatán', contactoPrivacidad: 'privacidad@perez.mx' };

describe('validarCamposResponsable', () => {
  it('acepta datos válidos, normaliza espacios y vacío = null (se puede BORRAR un dato)', () => {
    const r = validarCamposResponsable({ ...OK, razonSocial: '  TRANSPORTES   PÉREZ  SA DE CV ', domicilio: '', contactoPrivacidad: '   ' });
    expect(r).toEqual({ ok: true, valores: { razonSocial: 'TRANSPORTES PÉREZ SA DE CV', domicilio: null, contactoPrivacidad: null } });
  });
  it('el contacto puede ser correo o teléfono (>= 10 dígitos), no cualquier texto', () => {
    expect(validarCamposResponsable({ contactoPrivacidad: '999 370 0779' }).ok).toBe(true);
    expect(validarCamposResponsable({ contactoPrivacidad: 'a@b.mx' }).ok).toBe(true);
    for (const malo of ['hola', '12345', 'a@b', '<script>@x.mx', 'a b@c.mx']) {
      expect(validarCamposResponsable({ contactoPrivacidad: malo }).ok, malo).toBe(false);
    }
  });
  it('largos mínimos y máximos', () => {
    expect(validarCamposResponsable({ razonSocial: 'ab' }).ok).toBe(false);
    expect(validarCamposResponsable({ razonSocial: 'a'.repeat(201) }).ok).toBe(false);
    expect(validarCamposResponsable({ domicilio: 'corto' }).ok).toBe(false);
    expect(validarCamposResponsable({ domicilio: 'x'.repeat(401) }).ok).toBe(false);
  });
  it('caracteres de control (NUL, ESC) se rechazan; los saltos de línea se aplanan a espacio', () => {
    expect(validarCamposResponsable({ razonSocial: 'ABC\u0000DEF' }).ok).toBe(false);
    expect(validarCamposResponsable({ razonSocial: 'ABC\u001bDEF' }).ok).toBe(false);
    expect(validarCamposResponsable({ razonSocial: 'ABC\nDEF SA' })).toEqual({ ok: true, valores: { razonSocial: 'ABC DEF SA', domicilio: null, contactoPrivacidad: null } });
  });
  it('un valor que no es texto cuenta como ausente (no truena)', () => {
    expect(validarCamposResponsable({ razonSocial: 5 as unknown as string, domicilio: null, contactoPrivacidad: undefined })).toEqual({
      ok: true, valores: { razonSocial: null, domicilio: null, contactoPrivacidad: null },
    });
  });
});

describe('guardarDatosResponsable', () => {
  it('guarda por la flota de la sesión y deja bitácora de QUÉ campos cambiaron (no de sus valores)', async () => {
    const r = await guardarDatosResponsable('t-1', OK, { id: 'u-1' });
    expect(r).toEqual({ ok: true });
    expect(d.updates).toEqual([{ id: 't-1', valores: { razon_social: OK.razonSocial, domicilio_fiscal: OK.domicilio, contacto_privacidad: OK.contactoPrivacidad } }]);
    const entrada = d.bitacora.mock.calls[0][0] as { accion: string; tenantId: string; detalle: { campos: string[] } };
    expect(entrada).toMatchObject({ accion: 'tenant.datos_privacidad', tenantId: 't-1' });
    expect(entrada.detalle.campos).toEqual(['razonSocial', 'domicilio', 'contactoPrivacidad']);
    expect(JSON.stringify(entrada)).not.toContain('Itzáes');
  });
  it('sin cambios no escribe ni anota (idempotente)', async () => {
    d.actual = { razon_social: OK.razonSocial, domicilio_fiscal: OK.domicilio, contacto_privacidad: OK.contactoPrivacidad };
    expect(await guardarDatosResponsable('t-1', OK, { id: 'u-1' })).toEqual({ ok: true });
    expect(d.updates).toHaveLength(0);
    expect(d.bitacora).not.toHaveBeenCalled();
  });
  it('solo anota los campos que cambiaron', async () => {
    d.actual = { razon_social: OK.razonSocial, domicilio_fiscal: OK.domicilio, contacto_privacidad: null };
    await guardarDatosResponsable('t-1', OK, { id: 'u-1' });
    expect((d.bitacora.mock.calls[0][0] as { detalle: { campos: string[] } }).detalle.campos).toEqual(['contactoPrivacidad']);
  });
  it('un valor inválido no toca la base', async () => {
    const r = await guardarDatosResponsable('t-1', { ...OK, contactoPrivacidad: 'hola' }, { id: 'u-1' });
    expect(r.ok).toBe(false);
    expect(d.updates).toHaveLength(0);
  });
  it('un error de la base se dice y no se anota como hecho', async () => {
    d.errorUpdate = { message: 'caída' };
    const r = await guardarDatosResponsable('t-1', OK, { id: 'u-1' });
    expect(r).toEqual({ ok: false, error: 'No se pudieron guardar los datos. Intenta de nuevo.' });
    expect(d.bitacora).not.toHaveBeenCalled();
  });
  it('leer: un error de lectura LANZA; una flota inexistente también', async () => {
    d.errorLectura = { message: 'caída' };
    await expect(leerDatosResponsable('t-1')).rejects.toThrow('caída');
    d.errorLectura = null; d.actual = null;
    await expect(leerDatosResponsable('t-1')).rejects.toThrow(/no existe/);
  });
  it('el aislamiento: el tenant que se escribe es EL ARGUMENTO, nunca algo del formulario', async () => {
    await guardarDatosResponsable('t-sesion', { ...OK, tenantId: 'otra' } as never, { id: 'u-1' });
    expect(d.updates[0].id).toBe('t-sesion');
  });
});
