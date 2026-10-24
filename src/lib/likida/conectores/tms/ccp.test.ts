import { describe, expect, it, vi } from 'vitest';
import type { PeticionHttp, RespuestaHttp } from '../tipos';
import {
  almacenCcpEnMemoria, cargarCcp, consultarReque, huellaPlantilla,
  type EspecificacionCcp, type SesionEscrituraTms,
} from './ccp';
import { SesionTms } from './sesion';
import type { PeticionSesion, ResultadoSesion } from './sesion';

// Todo sintético. La ruta y los campos son INVENTADOS para la prueba: la especificación real no existe todavía.
const ESPEC: EspecificacionCcp = {
  carga: { ruta: '/api/ccp/cargar', campo_plantilla: 'plantilla' },
  consulta: { ruta: '/api/reque', parametro_ref: 'ref', campo_ligado: 'data.con_complemento' },
};
const PLANTILLA = { RemitenteDestinatario: [{ nombre: 'Sintetico A' }], Mercancias: [{ clave: 'X1', kg: 10 }] };
const ok = (estado: number, o: unknown = {}): ResultadoSesion =>
  ({ ok: true, r: { estado, cuerpo: JSON.stringify(o), encabezados: {} } });
const fallo = (motivo = 'caído'): ResultadoSesion => ({ ok: false, motivo, falla: 'proveedor' });

function sesionFalsa(respuestas: ((p: PeticionSesion) => ResultadoSesion)[] | ((p: PeticionSesion) => ResultadoSesion)) {
  const llamadas: PeticionSesion[] = [];
  const peticion = vi.fn(async (p: PeticionSesion): Promise<ResultadoSesion> => {
    llamadas.push(p);
    const f = Array.isArray(respuestas) ? respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)] : respuestas;
    return f(p);
  });
  const sesion: SesionEscrituraTms = { peticion };
  return { sesion, peticion, llamadas };
}
const sinEspera = async () => {};
const habilitada = () => true;

