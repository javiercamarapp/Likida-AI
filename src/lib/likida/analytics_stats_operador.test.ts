import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 3, ARQ-C1 (CRÍTICO, reincidente de la ola 2): `diferencias`
// salía hardcodeada en 0 desde getStatsPorOperador y la ventana del Agente
// de Liquidación pintaba "Ningún operador acumula diferencias — la señal
// que quieres ver" como si fuera medición. Esta prueba alimenta
// liquidaciones REALES con diferencia y exige que el conteo salga por
// operador — si alguien vuelve a poner el 0, esto se pone rojo.
// ═══════════════════════════════════════════════════════════════════════════

const FILAS: Record<string, unknown[]> = {
  operador: [
    { id: 'o1', nombre: 'Juan Pérez' },
    { id: 'o2', nombre: 'María López' },
  ],
  gasto: [{ viaje_id: 'v1', concepto: 'diesel', monto: 500 }],
  viaje: [
    { id: 'v1', operador_id: 'o1' },
    { id: 'v2', operador_id: 'o1' },
    { id: 'v3', operador_id: 'o2' },
  ],
  liquidacion: [
    { viaje_id: 'v1', diferencia: -150 },
    // Centavos de redondeo: NO cuentan como diferencia.
    { viaje_id: 'v2', diferencia: 0.005 },
    { viaje_id: 'v3', diferencia: 200 },
  ],
};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let desde = 0;
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain, eq: chain, order: chain,
        range: (d: number) => { desde = d; return b; },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: desde === 0 ? (FILAS[tabla] ?? []) : [], error: null }).then(res),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getStatsPorOperador } = await import('./analytics');

describe('getStatsPorOperador — las diferencias se CUENTAN, no se inventan (ARQ-C1)', () => {
  it('cada operador trae sus liquidaciones con diferencia real; el redondeo no cuenta', async () => {
    const stats = await getStatsPorOperador('t1');
    const juan = stats.find((s) => s.operadorId === 'o1');
    const maria = stats.find((s) => s.operadorId === 'o2');
    expect(juan?.diferencias).toBe(1); // v1 sí (-150); v2 no (0.005 = redondeo)
    expect(maria?.diferencias).toBe(1); // v3 (200)
    expect(juan?.dieselTotal).toBe(500);
  });
});

describe('AUDITORÍA 18 (A9) · el ranking no identifica a la persona', () => {
  // El aviso promete "estadísticas de uso, sin identificarte en los reportes".
  it('por defecto la etiqueta es un seudónimo estable, no el nombre', async () => {
    const stats = await getStatsPorOperador('t1');
    const texto = JSON.stringify(stats);
    expect(texto).not.toContain('Juan Pérez');
    expect(texto).not.toContain('María López');
    expect(stats.find((s) => s.operadorId === 'o1')?.nombre).toMatch(/^Operador ·[0-9A-Z]{1,6}$/);
    // Estable: dos cargas, misma etiqueta.
    const otra = await getStatsPorOperador('t1');
    expect(otra.map((s) => s.nombre)).toEqual(stats.map((s) => s.nombre));
  });

  it('el nombre real solo sale pidiéndolo explícitamente', async () => {
    const stats = await getStatsPorOperador('t1', { nominal: true });
    expect(stats.find((s) => s.operadorId === 'o1')?.nombre).toBe('Juan Pérez');
  });

  it('quien ejerció la oposición del art. 26 fr. II no aparece en la lista', async () => {
    FILAS.operador = [
      { id: 'o1', nombre: 'Juan Pérez', oposicion_automatizada: '2026-08-01T00:00:00Z' },
      { id: 'o2', nombre: 'María López', oposicion_automatizada: null },
    ];
    const stats = await getStatsPorOperador('t1');
    expect(stats.map((s) => s.operadorId)).toEqual(['o2']);
  });
});
