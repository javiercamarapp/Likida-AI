import { describe, expect, it, vi } from 'vitest';
import { FLOTAS_POR_CORRIDA, PENDIENTES_POR_CORRIDA, VENTANA_BARRIDO_MIN, correrCicloVivo, type PuertoCicloVivo } from './ciclo_cron';
import type { DepsAvisoEscalacion } from './aviso_escalacion';
import type { DepsBarrido } from './barrido_salud';
import type { EntradaSalud } from './salud_agentes';

const SANA: EntradaSalud = { ahora: new Date('2026-10-02T18:00:00Z'), latidos: {}, corridas: {}, enviosSinSalir: { vigiaFallidos24h: 0, buzonEntregasConProblema: 0 } };

function puerto(sobre: Partial<PuertoCicloVivo> = {}): PuertoCicloVivo & { registros: unknown[] } {
  const registros: unknown[] = [];
  return {
    registros,
    reclamarFlotas: vi.fn(async () => ['t1', 't2']),
    registrarBarrido: vi.fn(async (t, r) => { registros.push([t, r.ok]); }),
    pendientesDeAviso: vi.fn(async () => []),
    ...sobre,
  };
}
const barrido = (sobre: Partial<DepsBarrido> = {}): DepsBarrido => ({
  salud: async () => SANA, abrirTarea: async () => 'creada', tareasAbiertas: async () => [], cerrarTarea: async () => false, ...sobre,
});
const aviso = {} as DepsAvisoEscalacion;

describe('el ciclo vivo del cron escalar', () => {
  it('pide al claim el lote y la ventana acordados y registra el resultado de cada flota', async () => {
    const p = puerto();
    const r = await correrCicloVivo(p, barrido(), aviso);
    expect(p.reclamarFlotas).toHaveBeenCalledWith(FLOTAS_POR_CORRIDA, VENTANA_BARRIDO_MIN);
    expect(p.pendientesDeAviso).toHaveBeenCalledWith(PENDIENTES_POR_CORRIDA);
    expect(r.barrido).toMatchObject({ flotas: 2, fallos: 0, cortadoPorReloj: false });
    expect(p.registros).toEqual([['t1', true], ['t2', true]]);
    expect(r.fallos).toBe(0);
  });

  it('una flota cuya salud no se pudo leer falla SOLA: se registra el error y las demás se barren', async () => {
    const p = puerto();
    const b = barrido({ salud: async (t) => { if (t === 't1') throw new Error('base caída'); return SANA; } });
    const r = await correrCicloVivo(p, b, aviso);
    expect(r.barrido).toMatchObject({ flotas: 2, fallos: 1 });
    expect(p.registros).toEqual([['t1', false], ['t2', true]]);
    expect(r.fallos).toBe(1);
  });

  it('base sin la 0652 (el claim no existe): el barrido se declara no disponible y los avisos siguen', async () => {
    const p = puerto({ reclamarFlotas: async () => null, pendientesDeAviso: async () => [] });
    const r = await correrCicloVivo(p, barrido(), aviso);
    expect(r.barrido).toBe('no_disponible');
    expect(r.avisos).toMatchObject({ revisadas: 0 });
    expect(r.fallos).toBe(0);
  });

  it('sin la 0651 (las columnas del aviso no existen) los avisos se declaran no disponibles', async () => {
    const r = await correrCicloVivo(puerto({ pendientesDeAviso: async () => null }), barrido(), aviso);
    expect(r.avisos).toBe('no_disponible');
  });

  it('el reloj vencido corta ANTES de empezar una flota', async () => {
    const p = puerto();
    const r = await correrCicloVivo(p, barrido(), aviso, { venceEn: Date.now() - 1 });
    expect(r.barrido).toMatchObject({ flotas: 0, cortadoPorReloj: true });
  });

  it('nunca lanza: si el claim o la lista de avisos revientan, devuelve el parte con fallos', async () => {
    const p = puerto({ reclamarFlotas: async () => { throw new Error('rpc caída'); }, pendientesDeAviso: async () => { throw new Error('tabla caída'); } });
    const r = await correrCicloVivo(p, barrido(), aviso);
    expect(r.fallos).toBe(2);
    expect(r.barrido).toBe('no_disponible');
  });
});
