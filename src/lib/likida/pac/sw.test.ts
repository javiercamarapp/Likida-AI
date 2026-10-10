import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crearProveedorSw, _limpiarTokenSw } from './sw';
import { resolverPac } from './index';

// ═══════════════════════════════════════════════════════════════════════════
// La capa PAC (0226). Lo que estas pruebas fijan:
//   · el éxito mapea los campos del PAC tal cual (uuid, XML timbrado, fecha);
//   · el rechazo trae el mensaje del PAC SIN resumir y el código separado;
//   · el timeout del TIMBRE es clase 'red' — ambiguo, con la advertencia de
//     verificar antes de reintentar (jamás se trata como "no pasó nada");
//   · un 401 con token cacheado renueva UNA vez y reintenta; el segundo 401
//     ya es 'auth';
//   · sin variables de entorno NO hay proveedor — y por lo tanto ningún
//     camino que simule un timbre.
// ═══════════════════════════════════════════════════════════════════════════

const CFG = { urlBase: 'https://pac.prueba', usuario: 'demo', password: 'x' };

const respAuth = (token = 'tok-1') =>
  new Response(JSON.stringify({ status: 'success', data: { token } }), { status: 200 });

const respIssueOk = () => new Response(JSON.stringify({
  status: 'success',
  data: {
    uuid: 'fd53505e-d737-43ab-815c-8090edec3655',
    cfdi: '<?xml version="1.0"?><timbrado/>',
    fechaTimbrado: '2026-08-27T13:04:29',
    selloSAT: 'SELLO-SAT', noCertificadoSAT: '30001000000400002495',
  },
}), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _limpiarTokenSw();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('crearProveedorSw — timbrar', () => {
  it('éxito: autentica, timbra y devuelve los campos del PAC tal cual', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(respIssueOk());
    const r = await crearProveedorSw(CFG).timbrar('<cfdi/>');
    expect(r).toMatchObject({
      ok: true,
      uuid: 'fd53505e-d737-43ab-815c-8090edec3655',
      xmlTimbrado: '<?xml version="1.0"?><timbrado/>',
      fechaTimbrado: '2026-08-27T13:04:29',
      selloSat: 'SELLO-SAT',
    });
    // La autenticación fue al endpoint v2 con las credenciales en headers.
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://pac.prueba/v2/security/authenticate');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://pac.prueba/cfdi33/issue/v4');
  });

  it('rechazo: el mensaje del PAC viaja TAL CUAL y el código se separa', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(new Response(JSON.stringify({
      status: 'error',
      message: 'CFDI40147 - El campo LugarExpedicion no cumple con el patrón requerido.',
      messageDetail: 'Detalle del PAC.',
      data: null,
    }), { status: 400 }));
    const r = await crearProveedorSw(CFG).timbrar('<cfdi/>');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('rechazado');
    expect(r.codigo).toBe('CFDI40147');
    expect(r.mensaje).toContain('El campo LugarExpedicion no cumple');
    expect(r.mensaje).toContain('Detalle del PAC.');
  });

  // c6-2: `success` sin uuid/cfdi legibles es AMBIGUO, jamás un rechazo. El
  // PAC dijo que sí: tratarlo como "no pasó nada" invitaría al reintento y a
  // un SEGUNDO CFDI real que nadie va a cancelar.
  it('éxito SIN uuid ni XML legibles = clase red («verifica en el panel»), nunca rechazado', async () => {
    for (const data of [
      null,
      { uuid: 'fd53505e-d737-43ab-815c-8090edec3655' },        // sin cfdi
      { cfdi: '<timbrado/>' },                                  // sin uuid
      { uuid: 12345, cfdi: '<timbrado/>' },                     // uuid no-texto
    ]) {
      _limpiarTokenSw();
      fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'success', data }), { status: 200 }),
      );
      const r = await crearProveedorSw(CFG).timbrar('<cfdi/>');
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.clase).toBe('red');
      expect(r.clase).not.toBe('rechazado');
      expect(r.mensaje).toContain('NO reintentes');
      expect(r.mensaje).toContain('panel del PAC');
    }
  });

  it('timeout del timbre = clase red, con la advertencia de verificar antes de reintentar', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
    const r = await crearProveedorSw(CFG).timbrar('<cfdi/>');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('red');
    expect(r.mensaje).toContain('PUDO emitirse');
  });

  it('401 con token cacheado: renueva UNA vez y reintenta; el segundo 401 es auth', async () => {
    // Primer timbre exitoso deja token en caché…
    fetchMock.mockResolvedValueOnce(respAuth('tok-viejo')).mockResolvedValueOnce(respIssueOk());
    const pac = crearProveedorSw(CFG);
    await pac.timbrar('<cfdi/>');
    // …el siguiente issue rebota 401 → re-auth → issue OK.
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(respAuth('tok-nuevo'))
      .mockResolvedValueOnce(respIssueOk());
    const r = await pac.timbrar('<cfdi/>');
    expect(r.ok).toBe(true);
    // Y si tras renovar sigue el 401, la clase es auth (credenciales, no XML).
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(respAuth('tok-3'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const r2 = await pac.timbrar('<cfdi/>');
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.clase).toBe('auth');
  });
});

