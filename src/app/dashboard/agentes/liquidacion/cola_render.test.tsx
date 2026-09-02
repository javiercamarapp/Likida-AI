import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionCola, rotuloCola, paramsDeFiltros } from './cola';
import { SIN_FILTROS, type FiltrosCola, type PaginaCola, type FilaCola } from '@/lib/likida/revision';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · FE-5 — la cola dejó de ser «las 50 más recientes».
//
// Lo que se prueba es lo que hacía FALSA a la tabla vieja: el rótulo salía del
// LARGO de una lista topada («se listan 12 de 340 — las más recientes») y las
// que más llevaban esperando no estaban. Ahora el total lo cuenta la base y el
// orden es por antigüedad, así que el rótulo tiene que decir eso y el vacío
// bajo filtro no puede leerse como «no hay nada que firmar».
// ═══════════════════════════════════════════════════════════════════════════

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fila = (i: number): FilaCola => ({
  id: U(i), viajeId: U(500 + i), folio: `V-${i}`, creadoEn: '2026-08-20T15:00:00+00:00',
  comprobado: 4900, anticipo: 5000, diferencia: 100, estatus: 'revisar', revision: 'pendiente',
  operadorNombre: i === 0 ? null : `Chofer ${i}`, unidadEco: `C-${i}`, terminalNombre: 'Monterrey',
});

const pagina = (filas: FilaCola[], total: number, siguiente: string | null = null): PaginaCola =>
  ({ filas, total, hayMas: siguiente !== null, siguiente });

// `SeccionCola` es un componente de servidor ASÍNCRONO: se resuelve primero y
// se pinta el árbol que devuelve (renderToStaticMarkup no suspende).
const pintar = async (
  p: PaginaCola,
  f: FiltrosCola = SIN_FILTROS,
  terminales: { opciones: Array<{ id: string; nombre: string }>; recortadas: boolean } | null =
    { opciones: [{ id: U(9), nombre: 'Monterrey' }], recortadas: false },
) => renderToStaticMarkup(await SeccionCola({
  cola: Promise.resolve(p),
  filtros: f,
  terminales: Promise.resolve(terminales),
  buscar: async () => [],
  contexto: terminales === null ? [] : [['tenant', 'flota-1']],
  sufijo: terminales === null ? '' : '?tenant=flota-1',
}));

describe('rotuloCola — «N de M» con la M contada por la base', () => {
  it('con más de las que caben en la página, dice cuántas de cuántas y en qué orden', () => {
    expect(rotuloCola(pagina([fila(1)], 340, 'cur'), SIN_FILTROS))
      .toBe('1 de 340 — esperan firma, las que más llevan esperando primero');
  });

  it('cuando la página ES la cola entera, no finge que falta algo', () => {
    expect(rotuloCola(pagina([fila(1), fila(2)], 2), SIN_FILTROS)).toBe('2 liquidaciones — esperan firma');
  });

  it('cero medido se dice como cero, con el nombre del filtro', () => {
    expect(rotuloCola(pagina([], 0), SIN_FILTROS)).toBe('Ninguna espera tu firma');
    expect(rotuloCola(pagina([], 0), { ...SIN_FILTROS, revision: 'rechazada' })).toBe('Ninguna rechazada');
  });

  it('un estado de revisión sin rótulo escrito NO tumba la pantalla donde se firma', () => {
    expect(rotuloCola(pagina([], 0), { ...SIN_FILTROS, revision: 'inventada' as never })).toContain('inventada');
    expect(rotuloCola(pagina([fila(1)], 9), { ...SIN_FILTROS, revision: 'inventada' as never })).toContain('1 de 9');
  });
});

describe('paramsDeFiltros — lo que viaja en el link de la siguiente página', () => {
  it('lo que está en su valor por omisión no ensucia la URL', () => {
    expect(paramsDeFiltros(SIN_FILTROS)).toEqual([]);
  });
  it('cada filtro puesto viaja con su llave de la query', () => {
    expect(paramsDeFiltros({
      revision: 'aprobada', estado: 'revisar', operadorId: U(1), unidadId: U(2),
      terminalId: U(3), desde: '2026-08-01', hasta: '2026-08-31',
    })).toEqual([
      ['rev', 'aprobada'], ['estado', 'revisar'], ['operador', U(1)], ['unidad', U(2)],
      ['terminal', U(3)], ['desde', '2026-08-01'], ['hasta', '2026-08-31'],
    ]);
  });
});

describe('SeccionCola', () => {
  it('pinta el total REAL, una fila por liquidación y el link a firmarla', async () => {
    const html = await pintar(pagina([fila(1), fila(2)], 340, 'cursor-2'));
    expect(html).toContain('340');
    expect(html).toContain('V-1');
    expect(html).toContain('Chofer 2');
    expect(html).toContain(`/dashboard/${U(1)}?tenant=flota-1`);
    // El link de la siguiente página lleva el cursor Y conserva el contexto.
    expect(html).toContain('cursor=cursor-2');
    expect(html).toContain('tenant=flota-1');
    expect(html).toContain('Siguientes');
  });

  it('sin nombre de operador pinta un guion — no inventa uno', async () => {
    const html = await pintar(pagina([fila(0)], 1));
    expect(html).toContain('—');
  });

  it('sin cursor no hay «siguientes»: la cola no promete una página que no existe', async () => {
    const html = await pintar(pagina([fila(1)], 1));
    expect(html).not.toContain('Siguientes');
  });

  it('vacío CON filtros dice que es el filtro, no que no haya nada que firmar', async () => {
    const html = await pintar(pagina([], 0), { ...SIN_FILTROS, terminalId: U(9) });
    expect(html).toContain('Ninguna liquidación cae en ese filtro');
    expect(html).toContain('Limpiar');
  });

  it('vacío SIN filtros dice la verdad tranquila, y no ofrece limpiar nada', async () => {
    const html = await pintar(pagina([], 0));
    expect(html).toContain('No hay liquidaciones esperando a un humano');
    expect(html).not.toContain('Limpiar');
  });

  it('los filtros van en un <form method="get"> con el contexto de la sesión', async () => {
    const html = await pintar(pagina([fila(1)], 1));
    expect(html).toContain('method="get"');
    expect(html).toContain('name="rev"');
    expect(html).toContain('name="estado"');
    expect(html).toContain('name="terminal"');
    expect(html).toContain('name="desde"');
    expect(html).toContain('name="hasta"');
    expect(html).toContain('name="operador"');
    expect(html).toContain('name="unidad"');
    expect(html).toContain('type="hidden" name="tenant" value="flota-1"');
  });

  it('sin terminales legibles NO se pinta el selector — no se afirma que la flota no tenga sucursales', async () => {
    const html = await pintar(pagina([fila(1)], 1), SIN_FILTROS, null);
    expect(html).not.toContain('name="terminal"');
  });
});