describe('cargarCcp', () => {
  it('ensayo (por omisión) devuelve el payload y NO llama a http', async () => {
    const http = vi.fn(async (_p: PeticionHttp): Promise<RespuestaHttp> => ({ estado: 200, cuerpo: '{}', encabezados: {} }));
    const sesion = new SesionTms({
      http, base: 'https://tms.ejemplo.test',
      login: { ruta: '/login', cuerpo: { u: '{usuario}' }, campo_token: 'token' },
      credenciales: { usuario: 'u', clave: 'c' },
    });
    const r = await cargarCcp(sesion, PLANTILLA, { especificacion: ESPEC, bandera: habilitada });
    expect(r.estado).toBe('ensayo');
    if (r.estado === 'ensayo') {
      expect(r.payload.ruta).toBe('/api/ccp/cargar');
      expect(r.payload.cuerpo).toEqual({ plantilla: PLANTILLA });
    }
    expect(http).toHaveBeenCalledTimes(0);
  });

  it('ensayo con bytes: el payload lleva base64', async () => {
    const { sesion, peticion } = sesionFalsa(() => ok(200));
    const r = await cargarCcp(sesion, new Uint8Array([1, 2, 3]), { especificacion: ESPEC });
    expect(r.estado).toBe('ensayo');
    if (r.estado === 'ensayo') expect(r.payload.cuerpo).toEqual({ plantilla: { base64: 'AQID' } });
    expect(peticion).not.toHaveBeenCalled();
  });

  it('real sin bandera → bandera_apagada con frase clara y cero red', async () => {
    const { sesion, peticion } = sesionFalsa(() => ok(200));
    const r = await cargarCcp(sesion, PLANTILLA, { especificacion: ESPEC, modo: 'real' });
    expect(r.estado).toBe('bandera_apagada');
    if (r.estado === 'bandera_apagada') expect(r.motivo).toContain('tms_escritura_habilitada');
    expect(peticion).not.toHaveBeenCalled();
  });

  it('real con bandera que devuelve false → apagada', async () => {
    const { sesion, peticion } = sesionFalsa(() => ok(200));
    const r = await cargarCcp(sesion, PLANTILLA, { especificacion: ESPEC, modo: 'real', bandera: async () => false });
    expect(r.estado).toBe('bandera_apagada');
    expect(peticion).not.toHaveBeenCalled();
  });

  it('con bandera sube una vez y la segunda llamada es no-op', async () => {
    const { sesion, peticion } = sesionFalsa(() => ok(201));
    const almacen = almacenCcpEnMemoria();
    const o = { especificacion: ESPEC, modo: 'real' as const, bandera: habilitada, almacen, esperar: sinEspera };
    const a = await cargarCcp(sesion, PLANTILLA, o);
    const b = await cargarCcp(sesion, PLANTILLA, o);
    expect(a.estado).toBe('subida');
    expect(b.estado).toBe('ya_subida');
    expect(peticion).toHaveBeenCalledTimes(1);
    expect(peticion.mock.calls[0][0].metodo).toBe('POST');
  });

  it('A37-S38-09: modo real sin almacén persistente inyectado → sin_almacen y cero red (no usa un Set por invocación)', async () => {
    const { sesion, peticion } = sesionFalsa(() => ok(201));
    const r = await cargarCcp(sesion, PLANTILLA, { especificacion: ESPEC, modo: 'real', bandera: habilitada, esperar: sinEspera });
    expect(r.estado).toBe('sin_almacen');
    expect(peticion).not.toHaveBeenCalled();
  });

  it('la huella no depende del orden de las llaves y distingue plantillas distintas', () => {
    expect(huellaPlantilla({ a: 1, b: 2 })).toBe(huellaPlantilla({ b: 2, a: 1 }));
    expect(huellaPlantilla({ a: 1 })).not.toBe(huellaPlantilla({ a: 2 }));
    expect(huellaPlantilla(new Uint8Array([1]))).not.toBe(huellaPlantilla(new Uint8Array([2])));
  });

  it('reque inexistente → pendiente, avisa UNA vez y no sube', async () => {
    const { sesion, llamadas } = sesionFalsa((p) => (p.ruta === '/api/reque' ? ok(404) : ok(201)));
    const alertar = vi.fn();
    const o = { especificacion: ESPEC, modo: 'real' as const, bandera: habilitada, almacen: almacenCcpEnMemoria(), alertar, refReque: 'RQ-1', esperar: sinEspera };
    const a = await cargarCcp(sesion, PLANTILLA, o);
    const b = await cargarCcp(sesion, PLANTILLA, o);
    expect(a.estado).toBe('reque_pendiente');
    expect(b.estado).toBe('reque_pendiente');
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(llamadas.every((p) => p.ruta === '/api/reque')).toBe(true);
  });

  it('reque existente → verifica y luego sube', async () => {
    const { sesion, llamadas } = sesionFalsa((p) => (p.ruta === '/api/reque' ? ok(200, { data: { con_complemento: false } }) : ok(201)));
    const r = await cargarCcp(sesion, PLANTILLA, {
      especificacion: ESPEC, modo: 'real', bandera: habilitada, almacen: almacenCcpEnMemoria(), refReque: 'RQ-2', esperar: sinEspera,
    });
    expect(r.estado).toBe('subida');
    expect(llamadas.map((p) => p.ruta)).toEqual(['/api/reque', '/api/ccp/cargar']);
  });

  it('3 fallos → 3 intentos y UNA sola alerta; una llamada posterior no alerta de nuevo', async () => {
    const { sesion, peticion } = sesionFalsa(() => fallo());
    const alertar = vi.fn();
    const o = { especificacion: ESPEC, modo: 'real' as const, bandera: habilitada, almacen: almacenCcpEnMemoria(), alertar, esperar: sinEspera };
    const a = await cargarCcp(sesion, PLANTILLA, o);
    expect(a).toMatchObject({ estado: 'fallo', intentos: 3, alertada: true });
    expect(peticion).toHaveBeenCalledTimes(3);
    const b = await cargarCcp(sesion, PLANTILLA, o);
    expect(b).toMatchObject({ estado: 'fallo', alertada: false });
    expect(alertar).toHaveBeenCalledTimes(1);
  });

  it('el tope de intentos es configurable', async () => {
    const { sesion, peticion } = sesionFalsa(() => ok(500));
    const r = await cargarCcp(sesion, PLANTILLA, {
      especificacion: ESPEC, modo: 'real', bandera: habilitada, almacen: almacenCcpEnMemoria(), intentos: 2, esperar: sinEspera,
    });
    expect(r).toMatchObject({ estado: 'fallo', intentos: 2 });
    expect(peticion).toHaveBeenCalledTimes(2);
  });

  it('un fallo seguido de éxito sube y no alerta', async () => {
    const { sesion } = sesionFalsa([() => fallo(), () => ok(201)]);
    const alertar = vi.fn();
    const r = await cargarCcp(sesion, PLANTILLA, { especificacion: ESPEC, modo: 'real', bandera: habilitada, almacen: almacenCcpEnMemoria(), alertar, esperar: sinEspera });
    expect(r).toMatchObject({ estado: 'subida', intentos: 2 });
    expect(alertar).not.toHaveBeenCalled();
  });

  it('credencial rechazada no se reintenta (no bloquear la cuenta)', async () => {
    const { sesion, peticion } = sesionFalsa(() => ({ ok: false, motivo: 'usuario o contraseña', falla: 'credencial' }));
    const r = await cargarCcp(sesion, PLANTILLA, { especificacion: ESPEC, modo: 'real', bandera: habilitada, almacen: almacenCcpEnMemoria(), esperar: sinEspera });
    expect(r).toMatchObject({ estado: 'fallo', intentos: 1 });
    expect(peticion).toHaveBeenCalledTimes(1);
  });

  it('el backoff entre intentos espera 1 s y 2 s', async () => {
    const { sesion } = sesionFalsa(() => fallo());
    const esperas: number[] = [];
    await cargarCcp(sesion, PLANTILLA, {
      especificacion: ESPEC, modo: 'real', bandera: habilitada, almacen: almacenCcpEnMemoria(), esperar: async (ms) => { esperas.push(ms); },
    });
    expect(esperas).toEqual([1_000, 2_000]);
  });

  it('sin especificación → no_especificado, en ensayo y en real, sin red', async () => {
    const { sesion, peticion } = sesionFalsa(() => ok(200));
    for (const modo of ['ensayo', 'real'] as const) {
      for (const especificacion of [undefined, null]) {
        const r = await cargarCcp(sesion, PLANTILLA, { modo, bandera: habilitada, especificacion });
        expect(r.estado).toBe('no_especificado');
      }
    }
    expect(peticion).not.toHaveBeenCalled();
  });
});

