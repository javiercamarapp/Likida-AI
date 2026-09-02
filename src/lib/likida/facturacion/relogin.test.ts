import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CampoInventariado, InventarioPagina } from './adaptadores/playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// EL RE-LOGIN AUTOMÁTICO, DE PUNTA A PUNTA. Lo que se fija aquí:
//
//   · SIN OPT-IN NO PASA NADA: no se abre el cofre, no se abre el portal, no
//     se gasta un intento. El comportamiento es el de antes del 0233.
//   · CON OPT-IN Y SESIÓN CADUCADA: se entra, y la sesión queda guardada
//     cifrada y anotada como «vinculado».
//   · CAPTCHA (y los otros cuatro muros): se corta con el motivo, SIN teclear
//     la contraseña y SIN reintentar.
//   · CREDENCIALES INVÁLIDAS: se detiene y se marca para que ni el día
//     siguiente lo reintente. Es el candado que evita que le bloqueen la
//     cuenta al cliente.
//   · TOPE DE INTENTOS: el candado corta antes de tocar el portal.
//   · LA CONTRASEÑA NO APARECE EN NINGÚN LADO: ni en el log, ni en el estado
//     guardado, ni en el motivo, ni en una captura (no se toma ninguna).
// ═══════════════════════════════════════════════════════════════════════════

const guardarSesionPortal = vi.fn(async () => {});
vi.mock('./sesion_portal', async (real) => ({
  ...(await real<typeof import('./sesion_portal')>()),
  guardarSesionPortal: (...a: unknown[]) => guardarSesionPortal(...(a as [])),
}));

const anotarVinculo = vi.fn(async () => {});
vi.mock('./vinculo_portal', async (real) => ({
  ...(await real<typeof import('./vinculo_portal')>()),
  anotarVinculo: (...a: unknown[]) => anotarVinculo(...(a as [])),
}));

const permisoDeRelogin = vi.fn();
const registrarIntento = vi.fn(async () => true);
const registrarResultado = vi.fn(async () => {});
const contrasenaDePortal = vi.fn();
vi.mock('./relogin_portal', async (real) => ({
  ...(await real<typeof import('./relogin_portal')>()),
  permisoDeRelogin: (...a: unknown[]) => permisoDeRelogin(...(a as [])),
  registrarIntento: (...a: unknown[]) => registrarIntento(...(a as [])),
  registrarResultado: (...a: unknown[]) => registrarResultado(...(a as [])),
  contrasenaDePortal: (...a: unknown[]) => contrasenaDePortal(...(a as [])),
}));

/** El log entero, capturado: es donde primero se filtraría un secreto. */
const registros: unknown[] = [];
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: (...a: unknown[]) => registros.push(a),
    info: (...a: unknown[]) => registros.push(a),
    warn: (...a: unknown[]) => registros.push(a),
    error: (...a: unknown[]) => registros.push(a),
  },
}));

const { reconectarPortal } = await import('./relogin');
const { sinPermiso } = await import('./relogin_portal');
const { comercio } = await import('./comercios');

const TENANT = '44444444-4444-4444-4444-444444444444';
/** Un comercio REAL del catálogo: si su ficha cambia, esta prueba lo dice. */
const CLAVE = 'la_gas';
const PORTAL = comercio(CLAVE)!.portal;
const HOST = new URL(PORTAL).hostname;

/** La contraseña de la prueba. Nunca debe aparecer en ninguna salida. */
const SECRETO = 'Contra$eña-SUPER-secreta-2026';

const campo = (p: Partial<CampoInventariado> = {}): CampoInventariado => ({
  tag: 'input', type: 'text', id: '', name: '', placeholder: '', etiqueta: '',
  visible: true, opciones: [], ...p,
});

const INV = (p: Partial<InventarioPagina> = {}): InventarioPagina => ({
  url: PORTAL, titulo: 'Facturación', campos: [], botones: [], captcha: [],
  texto: 'Bienvenido', ...p,
});

const LOGIN = INV({
  url: `${PORTAL}/Account/Login`,
  campos: [
    campo({ id: 'Usuario', name: 'Usuario' }),
    campo({ type: 'password', id: 'Password', name: 'Password' }),
  ],
  botones: [{ tag: 'button', id: 'btnEntrar', name: '', texto: 'Iniciar sesión', visible: true }],
  texto: 'Escribe tu correo y tu contraseña',
});

const DENTRO = INV({ texto: 'Mis facturas · Cerrar sesión' });

const ESTADO = JSON.stringify({
  cookies: [{ name: 'lg_session', value: 'abc', domain: HOST, path: '/' }],
  origins: [],
});

