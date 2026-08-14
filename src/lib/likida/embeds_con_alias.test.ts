import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fuentesDeProduccion, sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// EL EMBED A SECAS SE VOLVIÓ AMBIGUO Y NADA DEL ARNÉS PODÍA VERLO. 14-AGO-2026.
//
// La FK compuesta anti-cross-tenant (patrón 0028/0073, validada en la 0075)
// dejó DOS relaciones entre 5 pares de tablas: viaje↔operador, gasto→viaje,
// liquidacion→viaje, codigo_pendiente→viaje y comprobante_huerfano→operador.
// Desde entonces, un embed de PostgREST escrito a secas — `operador(nombre)` —
// es ambiguo y el servidor lo rechaza con "more than one relationship" EN
// RUNTIME, contra el esquema vivo. Ni `tsc`, ni el build, ni un mock de
// supabase-js lo pueden ver: los mocks aceptan cualquier string de `.select()`.
//
// El 14-ago-2026 se pagó tres veces en producción (commits `2e59040` y
// `566a962`): la página del agente de cobranza caía entera al error boundary,
// y el cron de escalación y el aviso de cierre llevaban rotos EN SILENCIO —
// nadie lo vio hasta ese día. Los tres se arreglaron anclando el embed a su
// columna (`operador:operador_id(...)`), y la suite siguió verde ANTES y
// DESPUÉS: la clase de bug que más dolió esa semana era invisible al arnés.
//
// LO QUE ESTA PRUEBA PRUEBA Y LO QUE NO. Es un escaneo de fuente, como
// `dinero_por_area` y `tope_consulta`: si un `.select()` de producción embebe
// una tabla de los 5 pares sin anclarla a su columna, esto se pone rojo con el
// archivo y el pedazo exacto. NO habla con PostgREST ni valida que la columna
// del alias exista — eso solo lo sabe el esquema vivo. Sirve para el caso que
// ya pasó tres veces: revertir un alias o escribir el embed nuevo sin él.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Las tablas que participan en un par con DOBLE FK (0028/0073/0075). Un embed
 * hacia cualquiera de ellas, en cualquier dirección del par, es ambiguo sin
 * ancla. Si una migración futura le da doble FK a otro par, su tabla se agrega
 * aquí — y si se le quita la doble FK a uno, se saca, no se afloja el patrón.
 */
const TABLAS_DOBLE_FK = [
  'operador',
  'viaje',
  'gasto',
  'liquidacion',
  'codigo_pendiente',
  'comprobante_huerfano',
];

/**
 * El embed ambiguo: la tabla seguida de `(` — `operador(nombre)` — o con solo
 * el hint de join — `operador!inner(...)` —, que tampoco desambigua. El
 * lookbehind deja pasar `operador_id(` y `crearViaje(` (otra palabra) pero NO
 * deja pasar `foo:operador(`: un alias que apunta a la tabla a secas renombra
 * la salida y sigue siendo ambiguo. La forma anclada es `alias:columna(...)`
 * — `operador:operador_id(` — donde la columna FK decide la relación.
 */
const SIN_ALIAS = new RegExp(
  String.raw`(?<![\w.$])(?:${TABLAS_DOBLE_FK.join('|')})(?:!(?:inner|left))?\(`,
  'g',
);

/** La forma anclada, para contar que el escaneo está mirando embeds reales. */
const CON_ALIAS = new RegExp(
  String.raw`(?<![\w.$])(?:${TABLAS_DOBLE_FK.join('|')}):[A-Za-z_]+\(`,
  'g',
);

/**
 * Se escanea el archivo ENTERO (sin comentarios) y no solo los literales de
 * `.select(...)`: varios módulos arman sus columnas en una constante
 * (`COLUMNAS` en fiscal.ts y al_vuelo.ts) y la pasan por variable — un
 * extractor de literales dentro de `.select(` no las vería nacer.
 */
