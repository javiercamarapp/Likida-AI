import { describe, it, expect } from 'vitest';
import {
  CODIGOS_ERROR_CORREO, FRASE_ERROR_CORREO, motivoDeFalloCorreo, enmascararCorreoLog, camposLogEntrega,
  debeAlertarPull, debeAlertarRebotes, EVENTOS_LOG_LIQCORREO,
} from './errores_correo';
import { enmascararCorreo } from './entrega_correo';

const PROHIBIDO = /liquidacion_|correo_entrega|tenant|SELECT|INSERT|resend|\{|"message"|api[_ ]?key|re_[A-Za-z0-9]{6,}/i;

describe('mapa de errores del correo', () => {
  const casos: Array<[string, string | null, string | null, string]> = [
    ['sin configurar', 'correo no configurado', null, 'sin_configurar'],
    ['401 de Resend', 'correo no configurado (HTTP 401)', null, 'sin_configurar'],
    ['403', 'HTTP 403', null, 'sin_configurar'],
    ['4xx del destinatario', 'rechazado: HTTP 422', null, 'correo_invalido'],
    ['rechazo local', 'rechazado: Sin destinatarios válidos.', null, 'correo_invalido'],
    ['429', 'HTTP 429', null, 'reintentando'],
    ['5xx', 'HTTP 503 (agotó 5 intentos)', null, 'reintentando'],
    ['red', 'ambiguo: fetch failed', null, 'red'],
    ['red ENOTFOUND', 'ENOTFOUND api.proveedor', null, 'red'],
    ['rebotada', null, 'rebotada', 'rebotada'],
    ['rebotada en inglés', null, 'bounced', 'rebotada'],
    ['queja', null, 'queja', 'queja'],
    ['queja en inglés', 'x', 'complained', 'queja'],
    ['sin confirmar', null, 'sin_confirmar', 'sin_confirmar'],
    ['desconocido', 'boom raro', null, 'interno'],
  ];
  it.each(casos)('%s', (_n, err, prov, codigo) => {
    const r = motivoDeFalloCorreo(err, prov);
    expect(r?.codigo).toBe(codigo);
    expect(r?.texto).toBe(FRASE_ERROR_CORREO[codigo as keyof typeof FRASE_ERROR_CORREO]);
  });

  it('sin error ni estado => null', () => {
    expect(motivoDeFalloCorreo(null)).toBeNull();
    expect(motivoDeFalloCorreo('')).toBeNull();
    expect(motivoDeFalloCorreo(undefined, undefined)).toBeNull();
  });

  it('exhaustivo: cada código tiene frase llana, sin tablas ni cuerpo crudo, y es alcanzable', () => {
    const alcanzados = new Set(casos.map((c) => c[3]));
    for (const c of CODIGOS_ERROR_CORREO) {
      expect(FRASE_ERROR_CORREO[c].length).toBeGreaterThan(20);
      expect(FRASE_ERROR_CORREO[c]).not.toMatch(PROHIBIDO);
      expect(alcanzados.has(c)).toBe(true);
    }
    expect(Object.keys(FRASE_ERROR_CORREO).sort()).toEqual([...CODIGOS_ERROR_CORREO].sort());
  });

  it('el cuerpo crudo del proveedor jamás aparece en la frase', () => {
    const crudo = 'rechazado: HTTP 422 {"message":"The domain acme.test is not verified","name":"validation_error"} tabla liquidacion_correo_entrega';
    const r = motivoDeFalloCorreo(crudo)!;
    expect(r.texto).not.toMatch(/acme|validation_error|liquidacion_correo_entrega|\{/);
  });

  it('el estado del proveedor manda sobre el último error', () => {
    expect(motivoDeFalloCorreo('HTTP 503', 'rebotada')?.codigo).toBe('rebotada');
  });
});

describe('enmascarado y campos de log', () => {
  it('enmascara el correo y coincide con el de la entrega', () => {
    expect(enmascararCorreoLog('ana.prueba@ejemplo.test')).toBe('a***@ejemplo.test');
    expect(enmascararCorreoLog('sin-arroba')).toBe('***');
    expect(enmascararCorreoLog('@x.test')).toBe('***');
    for (const c of ['ana@ejemplo.test', 'z@z.test', 'raro']) expect(enmascararCorreoLog(c)).toBe(enmascararCorreo(c));
  });
  it('campos de log: correo enmascarado, código, sin importes ni crudo', () => {
    const c = camposLogEntrega({ id: 'e1', rol: 'operador', correo: 'ana.prueba@ejemplo.test', ultimoError: 'HTTP 429' });
    expect(c).toEqual({ entrega: 'e1', rol: 'operador', correo: 'a***@ejemplo.test', codigo: 'reintentando' });
    expect(JSON.stringify(c)).not.toContain('ana.prueba');
    expect(camposLogEntrega({ id: 'e2', rol: 'coordinador', correo: 'b@x.test' })).not.toHaveProperty('codigo');
  });
  it('nombres de evento estables', () => {
    expect([...EVENTOS_LOG_LIQCORREO]).toEqual([
      'liqcorreo.enviada', 'liqcorreo.fallida', 'liqcorreo.rebotada', 'liqpull.ok', 'liqpull.parcial', 'liqpull.fallo',
    ]);
  });
});

describe('reglas de alerta', () => {
  it('pull: alerta solo con 3 fallos seguidos', () => {
    expect(debeAlertarPull(['fallo', 'fallo'])).toBe(false);
    expect(debeAlertarPull(['fallo', 'fallo', 'fallo'])).toBe(true);
    expect(debeAlertarPull(['ok', 'fallo', 'fallo', 'fallo'])).toBe(true);
    expect(debeAlertarPull(['fallo', 'fallo', 'parcial'])).toBe(false);
    expect(debeAlertarPull(['fallo', 'ok', 'fallo', 'fallo'])).toBe(false);
    expect(debeAlertarPull([])).toBe(false);
    expect(debeAlertarPull(['fallo', 'fallo'], 2)).toBe(true);
    expect(debeAlertarPull(['fallo'], 0)).toBe(false);
  });
  it('rebotes: estrictamente mayor que el umbral configurable', () => {
    expect(debeAlertarRebotes(5, 5)).toBe(false);
    expect(debeAlertarRebotes(6, 5)).toBe(true);
    expect(debeAlertarRebotes(10, 0)).toBe(false);
    expect(debeAlertarRebotes(10, Number.NaN)).toBe(false);
  });
});
