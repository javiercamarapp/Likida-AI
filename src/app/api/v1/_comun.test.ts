// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DE /v1, FIJADA.
//
// La prueba que da nombre al archivo es la primera: UNA SESIÓN DE SUPERADMIN
// PIDIENDO OTRA FLOTA RECIBE LA SUYA. El doble de `resolverTenantApi` honra el
// `?tenant=` igual que el real —es la única forma de que la prueba falle si
// `abrir()` deja de borrarlo—, así que si alguien quita `urlSinTenant` la
// prueba devuelve `t-otra` y truena. Sin ese doble fiel, la prueba pasaría
// aunque el parámetro cruzara entero.
//
// Se prueba `_comun.ts` y no cada ruta porque el gateo vive AQUÍ: las cinco
// rutas llaman a `abrir()` y no reimplementan una línea de autorización. Probar
// cinco copias de la misma decisión mediría constancia, no protección.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── El doble de la credencial ──────────────────────────────────────────────
//
// Fiel al real: sin sesión 401; superadmin puede apuntar a otra flota con
// `?tenant=`; un rol de flota se queda en el suyo pase lo que pase.
type Sesion = { tenantId: string | null; rol: string };
// La MISMA firma que el real (`ResultadoTenantApi`), escrita a mano en vez de
// importada: un doble que sólo acepta los casos que el doble produce dejaría de
// compilar el día que la prueba quiera forzar un 503, y ese es justamente el
// caso que hay que poder forzar.
type ResultadoDoble =
  | { ok: true; tenantId: string; rol: string }
  | { ok: false; status: 401 | 403 | 503; motivo: string };

let sesion: Sesion | null = { tenantId: 't-sesion', rol: 'superadmin' };
const urlesVistas: string[] = [];

const resolverTenantApi = vi.fn(async (url: string): Promise<ResultadoDoble> => {
  urlesVistas.push(url);
  if (!sesion) return { ok: false, status: 401, motivo: 'Necesitas iniciar sesión.' };
  let tenantId = sesion.tenantId;
  if (!tenantId) {
    if (sesion.rol !== 'superadmin') {
      return { ok: false, status: 403, motivo: 'Tu cuenta no está asignada a una flota.' };
    }
    tenantId = 't-demo';
  }
  const pedido = new URL(url).searchParams.get('tenant');
  if (pedido && sesion.rol === 'superadmin') tenantId = pedido;
  return { ok: true, tenantId, rol: sesion.rol };
});

vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: (u: string) => resolverTenantApi(u) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { reiniciarLimites } = await import('@/lib/ratelimit');
const { LecturaIncompleta } = await import('@/lib/likida/pg');
const {
  abrir, urlSinTenant, leerPagina, leerCursor, codificarCursor, decodificarCursor,
  sobre, rebanar, fallo, errorApi, areaDeLlaveAlcanza,
  LIMITE_DEFECTO, LIMITE_MAXIMO, VENTANA_MAXIMA, TASA_ANONIMA, TASA_POR_FLOTA,
} = await import('./_comun');

/** Una petición con IP propia: el límite de tasa es por IP y se comparte entre
 *  casos si todas dicen ser la misma máquina. */
let n = 0;
function peticion(url = 'https://app.likida.ai/api/v1/viajes', ip = `10.0.0.${++n}`): Request {
  return new Request(url, { headers: { 'x-forwarded-for': ip } });
}

beforeEach(() => {
  reiniciarLimites();
  urlesVistas.length = 0;
  resolverTenantApi.mockClear();
  sesion = { tenantId: 't-sesion', rol: 'superadmin' };
});

