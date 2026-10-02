import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => true), clientIp: () => '1.2.3.4' }));

const { generarCodigo, normalizarCodigo, hashCodigo, iniciarVinculacion, reclamarVinculacion, completarVinculacion, fallarVinculacion, cancelarVinculacion, estadoVisible, VIGENCIA_CODIGO_MIN } = await import('./vinculacion_remota');
const { crearMemoriaVinculacion } = await import('./memoria.fixture');
const { manejarReclamo, manejarCompletar } = await import('./vinculacion_http');
const { rateLimit } = await import('@/lib/ratelimit');
const { comercio } = await import('../facturacion/comercios');

// ═══════════════════════════════════════════════════════════════════════════
// LA VINCULACIÓN ASISTIDA DESDE EL PANEL (0540). Lo que se fija:
//   · el código: 80 bits, sin caracteres ambiguos, se normaliza al teclearlo y solo su HASH
//     entra a la base;
//   · una solicitud viva por (flota, portal); el código sirve UNA vez; vencido no sirve;
//   · el servidor NO confía en lo que sube la máquina: recorta al dominio del portal, y una
//     sesión sin cookies del portal NO queda como vinculada;
//   · si el cofre no está configurado, no se guarda nada ni se anota «vinculado»;
//   · el tenant y el portal salen del CÓDIGO, nunca del cuerpo.
// ═══════════════════════════════════════════════════════════════════════════

const A = 'tenant-a';
const B = 'tenant-b';
const USER = 'user-1';
// Un portal que SÍ pide cuenta, tomado del catálogo real.
const CON_CUENTA = 'la_gas';
const HOST = new URL(comercio(CON_CUENTA)!.portal).hostname;
const estadoDelPortal = (extra: Array<{ domain: string; name?: string }> = [{ domain: HOST }]) =>
  JSON.stringify({ cookies: extra.map((c, i) => ({ name: c.name ?? `c${i}`, value: 'x', domain: c.domain, path: '/' })), origins: [] });

let reloj: { ahora: Date };
let mem: ReturnType<typeof crearMemoriaVinculacion>;
beforeEach(() => {
  reloj = { ahora: new Date('2026-10-02T12:00:00Z') };
  mem = crearMemoriaVinculacion(reloj);
  vi.mocked(rateLimit).mockResolvedValue(true);
});

