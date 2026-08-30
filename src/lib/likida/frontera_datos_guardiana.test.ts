import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21, ALTO — REINCIDENTE (c18, c19, c20). `repo.ts`/`pg.ts` dejaron
// de ser "el único punto de acceso a datos" (MAPA.md, CLAUDE.md) hace tres
// rondas: 128 → 171 → 186 → 243 archivos de producción llaman a Supabase
// directo, y el guardia que debía crecer con el árbol (`acotada_guardiana.
// test.ts`, una allowlist literal de rutas) no se enteró ni una vez — los
// módulos más nuevos (el MCP entero, `agentes/*`, `marketing/*`,
// `sat_descarga/*`) nunca entraron a ninguna lista.
//
// Migrar los ~240 de golpe es demasiado riesgoso para hacerlo en esta pasada.
// ESTO ES EL MECANISMO DE CONTENCIÓN, NO LA MIGRACIÓN: congela el número
// medido HOY (barriendo `src/` completo, no una lista literal — el error que
// ya mató al guardia anterior) y hace que la suite se ponga roja si el
// conteo SUBE sin que alguien lo note y mueva la constante a mano, con un
// commit que lo explique. Bajarlo (migrar código a `repo.ts`) es bienvenido:
// el techo se ajusta hacia abajo el mismo día.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Medido a mano el 29-ago-2026 (auditoría 21), con el mismo método que la
 * serie de la auditoría: archivos de producción — sin `.test.`/`.fixture.`/
 * `pruebas-manuales` — con al menos un `.from(`/`.rpc(`, SIN contar
 * `repo.ts` ni `pg.ts` (la frontera declarada). Es un TECHO, no un objetivo:
 * si sube, actualiza este número en el mismo commit que explica por qué.
 */
const TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA = 241;

const RAIZ_SRC = new URL('../../', import.meta.url).pathname;

/** La frontera declarada — los dos únicos archivos donde `.from(`/`.rpc(`
 *  directo está permitido sin contar contra el techo. */
const FRONTERA = new Set(['lib/likida/repo.ts', 'lib/likida/pg.ts']);

/** Todos los `.ts`/`.tsx` de `src/`, excluyendo pruebas, fixtures y el
 *  directorio de pruebas manuales — EL BARRIDO, no una lista literal. La
 *  lista literal es exactamente lo que dejó ciego al guardia anterior
 *  (`acotada_guardiana.test.ts` cita esa lección: un módulo nuevo que no se
 *  da de alta a mano no lo ve nadie). */
function fuentesDeProduccion(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'pruebas-manuales') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { fuentesDeProduccion(p, acc); continue; }
    if (!/\.(ts|tsx)$/.test(e)) continue;
    if (/\.test\.tsx?$/.test(e) || /\.fixture\.tsx?$/.test(e)) continue;
    acc.push(p);
  }
  return acc;
}

function tieneAccesoDirecto(ruta: string): boolean {
  return /\.(from|rpc)\(/.test(readFileSync(ruta, 'utf8'));
}

describe('la frontera de datos (repo.ts/pg.ts) — el número medido no puede subir en silencio', () => {
  const archivos = fuentesDeProduccion(RAIZ_SRC)
    .map((p) => relative(RAIZ_SRC, p))
    .filter((rel) => !FRONTERA.has(rel))
    .filter((rel) => tieneAccesoDirecto(join(RAIZ_SRC, rel)))
    .sort();

  it('el barrido encuentra archivos conocidos con acceso directo (si esto falla, el barrido se quedó ciego)', () => {
    // Los dos ejemplos más nuevos que la c21 citó: el MCP OAuth entero nació
    // sin pasar por repo.ts, y el pipeline entrante sigue haciendo `.from(`
    // inline desde hace varias rondas.
    expect(archivos).toContain('lib/mcp/oauth.ts');
    expect(archivos).toContain('lib/likida/processor.ts');
  });

  it(`no hay más de ${TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA} archivos con acceso directo a Supabase fuera de repo.ts/pg.ts`, () => {
    const mensaje = archivos.length > TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA
      ? [
        `El conteo SUBIÓ de ${TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA} a ${archivos.length}.`,
        'Si el crecimiento es real y ya se revisó, sube TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA',
        'en este archivo, en el MISMO commit que lo explica. Si no, alguien metió',
        'una consulta directa nueva por fuera de repo.ts/pg.ts — muévela ahí.',
      ].join('\n')
      : `${archivos.length} de ${TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA} — dentro del techo.`;
    expect(archivos.length, mensaje).toBeLessThanOrEqual(TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA);
  });

  it('si el conteo BAJÓ (código migrado a repo.ts), hay que bajar el techo también', () => {
    // Este test no puede fallar solo — es la nota que explica por qué el de
    // arriba no debe quedarse verde "de sobra": un techo que nunca se ajusta
    // hacia abajo deja de medir nada. Si `archivos.length` queda muy por
    // debajo de TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA por varias rondas, es
    // señal de que el techo quedó obsoleto, no de que el problema mejoró.
    expect(archivos.length).toBeGreaterThan(0);
  });
});
