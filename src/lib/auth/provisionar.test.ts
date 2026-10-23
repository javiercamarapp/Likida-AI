import { describe, it, expect, vi, beforeEach } from 'vitest';

const createUser = vi.fn();
const deleteUser = vi.fn();
const generateLink = vi.fn();
const getUserById = vi.fn();
const insert = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ insert, select }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    auth: {
      admin: {
        createUser: (...a: unknown[]) => createUser(...a),
        deleteUser: (...a: unknown[]) => deleteUser(...(a as [])),
        generateLink: (...a: unknown[]) => generateLink(...a),
        getUserById: (...a: unknown[]) => getUserById(...a),
      },
    },
    from: (...a: unknown[]) => from(...(a as [])),
  }),
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { provisionarUsuario } = await import('./provisionar');

describe('provisionarUsuario', () => {
  beforeEach(() => {
    createUser.mockReset();
    deleteUser.mockReset();
    deleteUser.mockResolvedValue({ data: {}, error: null });
    generateLink.mockReset();
    getUserById.mockReset();
    logger.error.mockClear();
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
    from.mockClear();
    select.mockClear();
    eq.mockClear();
    maybeSingle.mockReset();
    // Por default, el correo NO tiene ninguna fila `app_user` todavía — las
    // pruebas de la rama "huérfana de Google" lo cambian explícitamente.
    maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  // ── H6 (auditoría 24): un insert que rebota no deja un usuario de Auth
  // huérfano — que podía iniciar sesión y bloqueaba un segundo alta. ──
  it('si el insert en app_user falla, BORRA el usuario de Auth recién creado y lanza el error original', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-medias' } }, error: null });
    insert.mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint "app_user_telefono_uniq"' } });
    await expect(provisionarUsuario('t-1', 'nuevo@flotademo.mx', 'N', 'contador', '4771234567'))
      .rejects.toThrow('app_user_telefono_uniq');
    expect(deleteUser).toHaveBeenCalledWith('u-medias');
  });

  it('si el rollback también falla, queda en el log con las dos causas y el error original sigue', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-medias2' } }, error: null });
    insert.mockResolvedValue({ error: { message: 'fetch failed' } });
    deleteUser.mockResolvedValueOnce({ data: null, error: { message: 'auth caído' } });
    await expect(provisionarUsuario('t-1', 'otro@flotademo.mx')).rejects.toThrow('fetch failed');
    expect(logger.error).toHaveBeenCalledWith('provisionar.rollback_fallo',
      expect.objectContaining({ userId: 'u-medias2', err: 'auth caído', causa: 'fetch failed' }));
  });

  it('con alta buena NO se borra nada', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-ok' } }, error: null });
    await provisionarUsuario('t-1', 'ok@flotademo.mx');
    expect(deleteUser).not.toHaveBeenCalled();
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
    // Mensaje que NO matchea `esCorreoYaRegistrado`: no es el caso que esta
    // rama resuelve, así que ni se consulta `app_user` ni se intenta enlazar.
    expect(from).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  // ── HALLAZGO MEDIO (auditoría de login/Google): `entrarConGoogle`
  // (login/page.tsx:141-149) no tiene equivalente de `shouldCreateUser:false`
  // —Supabase no lo ofrece para OAuth—, así que cualquier correo real de
  // Google se auto-registra en `auth.users` solo con tocar "Entrar con
  // Google", SIN pasar por `provisionarUsuario`. Cuando después un
  // `flota_admin` invita a esa misma persona, `createUser` rebota con
  // "already registered" y, ANTES de este fix, el alta se abandonaba ahí: la
  // persona existía en Auth pero nunca en `app_user`, y quedaba varada en
  // `/sin-acceso` para siempre. ──────────────────────────────────────────
  describe('correo huérfano: existe en auth.users (p.ej. Google) pero SIN fila app_user en ningún tenant', () => {
    beforeEach(() => {
      // Un Error REAL, no un objeto literal: `esCorreoYaRegistrado` exige
      // `instanceof Error` (así llega el `AuthError` real de supabase-js).
      createUser.mockResolvedValue({ data: { user: null }, error: new Error('User already registered') });
      maybeSingle.mockResolvedValue({ data: null, error: null }); // ninguna fila app_user con ese correo
    });

    it('resuelve el auth.users YA EXISTENTE (sin crear uno nuevo) y completa el alta enlazándolo', async () => {
      generateLink.mockResolvedValue({ data: { user: { id: 'u-huerfano' } }, error: null });
      getUserById.mockResolvedValue({ data: { user: { id: 'u-huerfano', email_confirmed_at: '2026-10-01T00:00:00Z', identities: [{ provider: 'google' }] } }, error: null });
      
      const r = await provisionarUsuario('t-1', 'huerfano@flotademo.mx', 'Ana', 'contador');

      expect(createUser).toHaveBeenCalledTimes(1); // se intentó, pero NO se creó un segundo usuario
      expect(from).toHaveBeenCalledWith('app_user');
      expect(select).toHaveBeenCalledWith('id');
      expect(eq).toHaveBeenCalledWith('email', 'huerfano@flotademo.mx');
      expect(generateLink).toHaveBeenCalledWith({ type: 'recovery', email: 'huerfano@flotademo.mx' });
      expect(insert).toHaveBeenCalledWith({
        id: 'u-huerfano', tenant_id: 't-1', email: 'huerfano@flotademo.mx', nombre: 'Ana', rol: 'contador',
        telefono: null,
      });
      expect(r).toEqual({ userId: 'u-huerfano' });
      // La persona QUEDA OPERATIVA: hay fila app_user real, no el mensaje
      // neutro sin efecto que `esCorreoYaRegistrado` producía antes.
    });

    it('si el insert del enlace falla, NO borra el usuario de Auth (no lo creó esta llamada)', async () => {
      generateLink.mockResolvedValue({ data: { user: { id: 'u-huerfano-2' } }, error: null });
      getUserById.mockResolvedValue({ data: { user: { id: 'u-huerfano-2', email_confirmed_at: '2026-10-01T00:00:00Z', identities: [{ provider: 'google' }] } }, error: null });
            insert.mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint "app_user_telefono_uniq"' } });

      await expect(provisionarUsuario('t-1', 'huerfano2@flotademo.mx', 'X', 'contador', '4771234567'))
        .rejects.toThrow('app_user_telefono_uniq');
      // El borrado es SOLO para el usuario que esta llamada crea (H6); borrar
      // uno que ya existía sería tirar la cuenta real de otra persona por un
      // choque de este insert.
      expect(deleteUser).not.toHaveBeenCalled();
    });

    it('si no se puede resolver el id existente (generateLink falla), mantiene el error original de "ya registrado"', async () => {
      generateLink.mockResolvedValue({ data: { user: null }, error: { message: 'user not found' } });

      await expect(provisionarUsuario('t-1', 'rara@flotademo.mx')).rejects.toThrow('User already registered');
      expect(insert).not.toHaveBeenCalled();
    });

    // ── A37-L-seguridad-tenant-01 · PRE-SECUESTRO DE CUENTA. Un atacante que
    // conoce el correo a invitar se registra antes con SU contraseña
    // (POST /auth/v1/signup). Adoptar ese usuario le daría acceso con el rol
    // invitado. Solo se adopta lo que prueba el dueño del correo: confirmado y
    // con identidades EXCLUSIVAMENTE de Google. ──
    describe('A37-L-seguridad-tenant-01: no adoptar un usuario de Auth cuyo origen no es Google confirmado', () => {
      const adoptado = (user: Record<string, unknown> | null, error: unknown = null) => {
        generateLink.mockResolvedValue({ data: { user: { id: 'u-x' } }, error: null });
        getUserById.mockResolvedValue({ data: { user }, error });
      };
      const rechaza = async () => {
        await expect(provisionarUsuario('t-1', 'victima@flotademo.mx', 'V', 'flota_admin')).rejects.toThrow('User already registered');
        expect(insert).not.toHaveBeenCalled();
        expect(deleteUser).not.toHaveBeenCalled();
      };

      it('rechaza al usuario creado con correo y contraseña (identidad email), aunque esté confirmado', async () => {
        adoptado({ id: 'u-x', email_confirmed_at: '2026-10-01T00:00:00Z', identities: [{ provider: 'email' }] });
        await rechaza();
      });
      it('rechaza si además de Google tiene una identidad email (contraseña ajena posible)', async () => {
        adoptado({ id: 'u-x', email_confirmed_at: '2026-10-01T00:00:00Z', identities: [{ provider: 'google' }, { provider: 'email' }] });
        await rechaza();
      });
      it('rechaza al usuario de Google SIN confirmar el correo', async () => {
        adoptado({ id: 'u-x', email_confirmed_at: null, identities: [{ provider: 'google' }] });
        await rechaza();
      });
      it('rechaza si no trae identidades (no se puede probar el origen)', async () => {
        adoptado({ id: 'u-x', email_confirmed_at: '2026-10-01T00:00:00Z' });
        await rechaza();
      });
      it('rechaza (fail-closed) si no se puede leer el usuario', async () => {
        adoptado(null, { message: 'caído' });
        await rechaza();
      });
    });
  });

  it('correo que YA tiene fila app_user (cliente real, aquí o en otra flota): sigue "ya registrado", SIN enlazar ni crear fila nueva', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: new Error('User already registered') });
    // SEG-7 (invitar.ts): este correo YA es cliente de Likida de verdad —no
    // es el caso huérfano— y hay que seguir sin tocar nada, para que el
    // panel del dueño no sea un oráculo de qué correos son de otra flota.
    maybeSingle.mockResolvedValue({ data: { id: 'app-user-ya-existente' }, error: null });

    await expect(provisionarUsuario('t-1', 'cliente@otraflota.mx')).rejects.toThrow('User already registered');
    expect(generateLink).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('si la consulta de app_user por correo falla (bache), lanza ESE error y no intenta resolver nada', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: new Error('User already registered') });
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'fetch failed' } });

    await expect(provisionarUsuario('t-1', 'bache@flotademo.mx')).rejects.toThrow('fetch failed');
    expect(generateLink).not.toHaveBeenCalled();
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
