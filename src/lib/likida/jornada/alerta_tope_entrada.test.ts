import { describe, it, expect, vi } from 'vitest';

// Solo se ejercita el esquema `EntradaConfigAlerta` y la ruta de rechazo de `guardarConfigAlerta` (que no toca la base): el resto del
// módulo se mockea para no cargar Supabase, Meta ni el correo.
const upsert = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({ upsert }) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));
vi.mock('@/lib/meta/enviar_con_fallback', () => ({ enviarConFallback: vi.fn() }));
vi.mock('@/lib/correo/enviar', () => ({ enviarCorreo: vi.fn() }));
vi.mock('../conductor/escalamiento', () => ({ destinatariosEscalacion: vi.fn() }));
vi.mock('./repo', () => ({ asientosDeJornada: vi.fn(), leerPolitica: vi.fn() }));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const { EntradaConfigAlerta, guardarConfigAlerta } = await import('./alerta_tope_datos');

const BASE = { activa: true, topeHoras: 10, umbralAvisoPct: 80, umbralCriticoPct: 95, canalEncargado: 'whatsapp', canalOperador: 'whatsapp', correoEncargado: null };

describe('topeHoras en el servidor (ronda 15)', () => {
  it('rechaza un tope por debajo de 0.25 h aunque el formulario HTML no lo haya impedido (POST directo)', async () => {
    for (const t of [0.005, 0.01, 0.1, 0.24]) {
      expect(EntradaConfigAlerta.safeParse({ ...BASE, topeHoras: t }).success).toBe(false);
      upsert.mockClear();
      expect(await guardarConfigAlerta('t1', { ...BASE, topeHoras: t }, { email: 'a@b.mx' })).toMatch(/al menos 0\.25 horas/);
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it('acepta el mínimo, el máximo, un valor intermedio y null (el tope de la ley)', () => {
    for (const t of [0.25, 0.5, 8, 12, null]) expect(EntradaConfigAlerta.safeParse({ ...BASE, topeHoras: t }).success).toBe(true);
    expect(EntradaConfigAlerta.safeParse({ ...BASE, topeHoras: 12.5 }).success).toBe(false);
  });
});
