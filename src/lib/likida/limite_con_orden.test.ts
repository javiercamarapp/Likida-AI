import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  sitiosDeLimite, sitiosDe, deudaPorArchivo, cumple, esDesempate,
} from '@/lib/pruebas/consultas';

// ═══════════════════════════════════════════════════════════════════════════
// `.limit(N)` SIN `.order()` NO DEVUELVE "LOS N PRIMEROS". DEVUELVE N CUALESQUIERA.
//
// Es el Bug 4 del catálogo de bugs característicos de `agente-auditor-de-codigo.md`,
// y el propio catálogo señalaba esta red como el trabajo mejor definido que
// quedaba pendiente. Esta semana el bug volvió a morder (hallazgo c7-4): un
// top-5 de plazas se calculó sobre una rebanada de 5,000 filas de 33,071 sin
// `order`, y TRES de las cinco plazas reales desaparecieron del parte. Nadie
// vio un error: vio un parte con cinco plazas, bien formateado, con las plazas
// equivocadas. Ése es el modo de falla de esta clase entera — no truena, MIENTE.
//
// El mismo patrón sigue vivo aquí y se puede señalar con el dedo:
// `agentes/leads.ts` → `leerAvanzados()` trae `.limit(TOPE_PROSPECTOS)` (5,000)
// SIN `.order()`, y de ahí sale el «perfil que convierte». El comentario de esa
// función razona con cuidado por qué NO comparte consulta con el censo… y no
// dice una palabra sobre qué 5,000 filas son ésas.
//
// POR QUÉ NO BASTA CON `.order()` A SECAS. Postgres no promete nada dentro de un
// empate. `.order('created_at')` sobre una tabla donde 40 filas comparten
// segundo, con el corte de `N` a la mitad de ese grupo, sigue dando conjuntos
// distintos en dos corridas seguidas. Lo que hace determinista un corte es un
// DESEMPATE TOTAL, y el único que siempre existe es la llave: `.order('id')`
// como último criterio.
//
// ─── LO QUE ESTA RED HACE, Y LO QUE NO ────────────────────────────────────
//
// NO exige arreglar los 213 sitios que ya existen. Es un TRINQUETE, igual que
// `lint-ratchet.mjs` con los avisos de ESLint y que `vitest.config.ts` con la
// cobertura: la deuda medida queda congelada en `ci/limite-sin-orden-baseline.json`
// y sólo puede BAJAR. Un `.limit()` nuevo sin desempate no entra.
//
// La salida es una de dos, y las dos son baratas:
//   1. añadir `.order('id')` (o `.order('col', …).order('id')`) al final, o
//   2. declararlo: `// orden-no-importa: <razón de verdad>` en la línea o en las
//      6 de arriba. Se exigen ≥25 caracteres a propósito: "no importa" no es una
//      razón, y una marca que se pone sin pensar convierte la red en un trámite.
//
// El caso legítimo más común es `.eq('id', x).limit(1).maybeSingle()`: ahí el
// filtro ya deja una fila y el orden da igual. Está bien — pero se DICE, porque
// el que lo lee dentro de un año no puede distinguirlo del bug sin que alguien
// lo haya escrito.
// ═══════════════════════════════════════════════════════════════════════════

interface Baseline { version: number; total: number; porArchivo: Record<string, number> }

const BASELINE: Baseline = JSON.parse(readFileSync('ci/limite-sin-orden-baseline.json', 'utf8'));

const SITIOS = sitiosDeLimite();
const DEUDA = deudaPorArchivo(SITIOS);

const AYUDA =
  'Un `.limit(N)` sin desempate total no devuelve "los N primeros": devuelve N filas cualesquiera, ' +
  'y el agregado que salga de ahí es una cifra falsa bien formateada (hallazgo c7-4: 3 de 5 plazas ' +
  'desaparecidas de un top-5).\n' +
  'Arréglalo de una de estas dos formas:\n' +
  "  · `.order('id')` al final (o `.order('col', { ascending: false }).order('id')`), o\n" +
  '  · declara por qué el orden no cambia el resultado ahí:\n' +
  '      // orden-no-importa: filtra por `id` exacto, la consulta ya deja una sola fila\n' +
  '    (≥25 caracteres de razón; se busca en la línea y en las 6 de arriba)';

