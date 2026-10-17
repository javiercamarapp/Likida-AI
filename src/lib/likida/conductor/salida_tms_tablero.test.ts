import { describe, expect, it } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import { hitoVacio } from './memoria.fixture';
import type { DatosTablero, PosicionTablero, ViajeTablero } from './repo_validacion';
import { armarTablero } from './tablero';
import { TIPOS_HITO, type HitoFila } from './tipos';

// T-A5-22 en el tablero: la «Fecha Salida» del TMS se ve como candidato o como discrepancia; el tablero NUNCA registra nada.
// Datos 100 % sintéticos. 10:22:07 en México = 16:22:07 UTC.
const MARCA = '2026-10-13T16:22:07.000Z';
const AHORA = new Date('2026-10-13T17:00:00.000Z');
const en = (hhmmUtc: string): string => `2026-10-13T${hhmmUtc}:00.000Z`;
const cfg = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana] };

const PLANTA = { nombre: 'Planta Sintetica', lat: 20.5, lng: -103.3, radioM: 300 };
const DENTRO = { lat: 20.501, lng: -103.3 };
const FUERA = { lat: 20.53, lng: -103.3 };

const viaje = (p: Partial<ViajeTablero> = {}): ViajeTablero => ({
  id: 'v1', folio: 'F-1', origen: 'A', destino: 'B', estatus: 'abierto', operadorId: 'o1', operadorNombre: 'Chofer 1', terminalId: null, terminalNombre: null,
  clienteId: null, clienteNombre: null, unidadId: 'u1', aceptadoEn: en('14:00'), citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null,
  origenSitioId: 's1', destinoSitioId: null, ...p,
});
const hitos = (salida: Partial<HitoFila> = {}): HitoFila[] => TIPOS_HITO.map((tipo) =>
  hitoVacio({ id: `h-${tipo}`, viajeId: 'v1', tipo, ...(tipo === 'salida_carga' ? salida : {}) }));
const datos = (o: { marca?: string; posicion?: Partial<PosicionTablero> & { lat: number; lng: number }; h?: HitoFila[]; conRadio?: boolean } = {}): DatosTablero => ({
  viajes: [viaje()], hayMas: false, hitos: o.h ?? hitos(), veredictos: [], evidencias: [], acciones: [], sitios: new Map([['s1', PLANTA.nombre]]),
  sitiosCoords: new Map([['s1', o.conRadio === false ? { nombre: PLANTA.nombre, lat: PLANTA.lat, lng: PLANTA.lng } : PLANTA]]),
  posiciones: o.posicion ? new Map([['u1', { medidaEn: en('16:50'), fuente: 'gps', ...o.posicion } as PosicionTablero]]) : new Map(),
  ...(o.marca ? { salidasTms: new Map([['v1', o.marca]]) } : {}),
});

describe('armarTablero — «Fecha Salida» del TMS', () => {
  it('con marca y sin contradicción: candidato con el texto exacto, hora de México', () => {
    const t = armarTablero(datos({ marca: MARCA, posicion: { ...FUERA } }), cfg, AHORA);
    expect(t.filas[0].salidaTms).toEqual({ estado: 'candidato', texto: 'El TMS marca salida a las 10:22', marca: MARCA });
    expect(t.excepciones.some((e) => e.tipo === 'salida_tms_discrepante')).toBe(false);
  });

  it('la casilla encendida tampoco registra desde el tablero: sigue siendo candidato mientras el barrido no corre', () => {
    const t = armarTablero(datos({ marca: MARCA, posicion: { ...FUERA } }), { ...cfg, aplicarSalidaDelTms: true }, AHORA);
    expect(t.filas[0].salidaTms?.estado).toBe('candidato');
  });

  it('el GPS sigue dentro del sitio después de la marca: discrepancia visible y excepción de lectura', () => {
    const t = armarTablero(datos({ marca: MARCA, posicion: { ...DENTRO, medidaEn: en('16:40') } }), cfg, AHORA);
    expect(t.filas[0].salidaTms?.estado).toBe('discrepancia');
    expect(t.filas[0].salidaTms?.texto).toContain('el GPS sigue dentro de Planta Sintetica');
    const ex = t.excepciones.find((e) => e.tipo === 'salida_tms_discrepante');
    expect(ex).toMatchObject({ viajeId: 'v1', hitoTipo: 'salida_carga', gravedad: 1 });
  });

  it('un pin de WhatsApp dentro del sitio NO contradice (no es GPS)', () => {
    const t = armarTablero(datos({ marca: MARCA, posicion: { ...DENTRO, medidaEn: en('16:40'), fuente: 'pin' } }), cfg, AHORA);
    expect(t.filas[0].salidaTms?.estado).toBe('candidato');
  });

  it('sin radio del sitio no hay con qué contradecir: no se inventa una discrepancia', () => {
    const t = armarTablero(datos({ marca: MARCA, posicion: { ...DENTRO, medidaEn: en('16:40') }, conRadio: false }), cfg, AHORA);
    expect(t.filas[0].salidaTms?.estado).toBe('candidato');
  });

  it('sin marca (o sin poder leerla): la fila no pinta nada', () => {
    expect(armarTablero(datos({ posicion: { ...FUERA } }), cfg, AHORA).filas[0].salidaTms).toBeNull();
  });

  it('el hito ya registrado (chofer, oficina o GPS) no se muestra como candidato: no hay nada que proponer', () => {
    const h = hitos({ estado: 'validado', fuente: 'texto', mensajeEn: en('16:10'), recibidoEn: en('16:11') });
    expect(armarTablero(datos({ marca: MARCA, posicion: { ...FUERA }, h }), cfg, AHORA).filas[0].salidaTms).toBeNull();
  });

  it('no cambia el semáforo ni los hitos de la fila (es solo lectura)', () => {
    const sin = armarTablero(datos({ posicion: { ...FUERA } }), cfg, AHORA).filas[0];
    const con = armarTablero(datos({ marca: MARCA, posicion: { ...FUERA } }), cfg, AHORA).filas[0];
    expect(con.semaforo).toBe(sin.semaforo);
    expect(con.hitos).toEqual(sin.hitos);
  });
});
