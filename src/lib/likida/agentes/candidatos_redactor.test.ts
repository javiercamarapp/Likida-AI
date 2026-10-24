import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type Tablas } from './db_falsa.fixture';

// A37-S28-01 (ALTO): la ventana de candidatos del Redactor no avanzaba: los 10 `nuevo` más viejos con correo
// que no pasan la compuerta de ICP (o que ya tienen pieza pendiente / rechazada) volvían en cada vuelta.
const TABLAS: Tablas = {};
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => crearDbFalsa(TABLAS) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// redactor.ts arrastra el modelo y la cola: aquí solo se usan sus dos funciones puras.
vi.mock('@/lib/llm/openrouter', () => ({ generateStructured: vi.fn(), generateResponse: vi.fn() }));
vi.mock('./cola', () => ({ encolarPieza: vi.fn(), verificarFormatoCampana: vi.fn() }));
vi.mock('./corridas', () => ({ registrarCorrida: vi.fn() }));
vi.mock('../interruptores', () => ({ estaApagado: async () => false }));

const { candidatosDelRedactor } = await import('./candidatos_redactor');
const { filtroIcpPostgrest, pasaCompuertaIcp } = await import('./redactor');
const pad = (n: number) => String(n).padStart(4, '0');
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

const prospecto = (id: string, i: number, extra: Record<string, unknown> = {}) => ({
  id, empresa: id, correo: `${id}@x.mx`, estado: 'nuevo', duplicado_de: null, vendedor: null,
  created_at: `2026-01-01T00:00:${pad(i).slice(2)}Z`, scian: null, fuente: 'computrabajo', similitud_icp_pct: null, ...extra,
});

beforeEach(() => {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  TABLAS.prospecto = []; TABLAS.cola_aprobacion = []; TABLAS.prospecto_contacto = [];
});

describe('A37-S28-01 — el lote del Redactor alcanza a los que SÍ califican', () => {
  it('60 prospectos viejos fuera del ICP no tapan a los 3 nuevos que califican', async () => {
    for (let i = 0; i < 60; i++) TABLAS.prospecto.push(prospecto(`ruido-${pad(i)}`, i));
    TABLAS.prospecto.push(prospecto('ok-1', 61, { scian: '484110' }));
    TABLAS.prospecto.push(prospecto('ok-2', 62, { fuente: 'canacar' }));
    TABLAS.prospecto.push(prospecto('ok-3', 63, { similitud_icp_pct: 80 }));
    const r = await candidatosDelRedactor(10);
    expect(r.map((c) => c.id)).toEqual(['ok-1', 'ok-2', 'ok-3']);
  });

  it('un prospecto con pieza PENDIENTE o RECHAZADA hace poco no vuelve a la cola; el rechazo viejo sí', async () => {
    TABLAS.prospecto = [
      prospecto('pend', 1, { scian: '484' }), prospecto('rech', 2, { scian: '484' }),
      prospecto('rech-viejo', 3, { scian: '484' }), prospecto('libre', 4, { scian: '484' }),
    ];
    TABLAS.cola_aprobacion = [
      { id: 'a', prospecto_id: 'pend', tipo: 'correo_frio', estado: 'pendiente', resuelto_en: null },
      { id: 'b', prospecto_id: 'rech', tipo: 'correo_frio', estado: 'rechazado', resuelto_en: hace(2) },
      { id: 'c', prospecto_id: 'rech-viejo', tipo: 'correo_frio', estado: 'rechazado', resuelto_en: hace(90) },
    ];
    const r = await candidatosDelRedactor(10);
    expect(r.map((c) => c.id)).toEqual(['rech-viejo', 'libre']);
  });

  it('contactado hace menos de 48 h: fuera (la cadencia se respeta ANTES de gastar modelo)', async () => {
    TABLAS.prospecto = [prospecto('reciente', 1, { scian: '484' }), prospecto('libre', 2, { scian: '484' })];
    TABLAS.prospecto_contacto = [{ id: 'k', prospecto_id: 'reciente', direccion: 'salida', ocurrio_en: hace(1) }];
    const r = await candidatosDelRedactor(10);
    expect(r.map((c) => c.id)).toEqual(['libre']);
  });

  it('sin correo o duplicado: no entran; respeta el límite pedido', async () => {
    TABLAS.prospecto = [
      prospecto('sin-correo', 1, { scian: '484', correo: null }),
      prospecto('dup', 2, { scian: '484', duplicado_de: 'otro' }),
      ...[3, 4, 5].map((i) => prospecto(`ok-${i}`, i, { scian: '484' })),
    ];
    const r = await candidatosDelRedactor(2);
    expect(r.map((c) => c.id)).toEqual(['ok-3', 'ok-4']);
  });

  it('el filtro SQL de ICP dice lo mismo que la compuerta de código', async () => {
    const casos = [
      { scian: '484110', fuente: 'x', similitud_icp_pct: null }, { scian: '493', fuente: 'x', similitud_icp_pct: null },
      { scian: '722', fuente: 'x', similitud_icp_pct: null }, { scian: null, fuente: 'canacar', similitud_icp_pct: null },
      { scian: null, fuente: 'aaag', similitud_icp_pct: null }, { scian: null, fuente: 'manual', similitud_icp_pct: null },
      { scian: null, fuente: 'landing', similitud_icp_pct: null }, { scian: null, fuente: 'computrabajo', similitud_icp_pct: 60 },
      { scian: null, fuente: 'computrabajo', similitud_icp_pct: 59 }, { scian: null, fuente: 'computrabajo', similitud_icp_pct: null },
    ];
    TABLAS.prospecto = casos.map((c, i) => prospecto(`c-${pad(i)}`, i, c));
    const r = await candidatosDelRedactor(50);
    const esperados = TABLAS.prospecto.filter((p) => pasaCompuertaIcp({ scian: p.scian as string | null, fuente: String(p.fuente), similitudIcpPct: p.similitud_icp_pct as number | null })).map((p) => p.id);
    expect(r.map((c) => c.id)).toEqual(esperados);
    // El filtro que viaja a PostgREST menciona las tres señales.
    expect(filtroIcpPostgrest()).toMatch(/scian\.like\.48\*.*scian\.like\.49\*.*fuente\.in\.\(canacar,aaag,manual,landing\).*similitud_icp_pct\.gte\.60/);
  });
});
