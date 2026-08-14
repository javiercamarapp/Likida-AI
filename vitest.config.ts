import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Alias '@' → src/ para que los tests puedan importar módulos que usan '@/...'
// en tiempo de ejecución (antes solo los type-only resolvían).

// LA INSTRUMENTACIÓN DE COBERTURA FALSEA EL RELOJ. Tres pruebas de la suite
// afirman TIEMPO (un ReDoS, un cociente de escalado, un costo por llamada) y
// bajo `--coverage` la misma suite pasa de 9 s a 34 s: sus umbrales dejan de
// medir el algoritmo y miden la instrumentación. Se les avisa con esta bandera
// para que se salten SOLO en la corrida instrumentada y sigan a plena fuerza en
// `npm test` — relajar el umbral sería mentir sobre lo que miden.
const CON_COBERTURA = process.argv.includes('--coverage');

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // `.claude/worktrees/` no está en .gitignore, y sin este exclude vitest
    // escanea DENTRO de un worktree activo al correr desde la raíz del repo —
    // una segunda copia de cada archivo de prueba corriendo en paralelo con
    // la real. Medido el 2-ago-2026 con el worktree de auth-panel vivo: 17
    // fallos que desaparecían al filtrar por la copia de `src/` a secas,
    // mismos archivos, mismo resultado real. Se preservan los excludes por
    // defecto de vitest (node_modules, dist, .git, etc.) y se agrega el propio.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/.claude/**',
    ],
    // LIKIDA_COBERTURA es el nombre que leen los `skipIf` de las pruebas de
    // tiempo y la red `pruebas_en_ci.test.ts`. El rename de marca del 12-ago
    // (b79f8e5) renombró a los lectores y dejó aquí el nombre viejo: el skip
    // murió en silencio y los umbrales de tiempo corrieron INSTRUMENTADOS en
    // el paso de cobertura de CI. La red ahora exige que este nombre y el de
    // los skipIf sean el mismo.
    env: { LIKIDA_COBERTURA: CON_COBERTURA ? '1' : '' },
    // ═════════════════════════════════════════════════════════════════════════
    // MEDICIÓN DE COBERTURA — auditoría 5, MEDIO.
    //
    // Sin esto, "989 pruebas" mide ESFUERZO y no PROTECCIÓN: el número sube
    // igual cuando se prueban más casos de una función ya probada que cuando se
    // cubre una zona nueva. La ronda 5 tuvo que descubrir A MANO —mutando 21
    // puntos— que `tools.ts`, `export.ts` y todo `src/app/` tenían 0% de líneas
    // ejecutadas. Eso tiene que salir de un comando.
    //
    // OJO CON LO QUE ESTA MÉTRICA NO PRUEBA. Las 12 mutaciones que sobrevivían
    // vivían en líneas que la suite SÍ ejecutaba: el PDF se generaba y el
    // mensaje se armaba, sin una sola assertion sobre su valor. 100% de líneas
    // con cero `expect` sigue siendo cero protección. Esto sirve para el caso
    // contrario —zonas que nadie ejecuta— y sólo para ese. La otra mitad la da
    // la mutación dirigida, que es trabajo de auditoría y no de CI.
    // ═════════════════════════════════════════════════════════════════════════
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      // EN LA CACHÉ, no en `./coverage`. El reporte HTML son cientos de archivos
      // generados: en la raíz aparecen sin trackear en `git status` —la forma más
      // fácil de commitearlos sin querer— y ESLint los recorre y saca warnings
      // sobre JS que no es nuestro. `node_modules/**` ya está ignorado por las
      // dos herramientas, y `npm ci` lo borra en cada corrida de CI.
      // Se abre con `open node_modules/.cache/coverage/index.html`.
      reportsDirectory: './node_modules/.cache/coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        // Solo tipos: no hay líneas que ejecutar.
        'src/types/**',
        // VISTAS de React. No hay una sola prueba de nodo sobre ellas y no la
        // va a haber: el rubro de frontend las cubre por otro camino (mirar el
        // render). Contarlas aquí ahoga la señal de la lógica que mueve dinero,
        // que es lo que esta puerta protege. Las RUTAS de API sí cuentan
        // (`route.ts`, no `.tsx`): llevan HMAC, filtro por tenant y dinero.
        //
        // 14-ago-2026 — LA LISTA DECÍA UNA COSA Y HACÍA OTRA. Nombraba solo los
        // archivos especiales del router (page/layout/loading/error), pero las
        // 8 fases del plan Handle metieron el grueso de la pantalla en HERMANOS
        // de esos archivos: `vista.tsx`, `estrategia.tsx`, `controles.tsx`,
        // `chat.tsx`, `inicio-contenido.tsx`. Esos SÍ se contaban.
        //
        // Medido ese día, con la lista vieja:
        //     70 vistas .tsx en src/app  →    225/6,269 líneas =  3.59%
        //     todo lo demás              → 13,895/17,475       = 79.51%
        //     mezclado (lo que veía CI)  →                       59.46%  ← rojo
        //
        // O sea: el número no medía protección, medía cuánta pantalla se había
        // escrito esa semana. Escribir un `vista.tsx` bueno tiraba la puerta.
        // Se excluye la CATEGORÍA — que es lo que el párrafo de arriba siempre
        // dijo — y el umbral sube de 67 a 78 para que la puerta quede MÁS dura
        // sobre lo que sí se puede probar en nodo, no más blanda.
        //
        // Excluir de la MEDICIÓN no apaga pruebas: `avance-cierre.test.tsx` y
        // `tablero-operacion.test.tsx` siguen corriendo y siguen fallando si se
        // rompen. Solo dejan de contar en el porcentaje.
        'src/app/**/*.tsx',
      ],
      // UN TRINQUETE, NO UNA ASPIRACIÓN. Medido el 5-ago-2026 (líneas 68.07 ·
      // ramas 84.74 · funciones 79.58) tras añadir ~90 pruebas en la ronda 16
      // (tenant-api, contactos, chofer, estatus, sufijo, stripe, saludo,
      // suscripcion). El trinquete sube de 64 a 67 con un punto de margen —
      // bajar de aquí falla. El camino a 78 (el objetivo del trinquete) está
      // rastreado: faltan los componentes UI (necesitan jsdom + testing-library,
      // sesión dedicada post-demo) y los módulos grandes (repo.ts, consolidado).
      // Medido el 14-ago-2026 sobre el denominador ya limpio de vistas:
      // líneas/statements 79.51 · ramas 84.25 · funciones 85.21.
      // Margen de ~1 punto, como el trinquete anterior. Las RAMAS se quedan en
      // 84 —el número que ya estaba— para no aflojar un umbral al pasar; su
      // margen queda apretado (0.25) a propósito: la siguiente rama sin cubrir
      // debe doler.
      thresholds: {
        lines: 78,
        statements: 78,
        branches: 84,
        functions: 84,
      },
    },
  },
});