describe('el tenant sale de la credencial, nunca de la petición', () => {
  it('IDOR: un superadmin pidiendo ?tenant=otra recibe la SUYA', async () => {
    const r = await abrir(peticion('https://app.likida.ai/api/v1/viajes?tenant=t-otra'), 'operacion');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tenantId).toBe('t-sesion');
    // Y la prueba de POR QUÉ: el parámetro no llegó siquiera al resolver.
    expect(urlesVistas).toHaveLength(1);
    expect(new URL(urlesVistas[0]).searchParams.has('tenant')).toBe(false);
  });

  it('un rol de flota tampoco puede cambiarse de flota con ?tenant=', async () => {
    sesion = { tenantId: 't-flota-a', rol: 'flota_admin' };
    const r = await abrir(peticion('https://app.likida.ai/api/v1/clientes?tenant=t-flota-b'), 'dinero');
    expect(r.ok && r.tenantId).toBe('t-flota-a');
  });

  it('el ?tenant= se borra y el resto de la query sobrevive', () => {
    const limpia = urlSinTenant('https://x/api/v1/viajes?limite=10&tenant=t-otra&desplazamiento=5');
    const q = new URL(limpia).searchParams;
    expect(q.has('tenant')).toBe(false);
    expect(q.get('limite')).toBe('10');
    expect(q.get('desplazamiento')).toBe('5');
  });

  it('una URL sin ?tenant= sale igual (no se inventa el parámetro)', () => {
    expect(new URL(urlSinTenant('https://x/api/v1/unidades?limite=3')).searchParams.has('tenant')).toBe(false);
  });
});

describe('fallar cerrado', () => {
  it('sin sesión: 401 y CERO datos', async () => {
    sesion = null;
    const r = await abrir(peticion(), 'operacion');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.respuesta.status).toBe(401);
    const cuerpo = await r.respuesta.json();
    expect(cuerpo.error.codigo).toBe('no_autenticado');
    expect(cuerpo).not.toHaveProperty('datos');
  });

  it('cuenta sin flota (y sin ser superadmin): 403', async () => {
    sesion = { tenantId: null, rol: 'contador' };
    const r = await abrir(peticion(), 'dinero');
    expect(!r.ok && r.respuesta.status).toBe(403);
  });

  it('el rol se comprueba DESPUÉS del tenant: un encargado no entra a `dinero`', async () => {
    sesion = { tenantId: 't-flota-a', rol: 'encargado' };
    const r = await abrir(peticion(), 'dinero');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.respuesta.status).toBe(403);
    expect((await r.respuesta.json()).error.codigo).toBe('sin_permiso');
  });

  it('…y el mismo encargado SÍ entra a `operacion`', async () => {
    sesion = { tenantId: 't-flota-a', rol: 'encargado' };
    expect((await abrir(peticion(), 'operacion')).ok).toBe(true);
  });

  it('un rol que no existe en la matriz no ve nada (fail closed, no fail open)', async () => {
    sesion = { tenantId: 't-flota-a', rol: 'sin_rol' };
    expect((await abrir(peticion(), 'operacion')).ok).toBe(false);
    expect((await abrir(peticion(), 'dinero')).ok).toBe(false);
  });

  it('si el resolver LANZA (env ausente, SDK caído) sale un 500 con código, no un stack', async () => {
    resolverTenantApi.mockRejectedValueOnce(new Error('supabaseUrl is required'));
    const r = await abrir(peticion(), 'operacion');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.respuesta.status).toBe(500);
    const cuerpo = await r.respuesta.json();
    expect(cuerpo.error.codigo).toBe('error_interno');
    expect(JSON.stringify(cuerpo)).not.toContain('supabaseUrl');
  });

  it('un bache de red al verificar la flota es 503, no un 200 vacío', async () => {
    resolverTenantApi.mockResolvedValueOnce({ ok: false, status: 503, motivo: 'No se pudo verificar la flota pedida.' });
    const r = await abrir(peticion(), 'operacion');
    expect(!r.ok && r.respuesta.status).toBe(503);
    if (!r.ok) expect((await r.respuesta.json()).error.codigo).toBe('dependencia_no_disponible');
  });
});

describe('límite de tasa', () => {
  it(`corta a las ${TASA_ANONIMA} peticiones por minuto de la misma IP`, async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < TASA_ANONIMA; i++) {
      expect((await abrir(peticion('https://x/api/v1/viajes', ip), 'operacion')).ok).toBe(true);
    }
    const r = await abrir(peticion('https://x/api/v1/viajes', ip), 'operacion');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.respuesta.status).toBe(429);
      expect((await r.respuesta.json()).error.codigo).toBe('demasiadas_peticiones');
    }
  });

  it('la puerta anónima corre ANTES del resolver: una IP bloqueada no gasta un viaje a la base', async () => {
    const ip = '203.0.113.8';
    for (let i = 0; i < TASA_ANONIMA; i++) await abrir(peticion('https://x/api/v1/viajes', ip), 'operacion');
    const antes = resolverTenantApi.mock.calls.length;
    await abrir(peticion('https://x/api/v1/viajes', ip), 'operacion');
    expect(resolverTenantApi.mock.calls.length).toBe(antes);
  });

  it(`una flota también se acota: ${TASA_POR_FLOTA}/min aunque cambie de IP`, async () => {
    // Cada vuelta con IP distinta, así que quien corta sólo puede ser la cubeta
    // de la flota. Se necesitan más de TASA_ANONIMA vueltas: por eso la IP rota.
    let ultimo: Awaited<ReturnType<typeof abrir>> | null = null;
    for (let i = 0; i <= TASA_POR_FLOTA; i++) {
      ultimo = await abrir(peticion('https://x/api/v1/viajes', `198.51.100.${i % 250}.${Math.floor(i / 250)}`), 'operacion');
    }
    expect(ultimo && ultimo.ok).toBe(false);
  });
});

