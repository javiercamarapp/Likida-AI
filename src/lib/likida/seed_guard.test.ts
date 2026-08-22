import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · DAT-16 — el seed pisaba una flota REAL.
//
// `supabase/seed.sql` no hace `on conflict do nothing` con el tenant: hace
// `do update` de razón social, domicilio fiscal, liga del aviso de privacidad y
// RFC del id 11111111-…-111111111111. En producción ese id es una flota de
// verdad. Lo único que separaba "sembrar el demo" de "cambiarle el RFC a un
// cliente" —y con él la validación de receptor de sus CFDI— era acordarse de
// qué DATABASE_URL estaba exportado en esa terminal.
//
// Los dos guards se prueban distinto a propósito: el de host se EJECUTA (no
// necesita base, así que la prueba puede correrlo de verdad), y el de nombre se
// lee (necesita una base viva; contra Postgres lo comprueba quien corra el
// seed, y su gemelo en SQL vive en seed.sql).
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_FALSO = 'postgres://postgres:secreto@db.abcdefgh.supabase.co:5432/postgres';

/** Corre el seed y devuelve su salida y su código, sin dejar que lance. */
function correrSeed(url: string, args: string[] = []) {
  try {
    const salida = execFileSync('bash', ['scripts/seed.sh', ...args], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { codigo: 0, salida };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { codigo: err.status ?? -1, salida: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('scripts/seed.sh — no siembra contra Supabase por accidente', () => {
  it('REHÚSA un host *.supabase.co sin --produccion, y dice cómo insistir', () => {
    const { codigo, salida } = correrSeed(SUPABASE_FALSO);
    expect(codigo).not.toBe(0);
    expect(salida).toMatch(/REHUSADO/);
    expect(salida).toMatch(/db\.abcdefgh\.supabase\.co/);
    expect(salida, 'un guard que no dice cómo pasarlo se salta borrando el guard').toMatch(/--produccion/);
  });

  it('el guard mira el HOST, no la cadena entera: la contraseña no lo dispara', () => {
    // Un `postgres://usuario:supabase.co@localhost/...` es una base local con
    // una contraseña desafortunada. Un `grep supabase.co` la habría rehusado.
    const { codigo, salida } = correrSeed('postgres://postgres:supabase.co@127.0.0.1:1/nada');
    expect(salida).not.toMatch(/REHUSADO: «/);
    expect(codigo, 'falla por no poder conectarse, no por el guard').not.toBe(0);
  });

  it('sin DATABASE_URL no inventa una', () => {
    const { codigo, salida } = correrSeed('');
    expect(codigo).not.toBe(0);
    expect(salida).toMatch(/Falta DATABASE_URL/);
  });

  it('una opción que no existe se rechaza en vez de ignorarse', () => {
    // `--produccion-si` o un typo no pueden pasar por "sin bandera" y tampoco
    // colarse como confirmación.
    const { codigo, salida } = correrSeed(SUPABASE_FALSO, ['--prod']);
    expect(codigo).not.toBe(0);
    expect(salida).toMatch(/Opción desconocida/);
  });

  it('lleva el guard por NOMBRE antes de aplicar migraciones', () => {
    const sh = readFileSync('scripts/seed.sh', 'utf8');
    expect(sh).toMatch(/11111111-1111-1111-1111-111111111111/);
    expect(sh).toMatch(/!= "Flota Demo"/);
    // Antes del bucle de migraciones: sembrar es malo, pero aplicar migraciones
    // a la base de un cliente por error es peor.
    expect(sh.indexOf('!= "Flota Demo"')).toBeLessThan(sh.indexOf('Aplicando migraciones'));
  });
});

describe('supabase/seed.sql — el guard viaja con el archivo', () => {
  const sql = readFileSync('supabase/seed.sql', 'utf8');

  it('aborta si la flota de ese id no se llama «Flota Demo»', () => {
    expect(sql).toMatch(/SEED ABORTADO/);
    expect(sql).toMatch(/nombre_actual <> 'Flota Demo'/);
  });

  it('el guard va ANTES del insert que sobrescribe el tenant', () => {
    // Quien corra el .sql a mano (sin el .sh) tiene que toparse con el guard
    // primero; después del insert no serviría de nada.
    expect(sql.indexOf('SEED ABORTADO')).toBeLessThan(sql.indexOf('insert into tenant'));
  });
});
