import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolverEjecutable,
  describirResolucion,
  componerBanderas,
  BANDERAS_CONTENEDOR,
  SesionNavegador,
  type EntornoEjecutable,
  type OpcionesNavegador,
} from './pagina_playwright';

/** Lo que recibiría `chromium.launch`. Se anota para poder leerlo de `mock.calls`. */
type OpcionesDeArranque = Parameters<NonNullable<OpcionesNavegador['lanzar']>>[0];

// ═══════════════════════════════════════════════════════════════════════════
// DE DÓNDE SALE EL BINARIO DE CHROMIUM, Y QUÉ BANDERAS LLEVA.
//
// Archivo APARTE de `pagina_playwright.test.ts` a propósito: aquel arranca un
// Chromium de verdad en su `beforeAll`, así que en una máquina sin browser
// —CI, hoy mismo— no corre ni una de sus pruebas. Esto es justo lo que hay que
// poder probar SIN browser, porque describe qué pasa cuando no hay ninguno.
//
// El mundo de afuera va inyectado (`EntornoEjecutable`): sin eso, el camino
// serverless solo se podría probar dentro de un contenedor Linux, o sea nunca
// desde la máquina donde se escribe el código.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

/** Las banderas que el paquete serverless devolvía el 4-ago-2026, tal cual. */
const ARGS_DEL_PAQUETE = [
  '--ash-no-nudges',
  '--disable-domain-reliability',
  '--disable-print-preview',
  '--disk-cache-size=33554432',
  '--no-default-browser-check',
  '--no-pings',
  '--single-process',
  '--font-render-hinting=none',
  '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
  '--enable-features=SharedArrayBuffer',
  '--ignore-gpu-blocklist',
  '--in-process-gpu',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--allow-running-insecure-content',
  '--disable-setuid-sandbox',
  '--disable-site-isolation-trials',
  '--disable-web-security',
  "--headless='shell'",
  '--no-sandbox',
  '--no-zygote',
];

const RUTA_SERVERLESS = '/tmp/chromium';
const RUTA_PLAYWRIGHT = '/home/quien/.cache/ms-playwright/chromium-1234/chrome';

function entorno(op: Partial<EntornoEjecutable> = {}): EntornoEjecutable {
  return {
    plataforma: 'linux',
    arquitectura: 'x64',
    existe: () => true,
    cargarServerless: async () => ({ args: ARGS_DEL_PAQUETE, executablePath: async () => RUTA_SERVERLESS }),
    rutaDePlaywright: () => RUTA_PLAYWRIGHT,
    ...op,
  };
}

