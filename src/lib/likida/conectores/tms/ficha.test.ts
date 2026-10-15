import { describe, it, expect } from 'vitest';
import { TMS_API_LECTURA } from '../erp';
import { CONECTORES, resumenHonesto } from '../registro';
import { esSecreto, veredictoDe, type Http, type PeticionHttp, type RespuestaHttp, type ValoresCredencial } from '../tipos';
import {
  FRASE_403_IP, FRASE_DNS, FRASE_PAGINA_DE_ACCESO, FRASE_RECHAZO, FRASE_TIEMPO, clasificarErrorDeRed, probarTmsApiLectura,
} from './ficha';

// Servidor falso mínimo en línea (Http de tipos.ts). Todo sintético.
const CLAVE = 'clave-sintetica-xyz';
const USUARIO = 'cuenta-servicio-sintetica';
const TOKEN = 'token-sintetico-abc123';
const V: ValoresCredencial = { base_url: 'https://api.ejemplo.test', usuario: USUARIO, clave: CLAVE };

const json = (estado: number, o: unknown): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o), encabezados: { 'content-type': 'application/json' } });
const html = (estado = 200): RespuestaHttp => ({ estado, cuerpo: '<!doctype html><html><body><form>Iniciar sesión</form></body></html>', encabezados: { 'content-type': 'text/html' } });

function servidor(opts: {
  login?: RespuestaHttp | Error;
  lectura?: RespuestaHttp | Error;
} = {}): { http: Http; llamadas: PeticionHttp[] } {
  const llamadas: PeticionHttp[] = [];
  const http: Http = async (p) => {
    llamadas.push(p);
    const esLogin = p.metodo === 'POST';
    const r = esLogin ? (opts.login ?? json(200, { token: TOKEN })) : (opts.lectura ?? json(200, { filas: [{ id: 1 }] }));
    if (r instanceof Error) throw r;
    return r;
  };
  return { http, llamadas };
}

