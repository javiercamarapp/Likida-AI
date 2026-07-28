// Flat config. Next 16 quitó `next lint`, así que el script `lint` del
// package.json llevaba tiempo roto: invocaba un comando que ya no existe y
// fallaba con "Invalid project directory". Un lint que no corre se lee como un
// lint que pasa.
//
// eslint-config-next 16 ya exporta flat config nativo — no hace falta
// FlatCompat, y de hecho con él revienta ("Converting circular structure").
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '.next/**', 'node_modules/**', 'out/**', 'build/**',
      'next-env.d.ts',
      'supabase/**',   // migraciones: no es código de app
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // El código usa `any` en contadas fronteras con SDKs ajenos, y cada una
      // lleva su comentario del porqué. Como ERROR bloquearía por algo ya
      // razonado; como warning sigue visible.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Los arneses manuales hacen llamadas reales y viven fuera de `npm test`.
    files: ['pruebas-manuales/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];

export default config;
