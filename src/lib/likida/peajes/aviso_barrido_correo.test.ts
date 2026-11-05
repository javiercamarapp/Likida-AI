import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));

const { barrerAvisosPeajes } = await import('./aviso_barrido');
const { CONFIG_AVISOS_DEFAULT } = await import('./config_avisos');
import type { DepsBarrido } from './aviso_barrido';
import type { AvisoPeajes } from './aviso_canal';

// Ronda 4 · el correo en el barrido: la clave del sello viaja al canal y la fecha de corte evita reenviar historial.

const HOY = new Date('2026-10-15T18:00:00Z');
const flota = { tenantId: 't1', telefono: null, avisos: { ...CONFIG_AVISOS_DEFAULT, interruptores: { aviso_plazo: true, recordatorio_archivo: false } } };

function armar(over: Partial<DepsBarrido> = {}) {
  const recibidos: AvisoPeajes[] = [];
  const sellos = new Set<string>();
  const deps: DepsBarrido = {
    flotas: async () => [flota],
    desgloses: async () => [{ id: 'dNuevo', periodoDesde: '2026-10-01', periodoHasta: '2026-10-10' }, { id: 'dViejo', periodoDesde: '2026-07-21', periodoHasta: '2026-07-31' }],
    candidatosDeDesglose: vi.fn(async (_t: string, id: string) => [{ lineaId: '0', desgloseId: id, fechaCruce: id === 'dViejo' ? '2026-07-25' : '2026-07-26', monto: 100, reclamado: false }]),
    reservar: async (t, tipo, clave) => { const k = `${t}|${tipo}|${clave}`; if (sellos.has(k)) return false; sellos.add(k); return true; },
    liberar: async () => {},
    canales: [{ nombre: 'correo', destinatario: async () => 'a@b.mx', enviar: async (_d, a) => { recibidos.push(a); return true; } }],
    liga: () => 'https://app.likida.ai/dashboard/agentes/peajes', ahora: () => HOY,
    ...over,
  };
  return { deps, recibidos };
}

describe('barrido con correo', () => {
  it('entrega al canal la clave del sello (archivo:umbral:grupo) para la idempotencia por destinatario', async () => {
    const { deps, recibidos } = armar();
    await barrerAvisosPeajes(deps);
    expect(recibidos.length).toBeGreaterThan(0);
    expect(recibidos.every((a) => a.tipo === 'plazo' && /^d(Nuevo|Viejo):\d+/.test(a.clave ?? ''))).toBe(true);
  });
  it('sin fecha de corte se avisa de todos los archivos de la ventana', async () => {
    const { deps } = armar();
    await barrerAvisosPeajes(deps);
    expect(deps.candidatosDeDesglose).toHaveBeenCalledTimes(2);
  });
  it('con fecha de corte NO se revisan ni se avisan los archivos cuyo periodo terminó antes (no reenviar historial)', async () => {
    const { deps, recibidos } = armar({ corteAvisos: async () => '2026-10-01' });
    const r = await barrerAvisosPeajes(deps);
    expect(deps.candidatosDeDesglose).toHaveBeenCalledTimes(1);
    expect(deps.candidatosDeDesglose).toHaveBeenCalledWith('t1', 'dNuevo');
    expect(recibidos.every((a) => !(a.clave ?? '').startsWith('dViejo'))).toBe(true);
    expect(r.fallidas).toBe(0);
  });
  it('si la fecha de corte no se puede leer, la flota se cuenta fallida y no avisa (fail-cerrado)', async () => {
    const { deps, recibidos } = armar({ corteAvisos: async () => { throw new Error('base caída'); } });
    const r = await barrerAvisosPeajes(deps);
    expect(r.fallidas).toBe(1);
    expect(recibidos).toHaveLength(0);
  });
});
