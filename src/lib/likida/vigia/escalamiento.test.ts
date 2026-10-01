import { describe, it, expect } from 'vitest';
import { evaluarEscalamiento, minutosEsperando, type EntradaEscalamiento } from './escalamiento';

const T0 = Date.parse('2026-10-01T12:00:00Z');
const hace = (min: number) => new Date(T0 - min * 60_000).toISOString();

const entrada = (c: Partial<EntradaEscalamiento['conversacion']> = {}, resto: Partial<EntradaEscalamiento> = {}): EntradaEscalamiento => ({
  conversacion: {
    id: 'conv-1', estado: 'activa', control: 'agente', sinRespuestaDesde: null, escalamientoNivel: 0, molestiaNivel: 0,
    molestiaEn: null, atendidaEn: null, ...c,
  },
  config: { slaRespuestaMin: 30, escalarNivel2Min: 60 },
  ahoraMs: T0,
  ...resto,
});

describe('minutosEsperando', () => {
  it('cuenta minutos completos; sin espera o fecha basura es 0', () => {
    expect(minutosEsperando(hace(45), T0)).toBe(45);
    expect(minutosEsperando(null, T0)).toBe(0);
    expect(minutosEsperando('basura', T0)).toBe(0);
    expect(minutosEsperando(new Date(T0 + 5 * 60_000).toISOString(), T0)).toBe(0); // reloj adelantado
  });
});

describe('escalera por tiempo sin respuesta', () => {
  it('antes del SLA no pasa nada', () => {
    expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(29) }))).toBeNull();
  });
  it('al cumplir el SLA: nivel 1', () => {
    const a = evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(30) }));
    expect(a).toMatchObject({ nivel: 1, motivo: 'sin_respuesta', minutosEsperando: 30 });
  });
  it('a SLA + N2: nivel 2', () => {
    const a = evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(90), escalamientoNivel: 1 }));
    expect(a).toMatchObject({ nivel: 2, motivo: 'sin_respuesta' });
  });
  it('si el cron se saltó el nivel 1 (corrida perdida), salta directo al 2 correspondiente', () => {
    expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(200) }))?.nivel).toBe(2);
  });
  it('NO se repite un nivel ya avisado en el ciclo', () => {
    expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(45), escalamientoNivel: 1 }))).toBeNull();
    expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(500), escalamientoNivel: 2 }))).toBeNull();
  });
  it('nadie espera: no hay escalamiento por tiempo', () => {
    expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: null }))).toBeNull();
  });
  it('la clave identifica ciclo y nivel (idempotencia) y cambia con un ciclo nuevo', () => {
    const a1 = evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(40) }));
    const a2 = evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(40) }));
    expect(a1?.clave).toBe(a2?.clave);
    const otroCiclo = evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(35) }));
    expect(otroCiclo?.clave).not.toBe(a1?.clave);
    const n2 = evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(40) }, { ahoraMs: T0 + 60 * 60_000 }));
    expect(n2?.nivel).toBe(2);
    expect(n2?.clave).not.toBe(a1?.clave);
  });
  it('el SLA configurado manda', () => {
    const e = entrada({ sinRespuestaDesde: hace(10) }, { config: { slaRespuestaMin: 5, escalarNivel2Min: 5 } });
    expect(evaluarEscalamiento(e)?.nivel).toBe(2);
  });
});

describe('escalera por molestia', () => {
  it('molestia 1 (leve): no escala', () => {
    expect(evaluarEscalamiento(entrada({ molestiaNivel: 1, molestiaEn: hace(1) }))).toBeNull();
  });
  it('molestia 2: nivel 1 al instante, sin esperar el SLA', () => {
    expect(evaluarEscalamiento(entrada({ molestiaNivel: 2, molestiaEn: hace(1) }))).toMatchObject({ nivel: 1, motivo: 'molestia' });
  });
  it('molestia 3 (crítica): directo al dueño', () => {
    expect(evaluarEscalamiento(entrada({ molestiaNivel: 3, molestiaEn: hace(1) }))).toMatchObject({ nivel: 2, motivo: 'molestia' });
  });
  it('la espera larga gana el nivel 2 aunque la molestia sea 2; el motivo es el de más peso', () => {
    expect(evaluarEscalamiento(entrada({ molestiaNivel: 2, sinRespuestaDesde: hace(100) }))).toMatchObject({ nivel: 2, motivo: 'sin_respuesta' });
  });
});

describe('disparos inmediatos', () => {
  it('pide humano / falta un dato / folio ajeno: nivel 1 ya', () => {
    for (const d of ['pide_humano', 'sin_dato', 'folio_ajeno'] as const) {
      expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(1) }, { disparoInmediato: d }))).toMatchObject({ nivel: 1, motivo: d });
    }
  });
  it('ya avisado ese nivel: no se duplica', () => {
    expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(1), escalamientoNivel: 1 }, { disparoInmediato: 'sin_dato' }))).toBeNull();
  });
});

describe('quien ya se hizo cargo', () => {
  it('«yo me encargo» detiene el nivel 1…', () => {
    expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(35), atendidaEn: hace(5) }))).toBeNull();
    expect(evaluarEscalamiento(entrada({ molestiaNivel: 2, molestiaEn: hace(1), atendidaEn: hace(1) }))).toBeNull();
  });
  it('…pero el nivel 2 sigue vigente: si tomó el hilo y el cliente espera el doble, el dueño se entera', () => {
    expect(evaluarEscalamiento(entrada({ sinRespuestaDesde: hace(95), atendidaEn: hace(60), escalamientoNivel: 1, control: 'humano' }))).toMatchObject({ nivel: 2 });
  });
});

describe('conversación cerrada', () => {
  it('no escala', () => {
    expect(evaluarEscalamiento(entrada({ estado: 'cerrada', sinRespuestaDesde: hace(500), molestiaNivel: 3 }))).toBeNull();
  });
});
