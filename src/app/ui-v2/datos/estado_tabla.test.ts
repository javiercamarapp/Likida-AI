import { describe, expect, it } from 'vitest';
import { ariaSort, clavesTabla, destinoFoco, hrefConParams, leerEstadoTabla, ordenarFilas, paginarFilas, siguienteOrden, ventanaPaginas } from './estado-tabla';

describe('leerEstadoTabla (la URL es el estado)', () => {
  const op = { ordenables: ['fecha', 'total'] };
  it('lee orden, dirección y página', () => {
    expect(leerEstadoTabla({ orden: 'total', dir: 'desc', pag: '3' }, op)).toEqual({ orden: 'total', dir: 'desc', pagina: 3 });
  });
  it('una columna que no es ordenable, una dirección rara o una página corrupta caen a lo de siempre (nunca lanza)', () => {
    expect(leerEstadoTabla({ orden: 'password', dir: 'x', pag: '-4' }, op)).toEqual({ orden: null, dir: 'asc', pagina: 1 });
    expect(leerEstadoTabla({ orden: 'fecha', dir: 'sideways', pag: 'abc' }, op)).toEqual({ orden: 'fecha', dir: 'asc', pagina: 1 });
    expect(leerEstadoTabla({ pag: '1.5' }, op).pagina).toBe(1);
    expect(leerEstadoTabla({ pag: '999999999' }, op).pagina).toBe(1);
  });
  it('sin orden en la URL usa el inicial; con valor repetido toma el primero', () => {
    expect(leerEstadoTabla({}, { ...op, inicial: { orden: 'fecha', dir: 'desc' } })).toEqual({ orden: 'fecha', dir: 'desc', pagina: 1 });
    expect(leerEstadoTabla({ orden: ['total', 'fecha'] }, op).orden).toBe('total');
  });
  it('el prefijo separa dos tablas de la misma pantalla', () => {
    expect(clavesTabla('cola_')).toEqual({ orden: 'cola_orden', dir: 'cola_dir', pagina: 'cola_pag' });
    expect(leerEstadoTabla({ cola_orden: 'total', orden: 'fecha' }, { ...op, prefijo: 'cola_' }).orden).toBe('total');
  });
});

describe('ordenarFilas', () => {
  const f = (v: unknown) => ({ v });
  const valores = (filas: Array<{ v: unknown }>) => filas.map((x) => x.v);
  it('números como números (9 antes que 10), en las dos direcciones', () => {
    const filas = [f(10), f(9), f(100), f(1)];
    expect(valores(ordenarFilas(filas, (x) => x.v as number, 'asc'))).toEqual([1, 9, 10, 100]);
    expect(valores(ordenarFilas(filas, (x) => x.v as number, 'desc'))).toEqual([100, 10, 9, 1]);
  });
  it('los sin dato van SIEMPRE al final, ascendente o descendente (nunca cuentan como cero)', () => {
    const filas = [f(null), f(5), f(undefined), f(-2), f('')];
    expect(valores(ordenarFilas(filas, (x) => x.v as number, 'asc'))).toEqual([-2, 5, null, undefined, '']);
    expect(valores(ordenarFilas(filas, (x) => x.v as number, 'desc'))).toEqual([5, -2, null, undefined, '']);
  });
  it('texto al estilo de Excel en español: sin mayúsculas ni acentos, y V-2 antes que V-10', () => {
    const filas = [f('V-10'), f('Álvaro'), f('alma'), f('V-2'), f('Zacarías')];
    expect(valores(ordenarFilas(filas, (x) => x.v as string, 'asc'))).toEqual(['alma', 'Álvaro', 'V-2', 'V-10', 'Zacarías']);
  });
  it('es estable: los empates conservan el orden original y no se muta la entrada', () => {
    const filas = [{ k: 1, v: 'a' }, { k: 2, v: 'a' }, { k: 3, v: 'a' }];
    const copia = [...filas];
    expect(ordenarFilas(filas, (x) => x.v, 'desc').map((x) => x.k)).toEqual([1, 2, 3]);
    expect(filas).toEqual(copia);
  });
  it('fechas ISO y objetos Date por su instante; booleanos false < true; NaN e Infinity cuentan como sin dato', () => {
    expect(valores(ordenarFilas([f(new Date('2026-10-02')), f(new Date('2026-09-01'))], (x) => x.v as Date, 'asc')).map((d) => (d as Date).toISOString().slice(0, 10))).toEqual(['2026-09-01', '2026-10-02']);
    expect(valores(ordenarFilas([f(true), f(false)], (x) => x.v as boolean, 'asc'))).toEqual([false, true]);
    expect(valores(ordenarFilas([f(NaN), f(1), f(Infinity)], (x) => x.v as number, 'asc'))).toEqual([1, NaN, Infinity]);
  });
});

