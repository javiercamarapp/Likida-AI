#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// EL RUNNER QUE CONVIERTE `verificaciones.sql` EN UNA PUERTA DE CI.
//
// `supabase/verificaciones.sql` tiene ~88 bloques `do $$ ... end $$;`, cada
// uno pensado para pegarse a mano en el SQL editor de Supabase: hace su
// ataque, y termina con un `raise exception` A PROPÓSITO —revierte la
// transacción sin dejar basura— cuyo mensaje trae los valores medidos y, casi
// siempre, un `(esperado …)` con lo que el autor observó al escribirlo. Hasta
// hoy, "¿sigue dando eso?" solo se contestaba pegándolo de nuevo a mano.
//
// Este script hace exactamente eso, en lote: parte cada archivo en sus
// bloques `do $$`, corre cada uno por separado contra la base efímera de CI
// (una transacción por bloque, vía `psql`), y COMPARA el mensaje que salió
// contra el `(esperado …)` que el propio bloque declaró. No inventa un
// oráculo nuevo — lee el que cada bloque ya trae escrito.
//
// CÓMO SE LEE UN MENSAJE:
//
//   raise exception E'MUTEX  1er=%  concurrente=%  tras-unlock=%   (esperado t / f / t)',
//     l1, l2, l3;
//
// Postgres sustituye los `%` por l1/l2/l3 ANTES de que psql lo imprima, así
// que lo que se captura ya trae los valores reales: "1er=t  concurrente=f
// tras-unlock=t   (esperado t / f / t)". El script separa las dos mitades por
// "(esperado", saca los NOMBRES de clave (`1er=`, `concurrente=`, …) del lado
// izquierdo para usarlos de frontera —así el VALOR de una clave puede traer
// comas o espacios (una lista de nombres de tabla, por ejemplo) sin romper el
// siguiente— y compara cada valor contra su posición en la lista de la
// derecha, partida por "/".
//
// SUS LÍMITES, para no fingir más certeza de la que da:
//
// · Un token esperado con espacios adentro ("la url", "cualquier otra cosa
//   es fuga al chofer") NO es un valor literal: es prosa del autor. Se trata
//   como comodín — siempre pasa, y sirve para que un humano lo lea, no para
//   que la máquina lo compare.
// · Si el número de claves detectadas no coincide con el número de valores
//   esperados, el bloque NO se puede calificar con certeza. Se AVISA fuerte
//   (marca SIN CALIFICAR) y no cuenta como fallo — fallar la build por un
//   bloque que el parser no entendió sería peor que dejarlo pasar y decirlo.
// · Dos bloques de `verificaciones.sql` (los rotulados "FOTOS REPETIDAS" y
//   el de comparación de planes con/sin índice) son REPORTES, no
//   aserciones: no traen `(esperado …)` porque su salida depende de datos o
//   de tiempos, no de un sí/no fijo. Se corren igual (para que truene si de
//   plano no cargan) pero se listan aparte, nunca como fallo.
// · Un bloque que NO lanza ninguna excepción SÍ es un fallo duro: todos los
//   bloques de esta batería están escritos para revertir con un RAISE al
//   final, y uno que no lo hace dejó basura Y dejó de decir lo que midió.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL (cadena de conexión a la base efímera).');
  process.exit(2);
}

const archivos = process.argv.slice(2);
if (archivos.length === 0) {
  console.error('uso: node scripts/ci/correr-verificaciones.mjs <archivo.sql> [...]');
  process.exit(2);
}

/** Parte un archivo en sus bloques `do $$ ... end $$;` de nivel superior. */
function extraerBloques(sql, archivo) {
  const bloques = [];
  const re = /^do \$\$/gm;
  let m;
  while ((m = re.exec(sql))) {
    const inicio = m.index;
    const marcaCierre = '\nend $$;';
    const cierre = sql.indexOf(marcaCierre, inicio);
    if (cierre === -1) {
      throw new Error(`${archivo}: bloque sin 'end $$;' de cierre, abre en la línea ${linea(sql, inicio)}`);
    }
    const fin = cierre + marcaCierre.length;
    bloques.push({
      archivo,
      sql: sql.slice(inicio, fin),
      linea: linea(sql, inicio),
    });
    re.lastIndex = fin;
  }
  return bloques;
}