describe('paginación con tope', () => {
  const url = (q: string) => `https://app.likida.ai/api/v1/viajes${q}`;

  it('sin parámetros usa el default y no se lo inventa', () => {
    const r = leerPagina(url(''));
    expect(r.ok && r.pagina).toEqual({ limite: LIMITE_DEFECTO, desplazamiento: 0 });
  });

  it('acepta valores válidos', () => {
    const r = leerPagina(url('?limite=25&desplazamiento=50'));
    expect(r.ok && r.pagina).toEqual({ limite: 25, desplazamiento: 50 });
  });

  it(`un limite por encima de ${LIMITE_MAXIMO} devuelve 400 — NO se recorta en silencio`, async () => {
    const r = leerPagina(url(`?limite=${LIMITE_MAXIMO + 1}`));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.respuesta.status).toBe(400);
    const cuerpo = await r.respuesta.json();
    expect(cuerpo.error.codigo).toBe('parametro_invalido');
    // El techo tiene que estar EN el mensaje: un 400 que no dice el máximo
    // obliga al integrador a adivinarlo a base de reintentos.
    expect(cuerpo.error.mensaje).toContain(String(LIMITE_MAXIMO));
  });

  it('rechaza lo que no es un entero, en vez de leerlo a medias', () => {
    for (const malo of ['0', '-1', 'diez', '1.5', '1e3', '0x10', ' 12abc', '']) {
      expect(leerPagina(url(`?limite=${encodeURIComponent(malo)}`)).ok).toBe(false);
    }
  });

  it('rechaza un desplazamiento negativo o no entero', () => {
    for (const malo of ['-1', 'a', '2.5']) {
      expect(leerPagina(url(`?desplazamiento=${encodeURIComponent(malo)}`)).ok).toBe(false);
    }
  });

  it(`la VENTANA total se topa en ${VENTANA_MAXIMA}: nadie se baja la base en una llamada`, () => {
    expect(leerPagina(url(`?limite=${LIMITE_MAXIMO}&desplazamiento=${VENTANA_MAXIMA - LIMITE_MAXIMO}`)).ok).toBe(true);
    expect(leerPagina(url(`?limite=${LIMITE_MAXIMO}&desplazamiento=${VENTANA_MAXIMA - LIMITE_MAXIMO + 1}`)).ok).toBe(false);
  });

  it('el ?tenant= no estorba a la paginación (se lee la query igual)', () => {
    expect(leerPagina(url('?tenant=t-otra&limite=7')).ok && leerPagina(url('?tenant=t-otra&limite=7')));
    const r = leerPagina(url('?tenant=t-otra&limite=7'));
    expect(r.ok && r.pagina.limite).toBe(7);
  });
});

describe('el sobre de una lista', () => {
  const pagina = { limite: 2, desplazamiento: 0 };

  it('con total conocido, hayMas es exacto', () => {
    expect(sobre(['a', 'b'], pagina, 5).pagina).toEqual({
      limite: 2, desplazamiento: 0, devueltos: 2, total: 5, hayMas: true,
    });
    expect(sobre(['a', 'b'], { limite: 2, desplazamiento: 3 }, 5).pagina.hayMas).toBe(false);
  });

  it('total null se CONSERVA null — no se rellena con 0 ni con lo devuelto', () => {
    const s = sobre(['a'], pagina, null);
    expect(s.pagina.total).toBeNull();
    // Un 0 aquí diría "esta flota no tiene viajes" mientras se devuelve uno.
    expect(s.pagina.total).not.toBe(0);
  });

  it('sin total, hayMas es conservador: página llena = puede haber más', () => {
    expect(sobre(['a', 'b'], pagina, null).pagina.hayMas).toBe(true);
    expect(sobre(['a'], pagina, null).pagina.hayMas).toBe(false);
  });

  it('rebanar respeta desplazamiento y límite', () => {
    const todos = [1, 2, 3, 4, 5];
    expect(rebanar(todos, { limite: 2, desplazamiento: 1 })).toEqual([2, 3]);
    expect(rebanar(todos, { limite: 2, desplazamiento: 9 })).toEqual([]);
  });
});

