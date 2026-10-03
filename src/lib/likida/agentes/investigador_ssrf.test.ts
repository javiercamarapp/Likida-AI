import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import dns, { type LookupAddress } from 'node:dns';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';

// ═══════════════════════════════════════════════════════════════════════════
// SSRF DEL INVESTIGADOR — DNS REBINDING (auditoría ola 1, #3).
//
// Antes: `hostPublico` resolvía y validaba, y `fetch` volvía a resolver por su
// cuenta. Un dominio con TTL 0 contestaba una IP pública al chequeo y
// 169.254.169.254 / 127.0.0.1 al socket. Ahora `bajarPagina` va por
// `httpsPublico`: el `lookup` que VALIDA es el que ENTREGA las IP al socket.
//
// Estas pruebas usan un servidor http real en loopback y un DNS sintético. El
// dial se desvía a loopback SOLO después de que el `lookup` productivo aprobó
// una IP pública (mismo método que https_publico_tls.test.ts), así que un corte
// por DNS no puede hacer pasar las pruebas de contenido.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/llm/openrouter', () => ({ generateStructured: vi.fn() }));
vi.mock('../interruptores', () => ({ estaApagado: async () => false }));

import { bajarPagina } from './investigador';

let server: http.Server;
let port = 0;
const peticiones: string[] = [];
let dnsPorHost: Record<string, string[] | 'flip'> = {};
let llamadasDns: Record<string, number> = {};
const realRequest = http.request;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    peticiones.push(req.url ?? '');
    switch (req.url) {
      case '/ok':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html>contacto@empresa.mx</html>');
        return;
      case '/grande':
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('a'.repeat(200_000));
        res.write('b'.repeat(200_000));
        res.write('c'.repeat(200_000));
        res.end();
        return;
      case '/pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('%PDF');
        return;
      case '/404':
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('no');
        return;
      case '/a-interna':
        res.writeHead(302, { location: 'http://interna.test:' + port + '/secreto' });
        res.end();
        return;
      case '/a-metadatos':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      case '/a-publica':
        res.writeHead(302, { location: '/ok' });
        res.end();
        return;
      case '/bucle':
        res.writeHead(302, { location: '/bucle' });
        res.end();
        return;
      default:
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('x');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;

  const dnsSintetico: LookupFunction = (hostname, options, callback) => {
    llamadasDns[hostname] = (llamadasDns[hostname] ?? 0) + 1;
    const regla = dnsPorHost[hostname];
    if (!regla) { callback(new Error('NXDOMAIN'), ''); return; }
    // 'flip': la 1.ª respuesta es pública y TODAS las siguientes son loopback —
    // el DNS rebinding con TTL 0.
    const ips = regla === 'flip' ? (llamadasDns[hostname] === 1 ? ['8.8.8.8'] : ['127.0.0.1']) : regla;
    const direcciones: LookupAddress[] = ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    queueMicrotask(() => {
      if (options.all) callback(null, direcciones);
      else callback(null, direcciones[0].address, direcciones[0].family);
    });
  };
  vi.spyOn(dns, 'lookup').mockImplementation(dnsSintetico as unknown as typeof dns.lookup);

  vi.spyOn(http, 'request').mockImplementation(((
    opciones: http.RequestOptions,
    callback?: (r: IncomingMessage) => void,
  ) => {
    const validado = opciones.lookup!;
    const dialLocal: LookupFunction = (host, dnsOpciones, hecho) => {
      // Se ejecuta el lookup PRODUCTIVO; solo si aprobó una IP pública se desvía
      // el dial al servidor local. Si lo rechazó, el error llega tal cual.
      validado(host, dnsOpciones, (error, direcciones, familia) => {
        if (error) { hecho(error, direcciones, familia); return; }
        const primera = Array.isArray(direcciones) ? direcciones[0].address : direcciones;
        if (primera !== '8.8.8.8') { hecho(new Error('el transporte no validó una IP pública'), ''); return; }
        if (dnsOpciones.all) hecho(null, [{ address: '127.0.0.1', family: 4 }]);
        else hecho(null, '127.0.0.1', 4);
      });
    };
    return realRequest({ ...opciones, lookup: dialLocal }, callback);
  }) as typeof http.request);
});

beforeEach(() => {
  peticiones.length = 0;
  llamadasDns = {};
  dnsPorHost = { 'sitio.test': ['8.8.8.8'], 'interna.test': ['10.0.0.5'] };
});