function linea(sql, offset) {
  return sql.slice(0, offset).split('\n').length;
}

/** Corre un bloque contra la base. Cada bloque es su propia sesión/transacción. */
function correrBloque(bloque) {
  const r = spawnSync('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '--no-psqlrc'], {
    input: bloque.sql,
    encoding: 'utf8',
  });
  return { exitCode: r.status, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

/**
 * ¿El error que psql reportó es el `raise exception` de CIERRE que el propio
 * bloque escribió a propósito, o un error genuino que Postgres levantó por su
 * cuenta (tabla que no existe, columna NOT NULL vacía, permiso denegado)?
 *
 * La distinción no es cosmética: un bloque de esta batería puede fallar por
 * dos motivos MUY distintos —"la protección que prueba se rompió" (eso es lo
 * que el `raise` final está diseñado para reportar) o "el bloque mismo está
 * roto" (referencia una tabla que solo existe en el archivo completo corrido
 * en una sola sesión de SQL editor, no en su transacción aislada)— y
 * mezclarlos como si fueran el mismo caso "reporte, sin (esperado)" escondía
 * el segundo tipo, que es justo el que más importa no perderse.
 *
 * La señal es el CONTEXT que psql imprime: un `raise exception` deja
 * "…at RAISE"; cualquier otro fallo (INSERT, SELECT INTO, una asignación)
 * deja "…at SQL statement" / "…at assignment" / ningún CONTEXT en absoluto.
 */
function esRaiseDelPropioBloque(stderr) {
  return /PL\/pgSQL function inline_code_block line \d+ at RAISE/.test(stderr);
}

/**
 * Del stderr de psql para un bloque que SÍ lanzó, extrae el texto del
 * mensaje de error (entre "ERROR:  " y la siguiente línea "CONTEXT:"/"HINT:",
 * o el final si no hay ninguna). Colapsa saltos de línea internos a un solo
 * espacio: el `(esperado …)` de un bloque siempre vive en la misma "frase"
 * que las claves que califica, aunque el mensaje tenga secciones multilínea
 * más adelante (los dos bloques-reporte, que de todos modos no tienen
 * `(esperado …)` que parsear).
 */
function extraerMensaje(stderr) {
  const m = /ERROR:\s{2}([\s\S]*?)(?:\n[A-ZÁÉÍÓÚ]+:\s|$)/.exec(stderr);
  if (!m) return null;
  return m[1].replace(/\s+/g, ' ').trim();
}

/** Separa "clave1=val1  clave2=val2   (esperado a / b)" en sus dos mitades. */
function partirEnClavesYEsperado(mensaje) {
  const marcador = mensaje.indexOf('(esperado');
  if (marcador === -1) return null; // bloque-reporte: nada que calificar
  let izq = mensaje.slice(0, marcador).trim();

  // Varios bloques hacen una "falsificación" al final: desarman a propósito
  // la protección que acaban de probar (dropean un índice, quitan un
  // constraint) para demostrar que la prueba SÍ hubiera reprobado — y narran
  // eso con más `clave=valor` que la lista `(esperado …)` no cubre (el
  // `(esperado …)` de esos bloques solo califica la parte de ANTES). Cortar
  // ahí evita que esa segunda mitad se cuente como si fuera parte de la
  // primera y desalinee todo lo que sigue.
  const corteFalsificacion = izq.indexOf('FALSIFICADO');
  if (corteFalsificacion !== -1) izq = izq.slice(0, corteFalsificacion).trim();

  let der = mensaje.slice(marcador + '(esperado'.length).trim();
  der = der.replace(/\)\s*$/, ''); // quita el paréntesis de cierre final
  const esperados = der.split(/\s*\/\s*/).map((s) => s.trim());

  // El ÚLTIMO valor puede traer prosa tras un guion largo ("0 — nunca 2, que
  // sería ver los dos choferes"): se recorta a lo que hay ANTES del guion.
  // Ojo con no confundir esto con un valor esperado que sea LITERALMENTE
  // "—" (el placeholder de "lista vacía" que usan varios bloques, incluido
  // el propio de este archivo): si no hay nada antes del guion, no es
  // prosa — es el valor.
  const ultimo = esperados.length - 1;
  const conProsa = /^(\S.*?)\s+—\s+\S.*$/.exec(esperados[ultimo]);
  if (conProsa) esperados[ultimo] = conProsa[1].trim();

  // Claves = todo token `identificador=` en el lado izquierdo, en orden.
  const clavesRe = /([\wÁÉÍÓÚáéíóúñÑ-]+)=/g;
  const posiciones = [];
  let cm;
  while ((cm = clavesRe.exec(izq))) posiciones.push({ clave: cm[1], desde: clavesRe.lastIndex });
  if (posiciones.length === 0) return { izq, esperados, pares: [] };

  const pares = posiciones.map((p, i) => {
    const hasta = i + 1 < posiciones.length
      ? izq.lastIndexOf(
          posiciones[i + 1].clave + '=',
          posiciones[i + 1].desde - posiciones[i + 1].clave.length - 1,
        )
      : izq.length;
    const valor = izq.slice(p.desde, hasta).trim();
    return { clave: p.clave, valor };
  });

  return { izq, esperados, pares };
}