describe('los errores no filtran lo que pasa por dentro', () => {
  it('un error de Postgres NO cruza al cuerpo de la respuesta', async () => {
    const res = fallo('v1.prueba', new Error('duplicate key value violates unique constraint "liquidacion_viaje_uidx"'));
    expect(res.status).toBe(500);
    const texto = JSON.stringify(await res.json());
    for (const filtrado of ['duplicate key', 'constraint', 'liquidacion_viaje_uidx', 'violates']) {
      expect(texto).not.toContain(filtrado);
    }
    expect(JSON.parse(texto).error.codigo).toBe('error_interno');
  });

  it('un mensaje de negocio TAMPOCO cruza: en una API se ramifica por código, no por texto', async () => {
    const res = fallo('v1.prueba', new Error('el operador no pertenece a esta flota'));
    expect(JSON.stringify(await res.json())).not.toContain('operador');
  });

  it('una lectura incompleta tiene código propio: reintentar no la arregla', async () => {
    const res = fallo('v1.prueba', new LecturaIncompleta('v1.viajes', 1000, 4200));
    expect(res.status).toBe(500);
    const cuerpo = await res.json();
    expect(cuerpo.error.codigo).toBe('lectura_incompleta');
    // Ni siquiera el conteo interno sale: son cifras de la flota.
    expect(JSON.stringify(cuerpo)).not.toContain('4200');
  });

  it('lo que no es un Error tampoco se imprime tal cual', async () => {
    const res = fallo('v1.prueba', { secreto: 'service_role_key_abc' });
    expect(JSON.stringify(await res.json())).not.toContain('service_role');
  });

  it('cada código lleva su status y su cuerpo', async () => {
    const casos = [
      ['no_autenticado', 401], ['sin_permiso', 403], ['no_encontrado', 404],
      ['parametro_invalido', 400], ['demasiadas_peticiones', 429],
      ['lectura_incompleta', 500], ['error_interno', 500], ['dependencia_no_disponible', 503],
    ] as const;
    for (const [codigo, status] of casos) {
      const res = errorApi(codigo, 'texto');
      expect(res.status).toBe(status);
      expect((await res.json()).error).toEqual({ codigo, mensaje: 'texto' });
    }
  });
});

