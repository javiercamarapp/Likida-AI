import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32, CONTINUACIÓN 13 · ARQ-32C13-A2 (ALTO).
//
// EL GUARDIA QUE YA EXISTÍA PARA UNA SOLA SEDE, APLICADO A TODAS.
//
// `fiscal_agregado_15pct.test.ts:54-87` inventó la pieza correcta: no teclear
// la ruta de la migración, DERIVARLA («la migración viva es la última, en
// orden, que define la RPC») y además afirmar que no existe ninguna posterior
// que la redefina. Su cabecera cuenta por qué: la ruta estaba tecleada y el
// guardia pasó dos rondas validando una definición que la base ya no ejecutaba.
//
// Estaba cableado a UNA de las sedes. Lo que pasó en la ventana entre la
// continuación 12 y la 13 es exactamente lo que esa pieza existe para impedir,
// en otra sede y sin guardia:
//
//   · la c12 arregló el desempate del dedup en `gastos_fiscales_agregados_
//     tenant` (la 0368 de esa rama, hoy renumerada a 0702): entre dos fotos del
//     mismo ticket sobrevive la LEGIBLE, no la primera que llegó;
//   · `master` siguió solo y la 0688 REESCRIBIÓ esa misma RPC por rendimiento
//     partiendo de la 0367 —la definición SIN el desempate— declarando en su
//     propia cabecera «la salida es byte a byte la de la 0367»;
//   · la suite quedó VERDE porque nada comparaba la definición viva contra el
//     invariante que debía conservar. El panel del contador volvió a publicar
//     «IVA $0 · sin CFDI» de un ticket timbrado con $344.83.
//
// Una reescritura por rendimiento de UNA sede revirtió, en silencio, un arreglo
// fiscal CRÍTICO de otra rama. Eso es lo que este archivo impide que se repita.
//
// CÓMO ENCUENTRA LAS SEDES, y es la parte que importa: no hay lista tecleada de
// funciones. Se busca el marcador `uuids_en_grupo` —el CTE del censo de UUID
// que define la regla del par mixto, y que SÓLO aparece en las sedes del
// dedup— y de ahí se derivan los nombres de las RPC. Una sede nueva que copie
// la regla entra sola a este guardia; una que no la copie no es una sede.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = 'supabase/migrations';
const MARCADOR = 'uuids_en_grupo';

/**
 * Las sedes EXCEPTUADAS, con su razón escrita. La lista es corta a propósito:
 * agregar una obliga a venir aquí y escribir por qué, que es el único momento
 * en que alguien se detiene a pensarlo.
 */
const EXCEPCIONES: Record<string, string> = {
  guardar_liquidacion_tx:
    'El `order by created_at, id` de la 0366:194 sólo alimenta '
    + '`sum(monto) filter (where rn = 1)`, y `monto` está DENTRO de la llave de '
    + 'partición: las dos copias de un par mixto lo traen idéntico POR '
    + 'CONSTRUCCIÓN, así que la elección de sobreviviente no puede mover '
    + '`v_total`. Es una divergencia FORMAL sin consecuencia medible, y tocar el '
    + 'motor de dinero sin un caso que la distinga es cómo se introducen los bugs '
    + 'de la ronda siguiente. Decidido y escrito en la cabecera de la 0702.',
};

/** El SQL sin comentarios: una cabecera que CITA `order by created_at` no es código. */
function soloCodigo(sql: string): string {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}

const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas derivadas del propio repo, no de entrada externa
const leer = (f: string): string => readFileSync(`${DIR}/${f}`, 'utf8');

