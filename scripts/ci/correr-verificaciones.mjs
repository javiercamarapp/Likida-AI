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
import { extraerBloques, esRaiseDelPropioBloque, extraerMensaje, calificar } from './calificar-verificacion.mjs';

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

// Las funciones puras (partir bloques, leer el mensaje, calificar) viven en
// `./calificar-verificacion.mjs` desde PRU-1 (auditoría 24), para poder
// probarlas sin Postgres. Aquí queda solo lo que habla con `psql` y decide el
// código de salida.

/** Corre un bloque contra la base. Cada bloque es su propia sesión/transacción. */
function correrBloque(bloque) {
  const r = spawnSync('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '--no-psqlrc'], {
    input: bloque.sql,
    encoding: 'utf8',
  });
  return { exitCode: r.status, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

// ── Corrida principal ────────────────────────────────────────────────────
let totalBloques = 0;
let ok = 0;
let fallas = 0;
let sinCalificar = 0;
const sinCalificarMensajes = [];
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
      sinCalificarMensajes.push(extraerMensaje(stderr) ?? '');
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

// ── SIN CALIFICAR = FALLA, SIN LISTA DE EXCEPCIONES ────────────────────────
//
// 23-ago-2026: `sin_calificar` pasó a ser falla, pero con 19 bloques que el
// parser no sabía leer metidos en una lista `SIN_CALIFICAR_CONOCIDOS` «que se
// baja, no se sube». No bajó. La auditoría 24 (PRU-1, CRÍTICO) lo demostró
// mutando la policy de `tarifa`: `FINANZAS_RLS clientes=0 tarifas=1 …` salía
// marcado ▲ SIN CALIFICAR, «182 ok · 0 fallos», exit 0 — la única prueba que
// impide que un encargado lea la lista de precios lo medía, lo imprimía y no
// reprobaba. Entre los 19 estaban también RPCS_0159 (sobrepago, saldo
// negativo), STRIPE_0163, AGREGADOS_0150, RESUMEN_POR_TENANT (con su
// AISLADO=) e INDICES_PAGINACION (2/9 índices en uso, y verde).
//
// 1-sep-2026: los 19 `raise` se reescribieron como listas alineadas
// (`a / b / c` contra sus claves, valores sin barra adentro, prosa fuera del
// paréntesis) y se verificaron uno por uno contra un Postgres 17 efímero con
// las 257 migraciones. La lista quedó en cero y se BORRA: una lista vacía con
// mecanismo de excepción es una invitación a volver a llenarla. Un bloque que
// no se puede calificar es rojo, hoy y siempre; el arreglo es el mensaje del
// `raise`, no una entrada aquí. `scripts/ci/calificar_verificacion_aud24.test.ts`
// fija el caso de la fuga: `tarifas=1` contra `esperado 0` es `falla`.
if (sinCalificar > 0) {
  console.log(`\n${sinCalificar} bloque(s) sin calificar — y eso es falla:`);
  for (const m of sinCalificarMensajes) console.log(`  ${m.slice(0, 140)}`);
  console.log(
    '\nUn bloque sin calificar no se puede afirmar que pasó. Arregla el mensaje del `raise`:\n' +
      'una lista `a / b / c` alineada con sus claves, sin `/` dentro de un valor, y la prosa\n' +
      'fuera del paréntesis (o como último valor, tras un guion largo).',
  );
  console.log('\nLa batería de verificaciones.sql/capa1 NO pasó.');
  process.exit(1);
}
console.log('\nLa batería pasó.');