let guardado: string | undefined;
beforeEach(() => {
  guardado = process.env.CUADRA_CHROMIUM_PATH;
  delete process.env.CUADRA_CHROMIUM_PATH;
  logger.warn.mockClear();
  logger.error.mockClear();
});
afterEach(() => {
  if (guardado === undefined) delete process.env.CUADRA_CHROMIUM_PATH;
  else process.env.CUADRA_CHROMIUM_PATH = guardado;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el orden de los tres caminos', () => {
  it('(a) la ruta explícita gana sobre el paquete y sobre la caché de Playwright', async () => {
    const r = await resolverEjecutable('/opt/chromium/chrome', entorno());
    expect(r.via).toBe('explicito');
    expect(r.executablePath).toBe('/opt/chromium/chrome');
    // Y no se cargó el paquete: no hay banderas suyas.
    expect(r.banderasDelPaquete).toEqual([]);
  });

  it('(a) `CUADRA_CHROMIUM_PATH` sirve igual que el parámetro', async () => {
    process.env.CUADRA_CHROMIUM_PATH = '/usr/bin/chromium-browser';
    const r = await resolverEjecutable(undefined, entorno());
    expect(r.via).toBe('explicito');
    expect(r.executablePath).toBe('/usr/bin/chromium-browser');
  });

  it('(a) el parámetro le gana a la variable de entorno', async () => {
    process.env.CUADRA_CHROMIUM_PATH = '/de/la/variable';
    const r = await resolverEjecutable('/del/parametro', entorno());
    expect(r.executablePath).toBe('/del/parametro');
  });

  it('una ruta explícita que NO existe no aborta: se anota y se sigue con el paquete', async () => {
    // Es el caso de una variable mal escrita en el panel de Vercel. Abortar ahí
    // dejaría sin facturar habiendo un camino bueno detrás — pero callarlo
    // sería peor, así que tiene que quedar en el rastro y en el log.
    const r = await resolverEjecutable('/no/existe', entorno({ existe: (p) => p !== '/no/existe' }));
    expect(r.via).toBe('serverless');
    expect(describirResolucion(r)).toContain('NO existe');
    expect(logger.warn).toHaveBeenCalledWith('portal.chromium_explicito_no_existe', { ruta: '/no/existe' });
  });

  it('(b) en linux/x64 gana el paquete serverless, y trae sus banderas', async () => {
    const r = await resolverEjecutable(undefined, entorno());
    expect(r.via).toBe('serverless');
    expect(r.executablePath).toBe(RUTA_SERVERLESS);
    expect(r.banderasDelPaquete).toEqual(ARGS_DEL_PAQUETE);
  });

  it('(b) NO se intenta en la Mac: el binario del paquete es un ELF de linux/x64', async () => {
    // Sin este candado, en la Mac se descomprimirían 190 MB en /tmp para
    // después fallar, y el Chromium local —que sí sirve— se quedaría sin
    // intentar. Se comprueba además que ni siquiera se cargó el paquete.
    const cargar = vi.fn();
    const r = await resolverEjecutable(undefined, entorno({ plataforma: 'darwin', arquitectura: 'arm64', cargarServerless: cargar }));
    expect(cargar).not.toHaveBeenCalled();
    expect(r.via).toBe('playwright');
    expect(describirResolucion(r)).toContain('darwin/arm64');
  });

  it('(b) si el paquete no está instalado se anota el motivo y se cae a (c)', async () => {
    const r = await resolverEjecutable(undefined, entorno({
      cargarServerless: async () => { throw new Error("Cannot find package '@sparticuz/chromium'"); },
    }));
    expect(r.via).toBe('playwright');
    expect(describirResolucion(r)).toContain('Cannot find package');
  });

  it('(b) si el paquete dice una ruta y ahí no hay nada, tampoco sirve', async () => {
    // Es el caso de /tmp lleno a media descompresión: el paquete resuelve con
    // una ruta y el archivo no quedó. Creerle sería arrancar contra un binario
    // a medias.
    const r = await resolverEjecutable(undefined, entorno({ existe: (p) => p !== RUTA_SERVERLESS }));
    expect(r.via).toBe('playwright');
    expect(describirResolucion(r)).toContain('ahí no quedó nada');
  });

  it('(c) NO pasa la ruta: deja que Playwright resuelva su binario', async () => {
    // Con `headless: true` Playwright elige `chrome-headless-shell`, no el
    // Chromium completo. Pasarle la ruta del completo cambiaría el binario
    // contra el que corren las pruebas del motor sin que nadie lo pidiera.
    const r = await resolverEjecutable(undefined, entorno({ plataforma: 'darwin' }));
    expect(r.via).toBe('playwright');
    expect(r.executablePath).toBeUndefined();
  });

  it('sin ninguno de los tres, el rastro nombra los tres y por qué', async () => {
    const r = await resolverEjecutable(undefined, entorno({
      plataforma: 'darwin',
      existe: () => false,
      rutaDePlaywright: () => RUTA_PLAYWRIGHT,
    }));
    expect(r.via).toBeNull();
    expect(r.executablePath).toBeUndefined();
    const rastro = describirResolucion(r);
    expect(rastro).toContain('explicito');
    expect(rastro).toContain('serverless');
    expect(rastro).toContain('playwright');
    expect(rastro).toContain('playwright install chromium');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('componer las banderas nuestras con las del paquete', () => {
  const compuestas = () => componerBanderas([...BANDERAS_CONTENEDOR], ARGS_DEL_PAQUETE);
  const nombres = (bs: string[]) => bs.map((b) => b.split('=')[0]);

  it('quita `--single-process`: Playwright no lo soporta', () => {
    expect(compuestas()).not.toContain('--single-process');
  });

  it('quita `--headless=\'shell\'`: la pone Playwright y viene mal escrita', () => {
    expect(nombres(compuestas())).not.toContain('--headless');
  });

  it('NO deja pasar `--disable-features` ni `--enable-features` del paquete', () => {
    // Es el daño silencioso: Chromium se queda con la ÚLTIMA aparición del
    // switch, y las banderas del usuario van DESPUÉS de las de Playwright. Una
    // `--disable-features` nuestra borraría la suya entera (PaintHolding,
    // HttpsUpgrades, Translate…), que es parte de cómo se comporta el driver.
    const n = nombres(compuestas());
    expect(n).not.toContain('--disable-features');
    expect(n).not.toContain('--enable-features');
  });

  it('quita las que aflojan la seguridad del navegador', () => {
    const c = compuestas();
    expect(c).not.toContain('--disable-web-security');
    expect(c).not.toContain('--disable-site-isolation-trials');
    expect(c).not.toContain('--allow-running-insecure-content');
  });

  it('cede `--disable-gpu` cuando el paquete trae SwiftShader, y lo conserva cuando no', () => {
    // Las dos cosas juntas se contradicen: `--disable-gpu` gana y deja el
    // SwiftShader recién descomprimido sin usar.
    expect(compuestas()).not.toContain('--disable-gpu');
    expect(compuestas()).toContain('--use-gl=angle');
    // Sin paquete, la bandera sigue siendo la correcta: contenedor sin GPU.
    expect(componerBanderas([...BANDERAS_CONTENEDOR])).toContain('--disable-gpu');
  });

  it('no duplica lo que las dos listas traen', () => {
    const c = compuestas();
    for (const b of ['--no-sandbox', '--disable-setuid-sandbox']) {
      expect(c.filter((x) => x === b)).toHaveLength(1);
    }
    expect(nombres(c).length).toBe(new Set(nombres(c)).size);
  });

  it('conserva las nuestras, que son las que tienen un fallo concreto escrito al lado', () => {
    const c = compuestas();
    for (const b of ['--disable-dev-shm-usage', '--no-sandbox', '--disable-background-timer-throttling', '--hide-scrollbars']) {
      expect(c).toContain(b);
    }
  });

  it('deja pasar lo del paquete que no estorba', () => {
    const c = compuestas();
    expect(c).toContain('--no-zygote');
    expect(c).toContain('--font-render-hinting=none');
    expect(c).toContain('--disk-cache-size=33554432');
  });

  it('las banderas de LISTA se unen en vez de pisarse', () => {
    // Repetir `--disable-features` no es un duplicado inofensivo: Chromium tira
    // la aparición anterior entera. Del PAQUETE nunca llegan (se descartan
    // antes, ver arriba), pero por `banderasExtra` sí pueden entrar dos, y ahí
    // elegir una sería perder la otra en silencio.
    const c = componerBanderas(['--disable-features=Uno,Dos', '--disable-features=Dos,Tres']);
    expect(c).toEqual(['--disable-features=Uno,Dos,Tres']);
    expect(logger.warn).not.toHaveBeenCalled(); // unir no es un conflicto
  });

  it('avisa cuando dos fuentes piden valores distintos de la misma bandera', () => {
    const c = componerBanderas(['--lang=es-MX'], ['--lang=en-US']);
    expect(c).toEqual(['--lang=es-MX']); // gana la nuestra
    expect(logger.warn).toHaveBeenCalledWith('portal.bandera_en_conflicto', { gana: '--lang=es-MX', descartada: '--lang=en-US' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el arranque', () => {
  it('le pasa a Chromium las banderas ya compuestas y la ruta resuelta', async () => {
    let visto: OpcionesDeArranque;
    const lanzar = vi.fn(async (o: OpcionesDeArranque) => { visto = o; throw new Error('no se arranca nada en esta prueba'); });
    await expect(SesionNavegador.abrir({ lanzar, entorno: entorno() })).rejects.toThrow();

    const op = visto!;
    expect(op.executablePath).toBe(RUTA_SERVERLESS);
    expect(op.headless).toBe(true);
    expect(op.args).not.toContain('--single-process');
    expect(op.args).toContain('--disable-dev-shm-usage');
    expect(op.args).toContain('--use-angle=swiftshader');
  });

  it('cuando no arranca, el error trae LOS TRES caminos con su motivo', async () => {
    // Es la diferencia entre "Executable doesn't exist at /home/sbx_user…"
    // —que manda a instalar algo en una máquina a la que nadie tiene acceso— y
    // saber cuál de los tres se intentó y por qué no sirvió.
    const lanzar = vi.fn(async () => { throw new Error("Executable doesn't exist at /nada"); });
    const sinNada = entorno({ plataforma: 'darwin', arquitectura: 'arm64', existe: () => false });

    await expect(SesionNavegador.abrir({ lanzar, entorno: sinNada })).rejects.toThrow(/explicito.*serverless.*playwright/s);
    await expect(SesionNavegador.abrir({ lanzar, entorno: sinNada })).rejects.toThrow(/Executable doesn't exist/);
    expect(logger.error).toHaveBeenCalledWith('portal.chromium_no_arranco', expect.objectContaining({ via: null }));
  });

  it('`banderasExtra` se agrega a lo compuesto, no lo reemplaza', async () => {
    let visto: OpcionesDeArranque;
    const lanzar = vi.fn(async (o: OpcionesDeArranque) => { visto = o; throw new Error('x'); });
    await expect(SesionNavegador.abrir({ lanzar, entorno: entorno(), banderasExtra: ['--proxy-server=http://x'] })).rejects.toThrow();
    const op = visto!;
    expect(op.args).toContain('--proxy-server=http://x');
    expect(op.args).toContain('--disable-dev-shm-usage');
  });
});
