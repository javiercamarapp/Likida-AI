import { describe, expect, it } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from '../conductor/config';
import { hitoVacio } from '../conductor/memoria.fixture';
import type { DatosTablero, ViajeTablero } from '../conductor/repo_validacion';
import type { HitoFila, TipoHito } from '../conductor/tipos';
import { armarTableroViajes, posicionesDeGps, textoAntiguedad, type PosicionUnidad } from './tablero_viajes';

const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const cfg = (p: Partial<ConfigConductor> = {}): ConfigConductor => ({ ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana], ...p });

function viaje(id: string, p: Partial<ViajeTablero> = {}): ViajeTablero {
  return {
    id, folio: `F-${id}`, origen: 'Zapopan', destino: 'Monterrey', estatus: 'abierto', operadorId: `o-${id}`, operadorNombre: `Chofer ${id}`,
    terminalId: 'tm1', terminalNombre: 'Terminal Uno', clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: `u-${id}`,
    aceptadoEn: hace(60), citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null, origenSitioId: null, destinoSitioId: null, ...p,
  };
}
function hitos(viajeId: string, estados: Partial<Record<TipoHito, Partial<HitoFila> | string>>): HitoFila[] {
  return (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) => {
    const e = estados[tipo];
    const extra: Partial<HitoFila> = typeof e === 'string' ? { estado: 'recibido', fuente: 'texto', mensajeEn: e, recibidoEn: e } : (e ?? {});
    return hitoVacio({ id: `${viajeId}-${tipo}`, tipo, viajeId, ...extra });
  });
}
const datos = (viajes: ViajeTablero[], hs: HitoFila[]): DatosTablero => ({
  viajes, hayMas: false, hitos: hs, veredictos: [], evidencias: [], acciones: [], sitios: new Map(),
});
const pos = (minAtras: number): PosicionUnidad => ({ lat: 20.67, lng: -103.35, medidaEn: hace(minAtras) });
const armar = (d: DatosTablero, posiciones: Record<string, PosicionUnidad>, f: Parameters<typeof armarTableroViajes>[0]['filtros'] = {}) =>
  armarTableroViajes({ datos: d, config: cfg(), posiciones: new Map(Object.entries(posiciones)), ahora: AHORA, filtros: f });

