import { describe, it, expect } from 'vitest';
import { anclaDe, planificar, textoTiempo, type EntradaPlan, type AvisoReclamado } from './planificador';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';

// Hora de México = UTC-6. 2026-10-02 es viernes.
const mx = (hhmm: string, dia = '2026-10-02') => new Date(`${dia}T${hhmm}:00-06:00`);
const cfg = (c: Partial<ConfigConductor> = {}): ConfigConductor => ({ ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [0, 15, 30, 45], diasSemana: [1, 2, 3, 4, 5, 6, 7], ...c });

function hitos(estados: Partial<Record<TipoHito, Partial<HitoFila>>> = {}): HitoFila[] {
  return TIPOS_HITO.map((tipo, i) => hitoVacio({ id: `h${i}`, tipo, viajeId: 'v1', ...(estados[tipo] ?? {}) }));
}
const reg = (hhmm: string, extra: Partial<HitoFila> = {}): Partial<HitoFila> => ({
  estado: 'recibido', fuente: 'texto', mensajeEn: mx(hhmm).toISOString(), recibidoEn: mx(hhmm).toISOString(), ...extra,
});
const aviso = (hitoId: string, clase: AvisoReclamado['clase'], nivel: number, ciclo = 1) => ({ hitoId, clase, nivel, ciclo });

function plan(o: Partial<EntradaPlan> & { ahora: Date }) {
  return planificar({
    viaje: viajeBase({ citaOrigenEn: mx('08:00').toISOString() }), hitos: hitos(), config: cfg(), enviadosHoyChofer: 0, avisos: [], ...o,
  });
}

describe('el ancla de cada hito (cuándo «toca»)', () => {
  const v = viajeBase({ aceptadoEn: mx('06:00').toISOString() });

  it('llegada a carga: la cita menos el anticipo', () => {
    const a = anclaDe(hitos()[0], { ...v, citaOrigenEn: mx('09:00').toISOString() }, hitos(), cfg());
    expect(a?.toISOString()).toBe(mx('08:30').toISOString());
  });

  it('la cita manda sobre la ETA; sin cita se usa la ETA', () => {
    const conAmbas = anclaDe(hitos()[0], { ...v, citaOrigenEn: mx('09:00').toISOString(), etaOrigenEn: mx('11:00').toISOString() }, hitos(), cfg());
    expect(conAmbas?.toISOString()).toBe(mx('08:30').toISOString());
    const soloEta = anclaDe(hitos()[0], { ...v, etaOrigenEn: mx('11:00').toISOString() }, hitos(), cfg());
    expect(soloEta?.toISOString()).toBe(mx('10:30').toISOString());
  });

  it('sin cita ni ETA: aceptación + plazo por defecto (un SUPUESTO de la flota)', () => {
    const a = anclaDe(hitos()[0], v, hitos(), cfg({ esperaSinCitaMin: 120 }));
    expect(a?.toISOString()).toBe(mx('08:00').toISOString());
  });

  it('una cita ya pasada al aceptar no ancla antes de la aceptación', () => {
    const a = anclaDe(hitos()[0], { ...v, aceptadoEn: mx('10:00').toISOString(), citaOrigenEn: mx('08:00').toISOString() }, hitos(), cfg());
    expect(a?.toISOString()).toBe(mx('10:00').toISOString());
  });

  it('salida de carga: la llegada registrada + espera de carga', () => {
    const hs = hitos({ llegada_carga: reg('08:10') });
    expect(anclaDe(hs[1], v, hs, cfg({ esperaCargaMin: 90 }))?.toISOString()).toBe(mx('09:40').toISOString());
  });

  it('llegada a descarga: la cita del destino menos el anticipo, pero NUNCA antes de salir de la carga', () => {
    const hs = hitos({ llegada_carga: reg('08:00'), salida_carga: reg('10:00') });
    const conCita = anclaDe(hs[2], { ...v, citaDestinoEn: mx('15:00').toISOString() }, hs, cfg());
    expect(conCita?.toISOString()).toBe(mx('14:30').toISOString());
    const citaVieja = anclaDe(hs[2], { ...v, citaDestinoEn: mx('09:00').toISOString() }, hs, cfg());
    expect(citaVieja?.toISOString()).toBe(mx('10:00').toISOString());
  });

  it('llegada a descarga sin cita: salida de carga + trayecto por defecto', () => {
    const hs = hitos({ llegada_carga: reg('08:00'), salida_carga: reg('10:00') });
    expect(anclaDe(hs[2], v, hs, cfg({ trayectoSinEtaMin: 300 }))?.toISOString()).toBe(mx('15:00').toISOString());
  });

  it('salida de descarga y regreso se cuelgan del hito previo registrado', () => {
    const hs = hitos({ llegada_carga: reg('08:00'), salida_carga: reg('09:00'), llegada_descarga: reg('15:00'), salida_descarga: reg('16:00') });
    expect(anclaDe(hs[3], v, hs, cfg({ esperaDescargaMin: 60 }))?.toISOString()).toBe(mx('16:00').toISOString());
    expect(anclaDe(hs[4], v, hs, cfg({ regresoMin: 30 }))?.toISOString()).toBe(mx('16:30').toISOString());
  });

  it('un viaje que no se ha aceptado y no trae cita no tiene ancla (todavía no se persigue)', () => {
    expect(anclaDe(hitos()[0], viajeBase({ aceptadoEn: null }), hitos(), cfg())).toBeNull();
  });

  it('un aplazamiento («voy con retraso») recorre el ancla', () => {
    const hs = hitos({ llegada_carga: { pospuestoHasta: mx('09:30').toISOString() } });
    expect(anclaDe(hs[0], viajeBase({ citaOrigenEn: mx('08:00').toISOString() }), hs, cfg())?.toISOString()).toBe(mx('09:30').toISOString());
  });
});

