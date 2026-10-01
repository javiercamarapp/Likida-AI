import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({
  sesion: { tenantId: 't-1', rol: 'flota_admin', userId: 'u-dueno' } as Record<string, unknown>,
  filas: [] as unknown[],
  lecturaFalla: false,
  registrar: vi.fn(), revocar: vi.fn(),
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => d.sesion }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/legal/aceptacion', async (importar) => ({
  ...await importar<typeof import('@/lib/legal/aceptacion')>(),
  aceptacionesDeFlota: async () => { if (d.lecturaFalla) throw new Error('caída'); return d.filas; },
  registrarAceptacion: (...a: unknown[]) => d.registrar(...a),
  revocarMandato: (...a: unknown[]) => d.revocar(...a),
}));

import PaginaLegal from './page';
import { MANDATO_AUTOFACTURACION } from '@/lib/legal/documentos';

type Accion = (previo: null, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function accionDe(nodo: ReactNode, boton: string): Accion | undefined {
  if (Array.isArray(nodo)) return nodo.map((n) => accionDe(n, boton)).find(Boolean);
  if (!isValidElement<{ boton?: string; accion?: Accion; children?: ReactNode }>(nodo)) return;
  if (nodo.props.boton === boton) return nodo.props.accion;
  return accionDe(nodo.props.children, boton);
}
const sp = { searchParams: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  d.sesion = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-dueno' };
  d.filas = [];
  d.lecturaFalla = false;
  d.registrar.mockResolvedValue({ ok: true, registrada: true });
  d.revocar.mockResolvedValue({ ok: true });
});

describe('/dashboard/legal', () => {
  it('el dueño sin aceptaciones ve los botones de aceptar y de otorgar el mandato, con el texto del mandato a la vista', async () => {
    const html = renderToStaticMarkup(await PaginaLegal(sp));
    expect(html).toContain('Acepto los Términos y el Aviso de privacidad vigentes');
    expect(html).toContain('Otorgo el mandato en nombre de mi empresa');
    expect(html).toContain(MANDATO_AUTOFACTURACION.version);
    expect(html).toContain('mandata expresamente esa gestión');
  });

  it('con el mandato vigente dice quién/cuándo y ofrece retirarlo (no otorgarlo otra vez)', async () => {
    d.filas = [{ documento: 'mandato_autofacturacion', version: MANDATO_AUTOFACTURACION.version, aceptadoEn: '2026-10-02T15:00:00Z', userId: 'u-dueno', revocadoEn: null }];
    const html = renderToStaticMarkup(await PaginaLegal(sp));
    expect(html).toContain('Mandato vigente');
    expect(html).toContain('Retirar el mandato');
    expect(html).not.toContain('Otorgo el mandato');
  });

  it('un mandato REVOCADO o de otra versión no cuenta como vigente', async () => {
    d.filas = [
      { documento: 'mandato_autofacturacion', version: MANDATO_AUTOFACTURACION.version, aceptadoEn: '2026-10-02T15:00:00Z', userId: 'u', revocadoEn: '2026-10-03T00:00:00Z' },
      { documento: 'mandato_autofacturacion', version: 'm-2020-01-01', aceptadoEn: '2026-10-02T15:00:00Z', userId: 'u', revocadoEn: null },
    ];
    expect(renderToStaticMarkup(await PaginaLegal(sp))).toContain('Otorgo el mandato');
  });

  it('un contador NO ve botones: se le dice que es del dueño', async () => {
    d.sesion = { tenantId: 't-1', rol: 'contador', userId: 'u-c' };
    // el contador no ve la ruta (administracion) → redirige
    await expect(PaginaLegal(sp)).rejects.toThrow(/REDIRECT \/dashboard/);
  });

  it('una base caída se dice, no se pinta como «no has aceptado nada»', async () => {
    d.lecturaFalla = true;
    const html = renderToStaticMarkup(await PaginaLegal(sp));
    expect(html).toMatch(/No pude leer el registro/);
    expect(html).not.toContain('Otorgo el mandato');
  });

  it('las acciones: aceptar registra Términos y Aviso con el userId de la SESIÓN (no del formulario)', async () => {
    const accion = accionDe(await PaginaLegal(sp), 'Acepto los Términos y el Aviso de privacidad vigentes');
    const fd = new FormData(); fd.set('userId', 'otro-usuario'); fd.set('tenantId', 'otra-flota');
    const r = await accion!(null, fd);
    expect(r.ok).toMatch(/Quedó registrada/);
    expect(d.registrar).toHaveBeenNthCalledWith(1, 't-1', 'u-dueno', 'terminos');
    expect(d.registrar).toHaveBeenNthCalledWith(2, 't-1', 'u-dueno', 'aviso_privacidad');
  });

  it('otorgar el mandato lo registra; si la base lo rechaza, el motivo llega a la pantalla', async () => {
    const accion = accionDe(await PaginaLegal(sp), 'Otorgo el mandato en nombre de mi empresa');
    expect((await accion!(null, new FormData())).ok).toMatch(/Mandato otorgado/);
    expect(d.registrar).toHaveBeenCalledWith('t-1', 'u-dueno', 'mandato_autofacturacion');
    d.registrar.mockResolvedValue({ ok: false, motivo: 'solo el dueño de la flota (flota_admin) puede otorgar el mandato' });
    expect((await accion!(null, new FormData())).error).toMatch(/solo el dueño/);
  });

  it('retirar el mandato llama a la revocación con la sesión', async () => {
    d.filas = [{ documento: 'mandato_autofacturacion', version: MANDATO_AUTOFACTURACION.version, aceptadoEn: '2026-10-02T15:00:00Z', userId: 'u-dueno', revocadoEn: null }];
    const accion = accionDe(await PaginaLegal(sp), 'Retirar el mandato');
    expect((await accion!(null, new FormData())).ok).toMatch(/Mandato retirado/);
    expect(d.revocar).toHaveBeenCalledWith('t-1', 'u-dueno');
  });

  it('una acción alcanzada por POST cuando la sesión YA no es de dueño se niega sin tocar la base', async () => {
    const accion = accionDe(await PaginaLegal(sp), 'Otorgo el mandato en nombre de mi empresa');
    d.sesion = { tenantId: 't-1', rol: 'contador', userId: 'u-c' };
    expect((await accion!(null, new FormData())).error).toMatch(/Solo el dueño/);
    d.sesion = { tenantId: 't-1', rol: 'superadmin', userId: 'u-sa' };
    expect((await accion!(null, new FormData())).error).toMatch(/Solo el dueño/);
    expect(d.registrar).not.toHaveBeenCalled();
  });
});
