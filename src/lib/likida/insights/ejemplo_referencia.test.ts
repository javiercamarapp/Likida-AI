// Ejemplo de referencia (T-INS-07): UNA regla por agente, con datos sintéticos.
// Sirve de molde para que cada frente copie el patrón; NO es la regla definitiva de ningún agente.
// Las métricas y los IDs de regla viven en docs/operacion/insights-adopcion.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componer } from './componer';
import { revisarInsight } from './llano';
import { definirRegla, validarInsight, type Regla } from './regla';
import { AGENTES_INSIGHT, type AgenteInsight, type Insight } from './tipos';

// Datos sintéticos: ninguna cifra ni nombre real.
interface Periodo {
  etiqueta: string;
  desglosesGenerados: number;
  desglosesEnviados: number;
  cruces: number;
  crucesCandidatos: number;
  montoCandidatos: number;
  cartas: number;
  cartasSinTocar: number;
  avisos: number;
  avisosATiempo: number;
  hitos: number;
  hitosSolos: number;
}

const periodo: Periodo = {
  etiqueta: 'semana sintética',
  desglosesGenerados: 10,
  desglosesEnviados: 8,
  cruces: 40,
  crucesCandidatos: 5,
  montoCandidatos: 1000,
  cartas: 20,
  cartasSinTocar: 15,
  avisos: 12,
  avisosATiempo: 9,
  hitos: 30,
  hitosSolos: 24,
};

const base = (periodo_: Periodo, tabla: string, n: number) => ({
  tabla,
  periodo: periodo_.etiqueta,
  n,
});

const reglas: Regla<Periodo>[] = [
  definirRegla<Periodo>({
    id: 'INS-A1-01',
    agente: 'liquidacion',
    aplica: (d) => d.desglosesGenerados > d.desglosesEnviados,
    producir: (d): Insight => ({
      id: 'INS-A1-01',
      agente: 'liquidacion',
      tipo: 'dato',
      severidad: 'atencion',
      quePaso: `Se generaron ${d.desglosesGenerados} desgloses y se enviaron ${d.desglosesEnviados}.`,
      queSignifica: 'Hay desgloses que todavía no llegan al correo.',
      queHacer: 'Revisar los desgloses pendientes de envío.',
      fuente: base(d, 'desgloses_sinteticos', d.desglosesGenerados),
      accion: { rotulo: 'Ver pendientes', ruta: '/dashboard/liquidacion' },
    }),
  }),
  definirRegla<Periodo>({
    id: 'INS-A2-01',
    agente: 'peajes',
    aplica: (d) => d.crucesCandidatos > 0,
    producir: (d): Insight => ({
      id: 'INS-A2-01',
      agente: 'peajes',
      tipo: 'candidato',
      severidad: 'atencion',
      quePaso: `${d.crucesCandidatos} de ${d.cruces} cruces son candidatos a revisar por $${d.montoCandidatos}.`,
      queSignifica: 'Es un candidato, no un cobro confirmado: falta compararlo con el tarifario.',
      queHacer: 'Validar el candidato con el tarifario antes de reclamar.',
      fuente: base(d, 'cruces_sinteticos', d.cruces),
    }),
  }),
  definirRegla<Periodo>({
    id: 'INS-A3-01',
    agente: 'carta-porte',
    aplica: (d) => d.cartas > 0,
    producir: (d): Insight => ({
      id: 'INS-A3-01',
      agente: 'carta-porte',
      tipo: 'dato',
      severidad: 'info',
      quePaso: `${d.cartasSinTocar} de ${d.cartas} cartas porte salieron sin ayuda.`,
      queSignifica: 'El resto necesitó revisión de una persona.',
      queHacer: 'Revisar las cartas que necesitaron ayuda.',
      fuente: base(d, 'cartas_sinteticas', d.cartas),
    }),
  }),
  definirRegla<Periodo>({
    id: 'INS-A4-02',
    agente: 'vigia',
    aplica: (d) => d.avisosATiempo < d.avisos,
    producir: (d): Insight => ({
      id: 'INS-A4-02',
      agente: 'vigia',
      tipo: 'dato',
      severidad: 'urgente',
      quePaso: `${d.avisosATiempo} de ${d.avisos} avisos salieron a tiempo.`,
      queSignifica: 'Algunos clientes recibieron el aviso tarde.',
      queHacer: 'Confirmar la hora de salida de los avisos tardíos.',
      fuente: base(d, 'avisos_sinteticos', d.avisos),
    }),
  }),
  definirRegla<Periodo>({
    id: 'INS-A5-01',
    agente: 'conductores',
    aplica: (d) => d.hitos > 0,
    producir: (d): Insight => ({
      id: 'INS-A5-01',
      agente: 'conductores',
      tipo: 'dato',
      severidad: 'info',
      quePaso: `${d.hitosSolos} de ${d.hitos} hitos se registraron solos.`,
      queSignifica: 'Los demás hitos necesitaron que alguien los registrara.',
      queHacer: 'Revisar los hitos que se registraron a mano.',
      fuente: base(d, 'hitos_sinteticos', d.hitos),
    }),
  }),
];

