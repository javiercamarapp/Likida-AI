import { describe, it, expect, vi, beforeEach } from 'vitest';

const createUser = vi.fn();
const insert = vi.fn();
const from = vi.fn(() => ({ insert }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    auth: { admin: { createUser: (...a: unknown[]) => createUser(...a) } },
    from: (...a: unknown[]) => from(...(a as [])),
  }),
}));

const { provisionarUsuario } = await import('./provisionar');

describe('provisionarUsuario', () => {
  beforeEach(() => {
    createUser.mockReset();
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
    from.mockClear();
  });

  it('crea el usuario de Auth y la fila de app_user con rol flota_admin por default', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    const r = await provisionarUsuario('t-1', 'contralor@flotademo.mx', 'Ana Ruiz');
    expect(createUser).toHaveBeenCalledWith({ email: 'contralor@flotademo.mx', email_confirm: true });
    expect(from).toHaveBeenCalledWith('app_user');
    expect(insert).toHaveBeenCalledWith({
      id: 'u-1', tenant_id: 't-1', email: 'contralor@flotademo.mx', nombre: 'Ana Ruiz', rol: 'flota_admin',
      telefono: null,
    });
    expect(r).toEqual({ userId: 'u-1' });
  });

  it('sin nombre, nombre queda null', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-2' } }, error: null });
    await provisionarUsuario('t-1', 'sin-nombre@flotademo.mx');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ nombre: null }));
  });

  it('si Auth falla al crear el usuario, lanza con el mensaje de Supabase', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'correo ya registrado' } });
    await expect(provisionarUsuario('t-1', 'ya@existe.mx')).rejects.toThrow('correo ya registrado');
    expect(insert).not.toHaveBeenCalled();
  });

  it('superadmin: tenantId null y rol explícito, se respetan tal cual', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-3' } }, error: null });
    const r = await provisionarUsuario(null, 'javier@likida.ai', 'Javier', 'superadmin');
    expect(insert).toHaveBeenCalledWith({
      id: 'u-3', tenant_id: null, email: 'javier@likida.ai', nombre: 'Javier', rol: 'superadmin',
      telefono: null,
    });
    expect(r).toEqual({ userId: 'u-3' });
  });

  // Quinto rol del panel (docs/superpowers/plans/2026-08-02-roles-flota.md):
  // ve todo el tenant y puede asignar viajes a choferes, sin llegar a
  // facturación/invitar usuarios (eso sigue siendo solo de flota_admin).
  it('acepta rol encargado', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-4' } }, error: null });
    await provisionarUsuario('t-1', 'encargado@flotademo.mx', 'Luis', 'encargado');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ rol: 'encargado' }));
  });

  // D5 (auditoría 4): la columna app_user.telefono (0059) tenía lector
  // (resolverCuentaOficina) y ningún escritor — el dueño de una flota nueva no
  // podía escribirle al bot sin un UPDATE a mano.
  it('el teléfono se normaliza como el del operador: 10 dígitos ganan la lada 52', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-5' } }, error: null });
    await provisionarUsuario('t-1', 'duenio@flotademo.mx', 'Pía', 'flota_admin', '477 123 45 67');
    const fila = insert.mock.calls[0][0] as { telefono: string };
    // La forma canónica es la de destinatarioWhatsApp — la que el matcher de
    // oficina sabe volver a encontrar. Lo que se fija: dígitos y lada, sin
    // separadores.
    expect(fila.telefono).toMatch(/^52\d{10}$/);
    expect(fila.telefono).toContain('4771234567');
  });

  it('un teléfono corto rechaza ANTES de crear el usuario de Auth: nada queda a medias', async () => {
    await expect(provisionarUsuario('t-1', 'x@flotademo.mx', 'X', 'flota_admin', '12345'))
      .rejects.toThrow(/dígitos/);
    expect(createUser).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
