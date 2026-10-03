# Prueba de carga: UNA flota de 250 tractos, 5,000 viajes al mes

Escenario: 1 flota con 250 unidades, 262 operadores y 60,000 viajes (12 meses × 5,000), con el volumen
de hijos que escribe el código real, más 20 flotas chicas como ruido de tenant. Todo sintético
(`ZZZ CARGA …`, teléfonos `52155…`, UUID derivados de `md5`). Resultados y veredicto:
`~/likida-loop/rondas/ronda-16-carga.md`. Reutiliza la idea de `scripts/carga-15k*.sql` y `demo-5k*.sql`
(una flota sintética sembrada con SQL y limpiada por tenant) pero a la escala nueva y con las tablas de
Conductor, Vigía, peajes y Carta Porte, que no existían entonces.

## Requisitos
Postgres 15+ efímero (se probó con 17.11, `en_US.UTF-8`, `shared_buffers=1GB`, `work_mem=8MB`,
`random_page_cost=1.1`), `psql`, `python3` (solo biblioteca estándar). **Nunca contra producción.**
Espacio: la base ocupa ~2.7 GB (3.2 M de posiciones GPS = 940 MB con sus 5 índices).

## Pasos
```bash
# 1. Base nueva (socket largo: usar TCP) y migraciones como ci-postgres.yml
initdb -D $PGDATA -U postgres --locale=en_US.UTF-8 -E UTF8
pg_ctl -D $PGDATA -o "-p 55432 -k ''" start            # o el puerto libre que prefieras
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres
psql -v ON_ERROR_STOP=1 -q -f supabase/pruebas-aislamiento/andamio_ci.sql
for f in supabase/migrations/*.sql; do
  [ "$(basename $f)" = 0332_db_retencion_producto.sql ] && psql -v ON_ERROR_STOP=1 -q -f scripts/ci/0335_preflight_retencion_indices.sql
  psql -v ON_ERROR_STOP=1 -q -f "$f" || break
done
# 2. Siembra (~2 min) y estadísticas
psql -v ON_ERROR_STOP=1 -q -f scripts/carga/250-camiones/01-sembrar.sql
psql -q -f scripts/carga/250-camiones/02-analyze.sql                 # volumen por tabla
# 3. Medir: p50/p95 y plan de cada consulta caliente (scripts/carga/250-camiones/consultas.sql)
python3 scripts/carga/250-camiones/medir.py --corridas 20 --log $PGDATA/../pg.log --salida resultados.json
#    (--log: log del servidor con auto_explain para ver el plan DENTRO de las RPC; --solo cron.vigia; --plan)
# 4. Concurrencia: dos (u ocho) pasadas del mismo cron a la vez
SESIONES=2 bash scripts/carga/250-camiones/05-concurrencia.sh
# 5. Caminos que cargan en memoria (traerTodo): costo del offset contra el cursor
psql -q -f scripts/carga/250-camiones/06-paginacion-traertodo.sql
# 5b. Vuelta 2: offset contra cursor (id y (fecha,id)) en lecturas reales de gasto sin CFDI, y conteos en SQL
psql -q -f scripts/carga/250-camiones/07-offset-vs-cursor.sql
# 6. Limpiar y borrar el cluster
psql -q -f scripts/carga/250-camiones/04-limpiar.sql
pg_ctl -D $PGDATA stop && rm -rf $PGDATA
```

## Qué mide `consultas.sql`
Cada bloque `-- @nombre:` es una consulta REAL del código traducida de PostgREST a SQL (el comentario
`@origen` dice de dónde). Los `@muta: 1` (reclamos, purgas) se miden dentro de `BEGIN … ROLLBACK`.
Tiempo = planning + execution **del servidor**; no incluye red, JSON de PostgREST ni render.
`medir.py` marca `SEQ` cuando el plan trae un Seq Scan sobre una tabla de más de 50,000 filas.

## Límites declarados
* El repo no trae driver `pg` ni PostgREST, y no se instaló nada: las funciones de `src/lib` (supabase-js)
  no se ejecutaron contra esta base. Los caminos Node se midieron en SQL (`06-…`) y se razonó su memoria.
* Una base con otras sesiones corriendo en la misma máquina infla los tiempos (la corrida de referencia
  tuvo load average 50-60 en 8 núcleos): léanse como cota superior.
* El respaldo de posiciones se siembra solo 90 días (la retención de `purgar_posicion`); un año serían ~10 M
  de filas que el cron de purga borra de todos modos.
* La siembra acumula un historial que nunca se purgó, así que las purgas (`vigia_purgar`,
  `mantener_ledgers`) miden el PRIMER barrido contra un backlog, no el régimen estable de un día.
