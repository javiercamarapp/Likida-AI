# Reglas para arreglar hallazgos de la auditoría 18 (repo likida.ai)

Documento de hallazgos: /Users/javiercamaraportepetit/likida-aud18/HALLAZGOS-18.md
Cada hallazgo tiene una sección `## <ID> · [SEV] ...` — léela con grep -n y sed -n.
Trabaja SOLO en tu worktree (ruta que te dan), rama ya creada. node_modules está enlazado.

1. VERIFICA PRIMERO. Abre el archivo:línea y confirma que el hallazgo sigue vivo en este
   checkout (master avanzó desde el 20-ago y C1/A16/A29/A26 ya están aplicados). Si ya está
   resuelto, anótalo como RESUELTO y sigue.
2. Prueba que reproduce → arreglo → prueba verde. Si no puedes reproducir, déjalo PROPUESTO con razón.
3. Un commit atómico por hallazgo (o por cadena de hallazgos del mismo bug), mensaje en
   español citando el ID: `fix(<area>): ... (A12)`. SIN la palabra [deploy].
   Autor y committer: GIT_AUTHOR_EMAIL=GIT_COMMITTER_EMAIL=javiercamaraportepetit@gmail.com
4. Antes de cada commit: `npx vitest run <archivos relevantes>`; al FINAL de todo: `npm test`
   completo (5200 pruebas, ~35 s) y `npm run typecheck`. Si algo rompe, revierte ese commit.
5. NO cambies una cifra que el usuario ve sin anotarlo explícitamente en tu reporte.
6. NO toques archivos fuera de tu lista de propiedad salvo que sea estrictamente necesario
   (si lo haces, dilo en el reporte). Otros agentes editan en paralelo otros archivos.
7. Migraciones nuevas: usa SOLO los números que te asignan; el archivo debe ser idempotente
   y necesita su bloque en supabase/verificaciones.sql y pasar migraciones_verificadas.test.ts.
   NO apliques nada a producción.
8. Reporte final (en español, conciso): tabla ID | estado (ARREGLADO sha / RESUELTO-ya /
   PROPUESTO razón) | archivos | cifras visibles cambiadas. Y salida real de `npm test`.
