import { describe, it, expect } from 'vitest';
import {
  compararProgramaConTrackTrace,
  docsDesdeCcp,
  estadoDesdeTransito,
  estatusVigente,
  quienManda,
  type EstatusImportacion,
} from './modelo';

const est = (p: Partial<EstatusImportacion>): EstatusImportacion => ({
  caja: 'CJ0001',
  unidad: null,
  estado: 'desconocido',
  docs: 'desconocido',
  fuente: 'programa',
  observadoEn: '2026-10-05T08:00:00Z',
  filaId: null,
  ...p,
});

describe('TRANSITO del programa → estado de la caja', () => {
  it.each([
    ['patio_nld', 'patio'],
    ['patio_otro', 'patio'],
    ['pend_cruce', 'pend_cruce'],
    ['en_ruta', 'en_ruta'],
  ] as const)('%s → %s', (entrada, esperado) => {
    expect(estadoDesdeTransito(entrada)).toBe(esperado);
  });

  it.each(['ok', 'na', 'vacio', 'desconocido'] as const)('%s no se adivina: desconocido', (v) => {
    expect(estadoDesdeTransito(v)).toBe('desconocido');
  });

  it('valores raros, vacíos y claves del prototipo → desconocido', () => {
    for (const v of ['CRUZANDO', '550', '', 'constructor', '__proto__', 'toString', undefined, null]) {
      expect(estadoDesdeTransito(v)).toBe('desconocido');
    }
  });
});

describe('CCP del programa → documentos de la caja', () => {
  it('LISTO → listo y PEND REQUE CCP → pend_requisito', () => {
    expect(docsDesdeCcp('listo')).toBe('listo');
    expect(docsDesdeCcp('pend_reque')).toBe('pend_requisito');
  });

  it.each(['despachado', 'pend_ccp', 'falta_complemento', 'vacio', 'desconocido'] as const)(
    '%s no está en la definición del cliente: desconocido',
    (v) => {
      expect(docsDesdeCcp(v)).toBe('desconocido');
    },
  );

  it('valores raros y claves del prototipo → desconocido', () => {
    for (const v of ['LISTO', 'si', '', 'hasOwnProperty', undefined, null]) {
      expect(docsDesdeCcp(v)).toBe('desconocido');
    }
  });
});

describe('quién manda: la fuente más reciente, solo si su observado_en es mayor', () => {
  const viejo = est({ estado: 'patio', fuente: 'programa', observadoEn: '2026-10-05T08:00:00Z' });
  const nuevo = est({ estado: 'en_ruta', fuente: 'track_trace', observadoEn: '2026-10-05T09:00:00Z' });

  it('el más nuevo gana, sin importar el orden', () => {
    expect(quienManda(viejo, nuevo)).toBe(nuevo);
    expect(quienManda(nuevo, viejo)).toBe(nuevo);
  });

  it('un dato más viejo nunca pisa a uno más nuevo', () => {
    const manualViejo = est({ estado: 'pend_cruce', fuente: 'manual', observadoEn: '2026-10-05T07:00:00Z' });
    expect(quienManda(nuevo, manualViejo)).toBe(nuevo);
  });

  it('compara instantes, no texto: la misma hora en otra zona es un empate', () => {
    const a = est({ fuente: 'programa', observadoEn: '2026-10-05T08:00:00Z' });
    const b = est({ fuente: 'track_trace', observadoEn: '2026-10-05T02:00:00-06:00' });
    expect(quienManda(a, b)).toBe(b); // empate → más confiable
    const c = est({ fuente: 'programa', observadoEn: '2026-10-05T03:00:00-06:00' }); // = 09:00Z
    expect(quienManda(a, c)).toBe(c);
  });

  it('empate exacto: manual > track_trace > programa, sin depender del orden', () => {
    const t = '2026-10-05T08:00:00Z';
    const p = est({ fuente: 'programa', observadoEn: t });
    const tt = est({ fuente: 'track_trace', observadoEn: t });
    const m = est({ fuente: 'manual', observadoEn: t });
    expect(quienManda(p, tt)).toBe(tt);
    expect(quienManda(tt, p)).toBe(tt);
    expect(quienManda(tt, m)).toBe(m);
    expect(quienManda(m, p)).toBe(m);
  });

  it('empate de la misma fuente conserva lo que ya había', () => {
    const a = est({ estado: 'patio' });
    const b = est({ estado: 'en_ruta' });
    expect(quienManda(a, b)).toBe(a);
  });

  it('un observado_en ilegible nunca gana; si el actual es el ilegible, lo reemplaza lo legible', () => {
    const roto = est({ estado: 'en_ruta', observadoEn: 'ayer' });
    expect(quienManda(viejo, roto)).toBe(viejo);
    expect(quienManda(roto, viejo)).toBe(viejo);
  });
});

describe('estatusVigente', () => {
  it('una entrada por caja (sin importar mayúsculas ni espacios) y el resultado no depende del orden', () => {
    const regs = [
      est({ caja: 'CJ0001', estado: 'patio', fuente: 'programa', observadoEn: '2026-10-05T08:00:00Z' }),
      est({ caja: ' cj0001 ', estado: 'en_ruta', fuente: 'track_trace', observadoEn: '2026-10-05T09:00:00Z' }),
      est({ caja: 'CJ0002', estado: 'pend_cruce', fuente: 'programa', observadoEn: '2026-10-05T08:00:00Z' }),
    ];
    const a = estatusVigente(regs);
    const b = estatusVigente([...regs].reverse());
    expect(a.size).toBe(2);
    expect(a.get('cj0001')?.estado).toBe('en_ruta');
    expect(b.get('cj0001')?.estado).toBe('en_ruta');
    expect(a.get('cj0002')?.estado).toBe('pend_cruce');
  });

  it('las cajas en blanco se descartan y vacío da un mapa vacío', () => {
    expect(estatusVigente([est({ caja: '   ' })]).size).toBe(0);
    expect(estatusVigente([]).size).toBe(0);
  });
});

describe('programa contra Track & Trace', () => {
  const p = est({ estado: 'patio', docs: 'listo', fuente: 'programa' });
  it('sin una de las dos fuentes no se compara', () => {
    expect(compararProgramaConTrackTrace(p, undefined)).toBe('sin_comparar');
    expect(compararProgramaConTrackTrace(undefined, p)).toBe('sin_comparar');
  });
  it('coinciden cuando lo que ambos saben es igual', () => {
    expect(compararProgramaConTrackTrace(p, est({ estado: 'patio', docs: 'listo', fuente: 'track_trace' }))).toBe('coinciden');
  });
  it('desconocido no cuenta como desacuerdo', () => {
    expect(compararProgramaConTrackTrace(p, est({ estado: 'desconocido', docs: 'desconocido', fuente: 'track_trace' }))).toBe('coinciden');
  });
  it('difieren si el estado o los documentos chocan', () => {
    expect(compararProgramaConTrackTrace(p, est({ estado: 'en_ruta', docs: 'listo', fuente: 'track_trace' }))).toBe('difieren');
    expect(compararProgramaConTrackTrace(p, est({ estado: 'patio', docs: 'pend_requisito', fuente: 'track_trace' }))).toBe('difieren');
  });
});
