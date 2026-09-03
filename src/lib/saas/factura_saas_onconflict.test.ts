// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · DATOS-A2 — el `onConflict` del webhook de Stripe apunta a un
// índice que PostgREST SÍ puede inferir.
//
// `factura_saas_stripe_unica` nació PARCIAL (0052:105-106, `where
// stripe_invoice_id is not null`) y `aplicarFactura` (suscripcion.ts) lo usa
// como blanco de un `.upsert({...}, { onConflict: 'stripe_invoice_id' })`.
// PostgREST traduce eso a un `ON CONFLICT (stripe_invoice_id) DO UPDATE` SIN
// predicado — y Postgres solo infiere un único PARCIAL si el ON CONFLICT
// repite su WHERE, que PostgREST no puede escribir. Sin eso: 42P10.
//
// Esta prueba NO consulta Postgres —aquí no hay base—: lee el SQL de la
// ÚLTIMA migración que define el índice (el idioma del repo es soltar y
// recrear, igual que costos_dominio.test.ts) y el `onConflict` real del
// llamador, y comprueba la propiedad que evita el 42P10: el índice que
// gobierna HOY no es parcial.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations');
const INDICE = 'factura_saas_stripe_unica';

/** La ÚLTIMA migración que define `factura_saas_stripe_unica`, y si esa
 *  definición trae `where` (parcial) o no. */
function ultimaDefinicion(): { archivo: string; sql: string; esParcial: boolean } {
  const archivos = readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  let ultima: { archivo: string; sql: string } | null = null;

  for (const archivo of archivos) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de readdirSync sobre un directorio fijo del repo
    const crudo = readFileSync(join(MIGRACIONES, archivo), 'utf8');
    // Sin líneas de comentario `--`: una cabecera puede CITAR la sentencia
    // vieja como prosa (esta misma migración lo hace), y esa cita no cuenta
    // como definición.
    const contenido = crudo.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    // `create unique index … <nombre> on public.factura_saas (…) [where …];`
    const m = contenido.match(
      new RegExp(`create unique index[^;]*\\b${INDICE}\\b[\\s\\S]*?;`, 'i'),
    );
    if (m) ultima = { archivo, sql: m[0] };
  }

  if (!ultima) throw new Error(`ninguna migración define el índice ${INDICE}`);
  return { ...ultima, esParcial: /\bwhere\b/i.test(ultima.sql) };
}

describe('DATOS-A2 · factura_saas_stripe_unica no es un índice parcial', () => {
  it('la definición vigente del índice NO trae `where` — PostgREST puede inferirlo desde onConflict', () => {
    const { archivo, sql, esParcial } = ultimaDefinicion();
    expect(
      esParcial,
      `${archivo} define ${INDICE} como PARCIAL (${sql.trim()}). El upsert de ` +
        "suscripcion.ts hace `onConflict: 'stripe_invoice_id'` SIN predicado — " +
        'PostgREST no puede inferir un único parcial desde ahí y Postgres aborta ' +
        'con 42P10 en cuanto el primer webhook de Stripe intente escribir.',
    ).toBe(false);
  });

  it('el llamador real sigue apuntando a `stripe_invoice_id` (si cambia, esta prueba deja de proteger nada)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'lib', 'saas', 'suscripcion.ts'),
      'utf8',
    );
    expect(src).toMatch(/onConflict:\s*'stripe_invoice_id'/);
  });
});
