import { afterEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// SUITA DE CONTRATO del adaptador TMS (F4). Todo etiquetado SUPUESTO-API: prueba que el adaptador cumple el contrato
// SUPUESTO (`contrato.supuesto.json`) contra DOBLES; no prueba ni afirma ninguna conexión real. 0 llamadas de red.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../presupuesto', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), acotada: (q: unknown) => q }));

import { sesionDeExportaciones } from './archivo';
import {
  CONTRATO_TMS_SUPUESTO, MAPEOS_REGISTRADOS, cargarContrato, conTextoReparado, corteUtc, crearAdaptadorTms, detectorSesionCaida,
  entradasDeArchivos, esRespuestaHtml, filtrarPorCorte, firmarPush, paginacionDe, recibirPush, repararBytes, repararMojibake,
  validarContrato, ventanaConCorte, type ContratoTms,
} from './contrato';
import { aMojibake, crearDobleTms, viajesCrudos, HTML_LOGIN_DOBLE, type OpcionesDoble } from './falso/doble_contrato';
import { clasificarFilas } from './huella';
import { paginar } from './paginar';
import { leerViajes } from './viajes';

const BASE = 'https://tms.ejemplo.test';
const CRED = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const VENTANA = { desde: '2026-10-01T00:00:00.000Z', hasta: '2026-10-31T00:00:00.000Z' };
const clonar = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function contratoCon(cambios: (c: ContratoTms) => void): ContratoTms {
  const c = clonar(CONTRATO_TMS_SUPUESTO);
  cambios(c);
  return c;
}
const conTam = (n: number): ContratoTms => contratoCon((c) => { c.recursos.viajes.paginacion = { tipo: 'pagina', tamano: n }; });

function relojFalso() {
  const dormidas: number[] = [];
  let t = 1_000_000;
  return { dormidas, op: { ahora: () => t, dormir: async (ms: number) => { dormidas.push(ms); t += ms; } } };
}

function montar(o: Partial<OpcionesDoble> & { n?: number }, contrato: ContratoTms = CONTRATO_TMS_SUPUESTO, extra: { fechaCorte?: string | null } = {}) {
  const doble = crearDobleTms({ tablas: { '/api/viajes': viajesCrudos(o.n ?? 12) }, ...o });
  const r = relojFalso();
  const adaptador = crearAdaptadorTms(contrato, { http: doble.http, base: BASE, credenciales: CRED, reloj: r.op, ...extra });
  return { doble, adaptador, reloj: r };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('contrato SUPUESTO: validación', () => {
  it('el contrato entregado es válido y se declara SUPUESTO', () => {
    expect(validarContrato(CONTRATO_TMS_SUPUESTO)).toEqual([]);
    expect(CONTRATO_TMS_SUPUESTO.estado).toBe('SUPUESTO');
  });
  it('el modo API y el push vienen apagados; el de archivos (plan B) también, hasta que el cliente confirme', () => {
    expect(CONTRATO_TMS_SUPUESTO.modos.api.activo).toBe(false);
    expect(CONTRATO_TMS_SUPUESTO.modos.push.activo).toBe(false);
    expect(CONTRATO_TMS_SUPUESTO.modos.archivos.activo).toBe(false);
  });
  it('no lleva una URL real ni secretos: la base viene de la credencial del cofre', () => {
    const texto = JSON.stringify(CONTRATO_TMS_SUPUESTO);
    expect(texto).not.toMatch(/https?:\/\//);
    expect(texto).not.toMatch(/secret|password|token_valor/i);
  });
  it('todo mapeo que nombra el contrato está registrado y es válido', () => {
    for (const r of Object.values(CONTRATO_TMS_SUPUESTO.recursos)) expect(MAPEOS_REGISTRADOS[r.mapeo]).toBeDefined();
  });
  it('rechaza un estado desconocido', () => {
    expect(validarContrato(contratoCon((c) => { (c as unknown as { estado: string }).estado = 'REAL'; }))[0]).toMatch(/estado/);
  });
  it('rechaza un login sin barra inicial', () => {
    expect(validarContrato(contratoCon((c) => { c.auth.login.ruta = 'api/login'; })).join()).toMatch(/login\.ruta/);
  });
  it('rechaza una detección de sesión caída que no incluye 401', () => {
    expect(validarContrato(contratoCon((c) => { c.auth.sesion_caida.estados = [419]; })).join()).toMatch(/401/);
  });
  it('rechaza un mapeo no registrado', () => {
    expect(validarContrato(contratoCon((c) => { c.recursos.peajes.mapeo = 'mapeos/otro.json'; })).join()).toMatch(/no es un mapeo registrado/);
  });
  it('rechaza paginación por cursor sin ruta del cursor siguiente', () => {
    expect(validarContrato(contratoCon((c) => { c.recursos.viajes.paginacion = { tipo: 'cursor', ruta_siguiente: '' }; })).join()).toMatch(/ruta_siguiente/);
  });
  it('rechaza una fecha de corte imposible', () => {
    expect(validarContrato(contratoCon((c) => { c.corte.fecha = '2026-02-30'; })).join()).toMatch(/corte\.fecha/);
  });
  it('rechaza un campo de corte que no existe en el mapeo', () => {
    expect(validarContrato(contratoCon((c) => { c.recursos.viajes.campo_corte = 'no_existe'; })).join()).toMatch(/campo_corte/);
  });
  it('cargarContrato devuelve los problemas en vez de lanzar', () => {
    const r = cargarContrato({ nada: true });
    expect(r.ok).toBe(false);
    expect(cargarContrato(CONTRATO_TMS_SUPUESTO).ok).toBe(true);
  });
  it('crearAdaptadorTms lanza con un contrato roto: un contrato inválido no se usa', () => {
    const roto = contratoCon((c) => { c.auth.login.ruta = 'x'; });
    expect(() => crearAdaptadorTms(roto, { http: async () => ({ estado: 200, cuerpo: '{}' }), base: BASE, credenciales: CRED })).toThrow(/inválido/);
  });
  it('paginacionDe entrega una copia: modificarla no cambia el contrato', () => {
    const p = paginacionDe(CONTRATO_TMS_SUPUESTO, 'viajes');
    if (p.tipo === 'pagina') p.tamano = 1;
    expect(paginacionDe(CONTRATO_TMS_SUPUESTO, 'viajes')).toEqual({ tipo: 'pagina', tamano: 100 });
  });
});

describe('contrato SUPUESTO: login y re-login único', () => {
  it('login → lectura completa; un solo login y las únicas peticiones no-GET son el login', async () => {
    const { doble, adaptador } = montar({});
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.motivo).toBeUndefined();
    expect(r.filas).toHaveLength(12);
    expect(r.completa).toBe(true);
    expect(doble.logins).toBe(1);
    expect(doble.peticiones.filter((p) => p.metodo !== 'GET').map((p) => new URL(p.url).pathname)).toEqual(['/api/login']);
  });
  it('0 llamadas de red reales: el adaptador solo usa el transporte inyectado', async () => {
    const f = vi.fn(() => { throw new Error('red real'); });
    vi.stubGlobal('fetch', f);
    const { adaptador } = montar({});
    await adaptador.leer('viajes', VENTANA);
    expect(f).not.toHaveBeenCalled();
  });
  it('el token se manda con el encabezado y prefijo del contrato', async () => {
    const { doble, adaptador } = montar({});
    await adaptador.leer('viajes', VENTANA);
    expect(doble.peticiones.find((p) => p.metodo === 'GET')?.encabezados?.Authorization).toBe('Bearer tok-1');
  });
  it('401 a mitad de paginación → UN re-login y la lectura se completa sin perder ni repetir filas', async () => {
    const { doble, adaptador } = montar({ revocarEn: [2] }, conTam(5));
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.motivo).toBeUndefined();
    expect(r.filas).toHaveLength(12);
    expect(new Set(r.filas.map((f) => (f as { folio: string }).folio)).size).toBe(12);
    expect(doble.logins).toBe(2);
  });
  it('200 con la página HTML de login → se trata como sesión caída: UN re-login', async () => {
    const { doble, adaptador } = montar({ revocarEn: [2], modoCaida: 'html' }, conTam(5));
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.filas).toHaveLength(12);
    expect(doble.logins).toBe(2);
  });
  it('200 con JSON «Token expirado» → sesión caída: UN re-login', async () => {
    const { doble, adaptador } = montar({ revocarEn: [2], modoCaida: 'json' }, conTam(5));
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.filas).toHaveLength(12);
    expect(doble.logins).toBe(2);
  });
  it('un HTML con un formulario cualquiera y la palabra «login» en el menú NO es sesión caída', () => {
    const det = detectorSesionCaida(CONTRATO_TMS_SUPUESTO);
    const cuerpo = '<html><body><a href="/login">login</a><form action="/buscar"><input name="q"></form></body></html>';
    expect(det({ estado: 200, cuerpo, encabezados: { 'content-type': 'text/html' } })).toBe(false);
  });
  it('un HTML sin marcadores de login (p. ej. mantenimiento) NO dispara re-login: falla de formato', async () => {
    const { doble, adaptador } = montar({ respuestaFija: { tipo: 'text/html', cuerpo: '<html><body>Mantenimiento programado</body></html>' } });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.motivo).toMatch(/no es JSON/);
    expect(doble.logins).toBe(1);
  });
  it('si tras el re-login sigue la sesión caída, falla como credencial y NO insiste', async () => {
    const { doble, adaptador } = montar({ rechazaTodo: true });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.motivo).toMatch(/rechaz/i);
    expect(doble.logins).toBe(2);
    expect(doble.solicitudesDatos).toBe(2);
  });
  it('credencial mala: un solo intento de login, sin datos, y el motivo no contiene la clave', async () => {
    const { doble, adaptador } = montar({ loginMalo: true });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.motivo).toMatch(/rechaz/i);
    expect(r.motivo).not.toContain(CRED.clave);
    expect(doble.solicitudesDatos).toBe(0);
    expect(doble.peticiones).toHaveLength(1);
  });
  it('dos lecturas simultáneas con el token revocado provocan UN solo re-login (single-flight)', async () => {
    const { doble, adaptador } = montar({});
    await adaptador.leer('viajes', VENTANA);
    doble.revocarTodos();
    const [a, b] = await Promise.all([adaptador.leer('viajes', VENTANA), adaptador.leer('viajes', VENTANA)]);
    expect(a.filas).toHaveLength(12);
    expect(b.filas).toHaveLength(12);
    expect(doble.logins).toBe(2);
  });
  it('la sesión no se deja serializar con el token', async () => {
    const { adaptador } = montar({});
    await adaptador.leer('viajes', VENTANA);
    expect(JSON.stringify(adaptador.sesion)).toBe('{}');
  });
});

