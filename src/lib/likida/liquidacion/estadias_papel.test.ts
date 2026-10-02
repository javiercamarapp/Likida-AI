import { describe, it, expect } from 'vitest';
import { armarFilasEstadias } from '../conductor/estadias_lectura';
import { hitoVacio } from '../conductor/memoria.fixture';
import type { DatosEstadias, ViajeTablero } from '../conductor/repo_validacion';
import type { HitoFila, TipoHito } from '../conductor/tipos';
import { duracionTexto, estadiasParaPapel } from './estadias_papel';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ESTADÍAS EN EL PAPEL DE LA LIQUIDACIÓN — el contenido, sin PDF. Las tres reglas del archivo: no suman a nada,
// lo que no se midió no se inventa, y el dinero es una propuesta con el pacto a la vista.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = new Date('2026-10-02T20:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const V = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';

const viaje = (p: Partial<ViajeTablero> = {}): ViajeTablero => ({
  id: V, folio: 'F-1042', origen: 'Zapopan', destino: 'Monterrey', estatus: 'en_cuadre', operadorId: 'o1', operadorNombre: 'Juan Pérez', terminalId: null,
  terminalNombre: 'Tlaquepaque', clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: null, aceptadoEn: hace(900), citaOrigenEn: null, citaDestinoEn: null,
  etaOrigenEn: null, etaDestinoEn: null, origenSitioId: 's1', destinoSitioId: null, ...p,
});
const hitos = (e: Partial<Record<TipoHito, string | Partial<HitoFila>>>): HitoFila[] =>
  (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) => {
    const x = e[tipo];
    const extra: Partial<HitoFila> = typeof x === 'string' ? { estado: 'recibido', fuente: 'texto', mensajeEn: x, recibidoEn: x } : (x ?? {});
    return hitoVacio({ id: `${V}-${tipo}`, tipo, viajeId: V, tenantId: 't1', ...extra });
  });
const datos = (v: ViajeTablero, hs: HitoFila[], extra: Partial<DatosEstadias> = {}): DatosEstadias => ({
  viajes: [v], hitos: hs, veredictos: [], evidencias: [], sitios: new Map([['s1', 'Planta Zapopan']]), truncada: false, ...extra,
});
const politicas = (horasLibres: number | null, tarifaHora: number | null, moneda = 'MXN') => ({ flota: { horasLibres, tarifaHora, moneda }, porCliente: new Map() });

