// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · DATOS-B1 — `ModelRole` y `agente_definicion_modelo_rol_dominio`
// dicen exactamente lo mismo, en las DOS direcciones.
//
// El CHECK de la 0125 congeló 13 roles y `models.ts` siguió creciendo: hoy
// tiene 14, distintos en ambos sentidos (`chat_ligero`/`router` retirados de
// TS pero seguían en el CHECK; `piloto`/`transcripcion`/`contador` con
// llamador en TS pero rechazados por el CHECK). Nada en el repo cruzaba las
// dos listas — el mismo patrón que dejó pasar el de `FaseCosto`
// (costos_dominio.test.ts), esta vez sobre `modelo_rol`.
//
// Esta prueba NO consulta Postgres —aquí no hay base—: lee el SQL de la
// ÚLTIMA migración que define el constraint (soltar y recrear es el idioma
// del repo) y lo compara conjunto contra conjunto contra `ModelRole`.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations');
const CONSTRAINT = 'agente_definicion_modelo_rol_dominio';

/** Los roles que el CHECK vivo acepta, según la ÚLTIMA migración que lo define. */
function rolesDelDominio(): { roles: string[]; migracion: string } {
  const archivos = readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  let ultima: { roles: string[]; migracion: string } | null = null;

  for (const archivo of archivos) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de readdirSync sobre un directorio fijo del repo
    const crudo = readFileSync(join(MIGRACIONES, archivo), 'utf8');
    if (!crudo.includes(CONSTRAINT)) continue;
    const sinComentarios = crudo.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    for (const m of sinComentarios.matchAll(/modelo_rol\s+in\s*\(([^)]*)\)/gi)) {
      const roles = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      if (roles.length > 0) ultima = { roles, migracion: archivo };
    }
  }

  if (!ultima) throw new Error(`ninguna migración define ${CONSTRAINT}`);
  return ultima;
}

/** Los roles que `ModelRole` declara, leídos del fuente (no copiados a mano
 *  aquí: eso sería una TERCERA lista, justo lo que esta prueba vigila). */
function rolesDelTipo(): string[] {
  const src = readFileSync(join(process.cwd(), 'src', 'lib', 'llm', 'models.ts'), 'utf8');
  const m = src.match(/export type ModelRole\s*=\s*([^;]+);/);
  if (!m) throw new Error('no se encontró `export type ModelRole` en models.ts');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('DATOS-B1 · ModelRole y agente_definicion_modelo_rol_dominio dicen lo mismo', () => {
  it('el CHECK acepta TODOS los roles que ModelRole declara', () => {
    const { roles, migracion } = rolesDelDominio();
    const enTs = rolesDelTipo();
    const rechazados = enTs.filter((r) => !roles.includes(r));
    expect(
      rechazados,
      `el CHECK de ${migracion} rechaza ${rechazados.join(', ')}: una migración que ` +
        'declare ese rol para un agente rebota con 23514 y aborta el deploy.',
    ).toEqual([]);
  });

  it('el CHECK no acepta roles que ModelRole ya no tiene', () => {
    const { roles, migracion } = rolesDelDominio();
    const enTs = rolesDelTipo();
    const sobrantes = roles.filter((r) => !enTs.includes(r));
    expect(
      sobrantes,
      `${migracion} acepta ${sobrantes.join(', ')}, que ModelRole ya no declara: ` +
        'una fila con ese rol pinta en /admin/agentes algo que models.ts no sabe resolver.',
    ).toEqual([]);
  });

  it('`piloto`, `transcripcion` y `contador` están en las dos listas', () => {
    expect(rolesDelTipo()).toEqual(expect.arrayContaining(['piloto', 'transcripcion', 'contador']));
    expect(rolesDelDominio().roles).toEqual(expect.arrayContaining(['piloto', 'transcripcion', 'contador']));
  });

  it('`chat_ligero` y `router` (retirados de TS) ya no están en el CHECK', () => {
    expect(rolesDelDominio().roles).not.toEqual(expect.arrayContaining(['chat_ligero', 'router']));
  });
});
