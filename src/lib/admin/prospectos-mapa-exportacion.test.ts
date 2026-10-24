import { describe, it, expect, vi, beforeEach } from 'vitest';

// ADM-8 (auditoría 24, MEDIO) — una exportación CSV del Cerebro (hasta 33k
// filas con teléfono/correo de decisores) no dejaba NINGÚN rastro en
// bitácora. `registrarExportacionProspectos` delega en `anotarBitacora`
// (lib/likida/bitacora_escritura.ts) — el ÚNICO escritor permitido de
// `bitacora_auditoria` (auditoría 18, A1: `bitacora_escritura.test.ts` lo
// hace cumplir por grep sobre todo `src/`). Esta prueba fija QUÉ le manda,
// no cómo `anotarBitacora` arma la fila (eso ya lo prueba su propio archivo).

const llamadas: Array<{ entrada: unknown; opciones: unknown }> = [];
const anotarBitacora = vi.fn(async (entrada: unknown, opciones?: unknown) => {
  llamadas.push({ entrada, opciones });
  return true;
});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: [unknown, unknown?]) => anotarBitacora(...a) }));
// `cartera`: lo que cuenta el servidor (contarMapa). `null` = el conteo falla/no hay.
let cartera: number | null = null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      if (cartera === null) throw new Error('sin conteo');
      const base = { is: async () => ({ count: cartera, error: null }) };
      return { select: () => base };
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { registrarExportacionProspectos, registrarEntregaProspectos } = await import('./prospectos-mapa');

beforeEach(() => { llamadas.length = 0; anotarBitacora.mockClear(); cartera = null; });

describe('registrarExportacionProspectos', () => {
  it('llama anotarBitacora con el conteo y los filtros, sin datos de prospectos', async () => {
    await registrarExportacionProspectos('u1', 4200, { giros: ['carga'], soloTel: true });
    expect(anotarBitacora).toHaveBeenCalledTimes(1);
    expect(llamadas[0].entrada).toEqual({
      tenantId: null,
      actor: { id: 'u1' },
      accion: 'prospectos.exportados',
      entidad: 'prospecto',
      entidadId: 'csv',
      detalle: { n: 4200, filtros: { giros: ['carga'], soloTel: true } },
    });
  });

  it('sin actorId, el actor es "sistema" — nunca un id inventado', async () => {
    await registrarExportacionProspectos(null, 10, {});
    expect((llamadas[0].entrada as { actor: unknown }).actor).toBe('sistema');
  });

  it('pasa un evento de log distinguible para cuando la escritura falla', async () => {
    await registrarExportacionProspectos('u1', 10, {});
    expect(llamadas[0].opciones).toEqual({ evento: 'prospectos.exportacion_no_bitacorada' });
  });

  it('en el camino normal no lanza — delega en anotarBitacora, que ya es best-effort por su cuenta', async () => {
    await expect(registrarExportacionProspectos('u1', 10, {})).resolves.toBeUndefined();
  });
});

// A37-S22-04: el n lo declaraba el cliente y la carga completa no dejaba rastro.
describe('A37-S22-04 — la bitácora no confía en el n del cliente', () => {
  it('el n registrado se acota a la cartera que cuenta el SERVIDOR y queda el n declarado', async () => {
    cartera = 33_000;
    await registrarExportacionProspectos('u1', 5, { giros: ['carga'] });
    // Un cliente que declara 5 pero exporta todo: el servidor no puede saber cuánto exportó,
    // pero sí deja constancia de la cartera completa que estaba al alcance de esa entrega.
    expect((llamadas[0].entrada as { detalle: Record<string, unknown> }).detalle)
      .toMatchObject({ n: 5, cartera_servidor: 33_000 });
  });

  it('un n declarado mayor que la cartera real se recorta y se marca inconsistente', async () => {
    cartera = 100;
    await registrarExportacionProspectos('u1', 999_999, {});
    expect((llamadas[0].entrada as { detalle: Record<string, unknown> }).detalle)
      .toMatchObject({ n: 100, n_declarado: 999_999, cartera_servidor: 100, n_inconsistente: true });
  });
});

describe('A37-S22-04 — la ENTREGA de la cartera completa deja rastro', () => {
  it('registrarEntregaProspectos escribe prospectos.entregados con el n del servidor y sin filas', async () => {
    await registrarEntregaProspectos('u1', 33_071, false);
    expect(llamadas[0].entrada).toEqual({
      tenantId: null,
      actor: { id: 'u1' },
      accion: 'prospectos.entregados',
      entidad: 'prospecto',
      entidadId: 'mapa',
      detalle: { n: 33_071, delta: false },
    });
    expect(llamadas[0].opciones).toEqual({ evento: 'prospectos.entrega_no_bitacorada' });
  });
});
