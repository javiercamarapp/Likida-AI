import { describe, it, expect } from 'vitest';
import { DIAS_REVISION_RUTAS_DEFAULT, rutasPendientesDeRevision, type RutaExistente } from './rutas';

// T-A5-50: la lista de rutas sin revisar por antigüedad (pura; la pantalla y el botón «Revisada» la cablean).
const URL = 'https://maps.app.goo.gl/EjemploSintetico1';
const ruta = (id: string, extra: Partial<RutaExistente> = {}): RutaExistente => ({
  id, corredor: `corredor-${id}`, sitioOrigen: null, sitioDestino: null, url: URL, vigenteHasta: null, revisadaEn: null, ...extra,
});
const HOY = '2026-10-16';

describe('rutasPendientesDeRevision', () => {
  it('el plazo por omisión es 90 días', () => expect(DIAS_REVISION_RUTAS_DEFAULT).toBe(90));

  it('antigüedad exacta en el límite: 89 días no es pendiente, 90 sí', () => {
    // 2026-10-16 menos 90 días = 2026-07-18
    const r = rutasPendientesDeRevision([ruta('a', { revisadaEn: '2026-07-19' }), ruta('b', { revisadaEn: '2026-07-18' })], HOY);
    expect(r.map((x) => x.ruta.id)).toEqual(['b']);
    expect(r[0].diasSinRevisar).toBe(90);
  });

  it('respeta un plazo distinto (config) y no cruza el cambio de año ni de mes mal', () => {
    const rutas = [ruta('a', { revisadaEn: '2026-01-01' })];
    expect(rutasPendientesDeRevision(rutas, '2026-01-31', 30).map((x) => x.diasSinRevisar)).toEqual([30]);
    expect(rutasPendientesDeRevision(rutas, '2026-01-30', 30)).toEqual([]);
    expect(rutasPendientesDeRevision([ruta('a', { revisadaEn: '2025-12-31' })], '2026-03-01', 60).map((x) => x.diasSinRevisar)).toEqual([60]);
  });

  it('una ruta que nunca se revisó es pendiente (sin días) y va primero; luego la más vieja', () => {
    const r = rutasPendientesDeRevision([
      ruta('vieja', { revisadaEn: '2026-01-01' }), ruta('nunca'), ruta('mas-vieja', { revisadaEn: '2025-06-01' }),
    ], HOY);
    expect(r.map((x) => x.ruta.id)).toEqual(['nunca', 'mas-vieja', 'vieja']);
    expect(r[0].diasSinRevisar).toBeNull();
  });

  it('revisarla la saca de la lista (revisada hoy)', () => {
    const antes = rutasPendientesDeRevision([ruta('a', { revisadaEn: '2026-01-01' })], HOY);
    expect(antes).toHaveLength(1);
    expect(rutasPendientesDeRevision([ruta('a', { revisadaEn: HOY })], HOY)).toEqual([]);
  });

  it('marca las vencidas (siguen en la lista: hay que revisarlas o renovarlas)', () => {
    const r = rutasPendientesDeRevision([ruta('a', { vigenteHasta: '2026-10-15' }), ruta('b', { vigenteHasta: HOY })], HOY);
    expect(r.map((x) => [x.ruta.id, x.vencida])).toEqual([['a', true], ['b', false]]);
  });

  it('estado vacío: sin rutas o todas al día devuelve []', () => {
    expect(rutasPendientesDeRevision([], HOY)).toEqual([]);
    expect(rutasPendientesDeRevision([ruta('a', { revisadaEn: '2026-10-01' })], HOY)).toEqual([]);
  });

  it('un plazo inválido cae al de 90 días', () => {
    const rutas = [ruta('a', { revisadaEn: '2026-07-18' })];
    for (const d of [0, -5, Number.NaN, 1.5]) expect(rutasPendientesDeRevision(rutas, HOY, d)).toHaveLength(1);
  });
});
