import { describe, expect, it } from 'vitest';
import { GPS_GENERICO } from './gps';

// A37-S37-05: la dirección que se muestra en el estado de la prueba nunca lleva query (ahí se pega la llave).
describe('GPS genérico: verificadoContra sin parámetros', () => {
  it('con una dirección heredada que trae ?key=..., lo mostrado no la incluye (patrón cabecera)', async () => {
    const r = await GPS_GENERICO.probar(
      { base_url: 'https://api.proveedor.example/v1/vehiculos?key=SECRETO', token: 'TOK', patron: 'cabecera', nombre_campo: 'X-Api-Key' },
      async () => ({ estado: 200, cuerpo: '{}' }),
    );
    expect(JSON.stringify(r)).not.toContain('SECRETO');
    expect(JSON.stringify(r)).not.toContain('TOK"');
    expect(r.verificadoContra).toBe('https://api.proveedor.example/v1/vehiculos');
  });
});
