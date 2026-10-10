/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: archivos temporales y scripts del propio repo, rutas armadas sobre constantes de este archivo. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// La prueba de idempotencia (probar-idempotencia.sh) NO puede pasar en falso.
// Estas pruebas ejercen su lógica de comparación (lib_huella.sh) con huellas fabricadas, sin base:
//   · una columna que cambia (p. ej. viaje.origen_geocerca_id → NULL tras borrar geocercas) cambia la huella → FALLA;
//   · una huella con 0 filas FALLA (antes «pasaba» sin probar nada);
//   · la huella de cada tabla es de la FILA COMPLETA, no de unas columnas.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = fileURLToPath(new URL('../../../../scripts/demo/innovativos/', import.meta.url));

function comprobar(huellas: [string, string, string, string], esperadas = 3) {
  const d = mkdtempSync(join(tmpdir(), 'huella-'));
  const rutas = huellas.map((h, i) => { const p = join(d, `h${i + 1}.txt`); writeFileSync(p, h); return p; });
  return spawnSync('bash', ['-c', `. "${DIR}lib_huella.sh"; comprobar_huellas ${esperadas} "$@"`, '_', ...rutas], { encoding: 'utf8' });
}
const BUENA = 'viaje|406|aaa\ngeocerca|31|bbb\nunidad|250|ccc\n';

describe('comprobar_huellas', () => {
  it('huellas idénticas y con filas → OK', () => {
    expect(comprobar([BUENA, BUENA, BUENA, BUENA]).status).toBe(0);
  });
  it('una columna que se pierde en la 4.ª corrida (huella de viaje distinta) → FALLA', () => {
    const r = comprobar([BUENA, BUENA, BUENA, BUENA.replace('aaa', 'zzz')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('vaciar + sembrar no reproduce lo mismo');
  });
  it('la 2.ª y la 3.ª corrida también se comparan', () => {
    expect(comprobar([BUENA, BUENA.replace('bbb', 'x'), BUENA, BUENA]).stderr).toContain('la 2.ª corrida cambió filas');
    expect(comprobar([BUENA, BUENA, BUENA.replace('ccc', 'x'), BUENA]).stderr).toContain('--reiniciar no reproduce lo mismo');
  });
  it('0 filas en una tabla → FALLA aunque las 4 huellas coincidan', () => {
    const vacia = 'viaje|406|aaa\ngeocerca|0|vacio\nunidad|250|ccc\n';
    const r = comprobar([vacia, vacia, vacia, vacia]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('la tabla geocerca tiene 0 filas');
  });
  it('todo en 0 filas (base vacía) → FALLA', () => {
    const nada = 'viaje|0|vacio\ngeocerca|0|vacio\nunidad|0|vacio\n';
    expect(comprobar([nada, nada, nada, nada]).status).toBe(1);
  });
  it('una huella que no cubre todas las tablas → FALLA', () => {
    const r = comprobar([BUENA, BUENA, BUENA, BUENA], 4);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no cubre todas las tablas');
  });
});

describe('probar-idempotencia.sh (forma del script)', () => {
  const sh = readFileSync(`${DIR}probar-idempotencia.sh`, 'utf8');
  it('la huella es de la fila completa (to_jsonb), solo excluye marcas de reloj y el id serial de posicion', () => {
    expect(sh).toContain('to_jsonb(t)');
    expect(sh).toContain("'created_at','updated_at','creado_en','creada_en'");
    expect(sh).toContain("t.tenant_id = '$T'|id"); // posicion: bigserial
  });
  it('cubre viaje (origen y destino), los veredictos y todas las tablas sembradas', () => {
    for (const t of ['viaje|viaje', 'viaje_hito|viaje_hito', 'viaje_hito_validacion', 'geocerca|geocerca', 'posicion|posicion', 'vigia_mensaje', 'conductor_contacto_trafico', 'liquidacion_externa', 'cp_documento', 'desglose_peaje_linea', 'peaje_tag']) {
      expect(sh, t).toContain(`"${t}`);
    }
  });
  it('comprueba aparte que ningún viaje queda sin origen_geocerca_id/destino_geocerca_id', () => {
    expect(sh).toMatch(/origen_geocerca_id is null or destino_geocerca_id is null/);
  });
  it('el rol de lectura solo cuenta como «sin escritura» si el error es de PERMISOS', () => {
    expect(sh).toContain('*"permission denied"*');
  });
});