afterAll(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const u = (host: string, ruta: string) => `http://${host}:${port}${ruta}`;

describe('bajarPagina — el DNS se resuelve UNA vez y el socket usa esa IP validada', () => {
  it('una página pública normal se descarga (http permitido, validado en el socket)', async () => {
    const r = await bajarPagina(u('sitio.test', '/ok'));
    expect(r?.texto).toContain('contacto@empresa.mx');
    expect(peticiones).toEqual(['/ok']);
  });

  it('REBINDING con TTL 0 (pública y luego loopback): una sola resolución, así que no hay segunda respuesta que explotar', async () => {
    dnsPorHost['rebind.test'] = 'flip';
    const r = await bajarPagina(u('rebind.test', '/ok'));
    expect(r?.texto).toContain('contacto@empresa.mx');
    expect(llamadasDns['rebind.test']).toBe(1);
  });

  it('no usa fetch (que re-resolvería por su cuenta)', async () => {
    const espia = vi.spyOn(globalThis, 'fetch');
    await bajarPagina(u('sitio.test', '/ok'));
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it('DNS mixto (una pública y una de metadatos): se rechaza y NO se conecta', async () => {
    dnsPorHost['mixto.test'] = ['8.8.8.8', '169.254.169.254'];
    expect(await bajarPagina(u('mixto.test', '/ok'))).toBeNull();
    expect(peticiones).toEqual([]);
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['metadatos del cloud', '169.254.169.254'],
    ['RFC1918', '10.1.2.3'],
    ['CGNAT', '100.64.0.1'],
    ['IPv6 mapeada de metadatos', '::ffff:169.254.169.254'],
    ['NAT64 de loopback', '64:ff9b::7f00:1'],
  ])('un host que resuelve a %s no se visita', async (_n, ip) => {
    dnsPorHost['malo.test'] = [ip];
    expect(await bajarPagina(u('malo.test', '/ok'))).toBeNull();
    expect(peticiones).toEqual([]);
  });

  it('un DNS que no contesta es fail closed', async () => {
    expect(await bajarPagina(u('inexistente.test', '/ok'))).toBeNull();
  });

  it('IP literal privada o nombre reservado se rechazan sin llegar al DNS', async () => {
    expect(await bajarPagina('http://127.0.0.1:1/x')).toBeNull();
    expect(await bajarPagina('http://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(await bajarPagina('http://localhost:1/x')).toBeNull();
    expect(await bajarPagina('http://algo.internal/x')).toBeNull();
    expect(await bajarPagina('ftp://sitio.test/x')).toBeNull();
    expect(Object.keys(llamadasDns)).toEqual([]);
  });

  it('un redirect a un host interno se valida en el salto y no se sigue', async () => {
    expect(await bajarPagina(u('sitio.test', '/a-interna'))).toBeNull();
    expect(peticiones).toEqual(['/a-interna']); // /secreto jamás se pidió
  });

  it('un redirect a la IP de metadatos no se sigue', async () => {
    expect(await bajarPagina(u('sitio.test', '/a-metadatos'))).toBeNull();
    expect(peticiones).toEqual(['/a-metadatos']);
  });

  it('un redirect legítimo al mismo sitio sí se sigue', async () => {
    const r = await bajarPagina(u('sitio.test', '/a-publica'));
    expect(r?.texto).toContain('contacto@empresa.mx');
    expect(peticiones).toEqual(['/a-publica', '/ok']);
  });

  it('un bucle de redirects termina en el tope', async () => {
    expect(await bajarPagina(u('sitio.test', '/bucle'))).toBeNull();
    expect(peticiones.length).toBe(4); // 1 + MAX_REDIRECTS(3)
  });

  it('corta el cuerpo en 300 KB sin leer el resto', async () => {
    const r = await bajarPagina(u('sitio.test', '/grande'));
    expect(r?.texto.length).toBe(300_000);
    expect(r?.texto.startsWith('a'.repeat(200_000) + 'b')).toBe(true);
  });

  it('solo html/texto: un PDF o un 404 no se leen', async () => {
    expect(await bajarPagina(u('sitio.test', '/pdf'))).toBeNull();
    expect(await bajarPagina(u('sitio.test', '/404'))).toBeNull();
  });
});