describe('areaDeLlaveAlcanza — una llave no puede leer de más', () => {
  it('administracion alcanza para todo', () => {
    for (const a of ['operacion', 'dinero', 'administracion'] as const) {
      expect(areaDeLlaveAlcanza('administracion', a), a).toBe(true);
    }
  });

  it('dinero alcanza para dinero y operación, NO para administración', () => {
    expect(areaDeLlaveAlcanza('dinero', 'dinero')).toBe(true);
    expect(areaDeLlaveAlcanza('dinero', 'operacion')).toBe(true);
    expect(areaDeLlaveAlcanza('dinero', 'administracion')).toBe(false);
  });

  it('operacion NO alcanza para dinero — es el punto entero de acotar la llave', () => {
    // Una llave para el tablero de tráfico de un TMS no tiene por qué poder
    // leer el margen de la flota.
    expect(areaDeLlaveAlcanza('operacion', 'operacion')).toBe(true);
    expect(areaDeLlaveAlcanza('operacion', 'dinero')).toBe(false);
    expect(areaDeLlaveAlcanza('operacion', 'administracion')).toBe(false);
  });

  it('un área DESCONOCIDA no alcanza para nada — fail closed', () => {
    // Igual que un rol desconocido en visibilidad.ts. Si mañana alguien mete
    // un área nueva en la base sin actualizar esto, la llave deja de servir en
    // vez de servir de más.
    for (const a of ['operacion', 'dinero', 'administracion'] as const) {
      expect(areaDeLlaveAlcanza('inventada', a), a).toBe(false);
      expect(areaDeLlaveAlcanza('', a), a).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ESC-15 (escala 50k) — EL CURSOR. `desplazamiento` se topa en la ventana de
// 1,000 filas, que a 50k viajes/mes es menos de UN DÍA: el TMS que quiera el
// histórico no tenía por dónde. El cursor es `(created_at, id)` de la última
// fila entregada, opaco para el integrador. Aquí se fija que va y vuelve
// intacto, que lo inválido es 400 (no una consulta rara a la base) y que
// `?conteo=1` es opt-in.
// ═══════════════════════════════════════════════════════════════════════════
describe('el cursor de /v1/viajes', () => {
  const url = (q: string) => `https://app.likida.ai/api/v1/viajes${q}`;
  const PAG = { limite: 50, desplazamiento: 0 };
  const ID = '11111111-2222-3333-4444-555555555555';
  const CREADO = '2026-08-22T18:04:05.123456+00:00';

  it('ida y vuelta: el cursor conserva el instante COMPLETO (microsegundos incluidos)', () => {
    const c = codificarCursor({ creadoEn: CREADO, id: ID });
    expect(decodificarCursor(c)).toEqual({ creadoEn: CREADO, id: ID });
    // Opaco: nada de la forma interna se lee a simple vista.
    expect(c).not.toContain(ID);
    expect(c).not.toContain('|');
  });

  it('sin ?despues= no hay cursor y el conteo NO se pide (es opt-in: cuesta un count(*) por petición)', () => {
    const r = leerCursor(url(''), PAG);
    expect(r.ok && r).toMatchObject({ despues: null, conteo: false });
  });

  it('?conteo=1 lo pide; ?conteo=0 no; cualquier otra cosa es 400', () => {
    expect(leerCursor(url('?conteo=1'), PAG)).toMatchObject({ ok: true, conteo: true });
    expect(leerCursor(url('?conteo=0'), PAG)).toMatchObject({ ok: true, conteo: false });
    expect(leerCursor(url('?conteo=si'), PAG).ok).toBe(false);
  });

  it('un cursor válido se lee', () => {
    const r = leerCursor(url(`?despues=${codificarCursor({ creadoEn: CREADO, id: ID })}`), PAG);
    expect(r.ok && r.despues).toEqual({ creadoEn: CREADO, id: ID });
  });

  it('un cursor inventado es 400 — NUNCA una consulta con basura dentro', async () => {
    const basura = [
      'no-es-base64!!',
      Buffer.from('sin-separador', 'utf8').toString('base64url'),
      Buffer.from(`${CREADO}|no-es-uuid`, 'utf8').toString('base64url'),
      Buffer.from(`no-es-fecha|${ID}`, 'utf8').toString('base64url'),
      // Inyección al filtro `.or()` de PostgREST, que separa por comas y
      // paréntesis: el instante no puede traerlos.
      Buffer.from(`2026-08-22T00:00:00Z,and(id.eq.otro)|${ID}`, 'utf8').toString('base64url'),
    ];
    for (const malo of basura) {
      const r = leerCursor(url(`?despues=${malo}`), PAG);
      expect(r.ok, malo).toBe(false);
      if (r.ok) continue;
      expect(r.respuesta.status).toBe(400);
      expect((await r.respuesta.json()).error.codigo).toBe('parametro_invalido');
    }
  });

  it('cursor y desplazamiento NO se combinan: 400 en vez de una página ambigua', () => {
    const c = codificarCursor({ creadoEn: CREADO, id: ID });
    expect(leerCursor(url(`?despues=${c}`), { limite: 50, desplazamiento: 50 }).ok).toBe(false);
    expect(leerCursor(url(`?despues=${c}`), PAG).ok).toBe(true);
  });

  it('el sobre lleva `siguiente` y un hayMas MEDIDO que gana sobre la derivación', () => {
    const s = sobre(['a', 'b'], { limite: 2, desplazamiento: 0 }, null, { hayMas: false, siguiente: null });
    // Sin el extra, `hayMas` sería true (página llena, total desconocido).
    expect(s.pagina.hayMas).toBe(false);
    expect(s.pagina.siguiente).toBeNull();
    // Y sin extra, el sobre de las otras rutas no inventa la llave.
    expect('siguiente' in sobre(['a'], { limite: 2, desplazamiento: 0 }, 1).pagina).toBe(false);
  });
});
