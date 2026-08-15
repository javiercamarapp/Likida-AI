import { describe, it, expect, vi, beforeEach } from 'vitest';

// Las dos mediciones cross-tenant del checklist de onboarding de
// /admin/flotas. Mock con filtros REALES (mismo criterio que
// negocio.test.ts): `.eq('activo', true)` tiene que filtrar de verdad — una
// credencial desactivada contada como viva pintaría verde una conexión que
// alguien ya revocó.
type Resp = { data: unknown; error: { message: string } | null };
const respuestas = new Map<string, Resp>();

function crearBuilder(tabla: string) {
  const raw = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  let pidioConteo = false;
  const filtros: Array<[string, unknown]> = [];
  const b: Record<string, unknown> = {};
  b.order = () => b;
  b.eq = (col: string, val: unknown) => { filtros.push([col, val]); return b; };
  b.select = (_cols?: unknown, opts?: { count?: string }) => {
    if (opts?.count === 'exact') pidioConteo = true;
    return b;
  };
  b.range = (desde: number, hasta: number) => {
    const r = raw();
    if (r.error) return Promise.resolve(r);
    let todas = (r.data ?? []) as Array<Record<string, unknown>>;
    for (const [col, val] of filtros) todas = todas.filter((f) => f[col] === val);
    return Promise.resolve({
      data: todas.slice(desde, hasta + 1),
      error: null,
      count: pidioConteo ? todas.length : null,
    });
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }),
}));

const { getOnboardingFlotas } = await import('./onboarding');

describe('getOnboardingFlotas', () => {
  beforeEach(() => { respuestas.clear(); });

  it('agrupa por flota: credenciales activas (guardadas vs PROBADAS) y filas de avisos', async () => {
    respuestas.set('conector_credencial', {
      data: [
        // t1: dos guardadas, solo una probada — "guardar NO es conectar" (0094).
        { tenant_id: 't1', probada_en: '2026-08-10T00:00:00Z', activo: true },
        { tenant_id: 't1', probada_en: null, activo: true },
        // Desactivada: no cuenta ni como guardada.
        { tenant_id: 't1', probada_en: '2026-08-01T00:00:00Z', activo: false },
        { tenant_id: 't2', probada_en: null, activo: true },
      ],
      error: null,
    });
    respuestas.set('agente_notificacion_config', {
      data: [
        { tenant_id: 't1', agente: 'liquidacion' },
        { tenant_id: 't1', agente: 'cobranza' },
      ],
      error: null,
    });
    const r = await getOnboardingFlotas();
    expect(r.get('t1')).toEqual({ credenciales: { total: 2, probadas: 1 }, avisosConfigurados: 2 });
    expect(r.get('t2')).toEqual({ credenciales: { total: 1, probadas: 0 }, avisosConfigurados: 0 });
    // Una flota sin filas NO aparece — el llamador la lee como ceros
    // CONTADOS porque la lectura sí se completó.
    expect(r.has('t3')).toBe(false);
  });

  it('sin filas en ninguna tabla: mapa vacío, no un error', async () => {
    const r = await getOnboardingFlotas();
    expect(r.size).toBe(0);
  });

  it('un fallo de lectura LANZA — la página pinta "no se pudo medir", nunca "pendiente"', async () => {
    respuestas.set('conector_credencial', { data: null, error: { message: 'fetch failed' } });
    await expect(getOnboardingFlotas()).rejects.toThrow('fetch failed');
  });
});