describe('la escalera de recordatorios al chofer (0 / +15 / +30 / +45)', () => {
  // Ancla de llegada a carga = 07:30 (cita 08:00 − 30 min).
  it('antes del ancla no toca', () => {
    expect(plan({ ahora: mx('07:29') })).toEqual({ tipo: 'nada', motivo: 'no_toca' });
  });

  it('en el ancla sale la SOLICITUD (nivel 0)', () => {
    expect(plan({ ahora: mx('07:30') })).toMatchObject({ tipo: 'chofer', clase: 'solicitud', nivel: 0 });
  });

  it('cada recordatorio sale en su minuto, uno por corrida', () => {
    const base = [aviso('h0', 'solicitud', 0)];
    expect(plan({ ahora: mx('07:44'), avisos: base })).toEqual({ tipo: 'nada', motivo: 'espera' });
    expect(plan({ ahora: mx('07:45'), avisos: base })).toMatchObject({ tipo: 'chofer', clase: 'recordatorio', nivel: 1 });
    expect(plan({ ahora: mx('08:00'), avisos: [...base, aviso('h0', 'recordatorio', 1)] })).toMatchObject({ nivel: 2 });
    expect(plan({ ahora: mx('08:15'), avisos: [...base, aviso('h0', 'recordatorio', 1), aviso('h0', 'recordatorio', 2)] })).toMatchObject({ nivel: 3 });
  });

  it('si el cron estuvo caído manda SOLO el nivel más alto vencido (insistir es escalar, nunca repetir)', () => {
    const p = plan({ ahora: mx('08:20'), avisos: [aviso('h0', 'solicitud', 0)] });
    expect(p).toMatchObject({ tipo: 'chofer', nivel: 3 });
  });

  it('un nivel ya reclamado no se vuelve a mandar (idempotencia entre corridas)', () => {
    const avisos = [aviso('h0', 'solicitud', 0)];
    const a = plan({ ahora: mx('07:35'), avisos });
    expect(a).toEqual({ tipo: 'nada', motivo: 'espera' });
  });

  it('un claim de OTRO ciclo (hito corregido o pospuesto) no cuenta: la escalera reinicia', () => {
    const hs = hitos({ llegada_carga: { ciclo: 2 } });
    expect(plan({ ahora: mx('07:35'), hitos: hs, avisos: [aviso('h0', 'solicitud', 0, 1)] })).toMatchObject({ tipo: 'chofer', nivel: 0 });
  });

  it('la escalera es configurable por flota', () => {
    const p = plan({ ahora: mx('07:40'), config: cfg({ solicitudesMin: [0, 5, 10], escalarTrasMin: 60 }), avisos: [aviso('h0', 'solicitud', 0)] });
    expect(p).toMatchObject({ tipo: 'chofer', nivel: 2 });
  });

  it('solo se persigue el hito ACTIVO: con la llegada registrada se pide la salida, no se repite la llegada', () => {
    const hs = hitos({ llegada_carga: reg('07:40') });
    const p = plan({ ahora: mx('09:40'), hitos: hs });
    expect(p).toMatchObject({ tipo: 'chofer', nivel: 0, hito: { tipo: 'salida_carga' } });
  });

  it('un viaje completo no se persigue', () => {
    const todo = Object.fromEntries(TIPOS_HITO.map((t) => [t, reg('08:00')]));
    expect(plan({ ahora: mx('20:00'), hitos: hitos(todo) })).toEqual({ tipo: 'nada', motivo: 'completo' });
  });
});