function embedsSinAlias(fuente: string): string[] {
  return [...sinComentarios(fuente).matchAll(SIN_ALIAS)].map((m) => m[0]);
}

const ARCHIVOS = fuentesDeProduccion('src');

describe('los embeds sobre pares con doble FK llevan ancla :columna', () => {
  it('ningún .select() de producción embebe una tabla de doble FK a secas', () => {
    const hallazgos = ARCHIVOS.flatMap((archivo) => {
      const fuente = readFileSync(archivo, 'utf8');
      return embedsSinAlias(fuente).map((m) => `${archivo}: «${m}»`);
    });
    expect(
      hallazgos,
      `Embeds ambiguos sobre tablas con doble FK:\n  ${hallazgos.join('\n  ')}\n\n` +
        'PostgREST los rechaza en runtime con "more than one relationship" — la página cae al ' +
        'error boundary o el cron se rompe en silencio (pasó el 14-ago-2026, tres veces). ' +
        "Ancla el embed a su columna: `operador:operador_id(...)`, `viaje:viaje_id(...)`.",
    ).toEqual([]);
  });

  it('hay embeds anclados que contar (si no, el escaneo no está mirando nada)', () => {
    // El 14-ago-2026 eran 20 (tabla completa en docs/auditoria-3/datos.md). El
    // piso va holgado para que un refactor legítimo no lo tire, pero si el
    // conteo se desploma es que el regex dejó de ver los selects — la misma
    // ceguera silenciosa que esta red existe para impedir.
    const total = ARCHIVOS.reduce(
      (n, archivo) =>
        n + [...sinComentarios(readFileSync(archivo, 'utf8')).matchAll(CON_ALIAS)].length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(12);
  });

  it('los tres sitios que se pagaron en producción siguen anclados', () => {
    // Los tres arreglos del 14-ago-2026, por nombre. Si la consulta se muda de
    // archivo, esta lista se actualiza — no se borra: es el registro de dónde
    // dolió.
    for (const archivo of [
      'src/lib/likida/agentes/cobranza.ts',
      'src/lib/likida/escalar_viaje.ts',
      'src/lib/likida/avisar_cierre.ts',
    ]) {
      expect(
        sinComentarios(readFileSync(archivo, 'utf8')),
        `${archivo} perdió su embed anclado operador:operador_id(...)`,
      ).toMatch(/operador:operador_id\(/);
    }
  });

  // El detector se valida contra el bug REAL: las dos líneas rotas de
  // `git show 2e59040^` (la versión que tumbó producción). Un detector sin
  // control positivo es la red de A2: internamente consistente y ciega.
  it('control positivo: las líneas pre-fix del 2e59040 se atrapan', () => {
    const rotas = [
      ".select('id, folio, fecha_inicio, recordatorio_comprobacion_en, operador(nombre, telefono)')",
      ".select('tier, enviado, detalle, created_at, viaje:viaje_id(folio, operador(nombre))')",
      ".select('folio, foo:operador(nombre)')", // alias a la tabla a secas: sigue ambiguo
      ".select('id, operador!inner(nombre)')", // hint de join: tampoco desambigua
    ];
    for (const linea of rotas) {
      expect(embedsSinAlias(linea), `no atrapó: ${linea}`).not.toEqual([]);
    }
  });

  it('control negativo: la forma anclada y las no-embeds pasan limpias', () => {
    const sanas = [
      ".select('id, folio, operador:operador_id(nombre, telefono)')",
      ".select('tier, viaje:viaje_id(folio, operador:operador_id(nombre))')",
      ".select('id, viaje_id, operador_id, tenant_id')", // columnas, no embeds
      'const v = crearViaje(datos);', // otra palabra que termina igual
      ".select('id, flota:tenant_id(nombre)')", // tenant no está en un par doble
    ];
    for (const linea of sanas) {
      expect(embedsSinAlias(linea), `falso positivo en: ${linea}`).toEqual([]);
    }
  });
});