// Booleano: RAISE imprime `t`/`f` (la salida de texto nativa de Postgres para
// `boolean`), pero varios `(esperado …)` los escriben "true"/"false" en
// palabras. Son el mismo valor.
const BOOL_A_LETRA = { true: 't', false: 'f', verdadero: 't', falso: 'f' };
// "Lista vacía" tiene tres formas distintas en este archivo, según qué autor
// escribió el bloque: el placeholder de `string_agg(..., '—')`, la palabra
// "vacío"/"vacio", y `[algo]` cuando ese algo salió vacío (`[]`).
const VACIOS = new Set(['—', 'vacío', 'vacio', '[]', '', 'ninguno', 'ninguna']);

function normalizar(v) {
  const s = v.trim();
  const low = s.toLowerCase();
  if (low in BOOL_A_LETRA) return BOOL_A_LETRA[low];
  if (VACIOS.has(low)) return '∅';
  return s;
}

/** ">=1", "<=5", ">0", "<10" — comparación numérica en vez de literal. */
function comparaDesigualdad(actual, esperado) {
  const m = /^([<>]=?)\s*(-?\d+(?:\.\d+)?)$/.exec(esperado);
  if (!m) return null;
  const n = Number(actual);
  if (!Number.isFinite(n)) return false;
  const limite = Number(m[2]);
  switch (m[1]) {
    case '>=': return n >= limite;
    case '<=': return n <= limite;
    case '>': return n > limite;
    case '<': return n < limite;
    default: return null;
  }
}

function calificar(mensaje) {
  const partido = partirEnClavesYEsperado(mensaje);
  if (partido === null) return { tipo: 'reporte' };
  const { esperados, pares } = partido;
  if (esperados.length !== pares.length) {
    return {
      tipo: 'sin_calificar',
      razon: `${pares.length} clave(s) detectada(s) vs ${esperados.length} valor(es) esperado(s)`,
      pares,
      esperados,
    };
  }
  const detalle = pares.map((p, i) => {
    const esp = esperados[i];
    // Un esperado del tipo "clave=lo-que-sea" que repite el NOMBRE de su
    // propia clave ("actualiza-con-facilidad=actualiza") no es un valor
    // literal a comparar — es el autor describiendo la intención en prosa
    // dentro del mismo paréntesis. Se trata como comodín.
    const autoReferencial = esp.startsWith(`${p.clave}=`);
    // Un esperado con espacios adentro ("la url", "cualquier otra cosa es
    // fuga al chofer") tampoco es un literal — es prosa.
    const prosa = /\s/.test(esp);
    if (autoReferencial || prosa) {
      return { clave: p.clave, actual: p.valor, esperado: esp, comodin: true, ok: true };
    }
    const desigualdad = comparaDesigualdad(p.valor, esp);
    if (desigualdad !== null) {
      return { clave: p.clave, actual: p.valor, esperado: esp, comodin: false, ok: desigualdad };
    }
    // Una columna `numeric` imprime "2300.00"; el `(esperado …)` que un autor
    // escribe a mano suele decir "2300". Mismo valor, distinta cantidad de
    // ceros — se comparan como número si LOS DOS lo son (así "PRIMERO" contra
    // "PRIMERO" sigue yendo por la comparación de texto de abajo).
    const numActual = Number(p.valor);
    const numEsp = Number(esp);
    const sonNumericos = p.valor.trim() !== '' && esp.trim() !== ''
      && Number.isFinite(numActual) && Number.isFinite(numEsp);
    const ok = sonNumericos ? numActual === numEsp : normalizar(p.valor) === normalizar(esp);
    return { clave: p.clave, actual: p.valor, esperado: esp, comodin: false, ok };
  });
  const falla = detalle.filter((d) => !d.ok);
  return { tipo: falla.length === 0 ? 'ok' : 'falla', detalle, falla };
}

