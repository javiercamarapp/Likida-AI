import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA MESA DE CONTROL — lo que más importa:
//  · el orden es severidad y reloj (crítica arriba; dentro de la misma
//    severidad, la MÁS VIEJA primero — la que más lleva esperando);
//  · "detectada por cámara, el chofer no ha reportado" solo cuando es verdad;
//  · tomar el control es un claim: el perdedor recibe QUIÉN la tiene, no un
//    error mudo;
//  · resolver sin nota NO toca la base — sin nota no hay cierre;
//  · reescalar es monótono: bajar no existe, y un nivel inválido no llega a
//    la base.
// ═══════════════════════════════════════════════════════════════════════════

const anotarEventoIncidencia = vi.hoisted(() => vi.fn(async () => 'anotado' as const));
vi.mock('./asistencia_wa', () => ({
  anotarEventoIncidencia,
  TIPOS_ASISTENCIA: ['siniestro', 'robo', 'emergencia_medica', 'varado', 'bloqueo'],
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));
// El único dato que la mesa necesita del escalamiento es el tope de niveles —
// mockearlo recorta el grafo de imports (cobranza, cliente de Meta) que la
// suite no ejercita.
vi.mock('./asistencia_escalamiento', () => ({ NIVEL_MAXIMO: 4 }));

// `traerTodo` por etiqueta: la lista de incidencias y la de eventos llegan de
// aquí — el builder real de paginación no es lo que esta suite prueba.
const tablas = vi.hoisted(() => ({
  incidencias: [] as Array<Record<string, unknown>>,
  eventos: [] as Array<Record<string, unknown>>,
}));
vi.mock('./pg', () => ({
  traerTodo: async (_c: unknown, etiqueta: string) => {
    if (etiqueta === 'mesa.incidencias') return tablas.incidencias;
    if (etiqueta === 'mesa.eventos') return tablas.eventos;
    return [];
  },
}));

// La "base" de las intervenciones: builder THENABLE (como supabase-js). Los
// UPDATE registran su patch en `updates`; `updateFilas` decide cuántas filas
// "ganó" el UPDATE condicional (el claim). Los SELECT responden por tabla.
const updates = vi.hoisted(() => ({
  incidencia: [] as Array<Record<string, unknown>>,
  filas: [{ id: 'inc-1' }] as Array<Record<string, unknown>>,
}));
const selects = vi.hoisted(() => ({
  incidencia: [] as Array<Record<string, unknown>>,
  app_user: [] as Array<Record<string, unknown>>,
  operador: [] as Array<Record<string, unknown>>,
  unidad: [] as Array<Record<string, unknown>>,
  viaje: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {};
      for (const m of ['select', 'eq', 'neq', 'in', 'is', 'lt', 'order', 'limit', 'range']) api[m] = () => api;
      let esUpdate = false;
      api.update = (patch: Record<string, unknown>) => {
        esUpdate = true;
        if (tabla === 'incidencia') updates.incidencia.push(patch);
        return api;
      };
      api.then = (res: (v: unknown) => unknown) => {
        if (esUpdate) return res({ data: updates.filas, error: null });
        const filas = (selects as Record<string, Array<Record<string, unknown>>>)[tabla] ?? [];
        return res({ data: filas, error: null });
      };
      return api;
    },
  }),
}));

import {
  listarMesaAsistencia, tomarControlMesa, resolverDesdeMesa, reescalarDesdeMesa,
} from './mesa_control';

function fila(sobre: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 'inc-1', tipo: 'varado', prioridad: 'alta', estado: 'abierta',
    nivel_escalado: 0, abierta_en: '2026-08-27T10:00:00Z', descripcion: null,
    hay_lesionados: null, reconocida_en: null, reconocida_por: null,
    operador_id: null, unidad_id: null, viaje_id: null,
    ...sobre,
  };
}

beforeEach(() => {
  tablas.incidencias = [];
  tablas.eventos = [];
  updates.incidencia = [];
  updates.filas = [{ id: 'inc-1' }];
  selects.incidencia = [];
  selects.app_user = [];
  selects.operador = [];
  selects.unidad = [];
  selects.viaje = [];
  anotarEventoIncidencia.mockClear();
});

