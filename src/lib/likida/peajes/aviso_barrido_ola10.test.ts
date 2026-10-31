import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));

const { barrerAvisosPeajes } = await import('./aviso_barrido');
const { CONFIG_AVISOS_DEFAULT } = await import('./config_avisos');
import type { DepsBarrido } from './aviso_barrido';
import type { CanalAvisoPeajes } from './aviso_canal';
import type { CandidatoPlazo } from './plazo_reclamo';

// OLA 10 · carril B · A2P-01 y A2P-02: el barrido de plazo evalúa TODOS los archivos de la ventana (empezando por el más viejo)
// y avisa cada grupo nuevo que entra al umbral; lo vencido genera UN aviso resumen.

const HOY = new Date('2026-10-15T18:00:00Z'); // 12:00 en México
const T = 'tenant-1';
const flota = {
  tenantId: T, telefono: '5215500000000',
  avisos: { ...CONFIG_AVISOS_DEFAULT, interruptores: { aviso_plazo: true, recordatorio_archivo: false } },
};

function armar(over: Partial<DepsBarrido> = {}) {
  const sellos = new Set<string>();
  const enviados: Array<{ tipo: string; texto: string }> = [];
  const canal: CanalAvisoPeajes = {
    nombre: 'prueba', destinatario: async () => '5215500000000',
    enviar: async (_d, a) => { enviados.push({ tipo: a.tipo, texto: a.texto }); return true; },
  };
  const deps: DepsBarrido = {
    flotas: async () => [flota],
    desgloses: async () => [],
    candidatosDeDesglose: async () => [],
    reservar: async (t, tipo, clave) => { const k = `${t}|${tipo}|${clave}`; if (sellos.has(k)) return false; sellos.add(k); return true; },
    liberar: async (t, tipo, clave) => { sellos.delete(`${t}|${tipo}|${clave}`); },
    canales: [canal], liga: () => 'https://app.likida.ai/dashboard/agentes/peajes', ahora: () => HOY,
    ...over,
  };
  return { deps, sellos, enviados };
}

describe('A2P-01: se evalúan todos los archivos de la ventana, de más viejo a más nuevo', () => {
  it('con 9 archivos se evalúan los 9 y avisan los 3 más viejos (los que tienen el plazo más cerca)', async () => {
    // Del más nuevo (d1) al más viejo (d9), como los entrega el repositorio.
    const ids = Array.from({ length: 9 }, (_, i) => `d${i + 1}`);
    const visitados: string[] = [];
    const { deps, enviados } = armar({
      desgloses: async () => ids.map((id) => ({ id, periodoDesde: '2026-07-01', periodoHasta: '2026-07-10' })),
      candidatosDeDesglose: async (_t, id): Promise<CandidatoPlazo[]> => {
        visitados.push(id);
        const viejo = ['d7', 'd8', 'd9'].includes(id);
        // Los 3 más viejos: cobro del 25-jul (vence el 25-oct, faltan 10 días). Los 6 nuevos: de septiembre (vigentes).
        return [{ lineaId: '0', desgloseId: id, fechaCruce: viejo ? '2026-07-25' : '2026-09-25', monto: 100, reclamado: false }];
      },
    });
    const r = await barrerAvisosPeajes(deps);
    expect(visitados.slice().sort()).toEqual(ids.slice().sort());
    expect(r.plazo.enviados).toBe(3);
    expect(enviados.filter((e) => e.tipo === 'plazo')).toHaveLength(3);
    expect(r.desglosesSinEvaluar).toBe(0);
  });

  it('si el presupuesto de tiempo corta la lectura, se cuentan los archivos que no se alcanzaron a evaluar', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `d${i + 1}`);
    let n = 0;
    const { deps } = armar({
      desgloses: async () => ids.map((id) => ({ id, periodoDesde: '2026-07-01', periodoHasta: '2026-07-10' })),
      candidatosDeDesglose: async () => { n++; return []; },
    });
    // El reloj ya venció desde el primer archivo: solo se evalúa el que ya estaba en curso (1) y los demás se cuentan.
    const r = await barrerAvisosPeajes(deps, { venceEn: Date.now() + 5000, presupuestoPorDesgloseMs: 10_000 });
    expect(n).toBe(1);
    expect(r.desglosesSinEvaluar).toBe(5 - n);
  });
});

