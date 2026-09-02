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
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('no debería tocar supabaseAdmin directo'); } }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { registrarExportacionProspectos } = await import('./prospectos-mapa');

beforeEach(() => { llamadas.length = 0; anotarBitacora.mockClear(); });

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