describe('el código', () => {
  it('son 16 símbolos en 4 grupos, del alfabeto sin ambiguos', () => {
    for (let i = 0; i < 50; i++) expect(generarCodigo()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });
  it('dos códigos seguidos no coinciden (80 bits)', () => {
    expect(new Set(Array.from({ length: 200 }, () => generarCodigo())).size).toBe(200);
  });
  it('se normaliza lo que se teclea: minúsculas, espacios, O/I/L', () => {
    expect(normalizarCodigo('abcd efgh jkmn pqrs')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizarCodigo('oooo-iiii-llll-0000')).toBe('0000111111110000');
    expect(normalizarCodigo('corto')).toBeNull();
    expect(normalizarCodigo('UUUU-UUUU-UUUU-UUUU')).toBeNull();
  });
  it('el hash es estable y es lo único que se guarda', () => {
    expect(hashCodigo('abcd-efgh-jkmn-pqrs')).toBe(hashCodigo('ABCDEFGHJKMNPQRS'));
    expect(hashCodigo('abcd-efgh-jkmn-pqrs')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('iniciar', () => {
  it('crea la solicitud, devuelve el código UNA vez y el comando; en la base solo hay hash', async () => {
    const r = await iniciarVinculacion({ tenantId: A, userId: USER, comercio: CON_CUENTA }, mem.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.comando).toContain(`--codigo ${r.codigo}`);
    expect(JSON.stringify(mem.filas)).not.toContain(r.codigo);
    expect(JSON.stringify(mem.filas)).not.toContain(normalizarCodigo(r.codigo)!);
    expect(mem.filas[0].expiraEn).toBe(new Date(reloj.ahora.getTime() + VIGENCIA_CODIGO_MIN * 60_000).toISOString());
    expect(mem.bitacora[0]).toMatchObject({ accion: 'autofactura.vinculacion_iniciada', comercio: CON_CUENTA });
    expect(JSON.stringify(mem.bitacora)).not.toContain(r.codigo);
  });
  it('un portal que no pide cuenta no se vincula, y uno inexistente tampoco', async () => {
    const sinCuenta = (await import('../facturacion/comercios')).COMERCIOS.find((c) => !c.requiereCuenta)!.clave;
    expect((await iniciarVinculacion({ tenantId: A, userId: USER, comercio: sinCuenta }, mem.deps)).ok).toBe(false);
    expect((await iniciarVinculacion({ tenantId: A, userId: USER, comercio: 'no_existe' }, mem.deps)).ok).toBe(false);
  });
  it('una sola viva por (flota, portal); otra flota sí puede; vencida deja pedir otra', async () => {
    expect((await iniciarVinculacion({ tenantId: A, userId: USER, comercio: CON_CUENTA }, mem.deps)).ok).toBe(true);
    expect((await iniciarVinculacion({ tenantId: A, userId: USER, comercio: CON_CUENTA }, mem.deps)).ok).toBe(false);
    expect((await iniciarVinculacion({ tenantId: B, userId: 'u-b', comercio: CON_CUENTA }, mem.deps)).ok).toBe(true);
    reloj.ahora = new Date(reloj.ahora.getTime() + 16 * 60_000);
    expect((await iniciarVinculacion({ tenantId: A, userId: USER, comercio: CON_CUENTA }, mem.deps)).ok).toBe(true);
  });
});

async function codigoNuevo(tenantId = A) {
  const r = await iniciarVinculacion({ tenantId, userId: USER, comercio: CON_CUENTA }, mem.deps);
  if (!r.ok) throw new Error(r.motivo);
  return r.codigo;
}

describe('reclamar', () => {
  it('devuelve QUÉ portal abrir, y nunca el tenant ni el id interno', async () => {
    const codigo = await codigoNuevo();
    const r = await reclamarVinculacion(codigo.toLowerCase(), mem.deps);
    expect(r).toMatchObject({ ok: true, comercio: CON_CUENTA, portal: comercio(CON_CUENTA)!.portal });
    const res = await manejarReclamo(new Request('http://x/api', { method: 'POST', body: JSON.stringify({ codigo: await codigoNuevo(B) }) }), mem.deps);
    const cuerpo = await res.json();
    expect(cuerpo).not.toHaveProperty('tenantId');
    expect(cuerpo).not.toHaveProperty('solicitudId');
    expect(JSON.stringify(cuerpo)).not.toContain(B);
  });
  it('el código sirve UNA vez', async () => {
    const codigo = await codigoNuevo();
    expect((await reclamarVinculacion(codigo, mem.deps)).ok).toBe(true);
    expect(await reclamarVinculacion(codigo, mem.deps)).toMatchObject({ ok: false });
  });
  it('vencido no sirve; desconocido y mal formado tampoco', async () => {
    const codigo = await codigoNuevo();
    reloj.ahora = new Date(reloj.ahora.getTime() + 16 * 60_000);
    expect(await reclamarVinculacion(codigo, mem.deps)).toMatchObject({ ok: false });
    expect(await reclamarVinculacion('AAAA-AAAA-AAAA-AAAA', mem.deps)).toMatchObject({ ok: false });
    expect(await reclamarVinculacion('xx', mem.deps)).toMatchObject({ ok: false });
  });
  it('cancelada desde el panel ya no se reclama', async () => {
    const codigo = await codigoNuevo();
    expect(await cancelarVinculacion({ tenantId: A, userId: USER, comercio: CON_CUENTA }, mem.deps)).toBe(1);
    expect((await reclamarVinculacion(codigo, mem.deps)).ok).toBe(false);
  });
});

describe('completar', () => {
  it('feliz: recorta al portal, guarda cifrada (puerto), anota vinculado y cierra', async () => {
    const codigo = await codigoNuevo();
    await reclamarVinculacion(codigo, mem.deps);
    // La máquina del contralor sube TAMBIÉN cookies de otros sitios: el servidor las descarta.
    const subido = estadoDelPortal([{ domain: HOST, name: 'sid' }, { domain: 'mail.google.com', name: 'SAPISID' }]);
    const r = await completarVinculacion({ codigo, storageState: subido }, mem.deps);
    expect(r).toEqual({ ok: true, comercio: CON_CUENTA, cookies: 1 });
    const guardada = mem.guardadas.get(`${A}|${CON_CUENTA}`)!;
    expect(guardada.storageState).toContain('sid');
    expect(guardada.storageState).not.toContain('SAPISID');
    expect(mem.vinculados.has(`${A}|${CON_CUENTA}`)).toBe(true);
    expect(mem.filas[0]).toMatchObject({ estado: 'completada', cookies: 1 });
    expect(mem.bitacora.map((b) => b.accion)).toContain('autofactura.vinculacion_completada');
  });
  it('sin haberse reclamado no se completa (el código no basta para subir una sesión)', async () => {
    const codigo = await codigoNuevo();
    expect((await completarVinculacion({ codigo, storageState: estadoDelPortal() }, mem.deps)).ok).toBe(false);
    expect(mem.guardadas.size).toBe(0);
  });
  it('una sesión sin cookies del portal NO queda vinculada: falla y lo dice', async () => {
    const codigo = await codigoNuevo();
    await reclamarVinculacion(codigo, mem.deps);
    const r = await completarVinculacion({ codigo, storageState: estadoDelPortal([{ domain: 'otro-sitio.com' }]) }, mem.deps);
    expect(r.ok).toBe(false);
    expect(mem.guardadas.size).toBe(0);
    expect(mem.vinculados.size).toBe(0);
    expect(mem.filas[0].estado).toBe('fallida');
  });
  it('JSON basura o demasiado grande falla cerrado', async () => {
    const codigo = await codigoNuevo();
    await reclamarVinculacion(codigo, mem.deps);
    expect((await completarVinculacion({ codigo, storageState: 'no es json' }, mem.deps)).ok).toBe(false);
    expect(mem.guardadas.size).toBe(0);
    const c2 = await (async () => { await cancelarVinculacion({ tenantId: A, userId: USER, comercio: CON_CUENTA }, mem.deps); return codigoNuevo(); })();
    await reclamarVinculacion(c2, mem.deps);
    expect((await completarVinculacion({ codigo: c2, storageState: 'x'.repeat(250_000) }, mem.deps)).ok).toBe(false);
  });
  it('sin cofre configurado: no guarda, no anota vinculado, la solicitud queda fallida', async () => {
    mem.salidas.fallaCofre = true;
    const codigo = await codigoNuevo();
    await reclamarVinculacion(codigo, mem.deps);
    const r = await completarVinculacion({ codigo, storageState: estadoDelPortal() }, mem.deps);
    expect(r).toMatchObject({ ok: false });
    expect(mem.vinculados.size).toBe(0);
    expect(mem.filas[0].estado).toBe('fallida');
  });
  it('venció a mitad: no se completa y queda expirada', async () => {
    const codigo = await codigoNuevo();
    await reclamarVinculacion(codigo, mem.deps);
    reloj.ahora = new Date(reloj.ahora.getTime() + 16 * 60_000);
    expect((await completarVinculacion({ codigo, storageState: estadoDelPortal() }, mem.deps)).ok).toBe(false);
    expect(mem.guardadas.size).toBe(0);
    expect(mem.filas[0].estado).toBe('expirada');
  });
  it('el script avisa que no pudo: queda fallida con el motivo, y no se puede completar después', async () => {
    const codigo = await codigoNuevo();
    await reclamarVinculacion(codigo, mem.deps);
    expect(await fallarVinculacion({ codigo, motivo: 'la persona no entró a tiempo' }, mem.deps)).toEqual({ ok: true });
    expect(mem.filas[0]).toMatchObject({ estado: 'fallida', motivo: 'la persona no entró a tiempo' });
    expect((await completarVinculacion({ codigo, storageState: estadoDelPortal() }, mem.deps)).ok).toBe(false);
  });
});

describe('la puerta HTTP', () => {
  const post = (cuerpo: unknown, crudo?: string) => new Request('http://x/api', { method: 'POST', body: crudo ?? JSON.stringify(cuerpo) });
  it('con el límite de ritmo agotado contesta 429 sin tocar nada', async () => {
    vi.mocked(rateLimit).mockResolvedValue(false);
    expect((await manejarReclamo(post({ codigo: 'x' }), mem.deps)).status).toBe(429);
    expect((await manejarCompletar(post({ codigo: 'x' }), mem.deps)).status).toBe(429);
  });
  it('cuerpo basura, sin código o demasiado grande: 400', async () => {
    expect((await manejarReclamo(post(null, 'no-json'), mem.deps)).status).toBe(400);
    expect((await manejarReclamo(post({}), mem.deps)).status).toBe(400);
    expect((await manejarCompletar(post({ codigo: 'x', storageState: 'x'.repeat(300_000) }), mem.deps)).status).toBe(400);
  });
  it('un tenant_id o comercio en el cuerpo se IGNORA: manda el código', async () => {
    const codigo = await codigoNuevo(A);
    await manejarReclamo(post({ codigo }), mem.deps);
    const res = await manejarCompletar(post({ codigo, tenant_id: B, comercio: 'otro', storageState: estadoDelPortal() }), mem.deps);
    expect(res.status).toBe(200);
    expect(mem.guardadas.has(`${A}|${CON_CUENTA}`)).toBe(true);
    expect([...mem.guardadas.keys()].some((k) => k.startsWith(B))).toBe(false);
  });
  it('ciclo por HTTP: reclamo → completar; repetir el reclamo falla; fallo explícito cierra', async () => {
    const codigo = await codigoNuevo();
    expect((await manejarReclamo(post({ codigo }), mem.deps)).status).toBe(200);
    expect((await manejarReclamo(post({ codigo }), mem.deps)).status).toBe(400);
    expect((await manejarCompletar(post({ codigo, fallo: 'cerró la ventana' }), mem.deps)).status).toBe(200);
    expect(mem.filas[0].estado).toBe('fallida');
  });
});

describe('estadoVisible', () => {
  it('una viva vencida se muestra vencida aunque la base no la haya cerrado', () => {
    const s = { id: '1', tenantId: A, comercio: 'x', estado: 'pendiente' as const, creadaEn: '', expiraEn: '2026-10-02T12:00:00Z', reclamadaEn: null, cerradaEn: null, cookies: null, motivo: null };
    expect(estadoVisible(s, new Date('2026-10-02T11:59:00Z'))).toBe('pendiente');
    expect(estadoVisible(s, new Date('2026-10-02T12:00:01Z'))).toBe('expirada');
    expect(estadoVisible(null, new Date())).toBe('ninguna');
  });
});