describe('tablero de viajes en vivo', () => {
  it('trae el último hito registrado y la antigüedad de la posición, sin excepciones si todo está al día', () => {
    const v = viaje('1', { citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    // La llegada ya la confirmó el GPS: «todo al día» no incluye un «ya llegué» sin conciliar.
    const llegadaValidada = { estado: 'validado' as const, fuente: 'texto' as const, mensajeEn: hace(50), recibidoEn: hace(50), validadoEn: hace(45), validadoPor: 'gps' as const };
    const t = armar(datos([v], hitos('1', { llegada_carga: llegadaValidada, salida_carga: hace(20) })), { 'u-1': pos(4) });
    const f = t.filas[0];
    expect(f.ultimoHito).toMatchObject({ tipo: 'salida_carga', etiqueta: expect.any(String), estado: 'recibido' });
    expect(f.hitoActivo).toBe('llegada_descarga');
    expect(f.posicion).toMatchObject({ antiguedadMin: 4, frescura: 'en_vivo' });
    expect(f.senalDeVida).toBe('viva');
    expect(f.excepciones).toEqual([]);
    expect(t.conteos.conExcepcion).toBe(0);
  });

  it('un viaje sin ningún hito dice «sin último hito», no inventa uno', () => {
    const t = armar(datos([viaje('1')], hitos('1', {})), { 'u-1': pos(1) });
    expect(t.filas[0].ultimoHito).toBeNull();
  });

  it('GPS atrasado se marca pero no es excepción; obsoleto SÍ lo es (con la antigüedad dicha)', () => {
    const v1 = viaje('1', { citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const v2 = viaje('2', { citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const t = armar(datos([v1, v2], [...hitos('1', {}), ...hitos('2', {})]), { 'u-1': pos(120), 'u-2': pos(500) });
    const f1 = t.filas.find((x) => x.viajeId === '1')!;
    const f2 = t.filas.find((x) => x.viajeId === '2')!;
    expect(f1.posicion?.frescura).toBe('atrasada');
    expect(f1.excepciones).toEqual([]);
    expect(f2.posicion?.frescura).toBe('obsoleta');
    expect(f2.excepciones.map((e) => e.tipo)).toEqual(['gps_obsoleto']);
    expect(f2.excepciones[0].texto).toMatch(/8 h 20 min/);
  });

  it('sin posición y sin tractor son excepciones distintas, nunca «todo bien»', () => {
    const v1 = viaje('1', { citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const v2 = viaje('2', { unidadId: null, citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const t = armar(datos([v1, v2], [...hitos('1', {}), ...hitos('2', {})]), {});
    expect(t.filas.find((x) => x.viajeId === '1')!.excepciones.map((e) => e.tipo)).toEqual(['sin_posicion']);
    expect(t.filas.find((x) => x.viajeId === '2')!.excepciones.map((e) => e.tipo)).toEqual(['sin_unidad']);
    expect(t.filas.find((x) => x.viajeId === '1')!.posicion).toBeNull();
    expect(t.conteos.sinPosicion).toBe(1);
  });

  it('sin señal de vida: chofer sin reporte Y GPS callado = urgente; solo uno de los dos = dudosa', () => {
    const tarde = { aceptadoEn: hace(120 + 100) };
    const callado = viaje('1', tarde);
    const gpsOk = viaje('2', tarde);
    const t = armar(datos([callado, gpsOk], [...hitos('1', {}), ...hitos('2', {})]), { 'u-1': pos(600), 'u-2': pos(3) });
    const f1 = t.filas.find((x) => x.viajeId === '1')!;
    const f2 = t.filas.find((x) => x.viajeId === '2')!;
    expect(f1.senalDeVida).toBe('sin_senal');
    expect(f1.gravedad).toBe(3);
    expect(f1.excepciones[0].tipo).toBe('sin_senal_de_vida');
    expect(f2.senalDeVida).toBe('dudosa');
    expect(f2.excepciones.some((e) => e.tipo === 'sin_senal_de_vida')).toBe(false);
    expect(t.filas[0].viajeId).toBe('1');
    expect(t.conteos.sinSenal).toBe(1);
  });

  it('el escalado al jefe de tráfico se reporta con su nivel y si ya lo atendieron', () => {
    const v = viaje('1', { aceptadoEn: hace(300) });
    const hs = hitos('1', { llegada_carga: { estado: 'escalado', escaladoEn: hace(30), escalacionNivel: 2 } });
    const t = armar(datos([v], hs), { 'u-1': pos(2) });
    expect(t.filas[0].escalado).toEqual({ nivel: 2, desde: hace(30), atendido: false });
    expect(t.filas[0].excepciones.map((e) => e.tipo)).toContain('escalado_sin_atender');
    expect(t.filas[0].gravedad).toBe(3);
    expect(t.conteos.escaladosATrafico).toBe(1);
  });

  it('la llegada que ninguna posición respalda sale como excepción «llegada_sin_confirmar»', () => {
    const v = viaje('1', { origenSitioId: 's1', aceptadoEn: hace(300) });
    const hs = hitos('1', { llegada_carga: { estado: 'recibido', fuente: 'texto', mensajeEn: hace(40), recibidoEn: hace(40) } });
    const t = armar(datos([v], hs), { 'u-1': pos(2) });
    expect(t.filas[0].excepciones.map((e) => e.tipo)).toContain('llegada_sin_confirmar');
    expect(t.conteos.llegadaSinConfirmar).toBe(1);
  });

  it('filtra por terminal y por cliente, y «solo excepciones»', () => {
    const a = viaje('1', { terminalId: 'tA', clienteId: 'cA', citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const b = viaje('2', { terminalId: 'tB', clienteId: 'cB', citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const d = datos([a, b], [...hitos('1', {}), ...hitos('2', {})]);
    const gps = { 'u-1': pos(2), 'u-2': pos(900) };
    expect(armar(d, gps, { terminalId: 'tA' }).filas.map((x) => x.viajeId)).toEqual(['1']);
    expect(armar(d, gps, { clienteId: 'cB' }).filas.map((x) => x.viajeId)).toEqual(['2']);
    expect(armar(d, gps, { soloExcepciones: true }).filas.map((x) => x.viajeId)).toEqual(['2']);
    expect(armar(d, gps, { terminalId: 'tA', clienteId: 'cB' }).filas).toEqual([]);
  });

  it('el clasificador del GPS es un enganche: si lo reemplazan, manda el suyo', () => {
    const v = viaje('1', { citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const t = armarTableroViajes({
      datos: datos([v], hitos('1', {})), config: cfg(), posiciones: new Map([['u-1', pos(5)]]), ahora: AHORA, clasificar: () => 'obsoleta',
    });
    expect(t.filas[0].excepciones.map((e) => e.tipo)).toEqual(['gps_obsoleto']);
  });

  it('una posición con fecha ilegible no se maquilla de «en vivo»', () => {
    const v = viaje('1', { citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const t = armar(datos([v], hitos('1', {})), { 'u-1': { lat: 1, lng: 1, medidaEn: 'no-es-fecha' } });
    expect(t.filas[0].posicion?.frescura).toBe('obsoleta');
  });

  it('hayMas del Conductor se propaga (el tablero no esconde el recorte)', () => {
    const d = { ...datos([viaje('1')], hitos('1', {})), hayMas: true };
    expect(armar(d, { 'u-1': pos(1) }).hayMas).toBe(true);
  });

  it('si no se pudieron leer las posiciones, NO inventa «sin posición»: lo dice con gpsDisponible=false', () => {
    const v = viaje('1', { citaOrigenEn: new Date(AHORA.getTime() + 600 * 60_000).toISOString() });
    const t = armarTableroViajes({ datos: datos([v], hitos('1', {})), config: cfg(), posiciones: null, ahora: AHORA });
    expect(t.gpsDisponible).toBe(false);
    expect(t.filas[0].posicion).toBeNull();
    expect(t.filas[0].excepciones).toEqual([]);
    expect(t.filas[0].senalDeVida).toBe('viva');
  });

  it('la línea de hitos y las citas viajan para el detalle', () => {
    const v = viaje('1', { citaOrigenEn: hace(-600) });
    const t = armar(datos([v], hitos('1', { llegada_carga: hace(50) })), { 'u-1': pos(4) });
    expect(t.filas[0].linea.map((h) => h.tipo)).toEqual(['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso']);
    expect(t.filas[0].linea[0]).toMatchObject({ estado: 'recibido' });
    expect(t.filas[0].citas.origen).toBe(v.citaOrigenEn);
  });

  it('textoAntiguedad', () => {
    expect(textoAntiguedad(0)).toBe('hace menos de un minuto');
    expect(textoAntiguedad(45)).toBe('hace 45 min');
    expect(textoAntiguedad(120)).toBe('hace 2 h');
    expect(textoAntiguedad(135)).toBe('hace 2 h 15 min');
  });

  it('un pin de WhatsApp NO cuenta como posición del tractor: con el GPS de 3 h sigue gps_obsoleto y sin señal de vida', () => {
    const mapa = posicionesDeGps([
      { unidadId: 'u-1', lat: 20, lng: -103, medidaEn: hace(1), proveedor: 'whatsapp' },
      { unidadId: 'u-2', lat: 21, lng: -103, medidaEn: hace(2), proveedor: 'samsara' },
    ]);
    expect(mapa.has('u-1')).toBe(false);
    expect(mapa.get('u-2')).toMatchObject({ lat: 21 });
    const v = viaje('1', { citaOrigenEn: hace(-600) });
    const t = armarTableroViajes({ datos: datos([v], hitos('1', {})), config: cfg(), posiciones: mapa, ahora: AHORA });
    expect(t.filas[0].posicion).toBeNull();
    expect(t.filas[0].excepciones.some((x) => x.tipo === 'sin_posicion')).toBe(true);
    expect(t.filas[0].senalDeVida).not.toBe('viva');
  });
});