describe('nunca de madrugada, y con tope diario', () => {
  it('fuera de la ventana de la flota no se manda nada (ni solicitud ni escalación)', () => {
    const v = viajeBase({ citaOrigenEn: mx('02:00').toISOString(), aceptadoEn: mx('12:00', '2026-10-01').toISOString() });
    expect(plan({ ahora: mx('03:00'), viaje: v })).toEqual({ tipo: 'nada', motivo: 'fuera_de_ventana' });
    expect(plan({ ahora: mx('05:59'), viaje: v })).toEqual({ tipo: 'nada', motivo: 'fuera_de_ventana' });
    expect(plan({ ahora: mx('22:00'), viaje: v })).toEqual({ tipo: 'nada', motivo: 'fuera_de_ventana' });
    expect(plan({ ahora: mx('06:00'), viaje: v })).toMatchObject({ tipo: 'chofer' });
  });

  it('la escalación al jefe también espera a que abra la ventana', () => {
    const v = viajeBase({ citaOrigenEn: mx('20:00').toISOString(), aceptadoEn: mx('12:00', '2026-10-01').toISOString() });
    const avisos = [aviso('h0', 'solicitud', 0), aviso('h0', 'recordatorio', 1), aviso('h0', 'recordatorio', 2), aviso('h0', 'recordatorio', 3)];
    expect(plan({ ahora: mx('23:30'), viaje: v, avisos })).toEqual({ tipo: 'nada', motivo: 'fuera_de_ventana' });
  });

  it('respeta los días de la ventana (domingo apagado)', () => {
    const c = cfg({ diasSemana: [1, 2, 3, 4, 5, 6] });
    const v = viajeBase({ citaOrigenEn: mx('08:00', '2026-10-04').toISOString() });
    expect(plan({ ahora: mx('09:00', '2026-10-04'), viaje: v, config: c })).toEqual({ tipo: 'nada', motivo: 'fuera_de_ventana' });
  });

  it('el tope diario por chofer frena los mensajes proactivos', () => {
    expect(plan({ ahora: mx('07:30'), enviadosHoyChofer: 12 })).toEqual({ tipo: 'nada', motivo: 'tope_diario' });
    expect(plan({ ahora: mx('07:30'), enviadosHoyChofer: 11 })).toMatchObject({ tipo: 'chofer' });
    expect(plan({ ahora: mx('07:30'), enviadosHoyChofer: 3, config: cfg({ topeDiarioChofer: 3 }) })).toEqual({ tipo: 'nada', motivo: 'tope_diario' });
  });

  it('la flota apagada y el viaje cerrado no se tocan', () => {
    expect(plan({ ahora: mx('07:30'), config: cfg({ activo: false }) })).toEqual({ tipo: 'nada', motivo: 'flota_apagada' });
    expect(plan({ ahora: mx('07:30'), viaje: viajeBase({ estatus: 'liquidado', citaOrigenEn: mx('08:00').toISOString() }) })).toEqual({ tipo: 'nada', motivo: 'viaje_no_aplica' });
  });
});

