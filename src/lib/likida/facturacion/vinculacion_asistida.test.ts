import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InventarioPagina } from './adaptadores/playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// LA SESIÓN ASISTIDA — el único momento en que alguien teclea una contraseña,
// y ese alguien es una persona. Lo que se fija aquí:
//
//   · este código NO teclea NADA: solo mira y espera a que la pantalla de
//     entrar desaparezca (un CAPTCHA en ese login lo resuelve la persona);
//   · FALLA CERRADO: si al agotarse el tope sigue el login, no se guarda nada
//     — una sesión a medias diría «vinculado» sobre algo que no funciona;
//   · lo que se guarda va RECORTADO al dominio del portal y CIFRADO, y el
//     estado queda anotado para la pantalla.
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

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { vincularPortalAsistido } = await import('./vinculacion_asistida');
const { comercio } = await import('./comercios');

const TENANT = '33333333-3333-3333-3333-333333333333';
/** Un comercio REAL del catálogo: si su ficha cambia, esta prueba lo dice. */
const CLAVE = 'la_gas';
const PORTAL = comercio(CLAVE)!.portal;
const HOST = new URL(PORTAL).hostname;

const INV = (p: Partial<InventarioPagina> = {}): InventarioPagina => ({
  url: PORTAL, titulo: 'Facturación', campos: [], botones: [], captcha: [],
  texto: 'Bienvenido', ...p,
});

const LOGIN = INV({
  campos: [{ tag: 'input', type: 'password', id: 'pass', name: 'pass', placeholder: '', etiqueta: '', visible: true, opciones: [] }],
  captcha: ['https://www.google.com/recaptcha/api.js'],
});

/** Una página doble que devuelve los inventarios de un guion, en orden. */
function paginaFalsa(guion: InventarioPagina[]) {
  const abiertas: string[] = [];
  let i = 0;
  return {
    abiertas,
    abrir: vi.fn(async (u: string) => { abiertas.push(u); }),
    escribir: vi.fn(async () => { throw new Error('la vinculación asistida NO teclea'); }),
    hacerClic: vi.fn(async () => { throw new Error('la vinculación asistida NO hace clic'); }),
    leerTexto: vi.fn(async () => null),
    captura: vi.fn(async () => 'x'),
    inventario: vi.fn(async () => guion[Math.min(i++, guion.length - 1)]),
  };
}

const estado = (dominio = HOST) => JSON.stringify({
  cookies: [{ name: 'lg_session', value: 'abc', domain: dominio, path: '/' }],
  origins: [],
});

/** Reloj y espera falsos: la prueba no espera cinco minutos de verdad. */
function reloj() {
  let t = Date.parse('2026-08-27T18:00:00.000Z');
  return { ahora: () => t, dormir: async (ms: number) => { t += ms; } };
}

beforeEach(() => { guardarSesionPortal.mockClear(); anotarVinculo.mockClear(); });

describe('vincularPortalAsistido', () => {
  it('espera a que la persona entre y guarda la sesión cifrada, recortada al portal', async () => {
    // Dos vueltas en el login (la persona está resolviendo el reCAPTCHA) y a la
    // tercera ya está dentro.
    const p = paginaFalsa([LOGIN, LOGIN, INV()]);
    const r = await vincularPortalAsistido({
      tenantId: TENANT, comercio: CLAVE,
      entorno: { pagina: p as never, estadoDeSesion: async () => estado(), ...reloj() },
    });

    expect(r).toMatchObject({ ok: true, comercio: CLAVE, cookies: 1 });
    expect(p.abiertas).toEqual([PORTAL]);
    expect(p.escribir, 'este camino existe para NO teclear').not.toHaveBeenCalled();
    expect(p.hacerClic).not.toHaveBeenCalled();

    const [tenant, conector, sesion] = guardarSesionPortal.mock.calls[0] as unknown as [string, string, { storageState: string }];
    expect(tenant).toBe(TENANT);
    expect(conector).toBe(`portal_facturacion:${CLAVE}`);
    expect(JSON.parse(sesion.storageState).cookies).toHaveLength(1);
    expect(anotarVinculo).toHaveBeenCalledWith(expect.objectContaining({ estado: 'vinculado', comercio: CLAVE }));
  });

  it('FALLA CERRADO: si se agota el tope con el login en pantalla, NO se guarda nada', async () => {
    const p = paginaFalsa([LOGIN]);
    const r = await vincularPortalAsistido({
      tenantId: TENANT, comercio: CLAVE, topeMs: 6_000, intervaloMs: 2_000,
      entorno: { pagina: p as never, estadoDeSesion: async () => estado(), ...reloj() },
    });

    expect(r.ok).toBe(false);
    expect(r).toHaveProperty('motivo', expect.stringMatching(/pantalla de entrar/i));
    expect(guardarSesionPortal, 'una sesión a medias diría «vinculado» sobre algo que no funciona').not.toHaveBeenCalled();
    expect(anotarVinculo).not.toHaveBeenCalled();
  });

  it('un inventario que revienta a media navegación NO cancela la vinculación en curso', async () => {
    const p = paginaFalsa([LOGIN, INV()]);
    p.inventario.mockRejectedValueOnce(new Error('la página se estaba recargando'));
    const r = await vincularPortalAsistido({
      tenantId: TENANT, comercio: CLAVE,
      entorno: { pagina: p as never, estadoDeSesion: async () => estado(), ...reloj() },
    });
    expect(r.ok).toBe(true);
  });

  it('entró pero el portal no dejó cookies suyas: se dice y no se guarda', async () => {
    const p = paginaFalsa([INV()]);
    const r = await vincularPortalAsistido({
      tenantId: TENANT, comercio: CLAVE,
      entorno: { pagina: p as never, estadoDeSesion: async () => estado('otro.mx'), ...reloj() },
    });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty('motivo', expect.stringContaining(HOST));
    expect(guardarSesionPortal).not.toHaveBeenCalled();
  });

  it('sin `storageState` del navegador no hay nada que guardar, y se dice', async () => {
    const p = paginaFalsa([INV()]);
    const r = await vincularPortalAsistido({
      tenantId: TENANT, comercio: CLAVE,
      entorno: { pagina: p as never, estadoDeSesion: async () => null, ...reloj() },
    });
    expect(r.ok).toBe(false);
    expect(guardarSesionPortal).not.toHaveBeenCalled();
  });

  it('un comercio que no está en el catálogo no abre nada', async () => {
    const p = paginaFalsa([INV()]);
    const r = await vincularPortalAsistido({
      tenantId: TENANT, comercio: 'gasolinera_inventada',
      entorno: { pagina: p as never, estadoDeSesion: async () => estado(), ...reloj() },
    });
    expect(r.ok).toBe(false);
    expect(p.abrir).not.toHaveBeenCalled();
  });
});
