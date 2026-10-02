/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen archivos de muestra y SQL del propio repo por rutas armadas sobre constantes de este archivo, nunca por entrada de usuario. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LAS GARANTÍAS DEL SEED DEL DEMO QUE NO NECESITAN BASE:
//   · determinista (nada de random()/now()/gen_random_uuid() en el SQL),
//   · idempotente por construcción (todo INSERT a una tabla del producto lleva
//     ON CONFLICT),
//   · NUNCA producción (sembrar.sh y vaciar-sintetico.sh rechazan hosts remotos
//     ANTES de abrir ninguna conexión).
// La prueba con base real (3 corridas, huellas por tabla, rol de solo lectura)
// es scripts/demo/innovativos/probar-idempotencia.sh.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = fileURLToPath(new URL('../../../../scripts/demo/innovativos/', import.meta.url));
const sqls = readdirSync(`${DIR}sql`).filter((f) => f.endsWith('.sql')).sort();
const sinComentarios = (s: string) => s.replace(/--[^\n]*/g, '');

describe('el SQL del seed', () => {
  it('trae los 10 bloques en orden', () => {
    expect(sqls).toEqual(['00_guardas_y_ayudas.sql', '01_base.sql', '02_viajes.sql', '03_gps.sql', '04_peajes.sql', '05_liquidacion.sql', '06_cartaporte.sql', '07_vigia_y_conductor.sql', '08_convenios.sql', '09_resumen.sql']);
    const orq = readFileSync(`${DIR}sembrar.sql`, 'utf8');
    for (const f of sqls) expect(orq).toContain(`\\ir sql/${f}`);
  });

  it.each(sqls)('%s: es DETERMINISTA (sin random(), now(), gen_random_uuid() ni fechas del reloj)', (f) => {
    const s = sinComentarios(readFileSync(`${DIR}sql/${f}`, 'utf8'));
    expect(s).not.toMatch(/\brandom\s*\(/i);
    expect(s).not.toMatch(/\bgen_random_uuid\s*\(/i);
    expect(s).not.toMatch(/(^|[^_a-z])now\s*\(\s*\)/i);
    expect(s).not.toMatch(/\bclock_timestamp\s*\(/i);
    expect(s).not.toMatch(/\bcurrent_(date|timestamp)\b/i);
    expect(s).not.toMatch(/\blocaltimestamp\b/i);
  });

  it.each(sqls)('%s: todo INSERT a una tabla del producto lleva ON CONFLICT (re-correr no duplica)', (f) => {
    const s = sinComentarios(readFileSync(`${DIR}sql/${f}`, 'utf8'));
    // Cada sentencia termina en «;» al final de línea (los $$ de los DO no se parten aquí: se revisan completos).
    const sentencias = s.split(/;\s*(?:\n|$)/);
    const inserts = sentencias.filter((x) => /(^|\n)\s*insert\s+into\s+/i.test(x));
    for (const ins of inserts) {
      const tabla = /insert\s+into\s+([a-z_."]+)/i.exec(ins)![1];
      if (tabla.startsWith('innovativos_sim.')) continue; // tablas derivadas: se recrean (drop + create) en cada corrida
      expect(ins, `INSERT INTO ${tabla} sin ON CONFLICT en ${f}`).toMatch(/on\s+conflict/i);
    }
  });

  it('las tablas derivadas (innovativos_sim) se recrean, no se acumulan', () => {
    for (const f of ['02_viajes.sql', '03_gps.sql', '04_peajes.sql', '05_liquidacion.sql', '08_convenios.sql']) {
      const s = readFileSync(`${DIR}sql/${f}`, 'utf8');
      expect(s).toMatch(/drop table if exists innovativos_sim\./i);
    }
  });

  it('el guardia de red está en el seed, en limpiar y en vaciar', () => {
    for (const f of ['sql/00_guardas_y_ayudas.sql', 'limpiar.sql', 'vaciar.sql']) {
      const s = readFileSync(`${DIR}${f}`, 'utf8');
      expect(s).toContain('inet_server_addr()');
      expect(s).toContain("'127.0.0.0/8'");
    }
  });
});

describe('los veredictos de ubicación (excepción «ya llegué» sin GPS)', () => {
  const viajes = sinComentarios(readFileSync(`${DIR}sql/02_viajes.sql`, 'utf8'));
  it('el hito del «ya llegué» sin GPS lleva la posición REAL del tractor (lejos de la planta), no las coordenadas de la planta', () => {
    expect(viajes).toMatch(/case when r\.escenario_llegue then pl\.lat/);
    expect(viajes).toMatch(/case when r\.escenario_llegue then pl\.lng/);
    expect(viajes).not.toMatch(/case when r\.escenario_llegue then ld\.(lat|lng)/);
  });
  it('ese hito entra por texto (no por pin): se compara contra el GPS', () => {
    expect(viajes).toMatch(/p\.escenario = 'llegue_sin_gps' and e\.tipo = 'llegada_descarga' then 2/);
  });
  it('sembrar.sh corre el motor real (generar-veredictos.mjs) después del SQL, y el motor es el del producto', () => {
    const sh = readFileSync(`${DIR}sembrar.sh`, 'utf8');
    expect(sh.indexOf('-f sembrar.sql')).toBeGreaterThan(-1);
    expect(sh.indexOf('node generar-veredictos.mjs')).toBeGreaterThan(sh.indexOf('-f sembrar.sql'));
    const gen = readFileSync(`${DIR}generar-veredictos.mjs`, 'utf8');
    expect(gen).toContain('conductor/validar_hito.ts');
    expect(gen).toContain('validarHitoContraSitio');
    expect(gen).not.toMatch(/'sin_coincidencia'\s*,\s*null/); // ningún veredicto escrito a mano
  });
});

function correr(script: string, args: string[], env: Record<string, string>) {
  // Entorno mínimo: sin DATABASE_URL heredada. Si una guarda fallara, psql se abriría contra un host inexistente y la prueba lo notaría por el código de salida.
  return spawnSync('bash', [`${DIR}${script}`, ...args], { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
}

describe('sembrar.sh y vaciar-sintetico.sh: NUNCA contra producción', () => {
  const REMOTAS = [
    'postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres',
    'postgresql://postgres.abcd:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    'postgresql://u:p@8.8.8.8:5432/db',
    'postgresql://u:p@produccion.ejemplo.com/db',
    'postgresql://u:p@ep-cool.neon.tech/db',
  ];
  it.each(REMOTAS)('rechaza %s (código 3, sin conectar)', (url) => {
    const a = correr('sembrar.sh', [], { DEMO_DATABASE_URL: url });
    expect(a.status).toBe(3);
    expect(a.stderr).toContain('RECHAZADO');
    const b = correr('vaciar-sintetico.sh', ['todo'], { DEMO_DATABASE_URL: url });
    expect(b.status).toBe(3);
  });
  it('no adivina la base: sin DEMO_DATABASE_URL no hace nada aunque haya DATABASE_URL o SUPABASE_DB_URL', () => {
    const r = correr('sembrar.sh', [], { DATABASE_URL: 'postgresql:///x', SUPABASE_DB_URL: 'postgresql:///y' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('DEMO_DATABASE_URL');
  });
  it('argumentos inválidos se rechazan antes de conectar', () => {
    expect(correr('sembrar.sh', ['--borra-todo'], { DEMO_DATABASE_URL: 'postgresql:///x' }).status).toBe(2);
    expect(correr('vaciar-sintetico.sh', ['nada'], { DEMO_DATABASE_URL: 'postgresql:///x' }).status).toBe(2);
  });
});
