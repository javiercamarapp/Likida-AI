import { describe, expect, it } from 'vitest';
import { SCRIPT_TEMA } from './script_tema';

/** Ejecuta el script en una raíz simulada para la ruta dada y devuelve el data-theme resultante. */
function correr(ruta: string, guardado: string | null, sistemaOscuro = false): string | undefined {
  const raiz = { dataset: {} as Record<string, string> };
  const g = globalThis as unknown as Record<string, unknown>;
  const previo = { location: g.location, localStorage: g.localStorage, matchMedia: g.matchMedia, document: g.document };
  g.location = { pathname: ruta };
  g.localStorage = { getItem: () => guardado };
  g.matchMedia = () => ({ matches: sistemaOscuro });
  g.document = { documentElement: raiz };
  try { new Function(SCRIPT_TEMA)(); } finally { Object.assign(g, previo); }
  return raiz.dataset.theme;
}

describe('SCRIPT_TEMA — un solo criterio para /admin y /dashboard', () => {
  it.each(['/dashboard', '/dashboard/gastos', '/admin', '/admin/crecimiento'])('%s aplica la preferencia guardada antes del primer paint', (ruta) => {
    expect(correr(ruta, 'oscuro')).toBe('dark');
    expect(correr(ruta, 'claro')).toBe('light');
    expect(correr(ruta, null)).toBe('light');
    expect(correr(ruta, 'sistema', true)).toBe('dark');
  });
  it.each(['/', '/login', '/vendedor'])('%s se queda como está (no es panel)', (ruta) => {
    expect(correr(ruta, 'oscuro')).toBeUndefined();
  });
});
