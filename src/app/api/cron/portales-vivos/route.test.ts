import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL VIGILANTE DE PORTALES (lunes 06:40) — el contrato de la RUTA, no el de la comprobación.
//
// La lógica de medir (dos intentos, `no_medido` ≠ roto, SPA ≠ roto) vive en `portales_vivos.test.ts`.
// Aquí se fija lo que solo la ruta decide y que antes vivía en comentarios:
//   · la puerta (sin secreto 500, bearer equivocado 401 sin tocar nada);
//   · fallar cerrado ante un interruptor ilegible Y dejar latido en CADA camino de salida
//     (sin él /api/health declaraba muerto un cron «saltado» a propósito);
//   · lo ÚNICO que escala a correo: portales rotos y confirmados. Un parpadeo, un fallo nuestro o una SPA no;
//   · `parcial` y no `ok` cuando el reloj dejó portales sin mirar;
//   · que se sale a la red como un navegador (UA, redirect follow) y que NO se sale si el interruptor dice no.
// `vigilarPortales` corre REAL contra un `fetch` doble: así la prueba cubre el cableado completo de la ruta.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));

const registrarLatido = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/admin/salud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/salud')>()),
  registrarLatido: (...a: unknown[]) => registrarLatido(...a),
}));

let interruptor: 'encendido' | 'apagado' | 'ilegible' = 'encendido';
const leerInterruptor = vi.fn(async (_n: string) => interruptor);
vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: (n: string) => leerInterruptor(n) }));

/** Para provocar el `catch` de la ruta sin depender de un bug real: la comprobación de verdad corre salvo que se anule. */
let anularVigilancia: (() => Promise<never>) | null = null;
vi.mock('@/lib/likida/facturacion/portales_vivos', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/likida/facturacion/portales_vivos')>();
  return { ...real, vigilarPortales: (...a: Parameters<typeof real.vigilarPortales>) => (anularVigilancia ? anularVigilancia() : real.vigilarPortales(...a)) };
});

process.env.CRON_SECRET = 'secreto-de-prueba';
const { GET } = await import('./route');
const { portalesVigilables } = await import('@/lib/likida/facturacion/portales_vivos');

const peticion = (auth?: string) => new Request('http://likida.test/api/cron/portales-vivos', {
  headers: auth ? { authorization: auth } : {},
}) as never;
const OK = 'Bearer secreto-de-prueba';

const FORMULARIO = '<html><body><form><input name="ticket"><input name="monto"></form></body></html>';
const SPA = '<html><body><div id="root"></div><script type="module" src="/assets/index-AbC123.js"></script></body></html>';
const VACIA = '<html><body><p>Página en construcción</p></body></html>';

type Respuesta = { ok: boolean; status: number; text: () => Promise<string> };
const resp = (status: number, html = ''): Respuesta => ({ ok: status >= 200 && status < 300, status, text: async () => html });

/** `fetch` doble: por defecto todos vivos; `porUrl` decide lo de cada portal (una función se llama una vez por intento). */
const fetchDoble = vi.fn<(url: string, init?: RequestInit) => Promise<Respuesta>>();
let porUrl: (url: string, intento: number) => Respuesta | Error = () => resp(200, FORMULARIO);
const intentos = new Map<string, number>();

