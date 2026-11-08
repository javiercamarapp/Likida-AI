import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { numero } from '@/lib/formato';
import { AreaMini, Columnas, ColumnasAgrupadas, DonaMini } from '@/app/ui-v2/graficas';
import type { DatosResumen } from './resumen-datos';
import { TarjetaCierres } from './resumen-tarjetas';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard', useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams(''),
}));

const GRANDES = [1200, 3450, 12000, 8, 25000, 9, 1234567, 4];
const cierres = GRANDES.map((valor, i) => ({ inicio: `2026-09-${String(7 + i).padStart(2, '0')}`, etiqueta: `${7 + i} sep`, valor, parcial: i === 7 }));
const datos = { cierres } as unknown as DatosResumen;

const CLIENTE = [Columnas, ColumnasAgrupadas, AreaMini, DonaMini];

/** Recorre el árbol de elementos de la tarjeta y devuelve cada prop-función que recibe una gráfica de cliente. */
function funcionesHaciaCliente(nodo: ReactNode, ruta = 'Tarjeta'): string[] {
  if (Array.isArray(nodo)) return nodo.flatMap((n, i) => funcionesHaciaCliente(n, `${ruta}[${i}]`));
  if (!isValidElement(nodo)) return [];
  const props = nodo.props as Record<string, unknown>;
  const aqui = CLIENTE.includes(nodo.type as never)
    ? Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${ruta}.${(nodo.type as { name: string }).name}.${k}`)
    : [];
  return [...aqui, ...Object.values(props).flatMap((v) => funcionesHaciaCliente(v as ReactNode, ruta))];
}

describe('TarjetaCierres (la que tumbó /dashboard)', () => {
  it('renderiza con cierres no vacíos sin lanzar y las cifras de miles salen como numero()', () => {
    const h = renderToStaticMarkup(TarjetaCierres({ d: datos }));
    for (const v of [1200, 3450, 12000, 25000, 1234567]) expect(h).toContain(numero(v));
    expect(h).toContain('1,234,567');
    expect(h).not.toContain('NaN');
  });

  it('no pasa ninguna función a una gráfica de cliente (no cruzaría la frontera servidor → cliente)', () => {
    expect(funcionesHaciaCliente(TarjetaCierres({ d: datos }))).toEqual([]);
  });
});
