import { describe, it, expect } from 'vitest';
import { evaluarEscalamiento, detectarPresion, mensajesSinAtender, CONFIG_ESCALAMIENTO_POR_OMISION, type Hilo, type MensajeHilo } from './escalamiento';

const BASE = Date.parse('2026-11-23T12:00:00.000Z');
const min = (m: number): number => BASE + m * 60_000;
const c = (m: number, texto: string): MensajeHilo => ({ de: 'cliente', tsMs: min(m), texto });
const q = (m: number, texto: string, conDato?: boolean): MensajeHilo => ({ de: 'equipo', tsMs: min(m), texto, conDato });
const hilo = (ahoraMin: number, mensajes: MensajeHilo[], extra: Partial<Hilo> = {}): Hilo => ({ ahoraMs: min(ahoraMin), mensajes, ...extra });
const codigos = (h: Hilo, cfg?: Parameters<typeof evaluarEscalamiento>[1]): string[] => evaluarEscalamiento(h, cfg).motivos.map((m) => m.codigo);

describe('repregunta: anti-ruido', () => {
  it('una sola petición reciente no escala', () => {
    expect(evaluarEscalamiento(hilo(5, [c(0, 'eta de la caja 4?')])).nivel).toBe('ninguno');
  });
  it('una ráfaga de 3 líneas seguidas cuenta como UN mensaje', () => {
    const h = hilo(20, [c(0, 'datos'), c(0.5, 'de la unidad'), c(1, 'porfa')]);
    expect(mensajesSinAtender(h.mensajes, 2)).toHaveLength(1);
    expect(codigos(h)).not.toContain('repregunta_sin_dato');
  });
  it('2 peticiones con ≥ 10 min de espera sin dato → N1', () => {
    const r = evaluarEscalamiento(hilo(12, [c(0, 'que eta tenemos?'), c(11, 'mismo eta?')]));
    expect(r.nivel).toBe('N1');
    expect(r.motivos.map((m) => m.codigo)).toContain('repregunta_sin_dato');
    expect(r.destinatarioRol).toBe('encargado_turno');
  });
  it('2 peticiones con menos de 10 min no escalan', () => {
    expect(evaluarEscalamiento(hilo(8, [c(0, 'que eta tenemos?'), c(5, 'mismo eta?')])).nivel).toBe('ninguno');
  });
  it('3 mensajes en 30 min → repregunta; con presión → gerencia', () => {
    const r = evaluarEscalamiento(hilo(25, [c(0, 'datos?'), c(12, 'equipo?'), c(25, 'alguien en turno??')]));
    expect(r.nivel).toBe('N2');
    expect(r.motivos.map((m) => m.codigo)).toEqual(expect.arrayContaining(['repregunta_sin_dato', 'rafaga_de_presion']));
  });
  it('un acuse vacío del equipo no cierra la espera; una respuesta con dato sí', () => {
    const vacio = hilo(20, [c(0, 'me ayudan con la ccp?'), q(2, 'enterado')]);
    expect(codigos(vacio)).toContain('acuse_vacio_no_cierra');
    const conDato = hilo(20, [c(0, 'me ayudan con la ccp?'), q(2, 'CCP timbrada, te la mando por correo a las 12:15')]);
    expect(evaluarEscalamiento(conDato).nivel).toBe('ninguno');
    const forzado = hilo(20, [c(0, 'me ayudan con la ccp?'), q(2, 'ok', true)]);
    expect(evaluarEscalamiento(forzado).nivel).toBe('ninguno');
  });
  it('los umbrales son configurables', () => {
    const h = hilo(12, [c(0, 'eta?'), c(11, 'mismo eta?')]);
    expect(evaluarEscalamiento(h, { repreguntaEsperaMin: 30 }).nivel).toBe('ninguno');
    expect(CONFIG_ESCALAMIENTO_POR_OMISION).toMatchObject({ repreguntaEsperaMin: 10, repreguntaMensajes: 3, repreguntaVentanaMin: 30, silencioMin: 60 });
  });
});

