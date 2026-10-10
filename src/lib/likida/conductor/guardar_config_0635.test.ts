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

const falta0635 = { error: { message: "Could not find the 'detectar_hitos_gps' column of 'agente_conductor_config' in the schema cache" } };
const falta0604 = { error: { message: "Could not find the 'avisar_llegada_sin_confirmar' column of 'agente_conductor_config' in the schema cache" } };

beforeEach(() => { upserts.length = 0; respuestas = []; });

describe('guardar la config contra una base con o sin la 0635', () => {
  it('con la 0635 aplicada guarda las dos perillas nuevas', async () => {
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, avisarSenalVida: true, detectarHitosGps: false }, undefined);
    expect(r).toBe('ok');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ tenant_id: 't1', avisar_senal_vida: true, detectar_hitos_gps: false });
  });

  it('sin la 0635 y con las perillas en su valor de partida, guarda lo demás sin las columnas nuevas', async () => {
    respuestas = [falta0635];
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 8 }, undefined);
    expect(r).toBe('ok');
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).toMatchObject({ tope_diario_chofer: 8 });
    expect(upserts[1]).not.toHaveProperty('detectar_hitos_gps');
    expect(upserts[1]).not.toHaveProperty('avisar_senal_vida');
    expect(upserts[1]).toHaveProperty('margen_acercamiento_m'); // la 0604 sí está: no se retira
  });

  it('sin la 0635, pedir el aviso o apagar la detección NO se calla: dice que falta la migración y no guarda nada a medias', async () => {
    respuestas = [falta0635];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, avisarSenalVida: true }, undefined)).rejects.toThrow(/0635/);
    expect(upserts).toHaveLength(1);
    respuestas = [falta0635];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, detectarHitosGps: false }, undefined)).rejects.toThrow(/0635/);
  });

  it('una base sin la 0604 NI la 0635 guarda lo demás retirando los dos grupos, uno por intento', async () => {
    respuestas = [falta0635, falta0604];
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 9 }, undefined);
    expect(r).toBe('ok');
    expect(upserts).toHaveLength(3);
    expect(upserts[2]).toMatchObject({ tope_diario_chofer: 9 });
    for (const col of ['detectar_hitos_gps', 'avisar_senal_vida', 'avisar_llegada_sin_confirmar', 'margen_acercamiento_m']) expect(upserts[2]).not.toHaveProperty(col);
  });

  it('otro error de la base no se confunde con la migración faltante', async () => {
    respuestas = [{ error: { message: 'conexión rota' } }];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT }, undefined)).rejects.toThrow(/conexión rota/);
    expect(upserts).toHaveLength(1);
  });
});
