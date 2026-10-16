import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams('') }));

const {
  FICHAS_CINCO_AGENTES, InsightDeAgente, insightMasSevero, leerInsightsPorAgente,
  TEXTO_VACIO_RESUMEN, TEXTO_ERROR_RESUMEN, TEXTO_PROXIMAMENTE_RESUMEN,
} = await import('./inicio-cinco-agentes');
import type { Insight, AgenteInsight, Severidad } from '@/lib/likida/insights/tipos';

// Datos sintéticos: ninguna cifra ni nombre real.
const mk = (agente: AgenteInsight, id: string, severidad: Severidad, quePaso = `Pasó ${id}.`): Insight => ({
  id, agente, severidad, tipo: 'dato', quePaso,
  queSignifica: 'Lectura sintética.', queHacer: 'Revisar la pantalla.',
  fuente: { tabla: 'tabla_sintetica', periodo: 'semana de prueba', n: 3 },
});
const pintar = (i: readonly Insight[] | null | undefined, extra: Partial<Parameters<typeof InsightDeAgente>[0]> = {}) =>
  renderToStaticMarkup(<InsightDeAgente insights={i} href="/dashboard/agentes/x" nombre="Agente X" {...extra} />);

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

describe('InsightDeAgente', () => {
  it('con datos muestra la tarjeta del más severo (no la del resto) y el acceso a la pantalla', () => {
    const h = pintar([mk('peajes', 'leve', 'info', 'Texto leve.'), mk('peajes', 'grave', 'urgente', 'Texto grave.')]);
    expect(h).toContain('Texto grave.');
    expect(h).not.toContain('Texto leve.');
    expect(h).toContain('Fuente: tabla_sintetica');
    expect(h).toContain('href="/dashboard/agentes/x"');
    expect(h).toContain('Abrir Agente X');
  });
  it('sin datos dice el vacío llano, sin cifras', () => {
    const h = pintar([]);
    expect(h).toContain(TEXTO_VACIO_RESUMEN);
    expect(h).toContain('data-estado="vacio"');
    expect(TEXTO_VACIO_RESUMEN).not.toMatch(/\d/);
    expect(h).not.toContain('data-insight="');
  });
  it('lectura fallida se confiesa, no se vuelve un vacío', () => {
    const h = pintar(null);
    expect(h).toContain(TEXTO_ERROR_RESUMEN);
    expect(h).toContain('role="alert"');
  });
  it('próximamente no enseña insight ni acceso a la función', () => {
    const h = pintar([mk('vigia', 'v', 'urgente', 'No debe verse.')], { proximamente: true });
    expect(h).toContain(TEXTO_PROXIMAMENTE_RESUMEN);
    expect(h).not.toContain('No debe verse.');
    expect(h).not.toContain('href=');
  });
  it('el acceso conserva el sufijo del superadmin', () => {
    expect(pintar([], { sufijo: '?tenant=t1' })).toContain('href="/dashboard/agentes/x?tenant=t1"');
  });
});

describe('leerInsightsPorAgente', () => {
  it('sin lectores, los cinco agentes quedan en vacío (5 vacíos)', async () => {
    const r = await leerInsightsPorAgente('t1', {});
    expect(Object.keys(r).sort()).toEqual(['carta-porte', 'conductores', 'liquidacion', 'peajes', 'vigia']);
    for (const v of Object.values(r)) expect(v).toEqual([]);
  });
  it('con datos en los cinco, cada agente trae el suyo (5 tarjetas)', async () => {
    const lectores = Object.fromEntries(
      FICHAS_CINCO_AGENTES.map((f) => [f.insight, async () => [mk(f.insight, `i-${f.insight}`, 'atencion', `Dato de ${f.insight}.`)]]),
    );
    const r = await leerInsightsPorAgente('t1', lectores);
    const html = FICHAS_CINCO_AGENTES.map((f) => pintar(r[f.insight], { href: f.href, nombre: f.nombre })).join('');
    expect((html.match(/data-insight="/g) ?? []).length).toBe(5);
    for (const f of FICHAS_CINCO_AGENTES) expect(html).toContain(`Dato de ${f.insight}.`);
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