describe('silencio, urgencia y presión', () => {
  it('silencio en un tema crítico ≥ 30 min → N1; ≥ 60 min en cualquiera → N2', () => {
    expect(codigos(hilo(31, [c(0, 'me ayudas colocando 2 cajas vacias?')]))).toContain('silencio_en_tema_critico');
    const largo = evaluarEscalamiento(hilo(61, [c(0, 'me ayudan con el pod?')]));
    expect(largo.nivel).toBe('N2');
    expect(largo.motivos.map((m) => m.codigo)).toContain('silencio_prolongado');
  });
  it('«me urge» → N1 de inmediato', () => {
    const r = evaluarEscalamiento(hilo(1, [c(0, 'me urge la ccp de la caja 4')]));
    expect(r.nivel).toBe('N1');
    expect(r.motivos.map((m) => m.codigo)).toContain('urgencia_declarada');
    expect(r.urgencia).toBe('A');
  });
  it('«cliente encima»: N1; N2 si hay repregunta, ETA muy inestable o la cita ya pasó', () => {
    expect(evaluarEscalamiento(hilo(1, [c(0, 'tengo al cliente presionando, eta?')])).nivel).toBe('N1');
    expect(evaluarEscalamiento(hilo(1, [c(0, 'tengo al cliente presionando, eta?')], { minutosParaCita: -5 })).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(1, [c(0, 'tengo al cliente presionando, eta?')], { etaNivel: 'N2' })).nivel).toBe('N2');
  });
  it('detectarPresion reconoce presión, amenaza comercial y dinero', () => {
    expect(detectarPresion('tengo al cliente encima')).toMatchObject({ presion: true, amenazaComercial: false });
    expect(detectarPresion('se cancelara el proyecto si no hay respuesta').amenazaComercial).toBe(true);
    expect(detectarPresion('habra cargo por el falso?').dinero).toBe(true);
    expect(detectarPresion('buenos dias')).toEqual({ presion: false, amenazaComercial: false, dinero: false });
  });
});

describe('turnos y esperas', () => {
  it('nadie en turno → gerencia de inmediato', () => {
    const r = evaluarEscalamiento(hilo(15, [c(0, 'alguien en turno?')], { turnoCubierto: false, franja: 'madrugada' }));
    expect(r.nivel).toBe('N2');
    expect(r.motivos.map((m) => m.codigo)).toEqual(expect.arrayContaining(['nadie_en_turno', 'madrugada_sin_acuse']));
  });
  it('cambio de turno con pendientes avisa al encargado', () => {
    expect(codigos(hilo(5, [c(0, 'eta?')], { franja: 'cambio_turno' }))).toContain('cambio_de_turno_con_pendientes');
  });
  it('operador esperando en planta: 60 min → N1, 5 h → N2, 10 h o sin comer → N3', () => {
    const n = (esp: number, extra: Partial<Hilo> = {}): string => evaluarEscalamiento(hilo(0, [], { operadorEsperandoMin: esp, ...extra })).nivel;
    expect(n(30)).toBe('ninguno');
    expect(n(60)).toBe('N1');
    expect(n(300)).toBe('N2');
    expect(n(600)).toBe('N3');
    expect(n(90, { operadorSinComerOSeRetira: true })).toBe('N3');
  });
  it('cita vencida sin unidad → gerencia; datos faltantes cerca de la cita → N1 y luego N2', () => {
    expect(evaluarEscalamiento(hilo(0, [], { minutosParaCita: -10, llegoAPlanta: false })).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(0, [], { faltantesBloqueantes: true, minutosParaCita: 80 })).nivel).toBe('N1');
    expect(evaluarEscalamiento(hilo(0, [], { faltantesBloqueantes: true, minutosParaCita: 20 })).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(0, [], { faltantesBloqueantes: true, minutosParaCita: 200 })).nivel).toBe('ninguno');
  });
});

