import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { sinComentarios, fuentesDeProduccion } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// UNA CREDENCIAL PRIVILEGIADA NO CAE A UNA DE MENOR PRIVILEGIO. NUNCA.
//
// La auditoría interna adversarial arrastró TRES rondas un CRÍTICO sin
// confirmar: un posible fallback silencioso de `SUPABASE_SERVICE_ROLE_KEY` a la
// anon key en `src/lib/env.ts`. Verificado el 28-ago-2026 contra `master`: el
// patrón NO está hoy. `supabase/admin.ts:25` falla cerrado
// (`if (!url || !key) throw`) y `admin-context.ts` ya documenta en su propio
// comentario que "hasta hoy caía a SUPABASE_SERVICE_ROLE_KEY" y dejó de hacerlo.
//
// Lo que faltaba no era el arreglo: era la RED. Un hallazgo que se arregla en un
// archivo vuelve por otro — es la misma lección de `tope_consulta.test.ts`, cuyo
// ALTO fue REINCIDENTE porque el mecanismo era correcto pero vivía en un archivo
// en vez de en la frontera. Esta prueba no arregla un caso: prohíbe la CLASE.
//
// POR QUÉ ES DE VERDAD GRAVE, en concreto y en las dos direcciones:
//
//   · PRIVILEGIO ABAJO — `SERVICE_ROLE ?? ANON`. Falta la service-role en el
//     entorno y el sistema NO se cae: levanta un cliente con permisos de
//     anónimo. Cada consulta del pipeline pasa a chocar contra RLS y devuelve
//     CERO FILAS, que no es un error: es una lista vacía. Un cuadre "sin
//     gastos", una liquidación que cierra en ceros, un webhook que responde 200.
//     `null` ≠ 0 y ausencia ≠ vacío: eso es exactamente lo que un fallback
//     convierte en indistinguible. El 20-ago ya pasó una versión más benigna de
//     esto con el valor marcador `[SENSITIVE]` (ver `env.ts:44`): el OCR facturó
//     cero durante horas y el health-check decía verde.
//
//   · PRIVILEGIO ARRIBA — `ANON ?? SERVICE_ROLE`. Peor: falta la anon key y una
//     ruta que corre en el NAVEGADOR se lleva la llave que salta RLS. Es una
//     fuga de credencial, no una degradación.
//
// Se escanea el FUENTE, no se ejecuta lógica — mismo estilo que
// `normas_sincronizadas.test.ts` y `tope_consulta.test.ts`. Y se escanea TODO
// `src/` y `scripts/`, no `env.ts`: la gracia es que falle en el archivo NUEVO
// que todavía no existe, que es por donde volvió la clase las tres veces
// anteriores en este repo.
//
// El "falla cerrado" de comportamiento vive en `supabase/admin.test.ts`
// ("sin SERVICE_ROLE_KEY lanza — aunque la ANON esté presente"). Esta prueba es
// la otra mitad: que ningún archivo futuro pueda escribir el fallback.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nombres que designan una credencial PRIVILEGIADA: la que salta RLS.
 * Se aceptan tanto la variable de entorno (`SUPABASE_SERVICE_ROLE_KEY`) como el
 * alias en código (`serviceRoleKey`, `service_role`) — el fallback se puede
 * escribir sobre cualquiera de los dos y el efecto es el mismo.
 */
const PRIVILEGIADA = String.raw`(?:SERVICE_ROLE|service_?[Rr]ole|ADMIN_KEY|adminKey)`;

/**
 * Nombres que designan una credencial de MENOR privilegio: la que el navegador
 * puede ver. `NEXT_PUBLIC_*` entra entera: por definición viaja al bundle.
 */
const MENOR_PRIVILEGIO = String.raw`(?:ANON|[Aa]non[Kk]ey|PUBLISHABLE|publishable|NEXT_PUBLIC_)`;

/**
 * Los dos operadores con los que se escribe un fallback silencioso. `||` cae
 * también con cadena vacía; `??` solo con `null`/`undefined`. Los dos son el
 * mismo bug aquí, porque una credencial vacía y una ausente valen lo mismo.
 */
const CAE_A = String.raw`(?:\|\||\?\?)`;

/**
 * La ventana entre los dos lados. `[^;{}\n]` corta en el fin de sentencia y en
 * cualquier bloque: sin ese corte, un `SERVICE_ROLE` de la línea 10 y un `ANON`
 * de la línea 40 con un `||` cualquiera en medio darían un falso positivo.
 * Se permiten hasta 120 caracteres, que cubre el `process.env.X || process.env.Y`
 * más largo del repo con margen.
 */
const HUECO = String.raw`[^;{}\n]{0,120}?`;

/** `SERVICE_ROLE … || … ANON`: se pierde privilegio en silencio. */
const CAIDA_ABAJO = new RegExp(`${PRIVILEGIADA}${HUECO}${CAE_A}${HUECO}${MENOR_PRIVILEGIO}`);

/** `ANON … || … SERVICE_ROLE`: se GANA privilegio donde no debe haberlo. */
const CAIDA_ARRIBA = new RegExp(`${MENOR_PRIVILEGIO}${HUECO}${CAE_A}${HUECO}${PRIVILEGIADA}`);

/**
 * La línea infractora de un fuente, o `null`. Se examina línea por línea Y
 * también uniendo cada línea con la siguiente, porque el fallback se escribe
 * partido en dos renglones más veces que en uno:
 *
 *     const key = process.env.SUPABASE_SERVICE_ROLE_KEY
 *       ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 */
