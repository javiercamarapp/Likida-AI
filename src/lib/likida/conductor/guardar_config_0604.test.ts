import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const upserts: Array<Record<string, unknown>> = [];
let respuestas: Array<{ error: { message: string } | null }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      upsert: (fila: Record<string, unknown>) => {
        upserts.push(fila);
        return Promise.resolve(respuestas.shift() ?? { error: null });
      },
    }),
  }),
}));

const { guardarConfigConductor } = await import('./repo');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');

const faltaColumna = { error: { message: "Could not find the 'avisar_llegada_sin_confirmar' column of 'agente_conductor_config' in the schema cache" } };

beforeEach(() => { upserts.length = 0; respuestas = []; });

describe('guardar la config contra una base con o sin la 0604', () => {
  it('con la 0604 aplicada guarda las dos perillas nuevas', async () => {
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, avisarLlegadaSinConfirmar: true, margenAcercamientoM: 8000 }, undefined);
    expect(r).toBe('ok');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ tenant_id: 't1', avisar_llegada_sin_confirmar: true, margen_acercamiento_m: 8000 });
  });

  it('sin la 0604 y con las perillas en su valor de partida, guarda lo demás sin las columnas nuevas', async () => {
    respuestas = [faltaColumna];
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 8 }, undefined);
    expect(r).toBe('ok');
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).toMatchObject({ tope_diario_chofer: 8 });
    expect(upserts[1]).not.toHaveProperty('avisar_llegada_sin_confirmar');
    expect(upserts[1]).not.toHaveProperty('margen_acercamiento_m');
  });

  it('sin la 0604, pedir el aviso o un margen distinto NO se calla: dice que falta la migración y no guarda nada a medias', async () => {
    respuestas = [faltaColumna];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, avisarLlegadaSinConfirmar: true }, undefined)).rejects.toThrow(/0604/);
    expect(upserts).toHaveLength(1);
    respuestas = [faltaColumna];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, margenAcercamientoM: 9000 }, undefined)).rejects.toThrow(/0604/);
  });

  it('otro error de la base no se confunde con la migración faltante', async () => {
    respuestas = [{ error: { message: 'permission denied for table agente_conductor_config' } }];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT }, undefined)).rejects.toThrow(/permission denied/);
    expect(upserts).toHaveLength(1);
  });
});