/** Una página doble que devuelve los inventarios de un guion, en orden. */
function paginaFalsa(guion: InventarioPagina[]) {
  const escrito: Array<[string, string]> = [];
  const clics: string[] = [];
  let i = 0;
  return {
    escrito, clics,
    abrir: vi.fn(async () => {}),
    escribir: vi.fn(async (s: string, v: string) => { escrito.push([s, v]); }),
    hacerClic: vi.fn(async (s: string) => { clics.push(s); }),
    leerTexto: vi.fn(async () => null),
    captura: vi.fn(async () => { throw new Error('el re-login NO toma capturas'); }),
    inventario: vi.fn(async () => guion[Math.min(i++, guion.length - 1)]),
  };
}

function entorno(guion: InventarioPagina[], estado: string | null = ESTADO) {
  const pagina = paginaFalsa(guion);
  return {
    pagina,
    args: {
      pagina,
      estadoDeSesion: async () => estado,
      ahora: () => Date.parse('2026-08-27T21:00:00.000Z'),
      dormir: async () => {},
    },
  };
}

const permitido = () => ({ ...sinPermiso(CLAVE), permitido: true, permitidoPor: 'ana@flota.mx', permitidoEn: '2026-08-01T10:00:00.000Z' });

beforeEach(() => {
  vi.clearAllMocks();
  registros.length = 0;
  registrarIntento.mockResolvedValue(true);
  contrasenaDePortal.mockResolvedValue({ usuario: 'ana@flota.mx', contrasena: SECRETO });
});

describe('sin opt-in — el comportamiento de siempre, intacto', () => {
  it('no abre el cofre, no abre el portal y no gasta un intento', async () => {
    permisoDeRelogin.mockResolvedValue(sinPermiso(CLAVE));
    const { pagina, args } = entorno([LOGIN]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.clase).toBe('sin_consentimiento');
    expect(r.ok === false && r.intentado).toBe(false);
    // Lo que NO pasó, que es el punto entero de esta prueba.
    expect(contrasenaDePortal).not.toHaveBeenCalled();
    expect(registrarIntento).not.toHaveBeenCalled();
    expect(pagina.abrir).not.toHaveBeenCalled();
    expect(guardarSesionPortal).not.toHaveBeenCalled();
  });

  it('«no se pudo leer el permiso» tampoco intenta: no es lo mismo que «no hay»', async () => {
    permisoDeRelogin.mockResolvedValue(null);
    const { args } = entorno([LOGIN]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('no_se_pudo_leer');
    expect(contrasenaDePortal).not.toHaveBeenCalled();
  });

  it('si no se pudo ANOTAR el intento, no se intenta: no poder contar es no poder frenar', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    registrarIntento.mockResolvedValue(false);
    const { pagina, args } = entorno([LOGIN]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok).toBe(false);
    expect(pagina.abrir).not.toHaveBeenCalled();
    expect(contrasenaDePortal).not.toHaveBeenCalled();
  });
});

describe('con opt-in y sesión caducada — reconecta y guarda', () => {
  it('teclea, entra, y la sesión queda guardada y anotada como vinculado', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const { pagina, args } = entorno([LOGIN, DENTRO]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok).toBe(true);
    expect(r.ok === true && r.cookies).toBe(1);

    // Se tecleó el usuario y la contraseña, en sus campos, y se apretó entrar.
    expect(pagina.escrito).toEqual([['#Usuario', 'ana@flota.mx'], ['#Password', SECRETO]]);
    expect(pagina.clics).toEqual(['#btnEntrar']);

    // La sesión se guardó RECORTADA al dominio del portal, y el estado quedó
    // en «vinculado» para que la pantalla deje de pedir que alguien entre.
    expect(guardarSesionPortal).toHaveBeenCalledTimes(1);
    const [, conector, sesion] = guardarSesionPortal.mock.calls[0] as unknown as [string, string, { storageState: string }];
    expect(conector).toBe(`portal_facturacion:${CLAVE}`);
    expect(JSON.parse(sesion.storageState).cookies[0].domain).toBe(HOST);
    expect(anotarVinculo).toHaveBeenCalledWith(expect.objectContaining({ estado: 'vinculado' }));
    expect(registrarResultado).toHaveBeenCalledWith(expect.objectContaining({ ok: true, clase: 'reconectado' }));
  });

  it('si YA estábamos dentro, guarda y sale SIN abrir el cofre (idempotente)', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const { pagina, args } = entorno([DENTRO]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok).toBe(true);
    expect(contrasenaDePortal).not.toHaveBeenCalled();
    expect(pagina.escrito).toEqual([]);
  });

  it('autorizado pero sin contraseña guardada: se dice, y no se teclea nada', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    contrasenaDePortal.mockResolvedValue(null);
    const { pagina, args } = entorno([LOGIN]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('sin_contrasena');
    expect(pagina.escrito).toEqual([]);
    expect(guardarSesionPortal).not.toHaveBeenCalled();
  });
});

