import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 23 · SEG-1 / LEG-C1 (CRÍTICO) — EL `search_path` QUE SE REVIRTIÓ
// SOLO, Y QUE CI NO PUEDE VER.
//
// `ejecutar_arco_cancelacion` llama `digest()` sin calificar (0273:70 y :124).
// `digest()` la aporta `pgcrypto`, y en Supabase GESTIONADO pgcrypto vive en el
// esquema `extensions`. Sin `extensions` en el `search_path` de la función, la
// llamada truena SIEMPRE con:
//
//     ERROR: 42883: function digest(text, unknown) does not exist
//
// La 0264 (28-ago) encontró eso verificándolo EN VIVO contra producción y lo
// cerró extendiendo el search_path a `public, extensions, pg_catalog`.
//
// Dos días después la 0273 volvió a hacer `create or replace` de la misma
// función para cerrar LEG-A4, declarando en su cabecera «ESTA MIGRACIÓN PARTE
// DEL CUERPO DE LA 0262, VERBATIM». La 0262 es la versión ANTERIOR a la 0264:
// al copiar el cuerpo bueno se copió también la cabecera mala y `extensions`
// desapareció. El derecho de cancelación ARCO quedó inejecutable en producción.
//
// ── POR QUÉ ESTA PRUEBA VIVE EN TS Y NO EN `verificaciones.sql` ────────────
// Porque el bloque 210 de `verificaciones.sql` YA llama la función de verdad,
// espera `ok=t`, y **pasa en verde con el defecto puesto**: corre sobre el
// Postgres local de CI, donde `andamio_ci.sql` deja que la 0001 instale
// pgcrypto en `public`, así que `digest()` sin calificar sí resuelve ahí. Es
// literalmente el mismo punto ciego que la 0264 documentó en su día. Una
// prueba que solo puede correr donde el bug no se manifiesta no es una prueba.
//
// Y el bloque E de `capa1_auditoria_estatica.sql` tampoco lo ve: comprueba que
// exista *algún* `search_path=` en `proconfig`, nunca su contenido.
//
// Así que lo que se comprueba aquí es la propiedad estática que sí se puede
// leer sin base: **la ÚLTIMA definición vigente de una función que llama a
// `digest()` sin calificar tiene que traer `extensions` en su `search_path`.**
// No se ancla a la 0273 a propósito — se ancla a «la última», que es la que
// gana en producción. La próxima migración que vuelva a hacer `create or
// replace` partiendo de un cuerpo viejo cae aquí igual.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = 'supabase/migrations';

const FUNCION = 'ejecutar_arco_cancelacion';

const archivos = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b));

type Definicion = { archivo: string; searchPath: string | null; calificaDigest: boolean };

/**
 * Las migraciones que redefinen la función, en orden de aplicación.
 *
 * Cuenta tanto `create or replace function` (redefine cuerpo Y cabecera) como
 * `alter function ... set search_path` (toca solo la cabecera, que es el
 * mecanismo que usó la 0247 y el que menos riesgo tiene).
 */
function definiciones(): Definicion[] {
  const salida: Definicion[] = [];
  for (const archivo of archivos) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- lee las migraciones del propio repo en tiempo de prueba; el nombre sale de readdirSync sobre la constante DIR, no de ninguna entrada de usuario.
    const sql = readFileSync(`${DIR}/${archivo}`, 'utf8');
    if (!sql.includes(FUNCION)) continue;

    const creaRe = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${FUNCION}\\b`, 'i');
    const alteraRe = new RegExp(`alter\\s+function\\s+(?:public\\.)?${FUNCION}\\b[^;]*?set\\s+search_path\\s*=\\s*([^;\\n]+)`, 'is');

    const alterada = alteraRe.exec(sql);
    if (alterada) {
      salida.push({ archivo, searchPath: alterada[1].trim(), calificaDigest: false });
      continue;
    }

    if (!creaRe.test(sql)) continue;

    // El `set search_path` del encabezado: entre el `create or replace` y el `as $$`.
    const desde = sql.search(creaRe);
    const cuerpoDesde = sql.indexOf('$$', desde);
    const encabezado = sql.slice(desde, cuerpoDesde === -1 ? undefined : cuerpoDesde);
    const sp = /set\s+search_path\s*=\s*([^\n;]+)/i.exec(encabezado);

    // ¿El cuerpo llama a `digest()` sin calificar con su esquema?
    const cuerpo = cuerpoDesde === -1 ? sql.slice(desde) : sql.slice(cuerpoDesde);
    const calificaDigest = !/(?<!\.)\bdigest\s*\(/i.test(cuerpo);

    salida.push({ archivo, searchPath: sp ? sp[1].trim() : null, calificaDigest });
  }
  return salida;
}

describe('el search_path de ejecutar_arco_cancelacion (auditoría 23, SEG-1)', () => {
  it('hay definiciones que leer', () => {
    // Sin esto, un renombre de la función dejaría la prueba pasando por vacío:
    // cero definiciones no tiene ninguna mala, y el rubro se quedaría ciego
    // justo donde este bug ya entró dos veces.
    const defs = definiciones();
    expect(defs.length, `ninguna migración define ${FUNCION}; ¿se renombró?`).toBeGreaterThan(1);
  });

  it('la ÚLTIMA definición vigente resuelve digest() en Supabase gestionado', () => {
    const defs = definiciones();
    const ultima = defs[defs.length - 1];

    // Si la última definición califica la llamada (`extensions.digest(...)`) no
    // necesita el esquema en el search_path. Hoy no es el caso, y la 0264 dejó
    // escrito por qué no se tomó ese camino: en el Postgres LOCAL de CI la
    // extensión vive en `public`, así que calificar arreglaría producción
    // rompiendo CI. Extender el search_path resuelve en los dos entornos.
    if (ultima.calificaDigest) return;

    expect(
      ultima.searchPath,
      `${ultima.archivo} redefine ${FUNCION} sin ningún \`set search_path\`.`,
    ).not.toBeNull();

    expect(
      ultima.searchPath,
      `${ultima.archivo} deja ${FUNCION} con \`search_path = ${ultima.searchPath}\`, sin \`extensions\`.\n\n` +
      'En Supabase gestionado pgcrypto vive en el esquema `extensions`: sin él, la llamada sin\n' +
      'calificar a digest() truena SIEMPRE con «function digest(text, unknown) does not exist», y\n' +
      'la cancelación ARCO falla antes de tocar una sola tabla. El titular no puede ejercer su\n' +
      'derecho y la flota no puede cumplir.\n\n' +
      'Esto ya lo arregló la 0264. Si esta prueba está roja es porque una migración posterior\n' +
      'volvió a hacer `create or replace` partiendo del cuerpo de una versión ANTERIOR al arreglo,\n' +
      'y se llevó la cabecera vieja con él. El bloque 210 de verificaciones.sql NO lo atrapa: en el\n' +
      'Postgres local de CI pgcrypto está en `public` y digest() resuelve igual.',
    ).toMatch(/\bextensions\b/);
  });
});
