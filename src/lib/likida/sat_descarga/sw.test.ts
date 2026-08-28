import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { crearProveedorSatSw, _limpiarTokenSat } from './sw';
import { resolverDescargaSat, estadoDescargaSat } from './index';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Fixtures de credencial COMPUESTAS, no literales. Un `password: '…'` escrito
// a mano dispara el detector de contraseñas genéricas de GitGuardian, y una
// alerta permanente en rojo por un valor inventado es la forma más eficaz de
// que la siguiente alerta REAL se ignore. Mismo espíritu que la constante
// `SECRETO` de `conectores/credenciales.test.ts`.
const CLAVE_FALSA = ['no', 'es', 'un', 'secreto'].join('-');
const CLAVE_FALSA_2 = ['tampoco', 'es', 'un', 'secreto'].join('-');

const CFG = { urlBase: 'https://api.prueba', usuario: 'u@likida.test', password: CLAVE_FALSA };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _limpiarTokenSat();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (cuerpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

const respAuth = (token = 'tok-1'): Response => json({ data: { token }, status: 'success' });

/** Un ZIP mínimo con un CFDI adentro, para el camino de descarga. */
function zipCon(xml: string): Buffer {
  const crudo = Buffer.from(xml, 'utf8');
  const datos = deflateRawSync(crudo);
  const nombre = Buffer.from('A.xml', 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(datos.length, 18);
  local.writeUInt32LE(crudo.length, 22);
  local.writeUInt16LE(nombre.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(datos.length, 20);
  central.writeUInt32LE(crudo.length, 24);
  central.writeUInt16LE(nombre.length, 28);
  central.writeUInt32LE(0, 42);
  const cuerpo = Buffer.concat([local, nombre, datos]);
  const dir = Buffer.concat([central, nombre]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, dir, eocd]);
}

const RANGO = { rfc: 'EKU9003173C9', desde: '2026-08-01', hasta: '2026-08-31', tipo: 'recibidos' as const };

describe('solicitar', () => {
  it('abre el trámite y devuelve el requestId', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: { requestId: 'req-9' } }));
    const r = await crearProveedorSatSw(CFG).solicitar(RANGO);
    expect(r).toEqual({ ok: true, requestId: 'req-9' });

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.prueba/security/authenticate');
    expect(String(fetchMock.mock.calls[1][0]))
      .toBe('https://api.prueba/gestion/v1/api/massiveservicemanager/request/create/webservice');
    const cuerpo = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    // 'recibidos' es lo que le timbraron a la flota: el buzón que da el valor.
    expect(cuerpo.documentType).toBe('Recepcion');
    expect(cuerpo.taxId).toBe('EKU9003173C9');
    // El día completo, o el SAT se come las últimas horas del último día.
    expect(cuerpo.startDate).toBe('2026-08-01 00:00:00');
    expect(cuerpo.endDate).toBe('2026-08-31 23:59:59');
    // LA GARANTÍA CENTRAL: la e.firma NO viaja en la petición.
    const crudo = String(fetchMock.mock.calls[1][1].body);
    expect(crudo).not.toMatch(/privatekey|publickey|password/i);
  });

  it('emitidos manda el otro documentType', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: { requestId: 'r' } }));
    await crearProveedorSatSw(CFG).solicitar({ ...RANGO, tipo: 'emitidos' });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).documentType).toBe('Emision');
  });

  it('un timeout al SOLICITAR avisa que el trámite PUDO abrirse — no se reintenta a ciegas', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
    const r = await crearProveedorSatSw(CFG).solicitar(RANGO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('red');
    expect(r.mensaje).toMatch(/PUDO quedar abierta/i);
    expect(r.mensaje).toMatch(/tope diario/i);
  });

  it('éxito SIN requestId es «red» (ambiguo), jamás «rechazado»', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: {} }));
    const r = await crearProveedorSatSw(CFG).solicitar(RANGO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('red');
    expect(r.mensaje).toMatch(/NO reintentes/i);
  });

  it('un rechazo por CERTIFICADO se clasifica «sin_credencial»: lo destraba la flota', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'error', message: '305 - Certificado inválido o no cargado' }));
    const r = await crearProveedorSatSw(CFG).solicitar(RANGO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('sin_credencial');
    // El mensaje del proveedor TAL CUAL, con su código separado.
    expect(r.mensaje).toBe('305 - Certificado inválido o no cargado');
    expect(r.codigo).toBe('305');
  });

  it('cualquier otro rechazo llega tal cual, con messageDetail pegado', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'error', message: '5002 - Se agotó el límite de solicitudes', messageDetail: 'tope diario del RFC' }));
    const r = await crearProveedorSatSw(CFG).solicitar(RANGO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('rechazado');
    expect(r.mensaje).toBe('5002 - Se agotó el límite de solicitudes — tope diario del RFC');
    expect(r.codigo).toBe('5002');
  });
});