describe('detector de sesión caída', () => {
  const det = detectorSesionCaida(CONTRATO_TMS_SUPUESTO);
  const r = (estado: number, cuerpo: string, tipo = 'application/json') => ({ estado, cuerpo, encabezados: { 'content-type': tipo } });
  it('reconoce el HTML de login con 200', () => { expect(det(r(200, HTML_LOGIN_DOBLE, 'text/html'))).toBe(true); });
  it('reconoce el HTML aunque el tipo de contenido venga mal, por su inicio', () => { expect(det(r(200, HTML_LOGIN_DOBLE, 'text/plain'))).toBe(true); });
  it('reconoce el JSON de error de sesión sin importar acentos ni mayúsculas', () => {
    expect(det(r(200, JSON.stringify({ message: 'SESIÓN vencida' })))).toBe(true);
  });
  it('no confunde un JSON de datos con sesión caída', () => { expect(det(r(200, JSON.stringify({ data: { items: [] } })))).toBe(false); });
  it('un 5xx no es sesión caída (lo maneja el reintento)', () => { expect(det(r(503, 'x'))).toBe(false); });
  it('un código extra del contrato (419) sí lo es', () => {
    const d = detectorSesionCaida(contratoCon((c) => { c.auth.sesion_caida.estados = [401, 419]; }));
    expect(d(r(419, ''))).toBe(true);
  });
  it('esRespuestaHtml distingue HTML de JSON', () => {
    expect(esRespuestaHtml(r(200, '{}'))).toBe(false);
    expect(esRespuestaHtml(r(200, '  <!DOCTYPE html><html>'))).toBe(true);
  });
});