describe('estadiasParaPapel', () => {
  it('sin paradas (o sin lectura) NO hay anexo: una sección vacía se leería como «estadía medida: cero»', () => {
    expect(estadiasParaPapel(null)).toBeNull();
    expect(estadiasParaPapel(armarFilasEstadias(datos(viaje(), hitos({})), AHORA, politicas(2, 600)))).toBeNull();
  });

  it('una parada cerrada: hora exacta, duración, respaldo y cobro propuesto con horas libres y fracción iniciada', () => {
    const r = armarFilasEstadias(
      datos(viaje(), hitos({ llegada_carga: hace(400), salida_carga: hace(250) }), {
        veredictos: [{ hitoId: `${V}-llegada_carga`, ciclo: 1, resultado: 'validado' } as never],
        evidencias: [{ hitoId: `${V}-llegada_carga`, ciclo: 1, ruta: 'x/y.jpg' } as never],
      }), AHORA, politicas(2, 600),
    );
    const p = estadiasParaPapel(r)!;
    expect(p.renglones).toHaveLength(1);
    const [c] = p.renglones;
    expect(c).toMatchObject({ parada: 'Carga', sitio: 'Planta Zapopan', duracion: '2 h 30 min' });
    expect(c.llegada).toMatch(/^2026-10-02 \d{2}:\d{2}:\d{2}$/);
    expect(c.respaldo).toBe('llegada: mensaje del chofer · salida: mensaje del chofer · ubicación validada · 1 foto');
    // 150 min − 2 h libres = 30 min → una hora cobrable (fracción iniciada) × $600.
    expect(c.cobro).toBe('Propuesta: 1 h cobrables = $600.00');
    expect(p.notas.join(' ')).toMatch(/NO suma a ningún total/);
    expect(p.notas.join(' ')).toMatch(/PROPUESTA/);
  });

  it('sin horas libres pactadas, dentro de lo libre o sin tarifa: dice POR QUÉ no hay monto (y no hay nota de propuesta)', () => {
    const hs = hitos({ llegada_carga: hace(400), salida_carga: hace(250) });
    expect(estadiasParaPapel(armarFilasEstadias(datos(viaje(), hs), AHORA, politicas(null, null)))!.renglones[0].cobro).toBe('Sin monto: sin horas libres pactadas (no hay umbral que exceder)');
    expect(estadiasParaPapel(armarFilasEstadias(datos(viaje(), hs), AHORA, politicas(5, 600)))!.renglones[0].cobro).toBe('Sin monto: dentro de las horas libres pactadas: no hay cobro');
    const sinTarifa = estadiasParaPapel(armarFilasEstadias(datos(viaje(), hs), AHORA, politicas(1, null)))!;
    expect(sinTarifa.renglones[0].cobro).toBe('Sin monto: sin tarifa de detención pactada');
    expect(sinTarifa.notas.join(' ')).not.toMatch(/PROPUESTA/);
  });

  it('una parada que «sigue en curso» al emitirse NO imprime minutos ni monto: el papel es una foto, no un reloj', () => {
    const r = armarFilasEstadias(datos(viaje({ estatus: 'abierto' }), hitos({ llegada_carga: hace(600) })), AHORA, politicas(1, 600));
    expect(r.filas[0].estancia.fase).toBe('en_curso');                       // el motor sí la mide corriendo…
    const [c] = estadiasParaPapel(r)!.renglones;
    expect(c.duracion).toBe('sin salida registrada');                        // …el papel no lo imprime como medido
    expect(c.cobro).toBe('Sin monto: la duración no se pudo medir');
    expect(c.salida).toBe('—');
  });

  it('un viaje liquidado sin salida, un reloj incoherente y una salida sin llegada se dicen tal cual', () => {
    const sinSalida = estadiasParaPapel(armarFilasEstadias(datos(viaje(), hitos({ llegada_carga: hace(600) })), AHORA, politicas(1, 600)))!.renglones[0];
    expect(sinSalida.duracion).toBe('sin salida registrada');
    const incoherente = estadiasParaPapel(armarFilasEstadias(datos(viaje(), hitos({ llegada_carga: hace(100), salida_carga: hace(200) })), AHORA, politicas(1, 600)))!.renglones[0];
    expect(incoherente.duracion).toBe('horas incoherentes: revisar');
    expect(incoherente.cobro).toBe('Sin monto: la duración no se pudo medir');
    const sinLlegada = estadiasParaPapel(armarFilasEstadias(datos(viaje(), hitos({ salida_carga: hace(100) })), AHORA, politicas(1, 600)))!.renglones[0];
    expect(sinLlegada.duracion).toBe('sin llegada registrada');
  });

  it('la carga sale antes que la descarga, y una captura de oficina se rotula así', () => {
    const r = armarFilasEstadias(
      datos(viaje(), hitos({
        llegada_descarga: hace(100), salida_descarga: hace(40),
        llegada_carga: { estado: 'recibido', fuente: 'oficina', mensajeEn: hace(500), recibidoEn: hace(480) }, salida_carga: hace(420),
      })), AHORA, politicas(2, 600),
    );
    const p = estadiasParaPapel(r)!;
    expect(p.renglones.map((x) => x.parada)).toEqual(['Carga', 'Descarga']);
    expect(p.renglones[0].respaldo).toMatch(/llegada: captura de oficina/);
  });

  it('otra moneda lleva su código, nunca un «$» que se lea como pesos', () => {
    const r = armarFilasEstadias(datos(viaje(), hitos({ llegada_carga: hace(400), salida_carga: hace(250) })), AHORA, politicas(2, 30, 'USD'));
    const cobro = estadiasParaPapel(r)!.renglones[0].cobro;
    expect(cobro).toBe('Propuesta: 1 h cobrables = 30.00 USD');
    expect(cobro).not.toContain('$');
  });

  it('la lectura truncada se declara', () => {
    const r = armarFilasEstadias(datos(viaje(), hitos({ llegada_carga: hace(400), salida_carga: hace(250) }), { truncada: true }), AHORA, politicas(2, 600));
    expect(estadiasParaPapel(r)!.truncada).toBe(true);
  });

  it('duracionTexto', () => {
    expect([duracionTexto(0), duracionTexto(45), duracionTexto(60), duracionTexto(125)]).toEqual(['0 min', '45 min', '1 h', '2 h 5 min']);
  });
});