describe('los cortes que solo un humano pasa', () => {
  it('CAPTCHA: corta con el motivo, SIN abrir el cofre y SIN reintentar', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const conCaptcha = INV({
      ...LOGIN, captcha: ['https://www.google.com/recaptcha/api.js'],
    });
    const { pagina, args } = entorno([conCaptcha]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('captcha');
    expect(r.ok === false && r.pideHumano).toBe(true);
    expect(r.ok === false && r.motivo).toMatch(/no resuelve ni rodea/i);
    // Ni se descifró la contraseña ni se tecleó nada: exponerla para no poder
    // usarla es exponerla para nada.
    expect(contrasenaDePortal).not.toHaveBeenCalled();
    expect(pagina.escrito).toEqual([]);
    expect(pagina.clics).toEqual([]);
    // Y NO se marca como bloqueado: mañana el portal puede no pedir captcha.
    expect(registrarResultado).toHaveBeenCalledWith(expect.objectContaining({ clase: 'captcha', ok: false }));
  });

  it('SEGUNDO FACTOR después de la contraseña: se corta ahí y no se insiste', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const pide2fa = INV({
      url: `${PORTAL}/Account/Verify`,
      texto: 'Te enviamos un código de verificación a tu teléfono',
      campos: [campo({ id: 'otp', name: 'otp' })],
    });
    const { pagina, args } = entorno([LOGIN, pide2fa]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('segundo_factor');
    // La contraseña SÍ se tecleó (el portal la pidió antes del código), pero
    // no hay un segundo intento: una sola pasada por el formulario.
    expect(pagina.clics).toEqual(['#btnEntrar']);
    expect(guardarSesionPortal).not.toHaveBeenCalled();
  });

  it('CUENTA BLOQUEADA: se corta antes de teclear, y el motivo lo dice', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const bloqueada = INV({ ...LOGIN, texto: 'Tu cuenta está bloqueada por demasiados intentos fallidos.' });
    const { pagina, args } = entorno([bloqueada]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('cuenta_bloqueada');
    expect(pagina.escrito).toEqual([]);
  });

  it('CAMBIO DE CONTRASEÑA obligatorio: no lo decide Likida', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const cambio = INV({ ...LOGIN, texto: 'Tu contraseña ha expirado. Debes cambiar tu contraseña.' });
    const { args } = entorno([cambio]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });
    expect(r.ok === false && r.clase).toBe('cambio_contrasena');
  });

  it('un formulario que no se entiende NO se llena a ciegas', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    // Login por la URL, pero sin campo de contraseña identificable.
    const raro = INV({ url: `${PORTAL}/Account/Login`, campos: [], botones: [] });
    const { pagina, args } = entorno([raro]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('sin_campos');
    expect(pagina.escrito).toEqual([]);
    expect(contrasenaDePortal).not.toHaveBeenCalled();
  });
});

describe('credenciales inválidas — el candado que evita el bloqueo', () => {
  it('se detiene, se marca para que NO haya un segundo intento, y se avisa', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const rechazo = INV({ ...LOGIN, texto: 'Usuario o contraseña incorrectos' });
    const { pagina, args } = entorno([LOGIN, rechazo]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('credencial_invalida');
    expect(r.ok === false && r.pideHumano).toBe(true);
    // UNA sola pasada por el formulario. Ni una más.
    expect(pagina.clics).toEqual(['#btnEntrar']);
    expect(pagina.escrito).toHaveLength(2);
    // Y queda registrado con la clase que `registrarResultado` convierte en
    // `bloqueado = true`: es lo que impide el intento de mañana.
    expect(registrarResultado).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, clase: 'credencial_invalida' }),
    );
    expect(guardarSesionPortal).not.toHaveBeenCalled();
  });

  it('gana sobre cualquier otro corte de la misma pantalla', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const rechazoConCaptcha = INV({
      ...LOGIN,
      texto: 'Usuario o contraseña incorrectos',
      captcha: ['https://www.google.com/recaptcha/api.js'],
    });
    const { args } = entorno([LOGIN, rechazoConCaptcha]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });
    expect(r.ok === false && r.clase).toBe('credencial_invalida');
  });
});

