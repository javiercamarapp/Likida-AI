# Escala 50k viajes/mes — reglas para los agentes de corrección

Objetivo: que TODA pantalla y cron funcione igual con 50 viajes que con 50,000 viajes/mes (600k viajes,
3.6M gastos, 600k liquidaciones al año por tenant). Hoy `traerTodo` (pg.ts) lanza `LecturaIncompleta` a
las 100,000 filas y pagina por offset O(n²): cualquier función que lea una tabla del tenant a JS tiene
fecha de caducidad. El mapa completo está en docs/escala-50k/MAPA.md (léelo primero, es tu inventario).

Reglas:
1. Patrón obligatorio: agregación en SQL con el molde de `supabase/migrations/0112_agregados_rpc.sql`
   (SECURITY INVOKER, `p_tenant uuid` sin default primero, `stable parallel safe`, `set search_path =
   public, pg_catalog`, `coalesce` sobre cada sum, bucket por día LOCAL MX con `at time zone
   'America/Mexico_City'`, `revoke ... from public, anon, authenticated` + `grant to service_role`).
   Lado JS: fail-closed de FORMA (validar la forma del jsonb y lanzar si no encaja; nunca `?? 0`).
2. Cada función migrada conserva su firma y su tipo de retorno (las páginas no cambian) salvo que el
   mapa diga "paginar UI". Prueba de EQUIVALENCIA obligatoria: la reducción JS vieja vs la forma nueva
   sobre el mismo dataset sintético (ver analytics_serie_comparativa.test.ts como ejemplo).
3. Migración: usa SOLO el número que te asignan; idempotente; bloque nuevo en supabase/verificaciones.sql
   con el número de bloque asignado (aislamiento entre dos tenants sembrados a mano + un caso de
   equivalencia numérica). Debe pasar migraciones_verificadas.test.ts. NO apliques nada a producción.
4. Índices nuevos: solo si un EXPLAIN lo justifica; anótalos en la migración con `create index if not
   exists` (sin CONCURRENTLY — el orquestador decidirá cómo aplicarlos) y documenta por qué.
5. Toda lectura del dashboard que quede en JS debe ir envuelta en `acotada()` (presupuesto.ts) y
   acotada por periodo. Extiende `acotada_guardiana.test.ts` a tus archivos.
6. Commits atómicos por función o grupo coherente, en español, SIN [deploy], autor/committer
   javiercamaraportepetit@gmail.com. Antes de cada commit: vitest de lo tocado; al final: `npm test`
   completo (~5,500 pruebas, ~40 s) + `npm run typecheck` + eslint de tus archivos.
7. No toques archivos fuera de tu propiedad; si es imprescindible, mínimo y repórtalo.
8. Reporte final: tabla función | antes (filas a JS) | después (RPC/acotada/paginada) | archivos | sha,
   más la salida real de npm test y typecheck, y cualquier cifra visible que cambie.
