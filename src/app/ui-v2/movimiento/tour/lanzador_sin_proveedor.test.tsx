import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/puesta-en-marcha', useRouter: () => ({ push: () => {} }) }));

import { TourLanzador } from './lanzador';

describe('TourLanzador sin <TourProvider> (v2 sin perfil)', () => {
  it('no revienta: se degrada a nada en vez de lanzar «useTour: falta <TourProvider>»', () => {
    expect(() => renderToStaticMarkup(<TourLanzador recorridoId="dueno" />)).not.toThrow();
    expect(renderToStaticMarkup(<TourLanzador recorridoId="dueno" />)).toBe('');
  });
});