describe('resolverPac — sin configuración no hay PAC', () => {
  it('sin variables devuelve null y NO toca la red (jamás se simula)', () => {
    vi.stubEnv('LIKIDA_PAC_PROVEEDOR', '');
    vi.stubEnv('LIKIDA_PAC_URL', '');
    vi.stubEnv('LIKIDA_PAC_USUARIO', '');
    vi.stubEnv('LIKIDA_PAC_PASSWORD', '');
    expect(resolverPac()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('un proveedor desconocido tampoco resuelve — no se adivina', () => {
    vi.stubEnv('LIKIDA_PAC_PROVEEDOR', 'otro');
    vi.stubEnv('LIKIDA_PAC_URL', 'https://x');
    vi.stubEnv('LIKIDA_PAC_USUARIO', 'u');
    vi.stubEnv('LIKIDA_PAC_PASSWORD', 'p');
    expect(resolverPac()).toBeNull();
    vi.unstubAllEnvs();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// CANCELACIÓN (0541) — contrato contra fixtures de la documentación oficial de SW:
//   https://developers.sw.com.mx/knowledge-base/cancelacion-cfdi/
//   https://developers.sw.com.mx/knowledge-base/cancelacion-cfdi-con-estatus/
// NO se probó contra SW real: el CSD de la flota en la bóveda del PAC y el
// comportamiento con receptor que debe aceptar son bloqueos externos.
// ═══════════════════════════════════════════════════════════════════════════
import fx201 from './fixtures/sw_cancelacion_201.json';
import fx202 from './fixtures/sw_cancelacion_202_ya_cancelado.json';
import fx205 from './fixtures/sw_cancelacion_205_inexistente.json';
import fxErr from './fixtures/sw_cancelacion_error_certificado.json';

describe('SW · cancelar por UUID', () => {
  const UUID = 'fe4e71b0-8959-4fb9-8091-f5ac4fb0fef8';
  const SOL = { rfcEmisor: 'EKU9003173C9', uuid: UUID, motivo: '02' as const };
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

  it('201 → en_proceso (NO cancelado) y la URL es la documentada', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(json(fx201));
    const r = await crearProveedorSw(CFG).cancelar(SOL);
    expect(r).toMatchObject({ ok: true, estado: 'en_proceso', codigoSat: '201', yaEstaba: false });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`https://pac.prueba/cfdi33/cancel/EKU9003173C9/${UUID}/02`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
  });

  it('motivo 01 con folio de sustitución lo agrega a la ruta', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(json(fx201));
    await crearProveedorSw(CFG).cancelar({ ...SOL, motivo: '01', folioSustitucion: 'fe4e71b0-0000-0000-0000-f5ac4fb0fef8' });
    expect(fetchMock.mock.calls[1][0]).toBe(`https://pac.prueba/cfdi33/cancel/EKU9003173C9/${UUID}/01/fe4e71b0-0000-0000-0000-f5ac4fb0fef8`);
  });

  it('202 → cancelado y yaEstaba (repetir la petición es inocuo)', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(json(fx202));
    expect(await crearProveedorSw(CFG).cancelar(SOL)).toMatchObject({ ok: true, estado: 'cancelado', yaEstaba: true });
  });

  it('205 (UUID inexistente) NO es una cancelación: rechazado con el código', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(json(fx205));
    const r = await crearProveedorSw(CFG).cancelar(SOL);
    expect(r).toMatchObject({ ok: false, clase: 'rechazado', codigo: '205' });
    if (!r.ok) expect(r.mensaje).toContain('48 h');
  });

  it('el error 400 del PAC viaja tal cual, con su código separado', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(json(fxErr, 400));
    const r = await crearProveedorSw(CFG).cancelar(SOL);
    expect(r).toMatchObject({ ok: false, clase: 'rechazado', codigo: 'CACFDI33' });
    if (!r.ok) expect(r.mensaje).toContain('CA305 - Certificado Inválido.');
  });

  it('timeout = clase red con la advertencia (no se da por cancelado)', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockRejectedValueOnce(new Error('timeout'));
    const r = await crearProveedorSw(CFG).cancelar(SOL);
    expect(r).toMatchObject({ ok: false, clase: 'red' });
    if (!r.ok) expect(r.mensaje).toContain('sigue vigente');
  });

  it('un 401 con token cacheado renueva UNA vez; el segundo es auth', async () => {
    fetchMock.mockResolvedValueOnce(respAuth('viejo')).mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(respAuth('nuevo')).mockResolvedValueOnce(json({}, 401));
    const r = await crearProveedorSw(CFG).cancelar(SOL);
    expect(r).toMatchObject({ ok: false, clase: 'auth' });
  });

  it('valida localmente: motivo fuera del catálogo, 01 sin folio y folio con motivo ≠ 01 NO llaman al PAC', async () => {
    const pac = crearProveedorSw(CFG);
    expect(await pac.cancelar({ ...SOL, motivo: '09' as never })).toMatchObject({ ok: false, clase: 'rechazado' });
    expect(await pac.cancelar({ ...SOL, motivo: '01' })).toMatchObject({ ok: false, clase: 'rechazado' });
    expect(await pac.cancelar({ ...SOL, folioSustitucion: 'x' })).toMatchObject({ ok: false, clase: 'rechazado' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cuerpo ilegible = red (verifica antes de dar por cancelado)', async () => {
    fetchMock.mockResolvedValueOnce(respAuth()).mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));
    expect(await crearProveedorSw(CFG).cancelar(SOL)).toMatchObject({ ok: false, clase: 'red' });
  });
});