describe('ruta, daño, seguridad y dinero', () => {
  it('parada no autorizada → N1 con monitoreo; detenida > 60 min → N2; desvío → N2', () => {
    const p = evaluarEscalamiento(hilo(0, [], { paradaNoAutorizada: true }));
    expect(p.nivel).toBe('N1');
    expect(p.rutasFuncionales).toContain('monitoreo');
    expect(p.urgencia).toBe('I');
    expect(evaluarEscalamiento(hilo(0, [], { unidadDetenidaMin: 35 })).nivel).toBe('N1');
    expect(evaluarEscalamiento(hilo(0, [], { unidadDetenidaMin: 70 })).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(0, [], { unidadDetenidaMin: 40, detenidaEnParadorAutorizado: true })).nivel).toBe('ninguno');
    expect(evaluarEscalamiento(hilo(0, [], { unidadDetenidaMin: 50, detenidaEnParadorAutorizado: true })).nivel).toBe('N1');
    expect(evaluarEscalamiento(hilo(0, [], { desvioDeRuta: true })).nivel).toBe('N2');
  });
  it('daño → N2 (N3 si zona de riesgo o material peligroso); salida sin autorización → N2', () => {
    expect(evaluarEscalamiento(hilo(0, [c(0, 'llanta suelta, alto total')])).nivel).toBe('N2');
    const n3 = evaluarEscalamiento(hilo(0, [c(0, 'accidente en la carretera')], { zonaDeRiesgoOHazmat: true }));
    expect(n3.nivel).toBe('N3');
    expect(n3.destinatarioRol).toBe('dueno');
    expect(evaluarEscalamiento(hilo(0, [], { salidaSinAutorizacionOFotos: true })).nivel).toBe('N2');
  });
  it('cambios de unidad: tras prealerta N1; dos en 60 min N2', () => {
    expect(evaluarEscalamiento(hilo(0, [], { cambiosDeUnidadEn60Min: 1, habiaPrealerta: true })).nivel).toBe('N1');
    expect(evaluarEscalamiento(hilo(0, [], { cambiosDeUnidadEn60Min: 2 })).nivel).toBe('N2');
  });
  it('cancelación y dinero → N2; con amenaza comercial → N3', () => {
    expect(evaluarEscalamiento(hilo(0, [c(0, 'cancelen la de mañana')])).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(0, [c(0, 'habra cargo por el falso?')])).nivel).toBe('N2');
    const a = evaluarEscalamiento(hilo(0, [c(0, 'si no hay respuesta se cancela el proyecto, mi director esta escalando')]));
    expect(a.nivel).toBe('N3');
    expect(a.destinatarioRol).toBe('dueno');
  });
  it('seguridad: número desconocido pidiendo datos del operador, custodia, texto de alerta', () => {
    const r = evaluarEscalamiento(hilo(0, [c(0, 'me das el telefono del operador de la caja 4?')], { solicitanteNoAutorizado: true }));
    expect(r.nivel).toBe('N2');
    expect(r.rutasFuncionales).toContain('seguridad');
    expect(evaluarEscalamiento(hilo(0, [c(0, 'se presentan 2 custodias por la caja 8')])).rutasFuncionales).toContain('seguridad');
  });
  it('documentos: CCP > 60 min, prealerta faltante, rechazo de caja, cambio de instrucción, cruce sin hito', () => {
    expect(evaluarEscalamiento(hilo(0, [], { ccpMinSinTimbrar: 61 })).rutasFuncionales).toContain('sistemas');
    expect(evaluarEscalamiento(hilo(0, [], { ccpMinSinTimbrar: 30 })).nivel).toBe('ninguno');
    expect(evaluarEscalamiento(hilo(0, [], { prealertaFaltanteEnCasetaMin: 31 })).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(0, [], { rechazoDeCaja: true })).rutasFuncionales).toContain('control_equipo');
    expect(evaluarEscalamiento(hilo(0, [c(0, 'entregar en otro destino')])).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(0, [c(0, 'cruzó la caja?')], { cruceSinHitoConfirmado: true })).rutasFuncionales).toContain('cruces');
  });
  it('facturación bloqueada y POD reclamado tarde → N2 a importación; pendientes de días → N2; KPI → N2', () => {
    expect(evaluarEscalamiento(hilo(0, [c(0, 'no podemos facturar sin el doda')])).rutasFuncionales).toContain('importacion_ccp');
    expect(evaluarEscalamiento(hilo(0, [c(0, 'me ayudan con el pod?')], { podPedidoHaceHoras: 30 })).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(0, [], { pendienteMasAntiguoDias: 7 })).nivel).toBe('N2');
    expect(evaluarEscalamiento(hilo(0, [c(0, 'ya es el segundo dia llegando tarde')])).nivel).toBe('N2');
  });
  it('fin de semana o festivo con autorización, CCP o incidencia → guardia', () => {
    const r = evaluarEscalamiento(hilo(0, [c(0, 'me ayudan con la ccp')], { finDeSemanaOFestivo: true }));
    expect(r.motivos.map((m) => m.codigo)).toContain('guardia_fin_de_semana');
    expect(r.motivos.find((m) => m.codigo === 'guardia_fin_de_semana')?.rol).toBe('guardia_fin_de_semana');
    expect(codigos(hilo(0, [c(0, 'hora de salida?')], { finDeSemanaOFestivo: true }))).not.toContain('guardia_fin_de_semana');
  });
  it('ETA que cambia: el nivel de la política de ETA se refleja', () => {
    expect(evaluarEscalamiento(hilo(0, [], { etaNivel: 'N1' })).nivel).toBe('N1');
    expect(evaluarEscalamiento(hilo(0, [], { etaNivel: 'N2' })).nivel).toBe('N2');
  });
});

