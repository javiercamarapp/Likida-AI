import { describe, it, expect } from 'vitest';
import { aParametro, mensajeDeError, motivoDeIntercambio, motivoSinCode } from './motivo_login';

// El caso que motivó el módulo (19-ago-2026): un enlace de un solo uso ya
// consumido respondía «Algo falló. Intenta otra vez.» — y reintentar ese
// enlace es lo único garantizado a fallar. Estas pruebas fijan la traducción
// de las dos señales de fallo y que el texto del enlace caducado no vuelva a
// aconsejar el reintento.

describe('motivoSinCode: lo que Supabase pega al redirect sin code', () => {
  it('otp_expired (usado o caducado: para GoTrue son el mismo estado) → caducado', () => {
    expect(motivoSinCode('otp_expired')).toBe('caducado');
  });

  it('cualquier otro error, o ninguno, cae al genérico', () => {
    expect(motivoSinCode('server_error')).toBe('generico');
    expect(motivoSinCode(null)).toBe('generico');
  });
});

describe('motivoDeIntercambio: el canje falló con el code en la mano', () => {
  it('sin code_verifier (el enlace se abrió en otro navegador) → navegador', () => {
    // El code estructurado, de los SDK nuevos…
    expect(motivoDeIntercambio({ code: 'validation_failed' })).toBe('navegador');
    // …y el texto, que es lo único estable hacia atrás.
    expect(
      motivoDeIntercambio({ message: 'invalid request: both auth code and code verifier should be non-empty' }),
    ).toBe('navegador');
  });

  it('flujo consumido o vencido del lado de Supabase → caducado', () => {
    expect(motivoDeIntercambio({ code: 'flow_state_not_found' })).toBe('caducado');
    expect(motivoDeIntercambio({ code: 'flow_state_expired' })).toBe('caducado');
    expect(motivoDeIntercambio({ message: 'invalid flow state, no valid flow state found' })).toBe('caducado');
  });

  it('un fallo sin nombre conocido cae al genérico, nunca revienta', () => {
    expect(motivoDeIntercambio({})).toBe('generico');
    expect(motivoDeIntercambio({ code: 'otra_cosa', message: 'algo raro' })).toBe('generico');
  });
});

describe('el parámetro y el texto', () => {
  it('generico viaja como `1`: los redirects previos al módulo ya lo mandan así', () => {
    expect(aParametro('generico')).toBe('1');
    expect(aParametro('caducado')).toBe('caducado');
    expect(aParametro('navegador')).toBe('navegador');
  });

  it('el mensaje del enlace caducado NO aconseja reintentar: pide uno nuevo', () => {
    const texto = mensajeDeError('caducado');
    expect(texto).toMatch(/ya se usó|ya caducó/);
    expect(texto).not.toMatch(/intenta otra vez/i);
  });

  it('el del navegador manda a abrirlo donde se pidió el correo', () => {
    expect(mensajeDeError('navegador')).toMatch(/navegador/);
  });

  it('cualquier valor desconocido (incluido el `1` histórico) cae al genérico', () => {
    expect(mensajeDeError('1')).toBe('Algo falló. Intenta otra vez.');
    expect(mensajeDeError('lo-que-sea')).toBe('Algo falló. Intenta otra vez.');
  });
});
