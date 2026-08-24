import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// UNA ACCIÓN `'use server'` NO PUEDE CERRAR SOBRE UNA FUNCIÓN LOCAL
//
// El bug que esta prueba existe para no repetir (24-ago-2026, producción):
//
// `/dashboard/despacho` declaraba `guardia()` dentro del componente y sus SEIS
// acciones inline la usaban. Next tiene que serializar las variables que un
// `'use server'` inline captura —las mete en `encryptActionBoundArgs`— y una
// FUNCIÓN no es serializable. El bundle quedaba así:
//
//     I = z.bind(null, encryptActionBoundArgs("709f…", H, c))
//                                                      ↑ guardia
//
// y producía, en CADA render, un rechazo no manejado con «Functions cannot be
// passed directly to Client Components». Sentry lo registró 204 veces en nueve
// días sin que nadie lo relacionara con nada.
//
// LO QUE LO HIZO CARO fue que el síntoma no se parecía a la causa: el combo de
// Operador contestaba «No se pudo buscar en el catálogo», y como la acción
// nunca llegaba al servidor, NO HABÍA NI UNA CONSULTA en los logs de Postgres
// que mirar. Tampoco reproducía en local hasta escribir un preview que cerrara
// sobre una función, igual que el original.
//
// El arreglo es siempre el mismo: la ayudante vive a NIVEL DE MÓDULO y recibe
// por parámetro lo que necesitaba del closure. Entonces lo capturado son
// strings, que sí se serializan.
//
// Esta prueba lee FUENTE, no bundle: correr `next build` aquí costaría minutos
// y la señal se puede sacar del texto. Es una heurística deliberadamente
// estrecha —sólo mira ayudantes declaradas en el cuerpo del componente— para
// que un positivo sea siempre real.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src/app');

function paginas(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...paginas(ruta));
    else if (/^(page|layout)\.tsx$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** Los cuerpos de cada función marcada `'use server'`, por llaves balanceadas. */
function cuerposDeAcciones(fuente: string): string[] {
  const cuerpos: string[] = [];
  const re = /'use server';/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    // Hacia atrás hasta la DECLARACIÓN de la función que lleva la directiva.
    //
    // No vale `lastIndexOf('{')`: la `{` más cercana puede ser la de un
    // template literal de la ayudante de arriba (`${sufijo ? …}`), y entonces
    // el balanceo de llaves arranca torcido y el cuerpo sale vacío. Eso hizo
    // que la primera versión de esta prueba detectara /despacho y NO
    // /mi-perfil — un detector con hueco es peor que ninguno, porque da por
    // revisado lo que no miró.
    const decl = [...fuente.slice(0, m.index).matchAll(/(?:async )?function [A-Za-z_$][\w$]*\s*\([^)]*\)[^{]*\{/g)].pop();
    if (!decl) continue;
    const abre = decl.index + decl[0].length - 1;
    let prof = 0;
    let i = abre;
    for (; i < fuente.length; i++) {
      if (fuente[i] === '{') prof++;
      else if (fuente[i] === '}') { prof--; if (prof === 0) break; }
    }
    cuerpos.push(fuente.slice(abre, i + 1));
  }
  return cuerpos;
}

/** Ayudantes declaradas EN EL CUERPO del componente (dos espacios de sangría)
 *  que NO son a su vez acciones de servidor. Una acción que llama a otra
 *  acción es legítima: las dos son referencias de servidor. */
function ayudantesLocales(fuente: string): string[] {
  const nombres: string[] = [];
  const re = /^ {2}(?:async )?function ([A-Za-z_$][\w$]*)\s*[(<]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    // La directiva se busca SOLO en las dos primeras líneas del cuerpo de ESTA
    // función. Con una ventana de caracteres fija se colaba la función de
    // abajo: `volverA` quedaba marcada como acción porque el `'use server';`
    // de `actualizarNombre`, declarada justo después, caía dentro de la
    // ventana — y por eso la primera versión de esta prueba no vio
    // /mi-perfil.
    const abre = fuente.indexOf('{', m.index);
    const dosLineas = abre < 0 ? '' : fuente.slice(abre, abre + 1).concat(fuente.slice(abre + 1).split('\n').slice(0, 3).join('\n'));
    if (dosLineas.includes("'use server';")) continue;   // es una acción
    nombres.push(m[1]);
  }
  return nombres;
}

describe('las server actions no capturan funciones locales', () => {
  const archivos = paginas(RAIZ);

  it('hay páginas que revisar (la prueba no se está saltando en silencio)', () => {
    expect(archivos.length).toBeGreaterThan(30);
  });

  it('ninguna acción inline referencia una ayudante del cuerpo del componente', () => {
    const culpables: string[] = [];

    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, 'utf8');
      if (!fuente.includes("'use server';")) continue;

      const ayudantes = ayudantesLocales(fuente);
      if (ayudantes.length === 0) continue;

      const cuerpos = cuerposDeAcciones(fuente);
      for (const nombre of ayudantes) {
        const usada = cuerpos.some((c) => new RegExp(`\\b${nombre}\\s*\\(`).test(c));
        if (usada) {
          culpables.push(`${archivo.replace(process.cwd() + '/', '')} → la acción usa "${nombre}()"`);
        }
      }
    }

    expect(culpables, [
      'Una función declarada en el cuerpo del componente y usada dentro de un',
      "`'use server'` se captura por closure, y Next NO puede serializarla:",
      'la página revienta en cada render con «Functions cannot be passed',
      'directly to Client Components» y sus acciones dejan de funcionar.',
      'Muévela a nivel de módulo y pásale por parámetro lo que necesitaba.',
    ].join(' ')).toEqual([]);
  });
});