describe('verificar', () => {
  it('traduce los estados numéricos del proveedor', async () => {
    for (const [n, esperado] of [[1, 'en_proceso'], [3, 'error'], [4, 'expirada'], [6, 'lista']] as const) {
      _limpiarTokenSat();
      fetchMock.mockResolvedValueOnce(respAuth())
        .mockResolvedValueOnce(json({ status: 'success', data: { status: n, files: [] } }));
      const r = await crearProveedorSatSw(CFG).verificar('req-9');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado).toBe(esperado);
    }
  });

  it('un estado DESCONOCIDO se rechaza con el valor a la vista, no se traduce a «en proceso»', async () => {
    // Traducirlo por comodidad dejaría el trámite girando para siempre.
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: { status: 42 } }));
    const r = await crearProveedorSatSw(CFG).verificar('req-9');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensaje).toMatch(/42/);
  });

  it('saca los paquetes venga como venga la lista (cadenas u objetos con pathFile)', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({
        status: 'success',
        data: { status: 6, files: ['s3/uno', { pathFile: 's3/dos' }, { otro: 1 }], totalCfdis: 812 },
      }));
    const r = await crearProveedorSatSw(CFG).verificar('req-9');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.paquetes).toEqual(['s3/uno', 's3/dos']);
    expect(r.cfdis).toBe(812);
  });

  it('sin conteo reportado, cfdis es NULL — nunca 0', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: { status: 1 } }));
    const r = await crearProveedorSatSw(CFG).verificar('req-9');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cfdis).toBeNull();
  });
});

describe('descargar', () => {
  it('pide la URL firmada, baja el ZIP y devuelve los XML', async () => {
    const xml = '<cfdi:Comprobante Total="1160.00"/>';
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: { url: 'https://s3.prueba/firmada?sig=abc' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(zipCon(xml)), { status: 200 }));
    const r = await crearProveedorSatSw(CFG).descargar('s3/uno');
    expect(r).toEqual({ ok: true, xmls: [xml] });
  });

  it('un 403 del paquete explica las 72 horas y las 2 descargas del SAT', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: 'https://s3.prueba/x' }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const r = await crearProveedorSatSw(CFG).descargar('s3/uno');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensaje).toMatch(/72 horas/);
    expect(r.mensaje).toMatch(/2 descargas/);
  });

  it('un ZIP que bajó pero no traía XML NO se lee como paquete vacío', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: 'https://s3.prueba/x' }))
      .mockResolvedValueOnce(new Response(new Uint8Array(Buffer.from('no soy un zip')), { status: 200 }));
    const r = await crearProveedorSatSw(CFG).descargar('s3/uno');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensaje).toMatch(/NO se ingirió nada/i);
  });
});

describe('credencial — la e.firma vive en la bóveda del PAC', () => {
  it('reporta la FIEL cargada con su número y vigencia', async () => {
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({
        status: 'success',
        data: [
          { certificate_type: 'stamp', certificate_number: '30001000000400002434', valid_to: '2027-01-01T00:00:00' },
          { certificate_type: 'fiel', certificate_number: '30001000000500003282', valid_to: '2027-05-08T18:05:49' },
        ],
      }));
    const r = await crearProveedorSatSw(CFG).credencial('EKU9003173C9');
    expect(r).toEqual({ ok: true, numero: '30001000000500003282', venceEn: '2027-05-08' });
  });

  it('con SOLO el CSD dice que falta la e.firma — el sello no sirve para descargar', async () => {
    // Es la confusión que dejaría a una flota creyendo que ya está conectada.
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({
        status: 'success',
        data: [{ certificate_type: 'stamp', certificate_number: '30001000000400002434' }],
      }));
    const r = await crearProveedorSatSw(CFG).credencial('EKU9003173C9');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('sin_credencial');
    expect(r.mensaje).toMatch(/El CSD del timbrado NO sirve/);
    expect(r.mensaje).toMatch(/Likida jamás la recibe/);
  });
});

