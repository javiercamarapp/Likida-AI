import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 7 · "¿ESTÁ COMPROBADA LA 00XX?" NO PODÍA CONTESTARSE.
//
// `supabase/verificaciones.sql` prueba lo que solo la base puede demostrar:
// índices únicos, claims atómicos, permisos. Es el único sitio del repo donde se
// comprueban garantías que un test con Supabase mockeado no toca —ese prueba el
// mock—. Y no había forma de saber qué migraciones cubría: la respuesta era
// abrir el archivo y contar.
//
// Así se coló la 0030, que es la migración MÁS irónica para colarse: existe
// exactamente porque un chequeo de arranque decía verificar la 0019 y no podía.
// La migración escrita para que un chequeo dejara de mentir se quedó, ella
// misma, sin comprobar.
//
// Al escribir esta lista aparecieron otras TRES —la 0002, la 0011 y la 0012—,
// que es para lo que sirve escribirla. Ahora son los bloques 14, 15 y 16.
//
// Esta prueba no lee SQL ni valida sintaxis. Hace UNA sola cosa: obliga a que
// toda migración nueva tome una decisión explícita —bloque o exención con
// razón— en vez de dejarla al olvido, que es el default de hoy.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = 'supabase/migrations';

/**
 * Los TÍTULOS de los bloques, no el archivo entero.
 *
 * Buscar el número en todo el SQL daba falsos verdes: un bloque puede nombrar
 * media docena de migraciones en su prosa para explicar el contexto —el 14 cita
 * la 0011 y la 0005— sin comprobar ninguna de ellas. El título es donde el autor
 * del bloque DECLARA qué está comprobando, y es lo único que se puede leer como
 * una afirmación.
 *
 * Formato: `-- ── 14. El contador de la barrera (mig. 0011 + 0031) ──────`
 */
const TITULOS = readFileSync('supabase/verificaciones.sql', 'utf8')
  .split('\n')
  .filter((l) => /^-- ── \d+\./.test(l))
  .join('\n');

/**
 * Migraciones que NO necesitan bloque, con la razón de cada una.
 *
 * El criterio: hace falta bloque cuando la migración crea una garantía que la
 * base es la ÚNICA que puede demostrar —unicidad, atomicidad, permisos—. Una
 * columna nueva, un bucket o un índice de velocidad no entran: si faltan, algo
 * revienta ruidosamente o va lento, no se corrompe en silencio.
 */