describe('la escalación al jefe de tráfico', () => {
  const escalera = [aviso('h0', 'solicitud', 0), aviso('h0', 'recordatorio', 1), aviso('h0', 'recordatorio', 2), aviso('h0', 'recordatorio', 3)];

  it('a los +90 min, tras la escalera, sube al nivel 1 (patio responsable)', () => {
    expect(plan({ ahora: mx('08:59'), avisos: escalera })).toEqual({ tipo: 'nada', motivo: 'espera' });
    expect(plan({ ahora: mx('09:00'), avisos: escalera })).toMatchObject({ tipo: 'escalar', nivel: 1, motivo: 'sin_respuesta' });
  });

  it('con el nivel 1 reclamado espera `segundoNivelMin` y sube al nivel 2 (jefe general)', () => {
    const conN1 = [...escalera, aviso('h0', 'escalacion', 1)];
    expect(plan({ ahora: mx('09:29'), avisos: conN1 })).toEqual({ tipo: 'nada', motivo: 'ya_escalado' });
    expect(plan({ ahora: mx('09:30'), avisos: conN1 })).toMatchObject({ tipo: 'escalar', nivel: 2 });
  });

  it('agotados los dos niveles no se vuelve a escalar', () => {
    const todos = [...escalera, aviso('h0', 'escalacion', 1), aviso('h0', 'escalacion', 2)];
    expect(plan({ ahora: mx('12:00'), avisos: todos })).toEqual({ tipo: 'nada', motivo: 'ya_escalado' });
  });

  it('«ya lo atiendo» detiene toda insistencia (a chofer y a jefe)', () => {
    const hs = hitos({ llegada_carga: { estado: 'escalado', escaladoEn: mx('09:00').toISOString(), escalacionNivel: 1, escalacionAtendidaEn: mx('09:05').toISOString() } });
    expect(plan({ ahora: mx('09:40'), hitos: hs, avisos: [...escalera, aviso('h0', 'escalacion', 1)] })).toEqual({ tipo: 'nada', motivo: 'atendido' });
  });

  it('si nunca se le escribió al chofer, primero se le escribe (aunque ya haya pasado el plazo de escalar)', () => {
    expect(plan({ ahora: mx('11:00') })).toMatchObject({ tipo: 'chofer', nivel: 3 });
  });

  it('un chofer sin teléfono no recibe la escalera y se escala al cumplirse el plazo, diciendo por qué', () => {
    const v = viajeBase({ operadorTelefono: null, citaOrigenEn: mx('08:00').toISOString() });
    expect(plan({ ahora: mx('08:00'), viaje: v })).toEqual({ tipo: 'nada', motivo: 'espera' });
    expect(plan({ ahora: mx('09:00'), viaje: v })).toMatchObject({ tipo: 'escalar', nivel: 1, motivo: 'sin_telefono' });
  });

  it('el aviso de otro hito del MISMO viaje no cuenta para el hito activo', () => {
    const ajeno = [aviso('h1', 'solicitud', 0), aviso('h1', 'recordatorio', 1)];
    expect(plan({ ahora: mx('07:30'), avisos: ajeno })).toMatchObject({ tipo: 'chofer', nivel: 0 });
  });
});

describe('textoTiempo', () => {
  it('lo que lee el chofer', () => {
    expect(textoTiempo(1)).toBe('1 minuto');
    expect(textoTiempo(30)).toBe('30 minutos');
    expect(textoTiempo(60)).toBe('1 hora');
    expect(textoTiempo(65)).toBe('1 hora y 5 minutos');
    expect(textoTiempo(150)).toBe('2 horas y 30 minutos');
    expect(textoTiempo(-5)).toBe('0 minutos');
  });
});