describe('paginarFilas', () => {
  const filas = Array.from({ length: 53 }, (_, i) => i + 1);
  it('recorta, cuenta y dice «desde–hasta de total»', () => {
    const p = paginarFilas(filas, 2, 25);
    expect(p.filas[0]).toBe(26);
    expect(p).toMatchObject({ pagina: 2, paginas: 3, total: 53, desde: 26, hasta: 50 });
    expect(paginarFilas(filas, 3, 25)).toMatchObject({ desde: 51, hasta: 53 });
  });
  it('una página fuera de rango cae a la última, no deja la tabla vacía', () => {
    expect(paginarFilas(filas, 99, 25).pagina).toBe(3);
    expect(paginarFilas(filas, 0, 25).pagina).toBe(1);
  });
  it('sin filas: 0–0 de 0, una sola página', () => {
    expect(paginarFilas([], 1, 25)).toMatchObject({ desde: 0, hasta: 0, total: 0, paginas: 1 });
  });
});

describe('hrefConParams', () => {
  it('conserva tenant/vista/rol/filtros, cambia lo pedido y quita lo nulo', () => {
    const h = hrefConParams('/dashboard/viajes', { tenant: 'abc', f: 'abiertos', pag: '4', orden: 'fecha' }, { orden: 'total', dir: 'desc', pag: null });
    const q = new URL(h, 'https://x').searchParams;
    expect(h.startsWith('/dashboard/viajes?')).toBe(true);
    expect(Object.fromEntries(q)).toEqual({ tenant: 'abc', f: 'abiertos', orden: 'total', dir: 'desc' });
  });
  it('sin parámetros devuelve la ruta limpia; repite las claves con varios valores', () => {
    expect(hrefConParams('/x', { a: '1' }, { a: null })).toBe('/x');
    expect(hrefConParams('/x', { t: ['1', '2'] }, {})).toBe('/x?t=1&t=2');
  });
  it('base vacía (esta misma página): sin parámetros devuelve «?» para limpiar la query, no «» que la conservaría', () => {
    expect(hrefConParams('', { rev: 'x' }, { rev: null })).toBe('?');
    expect(hrefConParams('', { tenant: 'T' }, { rev: 'x' })).toBe('?tenant=T&rev=x');
  });
  it('escapa valores hostiles (no se puede colar otro parámetro ni salir de la ruta)', () => {
    const h = hrefConParams('/x', {}, { q: 'a&b=1#x' });
    expect(h).toBe('/x?q=a%26b%3D1%23x');
  });
});

describe('ciclo de orden por cabecera', () => {
  it('otra columna → ascendente; la misma → descendente; de nuevo → se quita', () => {
    expect(siguienteOrden({ orden: null, dir: 'asc' }, 'fecha')).toEqual({ orden: 'fecha', dir: 'asc' });
    expect(siguienteOrden({ orden: 'fecha', dir: 'asc' }, 'fecha')).toEqual({ orden: 'fecha', dir: 'desc' });
    expect(siguienteOrden({ orden: 'fecha', dir: 'desc' }, 'fecha')).toBeNull();
    expect(siguienteOrden({ orden: 'total', dir: 'desc' }, 'fecha')).toEqual({ orden: 'fecha', dir: 'asc' });
  });
  it('si la columna es el orden por omisión, el ciclo no se sale de ella', () => {
    expect(siguienteOrden({ orden: 'fecha', dir: 'desc' }, 'fecha', { orden: 'fecha', dir: 'desc' })).toEqual({ orden: 'fecha', dir: 'asc' });
  });
  it('aria-sort', () => {
    expect(ariaSort({ orden: 'a', dir: 'asc' }, 'a')).toBe('ascending');
    expect(ariaSort({ orden: 'a', dir: 'desc' }, 'a')).toBe('descending');
    expect(ariaSort({ orden: 'a', dir: 'desc' }, 'b')).toBe('none');
  });
});

describe('ventanaPaginas', () => {
  it('primera, última y alrededor de la actual con huecos', () => {
    expect(ventanaPaginas(1, 3)).toEqual([1, 2, 3]);
    expect(ventanaPaginas(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(ventanaPaginas(2, 20)).toEqual([1, 2, 3, null, 20]);
    expect(ventanaPaginas(1, 1)).toEqual([1]);
  });
});

describe('destinoFoco (teclado de la tabla)', () => {
  it('↓ ↑ pasan al mismo control de la fila vecina y paran en los bordes', () => {
    expect(destinoFoco('ArrowDown', false, 0, 2, 5)).toEqual({ fila: 1, indice: 2 });
    expect(destinoFoco('ArrowUp', false, 3, 0, 5)).toEqual({ fila: 2, indice: 0 });
    expect(destinoFoco('ArrowDown', false, 4, 0, 5)).toBeNull();
    expect(destinoFoco('ArrowUp', false, 0, 0, 5)).toBeNull();
  });
  it('Ctrl+Inicio / Ctrl+Fin saltan a los extremos; sin Ctrl, Inicio y Fin no se secuestran', () => {
    expect(destinoFoco('Home', true, 3, 1, 5)).toEqual({ fila: 0, indice: 1 });
    expect(destinoFoco('End', true, 1, 1, 5)).toEqual({ fila: 4, indice: 1 });
    expect(destinoFoco('Home', false, 3, 1, 5)).toBeNull();
    expect(destinoFoco('ArrowLeft', false, 3, 1, 5)).toBeNull();
    expect(destinoFoco('ArrowDown', false, 0, 0, 0)).toBeNull();
  });
});
