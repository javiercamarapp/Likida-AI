import { describe, it, expect } from 'vitest';
import { DIALOGOS_DORADOS, DIALOGOS_PROACTIVOS, type DialogoDorado, type HoraLocal } from './dialogos_dorados.fixture';
import { detectarSolicitudes, tiposDePeticion } from './taxonomia';
import { decidirAccion, entradaDesdeHilo } from './decidir';
import { evaluarEscalamiento, type Hilo, type MensajeHilo } from './escalamiento';
import { evaluarEta } from './politica_eta';
import { mezclarReglas, REGLAS_POR_OMISION } from './reglas_cliente';
import { render } from './plantillas';

const BASE = Date.parse('2026-11-23T00:00:00.000Z');
const ms = (h: HoraLocal | string): number => BASE + (Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))) * 60_000;
const iso = (h: HoraLocal | string): string => new Date(ms(h)).toISOString();

function correr(d: DialogoDorado) {
  const mensajes: MensajeHilo[] = d.mensajes.map((m) => ({ de: m.de === 'cliente' ? 'cliente' : 'equipo', tsMs: ms(m.hora), texto: m.texto }));
  const ahoraMs = ms(d.ahora ?? d.mensajes[d.mensajes.length - 1].hora);
  const ev = d.eta
    ? evaluarEta({
      ahoraMs, citaIso: d.eta.cita ? iso(d.eta.cita) : null, config: { zonaHoraria: d.eta.zona === undefined ? null : d.eta.zona },
      historial: d.eta.historial.map((h) => ({ etaIso: iso(h.eta), actualizadoIso: iso(h.actualizado), punto: h.punto, fuente: h.fuente ?? 'persona', causa: h.causa ?? null })),
    })
    : undefined;
  const hilo: Hilo = { ahoraMs, mensajes, etaNivel: ev?.nivel, minutosParaCita: d.eta?.cita ? Math.round((ms(d.eta.cita) - ahoraMs) / 60_000) : undefined, ...d.hilo };
  const entrada = entradaDesdeHilo(hilo, d.datos, {
    contexto: { ...(ev ? { eta: ev } : {}), ...d.contexto },
    config: { reglas: mezclarReglas(REGLAS_POR_OMISION, d.reglas), ...d.config },
    texto: d.texto, tipos: d.tipos,
  });
  const decision = decidirAccion(entrada);
  const esc = evaluarEscalamiento(hilo);
  return { decision, esc, entrada };
}

const ordenados = (xs: readonly string[]): string[] => [...xs].sort();

describe('diálogos dorados D01-D67: clasificar, decidir y escalar', () => {
  it('son más de 55 y sus ids son únicos', () => {
    expect(DIALOGOS_DORADOS.length).toBeGreaterThanOrEqual(55);
    expect(new Set(DIALOGOS_DORADOS.map((d) => d.id)).size).toBe(DIALOGOS_DORADOS.length);
  });

  for (const d of DIALOGOS_DORADOS) {
    it(`${d.id} · ${d.titulo}`, () => {
      const { decision, esc } = correr(d);
      const x = d.esperado;
      expect(decision.accion, `acción (${decision.motivo})`).toBe(x.accion);
      expect(decision.nivelAviso, 'nivel de aviso').toBe(x.nivelAviso);
      if (x.tiposContienen) expect(decision.tipos).toEqual(expect.arrayContaining([...x.tiposContienen]));
      if (x.camposFaltantes) expect(ordenados(decision.camposFaltantes)).toEqual(ordenados(x.camposFaltantes));
      if (x.plantillaId !== undefined) expect(decision.plantillaId ?? null).toBe(x.plantillaId);
      if (x.envioParcial !== undefined) expect(decision.envioParcial).toBe(x.envioParcial);
      if (x.motivoContiene) expect(decision.motivo).toContain(x.motivoContiene);
      for (const n of x.nuncaContiene ?? []) expect(decision.nuncaDecir).toContain(n);
      if (x.escalamiento) {
        expect(esc.nivel, `escalamiento: ${esc.motivos.map((m) => m.codigo).join(',')}`).toBe(x.escalamiento.nivel);
        for (const m of x.escalamiento.motivos ?? []) expect(esc.motivos.map((y) => y.codigo)).toContain(m);
        for (const r of x.escalamiento.rutas ?? []) expect(esc.rutasFuncionales).toContain(r);
      }
    });
  }
});

