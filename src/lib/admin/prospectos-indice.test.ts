import { beforeEach, describe, expect, it, vi } from 'vitest';

// w15/perf (puntos 4, 5 y 6) — el ÍNDICE LIGERO de la cartera viva y el RESUMEN que comparten Ventas, Crecimiento y Adquisición.
// Lo que se fija: UNA definición de «vivo» (sin `duplicado_de` y sin la marca DUPLICADO: en notas), una sola lectura compartida (el memo),
// que una lectura caída LANZA y no se queda cacheada, y que /admin/vendedores pide `notas` solo de las tarjetas que pinta.

const d = vi.hoisted(() => ({
  indice: [] as Array<Record<string, unknown>>,
  marcadas: [] as Array<{ id: string; notas: string | null }>,
  lecturas: [] as string[],
  falla: false,
  notas: new Map<string, string | null>(),
  idsPedidos: [] as string[][],
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn() }));
vi.mock('@/lib/likida/pg', async (importar) => ({
  ...(await importar<typeof import('@/lib/likida/pg')>()),
  conteo: () => ({}),
  traerTodoEnParalelo: async (_construir: unknown, consulta: string) => {
    d.lecturas.push(consulta);
    if (d.falla) throw new Error('base caída');
    return consulta.includes('marcas de duplicado') ? d.marcadas : d.indice;
  },
  traerPorIds: async (ids: string[]) => {
    d.idsPedidos.push(ids);
    return ids.map((id) => ({ id, notas: d.notas.get(id) ?? null }));
  },
}));

import {
  embudoCanonico, getPipelineVendedores, getResumenProspectos, indiceProspectos, reiniciarIndiceProspectos, resumirIndice,
} from './prospectos-mapa';

const fila = (id: string, o: Record<string, unknown> = {}) => ({
  id, empresa: `Empresa ${id}`, vacante: null, ciudad: 'Monterrey, Nuevo León', estado: 'nuevo', fuente: 'censo', vendedor_id: null,
  created_at: `2026-11-0${(Number(id.replace(/\D/g, '')) % 9) + 1}T10:00:00Z`, telefono: '81', contacto_nombre: null, ...o,
});

beforeEach(() => {
  reiniciarIndiceProspectos();
  d.indice = []; d.marcadas = []; d.lecturas = []; d.falla = false; d.notas = new Map(); d.idsPedidos = [];
});

describe('el resumen: UNA cifra de prospectos', () => {
  it('total, embudo, plazas y fuentes salen de las MISMAS filas', async () => {
    d.indice = [
      fila('a1', { estado: 'nuevo' }),
      fila('a2', { estado: 'negociacion', ciudad: 'Guadalajara', telefono: null, contacto_nombre: 'Ana' }),
      fila('a3', { estado: 'cerrado', ciudad: null }),
      fila('a4', { estado: 'won', ciudad: 'Escobedo, Nuevo León' }),
    ];
    const r = await getResumenProspectos();
    expect(r.total).toBe(4);
    // Los alias históricos suman en su etapa canónica (negociacion → proposal, cerrado → won).
    const e = embudoCanonico(r);
    expect(e.proposal).toBe(1);
    expect(e.won).toBe(2);
    // La suma de lo que se enseña es el total: nada se pierde ni se cuenta dos veces.
    const sumaEmbudo = Object.values(e).reduce((s, n) => s + n, 0);
    expect(sumaEmbudo).toBe(r.total);
    const sumaPlazas = Object.values(r.porEntidad).reduce((s, x) => s + x.n, 0);
    expect(sumaPlazas + r.sinPlaza).toBe(r.total);
    expect(r.porEntidad['Nuevo León'].n).toBe(2);
    expect(r.porEntidad['Jalisco'].n).toBe(1);
    expect(r.sinPlaza).toBe(1);
    expect(r.conTelefono).toBe(3);
    expect(r.conDecisor).toBe(1);
  });

  it('un vivo marcado DUPLICADO: en notas queda fuera de TODAS las cifras (la definición que el mapa siempre aplicó)', async () => {
    d.indice = [fila('a1'), fila('a2'), fila('a3')];
    d.marcadas = [{ id: 'a2', notas: 'DUPLICADO: de a1' }, { id: 'a3', notas: 'duplicado: no es la marca (minúsculas)' }];
    const { filas } = await indiceProspectos();
    expect(filas.map((f) => f.id).sort()).toEqual(['a1', 'a3']);
    expect(resumirIndice({ filas, generadoEn: 'x' }).total).toBe(2);
  });

  it('el índice no lleva `notas` ni ningún texto largo: solo lo que hace falta para contar y filtrar', async () => {
    d.indice = [fila('a1')];
    const { filas } = await indiceProspectos();
    expect(Object.keys(filas[0]).sort()).toEqual(
      ['conDecisor', 'conTelefono', 'createdAt', 'ciudad', 'empresa', 'estado', 'fuente', 'id', 'vacante', 'vendedorId'].sort(),
    );
  });
});