describe('paginación', () => {
  it('lee todas las páginas con el tamaño del contrato y manda ese tamaño al origen', async () => {
    const { doble, adaptador } = montar({}, conTam(5));
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.filas).toHaveLength(12);
    const tams = doble.peticiones.filter((p) => p.metodo === 'GET').map((p) => new URL(p.url).searchParams.get('tam'));
    expect(new Set(tams)).toEqual(new Set(['5']));
  });
  it('termina completa en la primera página vacía', async () => {
    const { adaptador } = montar({ n: 0 });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.completa).toBe(true);
    expect(r.filas).toEqual([]);
  });
  it('el fusible de páginas deja backlog con punto de reanudación y el siguiente ciclo no duplica', async () => {
    const { adaptador } = montar({}, conTam(5));
    const mapeo = adaptador.mapeo('viajes');
    const pag = paginacionDe(conTam(5), 'viajes');
    const a = await paginar(adaptador.sesion, mapeo, VENTANA, { paginacion: pag, maxPaginas: 1 });
    expect(a.ok && a.backlog).toBe(true);
    if (!a.ok) throw new Error('debía ser ok');
    expect(a.filas).toHaveLength(5);
    const b = await paginar(adaptador.sesion, mapeo, { ...VENTANA, reanudar: a.reanudar }, { paginacion: pag });
    if (!b.ok) throw new Error('debía ser ok');
    const claves = [...a.filas, ...b.filas].map((f) => f.clave);
    expect(claves).toHaveLength(12);
    expect(new Set(claves).size).toBe(12);
    expect(b.completa).toBe(true);
  });
});

