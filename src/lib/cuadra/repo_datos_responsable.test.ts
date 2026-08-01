import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · CRÍTICO de pruebas (superviviente de la ronda 6, 3ª ronda sin
// tocar) — `getDatosResponsable` (repo.ts:451) exige `razonSocial && domicilio`
// antes de devolver los datos; sin esta guarda, `ponerAvisoADisposicion` podría
// construir un aviso con un responsable a medias, y `processInbound` trataría
// datos personales del operador sin que el aviso los ampare de verdad.
//
// Mutado a `return r;` (sin la guarda), 1299/1300 pruebas seguían pasando: nada
// llamaba a esta función contra un tenant con razón social o domicilio vacíos.
// ═══════════════════════════════════════════════════════════════════════════

let fila: Record<string, unknown> | null = null;

const from = vi.fn(() => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) enlace[m] = () => enlace;
  enlace.maybeSingle = async () => ({ data: fila, error: null });
  return enlace;
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { getDatosResponsable } = await import('./repo');

beforeEach(() => { fila = null; });

describe('getDatosResponsable — sin razón social o domicilio, no hay responsable', () => {
  it('con razón social y domicilio, devuelve los datos', async () => {
    fila = { razon_social: 'FLOTA SA DE CV', domicilio_fiscal: 'Calle 1, Mérida', url_aviso_privacidad: '', contacto_privacidad: null };
    const r = await getDatosResponsable('t1');
    expect(r).not.toBeNull();
    expect(r?.razonSocial).toBe('FLOTA SA DE CV');
  });

  it('con domicilio vacío, NO devuelve datos aunque haya razón social', async () => {
    fila = { razon_social: 'FLOTA SA DE CV', domicilio_fiscal: '', url_aviso_privacidad: '', contacto_privacidad: null };
    expect(await getDatosResponsable('t1')).toBeNull();
  });

  it('con razón social vacía, NO devuelve datos aunque haya domicilio', async () => {
    fila = { razon_social: '', domicilio_fiscal: 'Calle 1, Mérida', url_aviso_privacidad: '', contacto_privacidad: null };
    expect(await getDatosResponsable('t1')).toBeNull();
  });

  it('sin fila en la base, NO devuelve datos', async () => {
    fila = null;
    expect(await getDatosResponsable('t1')).toBeNull();
  });
});
