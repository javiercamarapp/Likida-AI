import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El alta de /admin deja de ser «crea la cuenta y que alguien le avise»: manda la invitación por correo, asienta la bitácora y DICE la verdad
// del envío. La página es un server component con la acción por closure; se extrae del árbol renderizado, como en costos-facturacion.

type Elemento = ReactElement<Record<string, unknown>>;
type Accion = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;

const d = vi.hoisted(() => ({
  sup: vi.fn(), resumen: vi.fn(), alta: vi.fn(), paso: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.sup }));
vi.mock('@/lib/admin/negocio', () => ({ getResumenNegocio: d.resumen }));
vi.mock('@/lib/admin/acciones_riesgo', async (i) => ({ ...(await i<typeof import('@/lib/admin/acciones_riesgo')>()), pasoExtraSuperadmin: d.paso }));
vi.mock('@/lib/auth/gestion_admin', async (i) => ({ ...(await i<typeof import('@/lib/auth/gestion_admin')>()), altaDeUsuarioDesdeAdmin: d.alta }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));

import { DatoInvalido } from '@/lib/likida/errores';
import { FormaConAviso } from '../../ui/forma';
import NuevoUsuario from './page';

function buscar(n: ReactNode, c: unknown, out: Elemento[] = []): Elemento[] {
  if (Array.isArray(n)) { for (const h of n) buscar(h, c, out); return out; }
  if (!isValidElement<Record<string, unknown>>(n)) return out;
  if (n.type === c) out.push(n);
  buscar(n.props.children as ReactNode, c, out);
  return out;
}
const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const BUENO = { tenantId: 'tn-1', email: 'persona@flota.test', rol: 'contador', nombre: 'Pat' };
let crear: Accion;

beforeEach(async () => {
  vi.clearAllMocks();
  d.sup.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'superadmin' });
  d.resumen.mockResolvedValue({ flotas: [{ id: 'tn-1', nombre: 'ACME' }] });
  d.paso.mockResolvedValue(null);
  d.alta.mockResolvedValue({ userId: 'nuevo', tenantId: 'tn-1', correo: { enviado: true }, bitacora: true });
  const pagina = await NuevoUsuario();
  crear = buscar(pagina, FormaConAviso)[0].props.accion as Accion;
});

describe('Nuevo usuario (/admin)', () => {
  it('con correo enviado: ok, con la vigencia del enlace; el actor es el superadmin', async () => {
    const r = await crear(null, fd(BUENO));
    expect(r.ok).toMatch(/le mandamos el correo de acceso/);
    expect(r.ok).toMatch(/60 minutos/);
    expect(d.alta).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tn-1', email: 'persona@flota.test', rol: 'contador', actor: expect.objectContaining({ userId: 'u-1' }) }));
  });

  it('sin Resend: la cuenta se creó pero se DICE que no hubo invitación (error, nunca «le llegó»)', async () => {
    d.alta.mockResolvedValue({ userId: 'n', tenantId: 'tn-1', correo: { enviado: false, motivo: 'sin_configurar' }, bitacora: true });
    const r = await crear(null, fd(BUENO));
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/invitación por correo NO salió/);
    expect(r.error).toMatch(/Resend/);
    expect(r.error).toMatch(/https:\/\/app\.test/);
  });

  it('rol fuera de la lista blanca (superadmin, vendedor, nomina): se rechaza ANTES de pedir factor o tocar la base', async () => {
    for (const rol of ['superadmin', 'vendedor', 'nomina', 'operador']) {
      const r = await crear(null, fd({ ...BUENO, rol }));
      expect(r.error).toMatch(/Superadmin y vendedor no se dan de alta desde aquí/);
    }
    expect(d.alta).not.toHaveBeenCalled();
    expect(d.paso).not.toHaveBeenCalled();
  });

  it('dueño o contador piden el segundo factor; encargado no', async () => {
    d.paso.mockResolvedValue('Cambiar roles del equipo exige tu segundo factor.');
    expect((await crear(null, fd({ ...BUENO, rol: 'flota_admin' }))).error).toMatch(/segundo factor/);
    expect(d.alta).not.toHaveBeenCalled();
    await crear(null, fd({ ...BUENO, rol: 'encargado' }));
    expect(d.alta).toHaveBeenCalledTimes(1);
  });

  it('el correo duplicado sale verbatim; un fallo técnico, con el genérico honesto', async () => {
    d.alta.mockRejectedValueOnce(new DatoInvalido('Ese correo ya tiene una cuenta registrada.'));
    expect((await crear(null, fd(BUENO))).error).toMatch(/ya tiene una cuenta registrada/);
    d.alta.mockRejectedValueOnce(new Error('ECONNRESET db.internal:5432'));
    const r = await crear(null, fd(BUENO));
    expect(r.error).toBeTruthy();
    expect(r.error).not.toMatch(/ECONNRESET/);
  });

  it('faltan datos: error y no se intenta nada', async () => {
    expect((await crear(null, fd({ tenantId: '', email: '', rol: '' }))).error).toMatch(/Faltan/);
    expect(d.alta).not.toHaveBeenCalled();
  });
});
