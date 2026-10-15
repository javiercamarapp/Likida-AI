import { describe, expect, it } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import type { DatosTablero, PosicionTablero, ViajeTablero } from './repo_validacion';
import { armarTablero, MINUTOS_POSICION_OBSOLETA, TEXTO_POSICION_NO_LEIDA, TEXTO_SIN_POSICION } from './tablero';

// T-A5-11 «dónde está»: la fila del tablero dice la última posición, nunca la inventa. Datos 100 % sintéticos.
const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const cfg = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana] };

const SITIO_CARGA = { nombre: 'Planta Norte', lat: 20.0, lng: -103.0 };
const SITIO_DESCARGA = { nombre: 'CEDIS Sur', lat: 21.0, lng: -103.0 };
// 0.02878° de latitud ≈ 3.2 km al norte de la planta de carga.
const CERCA_DE_CARGA = { lat: 20.02878, lng: -103.0 };

const viaje = (p: Partial<ViajeTablero> = {}): ViajeTablero => ({
  id: 'v1', folio: 'F-1', origen: 'A', destino: 'B', estatus: 'abierto', operadorId: 'o1', operadorNombre: 'Chofer 1', terminalId: null, terminalNombre: null,
  clienteId: null, clienteNombre: null, unidadId: 'u1', aceptadoEn: hace(600), citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null,
  origenSitioId: 's1', destinoSitioId: 's2', ...p,
});
const datos = (v: ViajeTablero, posiciones: Map<string, PosicionTablero> | undefined): DatosTablero => ({
  viajes: [v], hayMas: false, hitos: [], veredictos: [], evidencias: [], acciones: [], sitios: new Map(),
  sitiosCoords: new Map([['s1', SITIO_CARGA], ['s2', SITIO_DESCARGA]]), posiciones,
});
const ubicacion = (v: ViajeTablero, pos: Map<string, PosicionTablero> | undefined) => armarTablero(datos(v, pos), cfg, AHORA).filas[0].ubicacion;
const posicion = (min: number, extra: Partial<PosicionTablero> = {}): Map<string, PosicionTablero> =>
  new Map([['u1', { ...CERCA_DE_CARGA, medidaEn: hace(min), fuente: 'gps', ...extra }]]);

describe('«dónde está» en la fila del tablero', () => {
  it('posición de hace 12 min: texto exacto con el sitio más cercano y la distancia', () => {
    const u = ubicacion(viaje(), posicion(12));
    expect(u.texto).toBe('Última posición: hace 12 min · a 3.2 km de Planta Norte');
    expect(u).toMatchObject({ hace: 'hace 12 min', sitioMasCercano: 'Planta Norte', fuente: 'gps', obsoleta: false });
  });

  it('elige el sitio más cercano entre carga y descarga', () => {
    const u = ubicacion(viaje(), new Map([['u1', { lat: 20.98, lng: -103.0, medidaEn: hace(5), fuente: 'gps' as const }]]));
    expect(u.sitioMasCercano).toBe('CEDIS Sur');
  });

  it('menos de un kilómetro se dice en metros', () => {
    const u = ubicacion(viaje(), new Map([['u1', { lat: 20.0045, lng: -103.0, medidaEn: hace(3), fuente: 'gps' as const }]]));
    expect(u.texto).toBe('Última posición: hace 3 min · a 500 m de Planta Norte');
  });

  it('sin posición reciente: el mensaje de «sin dato», sin inventar ubicación', () => {
    const u = ubicacion(viaje(), new Map());
    expect(u.texto).toBe('Sin posición reciente (el GPS de esta unidad no ha reportado)');
    expect(u.texto).toBe(TEXTO_SIN_POSICION);
    expect(u).toMatchObject({ hace: null, sitioMasCercano: null, distanciaM: null, fuente: 'sin_dato', obsoleta: false });
  });

  it('posición de más de 45 min: se marca obsoleta pero sigue siendo la última conocida', () => {
    expect(MINUTOS_POSICION_OBSOLETA).toBe(45);
    const justo = ubicacion(viaje(), posicion(45));
    expect(justo.obsoleta).toBe(false);
    const vieja = ubicacion(viaje(), posicion(46));
    expect(vieja.obsoleta).toBe(true);
    expect(vieja.texto).toBe('Última posición: hace 46 min · a 3.2 km de Planta Norte · obsoleta');
  });

  it('horas largas se dicen en horas y minutos', () => {
    expect(ubicacion(viaje(), posicion(135)).hace).toBe('hace 2 h 15 min');
  });

  it('un pin de WhatsApp se dice como pin (no se hace pasar por GPS)', () => {
    const u = ubicacion(viaje(), posicion(8, { fuente: 'pin' }));
    expect(u.fuente).toBe('pin');
    expect(u.texto).toBe('Última posición: hace 8 min · a 3.2 km de Planta Norte · ubicación enviada por WhatsApp');
  });

  it('sin sitios con coordenadas dice la antigüedad sin inventar el sitio', () => {
    const d = datos(viaje({ origenSitioId: null, destinoSitioId: null }), posicion(12));
    const u = armarTablero(d, cfg, AHORA).filas[0].ubicacion;
    expect(u.texto).toBe('Última posición: hace 12 min');
    expect(u.sitioMasCercano).toBeNull();
  });

  it('si la lectura de posiciones falló NO afirma «sin GPS»: dice que no se pudo consultar', () => {
    const u = ubicacion(viaje(), undefined);
    expect(u.texto).toBe(TEXTO_POSICION_NO_LEIDA);
    expect(u.texto).not.toContain('no ha reportado');
    expect(u.fuente).toBe('sin_dato');
  });

  it('un viaje sin tractor asignado lo dice', () => {
    expect(ubicacion(viaje({ unidadId: null }), new Map()).texto).toBe('Sin tractor asignado: no hay posición que mostrar');
  });

  it('una fecha ilegible no se pinta como posición', () => {
    const u = ubicacion(viaje(), new Map([['u1', { ...CERCA_DE_CARGA, medidaEn: 'basura', fuente: 'gps' as const }]]));
    expect(u.texto).toBe(TEXTO_SIN_POSICION);
  });

  it('el texto nunca trae coordenadas', () => {
    expect(ubicacion(viaje(), posicion(12)).texto).not.toMatch(/\d{2}\.\d{3,}/);
  });
});
