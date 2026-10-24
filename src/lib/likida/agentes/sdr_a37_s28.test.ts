import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type Tablas } from './db_falsa.fixture';

// A37-S28-02 (ALTO): el SDR tomaba solo los `limite*5` prospectos `contactado` con updated_at más viejo; tras ~25
// que terminaron la cadencia / respondieron / rebotaron y siguen `contactado`, la ventana se llenaba de descartes
// y ningún prospecto más nuevo recibía seguimiento nunca.
const TABLAS: Tablas = {};
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => crearDbFalsa(TABLAS) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/llm/openrouter', () => ({ generateResponse: vi.fn() }));
vi.mock('./cola', () => ({ encolarPieza: vi.fn(), verificarFormatoCampana: vi.fn() }));
vi.mock('./corridas', () => ({ registrarCorrida: vi.fn() }));
vi.mock('../interruptores', () => ({ estaApagado: async () => false }));

const { candidatosDeSeguimiento } = await import('./sdr');
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
const pad = (n: number) => String(n).padStart(4, '0');

beforeEach(() => { for (const k of Object.keys(TABLAS)) delete TABLAS[k]; });

describe('A37-S28-02 — la ventana del SDR avanza más allá de los descartes', () => {
  it('40 prospectos viejos que ya terminaron la cadencia no tapan a los 3 más nuevos que sí tocan', async () => {
    TABLAS.prospecto = []; TABLAS.prospecto_contacto = []; TABLAS.cola_aprobacion = [];
    for (let i = 0; i < 40; i++) {
      const id = `viejo-${pad(i)}`;
      TABLAS.prospecto.push({ id, empresa: `V${i}`, contacto_nombre: null, estado: 'contactado', duplicado_de: null, updated_at: `2026-01-01T00:${pad(i).slice(2)}:00Z` });
      // 3 salidas = cadencia agotada.
      for (const d of [30, 25, 20]) TABLAS.prospecto_contacto.push({ id: `${id}-${d}`, prospecto_id: id, canal: 'correo', direccion: 'salida', ocurrio_en: hace(d) });
    }
    for (let i = 0; i < 3; i++) {
      const id = `nuevo-${i}`;
      TABLAS.prospecto.push({ id, empresa: `N${i}`, contacto_nombre: null, estado: 'contactado', duplicado_de: null, updated_at: `2026-09-01T00:0${i}:00Z` });
      TABLAS.prospecto_contacto.push({ id: `${id}-s`, prospecto_id: id, canal: 'correo', direccion: 'salida', ocurrio_en: hace(4) });
    }
    const r = await candidatosDeSeguimiento(5);
    expect(r.map((c) => c.id)).toEqual(['nuevo-0', 'nuevo-1', 'nuevo-2']);
  });

  it('respondió o rebotó: descartado, y la búsqueda sigue con el siguiente', async () => {
    TABLAS.prospecto = ['a', 'b', 'c'].map((id, i) => ({ id, empresa: id, contacto_nombre: null, estado: 'contactado', duplicado_de: null, updated_at: `2026-01-0${i + 1}T00:00:00Z` }));
    TABLAS.prospecto_contacto = [
      { id: '1', prospecto_id: 'a', canal: 'correo', direccion: 'salida', ocurrio_en: hace(5) },
      { id: '2', prospecto_id: 'a', direccion: 'respuesta', ocurrio_en: hace(3) },
      { id: '3', prospecto_id: 'b', canal: 'correo', direccion: 'salida', ocurrio_en: hace(5) },
      { id: '4', prospecto_id: 'c', canal: 'correo', direccion: 'salida', ocurrio_en: hace(5) },
    ];
    TABLAS.cola_aprobacion = [{ id: 'p1', prospecto_id: 'b', entrega_estado: 'rebotado' }];
    const r = await candidatosDeSeguimiento(1);
    expect(r.map((c) => c.id)).toEqual(['c']);
  });
});

