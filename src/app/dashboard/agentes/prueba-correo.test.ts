import { describe, it, expect } from 'vitest';
import {
  ofuscarCorreo, reclamarTurnoDePrueba, acuseDeEnvio, INTERVALO_PRUEBA_MS,
} from './prueba-correo';

// La action de «Mándate una prueba» es un closure de servidor y no se puede
// importar desde aquí; lo que decide vive en `prueba-correo.ts` y esto es su
// prueba. El gateo de sesión de la action es `puedeConfigurarAvisos`, que ya
// tiene la suya en el motor.

describe('ofuscarCorreo — el acuse no deja el correo completo en pantalla', () => {
  it('conserva la primera letra y el dominio, y tapa el resto', () => {
    expect(ofuscarCorreo('javier@transportes.mx')).toBe('j***@transportes.mx');
  });

  it('algo que no parece correo no se enseña a medias: se tapa entero', () => {
    expect(ofuscarCorreo('sin-arroba')).toBe('***');
    expect(ofuscarCorreo('@dominio.mx')).toBe('***');
  });
});

describe('el turno de prueba — una por minuto por usuario-agente', () => {
  const T0 = 1_700_000_000_000;

  it('la primera pasa y consume el turno', () => {
    const m = new Map<string, number>();
    expect(reclamarTurnoDePrueba('u1:cobranza', T0, m).ok).toBe(true);
    expect(m.get('u1:cobranza')).toBe(T0);
  });

  it('la segunda dentro del minuto se frena y dice cuánto falta', () => {
    const m = new Map<string, number>();
    reclamarTurnoDePrueba('u1:cobranza', T0, m);
    const r = reclamarTurnoDePrueba('u1:cobranza', T0 + 15_000, m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.faltanSegundos).toBe(45);
  });

  it('pasado el minuto vuelve a haber turno', () => {
    const m = new Map<string, number>();
    reclamarTurnoDePrueba('u1:cobranza', T0, m);
    expect(reclamarTurnoDePrueba('u1:cobranza', T0 + INTERVALO_PRUEBA_MS, m).ok).toBe(true);
  });

  it('el freno es POR PAR: otro agente u otro usuario no comparten turno', () => {
    const m = new Map<string, number>();
    reclamarTurnoDePrueba('u1:cobranza', T0, m);
    expect(reclamarTurnoDePrueba('u1:peajes', T0 + 1, m).ok).toBe(true);
    expect(reclamarTurnoDePrueba('u2:cobranza', T0 + 2, m).ok).toBe(true);
  });

  it('al filo del vencimiento redondea hacia ARRIBA: nunca «faltan 0 s»', () => {
    const m = new Map<string, number>();
    reclamarTurnoDePrueba('u1:cobranza', T0, m);
    // Al filo del vencimiento: 1 ms antes del minuto todavía frena, y el
    // acuse redondea hacia ARRIBA — «0 s» leería como un freno sin motivo.
    const r = reclamarTurnoDePrueba('u1:cobranza', T0 + INTERVALO_PRUEBA_MS - 1, m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.faltanSegundos).toBeGreaterThanOrEqual(1);
  });

  it('el mapa no crece sin techo: las llaves vencidas se podan', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 500; i++) m.set(`viejo:${i}`, T0 - INTERVALO_PRUEBA_MS);
    reclamarTurnoDePrueba('nuevo:1', T0, m);
    expect(m.size).toBe(1);
    expect(m.has('nuevo:1')).toBe(true);
  });
});

describe('el acuse dice la verdad del caso que tocó', () => {
  const CORREO = 'javier@transportes.mx';

  it('enviado: manda a la bandeja con el correo OFUSCADO, nunca completo', () => {
    const a = acuseDeEnvio({ ok: true, id: 're_abc' }, CORREO);
    expect(a.enviado).toBe(true);
    expect(a.mensaje).toContain('j***@transportes.mx');
    expect(a.mensaje).not.toContain('javier@');
  });

  it('sin configurar: nombra lo que falta, no un error genérico', () => {
    const a = acuseDeEnvio({ ok: false, motivo: 'sin_configurar' }, CORREO);
    expect(a.enviado).toBe(false);
    expect(a.mensaje).toContain('RESEND_API_KEY');
    expect(a.mensaje).toContain('RESEND_EMAIL_DOMAIN');
  });

  it('rechazado: el detalle saneado de enviar.ts SÍ viaja (es legible)', () => {
    const a = acuseDeEnvio({ ok: false, motivo: 'rechazado', detalle: 'HTTP 403' }, CORREO);
    expect(a.enviado).toBe(false);
    expect(a.mensaje).toContain('HTTP 403');
    expect(a.mensaje).toContain('rechazó');
  });

  it('fallo de red: el detalle CRUDO jamás llega a la pestaña', () => {
    const crudo = 'fetch failed: getaddrinfo ENOTFOUND api.resend.com';
    const a = acuseDeEnvio({ ok: false, motivo: 'red', detalle: crudo }, CORREO);
    expect(a.enviado).toBe(false);
    expect(a.mensaje).not.toContain('ENOTFOUND');
    expect(a.mensaje).not.toContain('fetch');
    expect(a.mensaje.toLowerCase()).toContain('inténtalo de nuevo');
  });
});