describe('orden inestable: dedupe por clave y huella', () => {
  it('una fila insertada al inicio entre páginas repite una fila: se cuenta como duplicada y nada se pierde', async () => {
    const nueva = { ...viajesCrudos(1)[0], Icident: 'IC-NUEVO', 'Fecha Salida': '2026-10-20 08:00:00' };
    const { adaptador } = montar({ insertarAntesDePagina2: { ruta: '/api/viajes', fila: nueva } }, conTam(5));
    const r = await paginar(adaptador.sesion, adaptador.mapeo('viajes'), VENTANA, { paginacion: paginacionDe(conTam(5), 'viajes') });
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.duplicadas).toBeGreaterThanOrEqual(1);
    const claves = r.filas.map((f) => f.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (let i = 0; i < 12; i += 1) expect(claves.some((c) => c.includes(`IC-${100 + i}`))).toBe(true);
  });
  it('la misma clave con contenido distinto: la primera gana y la relectura la marca «actualizada» por huella', async () => {
    const base = viajesCrudos(2);
    const a = await (async () => {
      const { adaptador } = montar({ tablas: { '/api/viajes': base } });
      return paginar(adaptador.sesion, adaptador.mapeo('viajes'), VENTANA);
    })();
    if (!a.ok) throw new Error('debía ser ok');
    const previas = new Map(clasificarFilas('viajes', a.filas, new Map()).filas.map((f) => [f.clave, f.huella]));
    const cambiada = clonar(base);
    cambiada[1].destino = 'Otro destino';
    const { adaptador: ad2 } = montar({ tablas: { '/api/viajes': cambiada } });
    const b = await paginar(ad2.sesion, ad2.mapeo('viajes'), VENTANA);
    if (!b.ok) throw new Error('debía ser ok');
    const est = clasificarFilas('viajes', b.filas, previas).filas.map((f) => f.estado);
    expect(est).toEqual(['omitida', 'actualizada']);
  });
  it('relectura idéntica en otro orden: todo «omitida» (la huella no depende del orden)', async () => {
    const filas = viajesCrudos(6);
    const leer = async (tabla: Record<string, unknown>[]) => {
      const { adaptador } = montar({ tablas: { '/api/viajes': tabla } }, conTam(4));
      const r = await paginar(adaptador.sesion, adaptador.mapeo('viajes'), VENTANA, { paginacion: paginacionDe(conTam(4), 'viajes') });
      if (!r.ok) throw new Error('debía ser ok');
      return r.filas;
    };
    const primera = await leer(filas);
    const previas = new Map(clasificarFilas('viajes', primera, new Map()).filas.map((f) => [f.clave, f.huella]));
    const segunda = await leer([...filas].reverse());
    const c = clasificarFilas('viajes', segunda, previas);
    expect(c.omitidas).toBe(6);
    expect(c.porAsentar).toHaveLength(0);
  });
  it('dentro de una tanda, una clave repetida cuenta una sola vez', async () => {
    const f = viajesCrudos(1)[0];
    const { adaptador } = montar({ tablas: { '/api/viajes': [f, { ...f }] } });
    const r = await paginar(adaptador.sesion, adaptador.mapeo('viajes'), VENTANA);
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.filas).toHaveLength(1);
    // el mapeo o la paginación la descarta: nunca queda dos veces, y se cuenta (no en silencio)
    expect(r.duplicadas + r.rechazadas.length).toBe(1);
  });
});

describe('429 y Retry-After', () => {
  it('respeta Retry-After (en segundos) y continúa', async () => {
    const { adaptador, reloj } = montar({ limite429: { en: [1], retryAfter: '2' } });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.motivo).toBeUndefined();
    expect(r.filas).toHaveLength(12);
    expect(reloj.dormidas).toContain(2000);
  });
  it('un 429 que no cede se abandona tras los reintentos y deja el motivo (sin bucle)', async () => {
    const { doble, adaptador } = montar({ limite429: { siempre: true, retryAfter: '1' } });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.motivo).toMatch(/429/);
    expect(r.backlog).toBe(true);
    expect(doble.solicitudesDatos).toBe(4);
  });
  it('un Retry-After desmesurado se topa en 30 s', async () => {
    const { adaptador, reloj } = montar({ limite429: { en: [1], retryAfter: '99999' } });
    await adaptador.leer('viajes', VENTANA);
    expect(Math.max(...reloj.dormidas)).toBe(30_000);
  });
  it('un 429 no provoca re-login', async () => {
    const { doble, adaptador } = montar({ limite429: { en: [1, 2], retryAfter: '1' } });
    await adaptador.leer('viajes', VENTANA);
    expect(doble.logins).toBe(1);
  });
});

