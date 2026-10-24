import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { generarLibroIave } from './fixtures/generar_desglose_iave';

// A37-A2-17: la pantalla de candidatos (revisionDeDesglose) usaba los umbrales por omisión del detector aunque
// la flota los hubiera cambiado en Configuración. Ahora lee `peaje_atipico_config` (los mismos umbrales que el aviso).
let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));

const { importarDesglose } = await import('../intake/desglose_peaje');
const R = await import('./revision_cobros');
const T = 'tenant-1';
beforeEach(() => { db = crearDbFalsa(); });

async function subir() {
  const { buffer } = generarLibroIave({ filas: 3000, inicio: '2026-03-01', extemporaneos: 0 });
  const r = await importarDesglose(T, { nombre: '01 A 10 DE MARZO.xlsx', buffer });
  if (!r.ok) throw new Error(r.motivo);
  return r.desgloseId;
}
const repeticiones = (rep: Awaited<ReturnType<typeof R.revisionDeDesglose>>) => (rep?.atipicos.atipicos ?? []).filter((a) => a.senal === 'repeticion_caseta');

describe('la pantalla de candidatos respeta la configuración de cruces atípicos de la flota', () => {
  it('con los umbrales por omisión hay repeticiones; con minCruces altísimo, ninguna', async () => {
    const id = await subir();
    const base = repeticiones(await R.revisionDeDesglose(T, id));
    expect(base.length).toBeGreaterThan(0);

    db.tablas.peaje_atipico_config = [{ tenant_id: T, activo: true, umbrales: { repeticion_caseta: { activa: true, minCruces: 50, ventanaHoras: 1 } } }];
    expect(repeticiones(await R.revisionDeDesglose(T, id))).toHaveLength(0);
  });

  it('con la regla de repetición apagada no se listan repeticiones y se dice por qué', async () => {
    const id = await subir();
    db.tablas.peaje_atipico_config = [{ tenant_id: T, activo: true, umbrales: { repeticion_caseta: { activa: false, minCruces: 4, ventanaHoras: 6 } } }];
    const rep = await R.revisionDeDesglose(T, id);
    expect(repeticiones(rep)).toHaveLength(0);
    expect(rep?.atipicos.noAplicadas.some((n) => n.senal === 'repeticion_caseta' && /apagada/i.test(n.motivo))).toBe(true);
  });

  it('si la configuración no se puede leer, cae a los umbrales por omisión (no tumba la revisión)', async () => {
    const id = await subir();
    const orig = db.cliente.from.bind(db.cliente);
    db.cliente.from = ((t: string) => { if (t === 'peaje_atipico_config') throw new Error('base caída'); return orig(t); }) as never;
    const base = repeticiones(await R.revisionDeDesglose(T, id));
    expect(base.length).toBeGreaterThan(0);
  });
});
