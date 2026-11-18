import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ maybeSingle: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: dobles.maybeSingle }) }),
      upsert: dobles.upsert,
    }),
  }),
}));

import {
  BLOQUEADO_SIN_RFC, EntidadNoDisponible, candadoDeEntidad, entidadDeFila, guardarEntidad, leerEntidad, normalizarRfc, validarEntidad,
  type EntidadGuardada,
} from './entidad';

// Un RFC de persona moral con dígito verificador correcto (calculado con el algoritmo del SAT) y el mismo con el dígito cambiado.
const RFC_BUENO = 'LIK261101ABA';
const RFC_DIGITO_MALO = 'LIK261101AB3';
const base = { razonSocial: 'Likida SAPI de CV', rfc: RFC_BUENO, regimenFiscal: '601', domicilioFiscalCp: '97000', constituidaEl: '2026-11-01' };
const HOY = '2026-11-15';

beforeEach(() => {
  dobles.maybeSingle.mockReset();
  dobles.upsert.mockReset();
});

describe('normalizarRfc', () => {
  it('pasa a mayúsculas, quita espacios y signos, y un vacío es null', () => {
    expect(normalizarRfc(' lik-261101 aba ')).toBe(RFC_BUENO);
    expect(normalizarRfc('   ')).toBeNull();
    expect(normalizarRfc(undefined)).toBeNull();
    expect(normalizarRfc('ÑAN&010101AB1')).toBe('ÑAN&010101AB1');
  });
});

describe('validarEntidad', () => {
  it('acepta una entidad completa y la normaliza', () => {
    const r = validarEntidad({ ...base, rfc: ' lik261101aba ', razonSocial: '  Likida   SAPI de CV ' }, HOY);
    expect(r).toEqual({ ok: true, valor: { razonSocial: 'Likida SAPI de CV', rfc: RFC_BUENO, regimenFiscal: '601', domicilioFiscalCp: '97000', constituidaEl: '2026-11-01' } });
  });

  it('todo vacío es válido: Likida aún no tiene entidad y no se inventa nada', () => {
    const r = validarEntidad({ razonSocial: '', rfc: '', regimenFiscal: '', domicilioFiscalCp: '', constituidaEl: '' }, HOY);
    expect(r).toEqual({ ok: true, valor: { razonSocial: null, rfc: null, regimenFiscal: null, domicilioFiscalCp: null, constituidaEl: null } });
  });

  it('un RFC con dígito verificador malo se rechaza (la forma sola no basta)', () => {
    const r = validarEntidad({ ...base, rfc: RFC_DIGITO_MALO }, HOY);
    expect(r).toEqual({ ok: false, errores: { rfc: 'rfc_digito' } });
  });

  it('un RFC con forma inválida se rechaza', () => {
    const r = validarEntidad({ ...base, rfc: 'ABC123' }, HOY);
    expect(r).toEqual({ ok: false, errores: { rfc: 'rfc_forma' } });
  });

  it('los RFC genéricos del SAT no pueden ser el RFC propio', () => {
    expect(validarEntidad({ ...base, rfc: 'XAXX010101000' }, HOY)).toEqual({ ok: false, errores: { rfc: 'rfc_generico' } });
    expect(validarEntidad({ ...base, rfc: 'xexx010101000' }, HOY)).toEqual({ ok: false, errores: { rfc: 'rfc_generico' } });
  });

  it('un RFC sin razón social se rechaza: no hay RFC sin nombre', () => {
    const r = validarEntidad({ ...base, razonSocial: '' }, HOY);
    expect(r).toEqual({ ok: false, errores: { razonSocial: 'razon_social_falta' } });
  });

  it('razón social sin RFC es válida (se captura por partes)', () => {
    const r = validarEntidad({ ...base, rfc: '' }, HOY);
    expect(r.ok).toBe(true);
  });

  it('el CP lleva exactamente 5 dígitos', () => {
    expect(validarEntidad({ ...base, domicilioFiscalCp: '9700' }, HOY)).toEqual({ ok: false, errores: { domicilioFiscalCp: 'cp_invalido' } });
    expect(validarEntidad({ ...base, domicilioFiscalCp: '97 000' }, HOY)).toEqual({ ok: false, errores: { domicilioFiscalCp: 'cp_invalido' } });
  });

  it('la fecha de constitución existe y no es futura', () => {
    expect(validarEntidad({ ...base, constituidaEl: '2026-02-30' }, HOY)).toEqual({ ok: false, errores: { constituidaEl: 'fecha_invalida' } });
    expect(validarEntidad({ ...base, constituidaEl: '01/11/2026' }, HOY)).toEqual({ ok: false, errores: { constituidaEl: 'fecha_invalida' } });
    expect(validarEntidad({ ...base, constituidaEl: '2026-11-16' }, HOY)).toEqual({ ok: false, errores: { constituidaEl: 'fecha_futura' } });
    expect(validarEntidad({ ...base, constituidaEl: HOY }, HOY).ok).toBe(true);
  });

  it('junta varios errores a la vez', () => {
    const r = validarEntidad({ ...base, rfc: 'ABC', domicilioFiscalCp: '1', constituidaEl: 'x' }, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errores).sort()).toEqual(['constituidaEl', 'domicilioFiscalCp', 'rfc']);
  });

  it('razón social o régimen demasiado largos se rechazan', () => {
    expect(validarEntidad({ ...base, razonSocial: 'x'.repeat(201), rfc: '' }, HOY)).toEqual({ ok: false, errores: { razonSocial: 'razon_social_larga' } });
    expect(validarEntidad({ ...base, regimenFiscal: 'y'.repeat(81) }, HOY)).toEqual({ ok: false, errores: { regimenFiscal: 'regimen_largo' } });
  });
});