describe('mojibake', () => {
  it('repara «Ã³» y «Ã±»', () => {
    expect(repararMojibake('DirecciÃ³n')).toBe('Dirección');
    expect(repararMojibake('PeÃ±a NÃºÃ±ez')).toBe('Peña Núñez');
  });
  it('repara mayúsculas acentuadas que caen en el rango de Windows-1252', () => {
    expect(repararMojibake(aMojibake('ÉXITO — Ñandú') as string)).toBe('ÉXITO — Ñandú');
  });
  it('no toca texto sano', () => {
    for (const t of ['Ñandú', 'camión', 'Sin acentos', 'Ã sola', '']) expect(repararMojibake(t)).toBe(t);
  });
  it('conTextoReparado arregla el JSON de la respuesta y deja intacto lo que no es JSON', async () => {
    const http = conTextoReparado(async () => ({ estado: 200, cuerpo: JSON.stringify({ a: 'CamiÃ³n' }) }));
    expect(JSON.parse((await http({ url: BASE, metodo: 'GET' })).cuerpo)).toEqual({ a: 'Camión' });
    const html = conTextoReparado(async () => ({ estado: 200, cuerpo: '<p>CamiÃ³n</p>' }));
    expect((await html({ url: BASE, metodo: 'GET' })).cuerpo).toBe('<p>CamiÃ³n</p>');
  });
  it('las filas leídas por la API salen con el texto reparado', async () => {
    const tabla = viajesCrudos(2).map((f) => ({ ...f, operador: 'José Núñez', destino: 'Mérida' }));
    const { adaptador } = montar({ tablas: { '/api/viajes': tabla }, mojibake: true });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.filas.map((f) => (f as { operadorNombre: string }).operadorNombre)).toEqual(['José Núñez', 'José Núñez']);
    expect((r.filas[0] as { destino: string }).destino).toBe('Mérida');
  });
  it('con reparar_mojibake apagado en el contrato, el texto se entrega tal cual', async () => {
    const tabla = viajesCrudos(1).map((f) => ({ ...f, operador: 'José' }));
    const c = contratoCon((x) => { x.texto.reparar_mojibake = false; });
    const { adaptador } = montar({ tablas: { '/api/viajes': tabla }, mojibake: true }, c);
    const r = await adaptador.leer('viajes', VENTANA);
    expect((r.filas[0] as { operadorNombre: string }).operadorNombre).toBe('JosÃ©');
  });
  it('repararBytes arregla un archivo UTF-8 doblemente codificado', () => {
    const malo = new TextEncoder().encode('operador\nJosÃ© NÃºÃ±ez\n');
    expect(new TextDecoder().decode(repararBytes(malo))).toBe('operador\nJosé Núñez\n');
  });
});

describe('fecha de corte', () => {
  const conCorte = '2026-10-05';
  it('corteUtc = 00:00 hora local de la zona del contrato', () => {
    expect(corteUtc(CONTRATO_TMS_SUPUESTO, conCorte)).toBe('2026-10-05T06:00:00.000Z');
  });
  it('sin fecha de corte no hay corte', () => { expect(corteUtc(CONTRATO_TMS_SUPUESTO)).toBeNull(); });
  it('una fecha de corte inválida lanza', () => { expect(() => corteUtc(CONTRATO_TMS_SUPUESTO, '05/10/2026')).toThrow(/aaaa-mm-dd/); });
  it('ventanaConCorte recorta el inicio, deja pasar lo posterior y anula lo anterior', () => {
    const c = '2026-10-05T06:00:00.000Z';
    expect(ventanaConCorte(VENTANA, c)).toEqual({ ventana: { desde: c, hasta: VENTANA.hasta }, recortada: true });
    expect(ventanaConCorte({ desde: '2026-10-10T00:00:00.000Z', hasta: VENTANA.hasta }, c).recortada).toBe(false);
    expect(ventanaConCorte({ desde: '2026-09-01T00:00:00.000Z', hasta: '2026-09-30T00:00:00.000Z' }, c)).toEqual({ ventana: null, recortada: true });
    expect(ventanaConCorte(VENTANA, null)).toEqual({ ventana: VENTANA, recortada: false });
  });
  it('filtrarPorCorte descarta y cuenta lo anterior; conserva filas sin fecha legible', () => {
    const r = filtrarPorCorte([{ f: '2026-10-01T00:00:00Z' }, { f: '2026-10-09T00:00:00Z' }, { f: 'basura' }], (x) => x.f, '2026-10-05T06:00:00.000Z');
    expect(r.anteriores).toBe(1);
    expect(r.filas).toHaveLength(2);
  });
  it('el adaptador no pide nada anterior al corte', async () => {
    const { doble, adaptador } = montar({}, CONTRATO_TMS_SUPUESTO, { fechaCorte: '2026-11-15' });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.sinPeticion).toBe(true);
    expect(doble.peticiones).toHaveLength(0);
  });
  it('recorta la ventana: el origen recibe el corte como «desde»', async () => {
    const { doble, adaptador } = montar({}, CONTRATO_TMS_SUPUESTO, { fechaCorte: '2026-10-05' });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(new URL(doble.peticiones.find((p) => p.metodo === 'GET')?.url ?? BASE).searchParams.get('desde')).toBe('2026-10-05T06:00:00.000Z');
    expect(r.filas).toHaveLength(8);
  });
  it('si el origen ignora la ventana y manda filas anteriores, se descartan y se cuentan', async () => {
    const { adaptador } = montar({ ignoraVentana: true }, CONTRATO_TMS_SUPUESTO, { fechaCorte: '2026-10-05' });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.anterioresAlCorte).toBe(4);
    expect(r.filas).toHaveLength(8);
    expect(r.avisos.join()).toMatch(/anteriores a la fecha de corte/);
  });
  it('sin corte fijado lo dice: no se filtra nada y la salida lo rotula SUPUESTO', async () => {
    const { adaptador } = montar({});
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.avisos.join()).toMatch(/SUPUESTO: no hay fecha de corte/);
  });
});