describe('una sola lectura compartida', () => {
  it('dos pantallas casi simultáneas leen la base UNA vez', async () => {
    d.indice = [fila('a1')];
    const [a, b] = await Promise.all([getResumenProspectos(), getResumenProspectos()]);
    expect(a.total).toBe(b.total);
    expect(d.lecturas.filter((l) => l === 'prospecto (indice)')).toHaveLength(1);
  });

  it('`fresco` salta el memo (vendedores escribe y tiene que verse)', async () => {
    d.indice = [fila('a1')];
    await indiceProspectos();
    await indiceProspectos({ fresco: true });
    expect(d.lecturas.filter((l) => l === 'prospecto (indice)')).toHaveLength(2);
  });

  it('una lectura caída LANZA y no se queda en el memo (el siguiente intento vuelve a leer)', async () => {
    d.falla = true;
    await expect(getResumenProspectos()).rejects.toThrow(/base caída/);
    d.falla = false;
    d.indice = [fila('a1')];
    expect((await getResumenProspectos()).total).toBe(1);
  });
});

describe('el pipeline de /admin/vendedores', () => {
  it('totales y columnas salen del índice; `notas` se pide SOLO de las tarjetas visibles (tope por columna)', async () => {
    d.indice = Array.from({ length: 50 }, (_, i) => fila(`n${i}`, { estado: 'nuevo', created_at: '2026-11-01T10:00:00Z' }));
    d.indice.push(fila('g1', { estado: 'cerrado', vendedor_id: 'v1' }));
    d.notas.set('n0', 'nota cero');
    const p = await getPipelineVendedores({}, 30);
    expect(p.totalProspectos).toBe(51);
    expect(p.totales.nuevo).toBe(50);
    expect(p.totales.won).toBe(1);
    expect(p.vivosSinVendedor).toBe(50);
    const nuevo = p.columnas.find((c) => c.estado === 'nuevo')!;
    expect(nuevo.total).toBe(50);
    expect(nuevo.tarjetas).toHaveLength(30);
    // Solo 31 ids viajan (30 de «Nuevo» + 1 de «Ganado»), no los 51 y mucho menos 33 mil.
    expect(d.idsPedidos.flat()).toHaveLength(31);
    expect(nuevo.tarjetas.find((t) => t.id === 'n0')?.notas).toBe('nota cero');
    expect(p.columnas.find((c) => c.estado === 'won')!.tarjetas[0].estado).toBe('won');
  });

  it('los filtros de vendedor y texto cambian el `total` de la columna, no los KPI', async () => {
    d.indice = [
      fila('a1', { vendedor_id: 'v1', empresa: 'Fletes del Norte' }),
      fila('a2', { vendedor_id: null, empresa: 'Transportes Sur' }),
      fila('a3', { vendedor_id: 'v1', empresa: 'Transportes Sur' }),
    ];
    const sin = await getPipelineVendedores({ vendedor: 'sin' }, 30);
    expect(sin.columnas.find((c) => c.estado === 'nuevo')!.total).toBe(1);
    expect(sin.totalProspectos).toBe(3);
    const texto = await getPipelineVendedores({ q: 'fletes' }, 30);
    expect(texto.columnas.find((c) => c.estado === 'nuevo')!.total).toBe(1);
    expect(texto.totales.nuevo).toBe(3);
  });

  it('pide el índice FRESCO: quien acaba de mover un prospecto lo ve en su columna', async () => {
    d.indice = [fila('a1')];
    await indiceProspectos();
    await getPipelineVendedores({}, 30);
    expect(d.lecturas.filter((l) => l === 'prospecto (indice)')).toHaveLength(2);
  });
});