describe('candadoDeEntidad', () => {
  const guardada = (rfc: string | null): EntidadGuardada => ({ ...entidadDeFila({ razon_social: null, rfc, regimen_fiscal: null, domicilio_fiscal_cp: null, constituida_el: null, actualizada_por: null, actualizada_en: null }) });

  it('sin fila, sin RFC o con la tabla ausente: sin_rfc', () => {
    expect(candadoDeEntidad({ estado: 'ok', dato: null })).toBe('sin_rfc');
    expect(candadoDeEntidad({ estado: 'ok', dato: guardada(null) })).toBe('sin_rfc');
    expect(candadoDeEntidad({ estado: 'no_disponible' })).toBe('sin_rfc');
  });

  it('con RFC: con_rfc', () => {
    expect(candadoDeEntidad({ estado: 'ok', dato: guardada(RFC_BUENO) })).toBe('con_rfc');
  });

  it('una lectura que falló NO es «sin RFC» ni «con RFC»: es desconocido', () => {
    expect(candadoDeEntidad({ estado: 'error', mensaje: 'caída' })).toBe('desconocido');
  });

  it('las funciones de paquete devuelven el marcador de bloqueo', () => {
    expect(BLOQUEADO_SIN_RFC).toEqual({ bloqueado: 'sin_rfc' });
  });
});

describe('leerEntidad', () => {
  it('tabla ausente → no_disponible (no «sin entidad»)', async () => {
    dobles.maybeSingle.mockResolvedValue({ data: null, error: { code: '42P01', message: 'relation "bo_entidad" does not exist' } });
    expect(await leerEntidad()).toEqual({ estado: 'no_disponible' });
  });

  it('tabla sin fila → ok con null', async () => {
    dobles.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await leerEntidad()).toEqual({ estado: 'ok', dato: null });
  });

  it('una fila se mapea a la entidad', async () => {
    dobles.maybeSingle.mockResolvedValue({
      data: { razon_social: 'Likida SAPI de CV', rfc: RFC_BUENO, regimen_fiscal: '601', domicilio_fiscal_cp: '97000', constituida_el: '2026-11-01', actualizada_por: 'u1', actualizada_en: '2026-11-02T10:00:00Z' },
      error: null,
    });
    const r = await leerEntidad();
    expect(r.estado).toBe('ok');
    if (r.estado === 'ok') expect(r.dato).toMatchObject({ razonSocial: 'Likida SAPI de CV', rfc: RFC_BUENO, domicilioFiscalCp: '97000' });
  });

  it('un error de la base es error, no «sin entidad»', async () => {
    dobles.maybeSingle.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement' } });
    expect((await leerEntidad()).estado).toBe('error');
  });

  it('una excepción al leer es error y no lanza', async () => {
    dobles.maybeSingle.mockRejectedValue(new Error('red caída'));
    expect(await leerEntidad()).toEqual({ estado: 'error', mensaje: 'red caída' });
  });
});

describe('guardarEntidad', () => {
  const valor = { razonSocial: 'Likida SAPI de CV', rfc: RFC_BUENO, regimenFiscal: null, domicilioFiscalCp: null, constituidaEl: null };

  it('hace upsert de la fila id = 1 con quién la guardó', async () => {
    dobles.upsert.mockResolvedValue({ error: null });
    await guardarEntidad(valor, 'u1');
    expect(dobles.upsert).toHaveBeenCalledTimes(1);
    const [fila, opts] = dobles.upsert.mock.calls[0];
    expect(fila).toMatchObject({ id: 1, rfc: RFC_BUENO, razon_social: 'Likida SAPI de CV', actualizada_por: 'u1' });
    expect(opts).toEqual({ onConflict: 'id' });
  });

  it('tabla ausente lanza EntidadNoDisponible; otro error lanza un Error normal', async () => {
    dobles.upsert.mockResolvedValue({ error: { code: '42P01', message: 'does not exist' } });
    await expect(guardarEntidad(valor, 'u1')).rejects.toBeInstanceOf(EntidadNoDisponible);
    dobles.upsert.mockResolvedValue({ error: { code: '23514', message: 'check violation' } });
    await expect(guardarEntidad(valor, 'u1')).rejects.toThrow('guardarEntidad');
  });
});
