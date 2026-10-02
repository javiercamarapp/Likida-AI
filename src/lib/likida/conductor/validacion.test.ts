import { describe, expect, it } from 'vitest';
import {
  debeReintentarseValidacion, evaluarUbicacion, posicionMasCercanaEnTiempo, textoVeredicto,
  type EntradaValidacion, type PosicionComparada, type SitioValidable,
} from './validacion';

const SITIO: SitioValidable = { id: 's1', nombre: 'Planta Zapopan', lat: 20.72, lng: -103.39, radioM: 300 };
const MENSAJE = new Date('2026-10-02T20:00:00.000Z');

function pos(p: Partial<PosicionComparada> = {}): PosicionComparada {
  return { lat: 20.72, lng: -103.39, medidaEn: new Date('2026-10-02T20:02:00.000Z'), fuente: 'gps', ...p };
}
function entrada(p: Partial<EntradaValidacion> = {}): EntradaValidacion {
  return { sitio: SITIO, posicion: pos(), mensajeEn: MENSAJE, toleranciaM: 150, ventanaMin: 30, ...p };
}

describe('evaluarUbicacion', () => {
  it('validado: la posición cae en el centro del sitio', () => {
    const v = evaluarUbicacion(entrada());
    expect(v).toMatchObject({ resultado: 'validado', motivo: null, distanciaM: 0, fuente: 'gps', sitioId: 's1', radioM: 300, toleranciaM: 150 });
  });

  it('validado: fuera del radio pero DENTRO de radio + tolerancia', () => {
    // ~0.0035° de latitud ≈ 389 m: radio 300 + tolerancia 150 = 450.
    const v = evaluarUbicacion(entrada({ posicion: pos({ lat: 20.7235 }) }));
    expect(v.distanciaM).toBeGreaterThan(300);
    expect(v.distanciaM).toBeLessThanOrEqual(450);
    expect(v.resultado).toBe('validado');
  });

  it('sin coincidencia: fuera de radio + tolerancia, y reporta la distancia medida', () => {
    const v = evaluarUbicacion(entrada({ posicion: pos({ lat: 20.73 }) })); // ~1.1 km
    expect(v.resultado).toBe('sin_coincidencia');
    expect(v.motivo).toBeNull();
    expect(v.distanciaM).toBeGreaterThan(1000);
  });

  it('la tolerancia es configurable: con 0 m el mismo punto de 389 m ya no coincide', () => {
    const v = evaluarUbicacion(entrada({ posicion: pos({ lat: 20.7235 }), toleranciaM: 0 }));
    expect(v.resultado).toBe('sin_coincidencia');
  });

  it('el borde exacto cuenta como dentro (<=)', () => {
    const base = evaluarUbicacion(entrada({ posicion: pos({ lat: 20.7235 }) }));
    const v = evaluarUbicacion(entrada({ posicion: pos({ lat: 20.7235 }), toleranciaM: base.distanciaM! - 300 }));
    expect(v.resultado).toBe('validado');
    const justoFuera = evaluarUbicacion(entrada({ posicion: pos({ lat: 20.7235 }), toleranciaM: base.distanciaM! - 301 }));
    expect(justoFuera.resultado).toBe('sin_coincidencia');
  });

  describe('sin dato: lo que NO alcanza no se convierte en «no coincide»', () => {
    it('sin sitio asignado', () => {
      const v = evaluarUbicacion(entrada({ sitio: null }));
      expect(v).toMatchObject({ resultado: 'sin_dato', motivo: 'sin_sitio', distanciaM: null, sitioId: null });
    });
    it('sitio con coordenadas corruptas', () => {
      expect(evaluarUbicacion(entrada({ sitio: { ...SITIO, lat: NaN } })).motivo).toBe('sin_sitio');
    });
    it('sin posición', () => {
      const v = evaluarUbicacion(entrada({ posicion: null }));
      expect(v).toMatchObject({ resultado: 'sin_dato', motivo: 'sin_ubicacion', distanciaM: null, sitioId: 's1' });
    });
    it('posición de otra hora (31 min con ventana de 30)', () => {
      const v = evaluarUbicacion(entrada({ posicion: pos({ medidaEn: new Date(MENSAJE.getTime() + 31 * 60_000) }) }));
      expect(v).toMatchObject({ resultado: 'sin_dato', motivo: 'ubicacion_fuera_de_ventana', distanciaM: null });
    });
    it('posición ANTERIOR al mensaje también cuenta la ventana (una muestra de ayer no sirve)', () => {
      const v = evaluarUbicacion(entrada({ posicion: pos({ medidaEn: new Date(MENSAJE.getTime() - 24 * 3_600_000) }) }));
      expect(v.motivo).toBe('ubicacion_fuera_de_ventana');
    });
    it('coordenadas del pin inválidas', () => {
      expect(evaluarUbicacion(entrada({ posicion: pos({ lat: 200 }) })).motivo).toBe('coordenadas_invalidas');
      expect(evaluarUbicacion(entrada({ posicion: pos({ lng: NaN }) })).motivo).toBe('coordenadas_invalidas');
    });
    it('una hora de mensaje inválida no produce un veredicto de coincidencia', () => {
      expect(evaluarUbicacion(entrada({ mensajeEn: new Date('no es fecha') })).resultado).toBe('sin_dato');
    });
  });

  it('hostil: coordenadas absurdas del chofer no producen validado', () => {
    const v = evaluarUbicacion(entrada({ posicion: pos({ lat: -90, lng: 180 }) }));
    expect(v.resultado).toBe('sin_coincidencia');
  });
});

