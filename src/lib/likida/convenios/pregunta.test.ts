import { describe, it, expect, vi } from 'vitest';
import { atenderPreguntaConvenio, type PuertosPregunta } from './pregunta';
import { ConveniosNoDisponibles, type ViajeLigado } from './repo';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const LIGADO: ViajeLigado = {
  convenioId: 'c1', despachoEnviado: true, acercamientoOrigenEnviado: false, acercamientoDestinoEnviado: false,
  instrucciones: [
    { categoria: 'puerta', texto: 'Puerta 3, lado poniente', momento: 'ambos', lugar: 'destino', orden: 0 },
    { categoria: 'puerta', texto: 'Puerta 1 para cargar', momento: 'ambos', lugar: 'origen', orden: 1 },
  ],
};
const E = { tenantId: 't', operadorId: 'o', viajeAbiertoId: 'v', texto: '¿Por dónde entro?' };
const puertos = (o: Partial<PuertosPregunta> = {}): PuertosPregunta => ({
  viajeEsDelOperador: async () => true, ligado: async () => LIGADO,
  ligar: async () => ({ estado: 'sin_convenio', motivo: 'x' }), lado: async () => 'destino', ...o,
});

describe('atenderPreguntaConvenio', () => {
  it('responde con el perfil de la planta que está atendiendo', async () => {
    expect(await atenderPreguntaConvenio(E, puertos())).toBe('• Por dónde entras: Puerta 3, lado poniente');
    expect(await atenderPreguntaConvenio(E, puertos({ lado: async () => 'origen' }))).toBe('• Por dónde entras: Puerta 1 para cargar');
  });

  it('sin saber la planta muestra las dos con su lado', async () => {
    const t = (await atenderPreguntaConvenio(E, puertos({ lado: async () => null })))!;
    expect(t).toContain('Al descargar: Puerta 3');
    expect(t).toContain('Al cargar: Puerta 1');
  });

  it('lo que no es una pregunta de instrucciones sigue al agente (null) sin tocar la base', async () => {
    const tocar = vi.fn(async () => true);
    expect(await atenderPreguntaConvenio({ ...E, texto: 'ya llegué' }, puertos({ viajeEsDelOperador: tocar }))).toBeNull();
    expect(tocar).not.toHaveBeenCalled();
    expect(await atenderPreguntaConvenio({ ...E, viajeAbiertoId: null }, puertos())).toBeNull();
  });

  it('un viaje que no es suyo (o ya cerrado) no responde', async () => {
    expect(await atenderPreguntaConvenio(E, puertos({ viajeEsDelOperador: async () => false }))).toBeNull();
  });

  it('un viaje anterior a los convenios se liga en el momento', async () => {
    const ligar = vi.fn(async () => ({ estado: 'ligado' as const, ligado: LIGADO }));
    expect(await atenderPreguntaConvenio(E, puertos({ ligado: async () => null, ligar }))).toContain('Puerta 3');
    expect(ligar).toHaveBeenCalledOnce();
  });

  it('sin convenio no inventa: lo dice y manda con el jefe de tráfico', async () => {
    const t = await atenderPreguntaConvenio(E, puertos({ ligado: async () => null }));
    expect(t).toMatch(/No tengo indicaciones de «por dónde entras» registradas.*jefe de tráfico/);
  });

  it('con la base sin migrar o un fallo, devuelve null (el agente sigue) y no lanza', async () => {
    expect(await atenderPreguntaConvenio(E, puertos({ ligado: async () => { throw new ConveniosNoDisponibles(); } }))).toBeNull();
    expect(await atenderPreguntaConvenio(E, puertos({ ligado: async () => { throw new Error('boom'); } }))).toBeNull();
  });
});
