// Flat config. Next 16 quitó `next lint`, así que el script `lint` del
// package.json llevaba tiempo roto: invocaba un comando que ya no existe y
// fallaba con "Invalid project directory". Un lint que no corre se lee como un
// lint que pasa.
//
// eslint-config-next 16 ya exporta flat config nativo — no hace falta
// FlatCompat, y de hecho con él revienta ("Converting circular structure").
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
// 23-AGO-2026: CodeQL lleva días sin correr porque exige GitHub Advanced
// Security COMPRADA — no es un ajuste que se encienda. El análisis de
// seguridad del código propio se hace aquí, en el lint que YA corre en CI:
// una compuerta que existe vale más que una que hay que pagar.
import security from 'eslint-plugin-security';

const config = [
  {
    ignores: [
      '.next/**', 'node_modules/**', 'out/**', 'build/**',
      '.vercel/**',    // salida de `vercel build`: JS generado, no código nuestro
      'next-env.d.ts',
      'supabase/**',   // migraciones: no es código de app
      // Worktrees de Claude Code: cada uno trae su PROPIO node_modules. Sin
      // este ignore, `eslint .` desde la raíz del repo lo recorre entero — un
      // worktree activo (auth-panel, 2-ago-2026) infló la corrida a ~29,000
      // problemas, todos ajenos al código real.
      '.claude/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // ── ANÁLISIS DE SEGURIDAD DEL CÓDIGO PROPIO ────────────────────────────
    // Sustituye a CodeQL, que exige GitHub Advanced Security comprada y lleva
    // días sin correr. Esto sí corre, en el lint que ya está en CI.
    //
    // Se eligen las reglas UNA POR UNA en vez de tomar `recommended` entero:
    // ese preset deja 670 avisos, 600 de ellos de `detect-object-injection`
    // —que marca cualquier `obj[variable]`, algo que TypeScript ya acota con
    // el tipo del índice—. Un análisis con 670 avisos que nadie lee es la
    // misma trampa que un check rojo permanente: enseña a ignorar la lista.
    plugins: { security: security },
    rules: {
      // Ejecución de código armado en tiempo de ejecución.
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-child-process': 'error',
      // ReDoS. Va como AVISO y no como error, y la razón está MEDIDA, no
      // supuesta: la regla usa `safe-regex`, que marca la FORMA (un `{0,9}`
      // seguido de un grupo opcional) sin mirar el comportamiento. Se probaron
      // con entrada adversarial creciente las cuatro que reciben texto de
      // fuera —las de talacha, la de cierre del processor y la de sanitizar— y
      // las cuatro son LINEALES: 0.07 ms con 1,000 caracteres y 0.00 ms con
      // 8,000. Lo que las salva es justo el tope del cuantificador.
      //
      // Que sea aviso no significa ignorarla: `regex_sin_redos.test.ts` mide
      // de verdad y falla si alguna explota. Una prueba que mide vale más que
      // una regla que adivina — pero la regla se queda, porque avisa cuando
      // alguien escribe una nueva sin tope.
      'security/detect-unsafe-regex': 'warn',
      // Comparar un secreto con `===` filtra su longitud y su prefijo por el
      // tiempo de respuesta. Aquí hay firmas de Meta, de Stripe y de QStash.
      'security/detect-possible-timing-attacks': 'error',
      // Aleatoriedad no criptográfica donde hace falta cripto (tokens, llaves).
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      // Rutas de archivo armadas con una variable. Como AVISO y no error: el
      // repo lee migraciones y fixtures por nombre a propósito, y todos esos
      // caminos son de build o de prueba, no de una petición de usuario.
      'security/detect-non-literal-fs-filename': 'warn',
      // APAGADAS a propósito, con su razón:
      //  · detect-object-injection: 600 avisos, ~todos falsos en TypeScript.
      //  · detect-non-literal-regexp: el repo arma regex desde catálogos
      //    propios (conceptos, RFCs), no desde entrada de usuario.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
  {
    rules: {
      // El código usa `any` en contadas fronteras con SDKs ajenos, y cada una
      // lleva su comentario del porqué. Como ERROR bloquearía por algo ya
      // razonado; como warning sigue visible.
      '@typescript-eslint/no-explicit-any': 'warn',
      // La convención del repo para "este parámetro existe por la firma, no
      // se usa" es el prefijo `_` (los `_prev`/`_fd` de las server actions,
      // los `_a` de los dobles de prueba). La regla ahora la CONOCE: 26
      // warnings de ruido intencional tapaban a los no usados de verdad
      // (auditoría externa 16-ago-2026 — un repo enterprise llega sin ruido).
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    // Los arneses manuales hacen llamadas reales y viven fuera de `npm test`.
    files: ['pruebas-manuales/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];

export default config;