beforeEach(() => {
  interruptor = 'encendido';
  anularVigilancia = null;
  intentos.clear();
  porUrl = () => resp(200, FORMULARIO);
  fetchDoble.mockReset();
  fetchDoble.mockImplementation(async (url) => {
    const n = (intentos.get(url) ?? 0) + 1;
    intentos.set(url, n);
    const r = porUrl(url, n);
    if (r instanceof Error) throw r;
    return r;
  });
  vi.stubGlobal('fetch', fetchDoble);
  alertarOperador.mockClear(); registrarLatido.mockClear(); leerInterruptor.mockClear();
  for (const f of Object.values(logger)) f.mockReset();
  process.env.CRON_SECRET = 'secreto-de-prueba';
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const vigilables = () => portalesVigilables();
const urlDe = (clave: string) => vigilables().find((c) => c.clave === clave)!.portal;

describe('GET /api/cron/portales-vivos — la puerta', () => {
  it('sin CRON_SECRET: 500 y NO sale a la red (un 200 dejaría el cron verde para siempre)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(peticion(OK));
    expect(res.status).toBe(500);
    expect(fetchDoble).not.toHaveBeenCalled();
    expect(leerInterruptor).not.toHaveBeenCalled();
  });

  it('con el bearer equivocado o sin él: 401 sin cuerpo, sin leer el interruptor ni tocar la red', async () => {
    for (const auth of [undefined, 'Bearer otro']) {
      const res = await GET(peticion(auth));
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('');
    }
    expect(leerInterruptor).not.toHaveBeenCalled();
    expect(fetchDoble).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/portales-vivos — el interruptor global (falla cerrado y deja latido)', () => {
  it('interruptor ILEGIBLE: 500 con su código, latido «fallo» ANTES de salir y ni un fetch', async () => {
    interruptor = 'ilegible';
    const res = await GET(peticion(OK));
    const cuerpo = await res.json();
    expect(res.status).toBe(500);
    expect(cuerpo).toMatchObject({ corrio: false, codigo: 'interruptor_ilegible', interruptor: 'global' });
    expect(registrarLatido).toHaveBeenCalledWith('portales-vivos', 'fallo', { codigo: 'interruptor_ilegible' });
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  it('interruptor APAGADO: no corre, y el latido dice «saltado» (si no, /api/health lo daría por muerto a los 7 días)', async () => {
    interruptor = 'apagado';
    const res = await GET(peticion(OK));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ corrio: false, saltado: 'interruptor global' });
    expect(registrarLatido).toHaveBeenCalledWith('portales-vivos', 'saltado', { interruptor: 'global' });
    expect(fetchDoble).not.toHaveBeenCalled();
    expect(alertarOperador).not.toHaveBeenCalled();
    expect(leerInterruptor).toHaveBeenCalledWith('global');
  });
});

describe('GET /api/cron/portales-vivos — la corrida', () => {
  it('todos vivos: 200, un fetch por portal, sin correo, latido «ok»; y sale como un NAVEGADOR (UA, redirect follow)', async () => {
    const res = await GET(peticion(OK));
    const cuerpo = await res.json();
    expect(res.status).toBe(200);
    expect(cuerpo).toMatchObject({ corrio: true, vigilables: vigilables().length, revisados: vigilables().length, rotos: [], noMedidos: 0, sinTurno: [] });
    expect(cuerpo.parte).toMatch(/0 rotos/);
    expect(fetchDoble).toHaveBeenCalledTimes(vigilables().length);
    const init = fetchDoble.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(init.redirect).toBe('follow');
    expect(init.headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(alertarOperador).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('portales-vivos', 'ok', { revisados: vigilables().length, rotos: 0 });
  });

  it('un portal roto en DOS intentos escala a correo con su clave, su estado y su evidencia; el cron termina «ok»', async () => {
    const roto = urlDe('oxxo');
    porUrl = (url) => (url === roto ? resp(502) : resp(200, FORMULARIO));
    const res = await GET(peticion(OK));
    const cuerpo = await res.json();
    expect(res.status).toBe(200);
    expect(cuerpo.rotos).toHaveLength(1);
    expect(cuerpo.rotos[0]).toMatchObject({ clave: 'oxxo', estado: 'no_responde', http: 502 });
    expect(intentos.get(roto)).toBe(2); // medido dos veces
    expect(alertarOperador).toHaveBeenCalledTimes(1);
    const [donde, datos] = alertarOperador.mock.calls[0] as [string, { error: string; codigo: string }];
    expect(donde).toBe('cron.portales-vivos');
    expect(datos.codigo).toBe('portales_facturacion_rotos');
    expect(datos.error).toMatch(/oxxo \(no_responde: .*502/);
    expect(registrarLatido).toHaveBeenCalledWith('portales-vivos', 'ok', expect.objectContaining({ rotos: 1 }));
  });

  it('un 502 que se contradice en el segundo intento (despliegue a media pasada) NO manda correo', async () => {
    const parpadea = urlDe('oxxo');
    porUrl = (url, n) => (url === parpadea && n === 1 ? resp(502) : resp(200, FORMULARIO));
    const res = await GET(peticion(OK));
    expect((await res.json()).rotos).toEqual([]);
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('el DNS muerto (ENOTFOUND) cuenta como roto desde el primer intento y escala', async () => {
    const muerto = urlDe('oxxo');
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    porUrl = (url) => (url === muerto ? dns : resp(200, FORMULARIO));
    const cuerpo = await (await GET(peticion(OK))).json();
    expect(cuerpo.rotos[0]).toMatchObject({ clave: 'oxxo', estado: 'sin_dns' });
    expect(intentos.get(muerto)).toBe(1); // el DNS no se refuta
    expect(alertarOperador).toHaveBeenCalledTimes(1);
  });

  it('200 sin formulario y sin bundle (el modo de falla de OXXO) es roto; una SPA es «sin confirmar» y NO escala', async () => {
    const vacia = urlDe('oxxo'); const spa = urlDe('circle_k');
    porUrl = (url) => (url === vacia ? resp(200, VACIA) : url === spa ? resp(200, SPA) : resp(200, FORMULARIO));
    const cuerpo = await (await GET(peticion(OK))).json();
    expect(cuerpo.rotos.map((r: { clave: string }) => r.clave)).toEqual(['oxxo']);
    expect(cuerpo.rotos[0].estado).toBe('sin_formulario');
    const [, datos] = alertarOperador.mock.calls[0] as [string, { error: string }];
    expect(datos.error).not.toMatch(/circle_k/);
  });

  it('un fallo de NUESTRO lado es «no medido»: se dice, no es correo y no se cuenta como roto', async () => {
    porUrl = () => new Error('socket hang up');
    const res = await GET(peticion(OK));
    const cuerpo = await res.json();
    expect(res.status).toBe(200);
    expect(cuerpo.rotos).toEqual([]);
    expect(cuerpo.noMedidos).toBe(vigilables().length);
    expect(cuerpo.parte).toMatch(/NO MEDIDOS/);
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('con el reloj agotado deja portales SIN TURNO sin fingir que los miró: latido «parcial»', async () => {
    const t0 = 1_800_000_000_000;
    let llamadas = 0;
    // 1.ª llamada: el `venceEn` de la ruta. 2.ª y 3.ª: las de los dos primeros portales. Luego, el reloj ya pasó el tope.
    vi.spyOn(Date, 'now').mockImplementation(() => (++llamadas <= 3 ? t0 : t0 + 10 * 60_000));
    const res = await GET(peticion(OK));
    const cuerpo = await res.json();
    expect(res.status).toBe(200);
    expect(cuerpo.revisados).toBe(2);
    expect(cuerpo.sinTurno).toHaveLength(vigilables().length - 2);
    expect(cuerpo.parte).toMatch(/SIN TURNO/);
    expect(registrarLatido).toHaveBeenCalledWith('portales-vivos', 'parcial', { revisados: 2, rotos: 0 });
  });

  it('si la vigilancia misma revienta: 500, correo con el error y latido «fallo» (no un verde sobre una pasada que no ocurrió)', async () => {
    anularVigilancia = async () => { throw new Error('se cayó el catálogo'); };
    const res = await GET(peticion(OK));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'se cayó el catálogo' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.portales-vivos', expect.objectContaining({ error: 'se cayó el catálogo' }));
    expect(registrarLatido).toHaveBeenCalledWith('portales-vivos', 'fallo', expect.any(Object));
  });

  it('el correo no crece sin tope: con muchos portales rotos el texto se recorta a 800 caracteres', async () => {
    porUrl = () => resp(503);
    const cuerpo = await (await GET(peticion(OK))).json();
    expect(cuerpo.rotos.length).toBe(vigilables().length);
    const [, datos] = alertarOperador.mock.calls[0] as [string, { error: string }];
    expect(datos.error.length).toBeLessThanOrEqual(800 + 80);
  });
});
