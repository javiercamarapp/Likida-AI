import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { puertosCicloGpsReales, puertosHuerfanosReales } = await import('./ciclo_gps_real');
const { barridoCicloGps } = await import('./ciclo_gps');

// T-A5-66: el CABLEADO. Código que solo ejecutan sus pruebas es código muerto: aquí se comprueba que la rama «sin viaje» cuelga de los
// puertos REALES del ciclo por geocerca (los que usa el cron `conductor-hitos`), que usa los lectores/escritores reales de la tabla de
// huérfanos (persistencia) y que la retención corre en el mantenimiento diario del mismo cron.
describe('la rama «sin viaje» está cableada al cron', () => {
  it('los puertos reales del ciclo por geocerca traen las flotas habilitadas y el barrido de huérfanos', () => {
    const p = puertosCicloGpsReales();
    expect(typeof p.flotasConHuerfanos).toBe('function');
    expect(typeof p.huerfanos).toBe('function');
  });

  it('los puertos reales de huérfanos son los lectores y escritores de la base (guardar, leer pendientes y últimos cruces, marcar, unidades sin viaje, catálogo de sitios)', async () => {
    const x = puertosHuerfanosReales;
    for (const nombre of ['unidadesSinViaje', 'sitiosDeFlotas', 'ultimosCruces', 'guardar', 'pendientes', 'marcarReconciliados'] as const) {
      expect(typeof x[nombre]).toBe('function');
    }
    // contra la base real intentarían leer: aquí la base de la prueba lanza, lo que prueba que NO son funciones vacías
    await expect(x.guardar([{ tenantId: 't', unidadId: 'u', geocercaId: 'g', tipo: 'entrada', en: new Date(), distanciaM: 1, despachoRef: null }])).rejects.toThrow(/no toca la base/);
    await expect(x.pendientes([{ tenantId: 't', unidadId: 'u' }], 5)).rejects.toThrow(/no toca la base/);
  });

  it('el barrido real del cron (barridoCicloGps con los puertos reales) llama a las flotas habilitadas: una base que no contesta queda como fallo, no como silencio', async () => {
    const p = { ...puertosCicloGpsReales(), viajes: async () => [] };
    const r = await barridoCicloGps(p, new Date());
    expect(r.fallos.join(' ')).toMatch(/huérfanos/);
  });

  it('el cron conductor-hitos invoca barridoCicloGps con los puertos reales y su mantenimiento diario purga los huérfanos', () => {
    const ruta = readFileSync(resolve(__dirname, '../../../app/api/cron/conductor-hitos/route.ts'), 'utf8');
    expect(ruta).toMatch(/barridoCicloGps\(sinFlotasEnViajes\(puertosCicloGpsReales\(\), saltar\)/);
    expect(ruta).toMatch(/correrMantenimientoConductor\(\)/);
    const repo = readFileSync(resolve(__dirname, 'repo.ts'), 'utf8');
    expect(repo).toMatch(/purgar_eventos_geocerca_huerfanos/);
  });
});
