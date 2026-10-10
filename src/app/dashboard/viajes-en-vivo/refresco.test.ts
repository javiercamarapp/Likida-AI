import { describe, expect, it } from 'vitest';
import { CADA_SEG_POR_OMISION, puedeRefrescar } from './refresco';

const base = { forzar: false, visible: true, tagActivo: null, refrescando: false };

describe('cuándo se refresca solo el tablero de viajes en vivo', () => {
  it('cada 60 s por omisión', () => expect(CADA_SEG_POR_OMISION).toBe(60));
  it('refresca con la pestaña visible y sin nadie escribiendo', () => expect(puedeRefrescar(base)).toBe(true));
  it('NO refresca con la pestaña oculta', () => expect(puedeRefrescar({ ...base, visible: false })).toBe(false));
  it('NO refresca mientras hay un campo con foco (la caja del asistente, un filtro)', () => {
    for (const tag of ['INPUT', 'select', 'TEXTAREA']) expect(puedeRefrescar({ ...base, tagActivo: tag })).toBe(false);
    expect(puedeRefrescar({ ...base, tagActivo: 'BUTTON' })).toBe(true);
  });
  it('«Actualizar ahora» sí puede aunque la pestaña esté oculta o haya un campo con foco, pero no dos a la vez', () => {
    expect(puedeRefrescar({ ...base, forzar: true, visible: false, tagActivo: 'INPUT' })).toBe(true);
    expect(puedeRefrescar({ ...base, forzar: true, refrescando: true })).toBe(false);
  });
});