describe('posicionMasCercanaEnTiempo', () => {
  it('elige la más cercana a la hora del mensaje, NO la última', () => {
    const a = pos({ medidaEn: new Date(MENSAJE.getTime() - 5 * 60_000), lat: 1 });
    const b = pos({ medidaEn: new Date(MENSAJE.getTime() + 20 * 60_000), lat: 2 });
    expect(posicionMasCercanaEnTiempo([b, a], MENSAJE)?.lat).toBe(1);
  });
  it('sin posiciones, null', () => {
    expect(posicionMasCercanaEnTiempo([], MENSAJE)).toBeNull();
  });
  it('a igualdad de distancia en el tiempo el pin gana al GPS (en cualquier orden)', () => {
    const gps = pos({ fuente: 'gps', lat: 1, medidaEn: new Date(MENSAJE.getTime() + 60_000) });
    const pin = pos({ fuente: 'pin', lat: 2, medidaEn: new Date(MENSAJE.getTime() - 60_000) });
    expect(posicionMasCercanaEnTiempo([gps, pin], MENSAJE)?.fuente).toBe('pin');
    expect(posicionMasCercanaEnTiempo([pin, gps], MENSAJE)?.fuente).toBe('pin');
  });
  it('ignora posiciones con hora inválida', () => {
    const mala = pos({ medidaEn: new Date('x'), lat: 9 });
    const buena = pos({ lat: 3 });
    expect(posicionMasCercanaEnTiempo([mala, buena], MENSAJE)?.lat).toBe(3);
  });
});

describe('textoVeredicto: dice qué pasó sin acusar', () => {
  it('sin coincidencia ofrece causas distintas de la culpa del chofer', () => {
    const t = textoVeredicto(evaluarUbicacion(entrada({ posicion: pos({ lat: 20.73 }) })), 'Planta Zapopan');
    expect(t).toMatch(/fuera de su radio/);
    expect(t).toMatch(/otra entrada|muestra vieja|radio mal capturado/);
    expect(t).not.toMatch(/mintió|falso|engañ/i);
  });
  it('validado menciona sitio, distancia y fuente', () => {
    const t = textoVeredicto(evaluarUbicacion(entrada({ posicion: pos({ fuente: 'pin' }) })), 'Planta Zapopan');
    expect(t).toMatch(/Planta Zapopan/);
    expect(t).toMatch(/pin que compartió/);
  });
  it('cada motivo de sin dato tiene su frase', () => {
    expect(textoVeredicto(evaluarUbicacion(entrada({ sitio: null })), null)).toMatch(/no tiene sitio asignado/);
    expect(textoVeredicto(evaluarUbicacion(entrada({ posicion: null })), null)).toMatch(/todavía no hay una posición/);
    expect(textoVeredicto(evaluarUbicacion(entrada({ posicion: pos({ lat: 200 }) })), null)).toMatch(/no son válidas/);
    expect(textoVeredicto(evaluarUbicacion(entrada({ posicion: pos({ medidaEn: new Date(0) }) })), null)).toMatch(/otra hora/);
  });
});

describe('debeReintentarseValidacion (el barrido del cron)', () => {
  it('sin veredicto, sin posición y sin coincidencia se vuelven a medir (una muestra posterior puede validar al chofer honesto)', () => {
    expect(debeReintentarseValidacion(undefined)).toBe(true);
    expect(debeReintentarseValidacion(null)).toBe(true);
    expect(debeReintentarseValidacion({ resultado: 'sin_coincidencia', motivo: null })).toBe(true);
    expect(debeReintentarseValidacion({ resultado: 'sin_dato', motivo: 'sin_ubicacion' })).toBe(true);
    expect(debeReintentarseValidacion({ resultado: 'sin_dato', motivo: 'ubicacion_fuera_de_ventana' })).toBe(true);
  });
  it('lo que más muestras no arreglan (sin sitio, coordenadas malas) o ya está validado, no se reintenta', () => {
    expect(debeReintentarseValidacion({ resultado: 'sin_dato', motivo: 'sin_sitio' })).toBe(false);
    expect(debeReintentarseValidacion({ resultado: 'sin_dato', motivo: 'coordenadas_invalidas' })).toBe(false);
    expect(debeReintentarseValidacion({ resultado: 'validado', motivo: null })).toBe(false);
  });
});

describe('un pin descartado porque el GPS aún no llega', () => {
  it('dice «posición de otra hora», no «sin ubicación» (adversarial ronda 03)', () => {
    expect(evaluarUbicacion(entrada({ posicion: null, gpsPendiente: true }))).toMatchObject({ resultado: 'sin_dato', motivo: 'ubicacion_fuera_de_ventana' });
    expect(evaluarUbicacion(entrada({ posicion: null }))).toMatchObject({ resultado: 'sin_dato', motivo: 'sin_ubicacion' });
  });
});
