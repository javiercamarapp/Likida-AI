// ═══════════════════════════════════════════════════════════════════════════
// AUD25 · rendimiento MEDIO línea 398 (REND-A7, REINCIDENTE de 23 y 24) —
// `getTaller` leía `mantenimiento` (cerradas) ordenando SOLO por `cerrada_en`,
// sin desempate único. Sin un ORDER BY totalmente determinista, Postgres no
// garantiza que dos ejecuciones separadas de la misma consulta (una página y
// la siguiente) devuelvan las filas EMPATADAS en el mismo orden relativo —
// así que una fila empatada puede quedar fuera de las dos páginas: ni la
// primera la incluye (porque en esa pasada "cayó" en la posición ≥1000) ni la
// segunda (porque en ESA pasada "cayó" en una posición <1000, ya cubierta por
// la primera). Ninguna prueba de `LecturaIncompleta` lo detecta: el `count`
// declarado se alcanza igual.
//
// Esta prueba construye 1,200 mantenimientos cerrados con un bloque de 50
// EMPATADOS en `cerrada_en` a caballo de la frontera de la página (posición
// 1,000), y coloca el registro de la unidad/rutina bajo prueba exactamente en
// la posición que un `ORDER BY` sin desempate puede perder — simulando que la
// base ordena los empates de forma distinta en cada ejecución de la consulta
// (algo que Postgres NO garantiza impedir sin una columna de desempate). Con
// el arreglo (`.order('cerrada_en', ...).order('id', ...)`), el orden es
// determinista y la fila SIEMPRE aparece.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));

const BASE = Date.parse('2026-08-01T00:00:00.000Z');
const iso = (msAtras: number) => new Date(BASE - msAtras).toISOString();

type FilaMtto = { id: string; rutina_id: string; unidad_id: string; cerrada_en: string; km_servicio: number | null };

// 975 filas "PRE" con cerrada_en distinta y descendente.
const pre: FilaMtto[] = Array.from({ length: 975 }, (_, i) => ({
  id: `pre-${String(i).padStart(4, '0')}`, rutina_id: 'rX', unidad_id: 'uX',
  cerrada_en: iso(i * 1_000), km_servicio: null,
}));
// 50 filas EMPATADAS (mismo cerrada_en), justo después de PRE — a caballo de
// la posición 1,000. La fila BAJO PRUEBA (r1/u1) tiene el id MÁS ALTO del
// bloque: es la posición que un orden ascendente por id manda al FINAL del
// bloque (≥1,000, fuera de la página 1) y que un orden descendente por id
// manda al PRINCIPIO del bloque (<1,000, fuera de la ventana de la página 2).
const TIE_EN = iso(975 * 1_000);
const tie: FilaMtto[] = Array.from({ length: 50 }, (_, i) => ({
  id: `tie-${String(i).padStart(3, '0')}`,
  rutina_id: i === 49 ? 'r1' : 'rY', unidad_id: i === 49 ? 'u1' : 'uY',
  cerrada_en: TIE_EN, km_servicio: null,
}));
// 175 filas "AFTER" con cerrada_en distinta, por debajo del empate.
const after: FilaMtto[] = Array.from({ length: 175 }, (_, i) => ({
  id: `after-${String(i).padStart(4, '0')}`, rutina_id: 'rZ', unidad_id: 'uZ',
  cerrada_en: iso(975_000 + 1_000 + i * 1_000), km_servicio: null,
}));
const TODAS: FilaMtto[] = [...pre, ...tie, ...after];

function ordenar(filas: FilaMtto[], ordenes: Array<{ col: string; asc: boolean }>, variante: 'A' | 'B'): FilaMtto[] {
  const tieneId = ordenes.some((o) => o.col === 'id');
  return [...filas].sort((a, b) => {
    for (const o of ordenes) {
      const av = (a as Record<string, unknown>)[o.col] as string;
      const bv = (b as Record<string, unknown>)[o.col] as string;
      if (av < bv) return o.asc ? -1 : 1;
      if (av > bv) return o.asc ? 1 : -1;
    }
    if (tieneId) return 0; // ya desempatado arriba
    // SIN desempate único: se simula que la base resuelve el empate distinto
    // en cada ejecución de la consulta — variante A para la primera página,
    // B para la segunda. Es la falla de fondo que un ORDER BY parcial permite.
    return variante === 'A' ? (a.id < b.id ? -1 : 1) : (a.id < b.id ? 1 : -1);
  });
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const ordenes: Array<{ col: string; asc: boolean }> = [];
      let pedirConteo = false;
      let esCerradas = false;
      let esAbiertas = false;
      let desde = 0;
      let hasta = 0;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_c: string, o?: { count?: string }) => { pedirConteo = o?.count === 'exact'; return b; },
        eq: (col: string, v: unknown) => { if (col === 'estado' && v === 'cerrada') esCerradas = true; return b; },
        neq: (col: string, v: unknown) => { if (col === 'estado' && v === 'cerrada') esAbiertas = true; return b; },
        not: () => b,
        order: (col: string, o?: { ascending?: boolean }) => { ordenes.push({ col, asc: o?.ascending !== false }); return b; },
        range: (d: number, h: number) => { desde = d; hasta = h; return b; },
        then: (res: (v: unknown) => unknown) => {
          if (tabla === 'unidad') return Promise.resolve({ data: [{ id: 'u1', numero_economico: 'U-1', km_actual: null, activo: true }], error: null, count: 1 }).then(res);
          if (tabla === 'rutina_mantenimiento') return Promise.resolve({ data: [{ id: 'r1', nombre: 'Servicio mayor', cada_dias: 90, cada_km: null, activa: true }], error: null, count: 1 }).then(res);
          if (tabla !== 'mantenimiento') throw new Error(`tabla inesperada: ${tabla}`);
          if (esAbiertas) return Promise.resolve({ data: [], error: null, count: 0 }).then(res);
          if (!esCerradas) throw new Error('consulta de mantenimiento sin filtro esperado');
          const variante = desde === 0 ? 'A' : 'B';
          const completo = ordenar(TODAS, ordenes, variante);
          const ventana = completo.slice(desde, hasta + 1);
          return Promise.resolve({ data: ventana, error: null, count: pedirConteo ? TODAS.length : undefined }).then(res);
        },
      });
      return b;
    },
  }),
}));

const { getTaller } = await import('./mantenimiento');

describe('AUD25 rendimiento MEDIO L398: getTaller no pierde un cierre reciente EMPATADO a caballo de la página', () => {
  it('con el desempate por id, r1/u1 se reconoce como recién servida (sin propuesta sin_historial)', async () => {
    // 3 días desde el cierre real (TIE_EN), muy por debajo de cadaDias=90.
    const hoy = new Date(BASE + 3 * 24 * 60 * 60 * 1000);
    const t = await getTaller('t1', hoy);
    const propuestaPerdida = t.propuestas.find((p) => p.rutinaId === 'r1' && p.unidadId === 'u1');
    expect(propuestaPerdida, 'r1/u1 no debería proponerse: su cierre reciente SÍ se leyó').toBeUndefined();
  });
});