function infraccion(fuente: string): { linea: number; texto: string; sentido: string } | null {
  const lineas = sinComentarios(fuente).split('\n');
  for (let i = 0; i < lineas.length; i++) {
    // Se prueban 1 y 2 renglones: más que eso empieza a producir falsos
    // positivos y menos deja pasar el caso partido, que es el común.
    for (const n of [1, 2]) {
      const trozo = lineas.slice(i, i + n).join(' ');
      if (CAIDA_ABAJO.test(trozo)) return { linea: i + 1, texto: trozo.trim(), sentido: 'privilegiada → menor privilegio' };
      if (CAIDA_ARRIBA.test(trozo)) return { linea: i + 1, texto: trozo.trim(), sentido: 'menor privilegio → privilegiada' };
    }
  }
  return null;
}

/** Los `.ts`/`.mjs` de `scripts/`, que también leen la service-role key. */
function fuentesDeScripts(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = `${dir}/${e.name}`;
    if (e.isDirectory()) salida.push(...fuentesDeScripts(ruta));
    else if (/\.(ts|mjs|js)$/.test(e.name) && !e.name.includes('.test.')) salida.push(ruta);
  }
  return salida;
}

const ARCHIVOS = [...fuentesDeProduccion('src'), ...fuentesDeScripts('scripts')];

describe('ninguna credencial privilegiada cae a una de menor privilegio', () => {
  it('ni un solo archivo de src/ o scripts/ escribe el fallback', () => {
    const culpables = ARCHIVOS
      .map((f) => ({ f, hit: infraccion(readFileSync(f, 'utf8')) }))
      .filter((x) => x.hit)
      .map((x) => `${x.f}:${x.hit!.linea} (${x.hit!.sentido})\n      ${x.hit!.texto}`);

    expect(
      culpables,
      'Una credencial privilegiada NO cae a otra cuando falta. Falla CERRADO y dilo:\n' +
      "  if (!key) throw new Error('Supabase service-role no configurado');\n" +
      'Con el fallback hacia abajo, RLS devuelve CERO FILAS en vez de un error, y una liquidación ' +
      'cierra en ceros como si de verdad no hubiera gastos. Hacia arriba, la llave que salta RLS ' +
      'acaba en el bundle del navegador.\n' +
      'Archivos:\n    ' + culpables.join('\n    '),
    ).toEqual([]);
  });

  it('y hay archivos de verdad que revisar (si no, esto no vigila nada)', () => {
    // Un `readdirSync` que devolviera [] haría pasar el test de arriba en
    // silencio — el mismo modo de falla que este archivo existe para evitar.
    expect(ARCHIVOS.length).toBeGreaterThan(300);
    expect(ARCHIVOS.some((f) => f.endsWith('src/lib/env.ts'))).toBe(true);
    expect(ARCHIVOS.some((f) => f.endsWith('src/lib/supabase/admin.ts'))).toBe(true);
  });
});

describe('el detector no está ciego', () => {
  // Cada uno de estos es una forma REAL de escribir el bug. Si el regex deja de
  // verlos, la red de arriba pasa a ser decorativa y nadie se entera.
  const DEBEN_CAZARSE: Array<[string, string]> = [
    [
      'el patrón exacto del CRÍTICO de tres rondas',
      "const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;",
    ],
    [
      'con ?? en vez de ||',
      "const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;",
    ],
    [
      'partido en dos renglones',
      "const key = process.env.SUPABASE_SERVICE_ROLE_KEY\n  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;",
    ],
    [
      'sobre aliases en camelCase, sin nombrar la variable de entorno',
      'const llave = serviceRoleKey || anonKey;',
    ],
    [
      'la dirección contraria: la anon cae a la service-role (fuga de privilegio)',
      "const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;",
    ],
    [
      'con la publishable key nueva de Supabase en el lado bajo',
      'const key = SUPABASE_SERVICE_ROLE_KEY ?? SUPABASE_PUBLISHABLE_KEY;',
    ],
    [
      'envuelto en una llamada, no en una asignación',
      "createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    ],
  ];

  it.each(DEBEN_CAZARSE)('caza: %s', (_nombre, muestra) => {
    expect(infraccion(muestra)).not.toBeNull();
  });

  // Y el otro lado: lo que NO debe disparar. Un detector que grite ante el
  // código sano se apaga a la semana, y entonces tampoco vigila nada.
  const NO_DEBEN_CAZARSE: Array<[string, string]> = [
    [
      'el inventario de env.ts, que nombra las tres juntas sin operador',
      "supabase: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],",
    ],
    [
      'el fail-closed real de admin.ts',
      "const key = process.env.SUPABASE_SERVICE_ROLE_KEY;\nif (!url || !key) throw new Error('Supabase service-role no configurado');",
    ],
    [
      'un default numérico junto a una NEXT_PUBLIC_ cualquiera',
      "const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ci-placeholder.supabase.co';",
    ],
    [
      'un comentario que CITA el bug para explicar por qué no existe',
      '// hasta hoy caía a SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ],
    [
      'las dos en el mismo bloque pero en sentencias distintas',
      'const admin = process.env.SUPABASE_SERVICE_ROLE_KEY;\nconst anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";',
    ],
  ];

  it.each(NO_DEBEN_CAZARSE)('no grita ante: %s', (_nombre, muestra) => {
    expect(infraccion(muestra)).toBeNull();
  });
});
