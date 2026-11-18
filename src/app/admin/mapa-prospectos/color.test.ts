import { describe, expect, it } from 'vitest';
import { COLOR_EMBUDO } from '@/lib/admin/prospectos-mapa-client';
import { GRUPOS_ETAPA, NIVELES_URGENCIA, grupoDeEtapa, inicialesDe, nivelUrgencia, tonoDe } from './color';

const p = (urgencia: number, estado = 'contactado', ultimoToque: string | null = null) => ({ urgencia, estado, ultimoToque });

describe('nivel de urgencia (mismos cortes que el atajo «Urgentes» y el filtro de urgencia mínima)', () => {
  it('70 o más es urgente; de 50 a 69, atención', () => {
    expect(nivelUrgencia(p(70))).toBe('urgente');
    expect(nivelUrgencia(p(100))).toBe('urgente');
    expect(nivelUrgencia(p(69))).toBe('atencion');
    expect(nivelUrgencia(p(50))).toBe('atencion');
  });
  it('por debajo de 50: al día si ya se le tocó, frío si no', () => {
    expect(nivelUrgencia(p(49, 'contactado', '2026-11-01T00:00:00.000Z'))).toBe('aldia');
    expect(nivelUrgencia(p(0))).toBe('frio');
  });
  it('un cierre no pide acción y un perdido tampoco, aunque su número sea alto', () => {
    expect(nivelUrgencia(p(95, 'won'))).toBe('aldia');
    expect(nivelUrgencia(p(95, 'cerrado'))).toBe('aldia');
    expect(nivelUrgencia(p(95, 'lost'))).toBe('frio');
    expect(nivelUrgencia(p(95, 'perdido'))).toBe('frio');
  });
  it('los cuatro niveles existen y son distintos', () => {
    expect(new Set(NIVELES_URGENCIA).size).toBe(4);
  });
});

describe('grupos de etapa', () => {
  it('cada etapa del embudo cae en un grupo conocido y los seis grupos se usan', () => {
    const usados = new Set(Object.keys(COLOR_EMBUDO).map(grupoDeEtapa));
    for (const g of GRUPOS_ETAPA) expect(usados.has(g), g).toBe(true);
    expect(grupoDeEtapa('lost')).toBe('perdido');
    expect(grupoDeEtapa('desconocida')).toBe('inicio');
  });
});

describe('identidad de la empresa', () => {
  it('el tono es determinista, de 1 a 8, y no distingue acentos ni mayúsculas', () => {
    expect(tonoDe('Fletes del Norte')).toBe(tonoDe('Fletes del Norte'));
    expect(tonoDe('Logística Ñandú')).toBe(tonoDe('  logistica nandu '));
    for (const n of ['A', 'Transportes Garza', 'Embotelladora del Sur', 'X', '']) {
      const t = tonoDe(n);
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(8);
    }
  });
  it('los 8 tonos se alcanzan con nombres reales (el hash reparte)', () => {
    const vistos = new Set<number>();
    for (let i = 0; i < 400; i++) vistos.add(tonoDe(`Empresa ${i}`));
    expect(vistos.size).toBe(8);
  });
  it('iniciales: dos letras, sin nexos ni acentos', () => {
    expect(inicialesDe('Fletes del Norte')).toBe('FN');
    expect(inicialesDe('Transportes Ñandú S.A. de C.V.')).toBe('TN');
    expect(inicialesDe('Cemex')).toBe('CE');
    expect(inicialesDe('')).toBe('?');
    expect(inicialesDe('de la')).toBe('DL');
  });
});
