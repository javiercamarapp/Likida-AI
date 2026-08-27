import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL DISPARO POR CÁMARA — lo que más importa:
//  · la incidencia nace con la VERDAD de la cámara (siniestro/critica,
//    lesionados NULL — la cámara no da partes médicos);
//  · el aviso al jefe DICE la fuente y que el chofer no ha reportado;
//  · un expediente ya abierto recibe la detección como evidencia, sin un
//    segundo 🚨 — y la carrera contra el chofer la resuelve el índice 0201.
// ═══════════════════════════════════════════════════════════════════════════

const crearIncidencia = vi.hoisted(() => vi.fn(async () => 'inc-1'));
vi.mock('./operacion', () => ({ crearIncidencia }));

const anotarEventoIncidencia = vi.hoisted(() => vi.fn(async () => 'anotado' as const));
vi.mock('./asistencia_wa', () => ({
  anotarEventoIncidencia,
  TIPOS_ASISTENCIA: ['siniestro', 'robo', 'emergencia_medica', 'varado', 'bloqueo'],
}));

const telefonoJefeDe = vi.hoisted(() => vi.fn(async () => '+5215512345678'));
vi.mock('./contactos', () => ({ telefonoJefeDe }));

const sendButtons = vi.hoisted(() => vi.fn(async () => 'wamid.1'));
vi.mock('@/lib/meta/client', () => ({ sendButtons }));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));

// La "base": viaje abierto de la unidad, expediente abierto, rótulo de unidad.
// El builder es THENABLE (como el real de supabase-js): `expedienteAbierto`
// encadena `.eq()` DESPUÉS de `.limit(1)`, así que ningún método puede ser el
// que "cierra" — cierra el await. `abierta.cola` permite que lecturas
// sucesivas del expediente devuelvan cosas distintas (la carrera del 0201).
const viajeAbierto = vi.hoisted(() => ({ v: null as Record<string, unknown> | null }));
const abierta = vi.hoisted(() => ({
  v: null as { id: string } | null,
  cola: [] as Array<{ id: string } | null>,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {};
      for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit']) api[m] = () => api;
      api.maybeSingle = () => Promise.resolve({
        data: tabla === 'unidad' ? { numero_economico: 'T-12', placas: 'ABC-123' } : null,
        error: null,
      });
      api.then = (res: (v: unknown) => unknown) => {
        if (tabla === 'viaje') return res({ data: viajeAbierto.v ? [viajeAbierto.v] : [], error: null });
        if (tabla === 'incidencia') {
          const f = abierta.cola.length > 0 ? abierta.cola.shift() : abierta.v;
          return res({ data: f ? [f] : [], error: null });
        }
        return res({ data: [], error: null });
      };
      return api;
    },
  }),
}));

import { dispararAsistenciaPorEventoCamara } from './asistencia_camara';

const EVENTO = {
  tenantId: 't-1',
  unidadId: 'u-1',
  proveedor: 'samsara',
  eventoIdExterno: 'evt-1',
  etiquetas: ['Crash'],
  lat: 20.97,
  lng: -89.62,
  ocurridoEn: '2026-08-26T18:00:00.000Z',
  urlEvento: 'https://cloud.samsara.com/x/evt-1',
  maxG: 2.4,
};

