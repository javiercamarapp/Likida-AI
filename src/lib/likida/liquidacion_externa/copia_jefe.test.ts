import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiquidacionExterna } from './repo';

// La copia al jefe con un rechazo TRANSITORIO de Meta: el cliente ya dejó el texto en `wa_outbox`, así que
// la copia no debe volver a mandarse en el siguiente intento (el jefe recibiría dos WhatsApp con el monto).
const reclamos = new Map<string, 'reclamada' | 'aceptada'>();
const eventos: Array<{ tipo: string; detalle: Record<string, unknown> }> = [];
const enviosDirectos: string[] = [];
let respuesta: { ok: boolean; reintentable?: boolean } = { ok: true };

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.example' }));
vi.mock('@/lib/meta/aviso_oficina', () => ({
  parametrosAvisoOficina: (a: string, b: string, c: string) => [a, b, c],
  avisarOficina: vi.fn(async (tel: string) => {
    enviosDirectos.push(tel);
    return respuesta.ok ? { ok: true, via: 'texto', id: 'w' } : { ok: false, motivo: 'timeout', fueraDeVentana: false, reintentable: respuesta.reintentable ?? false };
  }),
}));
vi.mock('./repo', () => ({
  leerFormatoFlota: vi.fn(async () => ({ copiaTelefonos: ['5219990000001'] })),
  eventosDe: vi.fn(async () => eventos),
  registrarEvento: vi.fn(async (_t: string, _id: string, tipo: string, detalle: Record<string, unknown>) => { eventos.push({ tipo, detalle }); }),
  reclamarCopiaJefe: vi.fn(async (_t: string, id: string, gen: number, tel: string) => {
    const k = `${id}|${gen}|${tel}`;
    if (reclamos.has(k)) return null;
    reclamos.set(k, 'reclamada');
    return { token: k };
  }),
  cerrarCopiaJefe: vi.fn(async (_t: string, id: string, gen: number, tel: string, _r: unknown, aceptada: boolean) => {
    const k = `${id}|${gen}|${tel}`;
    if (aceptada) reclamos.set(k, 'aceptada'); else reclamos.delete(k);
    return true;
  }),
}));

const { copiarAJefePorOmision } = await import('./copia_jefe');
const liq = { id: 'l1', tenantId: 't1', generacion: 1, claveExterna: 'X-1', operadorNombre: 'Juan', total: 100, moneda: 'MXN', periodoDesde: '2026-01-01', periodoHasta: '2026-01-15' } as unknown as LiquidacionExterna;

beforeEach(() => { reclamos.clear(); eventos.length = 0; enviosDirectos.length = 0; respuesta = { ok: true }; });

describe('copiarAJefePorOmision y el outbox', () => {
  it('un timeout/5xx (reintentable) NO suelta el reclamo: el reintento no manda una segunda copia', async () => {
    respuesta = { ok: false, reintentable: true };
    expect((await copiarAJefePorOmision(liq, null)).estado).toBe('enviada');
    respuesta = { ok: true };
    expect((await copiarAJefePorOmision(liq, null)).estado).toBe('ya_enviada');
    expect(enviosDirectos).toHaveLength(1);
  });

  it('un rechazo definitivo SÍ suelta el reclamo y el reintento vuelve a intentar', async () => {
    respuesta = { ok: false, reintentable: false };
    expect((await copiarAJefePorOmision(liq, null)).estado).toBe('no_enviada');
    respuesta = { ok: true };
    expect((await copiarAJefePorOmision(liq, null)).estado).toBe('enviada');
    expect(enviosDirectos).toHaveLength(2);
  });
});