describe('A2P-02: cruces escalonados y vencidos', () => {
  const cand = (id: string, fecha: string, monto = 100): CandidatoPlazo => ({ lineaId: id, desgloseId: 'dA', fechaCruce: fecha, monto, reclamado: false });
  const unArchivo = [{ id: 'dA', periodoDesde: '2026-07-21', periodoHasta: '2026-07-31' }];

  it('un grupo que entra al umbral días después vuelve a avisar (antes quedaba mudo para siempre)', async () => {
    const dia1 = new Date('2026-10-05T18:00:00Z'); // 25-jul vence el 25-oct: faltan 20 -> umbral 30
    const dia2 = new Date('2026-10-06T18:00:00Z'); // ahora entra también el del 26-jul
    let ahora = dia1;
    let lineas: CandidatoPlazo[] = [cand('0', '2026-07-25')];
    const { deps, enviados } = armar({ desgloses: async () => unArchivo, candidatosDeDesglose: async () => lineas, ahora: () => ahora });
    let r = await barrerAvisosPeajes(deps);
    expect(r.plazo.enviados).toBe(1);
    ahora = dia2;
    lineas = [cand('0', '2026-07-25'), cand('1', '2026-07-26', 50)];
    r = await barrerAvisosPeajes(deps);
    expect(r.plazo.enviados).toBe(1); // el grupo nuevo
    expect(enviados.at(-1)?.texto).toContain('2 cobros sin reclamar');
    // ...y repetir el mismo estado no vuelve a avisar.
    r = await barrerAvisosPeajes(deps);
    expect(r.plazo).toMatchObject({ enviados: 0, yaAvisados: 1 });
    expect(enviados.filter((e) => e.tipo === 'plazo')).toHaveLength(2);
  });

  it('los cobros ya vencidos generan UN aviso resumen («se vencieron N cobros ($X)») y no se repite', async () => {
    const { deps, enviados } = armar({
      desgloses: async () => unArchivo,
      candidatosDeDesglose: async () => [cand('0', '2026-06-01', 250.5), cand('1', '2026-06-02', 100)],
    });
    const r1 = await barrerAvisosPeajes(deps);
    const resumenes = enviados.filter((e) => e.texto.includes('se vencieron'));
    expect(resumenes).toHaveLength(1);
    expect(resumenes[0].texto).toContain('2 cobros');
    expect(resumenes[0].texto).toContain('$350.50');
    expect(r1.plazo.vencidosCruces).toBe(2);
    await barrerAvisosPeajes(deps);
    expect(enviados.filter((e) => e.texto.includes('se vencieron'))).toHaveLength(1);
  });
});

describe('H759-6: archivos fuera del tope y corrida parcial', () => {
  const cand = (id: string, fecha: string, monto = 100): CandidatoPlazo => ({ lineaId: id, desgloseId: 'dA', fechaCruce: fecha, monto, reclamado: false });
  const unArchivo = [{ id: 'dA', periodoDesde: '2026-07-21', periodoHasta: '2026-07-31' }];

  it('si la ventana tiene más archivos que el tope de lectura, los que quedaron fuera se CUENTAN (no se pierden en silencio) y no se avisa el resumen de vencidos', async () => {
    const lista = Object.assign([...unArchivo], { total: 45 });
    const { deps, enviados } = armar({ desgloses: async () => lista, candidatosDeDesglose: async () => [cand('0', '2026-06-01', 250.5)] });
    const r = await barrerAvisosPeajes(deps);
    expect(r.desglosesSinEvaluar).toBe(44);
    expect(enviados.filter((e) => e.texto.includes('se vencieron'))).toHaveLength(0);
  });

  it('una corrida cortada por el reloj no manda «se vencieron N» con N parcial', async () => {
    const ids = ['d1', 'd2', 'd3'];
    const { deps, enviados } = armar({
      desgloses: async () => ids.map((id) => ({ id, periodoDesde: '2026-07-01', periodoHasta: '2026-07-10' })),
      candidatosDeDesglose: async (_t, id) => [{ lineaId: id, desgloseId: id, fechaCruce: '2026-06-01', monto: 100, reclamado: false }],
    });
    const r = await barrerAvisosPeajes(deps, { venceEn: Date.now() + 5000, presupuestoPorDesgloseMs: 10_000 });
    expect(r.desglosesSinEvaluar).toBe(2);
    expect(enviados.filter((e) => e.texto.includes('se vencieron'))).toHaveLength(0);
  });

  it('con la ventana completa evaluada el resumen sí sale', async () => {
    const { deps, enviados } = armar({ desgloses: async () => unArchivo, candidatosDeDesglose: async () => [cand('0', '2026-06-01', 250.5)] });
    await barrerAvisosPeajes(deps);
    expect(enviados.filter((e) => e.texto.includes('se vencieron'))).toHaveLength(1);
  });
});