describe('consultarReque', () => {
  it('sin especificación → no_especificado sin red', async () => {
    const { sesion, peticion } = sesionFalsa(() => ok(200));
    expect((await consultarReque(sesion, 'RQ-1')).estado).toBe('no_especificado');
    expect(peticion).not.toHaveBeenCalled();
  });

  it('404 → pendiente (el reque aún no existe)', async () => {
    const { sesion } = sesionFalsa(() => ok(404));
    expect((await consultarReque(sesion, 'RQ-9', { especificacion: ESPEC })).estado).toBe('pendiente');
  });

  it('200 con el campo de ligado → existe y ligado; sin él → no ligado', async () => {
    const a = sesionFalsa(() => ok(200, { data: { con_complemento: true } }));
    expect(await consultarReque(a.sesion, 'RQ-1', { especificacion: ESPEC })).toEqual({ estado: 'existe', ligado: true });
    expect(a.llamadas[0].query).toEqual({ ref: 'RQ-1' });
    const b = sesionFalsa(() => ok(200, { data: {} }));
    expect(await consultarReque(b.sesion, 'RQ-1', { especificacion: ESPEC })).toEqual({ estado: 'existe', ligado: false });
  });

  it('error de red, 500 o cuerpo ilegible → error con frase propia', async () => {
    expect((await consultarReque(sesionFalsa(() => fallo('sin red')).sesion, 'R', { especificacion: ESPEC })).estado).toBe('error');
    expect((await consultarReque(sesionFalsa(() => ok(500)).sesion, 'R', { especificacion: ESPEC })).estado).toBe('error');
    const ilegible: ResultadoSesion = { ok: true, r: { estado: 200, cuerpo: '<html>', encabezados: {} } };
    expect((await consultarReque(sesionFalsa(() => ilegible).sesion, 'R', { especificacion: ESPEC })).estado).toBe('error');
  });

  it('una ruta de campo con __proto__ no se sigue', async () => {
    const espec = { ...ESPEC, consulta: { ...ESPEC.consulta, campo_ligado: '__proto__.x' } };
    const { sesion } = sesionFalsa(() => ok(200, {}));
    expect(await consultarReque(sesion, 'R', { especificacion: espec })).toEqual({ estado: 'existe', ligado: false });
  });
});
