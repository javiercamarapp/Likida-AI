#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// GUARDA — repair_migrations SOLO puede marcar "applied" migraciones que de
// verdad ya corrieron y quedaron mal anotadas por el desajuste de nombres
// (timestamp remoto vs prefijo NNNN local). `supabase migration repair`
// nunca ejecuta SQL (confirmado por su propia documentación: "updates the
// tracking table only") — así que si algo en la lista de bookkeeping NO
// corrió de verdad, marcarlo "applied" es un sello de goma: el esquema real
// se queda sin ese cambio y la compuerta de migraciones (`compuerta-deploy.mjs`)
// lo da por hecho para siempre.
//
// AUDITORÍA 25, ALTO — pasó de verdad: `migraciones-huerfanas-local.txt`
// incluía 0302 y 0303, dos migraciones que NUNCA se habían aplicado (nacieron
// 5 horas DESPUÉS de que `APLICAR-EN-PRODUCCION.md` declarara aplicado hasta
// 0301). El job las habría marcado "applied" sin correr su SQL.
//
// La regla, en vez de confiar en que quien arme la lista se acuerde: ninguna
// entrada de `migraciones-huerfanas-local.txt` puede estar por ENCIMA del
// techo que `supabase/APLICAR-EN-PRODUCCION.md` declara como "ya aplicado".
// Eso es exactamente lo que distingue "corrió y quedó mal anotado" (por
// definición, por debajo del techo documentado) de "nunca corrió" (nace
// después de ese techo). Si el techo no se puede leer, FALLA CERRADO: un
// techo que no se pudo leer no es un techo que dé permiso.
import { readFileSync } from 'node:fs';

/** El número más alto del rango "ya aplicadas" que declara el documento, o
 *  `null` si no se pudo leer/parsear (fail closed: no hay techo). */
export function techoDeclarado(textoDoc) {
  const m = /\*\*\s*(\d{4})\s*(?:→|->)\s*(\d{4})\s*\*\*/.exec(textoDoc);
  if (!m) return null;
  // El markdown envuelve la línea en un blockquote ("> "): "ya están" y
  // "aplicadas" pueden quedar en renglones distintos. Se normaliza esa
  // continuación antes de buscar la frase, en una ventana corta después del
  // rango — no en todo el documento, para no casar con un "aplicadas" suelto
  // de otra parte del archivo.
  const ventana = textoDoc.slice(m.index, m.index + 200).replace(/\n>\s*/g, ' ');
  if (!/ya\s+est[aá]n\s+aplicadas/i.test(ventana)) return null;
  return m[2];
}

/** Las entradas de `lista` (prefijos NNNN) que están POR ENCIMA de `techo`.
 *  `techo === null` → todas cuentan como "más allá" (fail closed). */
export function masAllaDelTecho(lista, techo) {
  if (techo === null) return [...lista];
  return lista.filter((p) => Number(p) > Number(techo));
}

function main() {
  const lista = readFileSync('scripts/ci/migraciones-huerfanas-local.txt', 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const doc = readFileSync('supabase/APLICAR-EN-PRODUCCION.md', 'utf8');
  const techo = techoDeclarado(doc);

  if (techo === null) {
    console.log('::error::No pude leer el techo de "ya están aplicadas" en supabase/APLICAR-EN-PRODUCCION.md — sin techo declarado, no se puede confiar en que la lista de bookkeeping sean puras renombradas. Actualiza el documento (o su formato) antes de repair_migrations.');
    process.exit(1);
  }

  const fuera = masAllaDelTecho(lista, techo);
  if (fuera.length > 0) {
    console.log(`::error::migraciones-huerfanas-local.txt incluye ${fuera.join(', ')}, por encima del techo declarado (${techo}) en APLICAR-EN-PRODUCCION.md. "supabase migration repair" NUNCA ejecuta SQL — marcar estas "applied" las daría por aplicadas sin que su SQL haya corrido nunca. Si de verdad ya corrieron, actualiza primero el techo en APLICAR-EN-PRODUCCION.md con evidencia; si no, aplícalas con el job "Producción — aplicar migraciones reales" (production_migrations / promote), no con repair.`);
    process.exit(1);
  }

  console.log(`compuerta de bookkeeping: las ${lista.length} entrada(s) de migraciones-huerfanas-local.txt están todas por debajo o a la par del techo declarado (${techo}). OK para repair.`);
}

if (process.argv[1]?.endsWith('verificar-huerfanas-repair.mjs')) {
  main();
}
