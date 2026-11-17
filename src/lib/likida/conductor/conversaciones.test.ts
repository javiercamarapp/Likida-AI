import { describe, it, expect } from 'vitest';
import { armarHilo, armarListaConv, conteosConv, contactosDeAtencion, estadoDe, filtrarConv, prioridadDe, type DatosHilo, type HitoEstadoConv, type ViajeConv } from './conversaciones';

const AHORA = new Date('2026-11-17T18:00:00.000Z');
const hace = (m: number) => new Date(AHORA.getTime() - m * 60_000).toISOString();
const en = (m: number) => new Date(AHORA.getTime() + m * 60_000).toISOString();
const v = (id: string, extra: Partial<ViajeConv> = {}): ViajeConv => ({
  id, folio: `F-${id}`, origen: 'A', destino: 'B', operadorId: `o-${id}`, operadorNombre: `Op ${id}`, terminalId: 't1', terminalNombre: 'Patio',
  avisadoEn: hace(60), aceptadoEn: null, aceptadoOrigen: null, escaladoEn: null, avisosEnviados: 1, citaOrigenEn: null, citaDestinoEn: null, operadorSinTelefono: false, ...extra,
});

describe('estado de la conversación', () => {
  it('cada viaje cae en un solo estado y sin aviso ni problema de teléfono no hay conversación', () => {
    expect(estadoDe(v('1', { aceptadoEn: hace(10) }), [])).toBe('acepto');
    expect(estadoDe(v('2'), [])).toBe('sin_respuesta');
    expect(estadoDe(v('3', { escaladoEn: hace(5) }), [])).toBe('escalado');
    expect(estadoDe(v('4', { avisadoEn: null, operadorSinTelefono: true }), [])).toBe('sin_telefono');
    expect(estadoDe(v('5', { avisadoEn: null }), [])).toBeNull();
    // Teléfono no leído: no se afirma «sin teléfono».
    expect(estadoDe(v('6', { avisadoEn: null, operadorSinTelefono: null }), [])).toBeNull();
  });
  it('un hito escalado cuenta como escalado aunque el operador haya aceptado', () => {
    expect(estadoDe(v('1', { aceptadoEn: hace(10) }), [{ viajeId: '1', tipo: 'llegada_carga', estado: 'escalado' }])).toBe('escalado');
  });
});

describe('prioridad por cita', () => {
  it('urgente a menos de 4 h o vencida; hoy a menos de 24 h; con tiempo después; sin cita sin dato', () => {
    expect(prioridadDe(-30)).toBe('alta');
    expect(prioridadDe(120)).toBe('alta');
    expect(prioridadDe(600)).toBe('media');
    expect(prioridadDe(3000)).toBe('baja');
    expect(prioridadDe(null)).toBe('sin_cita');
  });
});

describe('lista ordenada', () => {
  const viajes = [
    v('acepto', { aceptadoEn: hace(5), citaOrigenEn: en(30) }),
    v('viejo-sin-cita', { avisadoEn: hace(600) }),
    v('urgente-nuevo', { avisadoEn: hace(30), citaOrigenEn: en(60) }),
    v('urgente-viejo', { avisadoEn: hace(300), citaOrigenEn: en(90) }),
    v('sin-tel', { avisadoEn: null, operadorSinTelefono: true }),
    v('ignorado', { avisadoEn: null }),
  ];
  const lista = armarListaConv(viajes, [], AHORA);
  it('los que no responden van arriba: urgencia de cita y luego el más viejo; los que aceptaron al final', () => {
    expect(lista.map((f) => f.viaje.id)).toEqual(['urgente-viejo', 'urgente-nuevo', 'viejo-sin-cita', 'sin-tel', 'acepto']);
  });
  it('minutos sin respuesta reales y nulos donde no aplican', () => {
    const por = Object.fromEntries(lista.map((f) => [f.viaje.id, f]));
    expect(por['urgente-viejo'].minutosSinRespuesta).toBe(300);
    expect(por['sin-tel'].minutosSinRespuesta).toBeNull();
    expect(por['acepto'].minutosSinRespuesta).toBeNull();
  });
  it('cuenta y filtra por estado', () => {
    expect(conteosConv(lista)).toEqual({ escalado: 0, sin_respuesta: 3, sin_telefono: 1, acepto: 1 });
    expect(filtrarConv(lista, 'acepto').map((f) => f.viaje.id)).toEqual(['acepto']);
    expect(filtrarConv(lista, '')).toHaveLength(5);
  });
  it('la cita pendiente pasa de la carga a la descarga cuando ya llegó a cargar', () => {
    const hitos: HitoEstadoConv[] = [{ viajeId: 'x', tipo: 'llegada_carga', estado: 'recibido' }];
    const [f] = armarListaConv([v('x', { aceptadoEn: hace(5), citaOrigenEn: hace(100), citaDestinoEn: en(2000) })], hitos, AHORA);
    expect(f.citaTipo).toBe('descarga');
    expect(f.prioridad).toBe('baja');
  });
  it('lista vacía sin viajes', () => { expect(armarListaConv([], [], AHORA)).toEqual([]); });
});

