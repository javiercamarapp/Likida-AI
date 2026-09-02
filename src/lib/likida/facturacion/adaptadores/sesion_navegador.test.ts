import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SesionNavegador, leerStorageState, type EntornoEjecutable, type OpcionesNavegador,
} from './pagina_playwright';

// ═══════════════════════════════════════════════════════════════════════════
// LA SESIÓN YA INICIADA, ENTRANDO Y SALIENDO DEL CONTEXTO.
//
// Este es el hueco que dejaba MUERTO a `sesion_portal.ts` entero: sabía
// guardar y leer la sesión cifrada desde el 21-ago-2026, con pruebas, y nadie
// se la pasaba nunca al navegador. Lo que se fija aquí:
//
//   · el `storageState` llega al `newContext` COMO OBJETO. Playwright trata un
//     string como RUTA A UN ARCHIVO, así que pasarle el JSON tal cual revienta
//     con un ENAMETOOLONG que no menciona cookies por ningún lado;
//   · un JSON ilegible NO tumba el lote: se avisa y se arranca limpio;
//   · `estadoDeSesion()` devuelve lo que hay que guardar, y devuelve `null`
//     —no lanza— cuando ya no hay contexto: la sesión actualizada es una
//     mejora, no el resultado del lote.
//
// Archivo aparte de `pagina_playwright.test.ts` por lo mismo que
// `resolucion_chromium.test.ts`: aquel arranca un Chromium de verdad y aquí no
// hace falta ninguno.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

type OpcionesDeContexto = { storageState?: unknown; viewport?: unknown };

const ENTORNO: EntornoEjecutable = {
  plataforma: 'linux',
  arquitectura: 'x64',
  existe: () => true,
  cargarServerless: async () => ({ args: [], executablePath: async () => '/tmp/chromium' }),
  rutaDePlaywright: () => '/no/existe',
};

const SESION = JSON.stringify({
  cookies: [{ name: 'ASP.NET_SessionId', value: 'abc123', domain: 'megasur.com.mx', path: '/' }],
  origins: [],
});

/** Un navegador doble que ANOTA con qué opciones se le pidió el contexto. */
function navegadorFalso(estadoAlSalir: unknown = { cookies: [], origins: [] }) {
  const contextos: OpcionesDeContexto[] = [];
  const cerrados: string[] = [];
  const contexto = {
    newPage: vi.fn(),
    storageState: vi.fn(async () => estadoAlSalir),
    close: vi.fn(async () => { cerrados.push('contexto'); }),
  };
  const navegador = {
    contextos,
    cerrados,
    contexto,
    newContext: vi.fn(async (op: OpcionesDeContexto) => { contextos.push(op); return contexto; }),
    isConnected: () => true,
    close: vi.fn(async () => { cerrados.push('navegador'); }),
  };
  return navegador;
}

const abrir = (nav: ReturnType<typeof navegadorFalso>, op: Partial<OpcionesNavegador> = {}) =>
  SesionNavegador.abrir({ entorno: ENTORNO, lanzar: async () => nav as never, ...op });

beforeEach(() => { for (const f of Object.values(logger)) f.mockClear(); });

describe('leerStorageState', () => {
  it('acepta lo que Playwright produce', () => {
    expect(leerStorageState(SESION)).toMatchObject({ cookies: expect.any(Array), origins: [] });
  });

  it('rechaza lo que parece sesión y no lo es — sin lanzar', () => {
    // `null` y `{}` parsean sin problema, y dejarían un contexto que se cree
    // «vinculado» sin una sola cookie.
    expect(leerStorageState('null')).toBeNull();
    expect(leerStorageState('{}')).toBeNull();
    expect(leerStorageState('{"cookies":[]}')).toBeNull();
    expect(leerStorageState('{no json')).toBeNull();
  });
});

describe('SesionNavegador.abrir con sesión guardada', () => {
  it('le pasa el estado al contexto COMO OBJETO, no como el string (que sería una ruta)', async () => {
    const nav = navegadorFalso();
    const s = await abrir(nav, { storageState: SESION });

    const op = nav.contextos[0];
    expect(typeof op.storageState, 'un string sería una RUTA A ARCHIVO para Playwright').toBe('object');
    expect(op.storageState).toEqual(JSON.parse(SESION));
    expect(s.arrancoConSesion).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('portal.sesion_restaurada', { cookies: 1, origenes: 0 });
  });

  it('sin sesión guardada, el contexto NO lleva `storageState` (y se sabe que arrancó limpio)', async () => {
    const nav = navegadorFalso();
    const s = await abrir(nav);
    expect(nav.contextos[0]).not.toHaveProperty('storageState');
    expect(s.arrancoConSesion).toBe(false);
  });

  it('un estado ILEGIBLE se avisa y se arranca limpio — no tumba el lote', async () => {
    const nav = navegadorFalso();
    const s = await abrir(nav, { storageState: '{roto' });
    expect(nav.contextos[0]).not.toHaveProperty('storageState');
    expect(s.arrancoConSesion, 'y el lote SABE que entró sin sesión: eso separa «caducó» de «nunca se vinculó»').toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('portal.sesion_guardada_ilegible', expect.anything());
  });
});

describe('estadoDeSesion', () => {
  it('devuelve el JSON que `guardarSesionPortal` cifra', async () => {
    const salida = { cookies: [{ name: 'ASP.NET_SessionId', value: 'rotada', domain: 'megasur.com.mx', path: '/' }], origins: [] };
    const nav = navegadorFalso(salida);
    const s = await abrir(nav, { storageState: SESION });
    expect(JSON.parse((await s.estadoDeSesion())!)).toEqual(salida);
  });

  it('DESPUÉS de cerrar devuelve null en vez de lanzar: la sesión es una mejora, no el resultado', async () => {
    const nav = navegadorFalso();
    const s = await abrir(nav);
    await s.cerrar();
    expect(await s.estadoDeSesion()).toBeNull();
    expect(nav.cerrados, 'el contexto se cierra ANTES que el navegador').toEqual(['contexto', 'navegador']);
  });

  it('un contexto que no contesta se anota y no tumba un lote que ya facturó', async () => {
    const nav = navegadorFalso();
    nav.contexto.storageState.mockRejectedValueOnce(new Error('el renderer murió'));
    const s = await abrir(nav);
    expect(await s.estadoDeSesion()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('portal.sesion_no_exportada', expect.anything());
  });
});