describe('ningún `.limit()` NUEVO se queda sin desempate', () => {
  it('ningún archivo pasa de su deuda congelada', () => {
    const crecieron = Object.entries(DEUDA)
      .filter(([f, n]) => n > (BASELINE.porArchivo[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} ahora vs ${BASELINE.porArchivo[f] ?? 0} en el baseline`);

    expect(crecieron, `Entró un \`.limit()\` sin desempate.\n${AYUDA}\n\nArchivos:\n  ` + crecieron.join('\n  '))
      .toEqual([]);
  });

  it('el trinquete aprieta: lo que se arregló baja del baseline', () => {
    // Sin esto la deuda quedaría congelada para siempre y arreglar dos sitios
    // dejaría hueco para dos nuevos. Es UNA línea de JSON, y hace que la mejora
    // se vea en el diff del PR en vez de perderse.
    const bajaron = Object.entries(BASELINE.porArchivo)
      .filter(([f, n]) => (DEUDA[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${DEUDA[f] ?? 0} ahora, el baseline todavía dice ${n}`);

    expect(
      bajaron,
      'Se arreglaron sitios y el baseline no se enteró. Baja el número (o borra la entrada si llegó a 0) ' +
      'en `ci/limite-sin-orden-baseline.json`:\n  ' + bajaron.join('\n  '),
    ).toEqual([]);
  });

  it('el total del baseline es la suma de sus partes', () => {
    const suma = Object.values(BASELINE.porArchivo).reduce((a, b) => a + b, 0);
    expect(suma, 'el `total` del baseline se quedó atrás de `porArchivo`').toBe(BASELINE.total);
    expect(SITIOS.filter((s) => !cumple(s)).length).toBe(BASELINE.total);
  });
});

describe('el barrido no está ciego', () => {
  it('encuentra los `.limit()` de verdad del repo, y algunos SÍ cumplen', () => {
    // Un extractor que devolviera [] haría pasar todo lo de arriba en silencio,
    // y uno que marcara TODO como incumplidor sería igual de inútil: nadie
    // distinguiría el arreglo del ruido.
    expect(SITIOS.length).toBeGreaterThan(200);
    expect(SITIOS.filter(cumple).length).toBeGreaterThan(5);
  });

  it('el caso que motivó la red sigue señalado con el dedo', () => {
    // `leerAvanzados()` en `agentes/leads.ts`: `.limit(5000)` sin `.order()`, y
    // de ahí sale el «perfil que convierte». Si alguien lo arregla, esta prueba
    // falla y hay que bajar el baseline — que es exactamente el trinquete
    // apretando. No se arregla desde aquí: tocar una consulta de negocio es
    // trabajo con dueño, no un efecto secundario de escribir la red.
    const enLeads = SITIOS.filter((s) => s.archivo.endsWith('agentes/leads.ts') && !cumple(s));
    expect(enLeads.length, 'si esto llegó a 0, baja `agentes/leads.ts` del baseline').toBeGreaterThan(0);
  });

  const CASOS: Array<[string, string, boolean]> = [
    [
      'el patrón del c7-4: rebanada grande sin orden ninguno',
      "await db.from('prospecto').select('estado, ciudad').limit(5000);",
      false,
    ],
    [
      'orden por una columna con empates, sin desempatar',
      "await db.from('viaje').select('*').order('created_at', { ascending: false }).limit(50);",
      false,
    ],
    [
      'orden por columna + desempate por id: determinista',
      "await db.from('viaje').select('*').order('created_at', { ascending: false }).order('id').limit(50);",
      true,
    ],
    [
      'orden por id a secas: ya es un orden total',
      "await db.from('viaje').select('*').order('id').limit(50);",
      true,
    ],
    [
      'desempate por una llave ajena (`tenant_id` no, `prospecto_id` sí)',
      "await db.from('correo').select('*').order('prospecto_id').limit(10);",
      true,
    ],
    [
      'la declaración a mano exime, con razón de verdad',
      "// orden-no-importa: filtra por `id` exacto, la consulta ya deja una sola fila\n" +
      "await db.from('viaje').select('*').eq('id', id).limit(1).maybeSingle();",
      true,
    ],
    [
      'una declaración vacía NO exime',
      "// orden-no-importa: da igual\nawait db.from('viaje').select('*').limit(1);",
      false,
    ],
    [
      'el `.order()` dentro de un objeto multilínea no rompe la cadena',
      "await db.from('viaje')\n  .select('*')\n  .order('vence_en', { ascending: true, nullsFirst: false })\n  .order('id')\n  .limit(20);",
      true,
    ],
    [
      'un `.limit()` citado en un COMENTARIO no cuenta',
      "// antes esto era `.limit(5000)` y se recortaba a 1,000\nconst x = 1;",
      true, // no hay sitios: `every` sobre lista vacía es true
    ],
  ];

  it.each(CASOS)('%s', (_nombre, muestra, esperado) => {
    const sitios = sitiosDe('muestra.ts', muestra);
    expect(sitios.every(cumple)).toBe(esperado);
  });
});

describe('qué cuenta como desempate', () => {
  it.each([['id', true], ['prospecto_id', true], ['viaje.id', true], ['created_at', false], ['nombre', false], ['identidad', false]])(
    '%s → %s',
    (columna, esperado) => {
      expect(esDesempate(columna as string)).toBe(esperado);
    },
  );
});