// ── A37-S28-03 / 04 / 06 ────────────────────────────────────────────────────
const { correrSdr } = await import('./sdr');
const { generateResponse } = await import('@/lib/llm/openrouter');
const { encolarPieza } = await import('./cola');
const OK = '**Asunto:** Seguimiento\nLe escribí hace unos días. ¿Le vienen bien 15 minutos?';

function unCandidato(extra: Array<Record<string, unknown>> = [], previas: Array<Record<string, unknown>> = []) {
  TABLAS.prospecto = [{ id: 'p1', empresa: 'X', contacto_nombre: null, estado: 'contactado', duplicado_de: null, updated_at: '2026-01-01T00:00:00Z' }];
  TABLAS.prospecto_contacto = [{ id: 's1', prospecto_id: 'p1', canal: 'correo', direccion: 'salida', ocurrio_en: hace(4) }, ...extra];
  TABLAS.cola_aprobacion = previas;
}

describe('A37-S28-06 — solo cuentan las salidas por CORREO', () => {
  it('una llamada registrada como salida no dispara un seguimiento «del correo anterior»', async () => {
    TABLAS.prospecto = [{ id: 'p1', empresa: 'X', contacto_nombre: null, estado: 'contactado', duplicado_de: null, updated_at: '2026-01-01T00:00:00Z' }];
    TABLAS.prospecto_contacto = [{ id: 'l1', prospecto_id: 'p1', canal: 'llamada', direccion: 'salida', ocurrio_en: hace(5) }];
    TABLAS.cola_aprobacion = [];
    expect(await candidatosDeSeguimiento(5)).toEqual([]);
  });
  it('una llamada extra no adelanta el paso 2: sigue siendo el seguimiento 1', async () => {
    unCandidato([{ id: 'l2', prospecto_id: 'p1', canal: 'llamada', direccion: 'salida', ocurrio_en: hace(1) }]);
    const r = await candidatosDeSeguimiento(5);
    expect(r.map((c) => c.numeroSeguimiento)).toEqual([1]);
  });
});

describe('A37-S28-03 — no se duplica el seguimiento', () => {
  beforeEach(() => { vi.mocked(generateResponse).mockReset(); vi.mocked(encolarPieza).mockReset(); });
  it.each(['aprobado', 'rechazado', 'pendiente'])('un seguimiento 1 ya %s bloquea otro igual', async (estado) => {
    unCandidato([], [{ id: 'q1', prospecto_id: 'p1', tipo: 'correo_seguimiento', estado, fuentes: { seguimiento: 1, de: 2 } }]);
    vi.mocked(generateResponse).mockResolvedValue({ text: OK, cost: 0.001 } as never);
    const r = await correrSdr('cron', 5);
    expect(r.piezas).toBe(0);
    expect(r.saltados).toBe(1);
    expect(encolarPieza).not.toHaveBeenCalled();
    expect(generateResponse).not.toHaveBeenCalled();
  });
  it('sin previas sí fabrica', async () => {
    unCandidato();
    vi.mocked(generateResponse).mockResolvedValue({ text: OK, cost: 0.001 } as never);
    expect((await correrSdr('cron', 5)).piezas).toBe(1);
  });
});

describe('A37-S28-04 — el costo de una llamada pagada y descartada cuenta', () => {
  beforeEach(() => { vi.mocked(generateResponse).mockReset(); vi.mocked(encolarPieza).mockReset(); });
  it('una salida ilegible suma su costo a la corrida', async () => {
    unCandidato();
    vi.mocked(generateResponse).mockResolvedValue({ text: 'basura sin formato', cost: 0.004 } as never);
    const r = await correrSdr('cron', 5);
    expect(r.piezas).toBe(0);
    expect(r.saltados).toBe(1);
    expect(r.costoUsd).toBeCloseTo(0.004, 6);
  });
  it('un descarte con costo no medido vuelve la corrida NULL (desconocido), no cero', async () => {
    unCandidato();
    vi.mocked(generateResponse).mockResolvedValue({ text: 'basura', cost: 0.004, noMedido: true } as never);
    expect((await correrSdr('cron', 5)).costoUsd).toBeNull();
  });
});
