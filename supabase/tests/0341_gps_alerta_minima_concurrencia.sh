#!/usr/bin/env bash
# Dos sesiones reales: un mínimo bloqueado no detiene los otros ni se duplica.
set -euo pipefail
pg_host=${1:?uso: 0341_gps_alerta_minima_concurrencia.sh HOST PORT DB}
pg_port=${2:?uso: 0341_gps_alerta_minima_concurrencia.sh HOST PORT DB}
pg_db=${3:?uso: 0341_gps_alerta_minima_concurrencia.sh HOST PORT DB}
psql_cmd=(psql -h "$pg_host" -p "$pg_port" -d "$pg_db" -X -v ON_ERROR_STOP=1 -Atq)
outdir=$(mktemp -d)
pid_a=''
tenant='34100000-0000-4000-8000-000000000099'
cleanup() {
  if [[ -n "$pid_a" ]]; then kill "$pid_a" 2>/dev/null || true; wait "$pid_a" 2>/dev/null || true; fi
  "${psql_cmd[@]}" -c "delete from public.tenant where id='$tenant';" >/dev/null
  rm -rf "$outdir"
}
trap cleanup EXIT
"${psql_cmd[@]}" -c "
insert into public.tenant(id,nombre) values('$tenant','GPS341 concurrencia sintética');
insert into public.unidad(id,tenant_id,numero_economico) values('$tenant','$tenant','MIN-CONC');
insert into public.evento_seguridad_flota(tenant_id,proveedor,evento_id_externo,unidad_id,grave,ocurrido_en,privacidad_minima)
select '$tenant','samsara','min-'||g,'$tenant',true,'2026-09-05T15:00:00Z',true from generate_series(1,3)g;"
# La sesión A retiene su lease HASTA que este script suelta `liberar_a` (sincronización explícita, no un sleep fijo): bajo carga
# el arranque de psql puede tardar segundos y un pg_sleep(2) vencía antes de que B corriera, o B arrancaba tras el commit de A.
liberar_a="$outdir/liberar_a"
# \! ejecuta el bucle de espera en la misma sesión con la transacción abierta; tope de 120 s para no colgar si el script muere.
"${psql_cmd[@]}" >"$outdir/a.log" 2>&1 <<SQL &
begin;
select evento_id_externo from public.reclamar_eventos_seguridad('$tenant','samsara',1,'worker-a',360,'2026-09-05T16:00:00Z');
\! i=0; while [ ! -e "$liberar_a" ] && [ \$i -lt 2400 ]; do sleep 0.05; i=\$((i+1)); done
commit;
SQL
pid_a=$!
# Esperar evidencia del lease en la sesión A (hasta 60 s), no asumir que un sleep lo creó.
ready=false
for _ in $(seq 1 1200); do
  if grep -q '^min-' "$outdir/a.log"; then ready=true; break; fi
  kill -0 "$pid_a" 2>/dev/null || break
  sleep 0.05
done
[ "$ready" = true ] || { echo 'No arrancó el claim A'; cat "$outdir/a.log"; exit 1; }
"${psql_cmd[@]}" -c "set statement_timeout='1s';
select evento_id_externo from public.reclamar_eventos_seguridad('$tenant','samsara',3,'worker-b',360,'2026-09-05T16:00:00Z');" >"$outdir/b.log"
touch "$liberar_a"
wait "$pid_a"
pid_a=''
[ "$(grep -c '^min-' "$outdir/a.log")" = 1 ]
[ "$(grep -c '^min-' "$outdir/b.log")" = 2 ]
[ "$(cat "$outdir/a.log" "$outdir/b.log" | grep '^min-' | sort -u | wc -l | tr -d ' ')" = 3 ]
[ "$("${psql_cmd[@]}" -c "select count(*) from public.evento_seguridad_flota where tenant_id='$tenant' and claim_token is not null and intentos=1;")" = 3 ]
echo '0341_gps_alerta_minima_concurrencia: PASS (3 mínimos, sin solape ni espera por fila bloqueada)'
