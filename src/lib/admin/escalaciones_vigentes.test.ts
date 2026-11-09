import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { contarFallosVigentes, agruparRachasDeFallo } = await import('./escalaciones');
const { llaveRacha } = await import('./negocio');

// El cuadro «Corridas en fallo» debe decir lo mismo que la cola: solo cuentan los fallos POSTERIORES a la última corrida buena
// de su agente+flota. Antes contaba todos los fallos de la historia (191 con la cola en 0).
function fallo(agente: string, tenantId: string | null, inicio: string) {
  return { agente, tenantId, tenantNombre: tenantId ?? 'Likida (negocio)', estado: 'fallo', disparo: 'cron', inicio, fin: null, tareasHechas: null, tareasTotal: null, error: 'x' } as never;
}

describe('contarFallosVigentes', () => {
  it('los fallos anteriores a la última corrida buena ya no cuentan', () => {
    const fallos = [fallo('enriquecedor', null, '2026-10-01T00:00:00Z'), fallo('enriquecedor', null, '2026-10-02T00:00:00Z')];
    const buena = new Map([[llaveRacha('enriquecedor', null), '2026-11-01T00:00:00Z']]);
    expect(contarFallosVigentes(fallos, buena)).toBe(0);
    expect(agruparRachasDeFallo(fallos, buena)).toHaveLength(0);
  });

  it('un fallo posterior a la última corrida buena sí cuenta, y coincide con la cola', () => {
    const fallos = [fallo('enriquecedor', null, '2026-11-05T00:00:00Z'), fallo('enriquecedor', null, '2026-10-02T00:00:00Z')];
    const buena = new Map([[llaveRacha('enriquecedor', null), '2026-11-01T00:00:00Z']]);
    expect(contarFallosVigentes(fallos, buena)).toBe(1);
    expect(agruparRachasDeFallo(fallos, buena)).toHaveLength(1);
  });

  it('sin ninguna corrida buena todo cuenta; y una corrida buena de OTRA flota no rompe la racha', () => {
    const fallos = [fallo('cobranza', 't-1', '2026-11-05T00:00:00Z'), fallo('cobranza', 't-1', '2026-11-04T00:00:00Z')];
    expect(contarFallosVigentes(fallos, new Map())).toBe(2);
    const otraFlota = new Map([[llaveRacha('cobranza', 't-2'), '2026-11-06T00:00:00Z']]);
    expect(contarFallosVigentes(fallos, otraFlota)).toBe(2);
  });
});
