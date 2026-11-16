import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(), paso: vi.fn(), anotar: vi.fn(), revalidar: vi.fn(), leerEntidad: vi.fn(), guardarEntidad: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: dobles.revalidar }));
vi.mock('@/lib/admin/acciones_riesgo', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/acciones_riesgo')>()),
  pasoExtraSuperadmin: dobles.paso,
  anotarAccionAdmin: dobles.anotar,
}));
vi.mock('@/lib/backoffice/entidad', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/entidad')>()),
  leerEntidad: dobles.leerEntidad,
  guardarEntidad: dobles.guardarEntidad,
}));

import { accionGuardarEntidad } from './acciones';
import { AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { EntidadNoDisponible } from '@/lib/backoffice/entidad';
import { NO_DISPONIBLE, OK } from '@/lib/backoffice/lectura';

const RFC = 'LIK261101ABA';
const fd = (o: Record<string, string> = {}): FormData => {
  const f = new FormData();
  const base = { razonSocial: 'Likida SAPI de CV', rfc: RFC, regimenFiscal: '', domicilioFiscalCp: '97000', constituidaEl: '' };
  for (const [k, v] of Object.entries({ ...base, ...o })) f.set(k, v);
  return f;
};
const correr = (datos: FormData = fd()): Promise<ResultadoAccion> => accionGuardarEntidad(null, datos);
const guardada = (rfc: string | null) => OK({ razonSocial: rfc ? 'Likida SAPI de CV' : null, rfc, regimenFiscal: null, domicilioFiscalCp: null, constituidaEl: null, actualizadaPor: null, actualizadaEn: null });

beforeEach(() => {
  for (const d of Object.values(dobles)) d.mockReset();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u1', email: 'javier@example.com', rol: 'superadmin' });
  dobles.paso.mockResolvedValue(null);
  dobles.anotar.mockResolvedValue(true);
  dobles.leerEntidad.mockResolvedValue(OK(null));
  dobles.guardarEntidad.mockResolvedValue(undefined);
});

describe('accionGuardarEntidad', () => {
  it('sin superadmin no lee, no guarda ni anota nada', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(correr()).rejects.toThrow('NEXT_REDIRECT');
    expect(dobles.leerEntidad).not.toHaveBeenCalled();
    expect(dobles.guardarEntidad).not.toHaveBeenCalled();
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('un RFC con dígito verificador malo se rechaza con su texto y no toca la base', async () => {
    const r = await correr(fd({ rfc: 'LIK261101AB3' }));
    expect(r?.error).toContain('dígito verificador');
    expect(dobles.guardarEntidad).not.toHaveBeenCalled();
    expect(dobles.paso).not.toHaveBeenCalled();
  });

  it('junta todos los errores de campo en un solo mensaje', async () => {
    const r = await correr(fd({ rfc: 'ABC', domicilioFiscalCp: '12' }));
    expect(r?.error).toContain('12 o 13 caracteres');
    expect(r?.error).toContain('5 dígitos');
  });

  it('un RFC sin razón social se rechaza', async () => {
    expect((await correr(fd({ razonSocial: '' })))?.error).toContain('necesita su razón social');
  });

  it('cambiar el RFC exige el segundo factor; sin él no se guarda nada', async () => {
    dobles.paso.mockResolvedValue('Cambiar el RFC exige tu segundo factor.');
    const r = await correr();
    expect(r).toEqual({ error: 'Cambiar el RFC exige tu segundo factor.' });
    expect(dobles.paso).toHaveBeenCalledWith('perfil_fiscal', expect.objectContaining({ userId: 'u1' }));
    expect(dobles.guardarEntidad).not.toHaveBeenCalled();
  });

  it('guardar sin cambiar el RFC no pide segundo factor; guarda con quién lo hizo, revalida y anota los campos cambiados', async () => {
    dobles.leerEntidad.mockResolvedValue(guardada(RFC));
    const r = await correr(fd({ domicilioFiscalCp: '97010' }));
    expect(r?.ok).toContain('Entidad guardada');
    expect(dobles.paso).not.toHaveBeenCalled();
    expect(dobles.guardarEntidad).toHaveBeenCalledWith(expect.objectContaining({ rfc: RFC, domicilioFiscalCp: '97010' }), 'u1');
    expect(dobles.revalidar).toHaveBeenCalledWith('/admin/back-office');
    expect(dobles.revalidar).toHaveBeenCalledWith('/admin/back-office/entidad');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'bo_entidad.guardada', entidad: 'bo_entidad', entidadId: '1', tenantId: null,
      detalle: { campos_cambiados: ['domicilioFiscalCp'], con_rfc: true },
    }));
  });

  it('la primera captura del RFC pide el segundo factor y anota que ya hay RFC', async () => {
    const r = await correr();
    expect(r?.ok).toContain('Entidad guardada');
    expect(dobles.paso).toHaveBeenCalledWith('perfil_fiscal', expect.anything());
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ detalle: { campos_cambiados: ['razonSocial', 'rfc', 'domicilioFiscalCp'], con_rfc: true } }));
  });

  it('si la bitácora no pudo escribir, lo dice', async () => {
    dobles.anotar.mockResolvedValue(false);
    expect((await correr())?.ok).toContain(AVISO_SIN_BITACORA);
  });

  it('una entidad actual que no se pudo leer NO se sobrescribe a ciegas', async () => {
    dobles.leerEntidad.mockResolvedValue({ estado: 'error', mensaje: 'caída' });
    const r = await correr();
    expect(r?.error).toContain('No se pudo leer la entidad actual');
    expect(dobles.guardarEntidad).not.toHaveBeenCalled();
  });

  it('con la tabla ausente dice que no existe y no guarda', async () => {
    dobles.leerEntidad.mockResolvedValue(NO_DISPONIBLE);
    expect((await correr())?.error).toContain('aún no existe');
    expect(dobles.guardarEntidad).not.toHaveBeenCalled();
  });

  it('si la tabla desaparece al escribir, lo dice; un error desconocido no filtra el mensaje de la base', async () => {
    dobles.guardarEntidad.mockRejectedValue(new EntidadNoDisponible());
    expect((await correr())?.error).toContain('aún no existe');
    dobles.guardarEntidad.mockRejectedValue(new Error('violates check "boom"'));
    const r = await correr();
    expect(typeof r?.error).toBe('string');
    expect(r?.error).not.toContain('boom');
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('todo vacío es válido: guarda una entidad sin RFC y no pide segundo factor', async () => {
    const r = await correr(fd({ razonSocial: '', rfc: '', domicilioFiscalCp: '' }));
    expect(r?.ok).toContain('Entidad guardada');
    expect(dobles.paso).not.toHaveBeenCalled();
    expect(dobles.guardarEntidad).toHaveBeenCalledWith({ razonSocial: null, rfc: null, regimenFiscal: null, domicilioFiscalCp: null, constituidaEl: null }, 'u1');
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({ detalle: { campos_cambiados: [], con_rfc: false } }));
  });
});