const doc = readFileSync(join(process.cwd(), 'docs/operacion/insights-adopcion.md'), 'utf8');
const idsDelDoc = [...new Set(doc.match(/INS-A[1-5]-\d{2}/g) ?? [])];

describe('ejemplo de referencia: una regla por agente', () => {
  it('hay exactamente una regla por cada uno de los 5 agentes', () => {
    expect(reglas.map((r) => r.agente).sort()).toEqual([...AGENTES_INSIGHT].sort());
  });

  it('cada regla produce un insight válido con su ID y su agente', () => {
    for (const r of reglas) {
      expect(r.aplica(periodo)).toBe(true);
      const i = validarInsight(r.producir(periodo), r.id);
      expect(i.id).toBe(r.id);
      expect(i.agente).toBe(r.agente);
    }
  });

  it('todo insight lleva fuente con periodo y n, y texto llano sin hallazgos', () => {
    for (const r of reglas) {
      const i = r.producir(periodo);
      expect(i.fuente.periodo).toBe('semana sintética');
      expect(i.fuente.n).toBeGreaterThan(0);
      expect(revisarInsight(i)).toEqual([]);
    }
  });

  it('el candidato dice «candidato», pide validar y no reclama directo', () => {
    const i = reglas.find((r) => r.agente === 'peajes')!.producir(periodo);
    expect(i.tipo).toBe('candidato');
    expect(i.queSignifica).toMatch(/candidato/i);
    expect(i.queHacer).toMatch(/^Validar/);
  });

  it('componer ordena por severidad y limita a 3 visibles', () => {
    const r = componer(reglas, periodo);
    expect(r.total).toBe(5);
    expect(r.visibles.map((i) => i.severidad)).toEqual(['urgente', 'atencion', 'atencion']);
    expect(r.verMas).toHaveLength(2);
  });

  it('sin datos que disparen, ninguna regla aplica (estado vacío)', () => {
    const vacio: Periodo = {
      ...periodo,
      desglosesGenerados: 0,
      desglosesEnviados: 0,
      crucesCandidatos: 0,
      cartas: 0,
      avisosATiempo: periodo.avisos,
      hitos: 0,
    };
    expect(componer(reglas, vacio).total).toBe(0);
  });
});

describe('documento de adopción', () => {
  it('lista al menos 15 métricas con ID de regla', () => {
    expect(idsDelDoc.length).toBeGreaterThanOrEqual(15);
  });

  it('cada agente tiene al menos una métrica y los IDs de las reglas de referencia están en el documento', () => {
    for (const a of ['A1', 'A2', 'A3', 'A4', 'A5']) {
      expect(idsDelDoc.some((id) => id.startsWith(`INS-${a}-`))).toBe(true);
    }
    for (const r of reglas) expect(idsDelDoc).toContain(r.id);
  });

  it('cada fila de la tabla tiene ID único', () => {
    const filas = doc.split('\n').filter((l) => /^\| INS-A[1-5]-\d{2} \|/.test(l));
    const ids = filas.map((l) => l.split('|')[1].trim());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(15);
  });

  it('dice que litros/rendimiento son solo dato interno y no lleva cifras reales', () => {
    expect(doc).toMatch(/solo dato INTERNO de la liquidación/);
    expect(doc).not.toMatch(/\b583\b|\b3\.65\b/);
  });

  it('cada AgenteInsight tipado coincide con los prefijos A1..A5', () => {
    const agentes: AgenteInsight[] = [...AGENTES_INSIGHT];
    expect(agentes).toHaveLength(5);
  });
});
