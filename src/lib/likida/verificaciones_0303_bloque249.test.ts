// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · DATOS-M2 — el sub-chequeo (c) del bloque 249 SÍ puede fallar.
//
// El bloque 249 de `supabase/verificaciones.sql` afirma probar que la 0303
// reescribió las nueve descripciones «teatro», buscando cinco frases de la
// 0125 original. El problema, verificado línea por línea: 0230/0234/0235 YA
// habían reemplazado esas cinco frases meses antes de que la 0303 corriera —
// ninguna descripción vigente al llegar la 0303 las contenía. El sub-chequeo
// pasaba en verde SIN PODER FALLAR NUNCA: hasta si el `CASE WHEN` entero de
// la 0303 se borrara, `con_frase_vieja` seguiría saliendo vacío.
//
// Esta prueba NO consulta Postgres —aquí no hay base—: lee el SQL del bloque
// 249 y el de las migraciones que escriben cada descripción, y comprueba la
// propiedad que le da dientes al sub-chequeo: la frase que se busca para cada
// agente tiene que (a) haber sido de verdad su descripción justo ANTES de la
// 0303 y (b) haber dejado de estarlo DESPUÉS — así, borrar el `CASE WHEN`
// (dejando la descripción vieja) sí dispara la sonda.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VERIFICACIONES = join(process.cwd(), 'supabase', 'verificaciones.sql');
const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations');

/** El bloque 249 completo, delimitado por su título y el `do $$ … end $$;` siguiente. */
function bloque249(): string {
  const sql = readFileSync(VERIFICACIONES, 'utf8');
  const inicio = sql.indexOf('-- ── 249.');
  if (inicio === -1) throw new Error('no se encontró el bloque 249 en verificaciones.sql');
  const fin = sql.indexOf('end $$;', inicio);
  if (fin === -1) throw new Error('no se encontró el cierre `end $$;` del bloque 249');
  return sql.slice(inicio, fin + 'end $$;'.length);
}

/** Los `ids` y `frases_viejas` del bloque, EN EL MISMO ORDEN declarado —
 *  es justo ese emparejamiento posicional lo que la prueba verifica. */
function idsYFrases(): { ids: string[]; frases: string[] } {
  const b = bloque249();
  const mIds = b.match(/ids text\[\]\s*:=\s*array\[([\s\S]*?)\];/);
  const mFrases = b.match(/frases_viejas text\[\]\s*:=\s*array\[([\s\S]*?)\];/);
  if (!mIds) throw new Error('no se encontró `ids text[] := array[...]` en el bloque 249');
  if (!mFrases) throw new Error('no se encontró `frases_viejas text[] := array[...]` en el bloque 249');
  const ids = [...mIds[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  // Cada elemento puede traer un comentario `-- …` al final de línea: se
  // recorta antes de extraer las comillas para no confundir un apóstrofe de
  // comentario con el cierre de la cadena.
  const frases = [...mFrases[1].split('\n')]
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .match(/'((?:[^'\\]|\\.)*)'/g)
    ?.map((s) => s.slice(1, -1)) ?? [];
  return { ids, frases };
}

/** La descripción que `id` tenía justo ANTES de la 0303 — la última que la
 *  recreó entre 0230, 0234 y 0235 (0230 la nombra en el `where id`; para
 *  0234/0235 hay un solo `update … where id = '<id>'` cada una). */
function descripcionAntesDe0303(id: string): string {
  for (const archivo of ['0230_agentes_crecimiento.sql', '0234_agentes_ingenieria.sql', '0235_agentes_direccion_y_leads.sql']) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija, de una lista corta y literal
    const sql = readFileSync(join(MIGRACIONES, archivo), 'utf8');
    const re = new RegExp(`descripcion\\s*=\\s*'((?:[^'\\\\]|\\\\.)*)'[\\s\\S]{0,200}?where id = '${id}';`);
    const m = sql.match(re);
    if (m) return m[1];
  }
  throw new Error(`no se encontró la descripción de '${id}' en 0230/0234/0235`);
}

/** La descripción que la 0303 escribe para `id`, del `case id … end`. */
function descripcionDespuesDe0303(id: string): string {
  const sql = readFileSync(join(MIGRACIONES, '0303_gradua_agentes_experimentales_auditados.sql'), 'utf8');
  const re = new RegExp(`when '${id}' then '((?:[^'\\\\]|\\\\.)*)'`);
  const m = sql.match(re);
  if (!m) throw new Error(`no se encontró la rama '${id}' del CASE WHEN en 0303`);
  return m[1];
}

describe('DATOS-M2 · el sub-chequeo (c) del bloque 249 tiene dientes', () => {
  const { ids, frases } = idsYFrases();

  it('declara una frase por id, en el mismo orden (emparejamiento posicional)', () => {
    expect(frases.length).toBe(ids.length);
  });

  it.each(ids.map((id, i) => [id, frases[i]] as const))(
    "'%s': su frase vieja SÍ estaba en la descripción justo antes de la 0303",
    (id, frase) => {
      const antes = descripcionAntesDe0303(id).toLowerCase();
      expect(
        antes,
        `la frase «${frase}» no aparece en la descripción de '${id}' vigente antes de la 0303 — ` +
          'el sub-chequeo (c) buscaría algo que nunca existió ahí y jamás podría fallar.',
      ).toContain(frase);
    },
  );

  it.each(ids.map((id, i) => [id, frases[i]] as const))(
    "'%s': su frase vieja YA NO está en la descripción que escribe la 0303",
    (id, frase) => {
      const despues = descripcionDespuesDe0303(id).toLowerCase();
      expect(
        despues,
        `la frase «${frase}» SIGUE en la descripción que la 0303 escribe para '${id}' — ` +
          'el sub-chequeo (c) no distinguiría "se reescribió" de "no se tocó".',
      ).not.toContain(frase);
    },
  );
});