// ── Corrida principal ────────────────────────────────────────────────────
let totalBloques = 0;
let ok = 0;
let fallas = 0;
let sinCalificar = 0;
let reportes = 0;
let noLanzaron = 0;

for (const archivo of archivos) {
  const sql = readFileSync(archivo, 'utf8');
  const bloques = extraerBloques(sql, archivo);
  console.log(`\n== ${archivo} — ${bloques.length} bloque(s) ==`);

  for (const bloque of bloques) {
    totalBloques++;
    const etiqueta = `${archivo}:${bloque.linea}`;
    const { exitCode, stderr } = correrBloque(bloque);

    if (exitCode === 0) {
      // Ningún bloque de esta batería debería terminar sin lanzar: todos
      // revierten a propósito con un RAISE final.
      noLanzaron++;
      console.log(
        `x ${etiqueta}  NO LANZÓ NINGUNA EXCEPCIÓN ` +
          '(se esperaba un RAISE EXCEPTION final; el bloque puede haber dejado basura)',
      );
      continue;
    }

    if (!esRaiseDelPropioBloque(stderr)) {
      // Postgres lanzó ANTES de llegar al RAISE de cierre del bloque: una
      // tabla/columna que no existe en esta transacción aislada, una
      // violación NOT NULL, un permiso. El bloque nunca probó lo que dice
      // probar — es un fallo real, no un "reporte".
      fallas++;
      console.log(`x ${etiqueta}  ERROR INESPERADO (no llegó al RAISE de cierre del bloque):`);
      console.log('   ' + stderr.trim().split('\n').join('\n   '));
      continue;
    }

    const mensaje = extraerMensaje(stderr);
    if (mensaje === null) {
      // No debería pasar si esRaiseDelPropioBloque dio true (todo RAISE deja
      // un "ERROR:  "), pero por si el formato de psql cambia algún día:
      // mejor un fallo visible que un bloque callado.
      fallas++;
      console.log(`x ${etiqueta}  RAISE detectado pero no se pudo extraer su mensaje — revisar el parser:`);
      console.log('   ' + stderr.trim().split('\n').join('\n   '));
      continue;
    }

    const resultado = calificar(mensaje);
    if (resultado.tipo === 'reporte') {
      reportes++;
      console.log(
        `· ${etiqueta}  [reporte, sin (esperado) que calificar] ` +
          `${mensaje.slice(0, 160)}${mensaje.length > 160 ? '…' : ''}`,
      );
    } else if (resultado.tipo === 'sin_calificar') {
      sinCalificar++;
      console.log(`▲ ${etiqueta}  SIN CALIFICAR (${resultado.razon}) — revisar a mano:`);
      console.log(`   ${mensaje}`);
    } else if (resultado.tipo === 'ok') {
      ok++;
      console.log(`✓ ${etiqueta}`);
    } else {
      fallas++;
      console.log(`x ${etiqueta}  NO DIO LO ESPERADO:`);
      for (const d of resultado.falla) {
        console.log(`   ${d.clave}: obtenido "${d.actual}"  !=  esperado "${d.esperado}"`);
      }
      console.log(`   mensaje completo: ${mensaje}`);
    }
  }
}

console.log(`\n${'─'.repeat(70)}`);
console.log(
  `${totalBloques} bloque(s) · ${ok} ok · ${fallas} fallo(s) · ${noLanzaron} no-lanzó · ` +
    `${sinCalificar} sin-calificar · ${reportes} reporte(s)`,
);

if (fallas > 0 || noLanzaron > 0) {
  console.log('\nLa batería de verificaciones.sql/capa1 NO pasó.');
  process.exit(1);
}
if (sinCalificar > 0) {
  console.log(
    '\nTodo lo calificable pasó. Hay bloques que el parser no pudo calificar con certeza — revísalos arriba.',
  );
}
console.log('\nLa batería pasó.');