describe('ficha tms_api_lectura', () => {
  it('queda registrada, solo lectura, requiere_piloto y sin fuente inventada', () => {
    expect(CONECTORES.find((c) => c.id === 'tms_api_lectura')).toBe(TMS_API_LECTURA);
    expect(TMS_API_LECTURA.formaDeConectar).toBe('requiere_piloto');
    expect(TMS_API_LECTURA.fuente).toBeNull();
    expect(TMS_API_LECTURA.claveAlmacen).toBeNull();
    expect([...TMS_API_LECTURA.capacidades].sort()).toEqual(['leer_movimientos', 'leer_viajes']);
    expect(TMS_API_LECTURA.capacidades.some((k) => k.startsWith('escribir_') || k === 'emitir_factura')).toBe(false);
    expect(CONECTORES.find((c) => c.id === 'tms_generico')).toBeDefined();
    expect(resumenHonesto()).toMatch(/Ninguna conexión está verificada contra una instancia real/);
  });

  it('pide base_url, usuario, clave (secreto), ruta_login y ambiente; la clave es el único secreto', () => {
    const campos = TMS_API_LECTURA.credenciales;
    expect(campos.map((c) => c.clave)).toEqual(['base_url', 'usuario', 'clave', 'ruta_login', 'ambiente']);
    expect(campos.filter(esSecreto).map((c) => c.clave)).toEqual(['clave']);
    expect(campos.find((c) => c.clave === 'ruta_login')!.requerida).toBe(false);
    expect(campos.find((c) => c.clave === 'usuario')!.ayuda).toMatch(/cuenta de servicio/i);
  });

  it('éxito: login + un solo GET de bajo costo → sirve', async () => {
    const s = servidor();
    const r = await probarTmsApiLectura(V, s.http);
    expect(r.ok).toBe(true);
    expect(veredictoDe(r)).toBe('sirve');
    expect(r.verificadoContra).toContain('tam=1');
    expect(s.llamadas.map((l) => l.metodo)).toEqual(['POST', 'GET']);
    expect(s.llamadas[1]!.encabezados?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(r.detalle).not.toContain(TOKEN);
  });

  it('usa ruta_login cuando se da', async () => {
    const s = servidor();
    await probarTmsApiLectura({ ...V, ruta_login: 'acceso/entrar' }, s.http);
    expect(s.llamadas[0]!.url).toBe('https://api.ejemplo.test/acceso/entrar');
  });

  it('401 en el login → no_sirve', async () => {
    const r = await probarTmsApiLectura(V, servidor({ login: json(401, { error: 'x' }) }).http);
    expect(r.ok).toBe(false);
    expect(veredictoDe(r)).toBe('no_sirve');
  });

  it('403 de firewall en el login → no_sirve, y sugiere revisar bloqueo de IP', async () => {
    const r = await probarTmsApiLectura(V, servidor({ login: json(403, {}) }).http);
    expect(veredictoDe(r)).toBe('no_sirve');
    expect(r.detalle).toMatch(/firewall|IP/i);
  });

  it('401/403 en la lectura con login bueno → no_sirve', async () => {
    expect(veredictoDe(await probarTmsApiLectura(V, servidor({ lectura: json(401, {}) }).http))).toBe('no_sirve');
    expect(veredictoDe(await probarTmsApiLectura(V, servidor({ lectura: json(403, {}) }).http))).toBe('no_sirve');
  });

  it('timeout / DNS → no_se_sabe, sin culpar a la credencial', async () => {
    const r = await probarTmsApiLectura(V, servidor({ login: new Error('timeout de 15000 ms') }).http);
    expect(r.ok).toBe(false);
    expect(veredictoDe(r)).toBe('no_se_sabe');
    expect(r.detalle).toMatch(/NO significa que la credencial sea mala/);
    const r2 = await probarTmsApiLectura(V, servidor({ lectura: new Error('getaddrinfo ENOTFOUND') }).http);
    expect(veredictoDe(r2)).toBe('no_se_sabe');
  });

  it('5xx → no_se_sabe', async () => {
    expect(veredictoDe(await probarTmsApiLectura(V, servidor({ login: json(503, {}) }).http))).toBe('no_se_sabe');
    expect(veredictoDe(await probarTmsApiLectura(V, servidor({ lectura: json(500, {}) }).http))).toBe('no_se_sabe');
  });

  it('200 con HTML de login → no_se_sabe con la frase «parece una página de acceso, no la API»', async () => {
    const enLogin = await probarTmsApiLectura(V, servidor({ login: html() }).http);
    expect(enLogin.ok).toBe(false);
    expect(veredictoDe(enLogin)).toBe('no_se_sabe');
    expect(enLogin.detalle).toContain(FRASE_PAGINA_DE_ACCESO);
    const enLectura = await probarTmsApiLectura(V, servidor({ lectura: html() }).http);
    expect(veredictoDe(enLectura)).toBe('no_se_sabe');
    expect(enLectura.detalle).toContain('parece una página de acceso, no la API');
  });

  it('login 200 sin token → no_se_sabe y no lee nada', async () => {
    const s = servidor({ login: json(200, { ok: true }) });
    const r = await probarTmsApiLectura(V, s.http);
    expect(veredictoDe(r)).toBe('no_se_sabe');
    expect(s.llamadas).toHaveLength(1);
  });

  it('campos faltantes: no llama a nadie y lista los rótulos', async () => {
    const s = servidor();
    const r = await probarTmsApiLectura({ usuario: USUARIO }, s.http);
    expect(r.ok).toBe(false);
    expect(r.verificadoContra).toBeNull();
    expect(r.falta).toEqual(['Dirección de la API de tu sistema de transporte', 'Contraseña de la cuenta de servicio']);
    expect(s.llamadas).toHaveLength(0);
  });

  it('URL no https o inválida → no llama a nadie', async () => {
    for (const base_url of ['http://api.ejemplo.test', 'no es url']) {
      const s = servidor();
      const r = await probarTmsApiLectura({ ...V, base_url }, s.http);
      expect(r.ok).toBe(false);
      expect(r.verificadoContra).toBeNull();
      expect(s.llamadas).toHaveLength(0);
    }
  });

  it('redirect 302 no se sigue: no_se_sabe y no hay segunda petición', async () => {
    const s = servidor({ login: { estado: 302, cuerpo: '', encabezados: { location: 'https://otro.test/login' } } });
    const r = await probarTmsApiLectura(V, s.http);
    expect(veredictoDe(r)).toBe('no_se_sabe');
    expect(s.llamadas).toHaveLength(1);
    const s2 = servidor({ lectura: { estado: 302, cuerpo: '' } });
    expect(veredictoDe(await probarTmsApiLectura(V, s2.http))).toBe('no_se_sabe');
    expect(s2.llamadas).toHaveLength(2);
  });

  it('el detalle jamás contiene la clave, el usuario ni el token, ni en excepciones', async () => {
    const casos = [
      servidor(),
      servidor({ login: json(401, {}) }),
      servidor({ login: new Error(`fallo con ${CLAVE} y ${USUARIO}`) }),
      servidor({ lectura: new Error(`rechazado ${TOKEN} para ${USUARIO}`) }),
      servidor({ lectura: json(403, {}) }),
      servidor({ lectura: html() }),
    ];
    for (const s of casos) {
      const r = await probarTmsApiLectura(V, s.http);
      for (const secreto of [CLAVE, USUARIO, TOKEN]) expect(JSON.stringify(r), secreto).not.toContain(secreto);
    }
  });

  it('el probar() de la ficha es el mismo flujo', async () => {
    const r = await TMS_API_LECTURA.probar(V, servidor().http);
    expect(veredictoDe(r)).toBe('sirve');
  });
});

describe('conectividad: diagnóstico en frases llanas (T-TMS-14)', () => {
  const codigo = (code: string, msg = code): Error => Object.assign(new Error(msg), { code });

  it.each([
    ['ENOTFOUND', codigo('ENOTFOUND', 'getaddrinfo ENOTFOUND api.ejemplo.test'), FRASE_DNS],
    ['ETIMEDOUT', codigo('ETIMEDOUT', 'connect ETIMEDOUT 203.0.113.9:443'), FRASE_TIEMPO],
    ['ECONNREFUSED', codigo('ECONNREFUSED', 'connect ECONNREFUSED 203.0.113.9:443'), FRASE_RECHAZO],
  ])('login que lanza %s → frase correcta y no_se_sabe', async (_n, err, frase) => {
    const r = await probarTmsApiLectura(V, servidor({ login: err }).http);
    expect(r.ok).toBe(false);
    expect(veredictoDe(r)).toBe('no_se_sabe');
    expect(r.detalle).toContain(frase);
    expect(r.detalle).toMatch(/NO significa que la credencial sea mala/);
  });

  it('el código viene en la causa (fetch de undici): se reconoce igual', async () => {
    const err = new TypeError('fetch failed', { cause: codigo('UND_ERR_CONNECT_TIMEOUT') });
    expect(clasificarErrorDeRed(err)).toBe('tiempo');
    const r = await probarTmsApiLectura(V, servidor({ login: err }).http);
    expect(r.detalle).toContain(FRASE_TIEMPO);
  });

  it('error en la lectura (login bueno) también da la frase llana y no_se_sabe', async () => {
    const r = await probarTmsApiLectura(V, servidor({ lectura: codigo('ETIMEDOUT') }).http);
    expect(veredictoDe(r)).toBe('no_se_sabe');
    expect(r.detalle).toContain(FRASE_TIEMPO);
  });

  it('403 en login y en lectura → dice «respondió 403 (probable lista de IP permitidas)» y no_sirve', async () => {
    const a = await probarTmsApiLectura(V, servidor({ login: json(403, {}) }).http);
    const b = await probarTmsApiLectura(V, servidor({ lectura: json(403, {}) }).http);
    for (const r of [a, b]) {
      expect(veredictoDe(r)).toBe('no_sirve');
      expect(r.detalle).toContain(FRASE_403_IP);
    }
  });

  it('un error desconocido conserva su texto y no se clasifica', async () => {
    expect(clasificarErrorDeRed(new Error('algo raro'))).toBeNull();
    const r = await probarTmsApiLectura(V, servidor({ login: new Error('algo raro') }).http);
    expect(r.detalle).toContain('algo raro');
    expect(veredictoDe(r)).toBe('no_se_sabe');
  });

  it('las frases de red no filtran clave, usuario ni token', async () => {
    const r = await probarTmsApiLectura(V, servidor({ login: codigo('ENOTFOUND', `getaddrinfo ENOTFOUND ${CLAVE}`) }).http);
    expect(r.detalle).not.toContain(CLAVE);
  });
});
