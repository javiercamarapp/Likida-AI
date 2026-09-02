import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, TC-N4 (MEDIO, reincidente de la 22) — `search`/`fetch` vivían
// en `operacion` y el contador (`['dinero']`) no las alcanzaba: su primera
// pregunta en ChatGPT devolvía `sin_permiso` y ensuciaba el feed de seguridad.
// Aquí: una credencial de solo `dinero` busca y lee; una de solo `operacion`
// sigue igual; sin áreas, nada. Y las herramientas de dinero siguen cerradas
// a la llave de tablero — `areasQueAlcanzan` abre `search`/`fetch`, no el resto.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('se tocó la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));
vi.mock('./herramientas/viajes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./herramientas/viajes')>()),
  buscarViajesTexto: vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111', folio: 'F-0123', origen: 'Mérida', destino: 'Cancún', estatus: 'abierto', fechaInicio: '2026-09-01' }]),
}));
vi.mock('@/lib/likida/libro_viaje', () => ({ getLibroViaje: vi.fn(async () => null) }));

import { despacharHerramienta, catalogoHerramientas } from './herramientas';
import type { Area } from '@/lib/auth/visibilidad';

const SOLO_DINERO = (a: Area) => a === 'dinero';
const SOLO_OPERACION = (a: Area) => a === 'operacion';
const NADA = () => false;

describe('TC-N4 · search/fetch al alcance del contador', () => {
  it('una credencial de solo `dinero` busca viajes', async () => {
    const r = await despacharHerramienta('search', { query: 'Mérida' }, 't-1', SOLO_DINERO);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resultado.estructurado).toMatchObject({ results: [expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' })] });
  });

  it('…y lee el detalle (fetch decide qué sección enseña; aquí solo que la puerta abre)', async () => {
    const r = await despacharHerramienta('fetch', { id: '11111111-1111-4111-8111-111111111111' }, 't-1', SOLO_DINERO);
    expect(r.ok).toBe(true);
  });

  it('la llave de tablero (solo `operacion`) sigue buscando igual que antes', async () => {
    const r = await despacharHerramienta('search', { query: 'F-0123' }, 't-1', SOLO_OPERACION);
    expect(r.ok).toBe(true);
  });

  it('sin áreas, nada — y las de dinero siguen cerradas a la llave de tablero', async () => {
    for (const h of catalogoHerramientas()) {
      const r = await despacharHerramienta(h.nombre, {}, 't-1', NADA);
      expect(r.ok, h.nombre).toBe(false);
    }
    for (const nombre of ['cuadre_viaje', 'por_facturar', 'resumen_fiscal', 'metricas_flota']) {
      const r = await despacharHerramienta(nombre, { viaje: 'F-1' }, 't-1', SOLO_OPERACION);
      expect(r.ok, nombre).toBe(false);
      if (!r.ok) expect(r.tipo).toBe('sin_permiso');
    }
  });

  it('solo search y fetch declaran áreas alternas, y solo operacion+dinero', () => {
    for (const h of catalogoHerramientas()) {
      const alternas = h.areasQueAlcanzan;
      if (h.nombre === 'search' || h.nombre === 'fetch') expect(alternas).toEqual(['operacion', 'dinero']);
      else expect(alternas, h.nombre).toBeUndefined();
    }
  });
});
