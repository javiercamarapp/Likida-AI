import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams('') }));

const {
  FICHAS_CINCO_AGENTES, insightMasSevero, leerInsightsPorAgente, agentesInsightVisibles, resumirInsights, leerInsightsResumen, LECTORES_INSIGHTS,
} = await import('./inicio-cinco-agentes');
import type { Insight, AgenteInsight, Severidad } from '@/lib/likida/insights/tipos';

// Datos sintéticos: ninguna cifra ni nombre real.
const mk = (agente: AgenteInsight, id: string, severidad: Severidad, quePaso = `Pasó ${id}.`): Insight => ({
  id, agente, severidad, tipo: 'dato', quePaso,
  queSignifica: 'Lectura sintética.', queHacer: 'Revisar la pantalla.',
  fuente: { tabla: 'tabla_sintetica', periodo: 'semana de prueba', n: 3 },
});

describe('insightMasSevero', () => {
  it('elige el urgente sobre atención e info', () => {
    const l = [mk('peajes', 'a', 'info'), mk('peajes', 'b', 'urgente'), mk('peajes', 'c', 'atencion')];
    expect(insightMasSevero(l)?.id).toBe('b');
  });
  it('en empate gana el primero declarado', () => {
    expect(insightMasSevero([mk('peajes', 'a', 'atencion'), mk('peajes', 'b', 'atencion')])?.id).toBe('a');
  });
  it('lista vacía → null', () => {
    expect(insightMasSevero([])).toBeNull();
  });
});

describe('registro de lectores de insights', () => {
  it('el registro de lectores está vacío hoy: por eso un vacío no puede afirmarse como «sin datos» (CT-A12-05)', () => {
    expect(Object.keys(LECTORES_INSIGHTS)).toEqual([]);
  });
});

describe('leerInsightsPorAgente', () => {
  it('sin lectores, los cinco agentes quedan en vacío (5 vacíos)', async () => {
    const r = await leerInsightsPorAgente('t1', {});
    expect(Object.keys(r).sort()).toEqual(['carta-porte', 'conductores', 'liquidacion', 'peajes', 'vigia']);
    for (const v of Object.values(r)) expect(v).toEqual([]);
  });
  it('con datos en los cinco, cada agente trae el suyo', async () => {
    const lectores = Object.fromEntries(
      FICHAS_CINCO_AGENTES.map((f) => [f.insight, async () => [mk(f.insight, `i-${f.insight}`, 'atencion', `Dato de ${f.insight}.`)]]),
    );
    const r = await leerInsightsPorAgente('t1', lectores);
    for (const f of FICHAS_CINCO_AGENTES) expect(insightMasSevero(r[f.insight] ?? [])?.quePaso).toBe(`Dato de ${f.insight}.`);
  });
  it('un lector que falla deja a ese agente en error y no tumba a los demás', async () => {
    const r = await leerInsightsPorAgente('t1', {
      peajes: async () => { throw new Error('boom'); },
      liquidacion: async () => [mk('liquidacion', 'ok', 'info')],
    });
    expect(r.peajes).toBeNull();
    expect(r.liquidacion).toHaveLength(1);
    expect(r['carta-porte']).toEqual([]);
  });
  it('cada ficha del Resumen tiene clave de insight única y válida', () => {
    const claves = FICHAS_CINCO_AGENTES.map((f) => f.insight);
    expect(new Set(claves).size).toBe(5);
  });
});

describe('insights en el Resumen v2: por rol y ruta, y un lector caído no se omite', () => {
  const todos = (): Record<string, () => Promise<Insight[]>> => Object.fromEntries(
    FICHAS_CINCO_AGENTES.map((f) => [f.insight, vi.fn(async () => [mk(f.insight, `i-${f.insight}`, 'atencion')])]),
  );

  it('el dueño sin perfil ve los cinco agentes; el encargado, solo los de operación (los de dinero no)', () => {
    expect(agentesInsightVisibles('flota_admin').sort()).toEqual(['carta-porte', 'conductores', 'liquidacion', 'peajes', 'vigia']);
    expect(agentesInsightVisibles('encargado').sort()).toEqual(['carta-porte', 'conductores', 'vigia']);
    expect(agentesInsightVisibles('rol-desconocido')).toEqual([]);
  });

  it('un agente que el rol no ve NO se lee (su lector ni se llama) y no sale en el resumen', async () => {
    const lectores = todos();
    const { principales, fallidos } = await leerInsightsResumen('t1', 'encargado', null, lectores);
    expect(lectores.liquidacion).not.toHaveBeenCalled();
    expect(lectores.peajes).not.toHaveBeenCalled();
    expect(lectores['carta-porte']).toHaveBeenCalledTimes(1);
    expect(principales.map((i) => i.agente).sort()).toEqual(['carta-porte', 'conductores', 'vigia']);
    expect(fallidos).toEqual([]);
  });

  it('un lector que falla queda en `fallidos`: no se omite en silencio', async () => {
    const lectores = { ...todos(), peajes: async () => { throw new Error('boom'); } };
    const { principales, fallidos } = await leerInsightsResumen('t1', 'flota_admin', null, lectores);
    expect(fallidos).toEqual(['peajes']);
    expect(principales.map((i) => i.agente)).not.toContain('peajes');
    expect(principales).toHaveLength(4);
  });

  it('un lector caído de un agente que el rol no ve tampoco se confiesa (no se leyó)', async () => {
    const lectores = { ...todos(), liquidacion: async () => { throw new Error('boom'); } };
    expect((await leerInsightsResumen('t1', 'encargado', null, lectores)).fallidos).toEqual([]);
  });

  it('resumirInsights: el más grave de cada agente visible, nulos a `fallidos`', () => {
    const r = resumirInsights({
      liquidacion: [mk('liquidacion', 'a', 'info'), mk('liquidacion', 'b', 'urgente')], peajes: null, 'carta-porte': [], vigia: [], conductores: [],
    }, ['liquidacion', 'peajes', 'carta-porte']);
    expect(r.principales.map((i) => i.id)).toEqual(['b']);
    expect(r.fallidos).toEqual(['peajes']);
  });
});