const EXENTAS: Record<string, string> = {
  '0080': 'columna operador.rfc: dato opcional capturado por la flota. La rama buena de RLISR 57 se prueba en TS (engine/desde_db); si la columna falta, getOperador falla ruidoso.',
  '0082': 'redefine config_tenant_valida con la llave facilidadCombustibleEfectivo: si falta, el alta de flota que declare su régimen revienta con el error del 0026 (ruidoso, no silencioso).',
  '0083': 'redefine config_tenant_valida exigiendo la FORMA de la facilidad: si falta, una config con "sí" en la llave revienta ruidoso en el UPDATE del tenant.',
  '0084': 'RPC sumar_combustible_ejercicio: si falta, getAcumuladoCombustible lanza ruidoso en el primer cuadre (el RPC no existe). El resultado se prueba en TS contra el esquema de migraciones.',
  '0085': 'redefine config_tenant_valida: la 0083 asignaba jsonb a una variable record (crash "anonymous composite types") en cada UPDATE de tenant con la facilidad declarada. El bloque 61 de verificaciones.sql reproduce el escenario exacto (update con facilidad en config).',
  '0001': 'esquema base: si falta, no arranca nada. Un bloque no aporta información que el primer INSERT no dé.',
  '0003': 'tabla de costos de LLM: telemetría. No hay garantía que romper.',
  '0004': 'columna de config fiscal. El bloque 7 (0026) sí comprueba lo que importa: que esa config no pueda apagar un tope de dinero.',
  '0006': 'columnas del complemento de hidrocarburos. Su corrección se prueba en TS contra el XML.',
  '0007': 'columnas de acreditamiento (IVA/IEPS). Los números los prueba el motor, que es puro.',
  '0008': 'bucket de storage. Si falta, la subida falla con un error visible.',
  '0009': 'columnas de XML crudo y EFOS. La retención de CFF 30 se prueba en TS; aquí solo hay dónde guardarlo.',
  '0010': 'columna ocr_extra. El claim que la protege es la 0017, bloque 3.',
  '0014': 'columna img_hash. Su unicidad la ponen la 0015 y la 0027.',
  '0015': 'su índice `uq_gasto_img_hash` lo DROPEA y recrea la 0027, que sí tiene bloque (8). Comprobar el de la 0015 sería comprobar un índice que ya no existe.',
  '0016': 'tabla `codigo_pendiente`. El arranque la sondea leyéndola y su ausencia da error de PostgREST, no corrupción.',
  '0018': 'columnas del aviso de privacidad. Su claim atómico es `marcar_aviso_privacidad`, que sí tiene prueba en TS con el RPC real mockeado — y la constancia falsa, que es el riesgo, se prueba en `aviso_constancia.test.ts`.',
  '0020': 'columna `demora_no_imputable`. El que se leyera o no es un bug de SELECT, ya cerrado y probado en TS.',
  '0021': 'litros de diésel en la liquidación. La firma ambigua que dejó es lo peligroso, y ESO es el bloque 5 (0022).',
  '0023': 'índice de velocidad para el acumulado del ejercicio. Sin él la consulta va lenta; no cambia ningún número.',
  '0034': 'columna nullable `tenant.contacto_privacidad` (art. 29). Si falta, el aviso integral marca esa sección como pendiente — que es su comportamiento con la columna vacía, así que no hay garantía que la base pueda romper. El contenido se prueba en `aviso_integral.test.ts`.',
  '0035': 'solo `alter function ... set search_path`, y las diez son SECURITY INVOKER: no hay escalada que comprobar. Lo que sí se comprueba —que ninguna RPC interna sea ejecutable por `anon`— es el bloque 18.',
  '0032': 'solo `comment on table`. No hay garantía que comprobar: lo que fija —que nadie lea `politica_gasto`— se prueba en `politica_un_origen.test.ts`, que sí puede mirar el código.',
  '0038': 'creaba `foto_pendiente`, revertida por la 0041 (AUDITORÍA 9, CRÍTICO: fusionaba comprobantes distintos). El bloque 21 que la comprobaba se retiró junto con la tabla — no queda nada que verificar.',
  '0041': '`drop table foto_pendiente`. Reversión de la 0038; no hay garantía nueva que comprobar, la ausencia de la tabla la confirma cualquier consulta a `information_schema` y no vale la pena un bloque para eso.',
  '0044': 'extiende el dominio de app_user_rol_dominio con un valor más (encargado). La garantía de que basura sigue rechazada ya la prueba el bloque 11 (0025); que "encargado" se acepta se prueba en TS (provisionar.test.ts).',
};

const migraciones = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({ num: f.slice(0, 4), archivo: f }))
  .sort((a, b) => a.num.localeCompare(b.num));

describe('toda migración está comprobada o exenta a propósito', () => {
  it('hay migraciones y hay títulos que leer', () => {
    // Sin estas dos, todo lo de abajo pasaría por vacío: cero migraciones no
    // deja huérfanas, y cero títulos las deja todas — pero el mensaje de fallo
    // apuntaría al sitio equivocado.
    expect(migraciones.length).toBeGreaterThan(25);
    expect(TITULOS.split('\n').length).toBeGreaterThan(10);
  });

  it('ninguna se queda sin decisión', () => {
    const huerfanas = migraciones
      .filter(({ num }) => !EXENTAS[num])
      .filter(({ num }) => !new RegExp(`\\b${num}\\b`).test(TITULOS))
      .map(({ archivo }) => archivo);

    expect(
      huerfanas,
      `estas migraciones no tienen bloque en supabase/verificaciones.sql ni una razón en EXENTAS:\n  ${huerfanas.join('\n  ')}\n\n` +
      'Escribe el bloque, o añade la migración a EXENTAS con la razón. Lo que no vale es dejarla sin decidir: ' +
      'así se coló la 0030, que existe justamente porque un chequeo decía verificar algo que no verificaba.',
    ).toEqual([]);
  });

  it('y ninguna exención sobra', () => {
    // Una exención de una migración que ya no existe es una razón que nadie va a
    // volver a leer y que hace parecer cubierto lo que no está.
    const numeros = new Set(migraciones.map((m) => m.num));
    const fantasmas = Object.keys(EXENTAS).filter((n) => !numeros.has(n));
    expect(fantasmas, `EXENTAS nombra migraciones que ya no existen: ${fantasmas.join(', ')}`).toEqual([]);
  });

  it('una exención sin razón no es una exención', () => {
    const vacias = Object.entries(EXENTAS).filter(([, razon]) => razon.trim().length < 20);
    expect(vacias.map(([n]) => n), 'estas exenciones no explican por qué').toEqual([]);
  });
});