describe('el tope de intentos corta antes de tocar el portal', () => {
  it('con el tope del día gastado, ni se abre el navegador', async () => {
    permisoDeRelogin.mockResolvedValue({
      ...permitido(), diaDeIntentos: '2026-08-27', intentosDia: 3,
    });
    const { pagina, args } = entorno([LOGIN]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('tope_dia');
    expect(pagina.abrir).not.toHaveBeenCalled();
    expect(registrarIntento).not.toHaveBeenCalled();
  });

  it('con la credencial ya marcada como mala, tampoco', async () => {
    permisoDeRelogin.mockResolvedValue({
      ...permitido(), bloqueado: true, ultimaClase: 'credencial_invalida',
      ultimoMotivo: 'El portal rechazó el usuario o la contraseña guardados.',
    });
    const { pagina, args } = entorno([LOGIN]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok === false && r.clase).toBe('detenido');
    expect(pagina.abrir).not.toHaveBeenCalled();
    expect(contrasenaDePortal).not.toHaveBeenCalled();
  });
});

describe('la higiene del secreto — la contraseña no sale de la función', () => {
  it('no aparece en el log, ni en el estado guardado, ni en el resultado', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const { args } = entorno([LOGIN, DENTRO]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });
    expect(r.ok).toBe(true);

    const todo = JSON.stringify({
      log: registros,
      resultado: r,
      sesion: guardarSesionPortal.mock.calls,
      vinculo: anotarVinculo.mock.calls,
      resultados: registrarResultado.mock.calls,
      intentos: registrarIntento.mock.calls,
    });
    expect(todo).not.toContain(SECRETO);
    // Ni siquiera un pedazo reconocible.
    expect(todo).not.toContain('SUPER-secreta');
  });

  it('tampoco aparece cuando el portal la RECHAZA — que es cuando más tienta', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const rechazo = INV({ ...LOGIN, texto: 'Usuario o contraseña incorrectos' });
    const { args } = entorno([LOGIN, rechazo]);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    const todo = JSON.stringify({ log: registros, resultado: r, resultados: registrarResultado.mock.calls });
    expect(todo).not.toContain(SECRETO);
  });

  it('NO se toma ninguna captura en todo el camino', async () => {
    // La página doble revienta si alguien llama a `captura()`. Que estas dos
    // corridas pasen es la prueba: una foto de un formulario de login viaja a
    // un JSON, y ahí la contraseña de nadie tiene por qué acercarse.
    permisoDeRelogin.mockResolvedValue(permitido());
    const ok = entorno([LOGIN, DENTRO]);
    await expect(reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: ok.args })).resolves.toMatchObject({ ok: true });
    expect(ok.pagina.captura).not.toHaveBeenCalled();

    const corte = entorno([INV({ ...LOGIN, captcha: ['recaptcha'] })]);
    await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: corte.args });
    expect(corte.pagina.captura).not.toHaveBeenCalled();
  });
});

describe('bordes que no se afirman de más', () => {
  it('un comercio fuera del catálogo no abre nada', async () => {
    const { args } = entorno([LOGIN]);
    const r = await reconectarPortal({ tenantId: TENANT, comercio: 'no_existe', entorno: args });
    expect(r.ok).toBe(false);
    expect(permisoDeRelogin).not.toHaveBeenCalled();
  });

  it('entrar sin que el navegador devuelva sesión NO se anota como vinculado', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const { args } = entorno([LOGIN, DENTRO], null);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok).toBe(false);
    expect(guardarSesionPortal).not.toHaveBeenCalled();
    expect(anotarVinculo).not.toHaveBeenCalled();
  });

  it('sin cookies del portal tampoco: guardar una bolsa vacía sería mentir', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    const ajeno = JSON.stringify({ cookies: [{ name: 'x', domain: 'otro.mx', path: '/' }], origins: [] });
    const { args } = entorno([LOGIN, DENTRO], ajeno);

    const r = await reconectarPortal({ tenantId: TENANT, comercio: CLAVE, entorno: args });

    expect(r.ok).toBe(false);
    expect(guardarSesionPortal).not.toHaveBeenCalled();
  });

  it('el portal que no contesta corta por tiempo, sin bloquear la credencial', async () => {
    permisoDeRelogin.mockResolvedValue(permitido());
    // Siempre login: nunca entra, nunca dice por qué.
    const { args } = entorno([LOGIN]);

    const r = await reconectarPortal({
      tenantId: TENANT, comercio: CLAVE, entorno: args, topeMs: 0, intervaloMs: 0,
    });

    expect(r.ok === false && r.clase).toBe('portal_no_contesto');
    expect(registrarResultado).toHaveBeenCalledWith(
      expect.objectContaining({ clase: 'portal_no_contesto' }),
    );
  });
});
