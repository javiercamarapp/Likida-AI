import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));

const { barrerAvisosPeajes, soloReclamablesAlProveedor } = await import('./aviso_barrido');
const { CONFIG_AVISOS_DEFAULT } = await import('./config_avisos');
import type { DepsBarrido } from './aviso_barrido';
import type { CanalAvisoPeajes } from './aviso_canal';

// A2 ola 1 · el barrido que conecta aviso_plazo y recordatorio_archivo al cron. Todo sintético, reloj fijo.

const HOY = new Date('2026-10-15T18:00:00Z'); // 12:00 en México
const T = 'tenant-1';
const flota = (inter: { aviso_plazo?: boolean; recordatorio_archivo?: boolean }, telefono: string | null = '5215500000000') => ({
  tenantId: T, telefono,
  avisos: { ...CONFIG_AVISOS_DEFAULT, interruptores: { aviso_plazo: false, recordatorio_archivo: false, ...inter } },
});

function armar(over: Partial<DepsBarrido> = {}, enviados: Array<{ tipo: string; texto: string }> = []) {
  const sellos = new Set<string>();
  const canal: CanalAvisoPeajes = {
    nombre: 'prueba', destinatario: async () => '5215500000000',
    enviar: async (_d, a) => { enviados.push({ tipo: a.tipo, texto: a.texto }); return true; },
  };
  const deps: DepsBarrido = {
    flotas: async () => [flota({ aviso_plazo: true, recordatorio_archivo: true })],
    desgloses: async () => [{ id: 'd1', periodoDesde: '2026-07-21', periodoHasta: '2026-07-31' }],
    // un cobro del 2026-07-25: su plazo (3 meses) vence el 2026-10-25 → faltan 10 días → umbral 30 (y 7 aún no)
    candidatosDeDesglose: async () => [{ lineaId: '0', desgloseId: 'd1', fechaCruce: '2026-07-25', monto: 250.5, reclamado: false }],
    reservar: async (t, tipo, clave) => { const k = `${t}|${tipo}|${clave}`; if (sellos.has(k)) return false; sellos.add(k); return true; },
    liberar: async (t, tipo, clave) => { sellos.delete(`${t}|${tipo}|${clave}`); },
    canales: [canal], liga: () => 'https://app.likida.ai/dashboard/agentes/peajes', ahora: () => HOY,
    ...over,
  };
  return { deps, sellos, enviados };
}