describe('otros recursos del contrato', () => {
  it('peajes: se leen con el mapeo del contrato y el corte', async () => {
    const peajes = [{ TAG: 'T1', Unidad: 'U-1', Caseta: 'C1', Clase: 'C2', Importe: 150.5, Fecha: '2026-10-10 09:00:00', Icident: 'IC-100' }];
    const { adaptador } = montar({ tablas: { '/api/peajes': peajes } });
    const r = await adaptador.leer('peajes', { desde: '2026-10-09T00:00:00.000Z', hasta: '2026-10-12T00:00:00.000Z' });
    expect(r.motivo).toBeUndefined();
    expect(r.filas).toHaveLength(1);
    expect((r.filas[0] as { importe: number }).importe).toBe(150.5);
  });
  it('posiciones: las coordenadas inválidas se descartan y se cuentan en el lector', async () => {
    const pos = [
      { Icident: 'IC-100', unidad: 'U-1', latitud: 19.4, longitud: -99.1, fecha: '2026-10-10 09:00:00' },
      { Icident: 'IC-100', unidad: 'U-1', latitud: 0, longitud: 0, fecha: '2026-10-10 09:05:00' },
    ];
    const { adaptador } = montar({ tablas: { '/api/posiciones': pos } });
    const r = await adaptador.leer('posiciones', { desde: '2026-10-09T00:00:00.000Z', hasta: '2026-10-12T00:00:00.000Z' });
    expect(r.filas).toHaveLength(1);
  });
  it('liquidaciones: sin renglones devuelve lectura completa y vacía', async () => {
    const { adaptador } = montar({ tablas: { '/api/nomina-bitacora': [], '/api/operadores': [], '/api/conceptos-nomina': [] } });
    const r = await adaptador.leer('liquidaciones', VENTANA);
    expect(r.motivo).toBeUndefined();
    expect(r.filas).toEqual([]);
  });
  it('una ruta inexistente en el origen falla con motivo y no lanza', async () => {
    const { adaptador } = montar({ tablas: {} });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.motivo).toBeDefined();
    expect(r.filas).toEqual([]);
  });
});

