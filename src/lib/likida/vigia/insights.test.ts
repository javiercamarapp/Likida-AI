import { describe, it, expect } from 'vitest';
import {
  avisosEnviados, porcentajeATiempo, minutosAhorrados, primeraRespuesta, primeraRespuestaGlobal, mensajesPriorizados, tarjetasInsights,
  type AvisoInsight, type MensajeInsight,
} from './insights';

// Series SINTÉTICAS: ningún dato real, ningún nombre del cliente.
const T0 = Date.parse('2026-10-01T12:00:00Z');
const h = (horas: number) => new Date(T0 + horas * 3_600_000).toISOString();
const aviso = (estado: string, enviadoHoras: number | null, citaHoras: number | null): AvisoInsight => ({
  estado, enviadoEn: enviadoHoras === null ? null : h(enviadoHoras), citaEn: citaHoras === null ? null : h(citaHoras),
});
const msg = (clienteId: string, minEspera: number | null, prioridad?: number): MensajeInsight => ({
  clienteId, entranteEn: h(0), atendidoEn: minEspera === null ? null : new Date(T0 + minEspera * 60_000).toISOString(), prioridad,
});

describe('avisos enviados y a tiempo', () => {
  const avisos = [aviso('enviado', 0, 5), aviso('enviado', 0, 2), aviso('enviado', 0, 1), aviso('enviado', 0, null), aviso('borrador', null, 9), aviso('fallido', null, 9)];
  it('solo cuentan los enviados con fecha', () => {
    expect(avisosEnviados(avisos)).toBe(4);
    expect(avisosEnviados([aviso('enviado', null, 3)])).toBe(0);
  });
  it('a tiempo = enviado <= cita - N h; sin cita no entra al denominador', () => {
    // N=2: cita +5 (3 h antes: sí), +2 (exactamente 2 h: sí), +1 (1 h: no); la fila sin cita no cuenta.
    expect(porcentajeATiempo(avisos, 2)).toEqual({ conCita: 3, aTiempo: 2, porcentaje: 66.7 });
    expect(porcentajeATiempo(avisos, 4)).toEqual({ conCita: 3, aTiempo: 1, porcentaje: 33.3 });
  });
  it('sin avisos con cita el porcentaje es null, no 0', () => {
    expect(porcentajeATiempo([], 2).porcentaje).toBeNull();
    expect(porcentajeATiempo([aviso('enviado', 0, null)], 2).porcentaje).toBeNull();
  });
});

describe('ahorro: siempre un supuesto rotulado', () => {
  it('avisos × minutos, con el rótulo y sin porcentaje', () => {
    const a = minutosAhorrados(12, 5);
    expect(a.minutos).toBe(60);
    expect(a.supuesto).toBe('supuesto: 5 min por aviso (configurable)');
    expect(Object.keys(a)).toEqual(['minutos', 'supuesto']);
  });
  it('un supuesto inválido no produce ahorro inventado', () => {
    expect(minutosAhorrados(10, -3).minutos).toBe(0);
    expect(minutosAhorrados(10, Number.NaN).minutos).toBe(0);
  });
});

describe('primera respuesta: mediana y p90 por cliente', () => {
  const ms = [msg('a', 5), msg('a', 15), msg('a', 25), msg('b', 60), msg('b', null), msg('c', 10)];
  it('por cliente, solo atendidos, el más lento primero', () => {
    expect(primeraRespuesta(ms)).toEqual([
      { clienteId: 'b', muestra: 1, medianaMin: 60, p90Min: 60 },
      { clienteId: 'a', muestra: 3, medianaMin: 15, p90Min: 25 },
      { clienteId: 'c', muestra: 1, medianaMin: 10, p90Min: 10 },
    ]);
  });
  it('mediana par = promedio de los dos centrales', () => {
    expect(primeraRespuesta([msg('a', 10), msg('a', 20)])[0].medianaMin).toBe(15);
  });
  it('global sobre todas las muestras (no mediana de medianas); sin datos null; atención antes de llegar se ignora', () => {
    expect(primeraRespuestaGlobal(ms)).toEqual({ muestra: 5, medianaMin: 15, p90Min: 60 });
    expect(primeraRespuestaGlobal([msg('a', null)])).toBeNull();
    expect(primeraRespuestaGlobal([msg('a', -5)])).toBeNull();
  });
});