describe('listarMesaAsistencia — orden y verdad', () => {
  it('crítica arriba; dentro de la misma severidad, la más vieja primero', async () => {
    tablas.incidencias = [
      fila({ id: 'a', prioridad: 'alta', abierta_en: '2026-08-27T09:00:00Z' }),
      fila({ id: 'b', prioridad: 'critica', abierta_en: '2026-08-27T11:00:00Z' }),
      fila({ id: 'c', prioridad: 'critica', abierta_en: '2026-08-27T08:00:00Z' }),
    ];
    const r = await listarMesaAsistencia('t1');
    expect(r.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('«detectada por cámara, el chofer no ha reportado» SOLO cuando nació de cámara y el chofer sigue callado', async () => {
    tablas.incidencias = [fila({ id: 'a' }), fila({ id: 'b' }), fila({ id: 'c' })];
    tablas.eventos = [
      // a: nació por cámara y nadie más habló → soloCamara.
      { incidencia_id: 'a', tipo: 'abierta_por_camara', detalle: null, created_at: '2026-08-27T10:00:00Z' },
      // b: nació por cámara PERO el chofer ya escribió → ya no es "no ha reportado".
      { incidencia_id: 'b', tipo: 'abierta_por_camara', detalle: null, created_at: '2026-08-27T10:00:00Z' },
      { incidencia_id: 'b', tipo: 'mensaje_adicional', detalle: { texto: 'estoy bien' }, created_at: '2026-08-27T10:05:00Z' },
      // c: la abrió el chofer → jamás.
      { incidencia_id: 'c', tipo: 'abierta', detalle: null, created_at: '2026-08-27T10:00:00Z' },
    ];
    const r = await listarMesaAsistencia('t1');
    const por = new Map(r.map((i) => [i.id, i]));
    expect(por.get('a')?.soloCamara).toBe(true);
    expect(por.get('b')?.soloCamara).toBe(false);
    expect(por.get('c')?.soloCamara).toBe(false);
  });

  it('sin operador el rótulo es null — la condición se dice, no se inventa un chofer', async () => {
    tablas.incidencias = [fila({ id: 'a', operador_id: null, unidad_id: 'u-9' })];
    selects.unidad = [{ id: 'u-9', numero_economico: 'T-12', placas: 'ABC-123' }];
    const r = await listarMesaAsistencia('t1');
    expect(r[0].operadorNombre).toBeNull();
    expect(r[0].unidadRotulo).toBe('T-12 · ABC-123');
  });
});

describe('tomarControlMesa — el claim de la mesa', () => {
  it('el ganador reconoce, pasa a en_proceso y deja su fila en el expediente', async () => {
    const r = await tomarControlMesa('t1', 'inc-1', 'u-yo');
    expect('ok' in r).toBe(true);
    const patch = updates.incidencia[0];
    expect(patch.reconocida_por).toBe('u-yo');
    expect(patch.estado).toBe('en_proceso');
    expect(patch.responsable).toBe('u-yo');
    expect(anotarEventoIncidencia).toHaveBeenCalledWith('t1', 'inc-1', 'control_tomado', { por: 'u-yo', desde: 'mesa' });
  });

  it('el perdedor recibe QUIÉN la tiene — y no anota nada en el expediente', async () => {
    updates.filas = []; // el UPDATE condicional no ganó ninguna fila
    selects.incidencia = [{ estado: 'en_proceso', reconocida_por: 'u-otra' }];
    selects.app_user = [{ nombre: 'Karla' }];
    const r = await tomarControlMesa('t1', 'inc-1', 'u-yo');
    expect('error' in r && r.error).toBe('Ya la está atendiendo Karla.');
    expect(anotarEventoIncidencia).not.toHaveBeenCalled();
  });
});

describe('resolverDesdeMesa — sin nota no hay cierre', () => {
  it('una nota vacía o de puro aire se rechaza SIN tocar la base', async () => {
    const r = await resolverDesdeMesa('t1', 'inc-1', 'u-yo', '   ok  ');
    expect('error' in r).toBe(true);
    expect(updates.incidencia).toHaveLength(0);
    expect(anotarEventoIncidencia).not.toHaveBeenCalled();
  });

  it('con nota real cierra y la nota queda en el expediente', async () => {
    const r = await resolverDesdeMesa('t1', 'inc-1', 'u-yo', 'Grúa de López llegó, unidad en el taller.');
    expect('ok' in r).toBe(true);
    expect(updates.incidencia[0].estado).toBe('resuelta');
    expect(anotarEventoIncidencia).toHaveBeenCalledWith('t1', 'inc-1', 'resuelta_desde_mesa', {
      por: 'u-yo', nota: 'Grúa de López llegó, unidad en el taller.',
    });
  });

  it('la que ya estaba resuelta lo dice — no finge un segundo cierre', async () => {
    updates.filas = [];
    const r = await resolverDesdeMesa('t1', 'inc-1', 'u-yo', 'Nota perfectamente válida.');
    expect('error' in r && /ya estaba resuelta/.test(r.error)).toBe(true);
    expect(anotarEventoIncidencia).not.toHaveBeenCalled();
  });
});

describe('reescalarDesdeMesa — monótono, como el claim del cron', () => {
  it('un nivel inválido no llega a la base', async () => {
    for (const nivel of [0, 5, 2.5, NaN]) {
      const r = await reescalarDesdeMesa('t1', 'inc-1', 'u-yo', nivel);
      expect('error' in r).toBe(true);
    }
    expect(updates.incidencia).toHaveLength(0);
  });

  it('subir gana y queda en el expediente; "bajar" (0 filas por el lt) se explica', async () => {
    const sube = await reescalarDesdeMesa('t1', 'inc-1', 'u-yo', 2);
    expect('ok' in sube).toBe(true);
    expect(updates.incidencia[0].nivel_escalado).toBe(2);
    expect(anotarEventoIncidencia).toHaveBeenCalledWith('t1', 'inc-1', 'reescalada_manual', { por: 'u-yo', nivel: 2, desde: 'mesa' });

    anotarEventoIncidencia.mockClear();
    updates.filas = []; // el `lt('nivel_escalado', nivel)` no encontró fila
    const baja = await reescalarDesdeMesa('t1', 'inc-1', 'u-yo', 1);
    expect('error' in baja && /solo sube/.test(baja.error)).toBe(true);
    expect(anotarEventoIncidencia).not.toHaveBeenCalled();
  });
});
