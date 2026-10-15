import { describe, expect, it } from 'vitest';
import type { Http, PeticionHttp, RespuestaHttp } from '../tipos';
import { crearServidorTmsFalso, type ServidorTmsFalso } from './falso/servidor';
import { SesionTms, type ConfigLoginTms } from './sesion';

// Todo sintético. Relojes inyectados: ninguna prueba duerme de verdad.
const BASE = 'https://tms.ejemplo.test';
const LOGIN: ConfigLoginTms = { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' };
const CRED = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };

/** Adapta el servidor falso (forma ruta/status) al contrato `Http` del repo (url/estado). */
function adaptar(s: ServidorTmsFalso): Http {
  return async (p: PeticionHttp): Promise<RespuestaHttp> => {
    const u = new URL(p.url);
    const r = await s.http({
      metodo: p.metodo, ruta: u.pathname, query: Object.fromEntries(u.searchParams),
      headers: p.encabezados, cuerpo: p.cuerpo ? JSON.parse(p.cuerpo) : undefined,
    });
    return { estado: r.status, encabezados: r.headers, cuerpo: typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo) };
  };
}

function reloj() {
  const dormidas: number[] = [];
  let t = 1_000_000;
  return { dormidas, op: { ahora: () => t, dormir: async (ms: number) => { dormidas.push(ms); t += ms; } } };
}

const sesionDe = (http: Http, r = reloj(), extra: Partial<ConstructorParameters<typeof SesionTms>[0]> = {}) =>
  new SesionTms({ http, base: BASE, login: LOGIN, credenciales: CRED, reloj: r.op, ...extra });

const json = (estado: number, o: unknown, encabezados: Record<string, string> = {}): RespuestaHttp =>
  ({ estado, cuerpo: JSON.stringify(o), encabezados });

