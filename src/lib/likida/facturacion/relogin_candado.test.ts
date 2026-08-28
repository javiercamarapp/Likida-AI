import { describe, it, expect } from 'vitest';
import {
  candadoDeRelogin, diaMx, sinPermiso, ESPERA_ENTRE_INTENTOS_MS, TOPE_INTENTOS_DIA,
  type PermisoRelogin,
} from './relogin_portal';

// ═══════════════════════════════════════════════════════════════════════════
// EL CANDADO ANTIBLOQUEO — la pieza que impide que un automatismo pensado
// para ahorrarle trabajo a la flota acabe costándole la cuenta.
//
// Es puro a propósito (sin base, sin reloj interno) porque es lo que TIENE que
// estar probado: cada uno de estos «no» es un intento que NO se gasta contra
// la cuenta de un cliente.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-08-27T21:00:00.000Z');
const HOY = '2026-08-27';

const permiso = (p: Partial<PermisoRelogin> = {}): PermisoRelogin => ({
  ...sinPermiso('g500'), permitido: true, permitidoPor: 'ana@flota.mx',
  permitidoEn: '2026-08-01T10:00:00.000Z', ...p,
});

describe('candadoDeRelogin — sin consentimiento no pasa nada', () => {
  it('el default de un portal es NO, y ese «no» va primero que todo', () => {
    const v = candadoDeRelogin(sinPermiso('g500'), AHORA, HOY);
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.clase).toBe('sin_consentimiento');
  });

  it('el «no» sin consentimiento gana incluso con todo lo demás en orden', () => {
    // Esto es lo que hace VERDAD que una flota que no marcó la casilla no
    // tenga su contraseña descifrada nunca: `reconectarPortal` comprueba esto
    // ANTES de tocar el cofre, y aquí se fija que nada lo pueda saltar.
    const v = candadoDeRelogin(permiso({ permitido: false, intentosDia: 0, bloqueado: false }), AHORA, HOY);
    expect(v.puede === false && v.clase).toBe('sin_consentimiento');
  });

  it('con el permiso firmado y nada gastado, sí se puede', () => {
    expect(candadoDeRelogin(permiso(), AHORA, HOY).puede).toBe(true);
  });
});

describe('candadoDeRelogin — el candado innegociable de la credencial mala', () => {
  it('bloqueado = detenido, y ni el día nuevo ni el tiempo lo abren', () => {
    const p = permiso({
      bloqueado: true, ultimaClase: 'credencial_invalida',
      ultimoMotivo: 'El portal rechazó el usuario o la contraseña guardados.',
      // Día distinto y sin intentos: por edad y por cupo tendría vía libre.
      diaDeIntentos: '2026-08-01', intentosDia: 0, ultimoIntentoEn: null,
    });
    const v = candadoDeRelogin(p, AHORA, HOY);
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.clase).toBe('detenido');
    // El motivo que se enseña es el que el PORTAL produjo, no uno genérico.
    expect(v.puede === false && v.motivo).toMatch(/rechazó el usuario/);
  });

  it('un año después sigue detenido: solo lo abre una persona', () => {
    const p = permiso({ bloqueado: true, ultimaClase: 'credencial_invalida' });
    expect(candadoDeRelogin(p, AHORA + 365 * 24 * 3600_000, '2027-08-27').puede).toBe(false);
  });
});

describe('candadoDeRelogin — el tope por día', () => {
  it(`al llegar a ${TOPE_INTENTOS_DIA} intentos del día, se para`, () => {
    const p = permiso({ diaDeIntentos: HOY, intentosDia: TOPE_INTENTOS_DIA, ultimoIntentoEn: null });
    const v = candadoDeRelogin(p, AHORA, HOY);
    expect(v.puede === false && v.clase).toBe('tope_dia');
  });

  it('uno menos del tope todavía pasa', () => {
    const p = permiso({ diaDeIntentos: HOY, intentosDia: TOPE_INTENTOS_DIA - 1, ultimoIntentoEn: null });
    expect(candadoDeRelogin(p, AHORA, HOY).puede).toBe(true);
  });

  it('el contador es del DÍA: los de ayer no cuentan hoy', () => {
    const p = permiso({ diaDeIntentos: '2026-08-26', intentosDia: 99, ultimoIntentoEn: null });
    expect(candadoDeRelogin(p, AHORA, HOY).puede).toBe(true);
  });
});

describe('candadoDeRelogin — el backoff', () => {
  it('un intento reciente frena el siguiente, y dice cuánto falta', () => {
    const p = permiso({ ultimoIntentoEn: new Date(AHORA - 60_000).toISOString() });
    const v = candadoDeRelogin(p, AHORA, HOY);
    expect(v.puede === false && v.clase).toBe('backoff');
    expect(v.puede === false && v.motivo).toMatch(/min/);
  });

  it('pasada la espera, sí', () => {
    const p = permiso({ ultimoIntentoEn: new Date(AHORA - ESPERA_ENTRE_INTENTOS_MS - 1).toISOString() });
    expect(candadoDeRelogin(p, AHORA, HOY).puede).toBe(true);
  });

  it('una fecha ILEGIBLE no abre la puerta: no saber cuándo fue es no poder frenar', () => {
    const p = permiso({ ultimoIntentoEn: 'ayer por la tarde' });
    const v = candadoDeRelogin(p, AHORA, HOY);
    expect(v.puede === false && v.clase).toBe('backoff');
  });

  it('un último intento en el FUTURO (reloj desalineado) también frena', () => {
    const p = permiso({ ultimoIntentoEn: new Date(AHORA + 3600_000).toISOString() });
    expect(candadoDeRelogin(p, AHORA, HOY).puede).toBe(false);
  });
});

describe('candadoDeRelogin — el orden de los «no»', () => {
  it('con todo en contra, el que se reporta es el bloqueo, no el tope', () => {
    // Importa porque cada clase manda a la persona a algo distinto: «detenido»
    // manda a guardar la contraseña buena; «tope_dia» manda a esperar.
    const p = permiso({
      bloqueado: true, ultimaClase: 'credencial_invalida',
      diaDeIntentos: HOY, intentosDia: 99,
      ultimoIntentoEn: new Date(AHORA - 1000).toISOString(),
    });
    expect(candadoDeRelogin(p, AHORA, HOY).puede === false
      && (candadoDeRelogin(p, AHORA, HOY) as { clase: string }).clase).toBe('detenido');
  });
});

describe('diaMx — la ventana es el día de la flota, no el del servidor', () => {
  it('a las 21:00 UTC del 27 en México todavía es 27', () => {
    expect(diaMx(new Date('2026-08-27T21:00:00.000Z'))).toBe('2026-08-27');
  });

  it('a las 02:00 UTC del 28 en México sigue siendo 27 — y esa es la diferencia', () => {
    // Con una ventana en UTC, los intentos de la tarde y los de la noche de la
    // misma jornada caerían en días distintos y el tope no toparía nada.
    expect(diaMx(new Date('2026-08-28T02:00:00.000Z'))).toBe('2026-08-27');
  });
});