describe('barrerAvisosPeajes', () => {
  it('con los dos interruptores encendidos manda el aviso de plazo y el recordatorio de la decena sin archivo', async () => {
    const { deps, enviados } = armar();
    const r = await barrerAvisosPeajes(deps);
    expect(r.flotas).toBe(1);
    expect(r.plazo.enviados).toBe(1);
    expect(r.recordatorios.enviados).toBe(1);
    expect(enviados.map((e) => e.tipo).sort()).toEqual(['plazo', 'recordatorio_archivo']);
    expect(enviados.find((e) => e.tipo === 'plazo')?.texto).toContain('$250.50');
    expect(enviados.find((e) => e.tipo === 'plazo')?.texto).toContain('no afirma que el cobro sea indebido');
  });

  it('es idempotente: la segunda corrida no vuelve a avisar lo mismo', async () => {
    const { deps, enviados } = armar();
    await barrerAvisosPeajes(deps);
    const r2 = await barrerAvisosPeajes(deps);
    expect(r2.plazo).toMatchObject({ enviados: 0, yaAvisados: 1 });
    expect(r2.recordatorios).toMatchObject({ enviados: 0, yaRecordados: 1 });
    expect(enviados).toHaveLength(2);
  });

  it('interruptores apagados (de origen): no se manda nada ni se lee un archivo', async () => {
    const candidatos = vi.fn(async () => []);
    const { deps, enviados } = armar({ flotas: async () => [flota({})], candidatosDeDesglose: candidatos });
    const r = await barrerAvisosPeajes(deps);
    expect(enviados).toHaveLength(0);
    expect(candidatos).not.toHaveBeenCalled();
    expect(r.plazo.enviados + r.recordatorios.enviados).toBe(0);
  });

  it('sin destinatario no se manda a nadie, se cuenta aparte y NO es un fallo', async () => {
    const sinNadie: CanalAvisoPeajes = { nombre: 'x', destinatario: async () => null, enviar: async () => { throw new Error('no debía llamarse'); } };
    const { deps } = armar({ canales: [sinNadie] });
    const r = await barrerAvisosPeajes(deps);
    expect(r.plazo.sinDestinatario).toBe(1);
    expect(r.recordatorios.sinDestinatario).toBe(1);
    expect(r.plazo.fallidos + r.recordatorios.fallidos + r.fallidas).toBe(0);
  });

  it('si el canal rechaza el envío el sello se devuelve para el siguiente barrido y se cuenta fallido', async () => {
    const malo: CanalAvisoPeajes = { nombre: 'malo', destinatario: async () => '5215500000000', enviar: async () => false };
    const { deps, sellos } = armar({ canales: [malo] });
    const r = await barrerAvisosPeajes(deps);
    expect(r.plazo.fallidos).toBe(1);
    expect(r.recordatorios.fallidos).toBe(1);
    expect(sellos.size).toBe(0);
  });

  it('un archivo que cubre la decena vencida evita el recordatorio; lo ya reclamado no entra al aviso de plazo', async () => {
    const { deps, enviados } = armar({
      desgloses: async () => [{ id: 'd1', periodoDesde: '2026-10-01', periodoHasta: '2026-10-10' }],
      candidatosDeDesglose: async () => [{ lineaId: '0', desgloseId: 'd1', fechaCruce: '2026-07-25', monto: 100, reclamado: true }],
    });
    const r = await barrerAvisosPeajes(deps);
    expect(r.recordatorios.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('una flota cuya lectura falla se cuenta en «fallidas» y no tumba a las demás', async () => {
    let n = 0;
    const { deps } = armar({
      flotas: async () => [{ ...flota({ aviso_plazo: true }), tenantId: 'a' }, { ...flota({ aviso_plazo: true }), tenantId: 'b' }],
      desgloses: async (t) => { n++; if (t === 'a') throw new Error('boom'); return [{ id: 'd1', periodoDesde: '2026-07-21', periodoHasta: '2026-07-31' }]; },
    });
    const r = await barrerAvisosPeajes(deps);
    expect(r.fallidas).toBe(1);
    expect(r.plazo.enviados).toBe(1);
    expect(n).toBe(2);
  });

  it('no puede leer las flotas: fallida y sin lanzar', async () => {
    const { deps } = armar({ flotas: async () => { throw new Error('boom'); } });
    expect(await barrerAvisosPeajes(deps)).toMatchObject({ flotas: 0, fallidas: 1 });
  });

  it('respeta el límite de flotas por corrida', async () => {
    const { deps } = armar({ flotas: async () => Array.from({ length: 9 }, (_, i) => ({ ...flota({}), tenantId: `t${i}` })) });
    expect((await barrerAvisosPeajes(deps, { limiteFlotas: 3 })).flotas).toBe(3);
  });
});

describe('soloReclamablesAlProveedor', () => {
  it('deja fuera lo interno de la flota (unidad inmovilizada, caseta prohibida) y conserva lo que sí se reclama al proveedor', () => {
    const r = soloReclamablesAlProveedor([{ categoria: 'clase_fuera_de_3_5' }, { categoria: 'tag_dado_de_baja' }, { categoria: 'unidad_inmovilizada' }, { categoria: 'caseta_no_debe_cruzarse' }]);
    expect(r.map((x) => x.categoria)).toEqual(['clase_fuera_de_3_5', 'tag_dado_de_baja']);
  });
});
