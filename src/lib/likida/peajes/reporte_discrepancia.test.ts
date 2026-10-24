import { describe, it, expect } from 'vitest';
import {
  armarReporteDiscrepancia, discrepanciaDeCandidato, discrepanciaDeAtipico, type DiscrepanciaEntrada,
} from './reporte_discrepancia';
import type { CandidatoCobro } from './reglas_cobro';
import type { HallazgoAtipico } from './atipicos';

// T-A2-37 · reporte de discrepancia geográfica. Datos sintéticos.

const critico: CandidatoCobro = {
  indice: 0, categoria: 'unidad_inmovilizada', fecha: '2026-03-04', hora: '10:15:00', caseta: 'Caseta Ejemplo Norte',
  tag: 'TAGEJEMPLO01', unidad: 'U-01', clase: 3, monto: 400,
  quePaso: 'El TAG TAGEJEMPLO01 de la unidad U-01 aparece en Caseta Ejemplo Norte, pero la flota declaró esa unidad en taller del 2026-03-03 al 2026-03-05.',
  queSignifica: 'x', queHacer: 'y', referencia: 'taller del 2026-03-03 al 2026-03-05', severidad: 'critica',
};
const atipico: HallazgoAtipico = {
  regla: 'secuencia_imposible', llave: 'k', unidad: 'U-02', casetas: ['Caseta Ejemplo Sur', 'Caseta Ejemplo Este'],
  desde: '2026-03-04T16:00:00.000Z', hasta: '2026-03-04T16:20:00.000Z', desdeLocal: '2026-03-04 10:00', hastaLocal: '2026-03-04 10:20',
  nCruces: 2, monto: 800, quePaso: 'Dos cruces seguidos que el tiempo no permite.', queSignifica: 'a', queHacer: 'b',
};
const TEL = '+52 55 0000 0000'; // grep-limpio:ok
const pos = { lat: 19.4326, lng: -99.1332, t: Date.UTC(2026, 2, 4, 15, 30) }; // 09:30 MX

describe('reporte de discrepancia', () => {
  it('candidato crítico con posición GPS: qué pasó / evidencia / qué hacer, con la hora en reloj de México', () => {
    const e = discrepanciaDeCandidato(critico)!;
    const r = armarReporteDiscrepancia(e, pos, TEL);
    expect(r.enviar).toBe(true);
    expect(r.destinatario).toBe('525500000000'); // grep-limpio:ok
    expect(r.motivoNoEnvio).toBeNull();
    expect(r.evidencia.join('\n')).toMatch(/Unidad: U-01/);
    expect(r.evidencia.join('\n')).toMatch(/TAG: …LO01/);
    expect(r.evidencia.join('\n')).toMatch(/Caseta: Caseta Ejemplo Norte/);
    expect(r.evidencia.join('\n')).toMatch(/2026-03-04 10:15/);
    expect(r.evidencia.join('\n')).toMatch(/19\.43, -99\.13 a las 2026-03-04 09:30/);
    // A37-A2-23: ni el TAG completo ni coordenadas exactas viajan a un teléfono libre.
    expect(r.texto).not.toContain('TAGEJEMPLO01');
    expect(r.texto).not.toMatch(/19\.4326|99\.1332/);
    expect(r.queHacer.join(' ')).toMatch(/seguridad/);
    expect(r.queHacer.join(' ')).toMatch(/dar de baja el TAG/);
    expect(r.texto).toMatch(/Qué pasó:.*Evidencia:.*Qué hacer:/s);
  });

  it('sin posición GPS no afirma dónde estaba la unidad y lo dice', () => {
    const r = armarReporteDiscrepancia(discrepanciaDeCandidato(critico)!, null, TEL);
    expect(r.evidencia.join('\n')).toMatch(/sin posición GPS disponible/);
    expect(r.evidencia.join('\n')).not.toMatch(/Última posición conocida de la unidad: \d/);
    const mala = armarReporteDiscrepancia(discrepanciaDeCandidato(critico)!, { lat: 999, lng: 0, t: 1 }, TEL);
    expect(mala.evidencia.join('\n')).toMatch(/sin posición GPS disponible/);
  });

  it('sin destinatario configurado (o inválido) no envía y lo dice', () => {
    for (const tel of [null, '', '123', 'abc']) {
      const r = armarReporteDiscrepancia(discrepanciaDeCandidato(critico)!, pos, tel);
      expect(r.enviar).toBe(false);
      expect(r.destinatario).toBeNull();
      expect(r.motivoNoEnvio).toMatch(/No hay destinatario configurado.*no se envió a nadie/);
      expect(r.texto.length).toBeGreaterThan(0);
    }
  });

  it('hallazgo atípico: arma el reporte con varias casetas y rango de horas', () => {
    const r = armarReporteDiscrepancia(discrepanciaDeAtipico(atipico, 'TAGEJEMPLO02'), null, TEL);
    expect(r.evidencia.join('\n')).toMatch(/Caseta: Caseta Ejemplo Sur, Caseta Ejemplo Este/);
    expect(r.evidencia.join('\n')).toMatch(/2026-03-04 10:00 a 2026-03-04 10:20/);
    expect(r.evidencia.join('\n')).toMatch(/TAG: …LO02/);
  });

  it('un candidato que no es crítico de unidad inmovilizada no genera discrepancia', () => {
    expect(discrepanciaDeCandidato({ ...critico, categoria: 'tag_dado_de_baja' })).toBeNull();
    expect(discrepanciaDeCandidato({ ...critico, severidad: undefined })).toBeNull();
  });

  it('entrada incompleta (sin unidad, tag, caseta ni fecha) se dice llano, sin inventar', () => {
    const e: DiscrepanciaEntrada = { origen: 'atipico', unidad: null, tag: null, casetas: [], cuando: null, quePaso: 'Cruce sin datos.', referencia: 'regla' };
    const r = armarReporteDiscrepancia(e, null, TEL);
    expect(r.evidencia).toContain('Unidad: sin identificar');
    expect(r.evidencia).toContain('TAG: no viene en el archivo');
    expect(r.evidencia.join('\n')).toMatch(/caseta sin identificar/);
    expect(r.evidencia.join('\n')).toMatch(/sin fecha legible/);
  });

  it('doctrina: nunca acusa ni afirma fraude, y no bloquea el TAG por su cuenta', () => {
    const r = armarReporteDiscrepancia(discrepanciaDeCandidato(critico)!, pos, TEL);
    expect(r.texto).toMatch(/no afirma que alguien haya hecho algo indebido/);
    expect(r.texto).not.toMatch(/fraude|robo|ladr|culpable|sancion/i);
    expect(r.texto).toMatch(/el sistema no lo bloquea solo/);
  });
});
