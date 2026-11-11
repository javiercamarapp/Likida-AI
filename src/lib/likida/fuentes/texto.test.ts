import { describe, expect, it } from 'vitest';
import { fuentes as es } from '@/lib/i18n/es/fuentes';
import { fuentes as en } from '@/lib/i18n/en/fuentes';
import { crearTraductor } from '@/lib/i18n/traducir';
import { CADENCIA_FUENTES, IDS_FUENTE, evaluarFuentes, type EntradaFuente, type IdFuente } from './estado';
import { detalleFuente, filasDeEvaluaciones, haceTexto } from './texto';

const AHORA = Date.UTC(2026, 10, 10, 18, 0, 0);
const tEs = crearTraductor('es', es, es).t;
const tEn = crearTraductor('en', en, es).t;

const casos = (id: IdFuente): EntradaFuente[] => [
  { id, lectura: 'caida', configurada: false, ultimaSenalMs: null },
  { id, lectura: 'medida', configurada: false, ultimaSenalMs: null },
  { id, lectura: 'medida', configurada: true, ultimaSenalMs: null },
  { id, lectura: 'medida', configurada: true, ultimaSenalMs: null, falla: 'error 500' },
  { id, lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - 1000 },
  { id, lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - CADENCIA_FUENTES[id].esperadaMs * 2, falla: 'timeout' },
  { id, lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - CADENCIA_FUENTES[id].esperadaMs * 2, muestra30d: 1 },
  { id, lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - CADENCIA_FUENTES[id].esperadaMs * 2 },
  { id, lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - CADENCIA_FUENTES[id].esperadaMs * 9 },
];

describe('el copy de cada evaluación sale del diccionario fuentes (es y en)', () => {
  for (const id of IDS_FUENTE) {
    it(`«${id}»: ninguna frase queda con {variable} sin resolver ni vacía, en los dos idiomas`, () => {
      for (const ev of evaluarFuentes(casos(id), AHORA)) {
        for (const t of [tEs, tEn]) {
          const frase = detalleFuente(ev, t);
          expect(frase.length).toBeGreaterThan(10);
          expect(frase).not.toMatch(/\{[a-z]+\}/);
          expect(frase).not.toMatch(/\s\.|\s;/);
        }
      }
    });
  }
  it('el inglés no repite el español', () => {
    const [ev] = evaluarFuentes(casos('gps'), AHORA);
    expect(detalleFuente(ev, tEn)).not.toBe(detalleFuente(ev, tEs));
  });
  it('haceTexto escala de minutos a horas a días', () => {
    expect(haceTexto(30_000, tEs)).toBe('hace menos de un minuto');
    expect(haceTexto(5 * 60_000, tEs)).toBe('hace 5 min');
    expect(haceTexto(3 * 3_600_000, tEs)).toBe('hace 3 h');
    expect(haceTexto(5 * 86_400_000, tEs)).toBe('hace 5 días');
  });
  it('las filas llevan nombre, rótulo y la cadencia esperada a la vista', () => {
    const filas = filasDeEvaluaciones(evaluarFuentes([{ id: 'gps', lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - 1000 }], AHORA), tEs);
    expect(filas[0]).toMatchObject({ id: 'gps', nombre: 'GPS', rotulo: 'Al día', tono: 'ok' });
    expect(filas[0].nota).toContain('cada 15 min');
  });
  it('sin dato se rotula «Sin dato», nunca «Al día»', () => {
    const [f] = filasDeEvaluaciones(evaluarFuentes([{ id: 'sat', lectura: 'caida', configurada: false, ultimaSenalMs: null }], AHORA), tEs);
    expect(f.rotulo).toBe('Sin dato');
    expect(f.rotulo).not.toBe('Al día');
  });
});