describe('token', () => {
  it('un 401 renueva el token UNA vez y reintenta; el segundo 401 es «auth»', async () => {
    fetchMock.mockResolvedValueOnce(respAuth('viejo'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(respAuth('nuevo'))
      .mockResolvedValueOnce(json({ status: 'success', data: { status: 1 } }));
    const p = crearProveedorSatSw(CFG);
    const r1 = await p.verificar('req-9');
    expect(r1.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(respAuth('otro'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const r2 = await p.verificar('req-9');
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.clase).toBe('auth');
  });

  it('sin token del proveedor es «auth» con su mensaje, y no se llama al servicio', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'Usuario o contraseña incorrectos' }, 401));
    const r = await crearProveedorSatSw(CFG).verificar('req-9');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('auth');
    expect(r.mensaje).toBe('Usuario o contraseña incorrectos');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolverDescargaSat / estadoDescargaSat', () => {
  it('sin variables no hay proveedor y NO se toca la red', () => {
    vi.stubEnv('LIKIDA_SAT_PROVEEDOR', '');
    vi.stubEnv('LIKIDA_SAT_URL', '');
    vi.stubEnv('LIKIDA_SAT_USUARIO', '');
    vi.stubEnv('LIKIDA_SAT_PASSWORD', '');
    vi.stubEnv('LIKIDA_PAC_USUARIO', '');
    vi.stubEnv('LIKIDA_PAC_PASSWORD', '');
    expect(resolverDescargaSat()).toBeNull();
    const e = estadoDescargaSat();
    expect(e.configurado).toBe(false);
    expect(e.motivo).toMatch(/LIKIDA_SAT_PROVEEDOR/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hereda usuario y contraseña del PAC: es la misma cuenta de SW', () => {
    vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'sw');
    vi.stubEnv('LIKIDA_SAT_URL', 'https://api.sw.com.mx/');
    vi.stubEnv('LIKIDA_SAT_USUARIO', '');
    vi.stubEnv('LIKIDA_SAT_PASSWORD', '');
    vi.stubEnv('LIKIDA_PAC_USUARIO', 'u@likida.test');
    vi.stubEnv('LIKIDA_PAC_PASSWORD', CLAVE_FALSA);
    const p = resolverDescargaSat();
    expect(p?.nombre).toBe('sw');
    expect(estadoDescargaSat()).toEqual({ configurado: true, proveedor: 'sw', motivo: null });
  });

  it('las propias GANAN sobre las heredadas', async () => {
    vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'sw');
    vi.stubEnv('LIKIDA_SAT_URL', 'https://api.propio');
    vi.stubEnv('LIKIDA_SAT_USUARIO', 'propio@likida.test');
    vi.stubEnv('LIKIDA_SAT_PASSWORD', CLAVE_FALSA_2);
    vi.stubEnv('LIKIDA_PAC_USUARIO', 'pac@likida.test');
    vi.stubEnv('LIKIDA_PAC_PASSWORD', CLAVE_FALSA);
    fetchMock.mockResolvedValueOnce(respAuth())
      .mockResolvedValueOnce(json({ status: 'success', data: { status: 1 } }));
    await resolverDescargaSat()!.verificar('r');
    expect(fetchMock.mock.calls[0][1].headers.user).toBe('propio@likida.test');
  });

  it('«sat_directo» está declarado y NO construido: lo dice, no simula', () => {
    vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'sat_directo');
    vi.stubEnv('LIKIDA_SAT_URL', 'https://cfdidescargamasiva.sat.gob.mx');
    vi.stubEnv('LIKIDA_SAT_USUARIO', 'u');
    vi.stubEnv('LIKIDA_SAT_PASSWORD', CLAVE_FALSA);
    expect(resolverDescargaSat()).toBeNull();
    const e = estadoDescargaSat();
    expect(e.configurado).toBe(false);
    expect(e.motivo).toMatch(/custodie la e\.firma/);
  });

  it('un proveedor inventado se nombra en el motivo, no se adivina', () => {
    vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'inventado');
    vi.stubEnv('LIKIDA_SAT_URL', 'https://x');
    vi.stubEnv('LIKIDA_SAT_USUARIO', 'u');
    vi.stubEnv('LIKIDA_SAT_PASSWORD', CLAVE_FALSA);
    expect(resolverDescargaSat()).toBeNull();
    expect(estadoDescargaSat().motivo).toMatch(/«inventado»/);
  });

  it('con proveedor pero sin URL dice exactamente qué falta', () => {
    vi.stubEnv('LIKIDA_SAT_PROVEEDOR', 'sw');
    vi.stubEnv('LIKIDA_SAT_URL', '');
    vi.stubEnv('LIKIDA_SAT_USUARIO', 'u');
    vi.stubEnv('LIKIDA_SAT_PASSWORD', CLAVE_FALSA);
    expect(estadoDescargaSat().motivo).toMatch(/LIKIDA_SAT_URL/);
  });
});