describe('datos hostiles', () => {
  it('claves extra y «__proto__» en el cuerpo no contaminan la fila ni el prototipo', async () => {
    const hostil = JSON.parse('{"Icident":"IC-1","unidad":"U-1","Fecha Salida":"2026-10-10 08:00:00","__proto__":{"polluted":true},"extra":"x"}') as Record<string, unknown>;
    const { adaptador } = montar({ tablas: { '/api/viajes': [hostil] } });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).not.toHaveProperty('extra');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('una fecha basura se rechaza con motivo; no se descarta en silencio', async () => {
    const tabla = [...viajesCrudos(1), { ...viajesCrudos(1)[0], Icident: 'IC-MALO', 'Fecha Salida': 'ayer por la tarde' }];
    const { adaptador } = montar({ tablas: { '/api/viajes': tabla }, ignoraVentana: true });
    const r = await adaptador.leer('viajes', VENTANA);
    expect(r.filas).toHaveLength(1);
    expect(r.rechazadas).toHaveLength(1);
    expect(r.rechazadas[0].motivo).toBeTruthy();
  });
});

describe('modo archivos (plan B)', () => {
  const ENC = 'Icident,unidad,Fecha Salida,Fecha Llegada,origen,destino,estatus,operador';
  const ARCHIVOS = contratoCon((x) => { x.modos.archivos.activo = true; });
  const csv = (filas: string[]) => [ENC, ...filas].join('\n');
  const FILAS = [
    'IC-1,U-1,2026-10-10 08:00:00,2026-10-10 18:00:00,Origen,Mérida,cerrado,José Núñez',
    'IC-2,U-2,2026-10-11 08:00:00,2026-10-11 18:00:00,Origen,Oaxaca,cerrado,María Peña',
  ];
  const leer = async (buffer: Uint8Array) => {
    const { entradas } = entradasDeArchivos(ARCHIVOS, [{ recurso: 'viajes', buffer, formato: 'csv' }]);
    const { sesion } = sesionDeExportaciones(entradas);
    return leerViajes(sesion, VENTANA);
  };
  it('un CSV pasa por el mismo mapeo y da las mismas filas que la API', async () => {
    const porArchivo = await leer(new TextEncoder().encode(csv(FILAS)));
    const tabla = [
      { Icident: 'IC-1', unidad: 'U-1', 'Fecha Salida': '2026-10-10 08:00:00', 'Fecha Llegada': '2026-10-10 18:00:00', origen: 'Origen', destino: 'Mérida', estatus: 'cerrado', operador: 'José Núñez' },
      { Icident: 'IC-2', unidad: 'U-2', 'Fecha Salida': '2026-10-11 08:00:00', 'Fecha Llegada': '2026-10-11 18:00:00', origen: 'Origen', destino: 'Oaxaca', estatus: 'cerrado', operador: 'María Peña' },
    ];
    const { adaptador } = montar({ tablas: { '/api/viajes': tabla } });
    const porApi = await adaptador.leer('viajes', VENTANA);
    if (!porArchivo.ok) throw new Error('debía ser ok');
    expect(porArchivo.filas).toEqual(porApi.filas);
  });
  it('un CSV con mojibake sale reparado', async () => {
    const malo = new TextEncoder().encode(aMojibake(csv(FILAS)) as string);
    const r = await leer(malo);
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.filas.map((f) => f.operadorNombre)).toEqual(['José Núñez', 'María Peña']);
  });
  it('un CSV en Windows-1252 también se lee bien', async () => {
    const bytes = Uint8Array.from(Buffer.from(csv(FILAS), 'latin1'));
    const r = await leer(bytes);
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.filas[0].operadorNombre).toBe('José Núñez');
  });
  it('rechaza un formato que el contrato no admite', () => {
    const c = contratoCon((x) => { x.modos.archivos.activo = true; x.modos.archivos.formatos = ['csv']; });
    const r = entradasDeArchivos(c, [{ recurso: 'viajes', buffer: new Uint8Array([123, 125]), formato: 'json' }]);
    expect(r.entradas).toHaveLength(0);
    expect(r.rechazados[0]).toMatch(/formato json/);
  });
  it('apagado por omisión en el contrato supuesto: no entra nada', () => {
    const r = entradasDeArchivos(CONTRATO_TMS_SUPUESTO, [{ recurso: 'viajes', buffer: new Uint8Array([1]), formato: 'csv' }]);
    expect(r.entradas).toHaveLength(0);
    expect(r.rechazados[0]).toMatch(/apagado/);
  });
});