describe('SesionTms', () => {
  it('login OK → petición OK, y el token se reutiliza sin volver a entrar', async () => {
    const s = crearServidorTmsFalso();
    const ses = sesionDe(adaptar(s));
    const a = await ses.peticion({ ruta: '/api/viajes' });
    const b = await ses.peticion({ ruta: '/api/peajes', query: { pagina: 1 } });
    expect(a.ok && a.r.estado).toBe(200);
    expect(b.ok && b.r.estado).toBe(200);
    expect(s.logins).toBe(1);
  });

  it('token vencido a mitad de paginación → UN re-login y continúa', async () => {
    let ahora = 0;
    const s = crearServidorTmsFalso({ reloj: () => ahora, vigenciaTokenMs: 100, tamPaginaDefecto: 2 });
    const ses = sesionDe(adaptar(s));
    const p1 = await ses.peticion({ ruta: '/api/viajes', query: { pagina: 1 } });
    expect(p1.ok && p1.r.estado).toBe(200);
    ahora = 500; // el token murió entre páginas
    const p2 = await ses.peticion({ ruta: '/api/viajes', query: { pagina: 2 } });
    expect(p2.ok && p2.r.estado).toBe(200);
    expect(s.logins).toBe(2);
  });

  it('dos peticiones simultáneas con 401 provocan UN solo login', async () => {
    let ahora = 0;
    const s = crearServidorTmsFalso({ reloj: () => ahora, vigenciaTokenMs: 100 });
    const ses = sesionDe(adaptar(s));
    await ses.peticion({ ruta: '/api/viajes' });
    expect(s.logins).toBe(1);
    ahora = 500;
    const [a, b, c] = await Promise.all([
      ses.peticion({ ruta: '/api/viajes' }), ses.peticion({ ruta: '/api/peajes' }), ses.peticion({ ruta: '/api/liquidaciones' }),
    ]);
    for (const r of [a, b, c]) expect(r.ok && r.r.estado).toBe(200);
    expect(s.logins).toBe(2);
  });

  it('el primer login también es single-flight', async () => {
    const s = crearServidorTmsFalso();
    const ses = sesionDe(adaptar(s));
    await Promise.all([ses.peticion({ ruta: '/api/viajes' }), ses.peticion({ ruta: '/api/peajes' })]);
    expect(s.logins).toBe(1);
  });

  it('un segundo 401 tras renovar → falla credencial y NO sigue intentando', async () => {
    let logins = 0; let datos = 0;
    const http: Http = async (p) => {
      if (p.url.endsWith('/api/login')) { logins++; return json(200, { token: `t-${logins}` }); }
      datos++; return json(401, { error: 'no' });
    };
    const ses = sesionDe(http);
    const r = await ses.peticion({ ruta: '/api/viajes' });
    expect(r).toMatchObject({ ok: false, falla: 'credencial' });
    expect(logins).toBe(2);
    expect(datos).toBe(2);
  });

  it('credenciales malas en el login → credencial, sin reintentos', async () => {
    const s = crearServidorTmsFalso();
    const ses = new SesionTms({ http: adaptar(s), base: BASE, login: LOGIN, credenciales: { usuario: 'x', clave: 'y' }, reloj: reloj().op });
    const r = await ses.peticion({ ruta: '/api/viajes' });
    expect(r).toMatchObject({ ok: false, falla: 'credencial' });
    expect(s.solicitudesDatos).toBe(0);
    expect(s.logins).toBe(0);
  });

  it('429 con Retry-After: 2 duerme 2 s con el reloj falso y luego responde', async () => {
    const rl = reloj();
    let n = 0;
    const http: Http = async (p) => {
      if (p.url.endsWith('/api/login')) return json(200, { token: 'tok' });
      n++;
      return n === 1 ? json(429, {}, { 'retry-after': '2' }) : json(200, { ok: true });
    };
    const r = await sesionDe(http, rl).peticion({ ruta: '/api/viajes' });
    expect(r.ok && r.r.estado).toBe(200);
    expect(rl.dormidas).toEqual([2_000]);
  });

  it('503 persistente → falla proveedor con backlog, tras backoff exponencial', async () => {
    const rl = reloj();
    const s = crearServidorTmsFalso({ fallas: { cincoxxCada: 1 } });
    const r = await sesionDe(adaptar(s), rl).peticion({ ruta: '/api/viajes' });
    expect(r).toMatchObject({ ok: false, falla: 'proveedor', backlog: true });
    expect(s.solicitudesDatos).toBe(4); // 1 + 3 reintentos
    expect(rl.dormidas).toEqual([1_000, 2_000, 4_000]);
  });

  it('no duerme más allá del presupuesto de la corrida', async () => {
    const rl = reloj();
    const http: Http = async (p) => (p.url.endsWith('/api/login') ? json(200, { token: 'tok' }) : json(429, {}, { 'retry-after': '30' }));
    const ses = sesionDe(http, rl, { reloj: { ...rl.op, venceEn: rl.op.ahora() + 5_000 } });
    const r = await ses.peticion({ ruta: '/api/viajes' });
    expect(r).toMatchObject({ ok: false, falla: 'proveedor', backlog: true });
    expect(rl.dormidas).toEqual([]);
  });

  it('presupuesto ya vencido: ni una petición, backlog sin culpar al proveedor', async () => {
    const rl = reloj();
    let llamadas = 0;
    const http: Http = async () => { llamadas++; return json(200, {}); };
    const ses = sesionDe(http, rl, { reloj: { ...rl.op, venceEn: rl.op.ahora() } });
    const r = await ses.peticion({ ruta: '/api/viajes' });
    expect(r).toMatchObject({ ok: false, backlog: true });
    expect(r.ok === false && r.falla).toBeUndefined();
    expect(llamadas).toBe(0);
  });

  it('el motivo de error no contiene el token ni la contraseña (excepciones y cuerpos del proveedor)', async () => {
    const TOKEN = 'tok-secreto-ZZZ';
    const llamadasEx: Http = async (p) => {
      if (p.url.endsWith('/api/login')) return json(200, { token: TOKEN });
      throw new Error(`fallo de red con Authorization: Bearer ${TOKEN} y clave ${CRED.clave} de ${CRED.usuario}`);
    };
    const r1 = await sesionDe(llamadasEx).peticion({ ruta: '/api/viajes' });
    expect(r1.ok).toBe(false);
    const t1 = JSON.stringify(r1);
    for (const secreto of [TOKEN, CRED.clave, CRED.usuario]) expect(t1).not.toContain(secreto);

    const cuerpoEco: Http = async (p) => (p.url.endsWith('/api/login')
      ? json(200, { token: TOKEN })
      : json(500, { error: `token ${TOKEN} clave ${CRED.clave}` }));
    const r2 = await sesionDe(cuerpoEco).peticion({ ruta: '/api/viajes' });
    expect(r2.ok).toBe(false);
    const t2 = JSON.stringify(r2);
    for (const secreto of [TOKEN, CRED.clave]) expect(t2).not.toContain(secreto);
  });

  it('el token no se serializa ni sale al imprimir la sesión', async () => {
    const s = crearServidorTmsFalso();
    const ses = sesionDe(adaptar(s));
    await ses.peticion({ ruta: '/api/viajes' });
    const txt = JSON.stringify(ses) + JSON.stringify({ ...ses });
    expect(txt).not.toContain('tok-sintetico');
    expect(txt).not.toContain(CRED.clave);
  });

  it('transporte por defecto (httpsPublico): host privado, localhost o http se rechazan sin salir a la red', async () => {
    for (const base of ['https://10.0.0.5', 'https://localhost', 'https://192.168.1.10:8443', 'http://tms.ejemplo.test']) {
      const ses = new SesionTms({ base, login: LOGIN, credenciales: CRED, reloj: reloj().op });
      const r = await ses.peticion({ ruta: '/api/viajes' });
      expect(r.ok, base).toBe(false);
      expect(r.ok === false && r.falla, base).toBe('proveedor');
    }
  });

  it('login que contesta 200 sin el token esperado → formato', async () => {
    const http: Http = async () => ({ estado: 200, cuerpo: '<html>Iniciar sesión</html>', encabezados: {} });
    const r = await sesionDe(http).peticion({ ruta: '/api/viajes' });
    expect(r).toMatchObject({ ok: false, falla: 'formato' });
  });

  it('login parametrizable: token anidado, encabezado propio sin prefijo y cuerpo con otros nombres', async () => {
    let visto: PeticionHttp | undefined; let cuerpoLogin: unknown;
    const http: Http = async (p) => {
      if (p.url.endsWith('/auth/entrar')) { cuerpoLogin = JSON.parse(p.cuerpo ?? '{}'); return json(200, { data: { jwt: 'abc123' } }); }
      visto = p; return json(200, {});
    };
    const ses = new SesionTms({
      http, base: `${BASE}/`, credenciales: CRED, reloj: reloj().op,
      login: { ruta: '/auth/entrar', cuerpo: { email: '{usuario}', password: '{clave}', tipo: 'api' }, campo_token: 'data.jwt', encabezado: 'X-Token' },
    });
    const r = await ses.peticion({ ruta: '/v1/viajes', query: { desde: '2026-01-01', pagina: 2, omitido: undefined } });
    expect(r.ok).toBe(true);
    expect(cuerpoLogin).toEqual({ email: CRED.usuario, password: CRED.clave, tipo: 'api' });
    expect(visto?.url).toBe(`${BASE}/v1/viajes?desde=2026-01-01&pagina=2`);
    expect(visto?.encabezados?.['X-Token']).toBe('abc123');
    expect(visto?.encabezados?.Authorization).toBeUndefined();
  });

  it('API que con token vencido responde 200 con la página de login: detectaVencido dispara el re-login y, si persiste, credencial', async () => {
    const s = crearServidorTmsFalso({ fallas: { htmlLogin: true } });
    const ses = sesionDe(adaptar(s), reloj(), { detectaVencido: (r) => r.cuerpo.startsWith('<!doctype html>') });
    const r = await ses.peticion({ ruta: '/api/viajes' });
    expect(r).toMatchObject({ ok: false, falla: 'credencial' });
    expect(s.logins).toBe(2);
  });
});