describe('hilo', () => {
  const datos: DatosHilo = {
    viaje: v('1', { avisadoEn: hace(300), aceptadoEn: hace(240), avisosEnviados: 2 }),
    hitos: [{ id: 'h1', tipo: 'llegada_carga', estado: 'validado', fuente: 'texto', mensajeEn: hace(100), recibidoEn: hace(99), texto: 'ya llegué', lat: null, lng: null, conFoto: false, contacto: null, sinContacto: false, validadoEn: hace(98), validadoPor: 'gps', omitidoMotivo: null, escaladoEn: null, escalacionNivel: 0, atendidaEn: null }],
    avisos: [{ id: 'a1', hitoTipo: 'llegada_carga', clase: 'solicitud', nivel: 0, ok: true, canal: 'texto', motivo: null, ult4: '1234', en: hace(200) }],
    validaciones: [{ hitoId: 'h1', resultado: 'validado', motivo: null, fuente: 'gps', distanciaM: 80, toleranciaM: 150, radioM: 200, medidaEn: hace(100), en: hace(98) }],
    eventos: [{ id: 1, hitoTipo: 'llegada_carga', evento: 'recibido', en: hace(99) }, { id: 2, hitoTipo: 'llegada_carga', evento: 'pospuesto', en: hace(150) }],
    escalaciones: [{ id: 'e1', destino: 'jefe_de_trafico', motivo: 'operador_sin_respuesta', estado: 'atendida', resumen: 'No contesta', en: hace(250), atendidaEn: hace(245), nota: 'Llamado' }],
  };
  it('va en orden cronológico, con aviso, aceptación, respuesta, veredicto y escalación; sin duplicar eventos ya pintados', () => {
    const h = armarHilo(datos);
    expect(h.map((x) => x.tipo)).toEqual(['aviso_viaje', 'escalacion', 'escalacion_atendida', 'acepto', 'aviso', 'evento', 'hito', 'validacion']);
    expect(h.find((x) => x.tipo === 'hito')).toMatchObject({ actor: 'operador' });
  });
  it('sin datos no inventa mensajes', () => {
    expect(armarHilo({ viaje: v('2', { avisadoEn: null }), hitos: [], avisos: [], validaciones: [], eventos: [], escalaciones: [] })).toEqual([]);
  });
  it('quién atiende: del patio del viaje primero y los de toda la flota como respaldo', () => {
    const c = contactosDeAtencion([
      { nombre: 'Jefe', nivel: 2, terminalId: null, ult4: '1111' }, { nombre: 'Patio A', nivel: 1, terminalId: 't1', ult4: '2222' }, { nombre: 'Otro patio', nivel: 1, terminalId: 't9', ult4: '3333' },
    ], 't1');
    expect(c.map((x) => x.nombre)).toEqual(['Patio A', 'Jefe']);
  });
});