describe('forma del resultado', () => {
  it('sin motivos: nivel ninguno y sin destinatario', () => {
    const r = evaluarEscalamiento(hilo(0, []));
    expect(r).toMatchObject({ nivel: 'ninguno', destinatarioRol: null, urgencia: null, motivos: [], rutasFuncionales: [] });
  });
  it('el destinatario es el del motivo de mayor nivel; las rutas funcionales se agregan', () => {
    const r = evaluarEscalamiento(hilo(0, [c(0, 'me urge la ccp')], { desvioDeRuta: true, ccpMinSinTimbrar: 90 }));
    expect(r.nivel).toBe('N2');
    expect(r.destinatarioRol).toBe('gerencia_operacion');
    expect(r.rutasFuncionales).toEqual(expect.arrayContaining(['monitoreo', 'sistemas']));
  });
  it('cubre disparadores del 1 al 30 (todos tienen un camino en el código)', () => {
    const vistos = new Set<number>();
    const casos: Array<[Hilo, Parameters<typeof evaluarEscalamiento>[1]?]> = [
      [hilo(25, [c(0, 'datos?'), c(12, 'equipo?'), c(25, 'alguien en turno??')])],
      [hilo(1, [c(0, 'me urge')])],
      [hilo(1, [c(0, 'tengo al cliente encima')])],
      [hilo(0, [], { minutosParaCita: -1, llegoAPlanta: false })],
      [hilo(0, [], { etaNivel: 'N1' })],
      [hilo(61, [c(0, 'eta?')])],
      [hilo(5, [c(0, 'eta?')], { franja: 'cambio_turno' })],
      [hilo(0, [], { turnoCubierto: false })],
      [hilo(0, [], { operadorEsperandoMin: 61 })],
      [hilo(0, [], { paradaNoAutorizada: true })],
      [hilo(0, [], { unidadDetenidaMin: 61 })],
      [hilo(0, [], { desvioDeRuta: true })],
      [hilo(0, [], { danoOIncidencia: true })],
      [hilo(0, [], { salidaSinAutorizacionOFotos: true })],
      [hilo(0, [], { cambiosDeUnidadEn60Min: 2 })],
      [hilo(0, [c(0, 'cancelen la de mañana')])],
      [hilo(0, [c(0, 'habra cargo por el falso?')])],
      [hilo(0, [c(0, 'se cancela el proyecto')])],
      [hilo(0, [c(0, 'no podemos facturar sin doda, me ayudan con el pod?')])],
      [hilo(0, [], { ccpMinSinTimbrar: 61 })],
      [hilo(0, [], { prealertaFaltanteEnCasetaMin: 31 })],
      [hilo(0, [], { rechazoDeCaja: true })],
      [hilo(0, [c(0, 'se presentan 2 custodias')])],
      [hilo(0, [c(0, 'entregar en otro destino')])],
      [hilo(0, [c(0, 'cruzó?')], { cruceSinHitoConfirmado: true })],
      [hilo(0, [], { faltantesBloqueantes: true, minutosParaCita: 20 })],
      [hilo(0, [], { pendienteMasAntiguoDias: 9 })],
      [hilo(0, [c(0, 'ya es el segundo dia llegando tarde')])],
      [hilo(0, [c(0, 'me ayudan con la ccp')], { finDeSemanaOFestivo: true })],
    ];
    for (const [h, cfg] of casos) for (const m of evaluarEscalamiento(h, cfg).motivos) vistos.add(m.disparador);
    for (let i = 1; i <= 30; i++) expect(vistos.has(i), `disparador ${i}`).toBe(true);
  });
  it('no lanza con datos raros', () => {
    expect(() => evaluarEscalamiento({ ahoraMs: NaN, mensajes: [{ de: 'cliente', tsMs: NaN, texto: undefined as unknown as string }] })).not.toThrow();
    expect(() => evaluarEscalamiento({ ahoraMs: 0, mensajes: undefined as unknown as MensajeHilo[] })).not.toThrow();
  });
});