describe('modo push (plan C)', () => {
  const SECRETO = 'secreto-sintetico';
  const AHORA = 1_790_000_000_000;
  const PUSH = contratoCon((c) => { c.modos.push.activo = true; });
  const cuerpoDe = (n = 3) => JSON.stringify({ data: { items: viajesCrudos(n) } });
  function solicitud(cuerpo: string, extra: { secreto?: string; ahora?: number; vistas?: Set<string>; encabezados?: Record<string, string>; marcaMs?: number } = {}) {
    const marca = String(Math.floor((extra.marcaMs ?? AHORA) / 1000));
    return {
      recurso: 'viajes' as const, cuerpo, secreto: extra.secreto ?? SECRETO, ahora: extra.ahora ?? AHORA, vistas: extra.vistas ?? new Set<string>(),
      encabezados: { 'x-likida-marca': marca, 'x-likida-firma': firmarPush(SECRETO, marca, 'lote-1', cuerpo), 'idempotency-key': 'lote-1', ...(extra.encabezados ?? {}) },
    };
  }
  it('apagado por omisión: 503 y no procesa nada', () => {
    const r = recibirPush(CONTRATO_TMS_SUPUESTO, solicitud(cuerpoDe()));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.estado).toBe(503);
  });
  it('lote firmado válido → filas mapeadas con la llave de idempotencia', () => {
    const r = recibirPush(PUSH, solicitud(cuerpoDe(3)));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.filas).toHaveLength(3); expect(r.llave).toBe('lote-1'); }
  });
  it('acepta también una lista en la raíz', () => {
    const r = recibirPush(PUSH, solicitud(JSON.stringify(viajesCrudos(2))));
    expect(r.ok && r.filas.length).toBe(2);
  });
  it('firma mala → 401', () => {
    const s = solicitud(cuerpoDe());
    s.encabezados['x-likida-firma'] = 'ab'.repeat(32);
    const r = recibirPush(PUSH, s);
    expect(!r.ok && r.estado).toBe(401);
  });
  it('firma de otro cuerpo (cuerpo alterado) → 401', () => {
    const s = solicitud(cuerpoDe(3));
    const r = recibirPush(PUSH, { ...s, cuerpo: cuerpoDe(4) });
    expect(!r.ok && r.estado).toBe(401);
  });
  it('firma que no es hexadecimal → 401, sin lanzar', () => {
    const s = solicitud(cuerpoDe());
    s.encabezados['x-likida-firma'] = 'zz';
    const r = recibirPush(PUSH, s);
    expect(!r.ok && r.estado).toBe(401);
  });
  it('sin firma o sin marca → 401', () => {
    const s = solicitud(cuerpoDe());
    const r = recibirPush(PUSH, { ...s, encabezados: { 'idempotency-key': 'x' } });
    expect(!r.ok && r.estado).toBe(401);
  });
  it('marca fuera de tolerancia (repetición) → 403', () => {
    const r = recibirPush(PUSH, solicitud(cuerpoDe(), { marcaMs: AHORA - 600_000 }));
    expect(!r.ok && r.estado).toBe(403);
  });
  it('llave de idempotencia repetida → 409', () => {
    const r = recibirPush(PUSH, solicitud(cuerpoDe(), { vistas: new Set(['lote-1']) }));
    expect(!r.ok && r.estado).toBe(409);
  });
  it('misma firma y cuerpo pero OTRA llave de idempotencia → 401 (la llave va firmada)', () => {
    const base = solicitud(cuerpoDe());
    const r = recibirPush(PUSH, { ...base, encabezados: { ...base.encabezados, 'idempotency-key': 'lote-2' } });
    expect(!r.ok && r.estado).toBe(401);
  });
  it('la fecha de corte de la flota rige también en push', () => {
    const base = solicitud(cuerpoDe(3));
    const sin = recibirPush(PUSH, base);
    const lejos = recibirPush(PUSH, { ...base, fechaCorte: '2099-01-01' });
    expect(sin.ok && lejos.ok).toBe(true);
    expect(lejos.ok && lejos.filas.length).toBe(0);
    expect(lejos.ok && lejos.anterioresAlCorte).toBe(3);
  });
  it('sin llave de idempotencia → 400', () => {
    const marca = String(Math.floor(AHORA / 1000)); const cuerpo = cuerpoDe();
    const r = recibirPush(PUSH, { recurso: 'viajes', cuerpo, secreto: SECRETO, ahora: AHORA, vistas: new Set(), encabezados: { 'x-likida-marca': marca, 'x-likida-firma': firmarPush(SECRETO, marca, '', cuerpo) } });
    expect(!r.ok && r.estado).toBe(400);
  });
  it('lote demasiado grande → 413', () => {
    const chico = contratoCon((c) => { c.modos.push.activo = true; c.modos.push.max_bytes = 50; });
    const r = recibirPush(chico, solicitud(cuerpoDe(5)));
    expect(!r.ok && r.estado).toBe(413);
  });
  it('JSON inválido → 422', () => {
    const r = recibirPush(PUSH, solicitud('{no es json'));
    expect(!r.ok && r.estado).toBe(422);
  });
  it('sin la lista en la raíz del mapeo → 422', () => {
    const r = recibirPush(PUSH, solicitud(JSON.stringify({ otra: [] })));
    expect(!r.ok && r.estado).toBe(422);
  });
  it('sin secreto configurado → 503 (falla cerrado)', () => {
    const r = recibirPush(PUSH, solicitud(cuerpoDe(), { secreto: '' }));
    expect(!r.ok && r.estado).toBe(503);
  });
  it('aplica la fecha de corte', () => {
    const c = contratoCon((x) => { x.modos.push.activo = true; x.corte.fecha = '2026-10-05'; });
    const r = recibirPush(c, solicitud(cuerpoDe(8)));
    expect(r.ok && r.filas.length).toBe(4);
    expect(r.ok && r.anterioresAlCorte).toBe(4);
  });
  it('repara el mojibake del lote', () => {
    const cuerpo = JSON.stringify({ data: { items: [{ ...viajesCrudos(1)[0], operador: 'JosÃ© NÃºÃ±ez' }] } });
    const r = recibirPush(PUSH, solicitud(cuerpo));
    expect(r.ok && (r.filas[0] as { operadorNombre: string }).operadorNombre).toBe('José Núñez');
  });
  it('una fila mala del lote se rechaza con motivo y no tumba al resto', () => {
    const items = [...viajesCrudos(2), { Icident: 'IC-X', unidad: 'U-1' }];
    const r = recibirPush(PUSH, solicitud(JSON.stringify({ data: { items } })));
    expect(r.ok && r.filas.length).toBe(2);
    expect(r.ok && r.rechazadas.length).toBe(1);
  });
});