/** Las RPC que alguna migración define CON la regla del par mixto. */
function sedesDelDedup(): string[] {
  const nombres = new Set<string>();
  for (const f of ARCHIVOS) {
    const sql = leer(f);
    if (!sql.includes(MARCADOR)) continue;
    for (const m of sql.matchAll(/function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) nombres.add(m[1].toLowerCase());
  }
  return [...nombres].sort();
}

/** La migración VIVA de una RPC: la última, en orden, que la define. */
function vigente(rpc: string): { archivo: string; sql: string } {
  const definen = ARCHIVOS.filter((f) => new RegExp(`function\\s+(public\\.)?${rpc}\\s*\\(`, 'i').test(leer(f)));
  const ultima = definen.at(-1);
  if (ultima === undefined) throw new Error(`ninguna migración define \`${rpc}\``);
  return { archivo: ultima, sql: leer(ultima) };
}

/** Los `order by` del CÓDIGO que ordenan por `created_at` (los del desempate). */
function desempatesPorLlegada(sql: string): string[] {
  return [...soloCodigo(sql).matchAll(/order\s+by\s+[^;)\n]*created_at[^;)\n]*/gi)].map((m) => m[0].trim());
}

describe('ARQ-32C13-A2 · todas las sedes del dedup conservan el desempate por copia legible', () => {
  const sedes = sedesDelDedup();

  it('encuentra las sedes por el marcador, y son las que se esperan (si no, el guardia se volvió ciego)', () => {
    // Sin esta aserción el archivo puede pasar verde habiendo encontrado CERO
    // sedes —por un cambio de nombre del CTE— que es justo el modo de falla que
    // el guardia hermano documentó de sí mismo.
    expect(sedes).toContain('sumar_combustible_ejercicio');
    expect(sedes).toContain('gastos_fiscales_agregados_tenant');
    expect(sedes).toContain('guardar_liquidacion_tx');
    expect(sedes.length).toBeGreaterThanOrEqual(3);
  });

  it('la lista de excepciones es exactamente la decidida, con su razón escrita', () => {
    // Una excepción nueva no se cuela: hay que venir aquí, nombrarla y explicar
    // por qué la elección de sobreviviente no puede mover una cifra.
    expect(Object.keys(EXCEPCIONES)).toEqual(['guardar_liquidacion_tx']);
    for (const [rpc, razon] of Object.entries(EXCEPCIONES)) {
      expect(sedes, `\`${rpc}\` está exceptuada pero ya no es una sede del dedup: borra la excepción`).toContain(rpc);
      expect(razon.length, `la excepción de \`${rpc}\` necesita una razón escrita, no una línea`).toBeGreaterThan(120);
    }
  });

  it.each(sedesDelDedup().filter((r) => !(r in EXCEPCIONES)))(
    'la definición VIVA de `%s` desempata por `sin_forma_pago_util`, no por orden de llegada',
    (rpc) => {
      const { archivo, sql } = vigente(rpc);
      const desempates = desempatesPorLlegada(sql);
      expect(desempates.length, `${archivo}: \`${rpc}\` ya no tiene un desempate por \`created_at\`; revisa si la regla cambió`).toBeGreaterThan(0);
      for (const d of desempates) {
        expect(d, `${archivo} define \`${rpc}\` y su desempate «${d}» NO antepone \`sin_forma_pago_util\`: `
          + 'entre dos fotos del mismo ticket sobrevive la que llegó primero, que es SIEMPRE la ilegible '
          + '(el producto guarda la foto antes de pedir la refoto). Es el daño de FIS-32C13-C1 / FIS-32C12-C1.')
          .toMatch(/sin_forma_pago_util/i);
      }
    },
  );

  it('el motor en TS elige por el mismo criterio que el SQL', () => {
    // La cuarta sede no es SQL. Si el motor se queda con «la primera del
    // arreglo», el PDF y el panel publican IVA distinto del mismo ticket —que
    // es lo que midió la continuación 12.
    const engine = readFileSync('src/lib/likida/cuadre/engine.ts', 'utf8');
    expect(engine, '`copiasDeComprobante` tiene que seguir calculando `sinFormaPagoUtil`').toMatch(/const sinFormaPagoUtil = \(g: Gasto\)/);
    expect(engine, 'y tiene que ELEGIR con él, no sólo calcularlo')
      .toMatch(/sinFormaPagoUtil\(g\)\s*<\s*sinFormaPagoUtil\(sobreviviente\)/);
  });
});