describe('invariantes que valen para TODOS los diálogos', () => {
  const todos = DIALOGOS_DORADOS.map((d) => ({ d, ...correr(d) }));

  it('nunca se autoenvía: toda respuesta espera aprobación (ninguna flota lo autorizó)', () => {
    for (const { d, decision } of todos) expect(decision.requiereAprobacion, d.id).toBe(true);
  });
  it('si falta un dato, la acción es pedirlo a una persona con los campos que faltan; nunca se inventa', () => {
    for (const { d, decision } of todos) {
      if (decision.accion === 'pedir_dato_a_persona') expect(decision.camposFaltantes.length, d.id).toBeGreaterThan(0);
      if (decision.accion === 'responder_con_datos') expect(decision.camposFaltantes, d.id).toEqual([]);
    }
  });
  it('lo que nunca se contesta con datos (CCP, salida, falso, cambios, daño, custodia, operador) jamás es responder_con_datos', () => {
    const duros = new Set(['ccp', 'autorizacion_salida', 'cancelacion_falso', 'cambio_instruccion', 'cambio_unidad_operador', 'incidencia', 'datos_operador', 'custodia']);
    for (const { d, decision } of todos) {
      if (decision.tipos.some((t) => duros.has(t))) expect(decision.accion, d.id).not.toBe('responder_con_datos');
    }
  });
  it('siempre lleva la lista de lo que nunca debe decirse', () => {
    for (const { d, decision } of todos) expect(decision.nuncaDecir.length, d.id).toBeGreaterThan(5);
  });
  it('toda acción hacia una persona trae un nivel de aviso', () => {
    for (const { d, decision } of todos) {
      if (['avisar_encargado', 'escalar_gerente', 'pedir_dato_a_persona', 'prohibido'].includes(decision.accion)) expect(decision.nivelAviso, d.id).not.toBeNull();
    }
  });
  it('lo que reconoce `detectarSolicitudes` sobre el texto pendiente coincide con los tipos de la decisión (salvo override)', () => {
    for (const { d, decision, entrada } of todos) {
      if (d.tipos || entrada.contexto?.programaRecibido) continue;
      const det = tiposDePeticion(detectarSolicitudes(entrada.texto));
      if (det.length > 0) expect(decision.tipos, d.id).toEqual(expect.arrayContaining(det));
    }
  });
});

describe('diálogos que son disparos del sistema (sin mensaje del cliente)', () => {
  it('D04 · ficha lista antes de que la pidan: se arma completa sin «pendiente de confirmar»', () => {
    expect(DIALOGOS_PROACTIVOS).toContain('D04');
    const r = render('ficha_unidad', { ref: 'R1', linea: 'LIN', numeroCaja: '12', placasCaja: 'ABC123', estadoCaja: 'ESTADO', eco: 'E4', placaTracto: 'XYZ987', operadorNombre: 'Operador Uno Dos', sello: 'S-1', tipoTracto: 'regular', accesorios: '2 straps', cuentaEspejo: 'https://ejemplo.test/ce', cita: '10:00', eta: '09:20', etaActualizado: '02:55', etaPunto: 'planta' });
    expect(r.camposFaltantes).toEqual([]);
    expect(r.texto).not.toContain('pendiente de confirmar');
  });
  it('D08 · retraso previsto 2 h antes de la cita: se avisa al encargado a tiempo', () => {
    expect(DIALOGOS_PROACTIVOS).toContain('D08');
    const ev = evaluarEta({
      ahoraMs: ms('07:15'), citaIso: iso('10:00'), config: { zonaHoraria: 'Centro' },
      historial: [{ etaIso: iso('11:30'), actualizadoIso: iso('07:05'), punto: 'planta', fuente: 'persona', causa: null }],
    });
    expect(ev.avisarRetraso).toBe(true);
    expect(ev.avisoTarde).toBe(false);
    expect(ev.retrasoVsCitaMin).toBe(90);
    expect(ev.nivel).toBe('N2');
    const ya = evaluarEta({ ahoraMs: ms('07:15'), citaIso: iso('10:00'), retrasoAvisadoIso: iso('07:10'), config: { zonaHoraria: 'Centro' }, historial: [{ etaIso: iso('11:30'), actualizadoIso: iso('07:05'), punto: 'planta', fuente: 'persona', causa: null }] });
    expect(ya.avisarRetraso).toBe(false);
  });
});
