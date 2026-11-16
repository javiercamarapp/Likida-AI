import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), leerEntidad: vi.fn() }));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ pasoExtraSuperadmin: vi.fn(), anotarAccionAdmin: vi.fn(), AVISO_SIN_BITACORA: ' (sin bitácora)' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/backoffice/entidad', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/entidad')>()),
  leerEntidad: dobles.leerEntidad,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/back-office/entidad', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import EntidadPage from './page';
import { NO_DISPONIBLE, OK } from '@/lib/backoffice/lectura';

const entidad = (rfc: string | null) => OK({
  razonSocial: rfc ? 'Likida SAPI de CV' : null, rfc, regimenFiscal: null, domicilioFiscalCp: '97000', constituidaEl: null,
  actualizadaPor: 'u1', actualizadaEn: '2026-11-02T18:00:00Z',
});
const html = async () => renderToStaticMarkup(await EntidadPage());

beforeEach(() => {
  dobles.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1', rol: 'superadmin' });
  dobles.leerEntidad.mockReset().mockResolvedValue(NO_DISPONIBLE);
});

describe('Back-office · Entidad', () => {
  it('la puerta va en el render: sin superadmin no se lee la entidad', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(EntidadPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(dobles.leerEntidad).not.toHaveBeenCalled();
  });

  it('con la tabla ausente: «No disponible. No es cero.», el candado fijo y SIN formulario que no puede funcionar', async () => {
    const h = await html();
    expect(h).toContain('La tabla de la entidad aún no existe');
    expect(h).toContain('Likida aún no tiene razón social ni RFC propios');
    expect(h).not.toContain('Guardar la entidad');
  });

  it('sin RFC: formulario con los cinco campos, chip «Sin RFC propio» y cuatro piezas «No evaluable»', async () => {
    dobles.leerEntidad.mockResolvedValue(entidad(null));
    const h = await html();
    for (const n of ['razonSocial', 'rfc', 'regimenFiscal', 'domicilioFiscalCp', 'constituidaEl']) expect(h, n).toContain(`name="${n}"`);
    expect(h).toContain('Sin RFC propio');
    expect(h.match(/No evaluable/g)).toHaveLength(4);
    expect(h).toContain('Guardar la entidad');
    expect(h).toContain('Likida aún no tiene razón social ni RFC propios');
  });

  it('con RFC: lo muestra, quita el candado y las piezas se pueden evaluar', async () => {
    dobles.leerEntidad.mockResolvedValue(entidad('LIK261101ABA'));
    const h = await html();
    expect(h).toContain('value="LIK261101ABA"');
    expect(h).toContain('Con RFC propio');
    expect(h).not.toContain('Likida aún no tiene razón social ni RFC propios');
    expect(h.match(/Se puede evaluar/g)).toHaveLength(4);
    expect(h).not.toContain('No evaluable');
  });

  it('una entidad que no se pudo leer no se pinta como «sin RFC» ni como «con RFC»', async () => {
    dobles.leerEntidad.mockResolvedValue({ estado: 'error', mensaje: 'caída' });
    const h = await html();
    expect(h).toContain('No se pudo leer la entidad');
    expect(h).not.toContain('Con RFC propio');
    expect(h).not.toContain('Likida aún no tiene razón social ni RFC propios');
    expect(h).not.toContain('Guardar la entidad');
  });
});