describe('dispararAsistenciaPorEventoCamara', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viajeAbierto.v = null;
    abierta.v = null;
    abierta.cola = [];
  });

  it('abre siniestro crítico con lesionados NULL — la cámara no da partes médicos', async () => {
    viajeAbierto.v = { id: 'v-9', operador_id: 'op-9', folio: 'F-104' };
    const r = await dispararAsistenciaPorEventoCamara(EVENTO);
    expect(r.resultado).toBe('abierta');
    expect(crearIncidencia).toHaveBeenCalledWith('t-1', expect.objectContaining({
      tipo: 'siniestro',
      prioridad: 'critica',
      viajeId: 'v-9',
      operadorId: 'op-9',
      unidadId: 'u-1',
      hayLesionados: null,
      lat: 20.97,
      lng: -89.62,
    }));
  });

  it('el aviso al jefe dice la FUENTE y que el chofer NO ha reportado', async () => {
    viajeAbierto.v = { id: 'v-9', operador_id: 'op-9', folio: 'F-104' };
    await dispararAsistenciaPorEventoCamara(EVENTO);
    expect(sendButtons).toHaveBeenCalledTimes(1);
    const [tel, cuerpo, botones] = sendButtons.mock.calls[0] as unknown as [string, string, Array<{ id: string }>];
    expect(tel).toBe('+5215512345678');
    expect(cuerpo).toContain('cámara');
    expect(cuerpo).toContain('T-12');
    expect(cuerpo).toContain('NO ha reportado');
    expect(cuerpo).toContain('viaje F-104');
    expect(botones[0].id).toBe('asi_ok:inc-1');
  });

  it('con expediente YA abierto, la detección se anota como evidencia — sin segundo 🚨', async () => {
    viajeAbierto.v = { id: 'v-9', operador_id: 'op-9', folio: null };
    abierta.v = { id: 'inc-previa' };
    const r = await dispararAsistenciaPorEventoCamara(EVENTO);
    expect(r).toMatchObject({ resultado: 'anotada_en_existente', incidenciaId: 'inc-previa' });
    expect(crearIncidencia).not.toHaveBeenCalled();
    expect(sendButtons).not.toHaveBeenCalled();
    expect(anotarEventoIncidencia).toHaveBeenCalledWith('t-1', 'inc-previa', 'deteccion_camara', expect.objectContaining({
      evento: 'evt-1', proveedor: 'samsara',
    }));
  });

  it('sin viaje abierto, la incidencia nace sin operador pero CON la unidad', async () => {
    const r = await dispararAsistenciaPorEventoCamara(EVENTO);
    expect(r.resultado).toBe('abierta');
    expect(crearIncidencia).toHaveBeenCalledWith('t-1', expect.objectContaining({
      viajeId: null, operadorId: null, unidadId: 'u-1',
    }));
  });

  it('la carrera contra el reporte del chofer: unique_violation → anota en el ganador', async () => {
    viajeAbierto.v = { id: 'v-9', operador_id: 'op-9', folio: null };
    crearIncidencia.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "incidencia_asistencia_abierta_unica"'));
    // Primera lectura: nadie ha abierto. Segunda (tras perder la carrera): el
    // expediente del ganador ya está ahí.
    abierta.cola = [null, { id: 'inc-ganadora' }];
    const r = await dispararAsistenciaPorEventoCamara(EVENTO);
    expect(r).toMatchObject({ resultado: 'anotada_en_existente', incidenciaId: 'inc-ganadora' });
    expect(sendButtons).not.toHaveBeenCalled();
  });

  it('un fallo NO lanza — la corrida de sincronización no muere por un disparo', async () => {
    viajeAbierto.v = { id: 'v-9', operador_id: 'op-9', folio: null };
    crearIncidencia.mockRejectedValueOnce(new Error('base caída'));
    const r = await dispararAsistenciaPorEventoCamara(EVENTO);
    expect(r.resultado).toBe('fallo');
  });

  it('si el aviso al jefe falla, se dice en la bitácora — no se finge', async () => {
    viajeAbierto.v = { id: 'v-9', operador_id: 'op-9', folio: null };
    sendButtons.mockResolvedValueOnce('' as never);
    const r = await dispararAsistenciaPorEventoCamara(EVENTO);
    expect(r).toMatchObject({ resultado: 'abierta', avisado: false });
    expect(anotarEventoIncidencia).toHaveBeenCalledWith('t-1', 'inc-1', 'aviso_jefe_fallido', expect.anything());
  });
});
