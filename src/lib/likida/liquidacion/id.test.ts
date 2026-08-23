import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { idLiquidacionDeViaje } from './id';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · DAT-41 — el folio del papel citaba un id que no existía.
//
// El PDF se genera ANTES de que la fila exista (hay que subirlo para guardar su
// ruta), así que `tools.ts` imprimía con un `randomUUID()` y la base insertaba
// otro. Cuando el viaje no trae folio, el encabezado del documento son los ocho
// primeros de ESE id: el contralor archiva un papel cuyo número no se puede
// buscar en ningún lado.
//
// Lo que hay que sostener es que las DOS mitades —el TS que imprime y el SQL
// que inserta— calculan lo mismo. Aquí se prueba el lado de TS y que la
// migración siga trayendo su gemelo; que coincidan de verdad contra Postgres lo
// comprueba el bloque 131 de verificaciones.sql.
// ═══════════════════════════════════════════════════════════════════════════

const VIAJE = '44444444-0000-0000-0000-000000000001';

describe('idLiquidacionDeViaje', () => {
  it('es determinístico: el mismo viaje da el mismo id, siempre', () => {
    expect(idLiquidacionDeViaje(VIAJE)).toBe(idLiquidacionDeViaje(VIAJE));
  });

  it('coincide con lo que inserta Postgres (corrido el 22-ago-2026 contra la 0159)', () => {
    // Salida REAL de `select md5('44444444-…-000000000001' || ':liquidacion')::uuid`
    // en la base con las 159 migraciones aplicadas. Si el TS o el trigger
    // cambian de fórmula, este número deja de cuadrar y el papel vuelve a
    // mentir.
    expect(idLiquidacionDeViaje(VIAJE)).toBe('863684a1-e6a8-a29d-c05a-02b27ea2743f');
  });

  it('tiene forma de uuid: es lo que va a la columna `id` de liquidacion', () => {
    expect(idLiquidacionDeViaje(VIAJE)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('dos viajes distintos NO comparten id', () => {
    expect(idLiquidacionDeViaje(VIAJE)).not.toBe(idLiquidacionDeViaje('44444444-0000-0000-0000-000000000002'));
  });

  it('un id en MAYÚSCULAS da el mismo resultado que en minúsculas', () => {
    // Postgres imprime los uuid en minúsculas; si TS recibiera uno en
    // mayúsculas y no lo normalizara, el hash sería otro — el mismo desajuste
    // que esto cierra, con una causa mucho más difícil de ver.
    expect(idLiquidacionDeViaje(VIAJE.toUpperCase())).toBe(idLiquidacionDeViaje(VIAJE));
    expect(idLiquidacionDeViaje(` ${VIAJE} `)).toBe(idLiquidacionDeViaje(VIAJE));
  });

  it('la migración 0159 sigue trayendo el gemelo en SQL', () => {
    // Si alguien quita el trigger, la base vuelve a `gen_random_uuid()` y el
    // PDF vuelve a citar un id inexistente — sin que ninguna prueba de TS se
    // entere.
    const sql = readFileSync('supabase/migrations/0159_rpcs_atomicas.sql', 'utf8');
    expect(sql).toContain("md5(new.viaje_id::text || ':liquidacion')::uuid");
    expect(sql).toContain('create trigger trg_liquidacion_id_del_viaje');
  });
});
