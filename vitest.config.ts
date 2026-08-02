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
    env: { CUADRA_COBERTURA: CON_COBERTURA ? '1' : '' },
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
        // VISTAS de React (Server Components). No hay una sola prueba de nodo
        // sobre ellas y no la va a haber: el rubro de frontend las cubre por
        // otro camino. Contarlas aquí ahogaría la señal de la lógica que mueve
        // dinero, que es lo que esta puerta protege. Las RUTAS de API sí
        // cuentan: llevan HMAC, filtro por tenant y un mapeo de dinero.
        'src/app/**/page.tsx',
        'src/app/**/layout.tsx',
        'src/app/**/loading.tsx',
        'src/app/**/error.tsx',
        'src/app/**/global-error.tsx',
        'src/app/**/not-found.tsx',
      ],
      // UN TRINQUETE, NO UNA ASPIRACIÓN. Es la línea MEDIDA el 28-jul-2026
      // (líneas 79.69 · ramas 85.09 · funciones 84.69) con un par de puntos de
      // holgura, para que un refactor benigno no tumbe el CI y una regresión
      // de verdad sí. Subir el número es trabajo; que no baje es la puerta.
      //
      // Con las vistas de React dentro, la misma corrida da 69.16% de líneas.
      // Ese es el número del árbol COMPLETO y conviene no perderlo de vista.
      thresholds: {
        lines: 78,
        statements: 78,
        branches: 84,
        functions: 83,
      },
    },
  },
});
