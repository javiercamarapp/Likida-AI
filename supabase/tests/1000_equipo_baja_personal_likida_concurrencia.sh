#!/usr/bin/env bash
# equipo_baja_personal_likida (1000): el candado «nunca el último superadmin» aguanta DOS bajas que de verdad se TRASLAPAN. Con exactamente
# dos superadmins activos (A y B), cada uno da de baja al OTRO a la vez: sin candado, las dos transacciones leen «hay otro» antes de que
# ninguna confirme y las dos pasan — Likida se queda sin superadmin. Con el pg_advisory_xact_lock (misma función, mismo recuento y UPDATE),
# la sesión 2 espera a que la 1 confirme y recuenta sobre el estado ya actualizado: una da 'ok' y la otra 'ultimo_superadmin', nunca las dos.
# Además: dos bajas traslapadas sobre dos VENDEDORES distintos no se bloquean entre sí de forma que falle (ambas ok).
# Exclusivo PostgreSQL desechable que no tenga personal real de Likida activo; UUIDs y objetos sintéticos propios, limpiados al salir.
set -euo pipefail
host="${1:?uso: $0 HOST PORT DB}"
port="${2:?uso: $0 HOST PORT DB}"
database="${3:?uso: $0 HOST PORT DB}"
sa='10000000-0000-4000-8000-0000000c0a01'
sb='10000000-0000-4000-8000-0000000c0a02'
v1='10000000-0000-4000-8000-0000000c0b01'
v2='10000000-0000-4000-8000-0000000c0b02'
psql_cmd=(psql -h "$host" -p "$port" -d "$database" -X -v ON_ERROR_STOP=1 -qAt)
work="$(mktemp -d)"
limpiar() {
  "${psql_cmd[@]}" -c "delete from public.app_user where id in ('$sa','$sb','$v1','$v2');" >/dev/null 2>&1 || true
  rm -rf "$work"
}
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.app_user where id in ('$sa','$sb','$v1','$v2');")" = 0 ]] || { echo 'Fixture1000 ya existe; no tocar datos ajenos.'; exit 1; }
[[ "$("${psql_cmd[@]}" -c "select count(*) from public.app_user where tenant_id is null and rol in ('superadmin','vendedor') and activo;")" = 0 ]] \
  || { echo '1000: la base ya tiene personal real de Likida activo; esta prueba exige un Postgres desechable.'; exit 1; }
trap limpiar EXIT
"${psql_cmd[@]}" >/dev/null <<SQL
insert into public.app_user(id,tenant_id,email,rol,activo) values
  ('$sa',null,'sa-c1000@test.invalid','superadmin',true),
  ('$sb',null,'sb-c1000@test.invalid','superadmin',true),
  ('$v1',null,'v1-c1000@test.invalid','vendedor',true),
  ('$v2',null,'v2-c1000@test.invalid','vendedor',true);
SQL

# ── (1) A da de baja a B mientras B da de baja a A (la sesión 1 retiene 3 s sin confirmar) ──
"${psql_cmd[@]}" -c "begin; select public.equipo_baja_personal_likida('$sb','$sa'); select pg_sleep(3); commit;" > "$work/s1.out" 2> "$work/s1.err" &
p1=$!
sleep 1
t0=$(date +%s)
"${psql_cmd[@]}" -c "select public.equipo_baja_personal_likida('$sa','$sb');" > "$work/s2.out" 2> "$work/s2.err"
t1=$(date +%s)
wait "$p1"
[[ -s "$work/s1.err" ]] && { echo '1000: la sesión 1 falló'; cat "$work/s1.err"; exit 1; }
[[ -s "$work/s2.err" ]] && { echo '1000: la sesión 2 falló'; cat "$work/s2.err"; exit 1; }
r1="$(head -1 "$work/s1.out")"
r2="$(cat "$work/s2.out")"
{ [[ "$r1" = ok && "$r2" = ultimo_superadmin ]] || [[ "$r1" = ultimo_superadmin && "$r2" = ok ]]; } \
  || { echo "1000: se esperaba un 'ok' y un 'ultimo_superadmin', salió s1=$r1 s2=$r2"; exit 1; }
(( t1 - t0 >= 1 )) || { echo "1000: la sesión 2 no esperó al candado (tardó $((t1 - t0)) s); el traslape no fue real"; exit 1; }
n="$("${psql_cmd[@]}" -c "select count(*) from public.app_user where id in ('$sa','$sb') and activo;")"
[[ "$n" = 1 ]] || { echo "1000(1): quedaron $n superadmins activos (debía ser exactamente 1 — nunca 0, nunca 2)"; exit 1; }
echo "1000(1) PASS: dos bajas traslapadas sobre los dos únicos superadmins dejan exactamente uno activo, nunca cero (s1=$r1, s2=$r2, espera de la 2: $((t1 - t0)) s)."

# ── (2) dos vendedores distintos a la vez: ambas ok (el candado serializa pero no rechaza lo que no es el último superadmin) ──
act="$("${psql_cmd[@]}" -c "select id from public.app_user where id in ('$sa','$sb') and activo;")"
"${psql_cmd[@]}" -c "begin; select public.equipo_baja_personal_likida('$v1','$act'); select pg_sleep(2); commit;" > "$work/s3.out" 2> "$work/s3.err" &
p2=$!
sleep 1
"${psql_cmd[@]}" -c "select public.equipo_baja_personal_likida('$v2','$act');" > "$work/s4.out" 2> "$work/s4.err"
wait "$p2"
[[ -s "$work/s3.err" ]] && { echo '1000: la sesión 3 falló'; cat "$work/s3.err"; exit 1; }
[[ -s "$work/s4.err" ]] && { echo '1000: la sesión 4 falló'; cat "$work/s4.err"; exit 1; }
r3="$(head -1 "$work/s3.out")"; r4="$(cat "$work/s4.out")"
[[ "$r3" = ok && "$r4" = ok ]] || { echo "1000(2): dos bajas de vendedores distintos debían dar ok/ok, salió s3=$r3 s4=$r4"; exit 1; }
m="$("${psql_cmd[@]}" -c "select count(*) from public.app_user where id in ('$v1','$v2') and activo;")"
[[ "$m" = 0 ]] || { echo "1000(2): quedaron $m vendedores activos (debían ser 0)"; exit 1; }
echo '1000(2) PASS: dos bajas traslapadas de vendedores distintos terminan ambas en ok; el superadmin restante sigue activo.'