describe('mensajes priorizados', () => {
  it('cuenta por nivel y mide las altas atendidas dentro del umbral', () => {
    const r = mensajesPriorizados([msg('a', 10, 2), msg('a', 45, 2), msg('a', null, 2), msg('b', 5, 1), msg('b', null, 0), msg('b', 1)], 30);
    expect(r).toEqual({ total: 6, altas: 3, normales: 2, ignorables: 1, altasATiempo: 1, altasPendientes: 2, porcentajeAltasATiempo: 33.3 });
  });
  it('sin altas el porcentaje es null', () => {
    expect(mensajesPriorizados([msg('a', 1, 1)], 30).porcentajeAltasATiempo).toBeNull();
  });
});

describe('tarjetas: qué pasó · qué significa · qué hacer', () => {
  it('sin datos: «Aún no hay avisos enviados» y valores «—», no ceros', () => {
    const t = tarjetasInsights({ avisos: [], mensajes: [] });
    expect(t).toHaveLength(4);
    expect(t[0].quePaso).toBe('Aún no hay avisos enviados.');
    expect(t.every((x) => x.sinDatos && x.valor === '—')).toBe(true);
  });
  it('toda tarjeta trae fuente y los tres textos, con y sin datos', () => {
    const lleno = tarjetasInsights({
      avisos: [aviso('enviado', 0, 5), aviso('enviado', 0, 1)],
      mensajes: [msg('a', 10, 2), msg('a', 50, 1), msg('b', 20, 0)],
    });
    for (const t of [...lleno, ...tarjetasInsights({ avisos: [], mensajes: [] })]) {
      expect(t.fuente.length).toBeGreaterThan(5);
      expect(t.quePaso.length).toBeGreaterThan(0);
      expect(t.queSignifica.length).toBeGreaterThan(0);
      expect(t.queHacer.length).toBeGreaterThan(0);
    }
  });
  it('el ahorro lleva el rótulo del supuesto y nunca un porcentaje', () => {
    const [ahorro] = tarjetasInsights({ avisos: Array.from({ length: 24 }, () => aviso('enviado', 0, 5)), mensajes: [], config: { minutosPorAviso: 10 } });
    expect(ahorro.valor).toBe('4 h');
    expect(ahorro.rotulo).toBe('supuesto: 10 min por aviso (configurable)');
    expect(`${ahorro.valor} ${ahorro.quePaso} ${ahorro.queSignifica}`).not.toContain('%');
    expect(ahorro.queSignifica).toContain('estimación, no una medición');
  });
  it('avisos con datos pero sin cita: la tarjeta de a tiempo lo dice', () => {
    const t = tarjetasInsights({ avisos: [aviso('enviado', 0, null)], mensajes: [] });
    expect(t[1].quePaso).toContain('ninguno con hora de cita');
    expect(t[1].sinDatos).toBe(true);
  });
  it('a tiempo, primera respuesta y priorizados reflejan los números', () => {
    const t = tarjetasInsights({
      avisos: [aviso('enviado', 0, 5), aviso('enviado', 0, 1)],
      mensajes: [msg('a', 10, 2), msg('a', 50, 2)],
    });
    expect(t[1].valor).toBe('50%');
    expect(t[1].quePaso).toContain('1 de 2');
    expect(t[2].valor).toBe('30 min');
    expect(t[3].valor).toBe('2 altas');
    expect(t[3].queHacer).toContain('1 urgentes');
    expect(t[3].rotulo).toContain('sintéticos');
  });
});
